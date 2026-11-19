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
import readline from "node:readline";
import Database from "better-sqlite3";

const PAY_TABLES = ["comp_rsu_vests", "comp_lines", "comp_deposits", "comp_statements", "comp_w2", "comp_base_pay"];

// One reader for every question. Lines are queued, so answers typed (or pasted) quickly all arrive in order.
let rl: readline.Interface | null = null;
let muted = false;
const lines: string[] = [];
const waiting: ((s: string) => void)[] = [];
function ask(question: string, hidden = false): Promise<string> {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const r = rl as unknown as { _writeToOutput: (s: string) => void };
    const write = r._writeToOutput.bind(rl);
    r._writeToOutput = (s: string) => { if (!muted) write(s); }; // hides the password as you type
    rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  }
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (a: string) => { if (muted) process.stdout.write("\n"); muted = false; resolve(a.trim()); };
    const queued = lines.shift();
    if (queued !== undefined) done(queued); else waiting.push(done);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  const replace = args.includes("--replace");
  const includePay = args.includes("--include-pay");
  if (!url) { console.log("Usage: npm run hosted:upload -- https://<your-app>.up.railway.app"); process.exit(1); }
  const base = new URL(url);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    console.log("Use the https:// address, so your data is encrypted on the way."); process.exit(1);
  }
  const origin = base.origin;

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
    const password = await ask("App password: ", true);
    const code = await ask("Authenticator code (press Enter if you didn't set one up): ");
    rl?.close();
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password, code }),
    });
    if (!login.ok) { console.log(`Login failed: ${(await login.json().catch(() => ({}))).error ?? login.status}`); process.exit(1); }
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

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

main().catch((e: Error & { cause?: { code?: string } }) => {
  console.log(e.message === "fetch failed"
    ? `Couldn't reach the app (${e.cause?.code ?? "network error"}). Check the address and that the Railway deploy is running.`
    : `Stopped: ${e.message}`);
  process.exit(1);
});
