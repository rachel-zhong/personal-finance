/**
 * The write API every connector uses (plaid, csv, manual, later simplefin).
 * Connectors translate provider data into these shapes; this module owns dedupe,
 * derived fields and the "never edit or merge raw transactions" rule.
 */
import { Db, newId, nowIso } from "./db";
import { classifyFlow, merchantKey, normalizeMerchant, Flow } from "./classify";
import { categoryForFlow, categoryKind, flowForCategory, isCategory, mapBankCategory, P2P_TEXT } from "./categories";

export type Source = "plaid" | "simplefin" | "csv" | "manual";

export async function upsertInstitution(
  db: Db,
  i: { source: Source; externalId: string; name: string },
): Promise<string> {
  await db.run(
    `INSERT INTO institutions (id, name, source, external_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET name = excluded.name`,
    [newId(), i.name, i.source, i.externalId, nowIso()],
  );
  const row = await db.get<{ id: string }>(
    "SELECT id FROM institutions WHERE source = ? AND external_id = ?",
    [i.source, i.externalId],
  );
  return row!.id;
}

export interface AccountInput {
  source: Source;
  externalId: string;
  institutionId: string | null;
  connectionId?: string | null;
  name: string;
  type: string;
  subtype?: string | null;
  mask?: string | null;
  currency?: string | null;
}

/** Provider fields are refreshed; your settings (display name, net worth flags) are never touched. */
export async function upsertAccount(db: Db, a: AccountInput): Promise<string> {
  await db.run(
    `INSERT INTO accounts (id, institution_id, connection_id, name, type, subtype, mask, currency, source, external_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET
       institution_id = excluded.institution_id, connection_id = excluded.connection_id,
       name = excluded.name, type = excluded.type, subtype = excluded.subtype,
       mask = excluded.mask, currency = excluded.currency`,
    [
      newId(), a.institutionId, a.connectionId ?? null, a.name, a.type, a.subtype ?? null,
      a.mask ?? null, a.currency ?? "USD", a.source, a.externalId, nowIso(),
    ],
  );
  const row = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE source = ? AND external_id = ?",
    [a.source, a.externalId],
  );
  return row!.id;
}

export async function upsertBalance(db: Db, accountId: string, asOf: string, balanceCents: number) {
  await db.run(
    `INSERT INTO balance_snapshots (id, account_id, as_of, balance) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, as_of) DO UPDATE SET balance = excluded.balance`,
    [newId(), accountId, asOf, balanceCents],
  );
}

export interface TxnInput {
  accountId: string;
  accountType: string;
  source: Source;
  externalId: string;
  date: string;
  amount: number; // cents, + in / - out
  merchant: string | null;
  description: string | null;
  category: string | null;
  pending: boolean;
  raw: unknown;
}

/**
 * Insert or refresh one provider transaction. Dedupe key: (source, external_id).
 * Returns true if this was a new row.
 */
export async function upsertTransaction(db: Db, t: TxnInput): Promise<boolean> {
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM transactions WHERE source = ? AND external_id = ?",
    [t.source, t.externalId],
  );
  const id = existing?.id ?? newId();
  const merchantNorm = normalizeMerchant(t.merchant || t.description);
  const { flow, category } = await deriveOne(db, {
    id, amount: t.amount, merchant: t.merchant, description: t.description, category: t.category,
    accountType: t.accountType, merchantNorm, detailed: detailedOf(t.raw),
  });
  const now = nowIso();
  await db.run(
    `INSERT INTO transactions (id, account_id, date, amount, merchant, description, category, pending,
        source, external_id, raw_json, merchant_norm, merchant_key, flow, app_category, removed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET
       account_id = excluded.account_id, date = excluded.date, amount = excluded.amount,
       merchant = excluded.merchant, description = excluded.description, category = excluded.category,
       pending = excluded.pending, raw_json = excluded.raw_json, merchant_norm = excluded.merchant_norm,
       merchant_key = excluded.merchant_key,
       flow = excluded.flow, app_category = excluded.app_category, removed = 0, updated_at = excluded.updated_at`,
    [
      id, t.accountId, t.date, t.amount, t.merchant, t.description, t.category,
      t.pending ? 1 : 0, t.source, t.externalId, JSON.stringify(t.raw ?? null), merchantNorm,
      merchantKey(t.merchant || t.description), flow, category, now, now,
    ],
  );
  return !existing;
}

function detailedOf(raw: unknown): string | null {
  const r = (typeof raw === "string" ? safeParse(raw) : raw) as { personal_finance_category?: { detailed?: string } } | null;
  return r?.personal_finance_category?.detailed ?? null;
}
function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }

interface DeriveInput {
  id: string; amount: number; merchant: string | null; description: string | null; category: string | null;
  accountType: string; merchantNorm: string; detailed: string | null;
}

/**
 * Category and flow for one transaction. Precedence: your edit on this transaction,
 * then your rule for this merchant (same direction), then the bank's category.
 */
export function derive(
  t: DeriveInput, override: string | undefined, rule: string | undefined, excluded = false,
): { flow: Flow; category: string; infer?: boolean } {
  const d = deriveCore(t, override, rule);
  // Excluded by you: stays in the list, but never counts as income, spending or a refund.
  return excluded ? { flow: "transfer", category: d.category } : d;
}

function deriveCore(
  t: DeriveInput, override: string | undefined, rule: string | undefined,
): { flow: Flow; category: string; infer?: boolean } {
  const mapped = mapBankCategory(t.detailed, t.category);
  // Credit card payments only move money between your own accounts. Never spending, whatever else says so.
  if (mapped === "card_payment") return { flow: "transfer", category: "card_payment" };
  const chosen = override ?? rule ?? defaultFor(t.merchantNorm, t.amount);
  if (isCategory(chosen)) return { flow: flowForCategory(chosen, t.amount), category: chosen };
  if (moneyInIsIncome(t)) return { flow: "income", category: "income" };
  const flow = classifyFlow({
    amount: t.amount, merchant: t.merchant, description: t.description, category: t.category, accountType: t.accountType,
  });
  // Card statement credits name what they offset.
  if (flow === "refund") {
    const text = `${t.merchant ?? ""} ${t.description ?? ""}`;
    if (/travel credit/i.test(text)) return { flow, category: "travel" };
    if (/dining credit|restaurant credit/i.test(text)) return { flow, category: "dining" };
  }
  // Purchase or refund the bank put in a non-spending bucket ("transfer", "income"): take the
  // category from other purchases at the same merchant (filled in by refreshDerived), else shopping.
  if ((flow === "refund" || flow === "spend") && (!mapped || categoryKind(mapped) !== "spend")) {
    return { flow, category: "shopping", infer: true };
  }
  return { flow, category: categoryForFlow(mapped, flow) };
}

/**
 * Your standing defaults for merchants, below your own edits and rules.
 * Venmo: payments count as Dining; money received counts as Income.
 * Investment platforms: money in or out is an "investments" transfer, never spending or income.
 */
const INVEST = { out: "investments", in: "investments" }; // money to or from investments: never spending or income (GL-2)
const MERCHANT_DEFAULTS: Record<string, { out?: string; in?: string }> = {
  venmo: { out: "dining", in: "income" },
  robinhood: INVEST, treasurydirect: INVEST, fidelity: INVEST, schwab: INVEST, vanguard: INVEST,
  etrade: INVEST, wealthfront: INVEST, betterment: INVEST,
  "apa treas misc pay": INVEST, // a Treasury bill maturing: your own money coming back, not income
};
function defaultFor(merchantNorm: string, amount: number) {
  return MERCHANT_DEFAULTS[merchantNorm]?.[amount < 0 ? "out" : "in"];
}

/**
 * Money into a bank account from other people (payment apps) or a deposit is income.
 * Moves between your own accounts (account transfers, wires, investment withdrawals) stay transfers.
 */
const INCOME_DETAILED = new Set(["TRANSFER_IN_TRANSFER_IN_FROM_APPS", "TRANSFER_IN_DEPOSIT"]);
function moneyInIsIncome(t: DeriveInput) {
  if (t.amount <= 0 || t.accountType === "credit") return false;
  if (t.detailed) return INCOME_DETAILED.has(t.detailed.toUpperCase());
  return P2P_TEXT.test(`${t.merchant ?? ""} ${t.description ?? ""}`); // CSV rows have no detailed category
}

const dirOf = (amount: number) => (amount < 0 ? "out" : "in");

async function deriveOne(db: Db, t: DeriveInput) {
  const o = await db.get<{ category: string }>("SELECT category FROM category_overrides WHERE txn_id = ?", [t.id]);
  const r = await db.get<{ category: string }>(
    "SELECT category FROM category_rules WHERE merchant_norm = ? AND direction = ?", [t.merchantNorm, dirOf(t.amount)]);
  const x = await db.get<{ txn_id: string }>("SELECT txn_id FROM txn_exclusions WHERE txn_id = ?", [t.id]);
  return derive(t, o?.category, r?.category, !!x);
}

/** Provider says this transaction no longer exists. Keep the row, flag it, drop its refund matches. */
export async function markRemoved(db: Db, source: Source, externalId: string) {
  const row = await db.get<{ id: string }>(
    "SELECT id FROM transactions WHERE source = ? AND external_id = ?",
    [source, externalId],
  );
  if (!row) return;
  await db.run("UPDATE transactions SET removed = 1, updated_at = ? WHERE id = ?", [nowIso(), row.id]);
  await db.run("DELETE FROM refund_matches WHERE refund_id = ? OR purchase_id = ?", [row.id, row.id]);
}

/** Recompute merchant_norm and flow for every row (cheap; keeps old rows in step with rule changes). */
export async function refreshDerived(db: Db) {
  const rows = await db.all<{
    id: string; amount: number; merchant: string | null; description: string | null; category: string | null;
    type: string; merchant_norm: string | null; merchant_key: string | null; flow: string | null; app_category: string | null;
    raw_json: string | null;
  }>(
    `SELECT t.id, t.amount, t.merchant, t.description, t.category, a.type, t.merchant_norm, t.merchant_key, t.flow,
            t.app_category, t.raw_json
       FROM transactions t JOIN accounts a ON a.id = t.account_id`,
  );
  const overrides = new Map((await db.all<{ txn_id: string; category: string }>(
    "SELECT txn_id, category FROM category_overrides")).map((x) => [x.txn_id, x.category]));
  const excluded = new Set((await db.all<{ txn_id: string }>("SELECT txn_id FROM txn_exclusions")).map((x) => x.txn_id));
  const rules = new Map((await db.all<{ merchant_norm: string; direction: string; category: string }>(
    "SELECT merchant_norm, direction, category FROM category_rules")).map((x) => [`${x.merchant_norm}|${x.direction}`, x.category]));
  const results = rows.map((r) => {
    const mn = normalizeMerchant(r.merchant || r.description);
    const key = merchantKey(r.merchant || r.description);
    const d = derive(
      { id: r.id, amount: r.amount, merchant: r.merchant, description: r.description, category: r.category,
        accountType: r.type, merchantNorm: mn, detailed: detailedOf(r.raw_json) },
      overrides.get(r.id), rules.get(`${mn}|${dirOf(r.amount)}`), excluded.has(r.id),
    );
    return { r, mn, key, ...d };
  });
  // Most common purchase category per merchant key, for refunds that need one.
  const tally = new Map<string, Map<string, number>>();
  for (const x of results) {
    if (x.flow !== "spend" || !x.key) continue;
    const m = tally.get(x.key) ?? new Map<string, number>();
    m.set(x.category, (m.get(x.category) ?? 0) + 1);
    tally.set(x.key, m);
  }
  const topCat = (key: string) => {
    const m = tally.get(key);
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : undefined;
  };
  await db.tx(async (tx) => {
    for (const x of results) {
      const category = x.infer ? topCat(x.key) ?? x.category : x.category;
      const { r, mn, key, flow } = x;
      if (mn !== r.merchant_norm || key !== r.merchant_key || flow !== r.flow || category !== r.app_category) {
        await tx.run("UPDATE transactions SET merchant_norm = ?, merchant_key = ?, flow = ?, app_category = ? WHERE id = ?",
          [mn, key, flow, category, r.id]);
        if (flow !== "spend") await tx.run("DELETE FROM refund_matches WHERE purchase_id = ?", [r.id]);
        if (flow !== "refund") await tx.run("DELETE FROM refund_matches WHERE refund_id = ?", [r.id]);
      }
    }
  });
}
