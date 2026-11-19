/** Read-side queries for the dashboard. */
import { Db } from "./db";
import { REVIEW_WORDS } from "./categories";

export const LIABILITY_TYPES = new Set(["credit", "loan"]);

export interface AccountRow {
  id: string;
  name: string;
  display_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  source: string;
  institution: string | null;
  include_in_net_worth: number;
  net_worth_held_for_others: number;
  net_worth_held_mode: string;
  net_worth_note: string | null;
  include_in_spending: number;
  account_group: string | null;
  balance: number | null;
  balance_as_of: string | null;
  connection_status: string | null;
  last_synced_at: string | null;
}

export async function listAccounts(db: Db): Promise<AccountRow[]> {
  return db.all<AccountRow>(`
    SELECT a.id, a.name, a.display_name, a.type, a.subtype, a.mask, a.source,
           i.name AS institution, a.include_in_net_worth, a.net_worth_held_for_others, a.net_worth_held_mode,
           a.net_worth_note, a.include_in_spending, a.account_group,
           b.balance, b.as_of AS balance_as_of,
           c.status AS connection_status, c.last_synced_at
      FROM accounts a
      LEFT JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN connections c ON c.id = a.connection_id
      LEFT JOIN balance_snapshots b ON b.account_id = a.id
            AND b.as_of = (SELECT MAX(as_of) FROM balance_snapshots b2 WHERE b2.account_id = a.id)
     ORDER BY i.name, a.type, a.name`);
}

export const accountLabel = (a: { display_name: string | null; name: string; mask?: string | null }) =>
  `${a.display_name || a.name}${a.mask ? ` ••${a.mask}` : ""}`;

type ShareFields = Pick<AccountRow, "type" | "balance" | "include_in_net_worth" | "net_worth_held_for_others"> &
  Partial<Pick<AccountRow, "net_worth_held_mode">>;

/**
 * Money in this account held for others (cents): the whole balance in "all" mode,
 * otherwise the fixed amount capped at the balance. Zero for hidden accounts and cards.
 */
export function heldFor(a: ShareFields) {
  if (a.balance == null || !a.include_in_net_worth || LIABILITY_TYPES.has(a.type)) return 0;
  const bal = Math.max(a.balance, 0);
  if (a.net_worth_held_mode === "all") return bal;
  return Math.min(Math.max(a.net_worth_held_for_others, 0), bal);
}

/** Signed contribution of an account to YOUR net worth (cents). */
export function myShare(a: ShareFields) {
  if (a.balance == null) return 0;
  const sign = LIABILITY_TYPES.has(a.type) ? -1 : 1;
  if (!a.include_in_net_worth) return 0;
  return sign * a.balance - heldFor(a);
}
export function fullValue(a: Pick<AccountRow, "type" | "balance">) {
  if (a.balance == null) return 0;
  return (LIABILITY_TYPES.has(a.type) ? -1 : 1) * a.balance;
}

export async function netWorthSummary(db: Db) {
  const accounts = await listAccounts(db);
  let assets = 0, liabilities = 0, notMine = 0;
  for (const a of accounts) {
    const mine = myShare(a);
    if (mine >= 0) assets += mine; else liabilities += -mine;
    notMine += fullValue(a) - mine;
  }
  return { accounts, assets, liabilities, netWorth: assets - liabilities, notMine };
}

/** Net worth over time: each day's total uses every account's latest snapshot on or before that day. */
export async function netWorthHistory(db: Db) {
  const accts = await db.all<{ id: string; type: string; include_in_net_worth: number; net_worth_held_for_others: number }>(
    "SELECT id, type, include_in_net_worth, net_worth_held_for_others FROM accounts",
  );
  const snaps = await db.all<{ account_id: string; as_of: string; balance: number }>(
    "SELECT account_id, as_of, balance FROM balance_snapshots ORDER BY as_of",
  );
  const byId = new Map(accts.map((a) => [a.id, a]));
  const latest = new Map<string, number>();
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    latest.set(s.account_id, s.balance);
    if (i < snaps.length - 1 && snaps[i + 1].as_of === s.as_of) continue;
    let total = 0;
    for (const [id, bal] of latest) {
      const a = byId.get(id);
      if (a) total += myShare({ ...a, balance: bal });
    }
    out.push({ date: s.as_of, value: total });
  }
  return out;
}

export interface TxnFilters {
  account?: string;
  from?: string;
  to?: string;
  min?: number; // dollars, compared to |amount|
  max?: number;
  q?: string;
  dir?: "in" | "out"; // money in (amount > 0) or money out (amount < 0); credit card payments are left out
  type?: "refunds" | "unmatched" | "review"; // refunds (not paybacks), only those still to match, or money in to review as paybacks
  cat?: string; // app category key
  spendingOnly?: boolean; // only rows that count in spending (purchases and refunds)
  ids?: string[]; // only these transactions
}

// Paybacks and work reimbursements (same words as P2P_TEXT and REIMB_TEXT in lib/categories.ts)
const P2P_SQL = ["venmo", "zelle", "paypal", "cash app", "square cash", "apple cash", "expensify", "reimb", "concur", "navan"]
  .map((w) => `LOWER(COALESCE(t.merchant,'') || ' ' || COALESCE(t.description,'')) LIKE '%${w}%'`).join(" OR ");

// Money in counted as income that may really be a payback, reimbursement or your own cash (REVIEW_WORDS in lib/categories.ts)
const REVIEW_SQL = REVIEW_WORDS
  .map((w) => `LOWER(COALESCE(t.merchant,'') || ' ' || COALESCE(t.description,'')) LIKE '%${w}%'`).join(" OR ");

/** How many transactions each type button would show under the other filters (type and direction ignored). */
export async function txnTypeCounts(db: Db, f: TxnFilters) {
  const base = { ...f, dir: undefined, type: undefined };
  const count = async (extra: Pick<TxnFilters, "dir" | "type">) => {
    const { where, params } = txnWhere({ ...base, ...extra });
    return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions t WHERE ${where}`, params))?.n ?? 0;
  };
  return {
    all: await count({}), in: await count({ dir: "in" }), out: await count({ dir: "out" }),
    refunds: await count({ type: "refunds" }), unmatched: await count({ type: "unmatched" }), review: await count({ type: "review" }),
  };
}

function txnWhere(f: TxnFilters) {
  const where = ["t.removed = 0"];
  const params: (string | number)[] = [];
  if (f.account) { where.push("t.account_id = ?"); params.push(f.account); }
  if (f.from) { where.push("t.date >= ?"); params.push(f.from); }
  if (f.to) { where.push("t.date <= ?"); params.push(f.to); }
  if (f.min != null && !Number.isNaN(f.min)) { where.push("ABS(t.amount) >= ?"); params.push(Math.round(f.min * 100)); }
  if (f.max != null && !Number.isNaN(f.max)) { where.push("ABS(t.amount) <= ?"); params.push(Math.round(f.max * 100)); }
  if (f.dir === "in") where.push("t.amount > 0 AND COALESCE(t.app_category, '') <> 'card_payment'");
  if (f.dir === "out") where.push("t.amount < 0 AND COALESCE(t.app_category, '') <> 'card_payment'");
  if (f.type === "review") {
    where.push(`t.flow = 'income' AND t.amount > 0 AND (${REVIEW_SQL})`);
  } else if (f.type) {
    // Venmo, Zelle etc. paying you back isn't a store refund (same rule as isPayback in lib/categories.ts)
    where.push(`t.flow = 'refund' AND NOT (${P2P_SQL})`);
    if (f.type === "unmatched") where.push("t.amount - COALESCE((SELECT applied FROM refund_applied WHERE refund_id = t.id), 0) > 0");
  }
  if (f.cat) { where.push("t.app_category = ?"); params.push(f.cat); }
  if (f.spendingOnly) where.push("t.flow IN ('spend', 'refund')");
  if (f.ids) {
    if (!f.ids.length) where.push("1 = 0");
    else { where.push(`t.id IN (${f.ids.map(() => "?").join(", ")})`); params.push(...f.ids); }
  }
  if (f.q) {
    where.push("LOWER(COALESCE(t.merchant,'') || ' ' || COALESCE(t.description,'') || ' ' || COALESCE(t.app_category,'')) LIKE ?");
    params.push(`%${f.q.toLowerCase()}%`);
  }
  return { where: where.join(" AND "), params };
}

/**
 * Totals for everything matching the filters (not just the rows shown).
 * Net view counts each row the way it's displayed: purchases net of matched refunds,
 * refunds only for the part not already applied to a purchase.
 */
export async function txnSubtotals(db: Db, f: TxnFilters, view: "net" | "raw") {
  const { where, params } = txnWhere(f);
  const shown = view === "raw"
    ? "t.amount"
    : `CASE WHEN t.flow = 'spend' THEN t.amount + COALESCE(p.refunded, 0)
            WHEN t.flow = 'refund' THEN t.amount - COALESCE(ra.applied, 0)
            ELSE t.amount END`;
  const r = await db.get<{ n: number; moneyIn: number; moneyOut: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN x.v > 0 THEN x.v END), 0) AS moneyIn,
            COALESCE(SUM(CASE WHEN x.v < 0 THEN x.v END), 0) AS moneyOut
       FROM (SELECT ${shown} AS v
               FROM transactions t
               LEFT JOIN purchase_refunded p ON p.purchase_id = t.id
               LEFT JOIN refund_applied ra ON ra.refund_id = t.id
              WHERE ${where}) x`,
    params,
  );
  return { count: r?.n ?? 0, moneyIn: r?.moneyIn ?? 0, moneyOut: r?.moneyOut ?? 0, net: (r?.moneyIn ?? 0) + (r?.moneyOut ?? 0) };
}

/**
 * Balance right after each posted transaction, walked backward (and forward) from the account's
 * latest known balance. Same-day order follows the list order (date, id), so it's an estimate.
 * Cards/loans return the amount owed. Pending transactions get no balance (banks exclude them).
 */
export async function runningBalances(db: Db, accountIds: string[]) {
  const out = new Map<string, number>();
  for (const accountId of [...new Set(accountIds)]) {
    const acct = await db.get<{ type: string; balance: number | null; as_of: string | null }>(
      `SELECT a.type, b.balance, b.as_of FROM accounts a
         LEFT JOIN balance_snapshots b ON b.account_id = a.id
              AND b.as_of = (SELECT MAX(as_of) FROM balance_snapshots b2 WHERE b2.account_id = a.id)
        WHERE a.id = ?`, [accountId]);
    if (!acct || acct.balance == null || !acct.as_of) continue;
    const txns = await db.all<{ id: string; date: string; amount: number }>(
      `SELECT id, date, amount FROM transactions
        WHERE account_id = ? AND removed = 0 AND pending = 0
        ORDER BY date, id DESC`, [accountId]); // oldest first; reverse of the list's (date DESC, id) order
    const owed = LIABILITY_TYPES.has(acct.type);
    // k = last transaction on or before the balance date
    let k = -1;
    for (let i = 0; i < txns.length; i++) if (txns[i].date <= acct.as_of) k = i;
    // money in raises a bank balance and lowers what's owed on a card
    const effect = (amt: number) => (owed ? -amt : amt);
    let bal = acct.balance;
    for (let i = k; i >= 0; i--) { out.set(txns[i].id, bal); bal -= effect(txns[i].amount); }
    bal = acct.balance;
    for (let i = k + 1; i < txns.length; i++) { bal += effect(txns[i].amount); out.set(txns[i].id, bal); }
  }
  return out;
}

export interface TxnRow {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  category: string | null;
  pending: number;
  flow: string;
  source: string;
  account_id: string;
  account_name: string;
  refunded: number; // for purchases: total matched refunds
  applied: number; // for refunds: total applied to purchases
  ignored: number;
  ruled: number; // 1 = category set by your merchant rule
  overridden: number; // 1 = category set by you on this transaction
  merchant_count: number; // transactions from this merchant in the same direction
  excluded: number; // 1 = you left it out of income, spending and savings
  exclusion_kind: string | null; // 'exclude' | 'keep_in_net_worth'
}

export async function listTransactions(db: Db, f: TxnFilters, limit = 1000) {
  const { where, params } = txnWhere(f);
  const sql = `
    SELECT t.id, t.date, t.amount, t.merchant, t.description, t.app_category AS category,
           t.pending, t.flow, t.source,
           CASE WHEN cr.merchant_norm IS NULL THEN 0 ELSE 1 END AS ruled,
           CASE WHEN co.txn_id IS NULL THEN 0 ELSE 1 END AS overridden,
           CASE WHEN ex.txn_id IS NULL THEN 0 ELSE 1 END AS excluded, ex.kind AS exclusion_kind,
           (SELECT COUNT(*) FROM transactions t2 WHERE t2.merchant_norm = t.merchant_norm AND t2.removed = 0
               AND (t2.amount < 0) = (t.amount < 0)) AS merchant_count,
           t.account_id, COALESCE(a.display_name, a.name) || COALESCE(' ••' || a.mask, '') AS account_name,
           COALESCE(p.refunded, 0) AS refunded, COALESCE(ra.applied, 0) AS applied,
           CASE WHEN ig.refund_id IS NULL THEN 0 ELSE 1 END AS ignored
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN purchase_refunded p ON p.purchase_id = t.id
      LEFT JOIN refund_applied ra ON ra.refund_id = t.id
      LEFT JOIN refund_ignores ig ON ig.refund_id = t.id
      LEFT JOIN category_rules cr ON cr.merchant_norm = t.merchant_norm
            AND cr.direction = CASE WHEN t.amount < 0 THEN 'out' ELSE 'in' END
      LEFT JOIN category_overrides co ON co.txn_id = t.id
      LEFT JOIN txn_exclusions ex ON ex.txn_id = t.id
     WHERE ${where}
     ORDER BY t.date DESC, t.id
     LIMIT ${limit + 1}`;
  const rows = await db.all<TxnRow>(sql, params);
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export interface MatchRow {
  id: string;
  refund_id: string;
  purchase_id: string;
  amount_applied: number;
  matched_by: string;
  confidence: number | null;
  other_date: string;
  other_amount: number;
  other_desc: string;
  other_account: string;
}

/** All refund links touching the given transactions, from each side's point of view. */
export async function matchesFor(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, MatchRow[]>();
  const out = new Map<string, MatchRow[]>();
  const chunk = 400;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const ph = part.map(() => "?").join(",");
    const rows = await db.all<MatchRow & { anchor: string }>(
      `SELECT m.id, m.refund_id, m.purchase_id, m.amount_applied, m.matched_by, m.confidence,
              m.purchase_id AS anchor, r.date AS other_date, r.amount AS other_amount,
              COALESCE(r.merchant, r.description) AS other_desc, COALESCE(ra.display_name, ra.name) AS other_account
         FROM refund_matches m JOIN transactions r ON r.id = m.refund_id JOIN accounts ra ON ra.id = r.account_id
        WHERE m.purchase_id IN (${ph})
       UNION ALL
       SELECT m.id, m.refund_id, m.purchase_id, m.amount_applied, m.matched_by, m.confidence,
              m.refund_id AS anchor, p.date, p.amount, COALESCE(p.merchant, p.description), COALESCE(pa.display_name, pa.name)
         FROM refund_matches m JOIN transactions p ON p.id = m.purchase_id JOIN accounts pa ON pa.id = p.account_id
        WHERE m.refund_id IN (${ph})`,
      [...part, ...part],
    );
    for (const r of rows) {
      const list = out.get(r.anchor) ?? [];
      list.push(r);
      out.set(r.anchor, list);
    }
  }
  return out;
}

export async function monthlySpending(db: Db, months = 24) {
  const rows = await db.all<{ month: string; net: number; gross: number; refunded: number }>(
    `SELECT month, SUM(net) AS net, SUM(gross) AS gross,
            SUM(refunded) AS refunded
       FROM net_spending WHERE include_in_spending = 1
      GROUP BY month ORDER BY month DESC LIMIT ?`,
    [months],
  );
  return rows.reverse();
}

export async function categorySpending(db: Db, month: string) {
  return db.all<{ category: string; net: number }>(
    `SELECT COALESCE(category, 'Uncategorized') AS category, SUM(net) AS net
       FROM net_spending WHERE include_in_spending = 1 AND month = ?
      GROUP BY COALESCE(category, 'Uncategorized') ORDER BY net DESC`,
    [month],
  );
}

export async function listConnections(db: Db) {
  return db.all<{
    id: string; provider: string; institution: string | null; status: string;
    last_synced_at: string | null; last_error: string | null; account_count: number;
  }>(`
    SELECT c.id, c.provider, i.name AS institution, c.status, c.last_synced_at, c.last_error,
           (SELECT COUNT(*) FROM accounts a WHERE a.connection_id = c.id) AS account_count
      FROM connections c LEFT JOIN institutions i ON i.id = c.institution_id
     ORDER BY c.created_at`);
}

export interface ManualAccountGroup {
  id: string;
  name: string;
  type: string;
  include_in_net_worth: number;
  entries: { id: string; as_of: string; balance: number; note: string | null; created_at: string }[];
}

/** Manual accounts with their full entry history, newest first. */
export async function listManualAccounts(db: Db): Promise<ManualAccountGroup[]> {
  const accts = await db.all<Omit<ManualAccountGroup, "entries">>(
    "SELECT id, COALESCE(display_name, name) AS name, type, include_in_net_worth FROM accounts WHERE source = 'manual' ORDER BY name",
  );
  const entries = await db.all<ManualAccountGroup["entries"][number] & { account_id: string }>(
    "SELECT id, account_id, as_of, balance, note, created_at FROM manual_entries ORDER BY as_of DESC, created_at DESC",
  );
  return accts.map((a) => ({ ...a, entries: entries.filter((e) => e.account_id === a.id) }));
}

/** Last `n` months (YYYY-MM) ending with the current month. */
export function lastMonths(n: number, now = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Category breakdown with purchase counts and returns, from net_spending. */
export async function categoryDetail(db: Db, month: string) {
  return db.all<{ category: string; net: number; purchases: number; returned: number }>(
    `SELECT COALESCE(category, 'Uncategorized') AS category, SUM(net) AS net,
            COUNT(CASE WHEN kind = 'purchase' THEN 1 END) AS purchases, SUM(refunded) AS returned
       FROM net_spending WHERE include_in_spending = 1 AND month = ?
      GROUP BY COALESCE(category, 'Uncategorized') ORDER BY net DESC`,
    [month],
  );
}

/**
 * Income per month: paychecks, interest, dividends (flow = income). Transfers between your own
 * accounts aren't income. Leaves out accounts excluded from spending or held entirely for others.
 */
/** Interest received per month (part of income, shown separately). */
export async function monthlyInterest(db: Db) {
  return db.all<{ month: string; interest: number }>(
    `SELECT substr(t.date, 1, 7) AS month, SUM(t.amount) AS interest
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.flow = 'income' AND t.removed = 0 AND t.amount > 0
        AND a.include_in_spending = 1 AND a.net_worth_held_mode <> 'all'
        AND LOWER(COALESCE(t.merchant,'') || ' ' || COALESCE(t.description,'')) LIKE '%interest%'
      GROUP BY substr(t.date, 1, 7)`,
  );
}

export async function monthlyIncome(db: Db) {
  return db.all<{ month: string; income: number }>(
    `SELECT substr(t.date, 1, 7) AS month, SUM(t.amount) AS income
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.flow = 'income' AND t.removed = 0 AND t.amount > 0
        AND a.include_in_spending = 1 AND a.net_worth_held_mode <> 'all'
      GROUP BY substr(t.date, 1, 7)`,
  );
}

/** Accounts whose transaction history starts after `since`, so early months may be incomplete. */
export async function historyGaps(db: Db, since: string) {
  return db.all<{ name: string; first: string }>(
    `SELECT COALESCE(a.display_name, a.name) || COALESCE(' ••' || a.mask, '') AS name, MIN(t.date) AS first
       FROM accounts a JOIN transactions t ON t.account_id = a.id
      -- only accounts you spend from (cards, checking); savings/CDs opened later aren't gaps
      WHERE a.include_in_spending = 1 AND (a.type = 'credit' OR a.subtype = 'checking') AND t.removed = 0
      GROUP BY a.id HAVING MIN(t.date) > ? ORDER BY first`,
    [since],
  );
}

/**
 * How much of each refund counts as "returned" in `month`, matching the month's spending numbers:
 * the part applied to purchases made that month (wherever the refund landed), plus the unmatched
 * part of refunds received that month. Also lists refunds received in other months that count here.
 */
export async function monthReturns(db: Db, month: string) {
  const applied = await db.all<{ refund_id: string; amt: number; rdate: string }>(
    `SELECT m.refund_id, SUM(m.amount_applied) AS amt, r.date AS rdate
       FROM refund_matches m JOIN transactions p ON p.id = m.purchase_id JOIN transactions r ON r.id = m.refund_id
      WHERE substr(p.date, 1, 7) = ? AND p.removed = 0 AND r.removed = 0
      GROUP BY m.refund_id, r.date`, [month]);
  const unapplied = await db.all<{ id: string; amt: number }>(
    `SELECT t.id, t.amount - COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.refund_id = t.id), 0) AS amt
       FROM transactions t
      WHERE t.flow = 'refund' AND t.removed = 0 AND t.pending = 0 AND substr(t.date, 1, 7) = ?`, [month]);
  const counts = new Map<string, number>();
  for (const a of applied) counts.set(a.refund_id, (counts.get(a.refund_id) ?? 0) + a.amt);
  for (const u of unapplied) if (u.amt > 0) counts.set(u.id, (counts.get(u.id) ?? 0) + u.amt);
  const fromOtherMonths = applied.filter((a) => a.rdate.slice(0, 7) !== month).map((a) => a.refund_id);
  return { counts, fromOtherMonths };
}

/**
 * Money moved from your bank accounts into investments per month (Robinhood, TreasuryDirect...).
 * Only contributions count; selling investments back to cash (e.g. RSU sales) isn't savings.
 */
export async function monthlyInvested(db: Db) {
  return db.all<{ month: string; invested: number }>(
    `SELECT substr(t.date, 1, 7) AS month, SUM(-t.amount) AS invested
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.app_category = 'investments' AND t.amount < 0 AND t.removed = 0
        AND NOT EXISTS (SELECT 1 FROM txn_exclusions e WHERE e.txn_id = t.id)
        AND a.type = 'depository' AND a.include_in_spending = 1 AND a.net_worth_held_mode <> 'all'
      GROUP BY substr(t.date, 1, 7)`,
  );
}

export interface RecentTxn {
  id: string; date: string; amount: number; desc: string; account: string; pending: number;
  kind: "In" | "Out" | "Transfer";
}

/**
 * Latest transactions across all accounts (OV-6). Money moved between your own accounts
 * (including card payments and investment transfers) is labeled Transfer; everything else In or Out.
 */
export async function recentTransactions(db: Db, limit = 20): Promise<RecentTxn[]> {
  const rows = await db.all<{
    id: string; date: string; amount: number; merchant: string | null; description: string | null;
    flow: string; pending: number; excluded: number; account: string;
  }>(
    `SELECT t.id, t.date, t.amount, t.merchant, t.description, t.flow, t.pending,
            CASE WHEN ex.txn_id IS NULL THEN 0 ELSE 1 END AS excluded,
            COALESCE(a.display_name, a.name) || COALESCE(' ••' || a.mask, '') AS account
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN txn_exclusions ex ON ex.txn_id = t.id
      WHERE t.removed = 0
      ORDER BY t.date DESC, t.created_at DESC, t.id
      LIMIT ?`, [limit]);
  return rows.map((r) => ({
    id: r.id, date: r.date, amount: r.amount, account: r.account, pending: r.pending,
    desc: r.merchant || r.description || "Transaction",
    kind: r.flow === "transfer" && !r.excluded ? "Transfer" : r.amount < 0 ? "Out" : "In",
  }));
}
