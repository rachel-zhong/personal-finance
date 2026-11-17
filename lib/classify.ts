/**
 * Provider-independent derived fields: normalized merchant and money "flow".
 * Pure functions, recomputed on every sync, so rule tweaks apply retroactively.
 */

export type Flow = "spend" | "refund" | "income" | "transfer";

const PREFIXES = [
  /^sq\s*\*/, /^tst\s*\*/, /^sp\s*\*/, /^pp\s*\*/, /^paypal\s*\*/, /^py\s*\*/, /^ck\s*\*/,
  /^dd\s*\*/, /^in\s*\*/, /^pos\s+(debit|purchase)?\s*/, /^debit card purchase\s*/,
  /^purchase\s+(authorized\s+on\s+\d\d\/\d\d\s*)?/, /^return\s+(of\s+)?/, /^refund\s+(from\s+)?/,
  /^credit\s+(from\s+)?/,
  // Wallet / processor tags in front of the real merchant: "AplPay SP EVERLANE ..." -> "everlane ..."
  /^apl\s*pay\s+/, /^apple\s*pay\s+/, /^gpay\s+/, /^google\s*pay\s+/, /^sp\s+/,
];

/** "AMZN Mktp US*2K4LL1", "Amazon.com" -> "amazon"; "SQ *BLUE BOTTLE #12" -> "blue bottle" */
export function normalizeMerchant(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.toLowerCase().trim();
  // Bank ACH lines: "CITI CARD SVCS DES:AUTOPAY ID:XXXX00000 INDN:DOE CO ID:..." -> "citi card svcs autopay"
  s = s.replace(/\s+(indn|co id|id):.*$/, "").replace(/\bdes:/g, " ");
  for (const p of PREFIXES) s = s.replace(p, "");
  s = s
    .replace(/\.(com|net|org)\b/g, " ")
    .replace(/\b(amzn|amazon)(\s*(mktp|mktplace|marketplace|prime|digital))?\b/g, "amazon")
    .replace(/[*#].*$/, " ") // order/store numbers after * or #
    .replace(/\b\d[\d-]{2,}\b/g, " ") // long digit runs (store ids, phone numbers)
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|us|usa|store|stores)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

// Plaid personal_finance_category.primary values
const PLAID_PRIMARY = new Set([
  "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES", "ENTERTAINMENT",
  "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "HOME_IMPROVEMENT", "MEDICAL", "PERSONAL_CARE",
  "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT", "TRANSPORTATION", "TRAVEL",
  "RENT_AND_UTILITIES", "OTHER",
]);
const TRANSFER_CATEGORIES =new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);
const INCOME_CATEGORIES = new Set(["INCOME"]);
const TRANSFER_TEXT =
  /\b(transfer|xfer|zelle|venmo|cash app|paypal transfer|autopay|auto pay|payment thank you|online payment|card payment|credit card payment|epay|ach (debit|credit)|mobile deposit|atm withdrawal|atm deposit|wire)\b/i;
const INCOME_TEXT = /\b(payroll|direct dep|dir dep|salary|interest|dividend|irs treas|tax ref)\b/i;
const REFUND_TEXT = /\b(refund|return|reversal|credit adj|merchant credit)\b/i;

export interface ClassifyInput {
  amount: number; // cents, + in / - out
  merchant: string | null;
  description: string | null;
  category: string | null; // e.g. Plaid personal_finance_category.primary
  accountType: string;
}

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "at"]);

/**
 * Short key for matching a refund to its purchase when the bank words them differently:
 * "Everlane", "SP EVERLANE CLOTHING", "AplPay SP EVERLANE SAN FRAN" -> "everlane".
 * First meaningful word if it's distinctive (4+ letters), else the first two words.
 */
export function merchantKey(input: string | null | undefined): string {
  const words = normalizeMerchant(input).split(" ").filter((w) => w && !STOPWORDS.has(w));
  if (!words.length) return "";
  return words[0].length >= 4 || words.length === 1 ? words[0] : words.slice(0, 2).join(" ");
}

const REWARD_TEXT = /\b(cash ?back|reward|points|statement credit|interest)\b/i;

const CARD_PAYMENT_TEXT = /\b(payment|autopay|auto pay|thank you|pymt|balance transfer|from chk|from checking|from savings)\b/i;

export function classifyFlow(t: ClassifyInput): Flow {
  const text = `${t.merchant ?? ""} ${t.description ?? ""}`;
  const cat = (t.category ?? "").toUpperCase();

  // Credit cards: you can't "transfer" with a card. Money out is a purchase (even when the bank
  // tags app or wire payments as transfers). Money in is your card payment, a reward, or a
  // refund / statement credit, which lowers spending.
  if (t.accountType === "credit") {
    if (t.amount < 0) return "spend";
    // "RETURN PROTECTION BENEFIT PAYMENT" is a reimbursement, not your card payment.
    if (/\b(return|refund|benefit|reimburse\w*)\b/i.test(text)) return "refund";
    if (cat === "LOAN_PAYMENTS" || CARD_PAYMENT_TEXT.test(text)) return "transfer";
    return REWARD_TEXT.test(text) && !/\bcredit\b/i.test(text) ? "income" : "refund";
  }

  if (TRANSFER_CATEGORIES.has(cat)) return "transfer";
  // Money moving between your own accounts. A Plaid category wins when present;
  // otherwise (CSV, manual, free-text categories) fall back to the text.
  if (!PLAID_PRIMARY.has(cat) && (TRANSFER_TEXT.test(text) || /^(payment|transfer)s?$/i.test(cat))) {
    return "transfer";
  }

  if (t.amount < 0) return "spend";

  // Money in.
  if (INCOME_CATEGORIES.has(cat) || INCOME_TEXT.test(text)) return "income";
  const hasMerchant = !!t.merchant && normalizeMerchant(t.merchant) !== "";
  // "At a merchant": the provider identified a merchant, the provider put it in a
  // spending category, or the text says refund/return.
  if (hasMerchant || (cat !== "" && cat !== "OTHER") || REFUND_TEXT.test(text)) return "refund";
  return "income";
}
