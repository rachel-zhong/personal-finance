/**
 * Net worth history (net_worth_snapshots).
 *
 * Rebuilt from scratch after every sync and every settings change, so the trend always
 * reflects your CURRENT choices (which accounts count, money held for others).
 *
 * For each month-end (back to your earliest transaction), each account's value is:
 *   - a saved balance: its latest balance snapshot on or before that date, or
 *   - bank & card accounts before their first snapshot: rebuilt from your transactions, which is exact
 *     as long as the bank sent the full history (treated as real, not an estimate)
 *   - Treasury (a manual account): rebuilt from the TreasuryDirect transfers and maturity payments in your
 *     bank transactions, which is real (interest on the bills is ignored)
 *   - a brokerage named after a supported platform (Robinhood, Schwab, Vanguard, …): today's balance minus what
 *     you moved in from your bank since (market growth ignored, so an estimate)
 *   - other investment & manual accounts before their first record: spread evenly from zero at the start of
 *     the history up to the first known balance (an estimate). Dated manual entries replace the estimate.
 * A point is marked is_estimate when any such estimated balance is part of it.
 */
import { Db, newId, nowIso, today } from "./db";
import { groupFor, Group } from "./groups";
import { myShare } from "./queries";
import { shiftDate } from "./refunds/matcher";

interface Acct {
  id: string; type: string; subtype: string | null; name: string; source: string; account_group: string | null;
  include_in_net_worth: number; net_worth_held_for_others: number; net_worth_held_mode: string;
}

/**
 * Accounts whose past can be rebuilt from the bank transactions that fund them.
 * `exact`: the transactions are the whole story (Treasury bills), so it isn't marked as an estimate.
 */
const LINKED: { test: RegExp; merchants: string[]; exact: boolean }[] = [
  { test: /treasur/i, merchants: ["treasurydirect", "apa treas misc pay"], exact: true },
  ...["robinhood", "schwab", "vanguard", "fidelity", "etrade", "wealthfront", "betterment"]
    .map((m) => ({ test: new RegExp(m, "i"), merchants: [m], exact: false })),
];
// Retirement accounts are funded by payroll, not bank transfers, so they're never linked.
const linkFor = (a: { name: string; type: string; subtype: string | null; account_group: string | null }) =>
  groupFor(a) === "retire" ? undefined : LINKED.find((l) => l.test.test(a.name));

const BACKCALC_TYPES = new Set(["depository", "credit"]);
const BACKCALC_SOURCES = new Set(["plaid", "csv", "simplefin"]);

export function monthEnd(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month
}
export function previousMonthEnds(fromIso: string, count: number) {
  const out: string[] = [];
  let d = shiftDate(fromIso.slice(0, 8) + "01", -1); // last day of previous month
  for (let i = 0; i < count; i++) {
    out.push(d);
    d = shiftDate(d.slice(0, 8) + "01", -1);
  }
  return out.reverse();
}

/** Whole months from a to b (by calendar month). */
function monthsBetween(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}

export async function rebuildNetWorthSnapshots(db: Db, asOfToday = today()) {
  const accts = await db.all<Acct>(
    "SELECT id, type, subtype, name, source, account_group, include_in_net_worth, net_worth_held_for_others, net_worth_held_mode FROM accounts",
  );
  const snaps = await db.all<{ account_id: string; as_of: string; balance: number }>(
    "SELECT account_id, as_of, balance FROM balance_snapshots ORDER BY as_of",
  );
  const txns = await db.all<{ account_id: string; date: string; amount: number }>(
    "SELECT account_id, date, amount FROM transactions WHERE removed = 0 AND pending = 0 ORDER BY date",
  );

  const linkedTxns = await db.all<{ date: string; amount: number; merchant_norm: string }>(
    "SELECT date, amount, merchant_norm FROM transactions WHERE removed = 0 AND pending = 0 AND merchant_norm IS NOT NULL ORDER BY date",
  );
  let rampStart = asOfToday; // set once the dates are known

  const snapsBy = new Map<string, { as_of: string; balance: number }[]>();
  for (const s of snaps) snapsBy.set(s.account_id, [...(snapsBy.get(s.account_id) ?? []), s]);
  const txnsBy = new Map<string, { date: string; amount: number }[]>();
  for (const t of txns) txnsBy.set(t.account_id, [...(txnsBy.get(t.account_id) ?? []), t]);

  function valueAt(a: Acct, date: string): { v: number; est: boolean } | null {
    const list = snapsBy.get(a.id);
    if (!list?.length) return null;
    let latest: { as_of: string; balance: number } | null = null;
    for (const s of list) { if (s.as_of <= date) latest = s; else break; }
    if (latest) return { v: latest.balance, est: false };
    const anchor = list[0];
    if (BACKCALC_TYPES.has(a.type) && BACKCALC_SOURCES.has(a.source)) {
      // Sum of money in/out between `date` (exclusive) and the anchor (inclusive).
      let flow = 0;
      for (const t of txnsBy.get(a.id) ?? []) if (t.date > date && t.date <= anchor.as_of) flow += t.amount;
      // Bank: balance_then = balance_now - flow. Card (balance = owed): owed_then = owed_now + flow.
      return { v: a.type === "credit" ? anchor.balance + flow : anchor.balance - flow, est: false };
    }
    const link = linkFor(a);
    if (link) {
      // Money you sent in after `date` wasn't there yet. Inflow to the account = outflow from your bank.
      let moved = 0;
      for (const t of linkedTxns) if (link.merchants.includes(t.merchant_norm) && t.date > date && t.date <= anchor.as_of) moved += -t.amount;
      return { v: Math.max(0, anchor.balance - moved), est: !link.exact };
    }
    // No history at all: grow evenly from zero at the start of the history to the first known balance.
    const span = Date.parse(anchor.as_of) - Date.parse(rampStart);
    const frac = span > 0 ? Math.min(1, Math.max(0, (Date.parse(date) - Date.parse(rampStart)) / span)) : 1;
    return { v: Math.round(anchor.balance * frac), est: true };
  }

  const actualDates = [...new Set(snaps.map((s) => s.as_of))];
  // Every month-end from your earliest transaction (at most 36 months back), plus every day a balance was saved.
  const firstTxn = txns.length ? txns[0].date : asOfToday;
  const monthsBack = Math.min(36, Math.max(1, monthsBetween(firstTxn, asOfToday)));
  const dates = [...new Set([...previousMonthEnds(asOfToday, monthsBack), ...actualDates])].sort();

  rampStart = dates[0];
  const rows = dates.map((d) => {
    const g: Record<Group, number> = { cash: 0, invest: 0, retire: 0, parents: 0, cards: 0 };
    let net = 0, est = false;
    for (const a of accts) {
      const r = valueAt(a, d);
      if (!r) continue;
      g[groupFor(a)] += r.v;
      const share = myShare({ ...a, balance: r.v });
      net += share;
      if (r.est && share !== 0) est = true;
    }
    return { d, net, g, est };
  });

  await db.tx(async (tx) => {
    await tx.run("DELETE FROM net_worth_snapshots");
    for (const r of rows) {
      await tx.run(
        `INSERT INTO net_worth_snapshots (id, as_of, net_worth, cash, parents, invest, retire, cards, is_estimate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), r.d, r.net, r.g.cash, r.g.parents, r.g.invest, r.g.retire, r.g.cards, r.est ? 1 : 0, nowIso()],
      );
    }
  });
  return rows.length;
}

export interface TrendPoint { date: string; value: number; estimate: boolean }

/** The last day of the month-end before `asOfToday` and the net worth saved on it, for "vs. Oct 31". */
export async function lastMonthEnd(db: Db, asOfToday = today()) {
  const d = previousMonthEnds(asOfToday, 1)[0];
  const r = await db.get<{ as_of: string; net_worth: number; is_estimate: number }>(
    "SELECT as_of, net_worth, is_estimate FROM net_worth_snapshots WHERE as_of = ?", [d]);
  return r ? { date: r.as_of, value: r.net_worth, estimate: !!r.is_estimate } : null;
}

const isQuarterEnd = (d: string) => ["03-31", "06-30", "09-30", "12-31"].includes(d.slice(5));
const QUARTERS_NEEDED = 3; // "more than 2 quarters": the chart appears with the 3rd quarter-end

/** First quarter-end on or after the given date. */
function nextQuarterEnd(fromIso: string) {
  let d = monthEnd(fromIso);
  while (!isQuarterEnd(d)) d = monthEnd(shiftDate(d, 1));
  return d;
}

/**
 * Quarter-end net worth for the chart (OV-1 to OV-3). Only completed quarter-ends count.
 * `appearsOn` is set while there is not enough data yet: the date of the quarter-end that unlocks the chart.
 */
export async function netWorthQuarters(db: Db, asOfToday = today()) {
  const rows = await db.all<{ as_of: string; net_worth: number; is_estimate: number }>(
    "SELECT as_of, net_worth, is_estimate FROM net_worth_snapshots WHERE as_of < ? ORDER BY as_of", [asOfToday]);
  const points: TrendPoint[] = rows.filter((r) => isQuarterEnd(r.as_of))
    .map((r) => ({ date: r.as_of, value: r.net_worth, estimate: !!r.is_estimate }));
  if (points.length >= QUARTERS_NEEDED) return { points, appearsOn: null as string | null };
  let d = points.length ? nextQuarterEnd(shiftDate(points[points.length - 1].date, 1)) : nextQuarterEnd(asOfToday);
  for (let n = points.length + 1; n < QUARTERS_NEEDED; n++) d = nextQuarterEnd(shiftDate(d, 1));
  return { points: [] as TrendPoint[], appearsOn: d };
}
