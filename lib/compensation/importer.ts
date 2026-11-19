/**
 * Reads one pay document on this Mac and saves it to the local database (CP).
 * Used by `npm run comp:import` and by the upload on the Connections & files page.
 * Everything runs locally (Apple PDFKit + Vision through extract.swift). Nothing is sent anywhere.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db";
import { isEarningsStatement, isW2, parseBasePayOcr, parseEarningsStatement, parseW2, type PdfLine } from "./parse";
import { saveBasePay, saveStatement, saveW2 } from "./store";

export const COMP_ROOT = path.join(process.cwd(), "data", "compensation");
export const PAYSTUB_DIR = path.join(COMP_ROOT, "paystubs");
const SRC = path.join(process.cwd(), "scripts", "compensation", "extract.swift");
const BIN = path.join(COMP_ROOT, ".bin", "extract");

function extractor() {
  const stale = !fs.existsSync(BIN) || fs.statSync(BIN).mtimeMs < fs.statSync(SRC).mtimeMs;
  if (stale) {
    fs.mkdirSync(path.dirname(BIN), { recursive: true });
    const cache = path.join(COMP_ROOT, ".bin", "module-cache");
    execFileSync("swiftc", ["-O", "-module-cache-path", cache, SRC, "-o", BIN], { stdio: ["ignore", "ignore", "inherit"] });
  }
  return BIN;
}

export function extract(mode: "pdf" | "ocr", file: string): PdfLine[] {
  let out: string;
  try {
    out = execFileSync(extractor(), [mode, file], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr ?? "").trim().split("\n").pop();
    throw new Error(mode === "pdf" ? "Couldn't open this PDF" : `Couldn't read this image${why ? ` (${why})` : ""}`);
  }
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as PdfLine);
}

export type ImportResult =
  | { kind: "statement"; payDate: string; layout: string }
  | { kind: "w2"; year: number }
  | { kind: "base_pay"; added: number };

/** Recognize and save one PDF (earnings statement or W-2). Throws if it's neither. */
export async function importPdf(db: Db, full: string): Promise<ImportResult> {
  const f = path.basename(full);
  const lines = extract("pdf", full);
  if (!lines.length) throw new Error("No text found, even with OCR");
  if (isW2(lines)) {
    const w = parseW2(lines);
    await saveW2(db, w, f);
    return { kind: "w2", year: w.year };
  }
  if (isEarningsStatement(lines)) {
    const st = parseEarningsStatement(lines);
    await saveStatement(db, st, f, fs.readFileSync(full));
    return { kind: "statement", payDate: st.payDate, layout: st.layout };
  }
  throw new Error("Not a pay statement or W-2");
}

/** Read a base pay history screenshot. Throws if no pay rows are found. */
export async function importBasePayImage(db: Db, full: string): Promise<ImportResult> {
  const rows = parseBasePayOcr(extract("ocr", full));
  if (!rows.length) throw new Error("No base pay rows found");
  return { kind: "base_pay", added: await saveBasePay(db, rows) };
}
