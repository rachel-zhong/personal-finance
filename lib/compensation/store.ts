/** Save parsed pay documents (CP). Re-importing a statement replaces it, so running the import twice adds nothing. */
import { createHash } from "node:crypto";
import { Db, newId, nowIso } from "../db";
import type { BasePayRow, PayStatement, W2 } from "./parse";

export async function saveStatement(db: Db, st: PayStatement, file: string, fileBytes: Buffer) {
  const id = st.adviceNumber ?? `sha:${createHash("sha256").update(fileBytes).digest("hex").slice(0, 24)}`;
  await db.tx(async (tx) => {
    await tx.run("DELETE FROM comp_statements WHERE id = ? OR file = ?", [id, file]);
    await tx.run(
      `INSERT INTO comp_statements (id, file, layout, pay_date, period_start, period_end, seq, gross, gross_ytd, net, federal_taxable, pages, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [id, file, st.layout, st.payDate, st.periodStart, st.periodEnd, st.gross.current, st.gross.ytd, st.net, st.federalTaxableCurrent, st.pages, nowIso()]);
    let n = 0;
    for (const l of st.lines) {
      await tx.run(
        `INSERT INTO comp_lines (statement_id, line_no, section, category, label, classified, rate, hours, current, ytd, pretax)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, n++, l.section, l.category, l.label, l.classified ? 1 : 0, l.rate, l.hours, l.current, l.ytd, l.pretax ? 1 : 0]);
    }
    n = 0;
    for (const d of st.deposits) {
      await tx.run("INSERT INTO comp_deposits (statement_id, line_no, account, amount) VALUES (?, ?, ?, ?)", [id, n++, d.account, d.cents]);
    }
    // An RSU vest: stock income this period. The statement shows USD value and taxes; shares, JPY price and FX rate aren't printed.
    const rsu = st.lines.filter((l) => l.category === "rsu" && (l.current ?? 0) !== 0).reduce((s, l) => s + (l.current ?? 0), 0);
    if (rsu) {
      const taxes = st.lines.filter((l) => l.section === "taxes").reduce((s, l) => s + (l.current ?? 0), 0);
      const offset = st.lines.filter((l) => l.category === "rsu_offset").reduce((s, l) => s + (l.current ?? 0), 0);
      await tx.run(
        `INSERT INTO comp_rsu_vests (statement_id, vest_date, usd_value, taxes_withheld, net_value, note) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, st.periodEnd, rsu, taxes, offset || null, "Statement shows USD value and taxes only"]);
    }
  });
  return id;
}

/** Order statements within each year by their YTD gross (same-day statements can't be ordered by date). */
export async function resequence(db: Db) {
  const rows = await db.all<{ id: string; pay_date: string; gross_ytd: number | null; gross: number }>(
    "SELECT id, pay_date, gross_ytd, gross FROM comp_statements");
  const byYear = new Map<string, typeof rows>();
  for (const r of rows) byYear.set(r.pay_date.slice(0, 4), [...(byYear.get(r.pay_date.slice(0, 4)) ?? []), r]);
  for (const list of byYear.values()) {
    list.sort((a, b) => a.pay_date.localeCompare(b.pay_date) || (a.gross_ytd ?? 0) - (b.gross_ytd ?? 0));
    for (let i = 0; i < list.length; i++) await db.run("UPDATE comp_statements SET seq = ? WHERE id = ?", [i + 1, list[i].id]);
  }
}

export async function saveW2(db: Db, w: W2, file: string) {
  await db.run(
    `INSERT INTO comp_w2 (year, file, box1, box2, box3, box4, box5, box6, box12, box14, summary, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(year) DO UPDATE SET file = excluded.file, box1 = excluded.box1, box2 = excluded.box2, box3 = excluded.box3,
       box4 = excluded.box4, box5 = excluded.box5, box6 = excluded.box6, box12 = excluded.box12, box14 = excluded.box14,
       summary = excluded.summary, imported_at = excluded.imported_at`,
    [w.year, file, w.box1, w.box2, w.box3, w.box4, w.box5, w.box6, JSON.stringify(w.box12), JSON.stringify(w.box14), JSON.stringify(w.summary), nowIso()]);
}

/** Add screenshot rows that aren't there yet. Rows you edited or added in the app are never overwritten. */
export async function saveBasePay(db: Db, rows: BasePayRow[]) {
  let added = 0;
  for (const r of rows) {
    const res = await db.run(
      `INSERT OR IGNORE INTO comp_base_pay (id, effective_date, reason, period_rate, frequency, annual, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'screenshot', ?, ?)`,
      [newId(), r.effectiveDate, r.reason, r.periodRate, r.frequency, r.annual, nowIso(), nowIso()]);
    added += res.changes;
  }
  return added;
}
