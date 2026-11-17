"use client";
import { useRouter } from "next/navigation";

/** Switch the month the whole section below shows (summary, categories, transactions). Stays in sync with the chart. */
export default function MonthPicker({ month, options, query }: { month: string; options: { value: string; label: string }[]; query: string }) {
  const router = useRouter();
  return (
    <select aria-label="Month" value={month} onChange={(e) => router.push(`/spending?month=${e.target.value}${query}`, { scroll: false })}
      className="h-9 rounded-lg border border-input bg-card px-2.5 text-[13px] font-medium">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
