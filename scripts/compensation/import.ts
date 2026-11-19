/**
 * Import pay documents from data/compensation/ into the local database (CP).
 *
 *   npm run comp:import
 *
 * - PDFs in data/compensation/paystubs/: earnings statements and W-2s (text layer; on-device OCR if a page has none).
 * - data/compensation/base-pay-history.png: base pay history (on-device OCR).
 * Everything runs on this Mac (Apple PDFKit + Vision through extract.swift). Nothing is uploaded, and no files are written
 * except the compiled extractor in data/compensation/.bin/.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { resequence } from "@/lib/compensation/store";
import { COMP_ROOT as ROOT, PAYSTUB_DIR, importBasePayImage, importPdf } from "@/lib/compensation/importer";

async function main() {
  const db = getDb();
  const dir = PAYSTUB_DIR;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  const layouts = new Map<string, string[]>();
  const failed: { file: string; error: string }[] = [];
  let statements = 0, w2s = 0;

  for (const f of files) {
    try {
      const r = await importPdf(db, path.join(dir, f));
      if (r.kind === "w2") { w2s++; layouts.set("adp-w2", [...(layouts.get("adp-w2") ?? []), f]); }
      if (r.kind === "statement") { statements++; layouts.set(r.layout, [...(layouts.get(r.layout) ?? []), r.payDate]); }
    } catch (e) {
      failed.push({ file: f, error: (e as Error).message });
    }
  }
  await resequence(db);

  let basePay = 0;
  const png = path.join(ROOT, "base-pay-history.png");
  if (fs.existsSync(png)) {
    try { const r = await importBasePayImage(db, png); basePay = r.kind === "base_pay" ? r.added : 0; }
    catch (e) { failed.push({ file: "base-pay-history.png", error: (e as Error).message }); }
  }

  console.log(`Statements: ${statements} · W-2s: ${w2s} · new base pay rows: ${basePay}`);
  for (const [layout, items] of layouts) {
    const sorted = [...items].sort();
    console.log(`Layout ${layout}: ${items.length} files, ${sorted[0]} → ${sorted[sorted.length - 1]}`);
  }
  for (const f of failed) console.log(`FAILED ${f.file}: ${f.error}`);
}

main();
