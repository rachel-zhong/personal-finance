import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { getAccessToken } from "@/lib/secrets";
import { createPlaidClient, PlaidError } from "@/lib/connectors/plaid/client";
import { syncAll } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

/** How long to give the broker before reading the fresh copy back. Plaid's refresh returns at once and fetches in the background. */
const WAIT_MS = 30_000;

/**
 * "Refresh now" on the Investments tab: asks Plaid to fetch fresh holdings from each broker (instead of waiting for its
 * daily pull), waits, then runs a full sync, so Net worth and every other tab update too. Read-only. Free on the Plaid Trial plan; billed per call on
 * paid plans, which is why the regular Sync never calls it.
 */
export async function POST() {
  return handle(async () => {
    const db = getDb();
    const plaid = createPlaidClient();
    const conns = await db.all<{ id: string; access_token_ref: string; name: string | null }>(
      `SELECT c.id, c.access_token_ref, i.name FROM connections c LEFT JOIN institutions i ON i.id = c.institution_id
       WHERE c.provider = 'plaid' AND c.investments_enabled = 1`);
    const results: { institution: string; refreshed: boolean; holdings?: number; error?: string }[] = [];
    for (const c of conns) {
      try {
        await plaid.investmentsRefresh!(getAccessToken(c.access_token_ref));
        results.push({ institution: c.name ?? "Unknown", refreshed: true });
      } catch (e) {
        results.push({ institution: c.name ?? "Unknown", refreshed: false,
          error: e instanceof PlaidError ? `${e.code}: ${e.message}` : (e as Error).message });
      }
    }
    if (results.some((r) => r.refreshed)) await new Promise((r) => setTimeout(r, WAIT_MS));
    // Then a full sync: balances, transactions, holdings, and the Net worth history, so every tab shows the fresh numbers.
    const sync = await syncAll(db, plaid);
    for (const [i, c] of conns.entries()) {
      const s = sync.investments.find((x) => x.connectionId === c.id);
      if (s) { results[i].holdings = s.holdings; if (s.error) results[i].error = s.error; }
    }
    return { results };
  });
}
