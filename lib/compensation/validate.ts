/**
 * Checks on imported pay data (CP). Reports problems; never changes the data.
 */
import { Db } from "../db";
import { shiftDate } from "../refunds/matcher";

export interface Check { name: string; ok: boolean; detail: string }
export interface Exception { kind: string; where: string; detail: string }

interface St { id: string; file: string; pay_date: string; period_end: string; seq: number; gross: number; gross_ytd: number | null; net: number; federal_taxable: number | null }
interface Ln { statement_id: string; section: string; category: string; label: string; classified: number; current: number | null; ytd: number | null; pretax: number; rate: number | null; hours: number | null }

const $ = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function loadPay(db: Db) {
  const statements = await db.all<St>("SELECT id, file, pay_date, period_end, seq, gross, gross_ytd, net, federal_taxable FROM comp_statements ORDER BY pay_date, seq");
  const lines = await db.all<Ln>("SELECT statement_id, section, category, label, classified, current, ytd, pretax, rate, hours FROM comp_lines ORDER BY statement_id, line_no");
  const deposits = await db.all<{ statement_id: string; account: string | null; amount: number }>("SELECT statement_id, account, amount FROM comp_deposits");
  return { statements, lines, deposits };
}

/** gross − taxes − deductions = net. Deductions include the RSU offset (shares you kept), so RSU income nets to $0 cash. */
export function netOf(st: St, lines: Ln[]) {
  const mine = lines.filter((l) => l.statement_id === st.id);
  const taxes = mine.filter((l) => l.section === "taxes").reduce((s, l) => s + (l.current ?? 0), 0);
  const deductions = mine.filter((l) => l.section === "deductions").reduce((s, l) => s + (l.current ?? 0), 0);
  return st.gross - taxes - deductions;
}

export async function validatePay(db: Db) {
  const { statements, lines, deposits } = await loadPay(db);
  const checks: Check[] = [];
  const exceptions: Exception[] = [];
  const name = (s: St) => s.file.replace(/\.pdf$/i, "");

  // 1. Each statement balances to the cent
  let netOk = 0;
  for (const s of statements) {
    const calc = netOf(s, lines);
    if (calc === s.net) netOk++;
    else exceptions.push({ kind: "Net pay doesn't add up", where: name(s), detail: `gross − taxes − deductions = ${$(calc)}, statement says ${$(s.net)} (off by ${$(calc - s.net)})` });
  }
  checks.push({ name: "Gross − taxes − deductions = net pay", ok: netOk === statements.length, detail: `${netOk} of ${statements.length} statements match to the cent` });

  // 2. Federal taxable wages = gross − pre-tax deductions (the * items)
  let fedOk = 0, fedN = 0;
  for (const s of statements) {
    if (s.federal_taxable == null) continue;
    fedN++;
    const pre = lines.filter((l) => l.statement_id === s.id && l.section === "deductions" && l.pretax && l.current != null).reduce((t, l) => t + (l.current ?? 0), 0);
    if (s.gross - pre === s.federal_taxable) fedOk++;
    else exceptions.push({ kind: "Federal taxable wages differ", where: name(s), detail: `gross − pre-tax = ${$(s.gross - pre)}, statement says ${$(s.federal_taxable)}` });
  }
  checks.push({ name: "Gross − pre-tax deductions = federal taxable wages", ok: fedOk === fedN, detail: `${fedOk} of ${fedN} statements match` });

  // 3. YTD chain: each YTD = previous YTD + this period, per line item and for gross
  const byYear = new Map<string, St[]>();
  for (const s of statements) byYear.set(s.pay_date.slice(0, 4), [...(byYear.get(s.pay_date.slice(0, 4)) ?? []), s]);
  let chainOk = 0, chainN = 0;
  for (const [year, list] of byYear) {
    list.sort((a, b) => a.seq - b.seq);
    const prevYtd = new Map<string, number>();
    let prevGross = 0;
    for (const s of list) {
      chainN++;
      let ok = true;
      if (s.gross_ytd != null && s.gross_ytd !== prevGross + s.gross) {
        ok = false;
        exceptions.push({ kind: "YTD chain broken", where: name(s), detail: `Gross YTD ${$(s.gross_ytd)} ≠ previous ${$(prevGross)} + this period ${$(s.gross)}` });
      }
      prevGross = s.gross_ytd ?? prevGross + s.gross;
      // Some items print this period and YTD on separate rows (e.g. "Stock Proceeds"): combine rows per item first.
      const items = new Map<string, { label: string; current: number; ytd: number | null }>();
      for (const l of lines.filter((x) => x.statement_id === s.id)) {
        const key = `${l.section === "taxes" ? "deductions" : l.section}|${l.label}`;
        const it = items.get(key) ?? { label: l.label, current: 0, ytd: null };
        it.current += l.current ?? 0;
        if (l.ytd != null) it.ytd = l.ytd;
        items.set(key, it);
      }
      for (const [key, it] of items) {
        const before = prevYtd.get(key) ?? 0;
        if (it.ytd == null) continue; // items that never print a YTD (reimbursements, state workers' comp) can't be chained
        // Taxes/deductions are stored as positive "taken", additions negative; YTD prints the same way.
        const expected = before + it.current;
        if (it.ytd !== expected) {
          ok = false;
          exceptions.push({ kind: "YTD chain broken", where: name(s), detail: `${it.label}: YTD ${$(it.ytd)} ≠ previous ${$(before)} + this period ${$(it.current)}` });
        }
        prevYtd.set(key, it.ytd);
      }
      for (const [key, v] of prevYtd) {
        if (!items.has(key) && v !== 0 && !key.startsWith("employer|")) {
          ok = false;
          exceptions.push({ kind: "Line disappeared", where: name(s), detail: `${key.split("|")[1]} had YTD ${$(v)} on the previous statement but isn't on this one` });
        }
      }
      if (ok) chainOk++;
    }
    // The first statement of the year should start from zero
    const first = list[0];
    if (first && first.gross_ytd != null && first.gross_ytd !== first.gross) {
      exceptions.push({ kind: "Missing earlier statements", where: `${year}`, detail: `First statement ${name(first)} has YTD gross ${$(first.gross_ytd)} but only ${$(first.gross)} this period` });
    }
  }
  checks.push({ name: "YTD chain (each YTD = previous YTD + this period)", ok: chainOk === chainN, detail: `${chainOk} of ${chainN} statements chain cleanly` });

  // 4. Regular paychecks every 2 weeks: flag gaps
  const regular = statements.filter((s) => lines.some((l) => l.statement_id === s.id && l.category === "base" && /regular/i.test(l.label) && (l.current ?? 0) > 0));
  let gaps = 0;
  for (let i = 1; i < regular.length; i++) {
    const days = (Date.parse(regular[i].pay_date) - Date.parse(regular[i - 1].pay_date)) / 86_400_000;
    if (days > 15) { gaps++; exceptions.push({ kind: "Possible missing paycheck", where: `${regular[i - 1].pay_date} → ${regular[i].pay_date}`, detail: `${days} days between regular paychecks` }); }
  }
  checks.push({ name: "Regular paychecks every 2 weeks", ok: gaps === 0, detail: `${regular.length} regular paychecks, ${gaps} gap${gaps === 1 ? "" : "s"}` });

  // 5. Unclassified line items
  const unclassified = [...new Map(lines.filter((l) => !l.classified).map((l) => [`${l.section}|${l.label}`, l])).values()];
  for (const l of unclassified) exceptions.push({ kind: "Couldn't classify", where: l.label, detail: `${l.section} → filed as ${l.category}` });

  // 6. Fees, FX or transfers mentioned on statements
  for (const l of lines.filter((x) => /fee|fx|exchange|wire|transfer|stock proceeds/i.test(x.label) && x.current != null)) {
    const s = statements.find((x) => x.id === l.statement_id)!;
    exceptions.push({ kind: "Stock / fee item to review", where: name(s), detail: `${l.label}: this period ${l.current == null ? "—" : $(-l.current)}, YTD ${l.ytd == null ? "—" : $(-l.ytd)}` });
  }

  // 7. Net pay vs bank deposits (same amount into the account ending in the shown digits, within 3 days)
  const bank = await db.all<{ id: string; date: string; amount: number; mask: string | null; description: string }>(
    `SELECT t.id, t.date, t.amount, a.mask, t.description FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.removed = 0 AND t.amount > 0`);
  const firstBank = (await db.get<{ d: string }>("SELECT MIN(date) AS d FROM transactions WHERE removed = 0"))?.d ?? "9999";
  const used = new Set<string>();
  let depOk = 0, depN = 0;
  const unmatched: string[] = [];
  for (const d of deposits) {
    const s = statements.find((x) => x.id === d.statement_id)!;
    if (d.amount === 0) continue;
    depN++;
    const hit = bank.find((b) => !used.has(b.id) && b.amount === d.amount && (!d.account || !b.mask || b.mask === d.account)
      && b.date >= shiftDate(s.pay_date, -3) && b.date <= shiftDate(s.pay_date, 3));
    if (hit) { used.add(hit.id); depOk++; }
    else {
      unmatched.push(name(s));
      exceptions.push({ kind: "Deposit not found in bank", where: name(s), detail: `${$(d.amount)} to account ••${d.account ?? "?"}${s.pay_date < firstBank ? " (before bank history starts)" : ""}` });
    }
  }
  checks.push({ name: "Net pay matches bank deposits", ok: depOk === depN, detail: `${depOk} of ${depN} deposits found in your bank transactions` });

  return { statements, lines, checks, exceptions };
}

/** W-2 boxes vs the sum of that year's statements. Years without statements can only be checked internally. */
export async function reconcileW2(db: Db) {
  const w2s = await db.all<{ year: number; box1: number; box2: number; box3: number; box4: number; box5: number; box6: number; box12: string; box14: string; summary: string }>(
    "SELECT * FROM comp_w2 ORDER BY year");
  const out: { year: number; statements: number; rows: { box: string; w2: number; calc: number | null; note: string }[] }[] = [];
  for (const w of w2s) {
    const n = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM comp_statements WHERE pay_date LIKE ?", [`${w.year}-%`]))!.n;
    const b12 = JSON.parse(w.box12) as Record<string, number>;
    const sum = JSON.parse(w.summary) as { gross: number | null; fsa: number | null };
    const gtl = b12.C ?? 0, k401 = b12.D ?? 0, fsa = sum.fsa ?? 0;
    // Internal consistency from the W-2's own earnings summary
    const box1 = sum.gross != null ? sum.gross + gtl - k401 - fsa - (b12.W ?? 0) : null;
    const box5 = sum.gross != null ? sum.gross + gtl - fsa - (b12.W ?? 0) : null;
    const ss = Math.round(w.box3 * 0.062);
    const med = Math.round(w.box5 * 0.0145 + Math.max(0, w.box5 - 20_000_000) * 0.009);
    out.push({
      year: w.year, statements: n,
      rows: [
        { box: "Box 1 wages", w2: w.box1, calc: box1, note: "Gross + group term life − 401(k) − FSA (W-2 summary)" },
        { box: "Box 3 SS wages", w2: w.box3, calc: null, note: "Capped at the Social Security wage base" },
        { box: "Box 4 SS tax", w2: w.box4, calc: ss, note: "6.2% of box 3" },
        { box: "Box 5 Medicare wages", w2: w.box5, calc: box5, note: "Gross + group term life − FSA" },
        { box: "Box 6 Medicare tax", w2: w.box6, calc: med, note: "1.45% + 0.9% over $200k" },
        ...Object.entries(b12).map(([k, v]) => ({ box: `Box 12 ${k}`, w2: v, calc: null, note: "" })),
        ...(JSON.parse(w.box14) as { label: string; cents: number }[]).map((x) => ({ box: `Box 14 ${x.label}`, w2: x.cents, calc: null, note: "" })),
      ],
    });
  }
  return out;
}
