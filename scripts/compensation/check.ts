/** Validate imported pay data and print a report to the terminal (CP). Writes nothing. Run: npm run comp:check */
import { getDb } from "@/lib/db";
import { reconcileW2, validatePay } from "@/lib/compensation/validate";

const $ = (c: number | null) => (c == null ? "—" : `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

(async () => {
  const db = getDb();
  const { statements, lines, checks, exceptions } = await validatePay(db);

  console.log("== Found");
  const years = [...new Set(statements.map((s) => s.pay_date.slice(0, 4)))];
  for (const y of years) {
    const sts = statements.filter((s) => s.pay_date.startsWith(y));
    const vests = await db.all<{ vest_date: string; usd_value: number; taxes_withheld: number; net_value: number | null }>(
      "SELECT v.vest_date, v.usd_value, v.taxes_withheld, v.net_value FROM comp_rsu_vests v JOIN comp_statements s ON s.id = v.statement_id WHERE s.pay_date LIKE ? ORDER BY v.vest_date", [`${y}-%`]);
    const proceeds = sts.filter((s) => lines.some((l) => l.statement_id === s.id && l.category === "stock_proceeds" && l.current != null)).length;
    console.log(`${y}: ${sts.length} statements · ${sts.length - vests.length - proceeds} paychecks · ${vests.length} RSU vest statements (${new Set(vests.map((v) => v.vest_date)).size} vest dates) · ${proceeds} stock-proceeds payouts`);
    for (const v of vests) console.log(`  vest ${v.vest_date}  value ${$(v.usd_value)}  taxes ${$(v.taxes_withheld)}  kept ${$(v.net_value)}  value−taxes−kept=${$(v.usd_value - v.taxes_withheld - (v.net_value ?? 0))}`);
  }

  console.log("\n== Checks");
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);

  console.log("\n== W-2");
  for (const w of await reconcileW2(db)) {
    console.log(`${w.year}: ${w.statements} statements on file for this year`);
    for (const r of w.rows) console.log(`  ${r.box.padEnd(22)} ${$(r.w2).padStart(14)}  ${r.calc == null ? "" : `calc ${$(r.calc)} ${r.calc === r.w2 ? "✓" : `off ${$(r.w2 - r.calc)}`}`}  ${r.note}`);
  }

  console.log("\n== Contribution settings by paycheck");
  let last = "";
  for (const s of statements) {
    const mine = lines.filter((l) => l.statement_id === s.id);
    const base = mine.filter((l) => l.section === "earnings" && l.category === "base").reduce((t, l) => t + (l.current ?? 0), 0);
    if (!base) continue;
    const k = mine.filter((l) => l.category === "k401").reduce((t, l) => t + (l.current ?? 0), 0);
    const roth = mine.filter((l) => l.category === "roth_k401").reduce((t, l) => t + (l.current ?? 0), 0);
    const hsa = mine.filter((l) => l.category === "hsa").reduce((t, l) => t + (l.current ?? 0), 0);
    // % of the salary rate per paycheck (PTO weeks split base pay across lines, so the Regular amount alone varies)
    const rateLine = mine.find((l) => l.section === "earnings" && /regular/i.test(l.label) && l.rate);
    if (!rateLine?.rate) continue;
    const regular = Math.round(rateLine.rate * 100);
    const cur = `401k ${(k / regular * 100).toFixed(1)}% of base${roth ? ` · Roth ${(roth / regular * 100).toFixed(1)}%` : ""} · HSA ${$(hsa)}/paycheck`;
    if (cur !== last) console.log(`  from ${s.pay_date}: ${cur}  (401k ${$(k)} on salary ${$(regular)}/paycheck)`);
    last = cur;
  }

  console.log("\n== Base pay history");
  for (const r of await db.all<{ effective_date: string; reason: string | null; period_rate: number; annual: number | null }>(
    "SELECT effective_date, reason, period_rate, annual FROM comp_base_pay ORDER BY effective_date DESC")) {
    console.log(`  ${r.effective_date}  ${(r.reason ?? "").padEnd(22)} ${$(r.period_rate)}/period  annual ${$(r.annual)}`);
  }

  console.log(`\n== Exceptions (${exceptions.length})`);
  for (const e of exceptions) console.log(`- [${e.kind}] ${e.where}: ${e.detail}`);
})();
