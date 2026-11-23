/**
 * Investments (PRD IN): holdings and investment transactions from Plaid, manual accounts as one-line holdings,
 * and a daily snapshot of every holding. Read-only: only /investments/holdings/get and /investments/transactions/get.
 */
import { Db, newId, nowIso, today } from "./db";
import { getAccessToken } from "./secrets";
import { PlaidApi, PlaidError, PlaidInvestmentTransaction, PlaidSecurity } from "./connectors/plaid/client";
import { groupFor } from "./groups";
import { upsertBalance } from "./store";
import { accountLabel } from "./queries";
import { monthEnd as monthEndOf, previousMonthEnds } from "./networth";
import { shiftDate } from "./refunds/matcher";
import { AssetType, HoldingLine, TaxType } from "./holdings";
export * from "./holdings";

const toCents = (n: number) => Math.round(n * 100);

// ---------- Defaults (types and labels live in lib/holdings.ts) ----------

/** A real exchange ticker ("VTI", "BRK.B"), not a placeholder like "CUR:USD" or "VANGUARD.TARGET.2060". */
export const realTicker = (t: string | null | undefined) => {
  const x = t?.trim().toUpperCase();
  return x && /^[A-Z][A-Z0-9]{0,5}([.-][A-Z])?$/.test(x) ? x : null;
};
const FUND_NAME = /\b(target|fund|index|trust|portfolio|collective|lifecycle|freedom)\b/i;

/** Plaid security type → our asset type. Money market funds come back as cash equivalents. */
export function assetTypeFor(s: { type: string | null; is_cash_equivalent?: number | boolean | null; ticker?: string | null; name?: string | null }): AssetType {
  const type = (s.type ?? "").toLowerCase();
  if (type === "cryptocurrency") return "crypto"; // Plaid flags crypto as cash-equivalent; it isn't
  if (s.is_cash_equivalent) return "cash";
  switch (type) {
    // 401k plans report in-plan funds as "equity" with a made-up ticker
    case "equity": return !realTicker(s.ticker) && FUND_NAME.test(s.name ?? "") ? "funds" : "stocks";
    case "etf": case "mutual fund": return "funds";
    case "fixed income": return "bonds";
    case "cash": return "cash";
    case "cryptocurrency": return "crypto";
    default: return "other";
  }
}

/** Account subtype (or a manual account's name) → tax treatment. */
export function taxTypeFor(a: { subtype: string | null; name: string; type: string }): TaxType {
  const sub = (a.subtype ?? "").toLowerCase();
  if (/roth/.test(sub) || /\broth\b/i.test(a.name)) return "roth";
  if (["hsa", "529", "education savings account"].includes(sub)) return "other";
  if (groupFor({ type: a.type, subtype: a.subtype, name: a.name }) === "retire") return "traditional";
  return "taxable";
}

/** Asset type for a whole account shown as one line (manual accounts, or holdings not loaded yet). */
export function accountAssetType(a: { subtype: string | null; name: string; type: string }): AssetType {
  if (/crypto/i.test(a.subtype ?? "") || /crypto/i.test(a.name)) return "crypto";
  if (/treasur|t-?bill|bond|i ?bonds?/i.test(a.name)) return "bonds";
  if (/\brsu\b|espp|stock/i.test(a.name)) return "stocks";
  if (groupFor({ type: a.type, subtype: a.subtype, name: a.name }) === "retire") return "funds";
  return "other";
}

// ---------- Sync (IN-3, IN-4) ----------

async function upsertSecurities(db: Db, list: PlaidSecurity[]) {
  for (const s of list) {
    await db.run(
      `INSERT INTO securities (id, ticker, name, type, is_cash_equivalent, close_price, close_price_as_of, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ticker = excluded.ticker, name = excluded.name, type = excluded.type,
         is_cash_equivalent = excluded.is_cash_equivalent, close_price = excluded.close_price,
         close_price_as_of = excluded.close_price_as_of, updated_at = excluded.updated_at`,
      [s.security_id, s.ticker_symbol ?? null, s.name ?? null, s.type ?? null, s.is_cash_equivalent ? 1 : 0,
        s.close_price ?? null, s.close_price_as_of ?? null, nowIso()],
    );
  }
}

const shiftDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};

export interface InvestmentSyncResult { connectionId: string; holdings: number; transactions: number; error?: string }

/** Pull holdings and investment transactions for one connection the user opted in (investments_enabled = 1). */
export async function syncInvestments(db: Db, plaid: PlaidApi, connectionId: string): Promise<InvestmentSyncResult> {
  const conn = await db.get<{ access_token_ref: string }>(
    "SELECT access_token_ref FROM connections WHERE id = ? AND investments_enabled = 1", [connectionId]);
  const result: InvestmentSyncResult = { connectionId, holdings: 0, transactions: 0 };
  if (!conn) return result;
  try {
    const token = getAccessToken(conn.access_token_ref);
    // Network first, then one DB transaction.
    const h = await plaid.investmentsHoldingsGet(token);
    const end = today();
    // Always ask for 24 months (Plaid's max): brokers backfill older history days after you connect.
    const start = shiftDays(end, -730);
    const txns: PlaidInvestmentTransaction[] = [];
    const secs = [...h.securities];
    for (let offset = 0; ; ) {
      const page = await plaid.investmentsTransactionsGet(token, start, end, offset);
      txns.push(...page.investment_transactions);
      secs.push(...page.securities);
      offset += page.investment_transactions.length;
      if (!page.investment_transactions.length || offset >= page.total_investment_transactions) break;
    }

    await db.tx(async (tx) => {
      const accts = new Map((await tx.all<{ id: string; external_id: string }>(
        "SELECT id, external_id FROM accounts WHERE connection_id = ?", [connectionId])).map((a) => [a.external_id, a.id]));
      await upsertSecurities(tx, secs);
      // The holdings answer carries each account's balance too. Save it, so Net worth matches the holdings.
      for (const a of h.accounts ?? []) {
        const accountId = accts.get(a.account_id);
        if (accountId && a.balances?.current != null) await upsertBalance(tx, accountId, end, toCents(a.balances.current));
      }
      await tx.run(`DELETE FROM holdings WHERE account_id IN (SELECT id FROM accounts WHERE connection_id = ?)`, [connectionId]);
      for (const x of h.holdings) {
        const accountId = accts.get(x.account_id);
        if (!accountId) continue;
        await tx.run(
          `INSERT INTO holdings (account_id, security_id, quantity, price, price_as_of, value, cost_basis, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, security_id) DO UPDATE SET quantity = quantity + excluded.quantity, value = value + excluded.value`,
          [accountId, x.security_id, x.quantity, x.institution_price ?? null, x.institution_price_as_of ?? null,
            toCents(x.institution_value), x.cost_basis == null ? null : toCents(x.cost_basis), nowIso()],
        );
        result.holdings++;
      }
      for (const t of txns) {
        const accountId = accts.get(t.account_id);
        if (!accountId) continue;
        await tx.run(
          `INSERT INTO investment_transactions (id, account_id, security_id, date, name, type, subtype, quantity, price, amount, fees, raw)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET date = excluded.date, name = excluded.name, type = excluded.type, subtype = excluded.subtype,
             quantity = excluded.quantity, price = excluded.price, amount = excluded.amount, fees = excluded.fees, raw = excluded.raw`,
          [t.investment_transaction_id, accountId, t.security_id ?? null, t.date, t.name, t.type, t.subtype ?? null,
            t.quantity ?? null, t.price ?? null, -toCents(t.amount), t.fees == null ? null : toCents(t.fees), JSON.stringify(t)],
        );
        result.transactions++;
      }
      await tx.run("UPDATE connections SET investments_error = NULL WHERE id = ?", [connectionId]);
    });
  } catch (e) {
    const consent = e instanceof PlaidError && e.code === "ADDITIONAL_CONSENT_REQUIRED";
    const msg = consent
      ? "Investment details weren't approved in Plaid's window. Click Add investment details and finish all the steps."
      : e instanceof PlaidError && e.code === "PRODUCT_NOT_READY"
        ? "Plaid is still loading your investments. Try Sync now in a few minutes."
        : e instanceof Error ? e.message : String(e);
    // No consent: switch it back off so the button shows again.
    await db.run("UPDATE connections SET investments_error = ?, investments_enabled = CASE WHEN ? THEN 0 ELSE investments_enabled END WHERE id = ?",
      [msg, consent ? 1 : 0, connectionId]);
    result.error = msg;
  }
  return result;
}

// ---------- Portfolio (one line per holding per account) ----------

interface InvAccount {
  id: string; name: string; display_name: string | null; mask: string | null; type: string; subtype: string | null;
  source: string; institution: string | null; balance: number | null; balance_as_of: string | null;
  asset_type: string | null; tax_type: string | null; investments_enabled: number | null;
}

/** Investment and retirement accounts that count toward net worth. */
async function investmentAccounts(db: Db) {
  const rows = await db.all<InvAccount & { account_group: string | null; include_in_net_worth: number }>(`
    SELECT a.id, a.name, a.display_name, a.mask, a.type, a.subtype, a.source, a.account_group, a.include_in_net_worth,
           i.name AS institution, b.balance, b.as_of AS balance_as_of, s.asset_type, s.tax_type, c.investments_enabled
      FROM accounts a
      LEFT JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN connections c ON c.id = a.connection_id
      LEFT JOIN investment_settings s ON s.account_id = a.id
      LEFT JOIN balance_snapshots b ON b.account_id = a.id
            AND b.as_of = (SELECT MAX(as_of) FROM balance_snapshots b2 WHERE b2.account_id = a.id)`);
  return rows.filter((a) => a.include_in_net_worth && ["invest", "retire"].includes(groupFor(a)));
}

/** Smallest gap between balance and holdings worth showing as cash ($50); smaller gaps are price timing. */
const RESIDUAL_MIN = 5000;

export async function portfolio(db: Db): Promise<HoldingLine[]> {
  const accts = await investmentAccounts(db);
  const held = await db.all<{
    account_id: string; security_id: string; quantity: number; price: number | null; value: number; cost_basis: number | null;
    ticker: string | null; name: string | null; type: string | null; is_cash_equivalent: number;
  }>(`SELECT h.account_id, h.security_id, h.quantity, h.price, h.value, h.cost_basis, s.ticker, s.name, s.type, s.is_cash_equivalent
        FROM holdings h JOIN securities s ON s.id = h.security_id`);
  const manual = await db.all<{ id: string; account_id: string; name: string; ticker: string | null; quantity: number | null; value: number; asset_type: string }>(
    "SELECT id, account_id, name, ticker, quantity, value, asset_type FROM manual_holdings ORDER BY value DESC");
  const lines: HoldingLine[] = [];
  for (const a of accts) {
    const start = lines.length;
    const account = accountLabel(a);
    const taxType = (a.tax_type as TaxType) || taxTypeFor(a);
    // Brokers send uninvested cash as a $0 placeholder; it adds nothing, so leave it out.
    const mine = held.filter((h) => h.account_id === a.id && !(h.type === "cash" && h.value === 0));
    for (const h of mine) {
      const ticker = realTicker(h.ticker);
      const assetType = assetTypeFor(h);
      const isCash = h.type === "cash";
      lines.push({
        key: isCash ? "cash" : ticker ? `t:${ticker}` : `s:${h.security_id}`, securityId: h.security_id, accountId: a.id, account, institution: a.institution, taxType,
        assetType, name: isCash ? "Cash" : h.name || ticker || "Unnamed holding", ticker,
        quantity: isCash ? null : h.quantity, price: isCash ? null : h.price, value: h.value, costBasis: isCash ? h.value : h.cost_basis, kind: "holding",
      });
    }
    // Brokers often leave uninvested cash out of the holdings list. Show the gap so totals match the balance.
    const itemized = mine.reduce((s, h) => s + h.value, 0);
    if (mine.length && a.balance != null && a.balance - itemized > RESIDUAL_MIN) {
      lines.push({
        key: "cash", securityId: `residual:${a.id}`, accountId: a.id, account, institution: a.institution, taxType,
        assetType: "cash", name: "Cash", ticker: null, quantity: null, price: null,
        value: a.balance - itemized, costBasis: a.balance - itemized, kind: "holding",
        note: "Balance not listed as a holding",
      });
    }
    // Holdings you added by hand to a manual account (IN-7). The rest of the balance stays as one line.
    const added = a.source === "manual" ? manual.filter((m) => m.account_id === a.id) : [];
    for (const m of added) {
      const ticker = realTicker(m.ticker);
      lines.push({
        key: ticker ? `t:${ticker}` : `m:${m.id}`, securityId: `manual:${m.id}`, accountId: a.id, account, institution: a.institution, taxType,
        assetType: m.asset_type as AssetType, name: m.name, ticker, quantity: m.quantity,
        price: m.quantity ? m.value / 100 / m.quantity : null, value: m.value, costBasis: null, kind: "holding",
        note: "Added by hand", manualId: m.id,
      });
    }
    const addedTotal = added.reduce((s, m) => s + m.value, 0);
    if (added.length && a.balance != null && a.balance - addedTotal > RESIDUAL_MIN) {
      lines.push({
        key: `a:${a.id}`, securityId: null, accountId: a.id, account: account, institution: a.institution, taxType,
        assetType: (a.asset_type as AssetType) || accountAssetType(a), name: `${account} (rest)`, ticker: null,
        quantity: null, price: null, value: a.balance - addedTotal, costBasis: null, kind: "account",
        note: "Balance not covered by holdings you added",
      });
    }
    if (!mine.length && !added.length && a.balance != null) {
      lines.push({
        key: `a:${a.id}`, securityId: null, accountId: a.id, account, institution: a.institution, taxType,
        // Investment details are on but the broker lists nothing: what's there is cash.
        assetType: (a.asset_type as AssetType) || (a.investments_enabled ? "cash" : accountAssetType(a)), name: account, ticker: null,
        quantity: null, price: null, value: a.balance, costBasis: null, kind: "account",
        note: a.source === "manual" ? "Manual account" : a.investments_enabled ? "No holdings listed, counted as cash" : "Holdings not shared yet",
      });
    }
    if (a.source === "manual") for (let i = start; i < lines.length; i++) lines[i].manualAccount = true;
  }
  return lines;
}

// ---------- Daily snapshots (IN-6) ----------

/** Save today's value of every holding (and every one-line account). Re-running the same day overwrites today. */
export async function snapshotHoldings(db: Db, asOf = today()) {
  const lines = await portfolio(db);
  await db.tx(async (tx) => {
    await tx.run("DELETE FROM holding_snapshots WHERE as_of = ?", [asOf]);
    for (const l of lines) {
      await tx.run(
        `INSERT INTO holding_snapshots (as_of, account_id, holding_key, quantity, price, value, cost_basis)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of, account_id, holding_key) DO UPDATE SET value = value + excluded.value`,
        [asOf, l.accountId, l.securityId ?? `account:${l.accountId}`, l.quantity, l.price, l.value, l.costBasis],
      );
    }
  });
  return lines.length;
}

// ---------- Summary (IN-8) ----------

export async function investmentSummary(db: Db, lines: HoldingLine[], asOfToday = today()) {
  const total = lines.reduce((s, l) => s + l.value, 0);
  // Cash has no gain, so it's left out of both the gain and the "no cost basis" amount.
  const invested = lines.filter((l) => l.assetType !== "cash");
  const withBasis = invested.filter((l) => l.costBasis != null);
  const gain = withBasis.reduce((s, l) => s + (l.value - (l.costBasis ?? 0)), 0);
  const basis = withBasis.reduce((s, l) => s + (l.costBasis ?? 0), 0);
  const noBasisValue = invested.filter((l) => l.costBasis == null).reduce((s, l) => s + l.value, 0);

  const monthEnd = previousMonthEnds(asOfToday, 1)[0];
  const snap = await db.get<{ as_of: string; total: number }>(
    `SELECT as_of, SUM(value) AS total FROM holding_snapshots
      WHERE as_of = (SELECT MAX(as_of) FROM holding_snapshots WHERE as_of <= ?) GROUP BY as_of`, [monthEnd]);

  const year = asOfToday.slice(0, 4);
  const div = await db.get<{ total: number | null; n: number }>(
    `SELECT SUM(amount) AS total, COUNT(*) AS n FROM investment_transactions
      WHERE date >= ? AND date <= ? AND (subtype LIKE '%dividend%' AND type <> 'buy')`, [`${year}-01-01`, asOfToday]);
  const firstTxn = (await db.get<{ d: string | null }>("SELECT MIN(date) AS d FROM investment_transactions"))?.d ?? null;
  const anyTxns = !!firstTxn;

  return {
    total,
    change: snap ? { since: snap.as_of, amount: total - snap.total, pct: snap.total ? ((total - snap.total) / Math.abs(snap.total)) * 100 : null } : null,
    firstMonthEnd: monthEndOf(asOfToday),
    gain: withBasis.length ? { amount: gain, pct: basis ? (gain / basis) * 100 : null } : null,
    noBasisValue,
    dividends: anyTxns ? div?.total ?? 0 : null,
    dividendCount: div?.n ?? 0,
    activitySince: firstTxn,
  };
}


/** Connections that hold investment accounts, for the consent button (IN-2). */
export async function investmentConnections(db: Db) {
  return db.all<{ id: string; investments_enabled: number; investments_error: string | null }>(`
    SELECT DISTINCT c.id, c.investments_enabled, c.investments_error FROM connections c
      JOIN accounts a ON a.connection_id = c.id WHERE c.provider = 'plaid' AND a.type = 'investment'`);
}

// ---------- Manual holdings (IN-7) ----------

export interface ManualHoldingInput {
  id?: string; accountId: string; name: string; ticker?: string | null; quantity?: number | null; valueCents: number; assetType: AssetType;
}

/** Add or edit a holding inside a manual account. Plaid accounts get their holdings from the broker. */
export async function saveManualHolding(db: Db, h: ManualHoldingInput) {
  const acct = await db.get<{ source: string }>("SELECT source FROM accounts WHERE id = ?", [h.accountId]);
  if (!acct) throw new Error("Unknown account");
  if (acct.source !== "manual") throw new Error("Holdings can only be added to accounts you track by hand");
  if (!h.name.trim()) throw new Error("Add a name");
  if (!Number.isFinite(h.valueCents) || h.valueCents < 0) throw new Error("Add a value of $0 or more");
  if (h.quantity != null && (!Number.isFinite(h.quantity) || h.quantity < 0)) throw new Error("Shares must be a positive number");
  const ticker = h.ticker?.trim().toUpperCase() || null;
  if (h.id) {
    const r = await db.run(
      "UPDATE manual_holdings SET account_id = ?, name = ?, ticker = ?, quantity = ?, value = ?, asset_type = ?, updated_at = ? WHERE id = ?",
      [h.accountId, h.name.trim(), ticker, h.quantity ?? null, Math.round(h.valueCents), h.assetType, nowIso(), h.id]);
    if (!r.changes) throw new Error("Holding not found");
  } else {
    h.id = newId();
    await db.run(
      "INSERT INTO manual_holdings (id, account_id, name, ticker, quantity, value, asset_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [h.id, h.accountId, h.name.trim(), ticker, h.quantity ?? null, Math.round(h.valueCents), h.assetType, nowIso(), nowIso()]);
  }
  await snapshotHoldings(db);
  return h.id;
}

export async function deleteManualHolding(db: Db, id: string) {
  await db.run("DELETE FROM manual_holdings WHERE id = ?", [id]);
  await snapshotHoldings(db);
}

export async function listManualHoldings(db: Db) {
  return db.all<{ id: string; account_id: string; name: string; ticker: string | null; quantity: number | null; value: number; asset_type: AssetType }>(
    "SELECT id, account_id, name, ticker, quantity, value, asset_type FROM manual_holdings");
}

// ---------- Value over time (IN-14) ----------

const isQuarterEnd = (d: string) => ["03-31", "06-30", "09-30", "12-31"].includes(d.slice(5));
const QUARTERS_NEEDED = 3; // same rule as the net worth chart (OV-3)

/**
 * Total value at each completed quarter-end, from real snapshots only. A quarter-end counts when there's a
 * snapshot in the 31 days before it. `appearsOn` is the quarter-end that unlocks the chart.
 */
export async function investmentQuarters(db: Db, asOfToday = today()) {
  const days = await db.all<{ as_of: string; total: number }>(
    "SELECT as_of, SUM(value) AS total FROM holding_snapshots WHERE as_of < ? GROUP BY as_of ORDER BY as_of", [asOfToday]);
  const first = days[0]?.as_of ?? asOfToday;
  const ends: string[] = [];
  for (let d = monthEndOf(first); d < asOfToday; d = monthEndOf(shiftDate(d, 1))) if (isQuarterEnd(d)) ends.push(d);
  const points = ends.flatMap((q) => {
    const snap = [...days].reverse().find((x) => x.as_of <= q && x.as_of >= shiftDate(q, -31));
    return snap ? [{ date: q, value: snap.total, estimate: false }] : [];
  });
  if (points.length >= QUARTERS_NEEDED) return { points, appearsOn: null as string | null };
  let d = monthEndOf(points.length ? shiftDate(points[points.length - 1].date, 1) : first);
  let n = points.length;
  for (;;) {
    if (isQuarterEnd(d) && d >= asOfToday) { n++; if (n >= QUARTERS_NEEDED) break; }
    d = monthEndOf(shiftDate(d, 1));
  }
  return { points: [] as typeof points, appearsOn: d };
}

// ---------- Activity (IN-15) ----------

export type ActivityKind = "buy" | "sell" | "dividend" | "contribution" | "fee" | "other";

/** Plaid investment transaction type/subtype → the activity filter it belongs to. */
export function activityKind(type: string, subtype: string | null): ActivityKind {
  const sub = (subtype ?? "").toLowerCase();
  if (type === "buy") return "buy";
  if (type === "sell") return "sell";
  if (type === "fee" || sub.includes("fee")) return "fee";
  if (sub.includes("dividend") && type !== "buy") return "dividend";
  if (type === "transfer" || ["deposit", "contribution", "withdrawal", "transfer"].some((k) => sub.includes(k))) return "contribution";
  return "other";
}

export interface ActivityRow {
  id: string; date: string; account: string; name: string; ticker: string | null; kind: ActivityKind;
  quantity: number | null; price: number | null; amount: number;
}

export async function investmentActivity(db: Db): Promise<ActivityRow[]> {
  const rows = await db.all<{
    id: string; date: string; name: string; type: string; subtype: string | null; quantity: number | null; price: number | null;
    amount: number; ticker: string | null; acct_name: string; display_name: string | null; mask: string | null;
  }>(`SELECT t.id, t.date, t.name, t.type, t.subtype, t.quantity, t.price, t.amount, s.ticker,
             a.name AS acct_name, a.display_name, a.mask
        FROM investment_transactions t JOIN accounts a ON a.id = t.account_id
        LEFT JOIN securities s ON s.id = t.security_id
       ORDER BY t.date DESC, t.id`);
  return rows.map((r) => ({
    id: r.id, date: r.date, account: accountLabel({ name: r.acct_name, display_name: r.display_name, mask: r.mask }),
    name: r.name, ticker: realTicker(r.ticker), kind: activityKind(r.type, r.subtype),
    quantity: r.quantity || null, price: r.price || null, amount: r.amount,
  }));
}

// ---------- Weekly values (change chart) ----------

export interface WeekPoint { weekEnd: string; date: string | null; value: number | null }

/** Sunday that ends the week containing `iso` (weeks run Monday–Sunday). */
export function weekEndOf(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return shiftDate(iso, (7 - d.getDay()) % 7);
}

/**
 * One point per week from the first snapshot to this week: the last saved value in that week.
 * Weeks with no snapshot stay empty (null), so the chart shows a gap instead of a guess.
 */
export async function weeklyValues(db: Db, asOfToday = today(), maxWeeks = 52): Promise<WeekPoint[]> {
  const days = await db.all<{ as_of: string; total: number }>(
    "SELECT as_of, SUM(value) AS total FROM holding_snapshots WHERE as_of <= ? GROUP BY as_of ORDER BY as_of", [asOfToday]);
  if (!days.length) return [];
  const last = weekEndOf(asOfToday);
  let w = weekEndOf(days[0].as_of);
  const earliest = shiftDate(last, -7 * (maxWeeks - 1));
  if (w < earliest) w = earliest;
  const out: WeekPoint[] = [];
  for (; w <= last; w = shiftDate(w, 7)) {
    const inWeek = days.filter((d) => d.as_of <= w && d.as_of > shiftDate(w, -7));
    const pick = inWeek[inWeek.length - 1];
    out.push({ weekEnd: w, date: pick?.as_of ?? null, value: pick?.total ?? null });
  }
  return out;
}
