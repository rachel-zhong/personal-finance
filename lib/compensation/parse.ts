/**
 * Deterministic parsers for pay documents (CP). Input is positioned text lines from scripts/compensation/extract.swift;
 * output is plain records. No I/O here, so it's fully testable and never touches the network.
 *
 * Supported layouts
 *  - "adp-earnings-statement": ADP "Earnings Statement" (amounts printed as "6 806 44" = $6,806.44).
 *  - "adp-w2": ADP "W-2 and Earnings Summary" employee copy.
 */

export interface PdfLine { page: number; y: number; x0: number; x1: number; text: string }

// ---------- Amounts ----------

export interface Amount { cents: number; value: number; star: boolean; explicitSign: "+" | "-" | null }

const NUMERIC = /^[-+]?\$?\d+\*?$/;

/**
 * ADP prints amounts without separators: "6 806 44" is $6,806.44 and "-987 88 987 88" is two amounts.
 * Read left to right: an integer group, then any 3-digit thousands groups, then a 2-digit cents group ends the amount.
 */
export function parseAmounts(s: string): Amount[] {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  const out: Amount[] = [];
  let i = 0;
  while (i < toks.length) {
    const m = toks[i].match(/^([-+])?\$?(\d+)$/);
    if (!m) throw new Error(`Not a number: "${toks[i]}" in "${s}"`);
    const sign = (m[1] as "+" | "-" | undefined) ?? null;
    let digits = m[2];
    i++;
    // Hourly rates carry 4 decimals: "85 0805" is $85.0805
    const four = toks[i]?.match(/^(\d{4})$/);
    if (four) {
      i++;
      const value = Number(digits) + Number(four[1]) / 10000;
      out.push({ cents: Math.round(value * 100) * (sign === "-" ? -1 : 1), value: sign === "-" ? -value : value, star: false, explicitSign: sign });
      continue;
    }
    while (i < toks.length && /^\d{3}$/.test(toks[i])) { digits += toks[i]; i++; }
    const c = toks[i]?.match(/^(\d{2})(\*?)$/);
    if (!c) throw new Error(`Amount without cents in "${s}"`);
    i++;
    const cents = Number(digits) * 100 + Number(c[1]);
    out.push({ cents: sign === "-" ? -cents : cents, value: (sign === "-" ? -cents : cents) / 100, star: c[2] === "*", explicitSign: sign });
  }
  return out;
}

const splitLabel = (text: string) => {
  const toks = text.trim().split(/\s+/);
  const k = toks.findIndex((t) => NUMERIC.test(t));
  return k < 0 ? { label: text.trim(), nums: "" } : { label: toks.slice(0, k).join(" "), nums: toks.slice(k).join(" ") };
};

// ---------- Earnings statement ----------

export type Section = "earnings" | "taxes" | "deductions" | "employer" | "deposit";
export type Category =
  // earnings
  | "base" | "bonus" | "rsu" | "other_earnings"
  // taxes
  | "federal" | "social_security" | "medicare" | "state_local"
  // pre-tax
  | "k401" | "hsa" | "fsa" | "medical" | "dental" | "vision" | "other_pretax"
  // post-tax
  | "roth_k401" | "aftertax_k401" | "espp" | "rsu_offset" | "stock_proceeds" | "reimbursement" | "other_posttax"
  // employer-paid and deposits
  | "employer_match" | "employer_benefit" | "imputed_income" | "deposit";

export interface PayLine {
  section: Section; category: Category; label: string; classified: boolean;
  rate: number | null; hours: number | null; current: number | null; ytd: number | null; pretax: boolean;
}

export interface PayStatement {
  layout: "adp-earnings-statement";
  adviceNumber: string | null;
  payDate: string; periodStart: string; periodEnd: string;
  gross: { current: number; ytd: number | null };
  net: number;
  federalTaxableCurrent: number | null;
  lines: PayLine[];
  deposits: { account: string | null; cents: number }[];
  pages: number;
}

const iso = (mdY: string) => { const [m, d, y] = mdY.split("/"); return `${y}-${m}-${d}`; };

const TAX = /\b(tax|fica|oasdi|medicare|sdi|sui|fli|pfl|paid family|paid medical|ltcare|long.?term care|workers comp)\b/i;

/** Label → category. `classified` is false when only a catch-all rule matched, so it can be reviewed. */
export function classify(section: Section, label: string, amt: { star: boolean; sign: "+" | "-" | null }): { category: Category; classified: boolean; pretax: boolean } {
  const l = label.toLowerCase();
  if (section === "earnings") {
    if (/\b(rsu|restricted stock|stock award|stock income)\b/.test(l)) return { category: "rsu", classified: true, pretax: false };
    if (/\b(bonus|award|incentive|commission|spot)\b/.test(l)) return { category: "bonus", classified: true, pretax: false };
    if (/\b(regular|salary|pto|holiday|sick|vacation|bereavement|jury|retro)\b/.test(l)) return { category: "base", classified: true, pretax: false };
    if (/\b(allo|allowance|stipend)\b/.test(l)) return { category: "other_earnings", classified: true, pretax: false };
    return { category: "other_earnings", classified: false, pretax: false };
  }
  if (section === "taxes") {
    if (/federal income/.test(l)) return { category: "federal", classified: true, pretax: false };
    if (/social security|oasdi/.test(l)) return { category: "social_security", classified: true, pretax: false };
    if (/medicare/.test(l)) return { category: "medicare", classified: true, pretax: false };
    return { category: "state_local", classified: true, pretax: false };
  }
  if (section === "employer") {
    if (/match/.test(l)) return { category: "employer_match", classified: true, pretax: false };
    if (/group term life|gtl/.test(l)) return { category: "imputed_income", classified: true, pretax: false };
    if (/^er\b|employer/.test(l)) return { category: "employer_benefit", classified: true, pretax: false };
    return { category: "employer_benefit", classified: false, pretax: false };
  }
  // deductions
  if (/\b(rsu|restricted stock)\b/.test(l)) return { category: "rsu_offset", classified: true, pretax: false };
  if (/stock proceeds/.test(l)) return { category: "stock_proceeds", classified: true, pretax: false };
  if (/roth/.test(l)) return { category: "roth_k401", classified: true, pretax: false };
  if (/after.?tax/.test(l) && /401/.test(l)) return { category: "aftertax_k401", classified: true, pretax: false };
  if (/401\s*\(?k/.test(l)) return { category: "k401", classified: true, pretax: true };
  if (/\bhsa\b/.test(l)) return { category: "hsa", classified: true, pretax: true };
  if (/\bfsa\b|flex spend/.test(l)) return { category: "fsa", classified: true, pretax: true };
  if (/\bespp\b|stock purchase/.test(l)) return { category: "espp", classified: true, pretax: false };
  if (/\bmed\b|medical/.test(l)) return { category: "medical", classified: true, pretax: true };
  if (/\bden\b|dental/.test(l)) return { category: "dental", classified: true, pretax: true };
  if (/\bvis\b|vision/.test(l)) return { category: "vision", classified: true, pretax: true };
  if (amt.sign === "+") return { category: "reimbursement", classified: /reimb/.test(l), pretax: false };
  if (amt.star) return { category: "other_pretax", classified: false, pretax: true };
  // State workers' comp (an "L&I" line) is a post-tax deduction in the payroll provider's own totals, not a tax.
  return { category: "other_posttax", classified: /life|disab|ltd|std|legal|union|charit|\bl&i\b|labor (and|&) industr/.test(l), pretax: false };
}

/** Columns of the ADP statement in PDF points: left block ends ~336 (YTD) / ~256 (this period); right block ~586 / ~510. */
const LEFT_MAX_X = 345;
const LEFT_YTD_EDGE = 290;
const RIGHT_YTD_EDGE = 540;

interface Row { page: number; y: number; col: "L" | "R"; parts: PdfLine[] }

function rows(lines: PdfLine[]): Row[] {
  const out: Row[] = [];
  for (const l of lines) {
    const col = l.x0 < LEFT_MAX_X ? "L" : "R";
    const r = out.find((o) => o.page === l.page && o.col === col && Math.abs(o.y - l.y) < 1.5);
    if (r) r.parts.push(l); else out.push({ page: l.page, y: l.y, col, parts: [l] });
  }
  for (const r of out) r.parts.sort((a, b) => a.x0 - b.x0);
  return out.sort((a, b) => a.page - b.page || b.y - a.y);
}

export function isEarningsStatement(lines: PdfLine[]) {
  return lines.some((l) => /^Earnings Statement$/.test(l.text)) && lines.some((l) => /^Pay Date: \d\d\/\d\d\/\d{4}$/.test(l.text));
}

export function parseEarningsStatement(lines: PdfLine[]): PayStatement {
  const find = (re: RegExp) => { for (const l of lines) { const m = l.text.match(re); if (m) return m; } return null; };
  const payDate = find(/^Pay Date: (\d\d\/\d\d\/\d{4})$/);
  const start = find(/^Period Beginning: (\d\d\/\d\d\/\d{4})$/);
  const end = find(/^Period Ending: (\d\d\/\d\d\/\d{4})$/);
  if (!payDate || !start || !end) throw new Error("Missing pay date or period");
  const advice = lines.find((l, i) => /^\d{8,}$/.test(l.text) && lines.slice(0, i).some((p) => p.text === "Advice number:"));

  const st: PayStatement = {
    layout: "adp-earnings-statement", adviceNumber: advice?.text ?? null,
    payDate: iso(payDate[1]), periodStart: iso(start[1]), periodEnd: iso(end[1]),
    gross: { current: 0, ytd: null }, net: 0, federalTaxableCurrent: null, lines: [], deposits: [],
    pages: Math.max(...lines.map((l) => l.page)),
  };

  let state: "header" | "earnings" | "afterGross" | "taxes" | "deductions" | "afterNet" = "header";
  let rightState: "none" | "benefits" = "none";
  let expectTaxable = false;

  for (const r of rows(lines)) {
    const text = r.parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
    const x1 = Math.max(...r.parts.map((p) => p.x1));

    // "Your federal taxable wages this period are" + amount: left block on 1-page stubs, right block on longer ones
    if (expectTaxable && /^\$[\d ]+$/.test(text)) { st.federalTaxableCurrent = parseAmounts(text)[0].cents; expectTaxable = false; continue; }
    if (/^Your federal taxable wages this period are/.test(text)) { expectTaxable = true; continue; }

    if (r.col === "R") {
      if (/^this period total to date$/.test(text) || /^Other Benefits and/.test(text)) { rightState = "benefits"; continue; }
      if (/^(Totl Hrs Worked|YOUR COMPANY|BASIS OF PAY|UNLIMITED|Exemptions|[A-Z]{2}:|Deposited|Advice number|Pay date|account number|NON-NEGOTIABLE|\d{4} ADP)/i.test(text)) { rightState = "none"; }
      if (rightState !== "benefits") continue;
      const { label, nums } = splitLabel(text);
      if (!label || !nums) continue;
      const a = parseAmounts(nums);
      const [current, ytd] = a.length >= 2 ? [a[0].cents, a[1].cents] : x1 > RIGHT_YTD_EDGE ? [null, a[0].cents] : [a[0].cents, null];
      const c = classify("employer", label, { star: false, sign: null });
      st.lines.push({ section: "employer", label, rate: null, hours: null, current, ytd, ...c });
      continue;
    }

    if (/^rate salary\/hours this period year to date$/.test(text)) { state = "earnings"; continue; }
    const gross = text.match(/^Gross Pay (.+)$/);
    if (gross) {
      const g = parseAmounts(gross[1]);
      st.gross.current = g[0].cents;
      if (g[1]) st.gross.ytd = g[1].cents;
      state = "afterGross";
      continue;
    }
    if (state === "afterGross" && /^[\d ]+$/.test(text)) { st.gross.ytd = parseAmounts(text)[0].cents; continue; }
    if (/^Statutory$/.test(text)) { state = "taxes"; continue; }
    const net = text.match(/^Net Pay (\$[\d ]+)$/);
    if (net) { st.net = parseAmounts(net[1])[0].cents; state = "afterNet"; continue; }

    if (state === "afterNet") {
      const dep = text.match(/^(Checking|Savings|Net Check)(?: \d+)? (-?\$?[\d ]+)$/);
      if (dep && dep[1] !== "Net Check") st.deposits.push({ account: dep[1].toLowerCase(), cents: Math.abs(parseAmounts(dep[2])[0].cents) });
      continue;
    }
    if (state !== "earnings" && state !== "taxes" && state !== "deductions") continue;

    const { label, nums } = splitLabel(text);
    if (!label) continue;
    if (!nums) continue; // label whose amounts sit on the next row is merged by rows(); a bare heading otherwise

    if (state === "taxes" && (!TAX.test(label) || /pre.?tax|post.?tax|after.?tax/i.test(label))) state = "deductions";
    const a = parseAmounts(nums);
    const section: Section = state === "earnings" ? "earnings" : state === "taxes" ? "taxes" : "deductions";
    let rate: number | null = null, hours: number | null = null, current: number | null = null, ytd: number | null = null;
    if (section === "earnings" && a.length >= 3) {
      // rate, hours, this period, YTD — or hours, this period, YTD
      if (a.length >= 4) { rate = a[0].value; hours = a[1].value; current = a[2].cents; ytd = a[3].cents; }
      else { hours = a[0].value; current = a[1].cents; ytd = a[2].cents; }
    } else if (a.length >= 2) { current = a[0].cents; ytd = a[1].cents; }
    else if (x1 > LEFT_YTD_EDGE) ytd = a[0].cents;
    else current = a[0].cents;
    const first = a[section === "earnings" && a.length >= 3 ? a.length - 2 : 0];
    const c = classify(section, label, { star: a.some((x) => x.star), sign: current != null ? first.explicitSign : null });
    // Deductions and taxes print the current amount negative; store amounts as positive "money taken".
    // A "+" deduction (e.g. a reimbursement) adds to net pay and is stored negative.
    if (section !== "earnings" && current != null) current = -current;
    st.lines.push({ section, label, rate, hours, current, ytd, ...c, pretax: c.pretax || a.some((x) => x.star) });
  }
  // Voucher: masked account numbers in the same order as Checking / Savings
  const masks = lines.filter((l) => /^x{4,}\d{4}$/.test(l.text)).map((l) => l.text.slice(-4));
  st.deposits = st.deposits.map((d, i) => ({ ...d, account: masks[i] ?? d.account }));
  return st;
}

// ---------- W-2 ----------

export interface W2 {
  layout: "adp-w2"; year: number;
  box1: number; box2: number; box3: number; box4: number; box5: number; box6: number;
  box12: Record<string, number>; box14: { label: string; cents: number }[];
  summary: { gross: number | null; fsa: number | null };
}

const dollarsToCents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

export function isW2(lines: PdfLine[]) { return lines.some((l) => /W-2 Wage and Tax \d{4}/.test(l.text)); }

export function parseW2(lines: PdfLine[]): W2 {
  const txt = lines.filter((l) => l.page === 1).map((l) => l.text);
  const all = txt.join("\n");
  const year = Number(all.match(/W-2 Wage and Tax (\d{4})/)![1]);
  const after = (re: RegExp, n = 1) => {
    const i = txt.findIndex((t) => re.test(t));
    if (i < 0) throw new Error(`W-2 field not found: ${re}`);
    const vals: number[] = [];
    for (let j = i + 1; j < txt.length && vals.length < n; j++) if (/^\d+\.\d{2}$/.test(txt[j])) vals.push(dollarsToCents(txt[j]));
    return vals;
  };
  const [box1, box2] = after(/^Wages, tips, other comp\. 2$/, 2);
  const [box3, box4] = after(/^Social security wages$/, 2);
  const box5Inline = all.match(/5 Medicare wages and tips ([\d.]+)/);
  const box5 = box5Inline ? dollarsToCents(box5Inline[1]) : after(/^5 Medicare wages and tips$/, 1)[0];
  const [box6] = after(/^Medicare tax withheld$/, 1);
  const box12: Record<string, number> = {};
  for (const t of txt) { const m = t.match(/^([A-Z]{1,2}) (\d+\.\d{2})$/); if (m) box12[m[1]] = dollarsToCents(m[2]); }
  const box14 = [...all.matchAll(/14 Other\n?([\d.]+) (\w+)/g)].map((m) => ({ label: m[2], cents: dollarsToCents(m[1]) }));
  const gross = all.match(/Gross Pay ([\d ]+ \d{2})\n/);
  const fsa = all.match(/LessMedical FSA ([\d ]+ \d{2})\n/);
  return {
    layout: "adp-w2", year, box1, box2, box3, box4, box5, box6, box12, box14,
    summary: { gross: gross ? parseAmounts(gross[1])[0].cents : null, fsa: fsa ? parseAmounts(fsa[1])[0].cents : null },
  };
}

// ---------- Base pay history (OCR of the HR "Pay Info" screen) ----------

export interface BasePayRow { effectiveDate: string; reason: string | null; periodRate: number; frequency: string | null; annual: number | null }

/** OCR blocks (y/x as 0–1 fractions) → rows. Rows group by y; columns by x order: date, reason, rate, frequency, hours, change, annual. */
export function parseBasePayOcr(blocks: PdfLine[]): BasePayRow[] {
  const dates = blocks.filter((b) => /^\d\d\/\d\d\/\d{4}$/.test(b.text.trim()));
  const out: BasePayRow[] = [];
  for (const d of dates) {
    const same = blocks.filter((b) => Math.abs(b.y - d.y) < 0.012).sort((a, b) => a.x0 - b.x0);
    const rate = same.find((b) => /\/Salary$|\/Hourly$/i.test(b.text));
    if (!rate) continue;
    const reason = same.find((b) => /^[A-Z0-9]{2,5} - /.test(b.text));
    const freq = same.find((b) => /^(Biweekly|Weekly|Semimonthly|Monthly)$/i.test(b.text));
    const annual = same.filter((b) => /^\d+(\.\d+)?$/.test(b.text) && b.x0 > 0.8).pop();
    out.push({
      effectiveDate: iso(d.text.trim()), reason: reason?.text ?? null,
      periodRate: Math.round(Number(rate.text.split("/")[0]) * 100),
      frequency: freq?.text ?? null, annual: annual ? Math.round(Number(annual.text) * 100) : null,
    });
  }
  return out;
}
