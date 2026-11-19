/**
 * Sample data for the demo: every name and number is made up. Used by `npm run demo` on your Mac and by the
 * demo website (DEMO=1), which rebuilds it on every start and every night.
 * Refuses to touch any database whose path doesn't contain "demo".
 */
import fs from "node:fs";
import { closeDb, getDb, newId, nowIso, type Db } from "@/lib/db";
import { upsertAccount, upsertBalance, upsertInstitution, upsertTransaction, refreshDerived } from "@/lib/store";
import { runAutoMatch, shiftDate } from "@/lib/refunds/matcher";
import { addManualBalance } from "@/lib/connectors/manual";
import { rebuildNetWorthSnapshots } from "@/lib/networth";
import { resequence } from "@/lib/compensation/store";
import { snapshotHoldings } from "@/lib/investments";

const today = () => new Date().toLocaleDateString("en-CA");

export async function seedDemo(file: string) {
  if (!file.includes("demo")) throw new Error("Refusing to seed a non-demo database");
  closeDb();
  for (const f of ["", "-wal", "-shm"]) fs.rmSync(file + f, { force: true });
  process.env.DATABASE_PATH = file;
  const db = getDb();
  const end = today();

  await banking(db, end);
  await investments(db, end);
  await pay(db, end);

  await refreshDerived(db);
  const { created } = await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
  await snapshotHoldings(db); // today's values, as a sync would save them
  return { refundsMatched: created };
}

// ---------- Banks, cards, spending (about 15 months) ----------

const DAYS = 460;

async function banking(db: Db, end: string) {
  const inst = await upsertInstitution(db, { source: "csv", externalId: "demo", name: "Wells Fargo" });
  const checking = await upsertAccount(db, { source: "csv", externalId: "demo-chk", institutionId: inst, name: "Everyday Checking", type: "depository", subtype: "checking", mask: "0042" });
  const savings = await upsertAccount(db, { source: "csv", externalId: "demo-sav", institutionId: inst, name: "Way2Save Savings", type: "depository", subtype: "savings", mask: "3307" });
  const card = await upsertAccount(db, { source: "csv", externalId: "demo-card", institutionId: inst, name: "Citi Double Cash", type: "credit", subtype: "credit card", mask: "7781" });
  const family = await upsertAccount(db, { source: "csv", externalId: "demo-family", institutionId: inst, name: "Family Savings", type: "depository", subtype: "savings", mask: "5510" });
  await db.run("UPDATE accounts SET net_worth_held_mode = 'all', include_in_spending = 0, net_worth_note = 'Family' WHERE id = ?", [family]);

  for (let d = DAYS; d >= 0; d -= 7) {
    const day = shiftDate(end, -d);
    await upsertBalance(db, checking, day, 800000 + (DAYS - d) * 900 + Math.round(Math.sin(d) * 40000));
    await upsertBalance(db, savings, day, 2200000 + (DAYS - d) * 2600);
    await upsertBalance(db, card, day, 120000 + Math.round(Math.cos(d) * 50000));
    await upsertBalance(db, family, day, 2500000);
  }
  // A 401(k) tracked by hand, with a few dated balances
  for (let q = 4; q >= 0; q--) {
    await addManualBalance(db, { accountName: "Vanguard 401(k)", type: "investment", asOf: shiftDate(end, -q * 91), balanceCents: 5400000 + (4 - q) * 310000 });
  }

  let n = 0;
  const t = async (acc: string, type: string, daysAgo: number, amt: number, merchant: string | null, desc: string, cat: string, detailed?: string) =>
    upsertTransaction(db, { accountId: acc, accountType: type, source: "csv", externalId: `demo-${n++}`, date: shiftDate(end, -daysAgo),
      amount: Math.round(amt * 100), merchant, description: desc, category: cat, pending: daysAgo < 2,
      raw: { demo: true, ...(detailed ? { personal_finance_category: { primary: cat, detailed } } : {}) } });

  const shops: [string, string, number, string?][] = [
    ["Whole Foods", "FOOD_AND_DRINK", 68, "FOOD_AND_DRINK_GROCERIES"], ["Blue Bottle", "FOOD_AND_DRINK", 7],
    ["Shell", "TRANSPORTATION", 52], ["Netflix", "ENTERTAINMENT", 15.49], ["City Power & Light", "RENT_AND_UTILITIES", 110],
    ["Trader Joe's", "FOOD_AND_DRINK", 54, "FOOD_AND_DRINK_GROCERIES"], ["Uber", "TRANSPORTATION", 23], ["Sweetgreen", "FOOD_AND_DRINK", 16],
  ];
  for (let d = DAYS - 10; d >= 0; d -= 2) {
    const [m, c, base, detailed] = shops[d % shops.length];
    await t(card, "credit", d, -(base + (d % 7) * 3.1), m, m.toUpperCase(), c, detailed);
  }
  for (let d = DAYS - 5; d >= 0; d -= 14) await t(checking, "depository", d, 3850, null, "ACME CORP PAYROLL", "INCOME");
  for (let d = DAYS - 3; d >= 0; d -= 30) await t(savings, "depository", d, 62 + ((DAYS - d) % 90) / 10, null, "INTEREST PAYMENT", "INCOME");
  for (let d = DAYS - 10; d >= 0; d -= 30) await t(card, "credit", d, 1500, null, "Payment Thank You", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  for (let d = DAYS - 2; d >= 0; d -= 30) await t(checking, "depository", d, -2100, "Parkview Apts", "PARKVIEW APTS RENT", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT");
  for (let d = DAYS - 8; d >= 0; d -= 30) await t(checking, "depository", d, -(1200 + (d % 4) * 400), "Schwab", "SCHWAB BROKERAGE TRANSFER", "TRANSFER_OUT");
  for (let d = DAYS - 20; d >= 0; d -= 45) await t(checking, "depository", d, 85, "Venmo", "VENMO CASHOUT", "TRANSFER_IN");
  // Returns: matched in full, in part, and one with no purchase
  await t(card, "credit", 40, -240, "Target", "TARGET.COM", "GENERAL_MERCHANDISE");
  await t(card, "credit", 30, 60, "Target", "TARGET.COM REFUND", "GENERAL_MERCHANDISE");
  await t(card, "credit", 25, 80, "Target", "TARGET.COM REFUND", "GENERAL_MERCHANDISE");
  await t(card, "credit", 70, -129.99, "Nike", "NIKE.COM", "GENERAL_MERCHANDISE");
  await t(card, "credit", 60, 129.99, "Nike", "NIKE.COM RETURN", "GENERAL_MERCHANDISE");
  await t(card, "credit", 10, 35, "REI", "REI #44 RETURN", "GENERAL_MERCHANDISE");
  await t(family, "depository", 20, -400, "Costco", "COSTCO", "GENERAL_MERCHANDISE");
}

// ---------- Investments: holdings with cost basis, weekly history, activity ----------

interface Sec { id: string; ticker: string; name: string; type: string; price: number; qty: number; basis: number; acct: "brk" | "roth" | "crypto" }
const SECS: Sec[] = [
  { id: "demo-vti", ticker: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf", price: 298.4, qty: 62, basis: 14800, acct: "brk" },
  { id: "demo-vxus", ticker: "VXUS", name: "Vanguard Total International Stock ETF", type: "etf", price: 68.2, qty: 120, basis: 7300, acct: "brk" },
  { id: "demo-aapl", ticker: "AAPL", name: "Apple Inc.", type: "equity", price: 231.5, qty: 18, basis: 3100, acct: "brk" },
  { id: "demo-msft", ticker: "MSFT", name: "Microsoft Corp.", type: "equity", price: 452.1, qty: 9, basis: 3300, acct: "brk" },
  { id: "demo-nvda", ticker: "NVDA", name: "NVIDIA Corp.", type: "equity", price: 141.3, qty: 30, basis: 2600, acct: "brk" },
  { id: "demo-bnd", ticker: "BND", name: "Vanguard Total Bond Market ETF", type: "etf", price: 73.9, qty: 40, basis: 3050, acct: "brk" },
  { id: "demo-voo", ticker: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", price: 548.7, qty: 28, basis: 12100, acct: "roth" },
  { id: "demo-qqq", ticker: "QQQ", name: "Invesco QQQ Trust", type: "etf", price: 512.3, qty: 6, basis: 2450, acct: "roth" },
  { id: "demo-btc", ticker: "BTC", name: "Bitcoin", type: "cryptocurrency", price: 64000, qty: 0.035, basis: 1700, acct: "crypto" },
];

async function investments(db: Db, end: string) {
  const inst = await upsertInstitution(db, { source: "csv", externalId: "demo-schwab", name: "Schwab" });
  const ids = {
    brk: await upsertAccount(db, { source: "csv", externalId: "demo-brk", institutionId: inst, name: "Schwab Brokerage", type: "investment", subtype: "brokerage", mask: "2210" }),
    roth: await upsertAccount(db, { source: "csv", externalId: "demo-roth", institutionId: inst, name: "Schwab Roth IRA", type: "investment", subtype: "roth", mask: "8834" }),
    crypto: await upsertAccount(db, { source: "csv", externalId: "demo-crypto", institutionId: inst, name: "Schwab Crypto", type: "investment", subtype: "crypto exchange", mask: "1190" }),
  };
  const now = nowIso();
  for (const s of SECS) {
    await db.run("INSERT INTO securities (id, ticker, name, type, is_cash_equivalent, close_price, close_price_as_of, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
      [s.id, s.ticker, s.name, s.type, s.price, end, now]);
    await db.run("INSERT INTO holdings (account_id, security_id, quantity, price, price_as_of, value, cost_basis, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [ids[s.acct], s.id, s.qty, s.price, end, Math.round(s.qty * s.price * 100), s.basis * 100, now]);
  }
  // Balances: holdings plus a little uninvested cash in the brokerage
  const valueOf = (acct: Sec["acct"]) => SECS.filter((s) => s.acct === acct).reduce((t, s) => t + Math.round(s.qty * s.price * 100), 0);
  for (const acct of ["brk", "roth", "crypto"] as const) {
    await upsertBalance(db, ids[acct], end, valueOf(acct) + (acct === "brk" ? 184000 : 0));
  }
  // Weekly snapshots for ~15 months: growth with a dip, so the weekly line and quarter-end chart have shape.
  // The hand-tracked 401(k) is included as one line, like the real app saves it.
  const k401 = await db.get<{ id: string; balance: number }>(
    `SELECT a.id, b.balance FROM accounts a JOIN balance_snapshots b ON b.account_id = a.id
      WHERE a.name = 'Vanguard 401(k)' ORDER BY b.as_of DESC LIMIT 1`);
  for (let d = DAYS; d > 0; d -= 7) {
    const day = shiftDate(end, -d);
    const f = 0.72 + 0.28 * ((DAYS - d) / DAYS) + 0.035 * Math.sin((DAYS - d) / 23) - (d > 150 && d < 200 ? 0.06 : 0);
    if (k401) {
      await db.run(`INSERT INTO holding_snapshots (as_of, account_id, holding_key, quantity, price, value, cost_basis) VALUES (?, ?, ?, NULL, NULL, ?, NULL)`,
        [day, k401.id, `account:${k401.id}`, Math.round(k401.balance * (0.8 + 0.2 * f))]);
    }
    for (const s of SECS) {
      await db.run(`INSERT INTO holding_snapshots (as_of, account_id, holding_key, quantity, price, value, cost_basis) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [day, ids[s.acct], s.id, s.qty, s.price * f, Math.round(s.qty * s.price * f * 100), s.basis * 100]);
    }
  }
  // Activity: monthly contributions and buys, quarterly dividends
  let n = 0;
  const tx = (acct: Sec["acct"], daysAgo: number, sec: string | null, name: string, type: string, subtype: string, qty: number | null, price: number | null, amount: number) =>
    db.run(`INSERT INTO investment_transactions (id, account_id, security_id, date, name, type, subtype, quantity, price, amount, fees, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '{}')`,
      [`demo-inv-${n++}`, ids[acct], sec, shiftDate(end, -daysAgo), name, type, subtype, qty, price, Math.round(amount * 100)]);
  for (let d = DAYS - 8; d >= 0; d -= 30) {
    const amt = 1200 + (d % 4) * 400;
    await tx("brk", d, null, "Transfer from Everyday Checking", "transfer", "transfer", null, null, amt);
    const s = SECS[(d / 30 | 0) % 6];
    await tx("brk", Math.max(0, d - 1), s.id, `Buy ${s.ticker}`, "buy", "buy", +(amt / s.price).toFixed(3), s.price, -amt);
  }
  for (let d = DAYS - 40; d >= 0; d -= 91) {
    await tx("brk", d, "demo-vti", "VTI dividend", "cash", "dividend", null, null, 48.2);
    await tx("brk", d, "demo-bnd", "BND dividend", "cash", "dividend", null, null, 9.6);
    await tx("roth", d, "demo-voo", "VOO dividend", "cash", "dividend", null, null, 41.5);
  }
}

// ---------- Pay: a year of biweekly paychecks, a bonus, RSU vests, a sale, a W-2 ----------

async function pay(db: Db, end: string) {
  const year = Number(end.slice(0, 4));
  const now = nowIso();
  // Base pay history: hire, merit raise, promotion
  const steps = [
    { date: `${year - 2}-03-04`, reason: "HIR - Hire", annual: 118000 },
    { date: `${year - 1}-04-01`, reason: "MER - Merit", annual: 126000 },
    { date: `${year}-03-16`, reason: "PRO - Promotion", annual: 140000 },
  ];
  for (const s of steps) {
    await db.run(`INSERT INTO comp_base_pay (id, effective_date, reason, period_rate, frequency, annual, source, edited, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Biweekly', ?, 'manual', 0, ?, ?)`, [newId(), s.date, s.reason, Math.round((s.annual / 26) * 100), s.annual * 100, now, now]);
  }
  const salaryOn = (date: string) => [...steps].reverse().find((s) => s.date <= date)!.annual;

  let first = new Date(year, 0, 2);
  while (first.getDay() !== 5) first.setDate(first.getDate() + 1); // first Friday
  let n = 0;
  const statement = async (payDate: string, lines: { section: string; category: string; label: string; current: number; rate?: number; pretax?: boolean }[], gross: number, net: number) => {
    const id = `demo-pay-${n++}`;
    const pretax = lines.filter((l) => l.pretax).reduce((t, l) => t + l.current, 0);
    await db.run(`INSERT INTO comp_statements (id, file, layout, pay_date, period_start, period_end, seq, gross, gross_ytd, net, federal_taxable, pages, imported_at)
      VALUES (?, ?, 'demo', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)`, [id, `Sample ${payDate}.pdf`, payDate, shiftDate(payDate, -19), shiftDate(payDate, -6), n, gross, net, gross - pretax, now]);
    let i = 0;
    for (const l of lines) {
      await db.run(`INSERT INTO comp_lines (statement_id, line_no, section, category, label, classified, rate, hours, current, ytd, pretax) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?)`,
        [id, i++, l.section, l.category, l.label, l.rate ?? null, l.current, l.pretax ? 1 : 0]);
    }
    if (net > 0) await db.run("INSERT INTO comp_deposits (statement_id, line_no, account, amount) VALUES (?, 0, '0042', ?)", [id, net]);
    return id;
  };
  const c = (dollars: number) => Math.round(dollars * 100);

  for (let d = new Date(first); d.toLocaleDateString("en-CA") <= end; d.setDate(d.getDate() + 14)) {
    const date = d.toLocaleDateString("en-CA");
    const base = c(salaryOn(date) / 26);
    const bonus = date.slice(5, 7) === "03" && d.getDate() <= 14 ? c(10000) : 0;
    const gross = base + bonus;
    const k401 = Math.round(base * 0.08), hsa = c(150), dental = c(12.5);
    const pretax = k401 + hsa + dental;
    const fed = Math.round((gross - pretax) * 0.16), ss = Math.round(gross * 0.062), med = Math.round(gross * 0.0145), state = Math.round(gross * 0.004);
    const lines = [
      { section: "earnings", category: "base", label: "Regular", current: base, rate: base / 100 },
      ...(bonus ? [{ section: "earnings", category: "bonus", label: "Bonus", current: bonus }] : []),
      { section: "taxes", category: "federal", label: "Federal Income Tax", current: fed },
      { section: "taxes", category: "social_security", label: "Social Security Tax", current: ss },
      { section: "taxes", category: "medicare", label: "Medicare Tax", current: med },
      { section: "taxes", category: "state_local", label: "State Insurance", current: state },
      { section: "deductions", category: "k401", label: "401K", current: k401, pretax: true },
      { section: "deductions", category: "hsa", label: "Hsa", current: hsa, pretax: true },
      { section: "deductions", category: "dental", label: "Dental", current: dental, pretax: true },
    ];
    await statement(date, lines, gross, gross - fed - ss - med - state - pretax);
  }
  // RSU vests every quarter: taxes withheld in shares, the rest kept
  for (const m of ["02", "05", "08", "11"]) {
    const date = `${year}-${m}-15`;
    if (date > end) continue;
    const value = c(12000), tax = Math.round(value * 0.3);
    const id = await statement(date, [
      { section: "earnings", category: "rsu", label: "Rsu Income", current: value },
      { section: "taxes", category: "federal", label: "Federal Income Tax", current: Math.round(tax * 0.75) },
      { section: "taxes", category: "social_security", label: "Social Security Tax", current: Math.round(tax * 0.2) },
      { section: "taxes", category: "medicare", label: "Medicare Tax", current: tax - Math.round(tax * 0.75) - Math.round(tax * 0.2) },
      { section: "deductions", category: "rsu_offset", label: "Rsu Offset", current: value - tax },
    ], value, 0);
    await db.run("INSERT INTO comp_rsu_vests (statement_id, vest_date, usd_value, taxes_withheld, net_value) VALUES (?, ?, ?, ?, ?)", [id, date, value, tax, value - tax]);
  }
  // A stock sale paid through payroll
  if (`${year}-06-20` <= end) {
    await statement(`${year}-06-20`, [{ section: "deductions", category: "stock_proceeds", label: "Stock Proceeds", current: -c(3000) }], 0, c(3000));
  }
  await resequence(db);

  // Last year's W-2
  const lastGross = 126000 * 100 + 1000000;
  await db.run(`INSERT INTO comp_w2 (year, file, box1, box2, box3, box4, box5, box6, box12, box14, summary, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [year - 1, `Sample ${year - 1} W2.pdf`, lastGross - 1008000 - 390000, Math.round(lastGross * 0.17), lastGross, Math.round(lastGross * 0.062), lastGross, Math.round(lastGross * 0.0145),
      JSON.stringify({ D: 1008000, W: 390000 }), "[]", "Sample W-2", now]);
}
