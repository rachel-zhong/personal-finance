"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money, shortDate } from "@/lib/format";
import { post } from "../api";

export interface Entry { id: string; as_of: string; balance: number; note: string | null; created_at: string }

/** Update a manual account's balance, see its history, delete entries or the whole account. */
export default function ManualBalance({ accountId, accountName, type, liability, entries }: {
  accountId: string; accountName: string; type: string; liability: boolean; entries: Entry[];
}) {
  const router = useRouter();
  const [f, setF] = useState({ balance: "", asOf: new Date().toLocaleDateString("en-CA"), note: "" });
  const [err, setErr] = useState<string | null>(null);

  async function update(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await post("/api/manual", { accountName, type, balance: f.balance, asOf: f.asOf, note: f.note });
      setF({ ...f, balance: "", note: "" });
      router.refresh();
    } catch (x) { setErr((x as Error).message); }
  }
  async function del(body: { entryId?: string; accountId?: string }, q: string) {
    if (!window.confirm(q)) return;
    try {
      const r = await post<{ accountDeleted: boolean }>("/api/manual/delete", body);
      if (r.accountDeleted) router.push("/"); else router.refresh();
    } catch (x) { setErr((x as Error).message); }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={update} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-1.5">
          <Label htmlFor="m-bal" className="text-xs font-semibold text-ink-2">New balance{liability ? " (owed)" : ""}</Label>
          <Input id="m-bal" required inputMode="decimal" className="h-11 bg-field" placeholder="$0" value={f.balance}
            onChange={(e) => setF({ ...f, balance: e.target.value })} />
        </div>
        <div className="flex min-w-0 flex-[1_1_150px] flex-col gap-1.5">
          <Label htmlFor="m-date" className="text-xs font-semibold text-ink-2">As of</Label>
          <Input id="m-date" type="date" required className="h-11 bg-field" value={f.asOf}
            onChange={(e) => setF({ ...f, asOf: e.target.value })} />
        </div>
        <div className="flex min-w-0 flex-[2_1_200px] flex-col gap-1.5">
          <Label htmlFor="m-note" className="text-xs font-semibold text-ink-2">Note</Label>
          <Input id="m-note" className="h-11 bg-field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <Button type="submit" className="h-11 px-5 font-semibold">Update balance</Button>
      </form>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex flex-col">
        <p className="pb-2 text-xs text-muted-foreground">
          Each entry is a dated record, like a transaction. Net worth history uses them: add past balances (set &quot;As of&quot; to the real date) and the past gets more accurate.
        </p>
        {entries.map((e, i) => {
          const older = entries[i + 1];
          const change = older ? (liability ? -(e.balance - older.balance) : e.balance - older.balance) : null;
          const added = e.created_at.slice(0, 10);
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-3 border-t border-hairline py-2.5 text-sm">
              <div className="flex w-36 flex-col">
                <span className="font-medium">{shortDate(e.as_of)}</span>
                <span className="text-xs text-muted-foreground">{added !== e.as_of ? `Added ${shortDate(added)}` : "Added that day"}</span>
              </div>
              <span className="min-w-0 flex-1 text-muted-foreground">{i === 0 ? "Current" : ""}{e.note ? `${i === 0 ? " · " : ""}${e.note}` : ""}</span>
              {change != null && change !== 0 && (
                <span className={change > 0 ? "text-xs text-income-ink" : "text-xs text-muted-foreground"}>{change > 0 ? "+" : "−"}{money(Math.abs(change))}</span>
              )}
              <span className="font-semibold">{money(liability ? -e.balance : e.balance)}</span>
              <button type="button" className="text-[13px] text-destructive hover:underline"
                onClick={() => del({ entryId: e.id }, entries.length === 1
                  ? `This is the only entry, so "${accountName}" will be removed too. Delete?`
                  : `Delete the ${money(e.balance)} entry from ${shortDate(e.as_of)}?`)}>
                Delete
              </button>
            </div>
          );
        })}
      </div>
      <div>
        <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
          onClick={() => del({ accountId }, `Delete "${accountName}" and all ${entries.length} balance entries? This can't be undone.`)}>
          Delete this manual account
        </Button>
      </div>
    </div>
  );
}
