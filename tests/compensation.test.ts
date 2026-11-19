import { describe, expect, it } from "vitest";
import { classify, parseAmounts, parseBasePayOcr, parseEarningsStatement, type PdfLine } from "@/lib/compensation/parse";

// Synthetic statement in the ADP layout. All names and numbers are made up.
const L = (y: number, x0: number, x1: number, text: string, page = 1): PdfLine => ({ page, y, x0, x1, text });
const stub: PdfLine[] = [
  L(755, 350, 498, "Earnings Statement"),
  L(733, 353, 499, "Period Beginning: 03/01/2026"),
  L(721, 353, 499, "Period Ending: 03/14/2026"),
  L(709, 353, 499, "Pay Date: 03/20/2026"),
  L(598, 131, 330, "rate salary/hours this period year to date"),
  L(585, 20, 336, "Regular 4000 00 80 00 4 000 00 20 000 00"),
  L(573, 20, 87, "Home Office"),
  L(573, 306, 336, "50 00"),
  L(561, 20, 336, "Rsu Income 12 345 67"),
  L(549, 94, 255, "Gross Pay $4 000 00"),
  L(549, 291, 336, "32 395 67"),
  L(519, 94, 134, "Statutory"),
  L(507, 94, 179, "Federal Income Tax"),
  L(507, 220, 336, "-600 00 6 000 00"),
  L(495, 94, 177, "Social Security Tax"),
  L(495, 220, 336, "-248 00 2 008 53"),
  L(483, 94, 336, "Med Pre Tax -50 00* 250 00"),
  L(471, 94, 336, "401K -400 00* 2 000 00"),
  L(459, 94, 336, "Rsu Income 9 000 00"),
  L(447, 94, 256, "Phone Reimb +25 00"),
  L(423, 94, 255, "Net Pay $2 727 00"),
  L(411, 94, 255, "Checking -2 727 00"),
  L(327, 104, 289, "Your federal taxable wages this period are"),
  L(315, 104, 149, "$3 550 00"),
  L(596, 354, 441, "Other Benefits and"),
  L(586, 463, 582, "this period total to date"),
  L(573, 354, 585, "401K Match 200 00 1 000 00"),
  L(199, 353, 424, "Advice number:"),
  L(199, 464, 519, "00000099999"),
  L(127, 350, 406, "xxxxxxxx1234"),
];

describe("pay statement parser (CP)", () => {
  it("reads ADP amounts without separators", () => {
    expect(parseAmounts("-987 88 987 88").map((a) => a.cents)).toEqual([-98788, 98788]);
    expect(parseAmounts("6 806 44 101 415 96").map((a) => a.cents)).toEqual([680644, 10141596]);
    expect(parseAmounts("85 0805 8 00").map((a) => a.value)).toEqual([85.0805, 8]);
    expect(parseAmounts("-884 84*")[0]).toMatchObject({ cents: -88484, star: true });
  });

  it("parses lines, columns and sections; the statement balances", () => {
    const st = parseEarningsStatement(stub);
    expect(st).toMatchObject({ payDate: "2026-03-20", periodStart: "2026-03-01", periodEnd: "2026-03-14", adviceNumber: "00000099999",
      gross: { current: 400000, ytd: 3239567 }, net: 272700, federalTaxableCurrent: 355000 });
    const by = (label: string) => st.lines.find((l) => l.label === label)!;
    expect(by("Regular")).toMatchObject({ category: "base", rate: 4000, hours: 80, current: 400000, ytd: 2000000 });
    expect(by("Home Office")).toMatchObject({ current: null, ytd: 5000, classified: false }); // lone amount in the YTD column
    expect(by("Med Pre Tax")).toMatchObject({ section: "deductions", category: "medical", pretax: true, current: 5000 });
    expect(by("Phone Reimb")).toMatchObject({ category: "reimbursement", current: -2500, ytd: null }); // lone amount in this-period column
    expect(by("401K Match")).toMatchObject({ section: "employer", category: "employer_match", current: 20000 });
    expect(st.lines.filter((l) => l.label === "Rsu Income").map((l) => [l.section, l.category])).toEqual([["earnings", "rsu"], ["deductions", "rsu_offset"]]);
    expect(st.deposits).toEqual([{ account: "1234", cents: 272700 }]);
    const taken = st.lines.filter((l) => l.section === "taxes" || l.section === "deductions").reduce((s, l) => s + (l.current ?? 0), 0);
    expect(st.gross.current - taken).toBe(st.net);
  });

  it("classifies common payroll labels", () => {
    const c = (section: Parameters<typeof classify>[0], label: string, star = false, sign: "+" | "-" | null = "-") => classify(section, label, { star, sign }).category;
    expect([c("earnings", "Cash Award"), c("earnings", "Pto"), c("taxes", "CA SDI"), c("deductions", "Roth 401K"), c("deductions", "Hsa", true),
      c("deductions", "Stock Proceeds"), c("deductions", "Dep Care FSA", true)])
      .toEqual(["bonus", "base", "state_local", "roth_k401", "hsa", "stock_proceeds", "fsa"]);
  });

  it("reads base pay rows from OCR blocks", () => {
    const rows = parseBasePayOcr([
      L(0.53, 0.05, 0.1, "01/05/2025"), L(0.53, 0.18, 0.25, "MER - Merit"), L(0.53, 0.32, 0.4, "4000/Salary"),
      L(0.53, 0.45, 0.5, "Biweekly"), L(0.53, 0.86, 0.93, "104000"),
    ]);
    expect(rows).toEqual([{ effectiveDate: "2025-01-05", reason: "MER - Merit", periodRate: 400000, frequency: "Biweekly", annual: 10400000 }]);
  });
});
