import PrivacyToggle from "@/components/privacy-toggle";
import PayUpload from "@/components/files/pay-upload";
import { notFound } from "next/navigation";
import { compensationEnabled, payUploadsEnabled } from "@/lib/hosted";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { dollars, money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  GROUP_LABELS, TABLE_LABELS, basePayHistory, compStatements, isNonCash, keyRates, monthlyTakeHome, rsuVests, tableGroupOf, totals,
  type CompStatement, type Group, type TableGroup,
} from "@/lib/compensation/queries";
import KeyRates, { type KeyRatesData, type RateTile } from "@/components/compensation/key-rates";
import PaycheckFlow, { type FlowView } from "@/components/compensation/paycheck-flow";
import MonthlyTable, { type TableGroupData } from "@/components/compensation/monthly-table";
import RsuVests, { type VestDate } from "@/components/compensation/rsu-vests";
import BasePayChart, { toSteps } from "@/components/compensation/base-pay-chart";
import { toggleCls } from "@/components/spending/averages";

export const dynamic = "force-dynamic";

// Segment colors: labeled rows carry identity; colors also differ in lightness.
const COLORS: Record<string, string> = {
  taxes: "#F08A3C", benefits: "#9DBFE3", retirement: "#6F5FD0", other: "#C9C9C2", takehome: "#22A05A",
};

type W2Row = { year: number; box1: number; box2: number; box4: number; box6: number; box12: string; box14: string; summary: string };

/** One number in the summary equation. */
function Figure({ label, value, tone, note }: { label: string; value: string; tone?: "income" | "muted"; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn("sensitive font-heading text-[19px] font-semibold leading-tight sm:text-[22px] md:text-[28px]", tone === "income" && "text-income-ink", tone === "muted" && "text-muted-foreground")}>{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
const Op = ({ c }: { c: string }) => <span aria-hidden="true" className="pt-5 text-lg font-light text-muted-foreground md:text-xl">{c}</span>;

/** Cash + RSU = Total on one line that never wraps mid-equation, then take-home on its own. */
function SummaryCard({ title, cash, rsu, total, takeHome }: { title: string; cash: number; rsu: number; total: number; takeHome: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <span className="text-[13px] font-semibold">{title}</span>
      <div className="grid gap-4 xl:grid-cols-[auto_1fr]">
        <div className="flex flex-nowrap items-start gap-2 md:gap-3">
          <Figure label="Cash pay" value={dollars(cash)} /><Op c="+" />
          <Figure label="RSU (stock)" value={dollars(rsu)} /><Op c="=" />
          <Figure label="Total pay" value={dollars(total)} />
        </div>
        <div className="border-t border-hairline pt-3 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">{takeHome}</div>
      </div>
    </div>
  );
}

/** The cash side of a set of statements (vests excluded), as bar segments that add up to gross cash pay. */
function flow(sts: CompStatement[], key: string, label: string, title: string, rsuSts: CompStatement[], rsuTitle: string, sameScale: boolean): FlowView {
  const cash = sts.filter((s) => s.kind !== "vest");
  const t = totals(cash);
  const lines = (g: Group) => t.lines.filter((l) => l.group === g).sort((a, b) => b.amount - a.amount).map((l) => ({ label: l.label, amount: l.amount }));
  const gross = t.g("earnings");
  const takeHome = gross - t.g("taxes") - t.g("benefits") - t.g("retirement") - t.g("other");
  const r = totals(rsuSts);
  return {
    key, label, title, cashGross: gross, cashLines: lines("earnings"),
    segments: [
      { key: "taxes", label: GROUP_LABELS.taxes, amount: t.g("taxes"), color: COLORS.taxes, lines: lines("taxes") },
      { key: "benefits", label: GROUP_LABELS.benefits, amount: t.g("benefits"), color: COLORS.benefits, lines: lines("benefits") },
      { key: "retirement", label: GROUP_LABELS.retirement, amount: t.g("retirement"), color: COLORS.retirement, lines: lines("retirement") },
      { key: "other", label: GROUP_LABELS.other, amount: t.g("other"), color: COLORS.other, lines: lines("other") },
      { key: "takehome", label: "Take-home pay", amount: takeHome, color: COLORS.takehome, lines: [] },
    ],
    added: lines("added").map((l) => ({ label: l.label, amount: -l.amount })),
    deposited: t.net,
    rsu: rsuSts.length ? {
      title: rsuTitle, income: r.g("rsu_income"), taxes: r.g("taxes"), kept: r.g("rsu_kept"),
      lines: r.lines.filter((l) => l.group === "taxes").sort((a, b) => b.amount - a.amount).map((l) => ({ label: l.label, amount: l.amount })),
    } : null,
    sameScale,
  };
}

type SP = Promise<{ year?: string }>;

export default async function CompensationPage({ searchParams }: { searchParams: SP }) {
  // Hosted with HOSTED_INCLUDE_COMPENSATION off: the tab doesn't exist
  if (!compensationEnabled()) notFound();
  const uploads = payUploadsEnabled();
  const db = getDb();
  const today = new Date().toLocaleDateString("en-CA");
  const thisMonth = today.slice(0, 7);
  const stYears = (await db.all<{ y: string }>("SELECT DISTINCT substr(pay_date, 1, 4) AS y FROM comp_statements")).map((r) => r.y);
  const w2s = await db.all<W2Row>("SELECT year, box1, box2, box4, box6, box12, box14, summary FROM comp_w2");
  const years = [...new Set([...stYears, ...w2s.map((w) => String(w.year))])].sort().reverse();
  if (!years.length) {
    return (
      <>
        <h1 className="text-[32px] font-semibold">Compensation</h1>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-sm text-ink-2">
          No pay data yet.{" "}
          {uploads ? <>Add your pay statements and W-2s to get started.<PayUpload /></> : "Add pay documents in the app on your Mac, then upload the data again."}
        </div>
      </>
    );
  }
  const sp = await searchParams;
  const year = sp.year && years.includes(sp.year) ? sp.year : years[0];
  const isCurrent = year === today.slice(0, 4);

  // Base salary in effect at the end of that year (today for this year), and the last raise in it
  const base = await basePayHistory(db);
  const asOf = isCurrent ? today : `${year}-12-31`;
  const inEffect = base.filter((b) => b.effective_date <= asOf);
  const current = inEffect[0];
  const changesUpTo = inEffect.map((b, i) => ({ b, prev: inEffect[i + 1] }))
    .filter(({ b, prev }) => prev?.annual && b.annual && Math.abs(b.annual - prev.annual) / prev.annual > 0.001);
  const lastRaise = changesUpTo[0];
  const raise = lastRaise ? { date: lastRaise.b.effective_date, pct: ((lastRaise.b.annual! - lastRaise.prev!.annual!) / lastRaise.prev!.annual!) * 100 } : null;

  // Top right of the page: year switch, then the eye that hides the headline numbers
  const yearPicker = (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Year" className="flex overflow-hidden rounded-md border border-input text-[13px] font-semibold">
        {years.map((y, i) => (
          <Link key={y} href={y === years[0] ? "/compensation" : `/compensation?year=${y}`} scroll={false} aria-pressed={y === year} className={toggleCls(y === year, i === 0)}>{y}</Link>
        ))}
      </div>
      <PrivacyToggle />
    </div>
  );

  const rateCard = (
    <div className="flex flex-col gap-0.5 rounded-xl border border-primary/25 bg-accent p-4 text-accent-foreground md:p-5">
      <span className="text-[13px] font-semibold">Base salary{isCurrent ? "" : ` · end of ${year}`}</span>
      <span className="sensitive font-heading text-[22px] font-semibold leading-tight md:text-[28px]">{current?.annual != null ? dollars(current.annual) : "—"}</span>
      {current && <span className="text-xs"><span className="sensitive">{money(current.period_rate)}</span> per paycheck</span>}
      {raise && raise.date.startsWith(year) && <span className="text-xs">+{raise.pct.toFixed(1)}% on {shortDate(raise.date)}</span>}
      {raise && !raise.date.startsWith(year) && <span className="text-xs">No raise in {year}</span>}
    </div>
  );

  const sts = await compStatements(db, year);

  // ---------- Past year without paystubs: from the W-2 ----------
  if (!sts.length) {
    const w = w2s.find((x) => String(x.year) === year)!;
    const b12 = JSON.parse(w.box12) as Record<string, number>;
    const rsu = (JSON.parse(w.box14) as { label: string; cents: number }[]).filter((x) => /rsu/i.test(x.label)).reduce((t, x) => t + x.cents, 0);
    const gross = (JSON.parse(w.summary) as { gross: number | null }).gross ?? w.box1;
    const taxes = w.box2 + w.box4 + w.box6;
    const pct = (c: number) => (gross ? (c / gross) * 100 : 0);
    const tiles: RateTile[] = [
      ...(b12.D || b12.AA ? [{ label: "401(k) contributions", big: dollars((b12.D ?? 0) + (b12.AA ?? 0)), unit: "total",
        lines: [`Pre-tax ${dollars(b12.D ?? 0)}${b12.AA ? ` · Roth ${dollars(b12.AA)}` : ""}`] }] : []),
      ...(b12.W ? [{ label: "HSA contributions", big: dollars(b12.W), lines: [`≈ ${dollars(Math.round(b12.W / 12))} a month`] }] : []),
      { label: "Tax rate", big: `${pct(taxes).toFixed(1)}%`, unit: "of total pay",
        lines: [`Federal ${pct(w.box2).toFixed(1)}% · Social Security ${pct(w.box4).toFixed(1)}% · Medicare ${pct(w.box6).toFixed(1)}%`] },
    ];
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[32px] font-semibold">Compensation</h1>
          {yearPicker}
        </div>
        <section aria-label="Summary" className="grid gap-3 md:gap-4 lg:grid-cols-[3fr_minmax(220px,1fr)]">
          <SummaryCard title={`${year} · from your W-2`} cash={gross - rsu} rsu={rsu} total={gross}
            takeHome={<Figure label="Take-home" value="—" tone="muted" note="Needs paystubs" />} />
          {rateCard}
        </section>
        <KeyRates d={{ tiles, changes: [] }} />
        <p className="rounded-xl border border-dashed border-input p-4 text-sm text-ink-2">
          Add {year} paystubs to <code>data/compensation/paystubs/</code> and run <code>npm run comp:import</code> to see take-home, months and RSU vests.
        </p>
        <BasePayChart steps={toSteps(base)} today={today} />
      </>
    );
  }

  // ---------- Year with paystubs ----------
  const all = totals(sts);
  const vestSts = sts.filter((s) => s.kind === "vest");
  const paychecks = sts.filter((s) => s.kind === "paycheck");
  const last = paychecks[paychecks.length - 1];
  const lastVestDate = vestSts.length ? vestSts[vestSts.length - 1].periodEnd : null;
  const through = sts[sts.length - 1].payDate;

  // Your rates
  const kr = keyRates(sts);
  const th = monthlyTakeHome(sts, isCurrent ? thisMonth : `${Number(year) + 1}-01`);
  const monthName = (m: string | null) => (m ? new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" }) : "");
  const taxPct = all.gross ? (all.g("taxes") / all.gross) * 100 : 0;
  // Same numbers the two bars below show: taxes on cash pay vs taxes withheld from RSUs
  const cashT = totals(sts.filter((s) => s.kind !== "vest"));
  const rsuT = totals(vestSts);
  const cashTaxPct = cashT.g("earnings") ? (cashT.g("taxes") / cashT.g("earnings")) * 100 : 0;
  const rsuTaxPct = rsuT.g("rsu_income") ? (rsuT.g("taxes") / rsuT.g("rsu_income")) * 100 : 0;
  const tiles: RateTile[] = [
    ...(kr.latest ? [{ label: "401(k)", big: kr.latest.k401Pct != null ? `${kr.latest.k401Pct}%` : "—", unit: "of salary",
      lines: [`${money(kr.latest.k401)} per paycheck`, `${dollars(kr.ytd.k401)} this year${kr.ytd.roth ? ` · Roth ${dollars(kr.ytd.roth)}` : ""}`] }] : []),
    ...(kr.latest && kr.ytd.hsa ? [{ label: "HSA", big: money(kr.latest.hsa), unit: "per paycheck",
      lines: [`≈ ${dollars(Math.round((kr.latest.hsa * kr.paychecksPerYear) / 12))} a month`, `${dollars(kr.ytd.hsa)} this year`] }] : []),
    { label: "Tax rate", big: `${taxPct.toFixed(1)}%`, unit: "overall",
      lines: [`Cash pay ${cashTaxPct.toFixed(1)}% · RSUs ${rsuTaxPct.toFixed(1)}%`] },
  ];
  const bonusAfterTax = th.bonuses.reduce((t, b) => t + b.afterTax, 0);
  const rates: KeyRatesData = {
    tiles,
    takeHome: th.months ? { withBonus: th.withBonus, withoutBonus: th.withoutBonus, range: `${monthName(th.from)}–${monthName(th.to)}`, bonusAfterTax } : undefined,
    changes: kr.changes,
  };

  // Where my paycheck goes
  const views: FlowView[] = [
    flow(sts, "ytd", isCurrent ? `${year} so far` : year, `Through ${shortDate(through)} · bars drawn to the same scale`, vestSts,
      `${new Set(vestSts.map((s) => s.periodEnd)).size} vests`, true),
    ...(last ? [flow([last], "latest", "Latest", `Paycheck ${shortDate(last.payDate)}${lastVestDate ? ` · vest ${shortDate(lastVestDate)}` : ""}`,
      vestSts.filter((s) => s.periodEnd === lastVestDate), lastVestDate ? `vest on ${shortDate(lastVestDate)}` : "", false)] : []),
  ];

  // Month by month
  const months = [...new Set(sts.map((s) => s.payDate.slice(0, 7)))];
  const complete = months.map((m) => !isCurrent || m < thisMonth);
  const ORDER: TableGroup[] = ["earnings", "rsu_income", "taxes", "pretax", "posttax", "rsu_kept", "added"];
  const groups: TableGroupData[] = ORDER.map((g) => {
    const flip = g === "added" ? -1 : 1; // additions are stored negative
    const labels = new Map<string, { nonCash: boolean; values: number[] }>();
    for (const s of sts) for (const l of s.lines) {
      if (tableGroupOf(l) !== g) continue;
      const row = labels.get(l.label) ?? { nonCash: isNonCash(l), values: months.map(() => 0) };
      row.values[months.indexOf(s.payDate.slice(0, 7))] += l.current * flip;
      labels.set(l.label, row);
    }
    const rows = [...labels.entries()].map(([label, r]) => ({ label, nonCash: r.nonCash, values: r.values, total: r.values.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => Number(a.nonCash) - Number(b.nonCash) || b.total - a.total);
    const values = months.map((_, i) => rows.reduce((t, r) => t + r.values[i], 0));
    const nonCash = g === "rsu_income" || g === "rsu_kept";
    return { key: g, label: TABLE_LABELS[g], nonCash, sign: g === "earnings" || g === "rsu_income" || g === "added" ? "+" : "−", rows: nonCash ? [] : rows, values, total: values.reduce((a, b) => a + b, 0) };
  }).filter((g) => g.values.some((v) => v !== 0)) as TableGroupData[];
  const netValues = months.map((m) => sts.filter((s) => s.payDate.startsWith(m)).reduce((t, s) => t + s.net, 0));

  // RSU vests, with the stock sale payout that followed each vest
  const vests = await rsuVests(db, year);
  const payouts = sts.filter((s) => s.kind === "payout").map((s) => ({ date: s.payDate, amount: -s.lines.filter((l) => l.group === "added").reduce((t, l) => t + l.current, 0) }));
  const vestDates: VestDate[] = [...new Set(vests.map((v) => v.vest_date))].map((d) => {
    const gs = vests.filter((v) => v.vest_date === d);
    const payout = payouts.find((p) => p.date > d && Date.parse(p.date) - Date.parse(d) < 35 * 86_400_000) ?? null;
    return {
      date: d, payout,
      value: gs.reduce((t, g) => t + g.usd_value, 0), taxes: gs.reduce((t, g) => t + g.taxes_withheld, 0), kept: gs.reduce((t, g) => t + (g.net_value ?? 0), 0),
      grants: gs.map((g) => ({ value: g.usd_value, taxes: g.taxes_withheld, kept: g.net_value ?? 0, shares: g.shares, fx: g.fx_rate })),
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="text-[32px] font-semibold">Compensation</h1>
          <span className="text-sm text-muted-foreground">Through {shortDate(through)}</span>
        </div>
        {yearPicker}
      </div>

      <section aria-label="Summary" className="grid gap-3 md:gap-4 lg:grid-cols-[3fr_minmax(220px,1fr)]">
        <SummaryCard title={isCurrent ? `${year} so far` : year} cash={all.g("earnings")} rsu={all.g("rsu_income")} total={all.gross}
          takeHome={<Figure label="Take-home" value={dollars(all.net)} tone="income" note="Deposited to your bank" />} />
        {rateCard}
      </section>

      <KeyRates d={rates} />
      <PaycheckFlow views={views} />
      <MonthlyTable months={months} complete={complete} groups={groups} net={{ values: netValues, total: netValues.reduce((a, b) => a + b, 0) }} />
      <RsuVests year={year} vests={vestDates} />
      <BasePayChart steps={toSteps(base)} today={today} />

      {uploads && (
        <section aria-label="Add pay documents" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Add pay documents</h2>
          <PayUpload compact />
        </section>
      )}
    </>
  );
}
