/**
 * Daily sync on the server (Railway): once a day after SYNC_HOUR (default 6, in the TZ time zone),
 * if nothing has synced since then. Checks every 30 minutes, so a restart or a late start still catches up.
 * Runs inside the app itself: no extra service, no extra cost. "Sync now" keeps working as before.
 */
import { getDb } from "./db";
import { syncAll } from "./sync";

const CHECK_MS = 30 * 60_000;
let running = false;

/** The most recent SYNC_HOUR:00 in local time that has already passed. */
export function lastDue(now = new Date(), hour = Number(process.env.SYNC_HOUR ?? 6)) {
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);
  if (due > now) due.setDate(due.getDate() - 1);
  return due;
}

export async function syncIfDue(now = new Date()) {
  if (running) return;
  const db = getDb();
  const s = await db.get<{ last: string | null; n: number }>("SELECT MAX(last_synced_at) AS last, COUNT(*) AS n FROM connections");
  if (!s?.n) return; // nothing connected yet (e.g. before the data upload)
  if (s.last && new Date(s.last) >= lastDue(now)) return;
  running = true;
  try {
    const r = await syncAll(db);
    const failed = r.results.filter((x) => x.error).map((x) => x.institution);
    console.log(`[daily sync] ${new Date().toISOString()}: ${r.results.length} connections${failed.length ? `, failed: ${failed.join(", ")}` : ", all ok"}`);
  } catch (e) {
    console.error("[daily sync] failed:", (e as Error).message);
  } finally { running = false; }
}

export function startDailySync() {
  const g = globalThis as unknown as { __mmDailySync?: boolean };
  if (g.__mmDailySync) return;
  g.__mmDailySync = true;
  setTimeout(() => void syncIfDue(), 60_000); // a minute after start
  setInterval(() => void syncIfDue(), CHECK_MS).unref();
  console.log(`[daily sync] on: every day after ${process.env.SYNC_HOUR ?? 6}:00 (${process.env.TZ ?? "server time"})`);
}
