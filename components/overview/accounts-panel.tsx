"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";
import { post } from "../api";
import SetAside from "./set-aside";
import ManualBalanceCell from "./manual-balance-cell";

export interface PanelAccount {
  id: string; name: string; meta: string; balance: number | null; included: boolean;
  manual: boolean; stale: boolean; heldForOthers: number; heldMode: "amount" | "all"; canSetAside: boolean;
  rawName: string; type: string; liability: boolean;
  /** Money in this account that is held for others (shown when the "Held for others" card is selected). */
  heldAmount: number;
}
/** Accounts from one bank (or one manual account on its own). Two or more collapse into one expandable row. */
export interface PanelBank { key: string; name: string; sub: string; total: number; items: PanelAccount[] }
export interface PanelGroup { key: string; label: string; total: number; hidden: number; banks: PanelBank[] }

export default function AccountsPanel({ groups, className, filterLabel = null, onClear, expandKey = null }: {
  groups: PanelGroup[]; className?: string;
  /** Set while a summary card filters the list. */
  filterLabel?: string | null; onClear?: () => void;
  /** Changes when the filter changes: a filter opens every bank, clearing it closes them again. */
  expandKey?: string | null;
}) {
  const [openBanks, setOpenBanks] = useState<Set<string>>(new Set());
  useEffect(() => {
    setOpenBanks(expandKey ? new Set(groups.flatMap((g) => g.banks.filter((b) => b.items.length > 1).map((b) => b.key))) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandKey]);
  const toggleBank = (k: string) => setOpenBanks((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", group: "invest", balance: "" });
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try {
      await post("/api/manual", { accountName: form.name, group: form.group, balance: form.balance });
      setForm({ name: "", group: form.group, balance: "" });
      setShowAdd(false);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section aria-label="Accounts" className={cn("flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card px-6 py-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{filterLabel ? filterLabel : "Accounts"}</h2>
          {filterLabel && (
            <button type="button" onClick={onClear} className="text-[13px] font-semibold text-primary hover:underline">Show all accounts</button>
          )}
        </div>
        <Button variant="outline" onClick={() => setShowAdd(true)}
          className="h-10 border-primary px-4 font-semibold text-primary hover:bg-accent hover:text-accent-foreground">
          + Add account manually
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }}
          className="flex flex-wrap items-end gap-3 rounded-[10px] border border-brand-line bg-brand-mist p-4">
          <div className="flex min-w-0 flex-[2_1_200px] flex-col gap-1.5">
            <Label htmlFor="add-name" className="text-xs font-semibold text-ink-2">Account name</Label>
            <Input id="add-name" required value={form.name} placeholder="e.g. Old company 401k" className="h-11 bg-card"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1.5">
            <Label htmlFor="add-group" className="text-xs font-semibold text-ink-2">Type</Label>
            <select id="add-group" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}
              className="h-11 rounded-lg border border-input bg-card px-2.5 text-sm">
              <option value="cash">Cash and savings</option>
              <option value="parents">Family money</option>
              <option value="invest">Investments</option>
              <option value="retire">Retirement</option>
              <option value="cards">Credit card</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
            <Label htmlFor="add-bal" className="text-xs font-semibold text-ink-2">Current balance</Label>
            <Input id="add-bal" required inputMode="decimal" value={form.balance} placeholder="$0" className="h-11 bg-card"
              onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </div>
          <Button type="submit" className="h-11 px-5 font-semibold">Add</Button>
          <Button type="button" variant="outline" className="h-11 bg-card" onClick={() => setShowAdd(false)}>Cancel</Button>
          <p className="basis-full text-xs text-muted-foreground">
            Manual accounts count toward net worth like any other. Update the balance from the account&apos;s page whenever you check the statement.
            {form.group === "parents" && " Family money counts as held for others, not in your net worth."}
          </p>
        </form>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {groups.map((g) => (
        <div key={g.key} className="flex flex-col pt-3">
          <div className="flex items-baseline justify-between border-b border-border py-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.label}</span>
            <span className="text-xs font-semibold text-muted-foreground">
              {dollars(g.total)}{g.hidden ? <span className="font-normal"> · {dollars(g.hidden)} hidden</span> : null}
            </span>
          </div>
          {g.banks.map((b) => {
            if (b.items.length === 1) return <AccountRow key={b.key} a={b.items[0]} />;
            const open = openBanks.has(b.key);
            return (
              <div key={b.key} className="border-b border-hairline">
                <button type="button" onClick={() => toggleBank(b.key)} aria-expanded={open}
                  className="flex w-full items-center gap-2.5 py-3 text-left">
                  <ChevronRight className={cn("size-3.5 flex-none text-ink-2 transition-transform", open && "rotate-90")} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{b.name}</span>
                    <span className="text-xs text-muted-foreground">{b.sub}</span>
                  </span>
                  {/* mr-[34px] lines up with balances that have a pencil next to them */}
                  <span className="mr-[34px] text-[15px] font-semibold">{dollars(b.total)}</span>
                </button>
                {open && (
                  <div className="mb-2.5 ml-1.5 border-l-2 border-hairline pl-4">
                    {b.items.map((a) => <AccountRow key={a.id} a={a} nested />)}
                  </div>
                )}
              </div>
            );
          })}
          {!g.banks.length && <p className="py-3 text-sm text-muted-foreground">No accounts.</p>}
        </div>
      ))}
      <p className="mt-2 text-xs text-muted-foreground">
        Click a bank to expand it, or an account to see every transaction in and out. Use the pencil on a cash account to mark money held for others, or on a manual account to update its balance.
      </p>
    </section>
  );
}

function AccountRow({ a, nested = false }: { a: PanelAccount; nested?: boolean }) {
  // Entirely held for others: none of it is yours, so the row is greyed like a hidden account.
  const allHeld = a.canSetAside && (a.balance ?? 0) > 0 &&
    (a.heldMode === "all" || a.heldForOthers >= (a.balance ?? 0));
  const on = a.included && !allHeld;
  return (
    <div className={cn("flex flex-wrap items-center gap-3", nested ? "py-2" : "border-b border-hairline py-3",
      allHeld && "-mx-2 rounded-md bg-hairline/60 px-2")}>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
        <Link href={`/accounts/${a.id}`} className={cn("tight font-medium no-underline hover:underline", nested ? "text-sm" : "text-[15px]",
          on ? "text-foreground hover:text-foreground" : "text-[#8A8A93] hover:text-[#8A8A93]")}>
          {a.name}
          {a.manual && (
            <span className="ml-2 inline-block rounded bg-hairline px-1.5 py-px align-[2px] text-[11px] font-medium text-muted-foreground">Manual</span>
          )}
        </Link>
        <span className={cn("text-xs text-muted-foreground", a.stale && "text-warn")}>{a.meta}</span>
      </div>
      <div className="flex min-w-[110px] flex-col items-end">
        {a.manual ? (
          <ManualBalanceCell name={a.rawName} type={a.type} balance={a.balance} liability={a.liability} />
        ) : a.canSetAside ? (
          <SetAside id={a.id} name={a.name} balance={a.balance} held={a.heldForOthers} mode={a.heldMode} included={on} />
        ) : (
          <span className={cn("mr-[34px] text-right font-semibold", nested ? "text-sm" : "text-[15px]", !on && "text-[#8A8A93]")}>{dollars(a.balance)}</span>
        )}
      </div>
    </div>
  );
}
