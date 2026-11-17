/**
 * CSV connector: import a bank/card export for an account Plaid can't connect.
 * Re-importing the same (or an overlapping) file adds no duplicates: each row's
 * external_id is a hash of account + date + amount + description + its occurrence
 * number among identical rows in the file.
 */
import Papa from "papaparse";
import { createHash } from "node:crypto";
import { Db } from "../../db";
import { upsertAccount, upsertBalance, upsertInstitution, upsertTransaction } from "../../store";
import { slug } from "../manual";

export interface CsvImportOptions {
  accountName: string;
  accountType: string; // depository | credit | ...
  csvText: string;
  /** true if the file shows purchases as POSITIVE numbers (common for credit cards) */
  positiveIsSpending?: boolean;
  /** Optional current balance to record with the import (dollars). */
  currentBalance?: number | null;
}

const pick = (headers: string[], patterns: RegExp[]) =>
  headers.find((h) => patterns.some((p) => p.test(h.trim().toLowerCase())));

export function parseDate(s: string): string | null {
  const v = s.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

export function parseMoney(s: string | undefined): number | null {
  if (s == null) return null;
  const v = s.trim();
  if (!v) return null;
  const neg = /^\(.*\)$/.test(v) || v.startsWith("-");
  const n = Number(v.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

export async function importCsv(db: Db, o: CsvImportOptions) {
  const parsed = Papa.parse<Record<string, string>>(o.csvText.trim(), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const dateCol = pick(headers, [/^date$/, /transaction date/, /posted/, /post date/, /^date/]);
  const descCol = pick(headers, [/description/, /^name$/, /payee/, /merchant/, /memo/, /details/]);
  const amountCol = pick(headers, [/^amount/]);
  const debitCol = pick(headers, [/debit/, /withdrawal/, /money out/]);
  const creditCol = pick(headers, [/credit/, /deposit/, /money in/]);
  const catCol = pick(headers, [/category/]);
  if (!dateCol || !descCol || (!amountCol && !debitCol && !creditCol)) {
    throw new Error(
      `Couldn't find date / description / amount columns. Headers found: ${headers.join(", ")}`,
    );
  }

  const name = o.accountName.trim();
  const accountExt = slug(name);
  const seen = new Map<string, number>();
  let added = 0, skipped = 0, bad = 0;

  await db.tx(async (tx) => {
    const institutionId = await upsertInstitution(tx, { source: "csv", externalId: "csv", name: "CSV import" });
    const accountId = await upsertAccount(tx, {
      source: "csv", externalId: accountExt, institutionId, name, type: o.accountType,
    });
    let latest = "";
    for (const row of parsed.data) {
      const date = parseDate(row[dateCol] ?? "");
      let amount: number | null = null;
      if (amountCol) {
        amount = parseMoney(row[amountCol]);
        if (amount != null && o.positiveIsSpending) amount = -amount;
      } else {
        const d = parseMoney(row[debitCol!]) ?? 0;
        const c = parseMoney(row[creditCol!]) ?? 0;
        amount = Math.abs(c) - Math.abs(d);
      }
      const desc = (row[descCol] ?? "").trim();
      if (!date || amount == null || !desc) { bad++; continue; }
      if (date > latest) latest = date;
      const key = `${accountExt}|${date}|${amount}|${desc.toLowerCase()}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const externalId = createHash("sha256").update(`${key}|${n}`).digest("hex").slice(0, 32);
      const isNew = await upsertTransaction(tx, {
        accountId, accountType: o.accountType, source: "csv", externalId, date, amount,
        merchant: null, description: desc, category: catCol ? (row[catCol] || null) : null,
        pending: false, raw: row,
      });
      if (isNew) added++; else skipped++;
    }
    if (o.currentBalance != null && !Number.isNaN(o.currentBalance)) {
      await upsertBalance(tx, accountId, latest || new Date().toISOString().slice(0, 10), Math.round(o.currentBalance * 100));
    }
  });
  return { added, skipped, bad, columns: { dateCol, descCol, amountCol, debitCol, creditCol, catCol } };
}
