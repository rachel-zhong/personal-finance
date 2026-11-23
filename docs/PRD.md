# My Money · Product requirements

**One local app that shows where my money stands: net worth, spending, investments and pay.** It runs on my Mac, reads my banks through Plaid (read-only), and keeps every number in a local database.

This is the single source of truth. It describes what the app does today, tab by tab, and how every number is calculated, so someone could rebuild it from scratch.

- **Status:** everything here is built unless it's marked _Not built_.
- **Requirement IDs:** tab code + number (NW-1, SP-2 …). IDs from earlier drafts are kept where they still apply.
- **Examples:** every number and name in an example is made up.
- **Ownership:** © 2026 rachel-zhong. All rights reserved. See [LICENSE](../LICENSE).

**Contents**

1. [Ground rules](#1-ground-rules)
2. [Architecture and data](#2-architecture-and-data)
3. [Shared concepts](#3-shared-concepts) (flows, categories, refunds, paybacks, exclusions, privacy)
4. [Net worth tab](#4-net-worth-tab-nw)
5. [Spending tab](#5-spending-tab-sp)
6. [Transactions tab](#6-transactions-tab-tx)
7. [Investments tab](#7-investments-tab-in)
8. [Compensation tab](#8-compensation-tab-cp)
9. [Connections & files](#9-connections--files-cn)
10. [Account detail page](#10-account-detail-page-ac)
11. [Known limits](#11-known-limits)
12. [Decisions log](#12-decisions-log)
13. [Not built yet](#13-not-built-yet)
14. [Hosting online](#14-hosting-online-hs)

---

## 1. Ground rules

| Rule | What it means in practice |
|---|---|
| **Never move money** | The Plaid client only calls endpoints on a read-only allowlist (section 2). Anything else throws before a request is sent. |
| **No paid service without asking** | Every billed Plaid product was approved first. The regular Sync never calls a per-call billed endpoint. |
| **Data stays local** | `data/` (database, pay documents), `secrets/` and `.env*` are gitignored. Pay data is never sent to any outside service. |
| **No spreadsheets** | The app never writes CSV or Excel files. Everything is shown in the app. |
| **Public repo hygiene** | Demo data, tests, docs and screenshots never resemble real accounts. Commits use a GitHub noreply email. |
| **Never invent numbers** | Missing data shows "—" or a gap, never $0 or a guess. Estimates are labeled as estimates. |

---

## 2. Architecture and data

**Stack**

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router), React, TypeScript, Tailwind | Server pages read the DB directly; small client components for interaction. |
| Database | SQLite (better-sqlite3) behind a thin `Db` interface | Free and local. SQL stays Postgres-compatible so hosting later doesn't need a rewrite. |
| Bank data | Plaid REST API over `fetch`, no SDK | Keeps the endpoint allowlist explicit. |
| Document reading | A small Swift program using Apple PDFKit + Vision OCR | Reads pay PDFs and screenshots on-device. |
| Tests | Vitest, synthetic data only | |
| Phone | Home-screen web app over a private network | Bottom tab bar under 768px wide. |

**Money format:** integer cents everywhere. Positive = money in, negative = money out.

**Plaid allowlist (read-only)**

| Endpoint | Used for | Billing |
|---|---|---|
| `/link/token/create` | Connecting a bank; update mode for consent | Free |
| `/item/public_token/exchange` | Finishing a connection | Free |
| `/accounts/get` | Cached balances | Free |
| `/transactions/sync` | Transactions, incremental with a cursor | Transactions product |
| `/investments/holdings/get` | What you own | Investments product |
| `/investments/transactions/get` | Buys, sells, dividends | Investments product |
| `/investments/refresh` | Manual "Refresh now" on Investments only | Free on the Trial plan; per call on paid plans |

Deliberately **not** called: `/accounts/balance/get` (billed per call), and anything under transfer, payment initiation, processor or signal.

**Main tables**

| Table | Holds |
|---|---|
| `connections`, `institutions`, `accounts` | One row per Plaid connection, bank and account. Accounts carry the net worth and spending settings (section 4). |
| `transactions` | Raw transactions plus derived `flow`, `app_category`, `merchant_norm`, `merchant_key`. Never edited by user actions. |
| `category_overrides`, `merchant_rules` | Category edits for one transaction, or for every transaction from a merchant. |
| `txn_exclusions` | Transactions left out of totals. |
| `refund_matches` | Refund → purchase links with the amount applied. |
| `balance_snapshots`, `net_worth_snapshots` | Daily balances; month-end net worth. |
| `securities`, `holdings`, `holding_snapshots`, `investment_transactions`, `manual_holdings` | Investments. |
| `comp_statements`, `comp_lines`, `comp_deposits`, `comp_w2`, `comp_base_pay`, `comp_rsu_vests` | Compensation. |
| `net_spending` (view) | Spending per purchase after refunds (section 3.3). |

**Sync (the "Sync now" button)**, per connection:

1. `/accounts/get` → update balances, save today's balance snapshot.
2. `/transactions/sync` → add, modify, remove; classify each (section 3.1).
3. If investments are on for the connection: holdings + 24 months of investment transactions.
4. Run refund auto-matching (section 3.3).
5. Save today's holdings snapshot and rebuild net worth history.

---

## 3. Shared concepts

### 3.1 Flow: what kind of money movement

Every transaction gets one flow. Flow decides which totals it counts in.

| Flow | Meaning | Counts in |
|---|---|---|
| `spend` | Money out for a purchase | Spending |
| `refund` | Money back from a merchant, or a payback (3.4) | Lowers spending |
| `income` | Pay, interest, rewards, other money in | Income |
| `transfer` | Between your own accounts, card payments, investment transfers | Nothing (net worth only) |

**Rules, in order**

| # | Condition | Flow |
|---|---|---|
| 1 | Credit card, money out | spend |
| 2 | Credit card, money in, text says return / refund / benefit / reimburse | refund |
| 3 | Credit card, money in, a card payment | transfer |
| 4 | Credit card, money in, a reward (not "credit") | income; otherwise refund |
| 5 | Plaid transfer category, or transfer text without a Plaid category | transfer |
| 6 | Money to or from a known brokerage or TreasuryDirect | transfer (category Investments) |
| 7 | Any other money out | spend |
| 8 | Money in with an income category or income text (payroll, interest, dividend) | income |
| 9 | Money in with a merchant, a spending category, or refund text | refund |
| 10 | Anything else in | income |

- Treasury bill maturities count as money coming back (transfer), not income.
- **A category edit wins.** Setting a spend category on money in turns it into a refund. Setting "Transfer" makes it a transfer.

### 3.2 Categories

| Category | Includes |
|---|---|
| Rent & Mortgage | |
| Bills & Utilities | Bills, utilities, general services |
| Groceries | |
| Dining | Restaurants, bars, coffee |
| Shopping & Clothing | |
| Home | |
| Auto & Transport | |
| Travel | |
| Hobbies | Entertainment |
| Health | Medical |
| Personal Care | Gym, skincare |
| Insurance | |
| Fees & Taxes | Bank fees, interest charges, taxes, legal and accounting fees |
| Pets | |
| Other | Anything else, including education and donations |
| _Not spending_ | Income · Transfer · Credit card payment · Investments · Loan payment |

- Plaid's category is mapped to this list.
- Edits: one transaction (`category_overrides`) or every transaction from that merchant (`merchant_rules`, keyed on the normalized merchant name).

### 3.3 Refund matching

Refunds lower spending in the month **you bought the item**, not the month the money came back.

**Auto-match rule**, for each posted, unmatched refund:

| Step | Rule |
|---|---|
| Candidates | Posted purchases at the same merchant (`merchant_key`, so "SP SHOPNAME CLOTHING" matches "Shopname") |
| Window | From 90 days before the refund to 3 days after (banks sometimes post the refund first) |
| Pick | A purchase of exactly the refund amount, else the most recent one with room left |
| Amount applied | Capped at what's left of that purchase; a purchase can absorb several partial refunds |
| Leftover | Stays "unmatched" and lowers spending in its own month and category |
| Never auto-matched | Payment apps (Venmo, Zelle, PayPal, Cash App, Apple Cash) and work reimbursements (Expensify, Concur, Navan, "reimb") |

**Confidence**, shown on matches that need a look:

| Case | Score |
|---|---|
| Refund equals the purchase amount | 0.95 |
| Refund fits in what's left of the purchase | 0.80 |
| Otherwise | 0.60 |
| More than 45 days apart | −0.10 |

**Net spending per purchase** (the `net_spending` view):

```
net = purchase amount − refunds applied to it
```

Plus one row per unmatched refund: `net = −(refund − amount already applied)`, in the refund's own month.

**Manual matching.** Open a refund (or a purchase) and choose "Find purchases to match" ("Find refunds to match"). A picker lists the other side, with filters:

| Filter | Default | Notes |
|---|---|---|
| Merchant | Same merchant (paybacks: any merchant) | Switch to **Any merchant** when the refund comes from a different name than the purchase (e.g. a tax refund service, a marketplace). |
| From / To dates | Refund: 90 days before to 3 days after (paybacks: 45 days before). Purchase: 3 days before to 90 days after. | Editable; the list reloads on change. |
| Search | Empty | Any part of the name or description. |

- Sorted closest to the transaction's date first (same merchant first when both show).
- Hides purchases already fully refunded. Payment-app payments (e.g. Venmo for a dinner) are listed, since a friend may pay you back for them.
- Up to 100 results. Each row has an amount box (defaults to what fits) and a Match button.
- Matches can be undone.

### 3.4 Paybacks and reimbursements

Money from a friend (Venmo, Zelle …) or from work (Expensify …) often pays you back for something you bought. Counted as income, it inflates income and overstates spending.

| Piece | Behavior |
|---|---|
| **Paybacks to review** | Money in from a payment app, reimbursement service, ATM or mobile deposit that still counts as income. It's a filter on Spending and Transactions. |
| Row tag | "payback?" or "reimbursement" on those rows, which expand to an action. |
| **Match to a purchase** | The same picker as manual matching (3.3), defaulting to any merchant, 45 days before to 3 days after. Choosing one gives the money in that purchase's category (so it becomes a refund) and links it with the amount entered. |
| **Not income: money back** | Pick a spending category. Optional: apply to every payment from this sender. |
| **Not income: my own money** | Category Transfer (e.g. cash you deposited). |
| **Count as income again** | Undoes either choice. |

### 3.5 Excluding a transaction

- The ⋯ menu on any transaction: **Exclude from totals**.
- The row stays visible, tagged "Excluded", amount struck through.
- It leaves spending, income, saved and invested totals. Net worth is unaffected (balances come from the bank).
- **Keep in net worth** (on a transfer): pick a manual account. Money out adds to that account's balance; money back subtracts. Example: buying a Treasury bill.
- **Count it again** undoes both.

### 3.6 Hiding amounts

- An eye button at the top right of each tab's title row.
- It hides the headline numbers on every tab (marked `sensitive` in the code) as "•••••". Tables further down stay visible.
- Remembered per device (localStorage). A tiny script in `<head>` applies it before the page paints, so numbers never flash.

### 3.7 Look and feel

| Thing | Rule |
|---|---|
| Colors | Income and gains green · spending and losses orange · refunds, returns and "no data" grey. |
| Navigation | Sidebar (desktop) and bottom tab bar (phone), same order: **Net worth · Spending · Transactions · Investments · Compensation** (Pay on phone). Each has an icon; the current tab gets a green bar and a filled icon. "Connections & files" sits below a divider under "Data". |
| Missing data | "—", never $0. |
| Phone | No sideways scrolling at 375px; tap targets at least 44px. |

---

## 4. Net worth tab (NW)

**Purpose:** where I stand today, and how it has changed.

**Layout, top to bottom**

| ID | Section | Details |
|---|---|---|
| NW-1 | **Hero** | Net worth today, change vs. the last month-end snapshot ($ and %), and the sum spelled out: "cash + investments + retirement − card balances". |
| NW-2 | **Quarter-end chart** | "Estimated net worth, quarter-end". Hidden until the 3rd completed quarter-end; before that, a line says when it unlocks. |
| NW-3 | **Summary cards** | Cash and savings · Investments · Retirement · Held for others, each with an icon. Tap one to filter the accounts list to it. |
| NW-4 | **Accounts** | Grouped by type, then by bank: one collapsible row per bank with its subtotal. Manual accounts stand alone with a "Manual" tag. |
| NW-5 | **Recent transactions** | Latest 20 across all accounts, labeled In / Out / Transfer. |

**Net worth formula**

```
net worth = Σ cash & savings (yours)
          + Σ investments
          + Σ retirement
          − Σ credit card balances
          + Σ family accounts you chose to count
```

**Account settings that change what counts**

| Setting | Values | Effect |
|---|---|---|
| Include in net worth | on / off | Off: the whole account is left out (hidden, greyed). |
| Held for others | Fixed amount · Whole balance | That much isn't yours. It's left out of net worth and shown under "Held for others". "Whole balance" follows the balance as interest grows. |
| Include in spending | on / off | Off: its transactions don't count as income or spending. |
| Group | cash · invest · retire · cards · family | Overrides the type-based default. |

**Rows with money held for others** (NW-6)

| Case | Main number | Small text | Row style |
|---|---|---|---|
| None held | Balance | — | Normal |
| Partly held | **Your part** (balance − held) | "of $12,000 · $4,000 held for others" | Normal |
| All held | **$0** | "All $9,500 held for others" | Light grey |

The bank subtotal adds up the main numbers, so it always matches the rows.

**How past net worth is calculated** (rebuilt after every sync and every settings change, so history follows today's choices)

| Account kind | Value at a past month-end | Estimate? |
|---|---|---|
| Any account with a saved balance on or before that date | That balance | No |
| Bank and card, before the first saved balance | Rebuilt backwards from its transactions | No |
| Treasury bills (manual account named "Treasury") | Rebuilt from TreasuryDirect purchases and maturities in bank transactions | No |
| Brokerage named after a known platform | Today's balance minus money moved in from the bank since then (market moves ignored) | Yes |
| Other investment and manual accounts | Grows evenly from $0 at the start of history to the first known balance | Yes |
| Manual account with dated entries | Latest entry on or before that date | No |

- A point is marked estimate if any estimated value is part of it.
- Month-end snapshots are stored; the chart shows quarter-ends.

---

## 5. Spending tab (SP)

**Purpose:** how much I spent and earned in a month, compared with my normal month.

**Layout, top to bottom**

| ID | Section | Details |
|---|---|---|
| SP-1 | **Income and spending chart** | Bars per month: income green, spending orange, returned grey. 6 / 12 / 24 month switch (default 6). Click a bar to pick that month. If the picked month is older than the range, the chart widens to include it. |
| SP-2 | **Month header** | "November 2026" with a month picker and "Back to this month". Everything below follows this month. |
| SP-3 | **Summary tiles** | Four self-contained tiles: Spending · Income · Saved · Invested. Title "So far this month" for the current month. |
| SP-4 | **Needs a look** | Low-confidence refund matches, only when there are any. |
| SP-5 | **By category** | Bars per category; click to filter the transactions. |
| SP-6 | **Transactions** | Type buttons with counts: All · In · Out · Refunds · Unmatched refunds · Paybacks to review. Same row menu as everywhere. Matched refunds greyed with the original struck through. |

**Each tile**

| Part | Content |
|---|---|
| Big number | This month's value |
| Note | One short line (see below) |
| Average | "6-mo avg $X" with a bar: fill = this month, dark tick = average |
| Delta | "↑ 12% vs avg" in green or orange. Finished months only (a month in progress isn't comparable). |
| Switch | "Avg of the [6 mo · 12 mo] before" for all four tiles |

**Calculations** (for month M)

| Number | Formula | Note line |
|---|---|---|
| **Spending** | Σ `net_spending.net` in M, for accounts included in spending. Refunds count in the purchase's month (3.3). | "$X spent · $Y returned" when there were returns |
| **Income** | Σ money in with flow `income` in M. Excludes accounts left out of spending and accounts fully held for others. Excludes transactions you excluded. | "incl. $Z interest" |
| **Interest** | The part of Income whose merchant or description contains "interest". Same account rules. Shown inside Income, not added again. | |
| **Saved** | Income − Spending | "N% of income" = Saved ÷ Income |
| **Invested** | Σ money out from bank (depository) accounts with category Investments in M. Contributions only; selling investments isn't savings. | "$X kept in cash" = Saved − Invested, or "$X drawn from cash" when negative |
| **Average** | Mean of the same number over the N full months **before** M (N = 6 or 12). So picking an older month moves the average with it. | Average saved rate = Σ saved ÷ Σ income over those months |
| **Delta** | (this month − average) ÷ │average│ | Green when better: higher income and saved, lower spending |

**Worked example** (made up), 6-month average for March:

| Month | Income | Spending | Saved |
|---|---|---|---|
| Sep–Feb (6 months) | $60,000 total | $33,000 total | $27,000 total |
| Average | $10,000 | $5,500 | $4,500 (45% of income) |
| March | $11,000 | $6,050 | $4,950 |
| Delta | ↑ 10% (green) | ↑ 10% (orange) | ↑ 10% (green) |

---

## 6. Transactions tab (TX)

**Purpose:** find any transaction and fix how it's counted.

| ID | Requirement | Details |
|---|---|---|
| TX-1 | **Filters, top to bottom** | Row 1: type buttons with counts (All · In · Out · Refunds · Unmatched refunds · Paybacks to review), Net / Raw switch on the right. Row 2: search, account, date range, amount min–max. Applies instantly. |
| TX-2 | **Totals bar** | Sum of what's shown: In, Out and Net. |
| TX-3 | **Net vs Raw** | Net: amounts after refunds applied. Raw: the bank's amounts as sent. |
| TX-4 | **Row menu (⋯)** | Change category (this one or all from merchant) · Exclude from totals · Keep in net worth · Match refund · Not income: money back / my own money · Count again. |
| TX-5 | **Expandable rows** | Refunds show what they matched; purchases show refunds applied; paybacks show the match action (3.4). |
| TX-6 | **Empty accounts explained** | Investment and manual accounts have no transactions from Plaid. Picking one says why and links to the matching bank transfers. |

- **In / Out** leave out card payments (shown under All).
- Uses the same components, colors and menu as Spending.

---

## 7. Investments tab (IN)

**Purpose:** what I own, how it's split, and how it's doing.

### 7.1 Data

| ID | Requirement | Details |
|---|---|---|
| IN-1 | **Consent per connection** | Connections & files shows "Add investment details" on brokerage connections. It opens Plaid Link in update mode on the same connection (`additional_consented_products: investments`). Never creates a new connection. |
| IN-2 | **Holdings sync** | Each sync pulls holdings and securities, and 24 months of investment transactions (every time, because brokers backfill later). |
| IN-3 | **Manual accounts** | A manual investment or retirement account shows as one holding with its balance. You can add holdings inside it by hand (name, ticker, shares, value, type); the rest of the balance stays as a "(rest)" line. |
| IN-4 | **Daily snapshots** | Each sync saves today's value of every holding. A later sync the same day replaces it. Days without a sync are missing; nothing is back-filled. |
| IN-5 | **Refresh now** | Button in the title row. Asks Plaid to fetch fresh data from each broker (`/investments/refresh`), waits 30 seconds, then runs a full sync. Account balances from the holdings answer are saved, so Net worth and every tab update too. Manual only. |

**How each holding line is built** (per account)

| Case | Line(s) |
|---|---|
| Broker lists holdings | One line per holding. $0 cash placeholders are dropped. |
| Balance − listed holdings > $50 | Extra "Cash" line for the gap (uninvested cash the broker didn't list). |
| Manual account with holdings added | Those holdings, plus "(rest)" for the remaining balance if over $50. |
| No holdings listed | One line for the whole balance: cash if investment details are on, otherwise its account asset type. |

**Classification**

| Field | Rule |
|---|---|
| Asset type | crypto (wins over the cash flag) · cash-equivalent → cash · equity → stocks, except fund-named holdings with a placeholder ticker (in-plan 401(k) funds) → ETFs & funds · ETF, mutual fund → ETFs & funds · fixed income → bonds & Treasuries · else other |
| Whole-account lines | Name has crypto → crypto · Treasury, T-bill, bond → bonds · RSU, ESPP, stock → stocks · 401k → ETFs & funds |
| Account tax type | Roth in subtype or name → Roth · HSA, 529 → other · retirement group → traditional · else taxable |
| Combining across accounts | Same ticker → one row. No ticker: by Plaid security, then by name. |

### 7.2 Page, top to bottom

| ID | Section | Details |
|---|---|---|
| IN-6 | **Total value** | Σ all holding lines. Note: "$X investments + $Y retirement", the same split as the Net worth cards. |
| IN-7 | **Unrealized gain** | See 7.3. Note says how much value has no cost basis. |
| IN-8 | **Change since last month-end** | Today's total − the total of the latest snapshot on or before the last month-end, $ and %. "—" until a month-end snapshot exists. |
| IN-9 | **Weekly line** | Inside the change card. See 7.4. |
| IN-10 | **Allocation** | Bars by asset type, with a switch for account type and account. $ and %. |
| IN-11 | **Concentration** | Top 10 holdings (cash left out) as % of the total. A single stock or coin over 10% is flagged. Funds and whole-account lines are shown but never flagged. |
| IN-12 | **Holdings table** | See 7.5. |
| IN-13 | **Value over time, quarter-end** | From snapshots only. Hidden until the 3rd quarter-end. Includes money added, not just growth. |
| IN-14 | **Activity** | Investment transactions with month and type filters (buy · sell · dividend · contribution · fee · other). Header shows "Dividends 2026: $X"; "—" while the broker's history doesn't cover the whole year. |

### 7.3 Unrealized gain

```
for each holding that is not cash and has a cost basis:
    gain = value − cost basis

unrealized gain = Σ gain
gain %          = unrealized gain ÷ Σ cost basis (of those same holdings)
```

- Cash is left out of both (no gain possible).
- Holdings with no cost basis are left out of both. Their total value is shown: "$X has no cost basis, not included".
- Typical holdings without a basis: workplace 401(k) funds, and anything in a manual account.
- Example: VTI worth $12,000 with a $10,000 basis, and a 401(k) fund worth $50,000 with none. Gain = +$2,000 (+20.0%); "$50,000 has no cost basis".

### 7.4 Weekly line

- One point per week (weeks end Sunday): the **last** saved total in that week.
- Weeks with no saved value are gaps in the line, never filled in.
- Up to 52 weeks.
- With only one week saved: a single point with its value, plus "The line starts from the week of …". Brokers don't share past values, so history starts the first day you synced.

### 7.5 Holdings table

| Part | Behavior |
|---|---|
| Rows | One per security across accounts: holding, type, shares, price, value, % of total, cost basis, gain $ and %. Click a row to see which accounts hold it. Sortable; phone gets a sort picker. |
| **Type filter** | One segmented control: All · Stocks · ETFs & funds · Bonds & Treasuries · Cash · Crypto, with counts. Labeled "Type". |
| **Account filter** | Separate round chips with the account name only. Labeled "Account". Grouped (below). |
| **Subtotal row** | Bottom of the table. Sums only what the filters show: value, % of total, cost basis, gain. Says "Total" with no filter, "Subtotal" with one. |

**Account chip grouping**

| Rule (checked in order) | Chip |
|---|---|
| Account worth under $30 | "Other" (always last) |
| Account you track by hand | "Tracked by hand" |
| Taxable account at a broker that has another taxable account | One chip named after the broker (e.g. individual + crypto → "Schwab") |
| Anything else | Its own chip (e.g. Roth IRA, 401(k)) |

### 7.6 Freshness

| Action | What it gets |
|---|---|
| Sync now | Plaid's saved copy. For investments, Plaid pulls from the broker about once a day, after market close. |
| Refresh now | Plaid fetches from the broker right now. Still limited by the broker: new shares often appear only after the trade settles. |

---

## 8. Compensation tab (CP)

**Purpose:** what I'm paid, where each paycheck goes, and my key rates. Pay data never leaves this computer.

### 8.1 Getting data in

| ID | Requirement | Details |
|---|---|---|
| CP-1 | **Upload** | Drop zone on Connections & files and at the bottom of Compensation. Accepts pay statement PDFs, W-2 PDFs and a base pay history screenshot. Each file is read on-device, filed into `data/compensation/` (gitignored), imported, and the tab updates. Re-uploading the same file makes no copy. A file that isn't a pay document is turned away and not kept. |
| CP-2 | **Command line** | `npm run comp:import` re-imports the whole folder. Same reader as the upload. Re-running adds no duplicates (a statement's ID is its payroll advice number). |
| CP-3 | **Checks** | `npm run comp:check` reports problems and never changes data (8.6). |

**What's stored per statement**: pay date, period, kind (paycheck · vest · payout), every line with this-period and year-to-date amounts, net pay, and bank deposits.

**Line groups** (match the payroll provider's year-to-date view)

| Group | Examples | Cash? |
|---|---|---|
| Earnings | Base, bonus, PTO, allowances | Yes |
| RSU income | Stock vest value | No |
| Taxes | Federal income, Social Security, Medicare, state and local | — |
| Pre-tax | 401(k), HSA, medical, dental | — |
| Post-tax | Roth 401(k), after-tax 401(k), state insurance programs | — |
| RSU kept | Offset for the vest value kept as shares | No |
| Added to pay | Stock sale proceeds paid through payroll | Yes, not income |

**Reading the documents**

- PDFs: text layer with positions, OCR when a page has none.
- Amounts written with spaces ("1 234 56") are read as 1,234.56. Rates can have 4 decimals.
- A lone amount's column (this period vs YTD) is decided by its right edge.
- Statement kinds: has base earnings → paycheck; RSU income only → vest; stock proceeds only → payout.

### 8.2 Page, top to bottom

| ID | Section | Details |
|---|---|---|
| CP-4 | **Year switch** | Years with statements or a W-2. Past years without statements show W-2 figures instead. |
| CP-5 | **Summary** | "Cash pay + RSU (stock) = Total pay", then Take-home. Year to date. |
| CP-6 | **Rate card** (right, colored) | Base salary in effect at year end (today for this year), per paycheck, and the last raise (% and date). A rate, not year to date. |
| CP-7 | **Your rates** | 401(k) · HSA · Tax rate · Monthly take-home (8.3), plus "changes this year". |
| CP-8 | **Where my paycheck goes** | One bar from gross cash pay to taxes, pre-tax, post-tax and take-home, $ and %. Hover a segment for its value; click to list its lines. RSU income is a separate, hatched, non-cash bar: "Taxes, paid with shares" and "Kept as shares". Views: year to date (bars on the same scale) · latest paycheck. |
| CP-9 | **Monthly table** | Months as columns, then Monthly avg (completed months only) and YTD. Collapsible groups; non-cash rows striped. Current month greyed and marked "so far". Last row "= Take-home". |
| CP-10 | **RSU vests** | One row per vest date with its grants inside, any sale payout, and yearly totals. |
| CP-11 | **Base salary history** | Step chart from the first record to today. Each raise labeled with salary, date, % and reason. Summary: total growth and ≈ % a year. |
| CP-12 | **Add pay documents** | Compact drop zone (CP-1). |

### 8.3 Calculations

**Totals**

| Number | Formula |
|---|---|
| Cash pay | Σ Earnings lines |
| RSU (stock) | Σ RSU income lines |
| Total pay | Cash pay + RSU |
| Take-home | Σ net pay of every statement (all deposits, stock sale payouts included) |

**401(k) tile**

```
401(k) % = 401(k) amount on the latest paycheck ÷ base pay on that paycheck
```

- Base pay per paycheck = the rate on the Regular earnings line.
- It's a **percentage of salary**, so it grows with raises. A dollar change at the same % is reported as "after the raise (still 8%)".
- Lines: "$X per paycheck" and "$Y this year · Roth $Z".
- The employer match is set by the employer's plan, not by this %. Plan caps can be reached before year end.

**HSA tile**

```
HSA per month ≈ HSA per paycheck × 26 ÷ 12
```

**Tax rate tile.** Three rates, each on its own base, so they never contradict each other:

| Rate | Formula |
|---|---|
| Overall | All taxes ÷ total pay (cash + RSU) |
| Cash pay | Taxes on paychecks and payouts ÷ cash pay |
| RSUs | Taxes withheld at vest ÷ RSU income |

- Example: cash pay $100,000 with $20,000 tax (20.0%); RSU $50,000 with $16,000 withheld (32.0%). Overall = $36,000 ÷ $150,000 = 24.0%.
- The breakdown by tax type (federal, Social Security, Medicare, state) is in the paycheck bar's drill-down, not the summary.

**Monthly take-home**

```
completed months = months before the current one that have any statement
average          = Σ net pay in those months ÷ number of those months
```

- **Without one-time bonus:** for each paycheck with a bonus line, its after-tax part is estimated as `bonus − taxes × (bonus ÷ gross)`, and that's removed before averaging. Payroll withholds bonuses at a flat rate, so this is an estimate.
- Shows the month range ("Jan–Oct").
- The table's "Monthly avg" uses the same completed-months rule, so the two match.

**Base salary steps**

- Same-day changes merge into one step.
- Changes to pay period only (no salary change) are skipped.
- Raise % = (new − old) ÷ old.
- ≈ % a year = compound annual rate from the first salary to today's.

### 8.4 W-2 years

For years with only a W-2: wages (box 1), federal tax (box 2), Social Security and Medicare (boxes 4 and 6), and box 12 codes (401(k) D, Roth AA, HSA W), checked against each other (8.6).

### 8.5 What pay statements don't show

| Missing | Effect |
|---|---|
| RSU share count, price in home currency, FX rate | Vests show USD value only. |
| Fees on stock sales | Only the net payout appears. |
| Paychecks before the oldest statement | Those W-2s can only be checked internally. |

### 8.6 Data checks (`comp:check`)

| Check | Rule |
|---|---|
| Net math | gross − taxes − deductions = net, to the cent |
| Federal taxable wages | gross − pre-tax lines = taxable wages shown |
| YTD chain | Each line's YTD = previous YTD + this period (split rows combined; lines that never print a YTD skipped) |
| Pay gaps | More than 15 days between regular paychecks |
| Unclassified | Any line not in a known group |
| Stock items | Proceeds and fees listed for review |
| Deposits | Each statement's deposits found in bank transactions within ±3 days |
| W-2 | Box 1 = gross + group term life − 401(k) − FSA − HSA · box 4 = 6.2% of box 3 · box 6 = 1.45% of box 5 + 0.9% over $200k · box 5 = gross + group term life − FSA − HSA |

---

## 9. Connections & files (CN)

| ID | Requirement | Details |
|---|---|---|
| CN-1 | **Connect a bank** | Plaid Link (production). Trial plan: up to 10 connections; removing one doesn't free a slot. |
| CN-2 | **Connected list** | Each connection: accounts, last sync, status, "Add accounts" (update mode with account selection), "Add investment details" (IN-1). |
| CN-3 | **Fix a connection** | When Plaid asks to sign in again, update mode on the same connection. Never a new one. |
| CN-4 | **Pay documents** | The upload in CP-1. |
| CN-5 | **Sync now** | Sidebar bottom (desktop) and phone header. Shows "Last synced …" and the number of connections. |

---

## 10. Account detail page (AC)

| ID | Requirement | Details |
|---|---|---|
| AC-1 | **Transactions in and out** | Every transaction for the account, with the same row menu. |
| AC-2 | **Settings** | Display name, group, include in net worth, include in spending, held for others. |
| AC-3 | **Manual accounts** | Dated balance log (as-of date, date added, change). Backdated entries replace net worth estimates. |

---

## 11. Known limits

Data sources, not app bugs.

| Limit | Effect |
|---|---|
| Some banks send no pending charges | Recent purchases appear a day or two late. |
| Some banks give about 90 days of history | Early months can be incomplete. |
| Plaid refreshes balances about once a day | "Sync now" can't be newer than Plaid's copy. |
| Brokers update positions after settlement | New shares can take a business day to appear, even with Refresh now. |
| Workplace 401(k) | No cost basis. |
| Some brokers send little or no activity | Activity and dividends may start recently or be empty. |
| Prices are the latest close | Not live. No realized gains or tax lots. |
| No investment history before the first sync | Weekly and quarterly charts start then. |

---

## 12. Decisions log

| Question | Decision |
|---|---|
| Trend threshold | Show charts from the 3rd quarter-end. |
| Monthly vs quarterly | Snapshots monthly, chart quarterly. |
| Travel and services | Travel stays its own category; services go to Bills & Utilities. |
| Card payments in In / Out | Left out; shown under All. |
| Plaid Investments (billed product) | Approved. Only fetched for connections opted in. |
| Daily snapshot when the Mac is asleep | One per day; a later sync replaces it. Month-end uses the latest on or before that date. |
| Trial plan limit | Update mode only; never create a new connection. |
| Investments refresh | Manual button only. Free on Trial; would bill per call on a paid plan. |
| Venmo and reimbursements | Never auto-matched; reviewed and matched by hand (3.4). |
| Interest | Counted in income from every account except ones fully held for others; shown separately. |
| Tax rate | Three rates on their own bases (8.3), not one blended figure. |
| Held for others on account rows | Main number is your part; grey row when none of it is yours. |

---

## 13. Not built yet

| ID | Idea | Priority |
|---|---|---|
| IN-15 | Contributions vs market growth per month: growth = value change − net money in. Needs two month-end snapshots. | P2 |
| CP-13 | Month view for "Where my paycheck goes". | P1 |
| CP-14 | Per-paycheck columns in the monthly table. | P1 |
| CP-15 | Limits tracker: 401(k), HSA, FSA vs this year's IRS limits from a small config file. | P1 |
| CP-16 | Edit or add base pay rows in the app. | P1 |
| CP-17 | Bank cross-check of deposits shown in the app. | P1 |
| CP-18 | Data checks panel in the app. | P1 |

---

## 14. Hosting online (HS)

The same code runs on a server (Railway) for phone access from anywhere. Setup steps: [hosting-railway.md](hosting-railway.md).

| ID | Requirement | Details |
|---|---|---|
| HS-1 | **Login** | On whenever `APP_PASSWORD` is set. Password compared as scrypt hashes in constant time. Optional authenticator code (`TOTP_SECRET`, RFC 6238, 30-second codes, one step of drift, each code works once). Wrong password or code gives the same message. |
| HS-2 | **Session** | Signed cookie (HMAC-SHA256), HttpOnly, Secure on HTTPS, SameSite=Lax, 30 days. Changing `APP_PASSWORD` or `SESSION_SECRET` signs every device out. |
| HS-3 | **Lockout** | 5 wrong tries in a row lock login for 15 minutes, app-wide (not per device). Count resets on success. Stored in `auth_throttle`. |
| HS-4 | **Everything protected** | Middleware checks the session on every page and API. Public: login page and API, `/api/health`, manifest and icons. Pages redirect to login; APIs return 401. The login page shows nothing of the app. |
| HS-5 | **Same-site check** | Data-changing API calls must come from the app's own address (request host, `RAILWAY_PUBLIC_DOMAIN` or `APP_DOMAIN`, or this Mac's Tailscale address). |
| HS-6 | **Storage** | `DATABASE_PATH` and `SECRETS_PATH` point to a Railway volume (`/data`). Plaid keys come from variables. |
| HS-7 | **One-time upload** | `npm run hosted:upload` copies the Mac's database (consistent copy), strips pay tables from the copy, logs in, and sends it with the tokens file. The server checks integrity, a token per connection, no pay data, upgrades the copy's schema, and only then swaps it in. Refuses to overwrite existing connections without `--replace`; keeps backups when replacing. |
| HS-8 | **Pay data switch** | `HOSTED_INCLUDE_COMPENSATION` (default false). Off: no Compensation tab or route, and pay data is refused on upload. Pay document upload is Mac-only either way (needs PDFKit and Vision). |
| HS-9 | **Daily sync** | Inside the app (no extra service): checks every 30 minutes and syncs once a day after `SYNC_HOUR` (default 6) in `TZ`, if nothing synced since. Sync now still works. |
| HS-10 | **Bank sign-in return** | `/oauth` reopens Plaid Link with the saved token (`PLAID_REDIRECT_URI`) to finish OAuth banks on a phone. Update mode only. |
| HS-11 | **Phone** | Manifest, icons and the bottom tab bar unchanged. Without Compensation the tab bar has 4 tabs. |
| HS-12 | **Pay numbers without PDFs** | The Mac reads the PDFs; only the resulting pay rows go to the website, which replaces its pay rows in one step and touches nothing else. Refused unless `HOSTED_INCLUDE_COMPENSATION=true`. |
| HS-13 | **Link code (one-time setup)** | Mac app → Connections & files → link the website address; the app makes a random link code (saved in `data/website-link.json`, owner-only) and shows the Railway steps (`PAY_SYNC_TOKEN`). Then pay numbers go automatically after every PDF upload, plus a "Send now" button. The website accepts the code (Bearer, constant-time check) on `/api/admin/pay` only. `npm run hosted:pay` remains as a Terminal alternative using the login. |
| HS-14 | **Demo website** | `DEMO=1`: rebuilds made-up data (every tab, incl. Investments history and a year of pay) at start and nightly at 3:00; "Sample data" banner; sync, Plaid, uploads, data restore and the website link are blocked; Compensation always on. No volume or Plaid keys. Same sample data as `npm run demo`. |

- _Open:_ email one-time codes need an outside email service, so they aren't built. The authenticator code covers the second step.

