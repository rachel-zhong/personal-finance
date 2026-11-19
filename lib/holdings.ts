/** Investments types and pure helpers, safe to import from client components. */

export const ASSET_TYPES = ["stocks", "funds", "bonds", "cash", "crypto", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_LABELS: Record<AssetType, string> = {
  stocks: "Stocks", funds: "ETFs & funds", bonds: "Bonds & Treasuries", cash: "Cash", crypto: "Crypto", other: "Other",
};

export const TAX_TYPES = ["taxable", "roth", "traditional", "other"] as const;
export type TaxType = (typeof TAX_TYPES)[number];
export const TAX_LABELS: Record<TaxType, string> = {
  taxable: "Taxable", roth: "Roth", traditional: "Traditional / 401k", other: "Other tax-advantaged",
};

export interface HoldingLine {
  key: string;            // combine key across accounts: ticker, else security id, else account line
  securityId: string | null;
  accountId: string;
  account: string;
  institution: string | null;
  taxType: TaxType;
  assetType: AssetType;
  name: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;   // dollars
  value: number;          // cents
  costBasis: number | null;
  kind: "holding" | "account"; // account = one line for a whole account (manual, or holdings not loaded)
  note?: string;
  manualId?: string;      // set for holdings you added by hand (IN-7)
  manualAccount?: boolean; // the account itself is one you track by hand
}

export interface AccountFilter { key: string; label: string; value: number; accountIds: string[] }

const SMALL_ACCOUNT = 3000; // cents: accounts under $30 go into "Other"

/**
 * Account filter buttons, merged so there are fewer of them:
 *  - every account you track by hand → "Tracked by hand"
 *  - taxable accounts at the same broker → one button named after the broker (e.g. Robinhood individual + crypto)
 *  - any account worth under $30 → "Other"
 */
export function accountFilters(lines: HoldingLine[]): AccountFilter[] {
  const byAcct = new Map<string, { name: string; inst: string | null; tax: TaxType; manual: boolean; value: number }>();
  for (const l of lines) {
    const a = byAcct.get(l.accountId) ?? { name: l.account, inst: l.institution, tax: l.taxType, manual: !!l.manualAccount, value: 0 };
    a.value += l.value;
    byAcct.set(l.accountId, a);
  }
  const groups = new Map<string, { names: string[]; inst: string | null; accountIds: string[]; value: number }>();
  for (const [id, a] of byAcct) {
    const key = a.value < SMALL_ACCOUNT ? "other" : a.manual ? "manual"
      : a.tax === "taxable" && a.inst ? `broker:${a.inst}` : `acct:${id}`;
    const g = groups.get(key) ?? { names: [], inst: a.inst, accountIds: [], value: 0 };
    g.names.push(a.name); g.accountIds.push(id); g.value += a.value;
    groups.set(key, g);
  }
  const out = [...groups].map(([key, g]) => ({
    key, accountIds: g.accountIds, value: g.value,
    label: key === "other" ? "Other" : key === "manual" ? "Tracked by hand"
      : g.names.length === 1 ? g.names[0] : g.inst ?? g.names[0],
  }));
  // Biggest first; "Other" always last
  return out.sort((a, b) => (a.key === "other" ? 1 : b.key === "other" ? -1 : b.value - a.value));
}

/** Holdings combined across accounts (IN-12). */
export interface CombinedHolding {
  key: string; name: string; ticker: string | null; assetType: AssetType; quantity: number | null; price: number | null;
  value: number; costBasis: number | null; costBasisPartial: boolean; kind: "holding" | "account"; note?: string;
  accounts: { account: string; value: number; quantity: number | null; manualId?: string; accountId: string }[];
}

export function combine(lines: HoldingLine[]): CombinedHolding[] {
  const by = new Map<string, HoldingLine[]>();
  for (const l of lines) by.set(l.key, [...(by.get(l.key) ?? []), l]);
  return [...by.values()].map((ls) => {
    const f = ls[0];
    const qty = ls.every((l) => l.quantity != null) ? ls.reduce((s, l) => s + (l.quantity ?? 0), 0) : null;
    const withBasis = ls.filter((l) => l.costBasis != null);
    return {
      key: f.key, name: f.name, ticker: f.ticker, assetType: f.assetType, quantity: qty,
      price: ls.find((l) => l.price != null)?.price ?? null,
      value: ls.reduce((s, l) => s + l.value, 0),
      costBasis: withBasis.length ? withBasis.reduce((s, l) => s + (l.costBasis ?? 0), 0) : null,
      costBasisPartial: withBasis.length > 0 && withBasis.length < ls.length,
      kind: f.kind, note: f.note,
      accounts: ls.map((l) => ({ account: l.account, value: l.value, quantity: l.quantity, manualId: l.manualId, accountId: l.accountId })),
    };
  }).sort((a, b) => b.value - a.value);
}

/** Value by a grouping, biggest first (IN-9, IN-10). */
export function allocation<K extends string>(lines: HoldingLine[], keyOf: (l: HoldingLine) => K) {
  const total = lines.reduce((s, l) => s + l.value, 0);
  const by = new Map<K, number>();
  for (const l of lines) by.set(keyOf(l), (by.get(keyOf(l)) ?? 0) + l.value);
  return [...by.entries()].map(([key, value]) => ({ key, value, pct: total ? (value / total) * 100 : 0 }))
    .filter((x) => x.value !== 0).sort((a, b) => b.value - a.value);
}

