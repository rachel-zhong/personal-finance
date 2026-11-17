import { getDb, today } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { addManualBalance } from "@/lib/connectors/manual";
import { rebuildNetWorthSnapshots } from "@/lib/networth";
import { GROUPS, Group, TYPE_FOR_GROUP } from "@/lib/groups";

export const runtime = "nodejs";

/**
 * Add or update a manual balance.
 * Body: { accountName, balance, asOf?, note?, and either type or group (cash|parents|invest|cards) }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as {
      accountName: string; type?: string; group?: string; asOf?: string; balance: number | string; note?: string;
    };
    let v = Number(String(b.balance).replace(/[$,\s]/g, ""));
    if (Number.isNaN(v)) throw new Error("Balance must be a number");
    const group = b.group && (GROUPS as readonly string[]).includes(b.group) ? (b.group as Group) : null;
    const type = b.type || (group ? TYPE_FOR_GROUP[group] : "investment");
    if (type === "credit" || type === "loan") v = Math.abs(v); // owed is stored positive
    const db = getDb();
    const accountId = await addManualBalance(db, {
      accountName: b.accountName, type, group, asOf: b.asOf || today(), balanceCents: Math.round(v * 100), note: b.note,
    });
    await rebuildNetWorthSnapshots(db);
    return { accountId };
  });
}
