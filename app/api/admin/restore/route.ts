import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { closeDb, dbPath, getDb, openSqlite } from "@/lib/db";
import { secretsPath } from "@/lib/secrets";
import { authEnabled, compensationEnabled } from "@/lib/hosted";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 500 * 1024 * 1024;
const PAY_TABLES = ["comp_statements", "comp_lines", "comp_deposits", "comp_w2", "comp_base_pay", "comp_rsu_vests"];

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * One-time data upload (run `npm run hosted:upload` on your Mac). Replaces the server's database and Plaid tokens
 * with your Mac's, so no bank needs reconnecting.
 *
 * Safety:
 * - Only with login on (APP_PASSWORD) and a valid session; the middleware already checks it.
 * - The file must be a SQLite database with connections, and every connection's token must be in the tokens file.
 * - Pay tables must be empty unless HOSTED_INCLUDE_COMPENSATION=true.
 * - Refuses if the server already has connections, unless replace=1; then the old files are kept as backups.
 */
export async function POST(req: Request) {
  if (!authEnabled()) return fail("Set APP_PASSWORD first: uploads are only allowed with login on.", 403);
  const form = await req.formData();
  const dbFile = form.get("db"), secFile = form.get("secrets");
  if (!(dbFile instanceof File) || !(secFile instanceof File)) return fail("Send both the database and the tokens file.");
  if (dbFile.size > MAX_BYTES) return fail("Database file is too big.");
  const bytes = Buffer.from(await dbFile.arrayBuffer());
  if (bytes.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") return fail("That isn't a SQLite database.");

  let tokens: Record<string, { access_token?: string }>;
  try { tokens = JSON.parse(Buffer.from(await secFile.arrayBuffer()).toString("utf8")); } catch { return fail("The tokens file isn't valid JSON."); }
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return fail("The tokens file has the wrong shape.");

  const target = dbPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.upload`;
  fs.writeFileSync(staged, bytes, { mode: 0o600 });

  // Check the uploaded copy before touching anything live.
  let summary: { connections: number; accounts: number; transactions: number };
  try {
    const chk = new Database(staged, { readonly: true });
    try {
      if ((chk.pragma("quick_check", { simple: true }) as string) !== "ok") throw new Error("The database file is damaged.");
      const refs = chk.prepare("SELECT access_token_ref AS ref FROM connections").all() as { ref: string }[];
      const missing = refs.filter((r) => !tokens[r.ref]?.access_token);
      if (missing.length) throw new Error(`${missing.length} connection(s) have no token in the tokens file. Nothing was changed.`);
      if (!compensationEnabled()) {
        const pay = PAY_TABLES.reduce((n, t) => {
          try { return n + (chk.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n; } catch { return n; }
        }, 0);
        if (pay > 0) throw new Error("This file still has pay data, and HOSTED_INCLUDE_COMPENSATION is off. Nothing was changed.");
      }
      summary = {
        connections: refs.length,
        accounts: (chk.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n,
        transactions: (chk.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n,
      };
    } finally { chk.close(); }
    // Bring the copy's schema up to date now, so a file that can't be upgraded never replaces the live one.
    const up = openSqlite(staged) as unknown as { close: () => void };
    up.close();
  } catch (e) {
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(staged + ext, { force: true });
    return fail(`${(e as Error).message}${/already exists|no such/.test((e as Error).message) ? " (the file's tables don't match this app). Nothing was changed." : ""}`);
  }

  // Don't overwrite real data by accident.
  const existing = (await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM connections"))?.n ?? 0;
  const replace = form.get("replace") === "1";
  if (existing > 0 && !replace) {
    fs.rmSync(staged, { force: true });
    return fail(`The server already has ${existing} connection(s). Nothing was changed. Run the upload with --replace to overwrite (the current files are kept as backups).`, 409);
  }

  // Swap in the new files. Backups of the current ones are kept next to them.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  closeDb();
  if (existing > 0 && fs.existsSync(target)) fs.copyFileSync(target, `${target}.backup-${stamp}`);
  for (const ext of ["-wal", "-shm"]) fs.rmSync(target + ext, { force: true });
  for (const ext of ["-wal", "-shm"]) fs.rmSync(staged + ext, { force: true });
  fs.renameSync(staged, target);

  const sp = secretsPath();
  fs.mkdirSync(path.dirname(sp), { recursive: true, mode: 0o700 });
  if (existing > 0 && fs.existsSync(sp)) fs.copyFileSync(sp, `${sp}.backup-${stamp}`);
  fs.writeFileSync(`${sp}.tmp`, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.renameSync(`${sp}.tmp`, sp);
  fs.chmodSync(sp, 0o600);

  getDb(); // reopen and bring the schema up to date
  return NextResponse.json({ ok: true, ...summary, replaced: existing > 0 });
}
