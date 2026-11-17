# Finance app · Improvements PRD v2

**Status: built.** This doc describes what the app does now. Raw notes it came from: [PRD.md](PRD.md).

- **Requirement IDs:** page code + number. Example: OV-1 = Overview requirement 1.
- **Priority:** P0 must have · P1 should have · P2 nice to have.
- **Goal:** the Overview shows where I stand at a glance, and spending numbers count only real income and real spending.

---

## Global (GL)

| ID | Requirement | As built | Priority |
|---|---|---|---|
| GL-1 | **Exclude a transaction from calculations.** | A faint ⋯ on every transaction offers **Exclude from totals**. The row stays visible, tagged "Excluded", amount struck through. **Count it again** undoes it. Stored in `txn_exclusions`; raw transactions are never changed. | P0 |
| GL-2 | **Investment transfers aren't spending or income.** | Money to or from Robinhood, TreasuryDirect, Fidelity, Schwab, Vanguard, E\*Trade, Wealthfront or Betterment is an investment transfer. Treasury bill maturities ("APA TREAS … MISC PAY") count as money coming back, not income. Your own category edits still win. | P0 |
| GL-3 | **Simplified categories.** | Final list below. A migration mapped old categories (overrides and merchant rules too) and logged the originals in `category_migration_log`. | P0 |
| GL-4 | **One color code.** | Income green · spending orange · refunds and returns grey, in charts, tags and amounts. Only "pending" tags are highlighted. | P1 |
| GL-5 | **Keep a transfer in net worth.** | On a transfer, the ⋯ menu offers **Keep in net worth** with a manual-account picker. Money out adds to that account; money back subtracts. **Count it again** reverses the change. | P1 |

**Category list (GL-3, final)**

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
| Hobbies | Was Entertainment |
| Health | Medical |
| Personal Care | Gym, skincare |
| Insurance | |
| Fees & Taxes | Bank fees, interest charges, taxes, legal and accounting fees |
| Pets | |
| Other | Anything else, incl. education and donations |
| Not spending | Income · Transfer · Credit card payment · Investments · Loan payment |

---

## Overview (OV)

| ID | Requirement | As built | Priority |
|---|---|---|---|
| OV-1 | **Net worth trend at quarter end.** | Month-end snapshots, shown as quarter-end points. Titled "Estimated net worth, quarter-end". | P0 |
| OV-2 | **Back-fill history.** | See *How past net worth is calculated* below. | P0 |
| OV-3 | **Hide the chart until there's enough data.** | Shown from the 3rd completed quarter-end. Before that, a line says when it unlocks. | P1 |
| OV-4 | **Icon on each summary card.** | Line icons: bank, rising arrow, hourglass, heart. | P2 |
| OV-5 | **Accounts grouped by type, then by bank.** | One collapsible row per bank with a subtotal. Manual accounts stand alone. | P0 |
| OV-6 | **Recent transactions panel.** | Latest 20 across all accounts, labeled In / Out / Transfer, scrolls inside its box. | P0 |
| OV-7 | **Summary cards filter the accounts list.** *(added)* | Tap a card to show only those accounts, every bank expanded. Tap again or "Show all accounts" to go back. | P1 |

**Layout:** Accounts takes about 55% of the row, Recent transactions the rest. They stack on narrow screens.

**How past net worth is calculated**

| Account kind | Before its first saved balance | Marked estimate? |
|---|---|---|
| Bank and card | Rebuilt from its transactions | No |
| Treasury bills (manual account named "Treasury") | Rebuilt from TreasuryDirect purchases and maturity payments | No |
| Brokerage named after a supported platform (Robinhood, Schwab, Vanguard, …) | Today's balance minus money moved in from your bank since (market moves ignored) | Yes |
| Other investment and retirement | Grows evenly from $0 at the start of history to the first known balance | Yes |
| Manual with dated entries | Latest entry on or before that date | No |

- The hero compares today with the last month-end snapshot ("vs. Oct 31 snapshot").
- Manual accounts keep a dated entry log (as-of date, date added, change). Backdated entries replace estimates.

---

## Spending (SP)

| ID | Requirement | As built | Priority |
|---|---|---|---|
| SP-1 | **Remove the Ask section.** | Removed. | P0 |
| SP-2 | **Remove the incomplete-history notice.** | Removed. | P1 |
| SP-3 | **Chart colors.** | Income green, spent orange, returned grey (GL-4). | P0 |
| SP-4 | **Chart range by month.** | Defaults to 6 months. Buttons: 6 / 12 / 24 mo. | P1 |
| SP-5 | **Savings split.** | **Where it went** replaced "Cash savings": what you saved, split into invested and kept in (or drawn from) cash. Excluded transactions don't count. | P0 |
| SP-6 | **Type filter with counts.** | All · In · Out · Refunds · Unmatched refunds. In and Out leave out card payments. | P0 |
| SP-7 | **Matched refunds greyed out.** | Whole row light grey on a faint background, original amount struck through. | P1 |
| SP-8 | **Filter by month.** | Month picker in the month header. It drives the summary, categories and transactions. | P0 |
| SP-9 | **Chart and month stay in sync.** | Clicking a bar or picking a month selects it everywhere. The chart widens if the month is outside its range. | P0 |
| SP-10 | **Row menu (⋯) on every transaction.** | GL-1 and GL-5. | P0 |

**Page structure, top to bottom**

1. **Income and spending** chart card.
2. **Month header**, e.g. "November 2026", with the month picker.
3. **Summary** card, two aligned rows with the same four columns:
   - _This month:_ Net spending · Income · Saved · Where it went.
   - _Average month:_ the same four, with a 6 / 12 mo switch on that row only.
4. **Needs a look** (low-confidence refund matches), only when there are any.
5. **By category**: click bars to filter the transactions.
6. **Transactions** card: title and sort, then type buttons, then rows.

---

## Transactions (TX)

| ID | Requirement | As built | Priority |
|---|---|---|---|
| TX-1 | **Clearer filter layout.** | Row 1: type buttons with counts, Net / Raw switch on the right. Row 2: search, account, dates, amount min–max. No Apply button. Totals row below. | P1 |
| TX-2 | **Same buttons, colors and row menu as Spending.** | Shared components. | P1 |
| TX-3 | **Explain empty accounts.** *(added)* | Investment and manual accounts have no transactions from Plaid. Picking one explains why and links to the matching bank transfers. | P2 |

---

## Account detail (AC)

| ID | Requirement | As built | Priority |
|---|---|---|---|
| AC-1 | **Exclude option on account transactions.** | Same ⋯ menu and "Excluded" tag. Changes show on Spending and Overview. | P1 |

---

## Decisions (were open questions)

| Question | Decision |
|---|---|
| Q1 · Trend threshold | Show from the 3rd quarter-end. |
| Q2 · Monthly vs quarterly | Snapshots monthly, chart quarterly. |
| Q3 · Travel and services | Travel stays its own category. Services go to Bills & Utilities. |
| Q4 · Fees | Fees & Taxes: bank fees, interest, taxes, legal and accounting fees. |
| Q5 · Treasury balance | GL-5, optional per transfer. Treasury history is also rebuilt from transactions. |
| Card payments in In / Out | Left out. Still shown under All. |

## Known limits (data sources, not app bugs)

- Some banks send no pending charges through Plaid.
- Some banks give Plaid only about 90 days of history.
- Investment accounts share balances only. Trades need Plaid's paid Investments product.
- Plaid refreshes balances roughly daily. Forcing a refresh needs a paid endpoint.

## Ground rules

- Never call endpoints that move money.
- Ask before adding any paid service.
- Database and secrets stay out of git.
