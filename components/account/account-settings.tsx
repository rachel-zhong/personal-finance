"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { post } from "../api";

export interface SettingsProps {
  id: string; name: string; display_name: string | null; group: string; heldMode: string;
  include_in_net_worth: boolean; include_in_spending: boolean; held: number; note: string | null;
}

export default function AccountSettings({ a }: { a: SettingsProps }) {
  const router = useRouter();
  const [f, setF] = useState({
    display_name: a.display_name ?? "", account_group: a.group, include_in_net_worth: a.include_in_net_worth,
    include_in_spending: a.include_in_spending, held: a.held ? String(a.held / 100) : "", note: a.note ?? "",
    held_mode: a.heldMode === "all" ? "all" : "amount",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await post(`/api/accounts/${a.id}`, {
        display_name: f.display_name, account_group: f.account_group, include_in_net_worth: true,
        include_in_spending: f.include_in_spending, net_worth_held_for_others: f.held_mode === "all" ? 0 : Number(f.held || 0),
        net_worth_held_mode: f.held_mode, net_worth_note: f.note,
      });
      setMsg("✓ Saved");
      router.refresh();
    } catch (err) { setMsg(`⚠️ ${(err as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-[2_1_220px] flex-col gap-1.5">
          <Label htmlFor="s-name" className="text-xs font-semibold text-ink-2">Display name</Label>
          <Input id="s-name" className="h-11 bg-field" value={f.display_name} placeholder={a.name}
            onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </div>
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
          <Label htmlFor="s-group" className="text-xs font-semibold text-ink-2">Group</Label>
          <select id="s-group" value={f.account_group}
            onChange={(e) => setF({ ...f, account_group: e.target.value, held_mode: e.target.value === "parents" ? "all" : f.held_mode })}
            className="h-11 rounded-lg border border-input bg-field px-2.5 text-sm">
            <option value="cash">Cash and savings</option>
            <option value="parents">Family money</option>
            <option value="invest">Investments</option>
              <option value="retire">Retirement</option>
            <option value="cards">Credit cards</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={f.include_in_spending} onCheckedChange={(v) => setF({ ...f, include_in_spending: v })} />
          Count in my spending
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
          <Label htmlFor="s-held-mode" className="text-xs font-semibold text-ink-2">Held for others</Label>
          <div className="flex gap-2">
            <select id="s-held-mode" value={f.held_mode}
              onChange={(e) => setF({ ...f, held_mode: e.target.value })}
              className="h-11 rounded-lg border border-input bg-field px-2.5 text-sm">
              <option value="amount">Fixed amount</option>
              <option value="all">Whole balance</option>
            </select>
            {f.held_mode === "amount" && (
              <Input id="s-held" aria-label="Amount held for others" className="h-11 bg-field" inputMode="decimal" value={f.held} placeholder="$0"
                onChange={(e) => setF({ ...f, held: e.target.value })} />
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-[2_1_260px] flex-col gap-1.5">
          <Label htmlFor="s-note" className="text-xs font-semibold text-ink-2">Note</Label>
          <Input id="s-note" className="h-11 bg-field" value={f.note} placeholder="e.g. Family savings"
            onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy} className="h-10 px-5 font-semibold">{busy ? "Saving…" : "Save settings"}</Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}
