import { getDb } from "@/lib/db";
import { accountLabel, heldFor, listAccounts, myShare, recentTransactions, LIABILITY_TYPES } from "@/lib/queries";
import { lastMonthEnd, netWorthQuarters } from "@/lib/networth";
import { GROUPS, GROUP_LABELS, groupFor } from "@/lib/groups";
import { dollars, monthLong, monthShort, shortDate, syncedLabel } from "@/lib/format";
import NetWorthTrend from "@/components/overview/net-worth-trend";
import { PanelAccount, PanelBank, PanelGroup } from "@/components/overview/accounts-panel";
import OverviewExplorer from "@/components/overview/overview-explorer";
import RecentTransactions from "@/components/overview/recent-transactions";

export const dynamic = "force-dynamic";

const STALE_DAYS = 45;

type Row = PanelAccount & { share: number; bank: string; synced: string | null };

/** One row per bank; manual accounts stay on their own. Banks are listed biggest first. */
function toBanks(rows: Row[]): PanelBank[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.bank, [...(by.get(r.bank) ?? []), r]);
  return [...by.entries()].map(([key, items]) => ({
    key, name: key.startsWith("manual:") ? items[0].name : key,
    sub: `${items.length} accounts${items[0].synced ? ` · synced ${syncedLabel(items[0].synced)}` : ""}`,
    total: items.reduce((s, r) => s + r.share, 0),
    items,
  })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export default async function OverviewPage() {
  const db = getDb();
  const accounts = await listAccounts(db);
  const quarters = await netWorthQuarters(db);
  const recent = await recentTransactions(db, 20);
  const netWorth = accounts.reduce((s, a) => s + myShare(a), 0);

  const prev = await lastMonthEnd(db);
  const diff = prev ? netWorth - prev.value : null;
  const pct = prev && prev.value ? (diff! / Math.abs(prev.value)) * 100 : null;

  const signed = (a: (typeof accounts)[number]) =>
    a.balance == null ? null : LIABILITY_TYPES.has(a.type) ? -a.balance : a.balance;
  // Set-aside money, capped at the balance; only counts while the account is in net worth.
  const setAside = (a: (typeof accounts)[number]) => heldFor(a);
  const groups: PanelGroup[] = GROUPS.map((g) => {
    const items = accounts.filter((a) => groupFor(a) === g);
    return {
      key: g,
      label: GROUP_LABELS[g],
      // Totals = exactly what this group adds to net worth (hidden accounts and set-aside money excluded),
      // so the group totals always sum to net worth.
      total: items.reduce((s, a) => s + myShare(a), 0),
      hidden: items.filter((a) => !a.include_in_net_worth).reduce((s, a) => s + (signed(a) ?? 0), 0),
      banks: toBanks(items.map((a) => {
        const manual = a.source === "manual";
        const stale = manual && !!a.balance_as_of && Date.now() - Date.parse(a.balance_as_of) > STALE_DAYS * 86_400_000;
        const meta = manual
          ? `Updated ${a.balance_as_of ? shortDate(a.balance_as_of) : "never"}${stale ? " — time to update" : ""}`
          : a.source === "plaid"
            ? `${a.institution ?? "Plaid"} · synced ${syncedLabel(a.last_synced_at)}${a.connection_status && a.connection_status !== "active" ? ` · ${a.connection_status.replace("_", " ")}` : ""}`
            : `CSV import${a.balance_as_of ? ` · balance as of ${shortDate(a.balance_as_of)}` : ""}`;
        return {
          id: a.id, name: accountLabel(a), meta, balance: signed(a), included: !!a.include_in_net_worth,
          manual, stale, heldForOthers: a.net_worth_held_for_others, heldMode: a.net_worth_held_mode === "all" ? "all" : "amount", canSetAside: g === "cash" || g === "parents",
          rawName: a.name, type: a.type, liability: LIABILITY_TYPES.has(a.type),
          heldAmount: g === "parents" ? (a.include_in_net_worth ? 0 : signed(a) ?? 0) : setAside(a),
          share: myShare(a), bank: manual ? `manual:${a.id}` : a.institution ?? a.source, synced: a.last_synced_at,
        };
      })),
    };
  });
  const totalOf = (k: string) => groups.find((g) => g.key === k)!.total;
  const hiddenOf = (k: string) => groups.find((g) => g.key === k)!.hidden;
  const instNames = (k: string) => {
    const names = [...new Set(accounts.filter((a) => groupFor(a) === k).map((a) => (a.source === "manual" ? "manual" : a.institution ?? a.source)))];
    return names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "") : "None yet";
  };
  const parentsAccts = accounts.filter((a) => groupFor(a) === "parents");
  const parentsFull = parentsAccts.reduce((s, a) => s + (signed(a) ?? 0), 0);
  const parentsHidden = parentsAccts.filter((a) => !a.include_in_net_worth).reduce((s, a) => s + (signed(a) ?? 0), 0);
  const asideAccts = accounts.filter((a) => setAside(a) > 0);
  const asideTotal = asideAccts.reduce((s, a) => s + setAside(a), 0);
  const heldTotal = asideTotal + parentsHidden;
  const heldNote = [
    asideTotal > 0 ? `${dollars(asideTotal)} in ${asideAccts.length} account${asideAccts.length === 1 ? "" : "s"}` : null,
    parentsAccts.length ? `${dollars(parentsFull)} in family accounts${parentsHidden !== parentsFull ? " (partly counted)" : ""}` : null,
  ].filter(Boolean).join(" · ") || "Use the pencil on a cash account to hold money for others";
  const visibleGroups = groups.filter((g) => g.key !== "parents" || g.banks.length > 0);
  const anyEstimate = quarters.points.some((p) => p.estimate);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[32px] font-semibold">Overview</h1>
      </div>

      <section aria-label="Net worth" className="flex flex-wrap items-stretch gap-7 rounded-2xl border border-border bg-card p-7">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
          <span className="text-sm font-semibold text-ink-2">Net worth</span>
          <span className="font-heading text-[52px] font-semibold leading-none">{dollars(netWorth)}</span>
          {diff != null && prev && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={diff >= 0 ? "rounded-full bg-accent px-2.5 py-1 text-[13px] font-semibold text-accent-foreground" : "rounded-full bg-warn-soft px-2.5 py-1 text-[13px] font-semibold text-warn"}>
                {diff >= 0 ? "+" : "−"}{dollars(Math.abs(diff))} ({diff >= 0 ? "+" : "−"}{Math.abs(pct!).toFixed(1)}%)
              </span>
              <span className="text-[13px] text-muted-foreground">
                vs. {shortDate(prev.date)} snapshot
              </span>
            </div>
          )}
          <p className="mt-1 text-[13px] text-ink-2">
            {dollars(totalOf("cash"))} cash + {dollars(totalOf("invest"))} investments + {dollars(totalOf("retire"))} retirement
            {totalOf("cards") !== 0 && <> − {dollars(-totalOf("cards"))} card balances</>}
            {totalOf("parents") !== 0 && <> + {dollars(totalOf("parents"))} family accounts counted</>}
          </p>
          <p className="text-[13px] leading-normal text-muted-foreground">
            Cash, investments and retirement minus card balances. Excludes money held for others.
          </p>
        </div>
        <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Estimated net worth, quarter-end</span>
          {quarters.points.length ? (
            <>
              <NetWorthTrend points={quarters.points} />
              <p className="mt-1 text-[11px] leading-normal text-[#8A8A93]">
                Estimate. Cash, cards and Treasury come from your transactions.
                {anyEstimate && " Other investments grow evenly from $0 to today\u2019s balance. Add dated balances to a manual account to improve it."}
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-hairline px-4 py-6 text-sm text-ink-2">
              The quarter-end chart appears once there are more than 2 quarters of history. Next unlock: {quarters.appearsOn ? shortDate(quarters.appearsOn) : "soon"}.
            </p>
          )}
        </div>
      </section>

      <OverviewExplorer groups={visibleGroups} recent={<RecentTransactions rows={recent} />}
        cards={[
          ...(["cash", "invest", "retire"] as const).map((k) => ({
            key: k, label: GROUP_LABELS[k], value: dollars(totalOf(k)),
            note: [
              k === "cash" && asideTotal > 0 ? `After ${dollars(asideTotal)} held for others` : null,
              hiddenOf(k) ? `${dollars(hiddenOf(k))} hidden not included` : null,
            ].filter(Boolean).join(" · ") || instNames(k),
          })),
          { key: "held" as const, label: "Held for others", value: dollars(heldTotal), note: `${heldNote}. Not in net worth.` },
        ]} />
    </>
  );
}
