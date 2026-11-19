/**
 * Send your pay numbers (not the PDFs) to the online app, so the Compensation tab works on your phone.
 *
 *   npm run hosted:pay -- https://<your-app>.up.railway.app
 *
 * Your Mac has already read the PDFs (drop them in the app, or `npm run comp:import`). This command reads the
 * resulting rows from your Mac's database and sends only those. The PDFs never leave your Mac.
 * Online, it replaces the pay rows only; banks, transactions and your other data are untouched.
 * The online app must have HOSTED_INCLUDE_COMPENSATION=true.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { appOrigin, login, reportFailure } from "./common";

const TABLES = ["comp_statements", "comp_lines", "comp_deposits", "comp_rsu_vests", "comp_w2", "comp_base_pay"];

async function main() {
  const origin = appOrigin(process.argv.slice(2).find((a) => !a.startsWith("--")), "npm run hosted:pay -- https://<your-app>.up.railway.app");
  const dbFile = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "finance.db");
  const db = new Database(dbFile, { readonly: true });
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  db.close();
  const statements = tables.comp_statements.length, w2s = tables.comp_w2.length;
  if (!statements && !w2s) { console.log("No pay data on this Mac yet. Add pay documents in the app first."); process.exit(1); }
  console.log(`Ready to send pay numbers: ${statements} statements, ${w2s} W-2s, ${tables.comp_base_pay.length} base pay changes. No PDFs are sent.`);

  const cookie = await login(origin);
  const r = await fetch(`${origin}/api/admin/pay`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify({ tables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`Not sent: ${j.error ?? r.status}`); process.exit(1); }
  console.log(`✓ Pay numbers updated online: ${j.counts.comp_statements} statements, ${j.counts.comp_w2} W-2s. Open the Compensation tab to check.`);
}

main().catch(reportFailure);
