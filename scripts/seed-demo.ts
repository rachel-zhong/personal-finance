/**
 * Fills a SEPARATE demo database (data/demo.db) with fake data so you can explore the UI.
 * Never touches your real database. Run: npm run demo
 */
process.env.DATABASE_PATH = process.env.DATABASE_PATH || "data/demo.db";
import fs from "node:fs";
import { getDb } from "@/lib/db";
import { upsertAccount, upsertBalance, upsertInstitution, upsertTransaction, refreshDerived } from "@/lib/store";
import { runAutoMatch, shiftDate } from "@/lib/refunds/matcher";
import { addManualBalance } from "@/lib/connectors/manual";
import { rebuildNetWorthSnapshots } from "@/lib/networth";

async function main() {
  if (!process.env.DATABASE_PATH!.includes("demo")) throw new Error("Refusing to seed a non-demo database");
  for (const f of ["", "-wal", "-shm"]) fs.rmSync(process.env.DATABASE_PATH + f, { force: true });
  const db = getDb();
  const inst = await upsertInstitution(db, { source: "csv", externalId: "demo", name: "Wells Fargo" });
  const checking = await upsertAccount(db, { source: "csv", externalId: "demo-chk", institutionId: inst, name: "Everyday Checking", type: "depository", subtype: "checking", mask: "0042" });
  const card = await upsertAccount(db, { source: "csv", externalId: "demo-card", institutionId: inst, name: "Citi Double Cash", type: "credit", subtype: "credit card", mask: "7781" });
  const parents = await upsertAccount(db, { source: "csv", externalId: "demo-parents", institutionId: inst, name: "Family Savings", type: "depository", subtype: "savings", mask: "5510" });
  await db.run("UPDATE accounts SET net_worth_held_mode = 'all', include_in_spending = 0, net_worth_note = 'Family' WHERE id = ?", [parents]);

  const end = new Date().toLocaleDateString("en-CA");
  const DAYS = 460; // about 15 months, so the quarter-end net worth chart has enough history
  for (let d = DAYS; d >= 0; d -= 7) {
    const day = shiftDate(end, -d);
    await upsertBalance(db, checking, day, 800000 + (DAYS - d) * 900 + Math.round(Math.sin(d) * 40000));
    await upsertBalance(db, card, day, 120000 + Math.round(Math.cos(d) * 50000));
    await upsertBalance(db, parents, day, 2500000);
  }
  // Dated manual entries: real history for the 401k; the brokerage has only today's balance (estimated before that)
  for (let q = 4; q >= 0; q--) {
    await addManualBalance(db, { accountName: "Vanguard 401(k)", type: "investment", asOf: shiftDate(end, -q * 91), balanceCents: 5400000 + (4 - q) * 310000 });
  }
  await addManualBalance(db, { accountName: "Schwab Brokerage", type: "investment", asOf: end, balanceCents: 3850000 });

  let n = 0;
  const t = async (acc: string, type: string, daysAgo: number, amt: number, merchant: string | null, desc: string, cat: string, detailed?: string) =>
    upsertTransaction(db, { accountId: acc, accountType: type, source: "csv", externalId: `demo-${n++}`, date: shiftDate(end, -daysAgo),
      amount: Math.round(amt * 100), merchant, description: desc, category: cat, pending: daysAgo < 2,
      raw: { demo: true, ...(detailed ? { personal_finance_category: { primary: cat, detailed } } : {}) } });

  const shops: [string, string, number, string?][] = [["Whole Foods", "FOOD_AND_DRINK", 68, "FOOD_AND_DRINK_GROCERIES"], ["Blue Bottle", "FOOD_AND_DRINK", 7], ["Shell", "TRANSPORTATION", 52], ["Netflix", "ENTERTAINMENT", 15.49], ["City Power & Light", "RENT_AND_UTILITIES", 110]];
  for (let d = DAYS - 10; d >= 0; d -= 3) {
    const [m, c, base, detailed] = shops[d % shops.length];
    await t(card, "credit", d, -(base + (d % 7) * 3.1), m, m.toUpperCase(), c, detailed);
  }
  for (let d = DAYS - 5; d >= 0; d -= 14) await t(checking, "depository", d, 3850, null, "ACME CORP PAYROLL", "INCOME");
  for (let d = DAYS - 10; d >= 0; d -= 30) await t(card, "credit", d, 1500, null, "Payment Thank You", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  for (let d = DAYS - 2; d >= 0; d -= 30) await t(checking, "depository", d, -2100, "Parkview Apts", "PARKVIEW APTS RENT", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT");
  for (let d = DAYS - 8; d >= 0; d -= 30) await t(checking, "depository", d, -(1200 + (d % 4) * 400), "Schwab", "SCHWAB BROKERAGE TRANSFER", "TRANSFER_OUT");
  // Returns
  await t(card, "credit", 40, -240, "Target", "TARGET.COM", "GENERAL_MERCHANDISE");
  await t(card, "credit", 30, 60, "Target", "TARGET.COM REFUND", "GENERAL_MERCHANDISE");
  await t(card, "credit", 25, 80, "Target", "TARGET.COM REFUND", "GENERAL_MERCHANDISE");
  await t(card, "credit", 70, -129.99, "Nike", "NIKE.COM", "GENERAL_MERCHANDISE");
  await t(card, "credit", 60, 129.99, "Nike", "NIKE.COM RETURN", "GENERAL_MERCHANDISE");
  await t(card, "credit", 10, 35, "REI", "REI #44 RETURN", "GENERAL_MERCHANDISE"); // no purchase -> unmatched refund
  await t(parents, "depository", 20, -400, "Costco", "COSTCO", "GENERAL_MERCHANDISE");

  await refreshDerived(db);
  const { created } = await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
  console.log(`Demo data written to ${process.env.DATABASE_PATH} (${n} transactions, ${created} refunds auto-matched).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
