/**
 * Plaid connector: translates Plaid items/accounts/transactions into the
 * provider-independent tables via lib/store.
 */
import { Db, newId, nowIso, today } from "../../db";
import { getAccessToken, saveSecret } from "../../secrets";
import {
  markRemoved, upsertAccount, upsertBalance, upsertInstitution, upsertTransaction,
} from "../../store";
import { PlaidApi, PlaidError, PlaidTransaction } from "./client";

const toCents = (n: number) => Math.round(n * 100);

/** Called after Plaid Link succeeds in the browser. */
export async function linkNewItem(
  db: Db,
  plaid: PlaidApi,
  publicToken: string,
  institution: { id?: string | null; name?: string | null },
) {
  const { access_token, item_id } = await plaid.exchangePublicToken(publicToken);

  const existing = await db.get<{ id: string; access_token_ref: string }>(
    "SELECT id, access_token_ref FROM connections WHERE provider = 'plaid' AND item_id = ?",
    [item_id],
  );
  const ref = existing?.access_token_ref ?? `plaid:${item_id}`;
  saveSecret(ref, {
    provider: "plaid", access_token, item_id, institution_name: institution.name ?? undefined,
  });

  const institutionId = await upsertInstitution(db, {
    source: "plaid",
    externalId: institution.id || `item:${item_id}`,
    name: institution.name || "Unknown institution",
  });
  if (existing) return existing.id;
  const id = newId();
  await db.run(
    `INSERT INTO connections (id, provider, item_id, institution_id, access_token_ref, cursor, status, created_at)
     VALUES (?, 'plaid', ?, ?, ?, NULL, 'active', ?)`,
    [id, item_id, institutionId, ref, nowIso()],
  );
  return id;
}

/** Pull every page from /transactions/sync starting at `cursor`. Retries if Plaid's data shifts mid-pagination. */
async function pullAllPages(plaid: PlaidApi, token: string, cursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let next = cursor;
    try {
      for (;;) {
        const page = await plaid.transactionsSync(token, next);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((r) => r.transaction_id));
        next = page.next_cursor;
        if (!page.has_more) break;
      }
      return { added, modified, removed, nextCursor: next };
    } catch (e) {
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }
  }
  throw new Error("Plaid data kept changing during sync; try again in a minute.");
}

export interface SyncResult {
  connectionId: string;
  institution: string;
  added: number;
  updated: number;
  removed: number;
  accounts: number;
  error?: string;
}

export async function syncConnection(db: Db, plaid: PlaidApi, connectionId: string): Promise<SyncResult> {
  const conn = await db.get<{
    id: string; access_token_ref: string; cursor: string | null; institution_id: string | null; inst_name: string | null;
  }>(
    `SELECT c.id, c.access_token_ref, c.cursor, c.institution_id, i.name AS inst_name
       FROM connections c LEFT JOIN institutions i ON i.id = c.institution_id WHERE c.id = ?`,
    [connectionId],
  );
  if (!conn) throw new Error(`Unknown connection ${connectionId}`);
  const result: SyncResult = {
    connectionId, institution: conn.inst_name ?? "?", added: 0, updated: 0, removed: 0, accounts: 0,
  };

  try {
    const token = getAccessToken(conn.access_token_ref);
    // Network calls first, then one DB transaction, so a failure never leaves half a sync.
    const acct = await plaid.accountsGet(token);
    const pulled = await pullAllPages(plaid, token, conn.cursor);

    await db.tx(async (tx) => {
      const accountIds = new Map<string, { id: string; type: string }>();
      for (const a of acct.accounts) {
        const id = await upsertAccount(tx, {
          source: "plaid", externalId: a.account_id, institutionId: conn.institution_id,
          // `name` is the specific one ("ROTH IRA"); official_name can be generic ("Investment").
          connectionId, name: a.name || a.official_name || "Account", type: a.type, subtype: a.subtype ?? null,
          mask: a.mask ?? null, currency: a.balances.iso_currency_code ?? "USD",
        });
        accountIds.set(a.account_id, { id, type: a.type });
        if (a.balances.current != null) await upsertBalance(tx, id, today(), toCents(a.balances.current));
      }
      result.accounts = acct.accounts.length;

      for (const t of [...pulled.added, ...pulled.modified]) {
        const account = accountIds.get(t.account_id);
        if (!account) continue; // account no longer shared with us
        const isNew = await upsertTransaction(tx, {
          accountId: account.id, accountType: account.type, source: "plaid", externalId: t.transaction_id,
          date: t.date, amount: -toCents(t.amount), // Plaid positive = out; ours positive = in
          merchant: t.merchant_name ?? null, description: t.name,
          category: t.personal_finance_category?.primary ?? null, pending: t.pending, raw: t,
        });
        if (isNew) result.added++;
        else result.updated++;
      }
      for (const id of pulled.removed) {
        await markRemoved(tx, "plaid", id);
        result.removed++;
      }
      await tx.run(
        "UPDATE connections SET cursor = ?, last_synced_at = ?, status = 'active', last_error = NULL WHERE id = ?",
        [pulled.nextCursor, nowIso(), connectionId],
      );
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof PlaidError && e.code === "ITEM_LOGIN_REQUIRED" ? "needs_reauth" : "error";
    await db.run("UPDATE connections SET status = ?, last_error = ? WHERE id = ?", [status, msg, connectionId]);
    result.error = msg;
  }
  return result;
}
