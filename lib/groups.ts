/** Account groups shown on the Overview. */
export const GROUPS = ["cash", "invest", "retire", "parents", "cards"] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  cash: "Cash and savings",
  invest: "Investments",
  retire: "Retirement",
  parents: "Family money",
  cards: "Credit cards",
};

// Plaid investment subtypes that are retirement accounts.
const RETIREMENT_SUBTYPES = new Set([
  "401a", "401k", "403b", "457b", "529", "ira", "roth", "roth 401k", "sep ira", "simple ira", "sarsep",
  "keogh", "pension", "profit sharing plan", "retirement", "rrif", "rrsp", "tfsa", "lira", "lrif", "tsp",
  "thrift savings plan", "non-taxable brokerage account", "other annuity", "fixed annuity", "variable annuity",
]);
const RETIREMENT_NAME = /\b(401\s*\(?k\)?|403\s*\(?b\)?|457|ira|roth|pension|retirement|tsp)\b/i;

/** Default group when the account has none set. */
export function groupFor(a: { account_group?: string | null; type: string; subtype?: string | null; name?: string | null }): Group {
  if (a.account_group && (GROUPS as readonly string[]).includes(a.account_group)) return a.account_group as Group;
  if (a.type === "credit" || a.type === "loan") return "cards";
  if (a.type === "investment" || a.type === "other") {
    if (RETIREMENT_SUBTYPES.has((a.subtype ?? "").toLowerCase()) || RETIREMENT_NAME.test(a.name ?? "")) return "retire";
    return "invest";
  }
  return "cash";
}

/** Account type to store for a manual account created in a group. */
export const TYPE_FOR_GROUP: Record<Group, string> = {
  cash: "depository",
  invest: "investment",
  retire: "investment",
  parents: "depository",
  cards: "credit",
};
