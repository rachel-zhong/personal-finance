# Finance app · Improvement notes (v1)

Raw notes collected before v2. **Superseded by [PRD-v2.md](PRD-v2.md)**, which turns them into numbered requirements and records what was built.

## Overview

- Net worth chart: use a snapshot from the last day of each quarter instead of estimates.
  - Back-fill past quarters where real data exists; otherwise start collecting now.
  - Hide the chart until there are more than two quarters of data.
- Give each summary card (cash and savings, investments, retirement, held for others) a simple, readable icon.
- Group accounts from the same bank into one clean, collapsible row.
  - A bank's cash accounts sit under Cash and savings; its credit cards stay under Credit cards.
- Show the latest 10+ transactions (money in, money out, internal transfers), each clearly labeled.

## Spending

- Remove the question box (it doesn't work yet).
- Remove the "some months are incomplete" notice.
- Chart colors: income green, spending orange, returns grey.
- Chart defaults to 6 months, with a simple way to show more, by month rather than by date.
- Matched refunds in a lighter grey.
- Transaction filter: In, Out, Refunds, Unmatched refunds. In includes anything positive, transfers included. Drop the "transfers & income" checkbox.
- Filter the transaction table by month.
- Cash savings: income minus spending, minus money moved to investments (brokerage, Treasury bills).
- A low-key option on each transaction to leave it out of calculations or keep it in net worth.
  - Example: moving money to a Treasury bill shouldn't count as spending, and the money coming back shouldn't count as income.

## Categories

- Simplify the list: Rent & mortgage, Groceries, Dining, Travel, Shopping (with clothing), Personal care (gym, skincare), Health (medical), Fees, Utilities, Bills, Home, Pets, Hobbies (was Entertainment), Other.
- No Donations category. Anything that can't be categorized goes to Other.

## Transactions

- Make the filter hierarchy clearer: what kind of transaction first, then the narrowing filters.

## Known limits (data sources, not app bugs)

- Some banks send no pending charges through Plaid.
- Some banks give Plaid only about 90 days of history.
- Plaid refreshes balances roughly daily. Forcing a refresh needs a paid endpoint.

## Ground rules

- Never call endpoints that move money.
- Ask before adding any paid service.
- Database and secrets stay out of git.
