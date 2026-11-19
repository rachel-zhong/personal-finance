/**
 * App categories, modeled on NerdWallet-style budgeting categories.
 * Every transaction gets one: from your edit, else your merchant rule, else mapped from the bank's category.
 * The category also decides whether money counts as spending.
 */
import type { Flow } from "./classify";

export type CategoryKind = "spend" | "income" | "transfer";

export const CATEGORIES: { key: string; label: string; kind: CategoryKind }[] = [
  { key: "rent", label: "Rent & Mortgage", kind: "spend" },
  { key: "bills", label: "Bills & Utilities", kind: "spend" },
  { key: "groceries", label: "Groceries", kind: "spend" },
  { key: "dining", label: "Dining", kind: "spend" },
  { key: "shopping", label: "Shopping & Clothing", kind: "spend" },
  { key: "home", label: "Home", kind: "spend" },
  { key: "transport", label: "Auto & Transport", kind: "spend" },
  { key: "travel", label: "Travel", kind: "spend" },
  { key: "entertainment", label: "Hobbies", kind: "spend" },
  { key: "health", label: "Health", kind: "spend" },
  { key: "personal_care", label: "Personal Care", kind: "spend" },
  { key: "insurance", label: "Insurance", kind: "spend" },
  { key: "pets", label: "Pets", kind: "spend" },
  { key: "fees", label: "Fees & Taxes", kind: "spend" },
  { key: "other", label: "Other", kind: "spend" },
  { key: "income", label: "Income", kind: "income" },
  { key: "transfer", label: "Transfer", kind: "transfer" },
  { key: "card_payment", label: "Credit card payment", kind: "transfer" },
  { key: "investments", label: "Investments", kind: "transfer" },
  { key: "loan_payment", label: "Loan payment", kind: "transfer" },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
export const isCategory = (k: string | null | undefined): k is string => !!k && BY_KEY.has(k);
export const categoryLabel = (k: string | null | undefined) => (k && BY_KEY.get(k)?.label) || "Uncategorized";
export const categoryKind = (k: string) => BY_KEY.get(k)?.kind ?? "spend";

/** Bank (Plaid personal_finance_category) → app category. */
export function mapBankCategory(detailed: string | null | undefined, primary: string | null | undefined): string | null {
  const d = (detailed ?? "").toUpperCase();
  const p = (primary ?? "").toUpperCase() || d.split("_").slice(0, 2).join("_");
  if (!d && !p) return null;
  const has = (s: string) => d.startsWith(s);
  if (has("RENT_AND_UTILITIES_RENT") || has("LOAN_PAYMENTS_MORTGAGE")) return "rent";
  if (has("LOAN_PAYMENTS_CREDIT_CARD")) return "card_payment";
  if (p === "LOAN_PAYMENTS") return "loan_payment";
  if (p === "RENT_AND_UTILITIES") return "bills";
  if (has("FOOD_AND_DRINK_GROCERIES")) return "groceries";
  if (p === "FOOD_AND_DRINK") return "dining";
  if (has("GENERAL_MERCHANDISE_PET")) return "pets";
  if (p === "GENERAL_MERCHANDISE") return "shopping";
  if (p === "HOME_IMPROVEMENT") return "home";
  if (p === "TRANSPORTATION" || has("GENERAL_SERVICES_AUTOMOTIVE")) return "transport";
  if (p === "TRAVEL") return "travel";
  if (p === "ENTERTAINMENT") return "entertainment";
  if (has("MEDICAL_VETERINARY")) return "pets";
  if (has("PERSONAL_CARE_GYMS")) return "personal_care";
  if (p === "MEDICAL") return "health";
  if (p === "PERSONAL_CARE") return "personal_care";
  if (has("GENERAL_SERVICES_INSURANCE")) return "insurance";
  if (has("GENERAL_SERVICES_EDUCATION")) return "other";
  if (has("GENERAL_SERVICES_CONSULTING_AND_LEGAL") || has("GENERAL_SERVICES_ACCOUNTING")) return "fees";
  if (p === "GENERAL_SERVICES") return "bills";
  if (has("GOVERNMENT_AND_NON_PROFIT_DONATIONS")) return "other";
  if (p === "GOVERNMENT_AND_NON_PROFIT") return "fees"; // taxes, government fees
  if (p === "BANK_FEES") return "fees";
  if (p === "INCOME") return "income";
  if (has("TRANSFER_OUT_INVESTMENT") || has("TRANSFER_IN_INVESTMENT") || has("TRANSFER_OUT_CRYPTO")) return "investments";
  if (p === "TRANSFER_IN" || p === "TRANSFER_OUT") return "transfer";
  return "other";
}

/** Flow implied by a category you chose: spending categories make money out a purchase and money in a refund. */
export function flowForCategory(category: string, amount: number): Flow {
  const kind = categoryKind(category);
  if (kind === "income") return amount > 0 ? "income" : "transfer";
  if (kind === "transfer") return "transfer";
  return amount < 0 ? "spend" : "refund";
}

/** Without any edit: keep the bank-derived flow, and make the category agree with it. */
export function categoryForFlow(mapped: string | null, flow: Flow): string {
  const kind = mapped ? categoryKind(mapped) : null;
  if (flow === "transfer") return kind === "transfer" ? mapped! : "transfer";
  if (flow === "income") return "income";
  return kind === "spend" ? mapped! : "other";
}

/** Payment apps: money back through these is someone paying you back, not a store refund. */
export const P2P_TEXT = /\b(venmo|zelle|paypal|cash app|square cash|apple cash)\b/i;
/** Expense-report payouts: your employer paying back work costs. */
export const REIMB_TEXT = /\b(expensify|reimb\w*|concur|navan)\b/i;
type Moneyback = { flow: string; merchant: string | null; description: string | null };
export const isReimbursement = (t: Moneyback) => t.flow === "refund" && REIMB_TEXT.test(`${t.merchant ?? ""} ${t.description ?? ""}`);
/**
 * Money in that's counted as income but may not be: payment apps, work reimbursements, cash deposits.
 * Listed under "Paybacks to review" so you can match it to a purchase (keep REVIEW_WORDS in step).
 */
export const REVIEW_WORDS = ["venmo", "zelle", "paypal", "cash app", "square cash", "apple cash", "expensify", "reimb", "concur", "navan", "atm", "fin ctr", "p2p", "mobile deposit"];
const REVIEW_TEXT = new RegExp(REVIEW_WORDS.map((w) => w.replace(/ /g, "\\s")).join("|"), "i");
export const isReviewable = (t: { flow: string; amount: number; merchant: string | null; description: string | null }) =>
  t.flow === "income" && t.amount > 0 && REVIEW_TEXT.test(`${t.merchant ?? ""} ${t.description ?? ""}`);

/** Money back that isn't a store refund: a friend paying you back, or a work reimbursement. */
export const isPayback = (t: Moneyback) =>
  t.flow === "refund" && (P2P_TEXT.test(`${t.merchant ?? ""} ${t.description ?? ""}`) || isReimbursement(t));
