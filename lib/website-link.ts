/**
 * Mac side of "Compensation on your phone": the website's address and a link code, saved in
 * data/website-link.json (gitignored, readable only by you). With them, the Mac app sends pay numbers
 * (never PDFs) to the website: on a button press, and automatically after you add pay documents.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { PAY_TABLES } from "./compensation/pay-tables";

export interface WebsiteLink { url: string; token: string; lastSent?: string; lastResult?: string; lastOk?: boolean }

const file = () => path.join(process.cwd(), "data", "website-link.json");

export function getLink(): WebsiteLink | null {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")) as WebsiteLink; } catch { return null; }
}
function save(l: WebsiteLink) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(l, null, 2), { mode: 0o600 });
}

/** Normalizes the address to "https://host" (http only for a local test). */
export function cleanUrl(input: string) {
  const u = new URL(/^https?:\/\//.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("Use the https:// address");
  return u.origin;
}

/** Saves the address with a new link code (or keeps the old code when only the address changes). */
export function setLink(url: string, newCode = false) {
  const old = getLink();
  const link: WebsiteLink = { url: cleanUrl(url), token: !newCode && old?.token ? old.token : randomBytes(36).toString("base64url") };
  save(link);
  return link;
}

export function forgetLink() {
  fs.rmSync(file(), { force: true });
}

/** Sends every pay row to the website. Records the result so the app can show "last sent". */
export async function sendPay(db: Db): Promise<{ ok: boolean; message: string }> {
  const link = getLink();
  if (!link) return { ok: false, message: "Not linked to a website yet" };
  const tables: Record<string, unknown[]> = {};
  for (const t of PAY_TABLES) tables[t] = await db.all(`SELECT * FROM ${t}`);
  let ok = false, message: string;
  try {
    const r = await fetch(`${link.url}/api/admin/pay`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ tables }), signal: AbortSignal.timeout(60_000),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; counts?: Record<string, number> };
    ok = r.ok;
    message = r.ok ? `Website updated: ${j.counts?.comp_statements ?? 0} statements, ${j.counts?.comp_w2 ?? 0} W-2s`
      : r.status === 401 ? "The website didn't accept the link code. Check PAY_SYNC_TOKEN in Railway matches."
      : j.error ?? `The website answered ${r.status}`;
  } catch (e) {
    message = `Couldn't reach the website (${(e as Error).message}). Check the address and that it's running.`;
  }
  save({ ...link, lastSent: new Date().toISOString(), lastResult: message, lastOk: ok });
  return { ok, message };
}
