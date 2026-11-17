/**
 * Manual connector: balances you type in for accounts no provider can reach
 * (401k, HSA, property, a loan from a friend). Each entry is logged in manual_entries
 * and also written as a normal account + balance snapshot, so net worth reads every
 * source the same way.
 */
import { Db, newId, nowIso } from "../../db";
import { upsertAccount, upsertBalance, upsertInstitution } from "../../store";

export const MANUAL_TYPES = ["depository", "investment", "credit", "loan", "other"] as const;

export function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function addManualBalance(
  db: Db,
  e: { accountName: string; type: string; asOf: string; balanceCents: number; note?: string | null; group?: string | null },
) {
  const name = e.accountName.trim();
  if (!name) throw new Error("Account name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)) throw new Error("Date must be YYYY-MM-DD");
  if (!MANUAL_TYPES.includes(e.type as (typeof MANUAL_TYPES)[number])) throw new Error("Unknown account type");
  return db.tx(async (tx) => {
    const institutionId = await upsertInstitution(tx, { source: "manual", externalId: "manual", name: "Manual" });
    const accountId = await upsertAccount(tx, {
      source: "manual", externalId: slug(name), institutionId, name, type: e.type,
    });
    if (e.group) {
      // Only on first creation: family money is held for others in full.
      await tx.run(
        `UPDATE accounts SET account_group = ?,
           net_worth_held_mode = CASE WHEN ? = 'parents' THEN 'all' ELSE net_worth_held_mode END
         WHERE id = ? AND account_group IS NULL`,
        [e.group, e.group, accountId]);
    }
    await upsertBalance(tx, accountId, e.asOf, e.balanceCents);
    await tx.run(
      `INSERT INTO manual_entries (id, account_name, account_id, as_of, balance, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), name, accountId, e.asOf, e.balanceCents, e.note ?? null, nowIso()],
    );
    return accountId;
  });
}

/**
 * Delete one manual entry. The balance snapshot for that date falls back to another
 * entry on the same date if there is one; otherwise it is removed. If the account has
 * no entries left, the (manual) account is deleted too.
 */
export async function deleteManualEntry(db: Db, entryId: string) {
  return db.tx(async (tx) => {
    const e = await tx.get<{ account_id: string | null; as_of: string }>(
      "SELECT account_id, as_of FROM manual_entries WHERE id = ?", [entryId]);
    if (!e) throw new Error("Entry not found");
    await tx.run("DELETE FROM manual_entries WHERE id = ?", [entryId]);
    if (!e.account_id) return { accountDeleted: false };
    const sameDay = await tx.get<{ balance: number }>(
      "SELECT balance FROM manual_entries WHERE account_id = ? AND as_of = ? ORDER BY created_at DESC LIMIT 1",
      [e.account_id, e.as_of]);
    if (sameDay) await upsertBalance(tx, e.account_id, e.as_of, sameDay.balance);
    else await tx.run("DELETE FROM balance_snapshots WHERE account_id = ? AND as_of = ?", [e.account_id, e.as_of]);
    const left = await tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM manual_entries WHERE account_id = ?", [e.account_id]);
    if (!left!.n) {
      await deleteManualAccount(tx, e.account_id);
      return { accountDeleted: true };
    }
    return { accountDeleted: false };
  });
}

/** Delete a manual account with all its entries and balance history. Refuses non-manual accounts. */
export async function deleteManualAccount(db: Db, accountId: string) {
  return db.tx(async (tx) => {
    const a = await tx.get<{ source: string }>("SELECT source FROM accounts WHERE id = ?", [accountId]);
    if (!a) throw new Error("Account not found");
    if (a.source !== "manual") throw new Error("Only manual accounts can be deleted here");
    await tx.run("DELETE FROM manual_entries WHERE account_id = ?", [accountId]);
    await tx.run("DELETE FROM balance_snapshots WHERE account_id = ?", [accountId]);
    await tx.run("DELETE FROM accounts WHERE id = ?", [accountId]);
  });
}
