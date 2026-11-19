import PrivacyToggle from "@/components/privacy-toggle";
import RefreshButton from "@/components/investments/refresh-button";
import { isDemo } from "@/lib/hosted";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { dollars, shortDate } from "@/lib/format";
import {
  ASSET_LABELS, TAX_LABELS, allocation, combine, investmentActivity, investmentConnections, investmentQuarters, investmentSummary,
  listManualHoldings, portfolio, weeklyValues,
} from "@/lib/investments";
import { groupFor } from "@/lib/groups";
import { accountLabel, listAccounts } from "@/lib/queries";
import Allocation from "@/components/investments/allocation";
import Concentration from "@/components/investments/concentration";
import HoldingsTable from "@/components/investments/holdings-table";
import Activity from "@/components/investments/activity";
import NetWorthTrend from "@/components/overview/net-worth-trend";
import WeeklyChart from "@/components/investments/weekly-chart";

export const dynamic = "force-dynamic";

function Card({ label, value, tone, note }: { label: string; value: string; tone?: "gain" | "loss"; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-[18px]">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={"sensitive " + (tone === "gain" ? "font-heading text-[26px] font-semibold text-income-ink" : tone === "loss" ? "font-heading text-[26px] font-semibold text-warn" : "font-heading text-[26px] font-semibold")}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${dollars(Math.abs(c))}`;
const pctText = (p: number | null) => (p == null ? "" : ` (${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%)`);

export default async function InvestmentsPage() {
  const db = getDb();
  const lines = await portfolio(db);
  const s = await investmentSummary(db, lines);
  const rows = combine(lines);
  const conns = await investmentConnections(db);
  const notShared = conns.filter((c) => !c.investments_enabled).length;
  const quarters = await investmentQuarters(db);
  const activity = await investmentActivity(db);
  const weeks = await weeklyValues(db);
  const manualHoldings = await listManualHoldings(db);
  const allAccounts = await listAccounts(db);
  // Same split as the Overview's Investments and Retirement cards
  const retire = new Set(allAccounts.filter((a) => groupFor(a) === "retire").map((a) => a.id));
  const retireTotal = lines.filter((l) => retire.has(l.accountId)).reduce((t, l) => t + l.value, 0);
  const manualAccounts = allAccounts
    .filter((a) => a.source === "manual" && a.include_in_net_worth && ["invest", "retire"].includes(groupFor(a)))
    .map((a) => ({ id: a.id, name: accountLabel(a) }));

  const views = {
    asset: allocation(lines, (l) => l.assetType).map((r) => ({ ...r, label: ASSET_LABELS[r.key] })),
    tax: allocation(lines, (l) => l.taxType).map((r) => ({ ...r, label: TAX_LABELS[r.key] })),
    account: allocation(lines, (l) => l.account).map((r) => ({ ...r, label: r.key })),
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[32px] font-semibold">Investments</h1>
          <p className="text-sm text-muted-foreground">Investment and retirement accounts, including the ones you track by hand.</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {!isDemo() && <RefreshButton />}
          <PrivacyToggle />
        </div>
      </div>

      {notShared > 0 && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {notShared} connection{notShared === 1 ? "" : "s"} only share{notShared === 1 ? "s" : ""} balances, so those accounts show as one line.{" "}
          <Link href="/connect" className="font-semibold text-warn underline">Add investment details</Link> to see holdings, cost basis and dividends.
        </div>
      )}

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Total value" value={dollars(s.total)}
          note={`${dollars(s.total - retireTotal)} investments + ${dollars(retireTotal)} retirement, as on Overview`} />
        {s.gain
          ? <Card label="Unrealized gain" value={signed(s.gain.amount) + pctText(s.gain.pct)} tone={s.gain.amount > 0 ? "gain" : s.gain.amount < 0 ? "loss" : undefined}
              note={s.noBasisValue > 0 ? `${dollars(s.noBasisValue)} has no cost basis, not included` : "All holdings have a cost basis"} />
          : <Card label="Unrealized gain" value="—" note={`No cost basis yet · ${dollars(s.noBasisValue)} without one`} />}
        {/* Change: vs. the last month-end value, plus the weekly line. Blank where nothing was saved. */}
        <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-[18px] sm:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[13px] text-muted-foreground">Change since last month-end</span>
            <span className="text-xs text-muted-foreground">
              {s.change ? `vs. ${shortDate(s.change.since)}` : `First month-end value: ${shortDate(s.firstMonthEnd)}`}
            </span>
          </div>
          <span className={s.change && s.change.amount > 0 ? "font-heading text-[26px] font-semibold text-income-ink" : s.change && s.change.amount < 0 ? "font-heading text-[26px] font-semibold text-warn" : "font-heading text-[26px] font-semibold"}>
            {s.change ? signed(s.change.amount) + pctText(s.change.pct) : "—"}
          </span>
          <WeeklyChart weeks={weeks} />
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Allocation views={views} />
        <Concentration rows={rows} total={s.total} />
      </div>

      <HoldingsTable lines={lines} total={s.total} manualAccounts={manualAccounts} manualHoldings={manualHoldings} />

      <section aria-label="Value over time" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Value over time, quarter-end</h2>
        {quarters.points.length ? (
          <>
            <NetWorthTrend points={quarters.points} what="Investments" />
            <p className="mt-1 text-[11px] leading-normal text-[#8A8A93]">From saved daily values only. Includes money you added, not just market growth.</p>
          </>
        ) : (
          <p className="rounded-lg bg-hairline px-4 py-6 text-sm text-ink-2">
            Built from real daily values only, starting the first day you synced. It appears with the 3rd quarter-end: {quarters.appearsOn ? shortDate(quarters.appearsOn) : "soon"}.
          </p>
        )}
      </section>

      <Activity rows={activity} dividends={{
        year: new Date().getFullYear(), total: s.dividends, count: s.dividendCount,
        // Only a real total when the broker's activity covers the whole year
        complete: !!s.activitySince && s.activitySince <= `${new Date().getFullYear()}-01-01`,
      }} />

      <p className="text-[11px] leading-normal text-[#8A8A93]">
        Prices are the broker&apos;s latest close, not live. Gain uses only holdings with a cost basis. A value is saved every day you sync, so change over time builds from today.
      </p>
    </>
  );
}
