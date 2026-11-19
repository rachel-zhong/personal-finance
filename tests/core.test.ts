import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db, openSqlite } from "@/lib/db";
import { PlaidApi, PlaidTransaction, SyncResponse } from "@/lib/connectors/plaid/client";
import { linkNewItem } from "@/lib/connectors/plaid";
import { syncAll } from "@/lib/sync";
import { manualMatch, unmatchRefund, runAutoMatch } from "@/lib/refunds/matcher";
import { normalizeMerchant, classifyFlow } from "@/lib/classify";
import { importCsv } from "@/lib/connectors/csv";
import { addManualBalance, deleteManualAccount, deleteManualEntry } from "@/lib/connectors/manual";
import { monthlySpending, netWorthSummary } from "@/lib/queries";
import { rebuildNetWorthSnapshots, netWorthQuarters, lastMonthEnd, previousMonthEnds } from "@/lib/networth";
import { upsertAccount, upsertBalance, upsertInstitution, upsertTransaction } from "@/lib/store";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fin-test-"));
process.env.SECRETS_PATH = path.join(tmp, "secrets.json");

function txn(id: string, date: string, plaidAmount: number, merchant: string | null, cat: string, extra: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transaction_id: id, account_id: "acc-card", amount: plaidAmount, iso_currency_code: "USD", date,
    name: merchant ?? "ONLINE TRANSFER", merchant_name: merchant, pending: false,
    personal_finance_category: { primary: cat, detailed: cat }, ...extra,
  };
}

/** Fake Plaid that serves pages from a queue and honors the cursor. */
function fakePlaid(pages: SyncResponse[]): PlaidApi & { calls: number } {
  const api = {
    calls: 0,
    async linkTokenCreate() { return { link_token: "link-x" }; },
    async exchangePublicToken() { return { access_token: "access-x", item_id: "item-1" }; },
    async accountsGet() {
      return {
        item: { item_id: "item-1", institution_id: "ins_1" },
        accounts: [
          { account_id: "acc-card", name: "Sapphire", mask: "1234", type: "credit", subtype: "credit card",
            balances: { current: 500, available: null, iso_currency_code: "USD" } },
          { account_id: "acc-chk", name: "Checking", mask: "9999", type: "depository", subtype: "checking",
            balances: { current: 0, available: null, iso_currency_code: "USD" } },
        ],
      };
    },
    async transactionsSync(_t: string, cursor: string | null) {
      api.calls++;
      const idx = cursor ? Number(cursor.replace("c", "")) : 0;
      return pages[idx] ?? { added: [], modified: [], removed: [], next_cursor: cursor ?? "c0", has_more: false };
    },
    async investmentsHoldingsGet() { return { holdings: [], securities: [] }; },
    async investmentsTransactionsGet() { return { investment_transactions: [], securities: [], total_investment_transactions: 0 }; },
  };
  return api;
}

let db: Db;
beforeEach(() => { db = openSqlite(":memory:"); });

const count = async (sql: string) => (await db.get<{ n: number }>(sql))!.n;

describe("plaid sync", () => {
  it("running sync twice adds no duplicates and saves the cursor", async () => {
    const page: SyncResponse = {
      added: [txn("t1", "2026-10-01", 120, "Target", "GENERAL_MERCHANDISE"), txn("t2", "2026-10-03", 9.5, "Blue Bottle", "FOOD_AND_DRINK")],
      modified: [], removed: [], next_cursor: "c1", has_more: false,
    };
    const plaid = fakePlaid([page]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    await syncAll(db, plaid);
    expect(await count("SELECT COUNT(*) n FROM transactions")).toBe(2);
    expect((await db.get<{ cursor: string }>("SELECT cursor FROM connections"))!.cursor).toBe("c1");

    // Even if Plaid replays the same transactions (cursor reset), no duplicates.
    await db.run("UPDATE connections SET cursor = NULL");
    await syncAll(db, plaid);
    expect(await count("SELECT COUNT(*) n FROM transactions")).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM balance_snapshots")).toBe(2);
  });

  it("follows has_more pages and soft-deletes removed transactions", async () => {
    const plaid = fakePlaid([
      { added: [txn("p1", "2026-10-01", 50, "Shell", "TRANSPORTATION", { pending: true })], modified: [], removed: [], next_cursor: "c1", has_more: true },
      { added: [txn("t1", "2026-10-02", 50, "Shell", "TRANSPORTATION", { pending_transaction_id: "p1" })], modified: [], removed: [{ transaction_id: "p1" }], next_cursor: "c2", has_more: false },
    ]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    expect(await count("SELECT COUNT(*) n FROM transactions")).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM transactions WHERE removed = 0")).toBe(1);
  });
});

describe("refunds", () => {
  async function seed(added: PlaidTransaction[]) {
    const plaid = fakePlaid([{ added, modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
  }
  const net = async () =>
    db.all<{ month: string; net: number }>("SELECT month, SUM(net) net FROM net_spending GROUP BY month ORDER BY month");

  it("matches multiple partial refunds to the most recent earlier purchase, capped", async () => {
    await seed([
      txn("old", "2026-08-01", 40, "Amazon.com", "GENERAL_MERCHANDISE"),
      txn("buy", "2026-09-10", 100, "AMZN Mktp US*2K4LL1", "GENERAL_MERCHANDISE"),
      txn("r1", "2026-09-20", -30, "Amazon", "GENERAL_MERCHANDISE"),
      txn("r2", "2026-10-05", -50, "Amazon.com", "GENERAL_MERCHANDISE"),
      txn("r3", "2026-10-06", -45, "Amazon.com", "GENERAL_MERCHANDISE"), // only $20 left on 'buy' -> capped
    ]);
    const m = await db.all<{ refund: string; purchase: string; amount_applied: number }>(
      `SELECT r.external_id refund, p.external_id purchase, amount_applied FROM refund_matches m
         JOIN transactions r ON r.id = m.refund_id JOIN transactions p ON p.id = m.purchase_id ORDER BY r.date`);
    expect(m).toEqual([
      { refund: "r1", purchase: "buy", amount_applied: 3000 },
      { refund: "r2", purchase: "buy", amount_applied: 5000 },
      { refund: "r3", purchase: "buy", amount_applied: 2000 },
    ]);
    // Purchase month (Sep) nets to 0; Oct gets the $25 unmatched remainder of r3 as negative spending.
    expect(await net()).toEqual([
      { month: "2026-08", net: 4000 },
      { month: "2026-09", net: 0 },
      { month: "2026-10", net: -2500 },
    ]);
  });

  it("ignores transfers, payroll and interest, and purchases older than 90 days", async () => {
    await seed([
      txn("buy", "2026-01-01", 100, "Costco", "GENERAL_MERCHANDISE"),
      txn("late", "2026-06-01", -100, "Costco", "GENERAL_MERCHANDISE"),
      txn("pay", "2026-06-02", -2000, null, "INCOME", { name: "CASH BACK REWARD" }),
      txn("xfer", "2026-06-03", -500, null, "LOAN_PAYMENTS"),
    ]);
    expect(await count("SELECT COUNT(*) n FROM refund_matches")).toBe(0);
    const flows = await db.all<{ external_id: string; flow: string }>("SELECT external_id, flow FROM transactions ORDER BY external_id");
    expect(Object.fromEntries(flows.map((f) => [f.external_id, f.flow]))).toEqual({
      buy: "spend", late: "refund", pay: "income", xfer: "transfer",
    });
    // Unmatched refund reduces spending in June, never counted as income.
    const months = await monthlySpending(db);
    expect(months.find((x) => x.month === "2026-06")!.net).toBe(-10000);
  });

  it("unmatch sticks across re-runs; manual match re-links", async () => {
    await seed([
      txn("buy", "2026-09-10", 100, "Nike", "GENERAL_MERCHANDISE"),
      txn("r1", "2026-09-20", -100, "Nike", "GENERAL_MERCHANDISE"),
    ]);
    const r1 = (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id='r1'"))!.id;
    const buy = (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id='buy'"))!.id;
    await unmatchRefund(db, r1);
    await runAutoMatch(db);
    expect(await count("SELECT COUNT(*) n FROM refund_matches")).toBe(0);
    await manualMatch(db, r1, buy, 4000);
    expect((await db.get<{ amount_applied: number; matched_by: string }>("SELECT amount_applied, matched_by FROM refund_matches"))).toEqual({ amount_applied: 4000, matched_by: "manual" });
    await expect(manualMatch(db, r1, buy, 20000)).rejects.toThrow();
  });
});

describe("net worth", () => {
  it("excludes hidden accounts and money held for others", async () => {
    const plaid = fakePlaid([]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid); // card owes $500
    await importCsv(db, { accountName: "Parents savings", accountType: "depository", csvText: "Date,Description,Amount\n2026-10-01,Deposit,100", currentBalance: 20000 });
    await importCsv(db, { accountName: "My checking", accountType: "depository", csvText: "Date,Description,Amount\n2026-10-01,Coffee,-4.50", currentBalance: 3000 });
    let s = await netWorthSummary(db);
    expect(s.netWorth).toBe(2_300_000 - 50_000);
    await db.run("UPDATE accounts SET include_in_net_worth = 0 WHERE name = 'Parents savings'");
    await db.run("UPDATE accounts SET net_worth_held_for_others = 100000 WHERE name = 'My checking'");
    s = await netWorthSummary(db);
    expect(s.netWorth).toBe(300_000 - 100_000 - 50_000);
    expect(s.notMine).toBe(2_000_000 + 100_000);
  });
});

describe("csv + classify", () => {
  it("csv re-import adds no duplicates, keeps identical same-day rows", async () => {
    const csv = "Transaction Date,Description,Amount\n10/01/2026,STARBUCKS,5.25\n10/01/2026,STARBUCKS,5.25\n10/02/2026,Payment Thank You,-200";
    const o = { accountName: "Rewards Card", accountType: "credit", csvText: csv, positiveIsSpending: true };
    expect((await importCsv(db, o)).added).toBe(3);
    expect((await importCsv(db, o)).added).toBe(0);
    const flows = await db.all<{ flow: string }>("SELECT flow FROM transactions ORDER BY date, amount");
    expect(flows.map((f) => f.flow)).toEqual(["spend", "spend", "transfer"]);
  });

  it("normalizes merchants", () => {
    expect(normalizeMerchant("AMZN Mktp US*2K4LL1")).toBe("amazon");
    expect(normalizeMerchant("Amazon.com")).toBe("amazon");
    expect(normalizeMerchant("SQ *BLUE BOTTLE #12")).toBe("blue bottle");
    expect(classifyFlow({ amount: 5000, merchant: null, description: "ACME CORP PAYROLL", category: null, accountType: "depository" })).toBe("income");
  });
});

describe("manual entries", () => {
  it("deleting an entry falls back to older history; last entry removes the account", async () => {
    const acct = await addManualBalance(db, { accountName: "Acme RSU", type: "investment", asOf: "2026-11-13", balanceCents: 5000000 });
    await addManualBalance(db, { accountName: "Acme RSU", type: "investment", asOf: "2026-11-14", balanceCents: 6000000 });
    expect(await count("SELECT COUNT(*) n FROM accounts")).toBe(1);
    const newest = (await db.get<{ id: string }>("SELECT id FROM manual_entries WHERE as_of = '2026-11-14'"))!.id;
    await deleteManualEntry(db, newest);
    expect((await netWorthSummary(db)).netWorth).toBe(5000000);
    const last = (await db.get<{ id: string }>("SELECT id FROM manual_entries"))!.id;
    expect((await deleteManualEntry(db, last)).accountDeleted).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM accounts")).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM balance_snapshots")).toBe(0);
  });

  it("delete account refuses non-manual accounts", async () => {
    await importCsv(db, { accountName: "Card", accountType: "credit", csvText: "Date,Description,Amount\n2026-10-01,X,-1" });
    const id = (await db.get<{ id: string }>("SELECT id FROM accounts"))!.id;
    await expect(deleteManualAccount(db, id)).rejects.toThrow(/manual/);
  });
});

describe("net worth snapshots", () => {
  it("back-calculates bank and card month-ends; spreads investments evenly from zero; marks estimates", async () => {
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "X" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository" });
    const card = await upsertAccount(db, { source: "csv", externalId: "card", institutionId: inst, name: "Card", type: "credit" });
    const inv = await upsertAccount(db, { source: "manual", externalId: "inv", institutionId: inst, name: "401k", type: "investment" });
    const add = (acc: string, type: string, id: string, date: string, amount: number) => upsertTransaction(db, {
      accountId: acc, accountType: type, source: "csv", externalId: id, date, amount, merchant: null, description: id,
      category: null, pending: false, raw: null });
    await add(chk, "depository", "dep", "2026-10-15", 50000);
    await add(chk, "depository", "rent", "2026-11-02", -20000);
    await add(card, "credit", "buy", "2026-11-05", -10000);
    await upsertBalance(db, chk, "2026-11-14", 100000);
    await upsertBalance(db, card, "2026-11-14", 30000);
    await upsertBalance(db, inv, "2026-11-14", 500000);
    await rebuildNetWorthSnapshots(db, "2026-11-14");
    const rows = await db.all<{ as_of: string; net_worth: number; cash: number; cards: number; is_estimate: number }>(
      "SELECT as_of, net_worth, cash, cards, is_estimate FROM net_worth_snapshots WHERE as_of IN ('2026-10-31','2026-11-14') ORDER BY as_of");
    expect(rows).toEqual([
      { as_of: "2026-10-31", net_worth: 120000 - 20000, cash: 120000, cards: 20000, is_estimate: 0 },
      { as_of: "2026-11-14", net_worth: 100000 - 30000 + 500000, cash: 100000, cards: 30000, is_estimate: 0 },
    ]);
    // Bank and card history rebuilt from transactions is real; the 401k has no history yet (zero at the start).
    expect(await lastMonthEnd(db, "2026-11-14")).toEqual({ date: "2026-10-31", value: 100000, estimate: false });
    // Not enough quarter-ends yet: no chart, and we say when it unlocks (3rd quarter-end after today's data)
    expect(await netWorthQuarters(db, "2026-11-14")).toEqual({ points: [], appearsOn: "2027-06-30" });
    expect(previousMonthEnds("2026-03-10", 2)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("the quarter chart appears once there are 3 completed quarter-ends", async () => {
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "X" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository" });
    await upsertTransaction(db, { accountId: chk, accountType: "depository", source: "csv", externalId: "d", date: "2026-01-10",
      amount: 10000, merchant: null, description: "dep", category: null, pending: false, raw: null });
    await upsertBalance(db, chk, "2026-11-14", 50000);
    await rebuildNetWorthSnapshots(db, "2026-11-14");
    const q = await netWorthQuarters(db, "2026-11-14");
    expect(q.appearsOn).toBeNull();
    expect(q.points.map((p) => p.date)).toEqual(["2026-03-31", "2026-06-30", "2026-09-30"]);
    expect(q.points[0]).toEqual({ date: "2026-03-31", value: 50000 - 0, estimate: false });
  });

  it("Treasury is rebuilt from TreasuryDirect transfers and maturities; other investments ramp up evenly", async () => {
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "X" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository" });
    const add = (id: string, date: string, amount: number, merchant: string) => upsertTransaction(db, {
      accountId: chk, accountType: "depository", source: "csv", externalId: id, date, amount, merchant, description: merchant,
      category: null, pending: false, raw: null });
    await add("buy1", "2026-01-10", -1000000, "TreasuryDirect");
    await add("mature1", "2026-04-10", 1000000, "APA TREAS 310 MISC PAY");
    await add("buy2", "2026-09-30", -1000000, "TreasuryDirect");
    await upsertBalance(db, chk, "2026-11-14", 100000);
    const tsy = await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-11-14", balanceCents: 1000000 });
    await addManualBalance(db, { accountName: "Old brokerage", type: "investment", asOf: "2026-11-14", balanceCents: 6000000 });
    await rebuildNetWorthSnapshots(db, "2026-11-14");
    const at = (d: string) => db.get<{ invest: number; is_estimate: number }>("SELECT invest, is_estimate FROM net_worth_snapshots WHERE as_of = ?", [d]);
    // Treasury plus the brokerage ramp: Mar 31 holds the January bill, Jun 30 nothing, Oct 31 the September bill
    const ramp = (d: string) => Math.round(6000000 * (Date.parse(d) - Date.parse("2026-01-31")) / (Date.parse("2026-11-14") - Date.parse("2026-01-31")));
    expect((await at("2026-03-31"))!.invest).toBe(1000000 + ramp("2026-03-31"));
    expect((await at("2026-06-30"))!.invest).toBe(0 + ramp("2026-06-30"));
    expect((await at("2026-10-31"))!.invest).toBe(1000000 + ramp("2026-10-31"));
    expect((await at("2026-10-31"))!.is_estimate).toBe(1); // the brokerage ramp is an estimate
    expect(tsy).toBeTruthy();
  });

  it("parents group added manually starts excluded", async () => {
    await addManualBalance(db, { accountName: "Mom savings", type: "depository", group: "parents", asOf: "2026-11-14", balanceCents: 900000 });
    expect((await netWorthSummary(db)).netWorth).toBe(0);
  });
});

describe("groups and set-aside", async () => {
  const { groupFor } = await import("@/lib/groups");
  it("splits retirement from investments", () => {
    expect(groupFor({ type: "investment", subtype: "roth", name: "ROTH IRA" })).toBe("retire");
    expect(groupFor({ type: "investment", subtype: "401k", name: "ACME 401(K) PLAN" })).toBe("retire");
    expect(groupFor({ type: "investment", subtype: null, name: "Acme 401k" })).toBe("retire");
    expect(groupFor({ type: "investment", subtype: "brokerage", name: "Brokerage individual" })).toBe("invest");
    expect(groupFor({ type: "investment", subtype: null, name: "Acme RSU" })).toBe("invest");
    expect(groupFor({ type: "investment", subtype: "ira", name: "x", account_group: "invest" })).toBe("invest");
  });
  it("set-aside comes out of net worth and is capped at the balance", async () => {
    await importCsv(db, { accountName: "Savings", accountType: "depository", csvText: "Date,Description,Amount\n2026-10-01,X,1", currentBalance: 1000 });
    await db.run("UPDATE accounts SET net_worth_held_for_others = 40000");
    expect((await netWorthSummary(db)).netWorth).toBe(60000);
    await db.run("UPDATE accounts SET net_worth_held_for_others = 999999");
    expect((await netWorthSummary(db)).netWorth).toBe(0);
  });
});

describe("held for others: whole balance", () => {
  it("follows the balance as it grows, so net worth never includes it", async () => {
    await importCsv(db, { accountName: "Parents CD", accountType: "depository", csvText: "Date,Description,Amount\n2026-10-01,Interest,10", currentBalance: 94175 });
    await db.run("UPDATE accounts SET net_worth_held_mode = 'all'");
    expect((await netWorthSummary(db)).netWorth).toBe(0);
    const id = (await db.get<{ id: string }>("SELECT id FROM accounts"))!.id;
    await upsertBalance(db, id, "2099-01-01", 9_500_000); // interest grew the balance
    expect((await netWorthSummary(db)).netWorth).toBe(0);
    const { heldFor, listAccounts } = await import("@/lib/queries");
    expect(heldFor((await listAccounts(db))[0])).toBe(9_500_000);
  });
});

describe("transactions: running balance and subtotals", () => {
  it("walks bank and card balances back from today's balance", async () => {
    const { runningBalances, txnSubtotals } = await import("@/lib/queries");
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "X" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository" });
    const card = await upsertAccount(db, { source: "csv", externalId: "card", institutionId: inst, name: "Card", type: "credit" });
    const add = (acc: string, type: string, id: string, date: string, amount: number) => upsertTransaction(db, {
      accountId: acc, accountType: type, source: "csv", externalId: id, date, amount, merchant: id, description: id,
      category: null, pending: false, raw: null });
    await add(chk, "depository", "pay", "2026-11-01", 300000);
    await add(chk, "depository", "rent", "2026-11-03", -200000);
    await add(card, "credit", "shoes", "2026-11-02", -10000);
    await add(card, "credit", "payment", "2026-11-04", 5000);
    await upsertBalance(db, chk, "2026-11-14", 150000);
    await upsertBalance(db, card, "2026-11-14", 20000); // owed
    const id = async (ext: string) => (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id = ?", [ext]))!.id;
    const bal = await runningBalances(db, [chk, card]);
    expect(bal.get(await id("rent"))).toBe(150000);
    expect(bal.get(await id("pay"))).toBe(350000);
    expect(bal.get(await id("payment"))).toBe(20000);
    expect(bal.get(await id("shoes"))).toBe(25000);

    const all = await txnSubtotals(db, {}, "raw");
    expect(all).toEqual({ count: 4, moneyIn: 305000, moneyOut: -210000, net: 95000 });
    const outOnly = await txnSubtotals(db, { dir: "out" }, "raw");
    expect(outOnly.count).toBe(2);
    expect(outOnly.moneyIn).toBe(0);
  });
});

describe("categories", () => {
  it("maps bank categories, edits one or all from a merchant, keeps directions separate", async () => {
    const { setCategory } = await import("@/lib/category-edits");
    const plaid = fakePlaid([{ added: [
      txn("rent1", "2026-08-04", 2100, "Parkview Apts", "TRANSFER_OUT", { account_id: "acc-chk" }),
      txn("rent2", "2026-09-03", 2100, "Parkview Apts", "TRANSFER_OUT", { account_id: "acc-chk" }),
      txn("back", "2026-09-10", -50, "Parkview Apts", "TRANSFER_IN", { account_id: "acc-chk" }),
      txn("tj", "2026-09-11", 40, "Whole Foods", "FOOD_AND_DRINK", { personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }),
      txn("venmo", "2026-09-12", -30, "Venmo", "TRANSFER_IN", { account_id: "acc-chk" }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    const cat = async (ext: string) => (await db.get<{ app_category: string; flow: string }>(
      "SELECT app_category, flow FROM transactions WHERE external_id = ?", [ext]))!;
    expect(await cat("tj")).toEqual({ app_category: "groceries", flow: "spend" });
    expect(await cat("rent1")).toEqual({ app_category: "transfer", flow: "transfer" });

    const id = async (ext: string) => (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id = ?", [ext]))!.id;
    expect((await setCategory(db, await id("rent1"), "rent", "merchant")).affected).toBe(2);
    expect(await cat("rent2")).toEqual({ app_category: "rent", flow: "spend" });
    expect((await cat("back")).flow).toBe("transfer"); // money in from Parkview isn't touched

    // Venmo payback counted against dining, just this one
    await setCategory(db, await id("venmo"), "dining", "one");
    expect(await cat("venmo")).toEqual({ app_category: "dining", flow: "refund" });
    const sept = await db.get<{ net: number }>("SELECT SUM(net) AS net FROM net_spending WHERE month = '2026-09'");
    expect(sept!.net).toBe(210000 + 4000 - 3000);

    await setCategory(db, await id("rent1"), null, "merchant");
    expect((await cat("rent2")).flow).toBe("transfer");
  });
});

describe("review list", () => {
  it("app money in is income (no prompt); card payments are never spending", async () => {
    const { reviewItems } = await import("@/lib/review");
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "American Express" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository", subtype: "checking" });
    await upsertAccount(db, { source: "csv", externalId: "card", institutionId: inst, name: "Rewards Card", type: "credit", mask: "4242" });
    const add = (id: string, desc: string, amount: number, detailed: string) => upsertTransaction(db, {
      accountId: chk, accountType: "depository", source: "plaid", externalId: id, date: "2026-09-26", amount, merchant: null,
      description: desc, category: detailed.split("_").slice(0, 2).join("_"), pending: false,
      raw: { personal_finance_category: { detailed } } });
    await add("cardpay", "CITI CARD SVCS DES:AUTOPAY ID:XXXXXXXXXX00000 INDN:DOE J", -250000, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    await add("cardpay2", "CARD ISSUER DES:ACH PMT ID:A0000 INDN:DOE J", -120000, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    await add("zelle", "Zelle payment from JORDAN LEE Conf# abc123", 3500, "TRANSFER_IN_TRANSFER_IN_FROM_APPS");
    await add("venmo", "Venmo", 13000, "TRANSFER_IN_TRANSFER_IN_FROM_APPS");
    const items = await reviewItems(db, "2026-09");
    expect(items).toEqual([]);
    const flow = async (ext: string) => (await db.get<{ flow: string; app_category: string }>(
      "SELECT flow, app_category FROM transactions WHERE external_id = ?", [ext]))!;
    expect(await flow("venmo")).toEqual({ flow: "income", app_category: "income" });
    expect(await flow("zelle")).toEqual({ flow: "income", app_category: "income" });
    expect(await flow("cardpay")).toEqual({ flow: "transfer", app_category: "card_payment" });
    // even an explicit rule can't turn a card payment into spending
    const { setCategory } = await import("@/lib/category-edits");
    const cid = (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id = 'cardpay'"))!.id;
    await setCategory(db, cid, "other", "merchant");
    expect(await flow("cardpay")).toEqual({ flow: "transfer", app_category: "card_payment" });
  });
});

describe("venmo", () => {
  it("payments default to dining, money received to income", async () => {
    const plaid = fakePlaid([{ added: [
      txn("pay", "2026-09-01", 60, "Venmo", "TRANSFER_OUT", { account_id: "acc-chk" }),
      txn("back", "2026-09-05", -20, "Venmo", "TRANSFER_IN", { account_id: "acc-chk",
        personal_finance_category: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_TRANSFER_IN_FROM_APPS" } }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    expect(await count("SELECT COUNT(*) n FROM refund_matches")).toBe(0);
    const sept = await db.get<{ net: number; category: string }>(
      "SELECT SUM(net) AS net, MAX(category) AS category FROM net_spending WHERE month = '2026-09'");
    expect(sept).toEqual({ net: 6000, category: "dining" });
    expect((await db.get<{ flow: string }>("SELECT flow FROM transactions WHERE external_id = 'back'"))!.flow).toBe("income");
  });
});

describe("refunds on cards", () => {
  it("treats card money-in tagged as income as a refund, and pairs differently-worded merchants", async () => {
    const plaid = fakePlaid([{ added: [
      txn("buy1", "2026-10-02", 305.12, "Everlane", "GENERAL_MERCHANDISE"),
      txn("buy2", "2026-10-22", 1007.83, "Everlane", "GENERAL_MERCHANDISE"),
      txn("ret", "2026-10-28", -305.12, null, "INCOME", { name: "SP EVERLANE CLOTHING" }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    const ret = await db.get<{ flow: string; app_category: string }>("SELECT flow, app_category FROM transactions WHERE external_id = 'ret'");
    expect(ret).toEqual({ flow: "refund", app_category: "shopping" });
    // exact-amount purchase wins over the more recent one
    const m = await db.get<{ ext: string; amount_applied: number }>(
      `SELECT p.external_id AS ext, m.amount_applied FROM refund_matches m JOIN transactions p ON p.id = m.purchase_id`);
    expect(m).toEqual({ ext: "buy1", amount_applied: 30512 });
  });
});

describe("credit card rules", () => {
  it("card money out is always a purchase; statement credits lower spending; payments stay transfers", async () => {
    const plaid = fakePlaid([{ added: [
      txn("scanq", "2026-09-01", 5, "Scan Q", "TRANSFER_OUT"),
      txn("travelcr", "2026-09-02", -300, null, "TRANSFER_IN", { name: "TRAVEL CREDIT $300/YEAR" }),
      txn("pay", "2026-09-03", -570.79, null, "LOAN_PAYMENTS", { name: "AUTOMATIC PAYMENT - THANK YOU",
        personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" } }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    const f = async (ext: string) => (await db.get<{ flow: string; app_category: string }>(
      "SELECT flow, app_category FROM transactions WHERE external_id = ?", [ext]))!;
    expect((await f("scanq")).flow).toBe("spend");
    expect(await f("travelcr")).toEqual({ flow: "refund", app_category: "travel" });
    expect(await f("pay")).toEqual({ flow: "transfer", app_category: "card_payment" });
  });
});

describe("card payments from checking", () => {
  it("'ONLINE/MOBILE RECURRING FROM CHK' on a card is a card payment", async () => {
    const plaid = fakePlaid([{ added: [
      txn("p", "2026-08-22", -14.18, null, "TRANSFER_IN", { name: "ONLINE/MOBILE RECURRING FROM CHK 1234" }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    expect((await db.get<{ flow: string }>("SELECT flow FROM transactions WHERE external_id = 'p'"))!.flow).toBe("transfer");
  });
});

describe("refund posted before its purchase", () => {
  it("matches a purchase up to 3 days after the refund, not 4", async () => {
    const plaid = fakePlaid([{ added: [
      txn("ret", "2026-09-10", -40, "Gap", "GENERAL_MERCHANDISE"),
      txn("buy", "2026-09-12", 40, "Gap", "GENERAL_MERCHANDISE"),
      txn("ret2", "2026-09-20", -25, "Uniqlo", "GENERAL_MERCHANDISE"),
      txn("buy2", "2026-09-24", 25, "Uniqlo", "GENERAL_MERCHANDISE"),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    const m = await db.all<{ ext: string }>(
      "SELECT p.external_id AS ext FROM refund_matches m JOIN transactions p ON p.id = m.purchase_id");
    expect(m.map((x) => x.ext)).toEqual(["buy"]);
  });
});

describe("excluding transactions (GL-1, GL-5)", () => {
  const setup = async () => {
    const plaid = fakePlaid([{ added: [
      txn("tbill", "2026-09-05", 10000, "Treasury Direct", "TRANSFER_OUT", { account_id: "acc-chk" }),
      txn("tback", "2026-10-05", -10000, "Treasury Direct", "TRANSFER_IN", { account_id: "acc-chk" }),
      txn("lunch", "2026-09-06", 20, "Sweetgreen", "FOOD_AND_DRINK", { account_id: "acc-chk" }),
    ], modified: [], removed: [], next_cursor: "c1", has_more: false }]);
    await linkNewItem(db, plaid, "public-x", { id: "ins_1", name: "Test Bank" });
    await syncAll(db, plaid);
    const id = async (ext: string) => (await db.get<{ id: string }>("SELECT id FROM transactions WHERE external_id = ?", [ext]))!.id;
    return { id };
  };

  it("an excluded purchase leaves spending and shows as excluded; counting it again restores it", async () => {
    const { excludeTransaction, includeTransaction } = await import("@/lib/exclusions");
    const { id } = await setup();
    const net = async () => (await db.get<{ n: number }>("SELECT COALESCE(SUM(net), 0) AS n FROM net_spending"))!.n;
    expect(await net()).toBe(2000);
    await excludeTransaction(db, await id("lunch"));
    expect(await net()).toBe(0);
    expect((await db.get<{ flow: string }>("SELECT flow FROM transactions WHERE external_id = 'lunch'"))!.flow).toBe("transfer");
    expect(await count("SELECT COUNT(*) AS n FROM transactions WHERE external_id = 'lunch' AND removed = 0")).toBe(1);
    await includeTransaction(db, await id("lunch"));
    expect(await net()).toBe(2000);
  });

  it("keep in net worth moves the amount to a manual account and back; undo reverses it", async () => {
    const { keepInNetWorth, includeTransaction } = await import("@/lib/exclusions");
    const { id } = await setup();
    const acct = await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-09-01", balanceCents: 0 });
    const bal = async () => (await db.get<{ balance: number }>(
      "SELECT balance FROM balance_snapshots WHERE account_id = ? ORDER BY as_of DESC LIMIT 1", [acct]))!.balance;
    await keepInNetWorth(db, await id("tbill"), acct);
    expect(await bal()).toBe(1000000);
    await keepInNetWorth(db, await id("tback"), acct);
    expect(await bal()).toBe(0);
    await includeTransaction(db, await id("tback"));
    expect(await bal()).toBe(1000000);
    await expect(keepInNetWorth(db, await id("tbill"), acct)).rejects.toThrow(/already/i);
  });
});

describe("simplified categories (GL-3)", () => {
  it("maps old categories to the new list and keeps a log of the originals", async () => {
    const { migrations } = await import("@/lib/db/migrations");
    const { default: Database } = await import("better-sqlite3");
    const old = new Database(":memory:");
    for (const m of migrations.filter((x) => x.id < 8)) old.exec(m.sql);
    old.exec("INSERT INTO category_rules (merchant_norm, direction, category, label, created_at) VALUES ('uniqlo','out','clothing','Uniqlo','x'), ('irs','out','taxes','IRS','x'), ('parkview','out','rent','Parkview','x')");
    for (const m of migrations.filter((x) => x.id >= 8)) old.exec(m.sql);
    const rules = old.prepare("SELECT merchant_norm, category FROM category_rules ORDER BY 1").all();
    expect(rules).toEqual([{ merchant_norm: "irs", category: "fees" }, { merchant_norm: "parkview", category: "rent" }, { merchant_norm: "uniqlo", category: "shopping" }]);
    expect(old.prepare("SELECT COUNT(*) AS n FROM category_migration_log WHERE old_category IN ('clothing','taxes')").get()).toEqual({ n: 2 });
  });
});

describe("investments (IN)", () => {
  /** A brokerage connection with two accounts; holdings arrive only after investments are enabled. */
  async function setupBroker() {
    const base = fakePlaid([]);
    const plaid: PlaidApi = {
      ...base,
      async accountsGet() {
        return {
          item: { item_id: "item-1", institution_id: "ins_b" },
          accounts: [
            { account_id: "acc-brk", name: "Individual", mask: "1111", type: "investment", subtype: "brokerage",
              balances: { current: 1500, available: null, iso_currency_code: "USD" } },
            { account_id: "acc-roth", name: "Roth IRA", mask: "2222", type: "investment", subtype: "roth",
              balances: { current: 1000, available: null, iso_currency_code: "USD" } },
          ],
        };
      },
      async investmentsHoldingsGet() {
        return {
          securities: [
            { security_id: "s-vti", name: "Vanguard Total Stock Market ETF", ticker_symbol: "VTI", type: "etf", close_price: 250, close_price_as_of: "2026-11-16" },
            { security_id: "s-acme", name: "Acme Corp", ticker_symbol: "ACME", type: "equity", close_price: 50, close_price_as_of: "2026-11-16" },
            { security_id: "s-mmf", name: "Money Market", ticker_symbol: null, type: "mutual fund", is_cash_equivalent: true, close_price: 1, close_price_as_of: null },
          ],
          holdings: [
            { account_id: "acc-brk", security_id: "s-vti", quantity: 2, institution_price: 250, institution_value: 500, cost_basis: 400 },
            { account_id: "acc-brk", security_id: "s-acme", quantity: 20, institution_price: 50, institution_value: 1000, cost_basis: null },
            { account_id: "acc-roth", security_id: "s-vti", quantity: 3, institution_price: 250, institution_value: 750, cost_basis: 800 },
            { account_id: "acc-roth", security_id: "s-mmf", quantity: 250, institution_price: 1, institution_value: 250, cost_basis: 250 },
          ],
        };
      },
      async investmentsTransactionsGet(_t, _s, _e, offset) {
        const all = [
          { investment_transaction_id: "i1", account_id: "acc-brk", security_id: "s-acme", date: "2026-03-01", name: "DIVIDEND ACME", quantity: 0, amount: -12.5, price: 0, fees: 0, type: "cash", subtype: "dividend" },
          { investment_transaction_id: "i2", account_id: "acc-brk", security_id: "s-vti", date: "2026-04-01", name: "BUY VTI", quantity: 2, amount: 400, price: 200, fees: 0, type: "buy", subtype: "buy" },
          { investment_transaction_id: "i3", account_id: "acc-brk", security_id: "s-acme", date: "2025-12-01", name: "DIVIDEND ACME", quantity: 0, amount: -10, price: 0, fees: 0, type: "cash", subtype: "qualified dividend" },
        ];
        // Two pages, to exercise pagination
        return { investment_transactions: offset === 0 ? all.slice(0, 2) : all.slice(offset), securities: [], total_investment_transactions: all.length };
      },
    };
    const connId = await linkNewItem(db, plaid, "public-x", { id: "ins_b", name: "Test Broker" });
    return { plaid, connId };
  }

  it("never fetches holdings until investments are enabled for that connection", async () => {
    const { investmentsHoldingsGet: _unused, ...rest } = await setupBroker().then((x) => x.plaid);
    void _unused;
    let called = 0;
    await syncAll(db, { ...rest, async investmentsHoldingsGet() { called++; return { holdings: [], securities: [] }; } } as PlaidApi);
    expect(called).toBe(0);
    const { portfolio } = await import("@/lib/investments");
    const lines = await portfolio(db);
    // Each account is one line from its balance until holdings are shared
    expect(lines.map((l) => [l.kind, l.value, l.note])).toEqual([
      ["account", 150000, "Holdings not shared yet"], ["account", 100000, "Holdings not shared yet"],
    ]);
  });

  it("syncs holdings and transactions, combines by ticker, and summarizes", async () => {
    const { plaid, connId } = await setupBroker();
    await db.run("UPDATE connections SET investments_enabled = 1 WHERE id = ?", [connId]);
    const r = await syncAll(db, plaid);
    expect(r.investments[0]).toMatchObject({ holdings: 4, transactions: 3 });
    await syncAll(db, plaid); // twice: no duplicates
    expect(await count("SELECT COUNT(*) AS n FROM investment_transactions")).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM holdings")).toBe(4);

    const { portfolio, combine, investmentSummary, allocation, snapshotHoldings } = await import("@/lib/investments");
    const lines = await portfolio(db);
    const rows = combine(lines);
    const vti = rows.find((x) => x.ticker === "VTI")!;
    expect(vti).toMatchObject({ quantity: 5, value: 125000, costBasis: 120000, assetType: "funds" });
    expect(vti.accounts).toHaveLength(2);
    expect(rows.find((x) => x.name === "Money Market")!.assetType).toBe("cash");

    const s = await investmentSummary(db, lines, "2026-11-17");
    expect(s.total).toBe(250000);
    expect(s.gain).toMatchObject({ amount: 125000 + 25000 - 120000 - 25000 }); // VTI +50 −50 → 0... plus mmf 0
    expect(s.noBasisValue).toBe(100000); // ACME has no cost basis
    expect(s.dividends).toBe(1250); // 2026 only
    expect(s.change).toBeNull(); // no month-end snapshot yet

    const tax = allocation(lines, (l) => l.taxType);
    expect(tax).toEqual([{ key: "taxable", value: 150000, pct: 60 }, { key: "roth", value: 100000, pct: 40 }]);

    // A month-end snapshot enables the change card
    await snapshotHoldings(db, "2026-10-31");
    await db.run("UPDATE holding_snapshots SET value = value - 1000 WHERE as_of = '2026-10-31' AND holding_key = 's-acme'");
    const s2 = await investmentSummary(db, lines, "2026-11-17");
    expect(s2.change).toMatchObject({ since: "2026-10-31", amount: 1000 });
  });

  it("manual accounts are one-line holdings with sensible defaults", async () => {
    const { portfolio } = await import("@/lib/investments");
    await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-11-01", balanceCents: 500000 });
    await addManualBalance(db, { accountName: "Acme RSU", type: "investment", asOf: "2026-11-01", balanceCents: 300000 });
    await addManualBalance(db, { accountName: "Old 401k", type: "investment", asOf: "2026-11-01", balanceCents: 200000 });
    const lines = await portfolio(db);
    const by = Object.fromEntries(lines.map((l) => [l.name, [l.assetType, l.taxType]]));
    expect(by).toEqual({ Treasury: ["bonds", "taxable"], "Acme RSU": ["stocks", "taxable"], "Old 401k": ["funds", "traditional"] });
  });

  it("classifies what brokers actually send: crypto, in-plan funds, placeholder tickers", async () => {
    const { assetTypeFor, realTicker } = await import("@/lib/investments");
    expect(assetTypeFor({ type: "cryptocurrency", is_cash_equivalent: 1 })).toBe("crypto");
    expect(assetTypeFor({ type: "equity", ticker: "TARGETCO.RETIRE.2060", name: "Example Target 2060" })).toBe("funds");
    expect(assetTypeFor({ type: "equity", ticker: "ACME", name: "Acme Trust Holdings" })).toBe("stocks");
    expect(assetTypeFor({ type: "mutual fund", is_cash_equivalent: 1 })).toBe("cash");
    expect([realTicker("vti"), realTicker("BRK.B"), realTicker("CUR:USD"), realTicker("TARGETCO.RETIRE.2060")]).toEqual(["VTI", "BRK.B", null, null]);
  });

  it("shows the gap between balance and listed holdings as cash", async () => {
    const { plaid, connId } = await setupBroker();
    await db.run("UPDATE connections SET investments_enabled = 1 WHERE id = ?", [connId]);
    await syncAll(db, { ...plaid, async accountsGet() {
      const r = await plaid.accountsGet("x");
      r.accounts[1].balances.current = 1300; // Roth holdings add to $1,000; $300 is uninvested cash
      return r;
    } });
    const { portfolio, investmentSummary } = await import("@/lib/investments");
    const lines = await portfolio(db);
    const cash = lines.filter((l) => l.name === "Cash" && l.taxType === "roth");
    expect(cash.map((l) => l.value)).toEqual([30000]);
    expect((await investmentSummary(db, lines, "2026-11-17")).total).toBe(280000);
  });

  it("manual holdings live inside manual accounts; the rest of the balance stays one line", async () => {
    const { portfolio, saveManualHolding, deleteManualHolding } = await import("@/lib/investments");
    const rsu = await addManualBalance(db, { accountName: "Acme RSU", type: "investment", asOf: "2026-11-01", balanceCents: 300000 });
    const id = await saveManualHolding(db, { accountId: rsu, name: "Acme Corp", ticker: "acme", quantity: 40, valueCents: 200000, assetType: "stocks" });
    let lines = await portfolio(db);
    expect(lines.map((l) => [l.name, l.ticker, l.value, l.price])).toEqual([
      ["Acme Corp", "ACME", 200000, 50], ["Acme RSU (rest)", null, 100000, null],
    ]);
    await deleteManualHolding(db, id);
    lines = await portfolio(db);
    expect(lines.map((l) => l.name)).toEqual(["Acme RSU"]);

    const plaidAcct = await upsertAccount(db, { source: "plaid", externalId: "b1", institutionId: null, connectionId: null,
      name: "Brokerage", type: "investment", subtype: "brokerage", mask: null, currency: "USD" });
    await expect(saveManualHolding(db, { accountId: plaidAcct, name: "X", valueCents: 1, assetType: "stocks" })).rejects.toThrow(/by hand/);
  });

  it("value over time waits for the 3rd quarter-end of real snapshots", async () => {
    const { investmentQuarters, snapshotHoldings } = await import("@/lib/investments");
    await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-11-01", balanceCents: 100000 });
    await snapshotHoldings(db, "2026-11-17");
    expect(await investmentQuarters(db, "2026-11-18")).toEqual({ points: [], appearsOn: "2027-06-30" });
    for (const d of ["2026-12-31", "2027-03-29", "2027-06-30"]) await snapshotHoldings(db, d);
    const q = await investmentQuarters(db, "2027-07-02");
    expect(q.points.map((p) => p.date)).toEqual(["2026-12-31", "2027-03-31", "2027-06-30"]);
  });

  it("sorts broker activity into the filter types", async () => {
    const { activityKind } = await import("@/lib/investments");
    expect([
      activityKind("buy", "dividend reinvestment"), activityKind("sell", "sell"), activityKind("cash", "qualified dividend"),
      activityKind("transfer", "transfer"), activityKind("cash", "contribution"), activityKind("fee", "management fee"), activityKind("cash", "interest"),
    ]).toEqual(["buy", "sell", "dividend", "contribution", "contribution", "fee", "other"]);
  });

  it("weekly values: last saved value each week, gaps stay empty", async () => {
    const { weeklyValues, weekEndOf, snapshotHoldings } = await import("@/lib/investments");
    expect(weekEndOf("2026-11-17")).toBe("2026-11-22"); // Tuesday → Sunday
    expect(weekEndOf("2026-11-22")).toBe("2026-11-22");
    await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-11-01", balanceCents: 100000 });
    await snapshotHoldings(db, "2026-11-17");
    await addManualBalance(db, { accountName: "Treasury", type: "investment", asOf: "2026-11-18", balanceCents: 110000 });
    await snapshotHoldings(db, "2026-11-19");
    await snapshotHoldings(db, "2026-12-03");
    const w = await weeklyValues(db, "2026-12-03");
    expect(w).toEqual([
      { weekEnd: "2026-11-22", date: "2026-11-19", value: 110000 },
      { weekEnd: "2026-11-29", date: null, value: null },
      { weekEnd: "2026-12-06", date: "2026-12-03", value: 110000 },
    ]);
  });
});

describe("paybacks (money in that isn't income)", () => {
  it("matching Venmo money in to a dinner makes it a dining payback, linked, and no longer income", async () => {
    const { matchPayback } = await import("@/lib/category-edits");
    const { refreshDerived } = await import("@/lib/store");
    const { isReviewable } = await import("@/lib/categories");
    const inst = await upsertInstitution(db, { source: "csv", externalId: "x", name: "X" });
    const chk = await upsertAccount(db, { source: "csv", externalId: "chk", institutionId: inst, name: "Checking", type: "depository" });
    const card = await upsertAccount(db, { source: "csv", externalId: "card", institutionId: inst, name: "Card", type: "credit" });
    await upsertTransaction(db, { accountId: card, accountType: "credit", source: "csv", externalId: "dinner", date: "2026-06-10",
      amount: -12000, merchant: "Corner Bistro", description: "Corner Bistro", category: "FOOD_AND_DRINK", pending: false, raw: null });
    await upsertTransaction(db, { accountId: chk, accountType: "depository", source: "csv", externalId: "vm", date: "2026-06-12",
      amount: 4000, merchant: "Venmo", description: "Venmo", category: null, pending: false, raw: null });
    await refreshDerived(db);
    const row = async (ext: string) => (await db.get<{ id: string; flow: string; app_category: string; amount: number; merchant: string; description: string }>(
      "SELECT id, flow, app_category, amount, merchant, description FROM transactions WHERE external_id = ?", [ext]))!;
    const vm = await row("vm");
    expect(vm.flow).toBe("income");
    expect(isReviewable(vm)).toBe(true);
    await matchPayback(db, vm.id, (await row("dinner")).id);
    expect(await row("vm")).toMatchObject({ flow: "refund", app_category: "dining" });
    expect(await count("SELECT COUNT(*) AS n FROM refund_matches")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM transactions WHERE flow = 'income'")).toBe(0);
  });
});

