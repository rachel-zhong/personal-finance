/** Orchestrates a full sync across every connector, then rebuilds derived data and refund matches. */
import { Db } from "./db";
import { createPlaidClient, PlaidApi } from "./connectors/plaid/client";
import { syncConnection, SyncResult } from "./connectors/plaid";
import { refreshDerived } from "./store";
import { runAutoMatch } from "./refunds/matcher";
import { rebuildNetWorthSnapshots } from "./networth";
import { InvestmentSyncResult, snapshotHoldings, syncInvestments } from "./investments";

export async function syncAll(db: Db, plaid?: PlaidApi): Promise<{ results: SyncResult[]; investments: InvestmentSyncResult[]; refundsMatched: number }> {
  const conns = await db.all<{ id: string; provider: string; investments_enabled: number }>(
    "SELECT id, provider, investments_enabled FROM connections ORDER BY created_at",
  );
  const results: SyncResult[] = [];
  const investments: InvestmentSyncResult[] = [];
  const plaidConns = conns.filter((c) => c.provider === "plaid");
  if (plaidConns.length) {
    const client = plaid ?? createPlaidClient();
    for (const c of plaidConns) results.push(await syncConnection(db, client, c.id));
    // Holdings only for connections where you allowed investment details (IN-2).
    for (const c of plaidConns.filter((x) => x.investments_enabled)) investments.push(await syncInvestments(db, client, c.id));
  }
  // simplefin connector would slot in here in a later phase.
  await refreshDerived(db);
  const { created } = await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
  await snapshotHoldings(db); // today's value of every holding (IN-6)
  return { results, investments, refundsMatched: created };
}
