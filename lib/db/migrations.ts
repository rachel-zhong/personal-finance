/**
 * Schema migrations. Written in the common subset of SQLite and Postgres so the
 * same files can run on a hosted Postgres later:
 *   - ids are TEXT (UUIDs generated in app code), no AUTOINCREMENT / SERIAL
 *   - money is BIGINT integer cents (never floats)
 *   - dates are ISO TEXT ('YYYY-MM-DD'), timestamps are ISO TEXT
 *   - booleans are INTEGER 0/1
 *   - upserts use INSERT ... ON CONFLICT (...) DO UPDATE, supported by both
 *
 * Sign convention for transactions.amount: positive = money in, negative = money out.
 * Balances: the number the institution reports. For credit/loan accounts that is
 * the amount owed (positive), and net worth subtracts it.
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "core tables",
    sql: `
CREATE TABLE institutions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  source        TEXT NOT NULL,              -- plaid | simplefin | csv | manual
  external_id   TEXT,                       -- e.g. Plaid institution_id
  created_at    TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE connections (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,           -- plaid | simplefin
  item_id          TEXT NOT NULL,
  institution_id   TEXT REFERENCES institutions(id),
  access_token_ref TEXT NOT NULL,           -- key into the local secrets file, never the token itself
  cursor           TEXT,
  last_synced_at   TEXT,
  status           TEXT NOT NULL DEFAULT 'active',  -- active | needs_reauth | error
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (provider, item_id)
);

CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  institution_id   TEXT REFERENCES institutions(id),
  connection_id    TEXT REFERENCES connections(id),
  name             TEXT NOT NULL,
  display_name     TEXT,                    -- your own label; overrides name in the UI
  type             TEXT NOT NULL,           -- depository | credit | loan | investment | other
  subtype          TEXT,
  mask             TEXT,
  currency         TEXT NOT NULL DEFAULT 'USD',
  source           TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  -- Net worth controls
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1,  -- 0 = whole account is not your money (e.g. a family member's)
  net_worth_held_for_others BIGINT NOT NULL DEFAULT 0, -- cents inside this account that aren't yours
  net_worth_note   TEXT,
  include_in_spending   INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE transactions (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  date             TEXT NOT NULL,           -- YYYY-MM-DD
  amount           BIGINT NOT NULL,         -- cents; + money in, - money out
  merchant         TEXT,
  description      TEXT,
  category         TEXT,                    -- provider category, e.g. FOOD_AND_DRINK
  pending          INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  raw_json         TEXT,
  -- Derived by app code (recomputable, never user-edited)
  merchant_norm    TEXT,
  flow             TEXT,                    -- spend | refund | income | transfer
  removed          INTEGER NOT NULL DEFAULT 0, -- provider deleted it (e.g. pending replaced by posted); kept, never hard-deleted
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_txn_account_date ON transactions(account_id, date);
CREATE INDEX idx_txn_merchant ON transactions(merchant_norm, date);
CREATE INDEX idx_txn_flow ON transactions(flow, date);

CREATE TABLE balance_snapshots (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  as_of       TEXT NOT NULL,                -- YYYY-MM-DD
  balance     BIGINT NOT NULL,              -- cents
  UNIQUE (account_id, as_of)
);

CREATE TABLE manual_entries (
  id            TEXT PRIMARY KEY,
  account_name  TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id), -- the manual account this entry feeds
  as_of         TEXT NOT NULL,
  balance       BIGINT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE refund_matches (
  id              TEXT PRIMARY KEY,
  refund_id       TEXT NOT NULL REFERENCES transactions(id),
  purchase_id     TEXT NOT NULL REFERENCES transactions(id),
  amount_applied  BIGINT NOT NULL,          -- cents, positive
  matched_by      TEXT NOT NULL,            -- auto | manual
  confidence      REAL,
  created_at      TEXT NOT NULL,
  UNIQUE (refund_id, purchase_id)
);
CREATE INDEX idx_rm_purchase ON refund_matches(purchase_id);

-- Refunds you unmatched by hand: the auto-matcher leaves these alone.
CREATE TABLE refund_ignores (
  refund_id   TEXT PRIMARY KEY REFERENCES transactions(id),
  created_at  TEXT NOT NULL
);

-- How much of each refund is applied, and how much of each purchase was returned.
CREATE VIEW refund_applied AS
  SELECT refund_id, SUM(amount_applied) AS applied FROM refund_matches GROUP BY refund_id;
CREATE VIEW purchase_refunded AS
  SELECT purchase_id, SUM(amount_applied) AS refunded FROM refund_matches GROUP BY purchase_id;

-- Spending source of truth for all charts and totals. Positive net = spending.
--  * purchases: purchase minus matched refunds, in the purchase's month
--  * unmatched refund amounts: negative spending in their own category and month (never income)
CREATE VIEW net_spending AS
  SELECT t.id AS txn_id, t.account_id, t.date, substr(t.date, 1, 7) AS month,
         t.category, t.merchant, 'purchase' AS kind,
         -t.amount AS gross,
         COALESCE(p.refunded, 0) AS refunded,
         -t.amount - COALESCE(p.refunded, 0) AS net,
         a.include_in_spending
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN purchase_refunded p ON p.purchase_id = t.id
   WHERE t.flow = 'spend' AND t.removed = 0
  UNION ALL
  SELECT r.id, r.account_id, r.date, substr(r.date, 1, 7),
         r.category, r.merchant, 'unmatched_refund',
         0,
         r.amount - COALESCE(ra.applied, 0),
         -(r.amount - COALESCE(ra.applied, 0)),
         a.include_in_spending
    FROM transactions r
    JOIN accounts a ON a.id = r.account_id
    LEFT JOIN refund_applied ra ON ra.refund_id = r.id
   WHERE r.flow = 'refund' AND r.removed = 0 AND r.pending = 0
     AND r.amount - COALESCE(ra.applied, 0) > 0;
`,
  },
  {
    id: 2,
    name: "account groups and net worth snapshots",
    sql: `
-- cash | parents | invest | cards. NULL = derive from type (see lib/groups.ts).
ALTER TABLE accounts ADD COLUMN account_group TEXT;

-- One row per date on the trend. Rebuilt after every sync and settings change from
-- balance_snapshots + transactions, using your current net worth settings.
CREATE TABLE net_worth_snapshots (
  id           TEXT PRIMARY KEY,
  as_of        TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD
  net_worth    BIGINT NOT NULL,          -- cents, accounts in net worth only
  cash         BIGINT NOT NULL,
  parents      BIGINT NOT NULL,
  invest       BIGINT NOT NULL,
  cards        BIGINT NOT NULL,          -- amount owed (positive)
  is_estimate  INTEGER NOT NULL DEFAULT 0, -- 1 = back-calculated from transactions
  created_at   TEXT NOT NULL
);
`,
  },
  {
    id: 3,
    name: "retirement group on net worth snapshots",
    sql: `ALTER TABLE net_worth_snapshots ADD COLUMN retire BIGINT NOT NULL DEFAULT 0;`,
  },
  {
    id: 4,
    name: "set-aside mode",
    sql: `-- amount = net_worth_held_for_others is a fixed sum; all = the whole balance, whatever it grows to.
ALTER TABLE accounts ADD COLUMN net_worth_held_mode TEXT NOT NULL DEFAULT 'amount';`,
  },
  {
    id: 5,
    name: "spending rules",
    sql: `
-- Payees you've said are spending even though the bank calls them transfers (rent via an app, Venmo).
-- Applies to money OUT only. Never edits transactions; flow is re-derived from these rules.
CREATE TABLE spending_rules (
  id             TEXT PRIMARY KEY,
  merchant_norm  TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,          -- what you saw, e.g. "Parkview Apts"
  category       TEXT NOT NULL,          -- e.g. RENT_AND_UTILITIES
  created_at     TEXT NOT NULL
);

DROP VIEW net_spending;
CREATE VIEW net_spending AS
  SELECT t.id AS txn_id, t.account_id, t.date, substr(t.date, 1, 7) AS month,
         COALESCE(sr.category, t.category) AS category, t.merchant, 'purchase' AS kind,
         -t.amount AS gross,
         COALESCE(p.refunded, 0) AS refunded,
         -t.amount - COALESCE(p.refunded, 0) AS net,
         a.include_in_spending
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN purchase_refunded p ON p.purchase_id = t.id
    LEFT JOIN spending_rules sr ON sr.merchant_norm = t.merchant_norm AND t.amount < 0
   WHERE t.flow = 'spend' AND t.removed = 0
  UNION ALL
  SELECT r.id, r.account_id, r.date, substr(r.date, 1, 7),
         r.category, r.merchant, 'unmatched_refund',
         0,
         r.amount - COALESCE(ra.applied, 0),
         -(r.amount - COALESCE(ra.applied, 0)),
         a.include_in_spending
    FROM transactions r
    JOIN accounts a ON a.id = r.account_id
    LEFT JOIN refund_applied ra ON ra.refund_id = r.id
   WHERE r.flow = 'refund' AND r.removed = 0 AND r.pending = 0
     AND r.amount - COALESCE(ra.applied, 0) > 0;
`,
  },
  {
    id: 6,
    name: "app categories, overrides, merchant rules, review dismissals",
    sql: `
-- Derived: your effective category (see lib/categories.ts). Raw bank category stays in transactions.category.
ALTER TABLE transactions ADD COLUMN app_category TEXT;

-- One transaction recategorized by you.
CREATE TABLE category_overrides (
  txn_id      TEXT PRIMARY KEY REFERENCES transactions(id),
  category    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Every transaction from a merchant in one direction (out = payments, in = money received).
CREATE TABLE category_rules (
  merchant_norm  TEXT NOT NULL,
  direction      TEXT NOT NULL,
  category       TEXT NOT NULL,
  label          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (merchant_norm, direction)
);

-- Suggestions you've already answered on the review list.
CREATE TABLE review_dismissals (
  item_key    TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

INSERT INTO category_rules (merchant_norm, direction, category, label, created_at)
  SELECT merchant_norm, 'out',
         CASE category
           WHEN 'RENT_AND_UTILITIES' THEN 'rent' WHEN 'FOOD_AND_DRINK' THEN 'dining'
           WHEN 'GENERAL_MERCHANDISE' THEN 'shopping' WHEN 'GENERAL_SERVICES' THEN 'services'
           WHEN 'ENTERTAINMENT' THEN 'entertainment' WHEN 'TRANSPORTATION' THEN 'transport'
           WHEN 'TRAVEL' THEN 'travel' WHEN 'PERSONAL_CARE' THEN 'personal_care' WHEN 'MEDICAL' THEN 'health'
           WHEN 'HOME_IMPROVEMENT' THEN 'home' WHEN 'GOVERNMENT_AND_NON_PROFIT' THEN 'gifts' ELSE 'other' END,
         label, created_at
    FROM spending_rules;

DROP VIEW net_spending;
DROP TABLE spending_rules;
CREATE VIEW net_spending AS
  SELECT t.id AS txn_id, t.account_id, t.date, substr(t.date, 1, 7) AS month,
         t.app_category AS category, t.merchant, 'purchase' AS kind,
         -t.amount AS gross,
         COALESCE(p.refunded, 0) AS refunded,
         -t.amount - COALESCE(p.refunded, 0) AS net,
         a.include_in_spending
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN purchase_refunded p ON p.purchase_id = t.id
   WHERE t.flow = 'spend' AND t.removed = 0
  UNION ALL
  SELECT r.id, r.account_id, r.date, substr(r.date, 1, 7),
         r.app_category, r.merchant, 'unmatched_refund',
         0,
         r.amount - COALESCE(ra.applied, 0),
         -(r.amount - COALESCE(ra.applied, 0)),
         a.include_in_spending
    FROM transactions r
    JOIN accounts a ON a.id = r.account_id
    LEFT JOIN refund_applied ra ON ra.refund_id = r.id
   WHERE r.flow = 'refund' AND r.removed = 0 AND r.pending = 0
     AND r.amount - COALESCE(ra.applied, 0) > 0;
`,
  },
  {
    id: 7,
    name: "merchant key for refund matching",
    sql: `
-- Derived short merchant name used to pair refunds with purchases ("SP EVERLANE CLOTHING" ~ "Everlane").
ALTER TABLE transactions ADD COLUMN merchant_key TEXT;
CREATE INDEX idx_txn_merchant_key ON transactions(merchant_key, date);
`,
  },
  {
    id: 8,
    name: "simplified categories, exclusions (PRD v2)",
    sql: `
-- Old category -> new list. Originals are kept in category_migration_log, nothing is lost.
CREATE TABLE category_migration_log (
  table_name   TEXT NOT NULL,
  row_key      TEXT NOT NULL,
  old_category TEXT NOT NULL,
  new_category TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key)
);
INSERT INTO category_migration_log (table_name, row_key, old_category, new_category)
  SELECT 'category_overrides', txn_id, category,
         CASE category WHEN 'clothing' THEN 'shopping' WHEN 'services' THEN 'bills' WHEN 'education' THEN 'other'
                       WHEN 'gifts' THEN 'other' WHEN 'taxes' THEN 'fees' END
    FROM category_overrides WHERE category IN ('clothing','services','education','gifts','taxes');
INSERT INTO category_migration_log (table_name, row_key, old_category, new_category)
  SELECT 'category_rules', merchant_norm || '|' || direction, category,
         CASE category WHEN 'clothing' THEN 'shopping' WHEN 'services' THEN 'bills' WHEN 'education' THEN 'other'
                       WHEN 'gifts' THEN 'other' WHEN 'taxes' THEN 'fees' END
    FROM category_rules WHERE category IN ('clothing','services','education','gifts','taxes');
UPDATE category_overrides SET category = CASE category WHEN 'clothing' THEN 'shopping' WHEN 'services' THEN 'bills'
  WHEN 'education' THEN 'other' WHEN 'gifts' THEN 'other' WHEN 'taxes' THEN 'fees' ELSE category END
  WHERE category IN ('clothing','services','education','gifts','taxes');
UPDATE category_rules SET category = CASE category WHEN 'clothing' THEN 'shopping' WHEN 'services' THEN 'bills'
  WHEN 'education' THEN 'other' WHEN 'gifts' THEN 'other' WHEN 'taxes' THEN 'fees' ELSE category END
  WHERE category IN ('clothing','services','education','gifts','taxes');
UPDATE transactions SET app_category = CASE app_category WHEN 'clothing' THEN 'shopping' WHEN 'services' THEN 'bills'
  WHEN 'education' THEN 'other' WHEN 'gifts' THEN 'other' WHEN 'taxes' THEN 'fees' ELSE app_category END
  WHERE app_category IN ('clothing','services','education','gifts','taxes');

-- Transactions you leave out of income, spending and savings (the raw transaction is never changed).
-- kind 'keep_in_net_worth' also added the amount to a manual account (GL-5).
CREATE TABLE txn_exclusions (
  txn_id            TEXT PRIMARY KEY REFERENCES transactions(id),
  kind              TEXT NOT NULL DEFAULT 'exclude',
  manual_account_id TEXT,
  manual_amount     BIGINT,
  created_at        TEXT NOT NULL
);
`,
  },
  {
    id: 9,
    name: "investments: securities, holdings, daily snapshots, investment transactions (IN)",
    sql: `
-- Opt-in per connection: investments are only fetched after you allow them in Plaid Link (IN-2).
ALTER TABLE connections ADD COLUMN investments_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN investments_error TEXT;

CREATE TABLE securities (
  id              TEXT PRIMARY KEY,           -- Plaid security_id
  ticker          TEXT,
  name            TEXT,
  type            TEXT,                       -- Plaid type: equity, etf, mutual fund, fixed income, cash, cryptocurrency, ...
  is_cash_equivalent INTEGER NOT NULL DEFAULT 0,
  close_price     REAL,
  close_price_as_of TEXT,
  updated_at      TEXT NOT NULL
);

-- What each account holds right now. Values in cents; cost_basis NULL when the broker doesn't say.
CREATE TABLE holdings (
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  security_id  TEXT NOT NULL REFERENCES securities(id),
  quantity     REAL NOT NULL,
  price        REAL,
  price_as_of  TEXT,
  value        BIGINT NOT NULL,
  cost_basis   BIGINT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, security_id)
);

-- One row per holding per day (IN-6). Manual accounts use holding_key 'account:<id>'. Real values only.
CREATE TABLE holding_snapshots (
  as_of        TEXT NOT NULL,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  holding_key  TEXT NOT NULL,                -- security id, or 'account:<id>' for a whole manual/unloaded account
  quantity     REAL,
  price        REAL,
  value        BIGINT NOT NULL,
  cost_basis   BIGINT,
  PRIMARY KEY (as_of, account_id, holding_key)
);

-- Buys, sells, dividends, contributions (IN-4). amount in cents, OUR sign: positive = cash into the account.
CREATE TABLE investment_transactions (
  id           TEXT PRIMARY KEY,             -- Plaid investment_transaction_id
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  security_id  TEXT,
  date         TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  subtype      TEXT,
  quantity     REAL,
  price        REAL,
  amount       BIGINT NOT NULL,
  fees         BIGINT,
  raw          TEXT
);
CREATE INDEX idx_inv_txn_date ON investment_transactions(date);

-- Your own asset and account type for an account (IN-5); NULL = use the default.
CREATE TABLE investment_settings (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id),
  asset_type  TEXT,
  tax_type    TEXT
);
`,
  },
  {
    id: 10,
    name: "manual holdings inside manual accounts (IN-7)",
    sql: `
CREATE TABLE manual_holdings (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  name        TEXT NOT NULL,
  ticker      TEXT,
  quantity    REAL,
  value       BIGINT NOT NULL,          -- cents
  asset_type  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`,
  },
  {
    id: 11,
    name: "compensation: pay statements, line items, W-2s, base pay, RSU vests (CP)",
    sql: `
-- Parsed from local files in data/compensation/. Amounts in cents. Nothing here leaves this computer.
CREATE TABLE comp_statements (
  id              TEXT PRIMARY KEY,          -- payroll advice number (unique per statement), else a file hash
  file            TEXT NOT NULL,
  layout          TEXT NOT NULL,
  pay_date        TEXT NOT NULL,
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  seq             INTEGER,                   -- order within the year, from the YTD chain
  gross           BIGINT NOT NULL,
  gross_ytd       BIGINT,
  net             BIGINT NOT NULL,
  federal_taxable BIGINT,
  pages           INTEGER NOT NULL,
  imported_at     TEXT NOT NULL
);
CREATE INDEX idx_comp_statements_date ON comp_statements(pay_date);

CREATE TABLE comp_lines (
  statement_id TEXT NOT NULL REFERENCES comp_statements(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  section      TEXT NOT NULL,                -- earnings | taxes | deductions | employer
  category     TEXT NOT NULL,
  label        TEXT NOT NULL,
  classified   INTEGER NOT NULL,             -- 0 = only a catch-all rule matched; listed for review
  rate         REAL,
  hours        REAL,
  current      BIGINT,                       -- this period; taxes/deductions as positive "taken", additions negative
  ytd          BIGINT,
  pretax       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (statement_id, line_no)
);

CREATE TABLE comp_deposits (
  statement_id TEXT NOT NULL REFERENCES comp_statements(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  account      TEXT,                         -- last 4 of the account, when shown
  amount       BIGINT NOT NULL,
  PRIMARY KEY (statement_id, line_no)
);

CREATE TABLE comp_w2 (
  year    INTEGER PRIMARY KEY,
  file    TEXT NOT NULL,
  box1    BIGINT NOT NULL, box2 BIGINT NOT NULL, box3 BIGINT NOT NULL,
  box4    BIGINT NOT NULL, box5 BIGINT NOT NULL, box6 BIGINT NOT NULL,
  box12   TEXT NOT NULL,                     -- JSON {"D": cents, ...}
  box14   TEXT NOT NULL,                     -- JSON [{label, cents}]
  summary TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- Base pay history: imported from the HR screenshot, editable in the app.
CREATE TABLE comp_base_pay (
  id             TEXT PRIMARY KEY,
  effective_date TEXT NOT NULL,
  reason         TEXT,
  period_rate    BIGINT NOT NULL,            -- per pay period
  frequency      TEXT,
  annual         BIGINT,
  source         TEXT NOT NULL,              -- screenshot | manual
  edited         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (effective_date, reason, period_rate)
);

-- One row per RSU vest statement. Fields the statement doesn't show stay NULL.
CREATE TABLE comp_rsu_vests (
  statement_id    TEXT PRIMARY KEY REFERENCES comp_statements(id) ON DELETE CASCADE,
  vest_date       TEXT NOT NULL,
  usd_value       BIGINT NOT NULL,
  taxes_withheld  BIGINT NOT NULL,
  net_value       BIGINT,                    -- value of shares you kept (the offset line)
  shares          REAL,
  shares_withheld REAL,
  jpy_price       REAL,
  fx_rate         REAL,
  fees            BIGINT,
  note            TEXT
);
`,
  },
];
