/**
 * Read-side for the Compensation tab (CP). Groups follow the payroll provider's own YTD view:
 * Gross → Taxes → Benefits → Retirement → Other → take-home. RSU income and the shares kept are non-cash.
 */
import { Db } from "../db";

/** Where each line lands on the page. */
export type Group =
  | "earnings"      // cash pay
  | "rsu_income"    // stock income (non-cash)
  | "taxes"
  | "benefits"      // pre-tax health: HSA, FSA, medical, dental, vision
  | "retirement"    // 401(k), Roth 401(k), after-tax 401(k)
  | "other"         // other post-tax deductions (life insurance, workers' comp, ESPP)
  | "rsu_kept"      // value of RSU shares you kept (offsets RSU income)
  | "added";        // added to net pay but not income: reimbursements, stock sale payouts

export const GROUP_LABELS: Record<Group, string> = {
  earnings: "Cash pay", rsu_income: "RSU income", taxes: "Taxes", benefits: "Benefits", retirement: "Retirement",
  other: "Other deductions", rsu_kept: "Kept as shares", added: "Added to pay",
};

export function groupOf(l: { section: string; category: string }): Group | null {
  if (l.section === "employer") return null;
  if (l.section === "earnings") return l.category === "rsu" ? "rsu_income" : "earnings";
  if (l.section === "taxes") return "taxes";
  switch (l.category) {
    case "k401": case "roth_k401": case "aftertax_k401": return "retirement";
    case "hsa": case "fsa": case "medical": case "dental": case "vision": case "other_pretax": return "benefits";
    case "rsu_offset": return "rsu_kept";
    case "stock_proceeds": case "reimbursement": return "added";
    default: return "other";
  }
}

/** Friendlier names for payroll codes. The original label is kept for drill-down. Patterns stay generic (no employer or state names). */
const PRETTY: [RegExp, string][] = [
  [/^regular$/i, "Base salary"], [/^pto$/i, "Paid time off"], [/^rsu income$/i, "RSU income"], [/^hsa$/i, "HSA"],
  [/^401k$/i, "401(k)"], [/^den(tal)? pre ?tax$/i, "Dental"], [/^voluntary life$/i, "Voluntary life insurance"],
  [/\ballo(wance)?\b/i, "Allowance"], [/\breimb/i, "Reimbursement"], [/^stock proceeds$/i, "Stock sale payout"],
  [/\bl&i\b/i, "State workers' comp"], [/ltcare|long.?term care/i, "State long-term care"],
  [/paid family leave/i, "State paid family leave"], [/paid medical leave/i, "State paid medical leave"],
];
export function prettyLabel(label: string) {
  return PRETTY.find(([re]) => re.test(label.trim()))?.[1] ?? label;
}

export interface CompLine { label: string; group: Group; category: string; current: number; pretax: boolean; rate: number | null }

/** Row groups of the monthly table (CP-9): the order a pay statement reads in. */
export type TableGroup = "earnings" | "rsu_income" | "taxes" | "pretax" | "posttax" | "rsu_kept" | "added";
export const TABLE_LABELS: Record<TableGroup, string> = {
  earnings: "Cash earnings", rsu_income: "RSU income", taxes: "Taxes", pretax: "Pre-tax deductions", posttax: "Post-tax deductions",
  rsu_kept: "RSU kept as shares", added: "Added to pay",
};
export function tableGroupOf(l: CompLine): TableGroup {
  if (l.group === "earnings") return "earnings";
  if (l.group === "rsu_income" || l.group === "rsu_kept") return l.group;
  if (l.group === "taxes") return "taxes";
  if (l.group === "added") return "added";
  return l.pretax ? "pretax" : "posttax";
}
export const isNonCash = (l: { group: Group }) => l.group === "rsu_income" || l.group === "rsu_kept";
export interface CompStatement {
  id: string; payDate: string; periodEnd: string; kind: "paycheck" | "vest" | "payout";
  gross: number; net: number; lines: CompLine[];
}

export async function compStatements(db: Db, year: string): Promise<CompStatement[]> {
  const sts = await db.all<{ id: string; pay_date: string; period_end: string; gross: number; net: number }>(
    "SELECT id, pay_date, period_end, gross, net FROM comp_statements WHERE pay_date LIKE ? ORDER BY pay_date, seq", [`${year}-%`]);
  const lines = await db.all<{ statement_id: string; section: string; category: string; label: string; current: number | null; pretax: number; rate: number | null }>(
    "SELECT statement_id, section, category, label, current, pretax, rate FROM comp_lines WHERE current IS NOT NULL AND current <> 0 ORDER BY statement_id, line_no");
  return sts.map((s) => {
    const mine = lines.filter((l) => l.statement_id === s.id).flatMap((l) => {
      const g = groupOf(l);
      return g ? [{ label: prettyLabel(l.label), group: g, category: l.category, current: l.current!, pretax: !!l.pretax, rate: l.rate }] : [];
    });
    const kind = mine.some((l) => l.group === "rsu_income") ? "vest" : s.gross === 0 ? "payout" : "paycheck";
    return { id: s.id, payDate: s.pay_date, periodEnd: s.period_end, kind, gross: s.gross, net: s.net, lines: mine };
  });
}

/** Totals per group and per line for a set of statements. */
export function totals(sts: CompStatement[]) {
  const byGroup = {} as Record<Group, number>;
  const byLine = new Map<string, { label: string; group: Group; amount: number }>();
  for (const s of sts) for (const l of s.lines) {
    byGroup[l.group] = (byGroup[l.group] ?? 0) + l.current;
    const k = `${l.group}|${l.label}`;
    const cur = byLine.get(k) ?? { label: l.label, group: l.group, amount: 0 };
    cur.amount += l.current;
    byLine.set(k, cur);
  }
  const g = (k: Group) => byGroup[k] ?? 0;
  return { g, lines: [...byLine.values()], gross: sts.reduce((t, s) => t + s.gross, 0), net: sts.reduce((t, s) => t + s.net, 0) };
}

export async function basePayHistory(db: Db) {
  return db.all<{ id: string; effective_date: string; reason: string | null; period_rate: number; frequency: string | null; annual: number | null }>(
    "SELECT id, effective_date, reason, period_rate, frequency, annual FROM comp_base_pay ORDER BY effective_date DESC, period_rate DESC");
}

export async function rsuVests(db: Db, year: string) {
  return db.all<{ statement_id: string; vest_date: string; pay_date: string; usd_value: number; taxes_withheld: number; net_value: number | null; shares: number | null; fx_rate: number | null }>(
    `SELECT v.statement_id, v.vest_date, s.pay_date, v.usd_value, v.taxes_withheld, v.net_value, v.shares, v.fx_rate
       FROM comp_rsu_vests v JOIN comp_statements s ON s.id = v.statement_id WHERE s.pay_date LIKE ? ORDER BY v.vest_date, v.usd_value DESC`, [`${year}-%`]);
}

export async function compYears(db: Db) {
  return (await db.all<{ y: string }>("SELECT DISTINCT substr(pay_date, 1, 4) AS y FROM comp_statements ORDER BY y DESC")).map((r) => r.y);
}

// ---------- Key rates (401(k) %, HSA, tax rate, monthly take-home) ----------

const money2 = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct1 = (a: number, b: number | null) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sumLines = (ls: CompLine[], f: (l: CompLine) => boolean) => ls.filter(f).reduce((t, l) => t + l.current, 0);

export interface RateChange { date: string; text: string }

/**
 * The numbers worth tracking year to year. All computed from statements, so a new year fills in by itself after an import.
 * 401(k) % is of the salary rate per paycheck (PTO weeks split base pay across lines, so the rate is the steady base).
 */
export function keyRates(sts: CompStatement[]) {
  const paychecks = sts.filter((s) => s.kind === "paycheck");
  const per = paychecks.map((p) => {
    const salary = p.lines.find((l) => l.group === "earnings" && l.category === "base" && l.rate)?.rate ?? null;
    return {
      date: p.payDate, salary: salary != null ? Math.round(salary * 100) : null,
      k401: sumLines(p.lines, (l) => l.category === "k401"),
      roth: sumLines(p.lines, (l) => l.category === "roth_k401" || l.category === "aftertax_k401"),
      hsa: sumLines(p.lines, (l) => l.category === "hsa"),
    };
  });

  const changes: RateChange[] = [];
  for (let i = 1; i < per.length; i++) {
    const c = per[i], p = per[i - 1];
    if (c.hsa !== p.hsa) changes.push({ date: c.date, text: p.hsa ? `HSA ${money2(p.hsa)} → ${money2(c.hsa)} per paycheck` : `HSA started at ${money2(c.hsa)} per paycheck` });
    const cp = pct1(c.k401, c.salary), pp = pct1(p.k401, p.salary);
    if (c.k401 !== p.k401 && cp === pp) changes.push({ date: c.date, text: `401(k) ${money2(p.k401)} → ${money2(c.k401)} per paycheck after the raise (still ${cp}%)` });
    else if (cp !== pp && c.salary === p.salary) changes.push({ date: c.date, text: `401(k) ${pp}% → ${cp}% of salary` });
    if (c.roth !== p.roth) changes.push({ date: c.date, text: `Roth 401(k) ${pct1(p.roth, p.salary) ?? 0}% → ${pct1(c.roth, c.salary) ?? 0}% of salary` });
  }

  const latest = per[per.length - 1] ?? null;
  const all = sts.flatMap((s) => s.lines);
  const gross = sts.reduce((t, s) => t + s.gross, 0);
  const taxBy = (c: string) => sumLines(all, (l) => l.group === "taxes" && l.category === c);
  return {
    latest: latest && { ...latest, k401Pct: pct1(latest.k401, latest.salary), rothPct: pct1(latest.roth, latest.salary) },
    firstHsa: per.find((p) => p.hsa > 0)?.date ?? null,
    paychecksPerYear: 26,
    ytd: {
      k401: sumLines(all, (l) => l.category === "k401"),
      roth: sumLines(all, (l) => l.category === "roth_k401" || l.category === "aftertax_k401"),
      hsa: sumLines(all, (l) => l.category === "hsa"),
    },
    tax: {
      total: sumLines(all, (l) => l.group === "taxes"), gross,
      parts: [
        { label: "Federal income", amount: taxBy("federal") },
        { label: "Social Security", amount: taxBy("social_security") },
        { label: "Medicare", amount: taxBy("medicare") },
        { label: "State & local", amount: taxBy("state_local") },
      ].filter((x) => x.amount),
    },
    changes,
  };
}

/**
 * Average monthly take-home (all deposits, stock sale payouts included) over completed months only.
 * `withoutBonus` removes one-time cash bonuses after tax:
 * the bonus minus its proportional share of that paycheck's taxes (an estimate; payroll withholds bonuses at a flat rate).
 */
export function monthlyTakeHome(sts: CompStatement[], asOfMonth: string) {
  // Same definition as the "Take-home" row of the monthly table: everything deposited, completed months only.
  const done = sts.filter((s) => s.payDate.slice(0, 7) < asOfMonth);
  const paychecks = done.filter((s) => s.kind === "paycheck");
  const months = [...new Set(done.map((s) => s.payDate.slice(0, 7)))];
  const net = done.reduce((t, s) => t + s.net, 0);
  const bonuses = paychecks.flatMap((s) => {
    const bonus = sumLines(s.lines, (l) => l.group === "earnings" && l.category === "bonus");
    if (!bonus) return [];
    const taxes = sumLines(s.lines, (l) => l.group === "taxes");
    const afterTax = Math.round(bonus - (taxes * bonus) / s.gross);
    return [{ date: s.payDate, label: s.lines.find((l) => l.category === "bonus")!.label, gross: bonus, afterTax }];
  });
  const bonusNet = bonuses.reduce((t, b) => t + b.afterTax, 0);
  const n = months.length || 1;
  return {
    months: months.length, from: months[0] ?? null, to: months[months.length - 1] ?? null,
    withBonus: Math.round(net / n), withoutBonus: Math.round((net - bonusNet) / n), bonuses,
  };
}
