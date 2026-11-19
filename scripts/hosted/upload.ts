/**
 * One-time upload of your Mac's data to the hosted app, so no bank needs reconnecting.
 *
 *   npm run hosted:upload -- https://<your-app>.up.railway.app
 *   npm run hosted:upload -- https://<your-app>.up.railway.app --replace       (overwrite data already there)
 *   npm run hosted:upload -- https://<your-app>.up.railway.app --include-pay   (only with HOSTED_INCLUDE_COMPENSATION=true)
 *
 * What it does:
 * 1. Makes a consistent copy of data/finance.db (safe while the app is running) in a private temp folder.
 * 2. Removes all pay data from the COPY (unless --include-pay). Your Mac's database is never changed.
 * 3. Asks for your app password (and authenticator code if you set one up), logs in over HTTPS.
 * 4. Sends the copy and your Plaid tokens file. The server checks both before replacing anything.
 * 5. Deletes the temp copy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appOrigin, login, reportFailure } from "./common";
import Database from "better-sqlite3";

const PAY_TABLES = ["comp_rsu_vests", "comp_lines", "comp_deposits", "comp_statements", "comp_w2", "comp_base_pay"];

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  const replace = args.includes("--replace");
  const includePay = args.includes("--include-pay");
  const origin = appOrigin(url, "npm run hosted:upload -- https://<your-app>.up.railway.app");

  const dbFile = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "finance.db");
  const secFile = process.env.SECRETS_PATH || path.join(process.cwd(), "secrets", "plaid-tokens.json");
  for (const f of [dbFile, secFile]) if (!fs.existsSync(f)) { console.log(`Not found: ${f}`); process.exit(1); }

  // 1–2. Private copy, pay data removed from the copy only
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mymoney-upload-"));
  const copy = path.join(dir, "finance.db");
  try {
    const src = new Database(dbFile, { readonly: true });
    await src.backup(copy);
    src.close();
    const c = new Database(copy);
    if (!includePay) {
      for (const t of PAY_TABLES) { try { c.prepare(`DELETE FROM ${t}`).run(); } catch { /* table not there */ } }
    }
    try { c.prepare("UPDATE auth_throttle SET failures = 0, locked_until = NULL").run(); } catch { /* older database */ }
    c.pragma("journal_mode = DELETE");
    c.exec("VACUUM");
    const n = (sql: string) => (c.prepare(sql).get() as { n: number }).n;
    console.log(`Ready to upload: ${n("SELECT COUNT(*) AS n FROM connections")} connections, ${n("SELECT COUNT(*) AS n FROM accounts")} accounts, ${n("SELECT COUNT(*) AS n FROM transactions")} transactions${includePay ? ", including pay data" : ", no pay data"}.`);
    c.close();

    // 3. Log in
    const cookie = await login(origin);

    // 4. Upload
    const form = new FormData();
    form.append("db", new Blob([fs.readFileSync(copy)]), "finance.db");
    form.append("secrets", new Blob([fs.readFileSync(secFile)]), "plaid-tokens.json");
    if (replace) form.append("replace", "1");
    console.log("Uploading…");
    const r = await fetch(`${origin}/api/admin/restore`, { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`Not uploaded: ${j.error ?? r.status}`); process.exit(1); }
    console.log(`✓ Uploaded: ${j.connections} connections, ${j.accounts} accounts, ${j.transactions} transactions${j.replaced ? " (previous data kept as a backup on the server)" : ""}.`);
    console.log(`Open ${origin} and tap Sync now.`);
  } finally {
    // 5. Remove the temp copy
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(reportFailure);
