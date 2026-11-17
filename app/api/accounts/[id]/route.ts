import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { GROUPS } from "@/lib/groups";
import { rebuildNetWorthSnapshots } from "@/lib/networth";

export const runtime = "nodejs";

/** Update your own settings for an account (never provider data). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = (await req.json()) as {
      display_name?: string | null;
      include_in_net_worth?: boolean;
      net_worth_held_for_others?: number; // dollars
      net_worth_note?: string | null;
      net_worth_held_mode?: "amount" | "all";
      include_in_spending?: boolean;
      account_group?: string;
    };
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if ("display_name" in b) { sets.push("display_name = ?"); params.push(b.display_name?.trim() || null); }
    if ("include_in_net_worth" in b) { sets.push("include_in_net_worth = ?"); params.push(b.include_in_net_worth ? 1 : 0); }
    if ("net_worth_held_for_others" in b) {
      const v = Number(b.net_worth_held_for_others ?? 0);
      if (Number.isNaN(v) || v < 0) throw new Error("Held-for-others must be a positive number");
      sets.push("net_worth_held_for_others = ?"); params.push(Math.round(v * 100));
    }
    if ("net_worth_held_mode" in b) {
      if (b.net_worth_held_mode !== "amount" && b.net_worth_held_mode !== "all") throw new Error("Unknown set-aside mode");
      sets.push("net_worth_held_mode = ?"); params.push(b.net_worth_held_mode);
      // Holding the whole balance for others means it belongs in the Held for others total, so it can't be hidden.
      if (b.net_worth_held_mode === "all" && !("include_in_net_worth" in b)) sets.push("include_in_net_worth = 1");
    }
    if ("net_worth_note" in b) { sets.push("net_worth_note = ?"); params.push(b.net_worth_note?.trim() || null); }
    if ("include_in_spending" in b) { sets.push("include_in_spending = ?"); params.push(b.include_in_spending ? 1 : 0); }
    if ("account_group" in b) {
      if (!(GROUPS as readonly string[]).includes(b.account_group ?? "")) throw new Error("Unknown group");
      sets.push("account_group = ?"); params.push(b.account_group!);
      // Family money is held for others in full (follows the balance), so it never counts in net worth.
      if (b.account_group === "parents" && !("net_worth_held_mode" in b)) sets.push("net_worth_held_mode = 'all'");
    }
    if (!sets.length) return { ok: true };
    const db = getDb();
    const r = await db.run(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (!r.changes) throw new Error("Account not found");
    await rebuildNetWorthSnapshots(db);
    return { ok: true };
  });
}
