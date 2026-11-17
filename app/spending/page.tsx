import Link from "next/link";
import { toggleCls } from "@/components/spending/averages";
import { getDb } from "@/lib/db";
import {
  categoryDetail, lastMonths, listTransactions, matchesFor, monthlyIncome, monthlyInvested, monthlySpending, monthReturns,
} from "@/lib/queries";
import { reviewItems } from "@/lib/review";
import { dollars, monthLong, monthShort } from "@/lib/format";
import IncomeSpendChart from "@/components/spending/income-spend-chart";
import ReviewList from "@/components/spending/review-list";
import MonthExplorer from "@/components/spending/month-explorer";
import { Summary, whereItWent } from "@/components/spending/averages";
import MonthPicker from "@/components/spending/month-picker";

export const dynamic = "force-dynamic";

type SP = Promise<{ month?: string; avg?: string; range?: string }>;

const RANGES = [6, 12, 24];
const DEFAULT_RANGE = 6;

export default async function SpendingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const thisMonth = lastMonths(1)[0];
  const spend = await monthlySpending(db, 48);
  const income = await monthlyIncome(db);
  const invested = await monthlyInvested(db);
  const point = (k: string) => {
    const s = spend.find((x) => x.month === k);
    return {
      key: k, label: monthShort(k),
      income: income.find((x) => x.month === k)?.income ?? 0,
      invested: invested.find((x) => x.month === k)?.invested ?? 0,
      net: s?.net ?? 0, returned: s?.refunded ?? 0, spent: s?.gross ?? 0,
    };
  };

  const selected = sp.month && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const isCurrent = selected === thisMonth;
  const [y, m] = selected.split("-").map(Number);
  const avgMonths = sp.avg === "12" ? 12 : 6;
  const wantedRange = RANGES.includes(Number(sp.range)) ? Number(sp.range) : DEFAULT_RANGE;

  // SP-4 / SP-9: the chart shows `wantedRange` months, and widens if the chosen month is older than that.
  const [ty, tm] = thisMonth.split("-").map(Number);
  const monthsBack = (ty - y) * 12 + (tm - m) + 1;
  const range = Math.max(wantedRange, monthsBack);
  const keys = lastMonths(range);
  const months = keys.map(point);
  const cur = point(selected);

  // Query string kept by every link and click on this page.
  const q = (o: { range?: number; avg?: number }) =>
    `${(o.range ?? wantedRange) !== DEFAULT_RANGE ? `&range=${o.range ?? wantedRange}` : ""}${(o.avg ?? avgMonths) === 12 ? "&avg=12" : ""}`;
  const pageQuery = q({});

  const trail = lastMonths(avgMonths, new Date(y, m - 1, 1)).map(point);
  const avg = Math.round(trail.reduce((s, x) => s + x.net, 0) / trail.length);
  // Saved = income − spending. Where it went = that split into money moved to investments (Robinhood, Treasury, …) and cash.
  const trailIncome = trail.reduce((s, x) => s + x.income, 0);
  const avgSaved = Math.round((trailIncome - trail.reduce((s, x) => s + x.net, 0)) / trail.length);
  const avgRate = trailIncome > 0 ? Math.round(((avgSaved * trail.length) / trailIncome) * 100) : null;
  const avgInvested = Math.round(trail.reduce((s, x) => s + x.invested, 0) / trail.length);
  const avgIncome = Math.round(trailIncome / trail.length);
  const saved = cur.income - cur.net;
  const rate = cur.income > 0 ? Math.round((saved / cur.income) * 100) : null;

  const cats = (await categoryDetail(db, selected)).filter((c) => c.net !== 0);
  const review = await reviewItems(db, selected);

  // Months you can pick: back to your first transaction (at most 4 years)
  const first = (await db.get<{ d: string | null }>("SELECT MIN(date) AS d FROM transactions WHERE removed = 0"))?.d;
  const firstMonth = first ? first.slice(0, 7) : thisMonth;
  const monthOptions = lastMonths(48).filter((k) => k >= firstMonth).reverse()
    .map((k) => ({ value: k, label: `${monthLong(k)} ${k.slice(0, 4)}` }));

  // This month's transactions (everything; the explorer filters on the client)
  const lastDay = new Date(y, m, 0).getDate();
  const { rows, truncated } = await listTransactions(db, {
    from: `${selected}-01`, to: `${selected}-${String(lastDay).padStart(2, "0")}`,
  });
  // Refunds received in other months that count toward this month's purchases
  const { counts: returnCounts, fromOtherMonths } = await monthReturns(db, selected);
  const { rows: extraRows } = await listTransactions(db, { ids: fromOtherMonths });
  const matches = Object.fromEntries(await matchesFor(db, [...rows, ...extraRows].map((r) => r.id)));
  // Accounts whose money isn't yours (held for others in full) or left out of spending: not your income.
  const notMine = (await db.all<{ id: string }>(
    "SELECT id FROM accounts WHERE net_worth_held_mode = 'all' OR include_in_spending = 0")).map((a) => a.id);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[32px] font-semibold">Spending</h1>
      </div>

      <section aria-label="Income and spending by month" className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Income and spending</h2>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-3.5 text-xs text-ink-2">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-income" />Income</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-spend" />Spent (net)</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-returned" />Returned</span>
            </div>
            <div role="group" aria-label="Months shown" className="flex overflow-hidden rounded-md border border-input text-[13px] font-semibold">
              {RANGES.map((n, i) => (
                <Link key={n} scroll={false} aria-pressed={range === n} href={`/spending?month=${selected}${q({ range: n })}`}
                  className={toggleCls(range === n, i === 0)}>{n} mo</Link>
              ))}
            </div>
          </div>
        </div>
        <IncomeSpendChart months={months} selected={selected} query={pageQuery} />
        <p className="text-xs text-muted-foreground">
          Click a month to see it below. Returns count in the month of the original purchase. Moving money between your own accounts isn&apos;t income.
          {range > wantedRange && ` Showing ${range} months so ${monthLong(selected)} is included.`}
        </p>
      </section>

      {/* Everything below follows this month: pick it here or click a bar in the chart */}
      <div id="month" className="flex scroll-mt-4 flex-wrap items-end justify-between gap-3 border-b border-border pb-3 pt-2">
        <h2 className="font-heading text-[24px] font-semibold leading-none">{monthLong(selected)} {selected.slice(0, 4)}</h2>
        <div className="flex items-center gap-3">
          {!isCurrent && <Link href={`/spending${pageQuery ? `?${pageQuery.slice(1)}` : ""}`} scroll={false} className="text-sm">Back to this month</Link>}
          <MonthPicker month={selected} options={monthOptions} query={pageQuery} />
        </div>
      </div>

      <Summary monthLabel={monthLong(selected)} avgMonths={avgMonths} href={(n) => `/spending?month=${selected}${q({ avg: n })}`}
        averageLabel={`Average month · ${trail[0].label} ${trail[0].key.slice(0, 4)} – ${trail[trail.length - 1].label} ${selected.slice(0, 4)}`}
        month={[
          { label: "Net spending", value: dollars(cur.net), tone: "spend", sub: `${dollars(cur.spent)} spent, ${dollars(cur.returned)} returned` },
          { label: "Income", value: dollars(cur.income), tone: "income", sub: "Paychecks, interest, dividends" },
          { label: "Saved", value: dollars(saved), sub: rate != null ? `${rate}% of income` : "No income recorded" },
          whereItWent(saved, cur.invested),
        ]}
        average={[
          { label: "Net spending", value: dollars(avg), sub: "Net of returns" },
          { label: "Income", value: dollars(avgIncome), sub: "Paychecks, interest, dividends" },
          { label: "Saved", value: dollars(avgSaved), sub: avgRate != null ? `${avgRate}% of income` : "No income recorded" },
          whereItWent(avgSaved, avgInvested, true),
        ]} />

      <ReviewList items={review} />

      <MonthExplorer key={selected} monthLabel={monthLong(selected)} categories={cats} rows={rows} matches={matches} truncated={truncated}
        extraRefunds={extraRows} returnCounts={Object.fromEntries(returnCounts)} month={selected} notMineAccounts={notMine}
 />
    </>
  );
}
