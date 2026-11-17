/**
 * Minimal Plaid REST client.
 *
 * SAFETY: this is the ONLY place the app talks to Plaid, and it can only reach the
 * read-only endpoints in ALLOWED_ENDPOINTS. Nothing here can move money
 * (no /transfer, /payment_initiation, /bank_transfer, /processor, /signal, etc.).
 *
 * We call the REST API with fetch instead of the `plaid` npm SDK: it's four endpoints,
 * it keeps the allowlist explicit, and it avoids SDK churn.
 */

const ALLOWED_ENDPOINTS = new Set([
  "/link/token/create",
  "/item/public_token/exchange",
  "/accounts/get", // cached balances; free. We deliberately do NOT call /accounts/balance/get (billed per call).
  "/transactions/sync",
]);

const BASE_URLS: Record<string, string> = {
  production: "https://production.plaid.com",
  sandbox: "https://sandbox.plaid.com",
};

export class PlaidError extends Error {
  constructor(
    public readonly code: string,
    public readonly type: string,
    message: string,
    public readonly status: number,
  ) {
    super(`${code}: ${message}`);
  }
}

// ---- Response shapes we use (subset of Plaid's) ----
export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: { current: number | null; available: number | null; iso_currency_code: string | null };
}
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // Plaid: positive = money OUT
  iso_currency_code: string | null;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
}
export interface SyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

/** What the rest of the app needs from Plaid. Tests pass a fake implementing this. */
export interface PlaidApi {
  linkTokenCreate(opts: { accessToken?: string; addAccounts?: boolean }): Promise<{ link_token: string }>;
  exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string }>;
  accountsGet(accessToken: string): Promise<{
    accounts: PlaidAccount[];
    item: { item_id: string; institution_id?: string | null; institution_name?: string | null };
  }>;
  transactionsSync(accessToken: string, cursor: string | null): Promise<SyncResponse>;
}

export function plaidEnv() {
  return (process.env.PLAID_ENV || "production").toLowerCase();
}

export function createPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = plaidEnv();
  const base = BASE_URLS[env];
  if (!clientId || !secret) throw new Error("Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local");
  if (!base) throw new Error(`PLAID_ENV must be 'production' or 'sandbox' (got '${env}')`);

  async function call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      throw new Error(`Blocked Plaid endpoint ${endpoint}: not on the read-only allowlist`);
    }
    const res = await fetch(base + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
      body: JSON.stringify({ client_id: clientId, secret, ...body }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new PlaidError(
        String(json.error_code ?? "UNKNOWN"),
        String(json.error_type ?? "UNKNOWN"),
        String(json.display_message || json.error_message || res.statusText),
        res.status,
      );
    }
    return json as T;
  }

  return {
    linkTokenCreate: ({ accessToken, addAccounts }) => {
      const body: Record<string, unknown> = {
        client_name: "Personal Finance (local)",
        user: { client_user_id: "local-user" },
        country_codes: ["US"],
        language: "en",
      };
      if (process.env.PLAID_REDIRECT_URI) body.redirect_uri = process.env.PLAID_REDIRECT_URI;
      if (accessToken) {
        body.access_token = accessToken; // update mode: re-authenticate an existing connection
        if (addAccounts) body.update = { account_selection_enabled: true }; // let you pick new accounts (e.g. a new CD)
      } else {
        body.products = ["transactions"];
        body.transactions = { days_requested: 730 };
      }
      return call("/link/token/create", body);
    },
    exchangePublicToken: (publicToken) =>
      call("/item/public_token/exchange", { public_token: publicToken }),
    accountsGet: (accessToken) => call("/accounts/get", { access_token: accessToken }),
    transactionsSync: (accessToken, cursor) =>
      call("/transactions/sync", {
        access_token: accessToken,
        ...(cursor ? { cursor } : {}),
        count: 500,
        options: { include_personal_finance_category: true },
      }),
  };
}
