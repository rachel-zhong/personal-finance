import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resequence } from "@/lib/compensation/store";
import { payUploadsEnabled } from "@/lib/hosted";
import { COMP_ROOT, PAYSTUB_DIR, importBasePayImage, importPdf, type ImportResult } from "@/lib/compensation/importer";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;

export interface UploadResult { file: string; ok: boolean; message: string }

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const safeName = (n: string) => path.basename(n).replace(/[^\w .()&,-]/g, "_").slice(0, 120) || "document";

/** A free name in `dir`, or the existing file if it's the same document (so re-uploading doesn't make copies). */
function placeFor(dir: string, name: string, bytes: Buffer): { full: string; existing: boolean } {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  const hash = sha(bytes);
  for (let i = 0; ; i++) {
    const full = path.join(dir, i ? `${base} (${i + 1})${ext}` : name);
    if (!fs.existsSync(full)) return { full, existing: false };
    if (sha(fs.readFileSync(full)) === hash) return { full, existing: true };
  }
}

function describe(r: ImportResult): string {
  if (r.kind === "w2") return `W-2 for ${r.year}`;
  if (r.kind === "statement") return `Pay statement, paid ${r.payDate}`;
  return r.added ? `Base pay history, ${r.added} new change${r.added === 1 ? "" : "s"}` : "Base pay history, nothing new";
}

/**
 * Upload pay documents. Each file is read on this Mac, filed into data/compensation/ (gitignored, never sent anywhere),
 * and imported so the Compensation tab updates right away. Files that aren't a pay document are not kept.
 */
export async function POST(req: Request) {
  // Pay documents are read with Apple's PDFKit and Vision: only on your Mac, never on a server.
  if (!payUploadsEnabled()) return NextResponse.json({ error: "Pay documents can only be added in the app on your Mac" }, { status: 403 });
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });
  const db = getDb();
  fs.mkdirSync(PAYSTUB_DIR, { recursive: true });
  const results: UploadResult[] = [];

  for (const f of files) {
    const name = safeName(f.name);
    if (f.size > MAX_BYTES) { results.push({ file: name, ok: false, message: "Over 20 MB" }); continue; }
    const bytes = Buffer.from(await f.arrayBuffer());
    const ext = path.extname(name).toLowerCase();
    const isPdf = ext === ".pdf" || bytes.subarray(0, 5).toString() === "%PDF-";
    const isImage = [".png", ".jpg", ".jpeg", ".heic"].includes(ext);
    if (!isPdf && !isImage) { results.push({ file: name, ok: false, message: "Only PDFs and screenshots can be read" }); continue; }

    // Pay statements and W-2s go in paystubs/; a base pay screenshot goes next to the existing one.
    const dir = isPdf ? PAYSTUB_DIR : COMP_ROOT;
    const { full, existing } = placeFor(dir, isPdf && ext !== ".pdf" ? `${name}.pdf` : name, bytes);
    if (!existing) fs.writeFileSync(full, bytes);
    try {
      const r = isPdf ? await importPdf(db, full) : await importBasePayImage(db, full);
      results.push({ file: name, ok: true, message: describe(r) + (existing ? " (already had it, refreshed)" : "") });
    } catch (e) {
      if (!existing) fs.rmSync(full, { force: true }); // not a pay document: don't keep it
      results.push({ file: name, ok: false, message: `${(e as Error).message}. Not saved.` });
    }
  }
  if (results.some((r) => r.ok)) await resequence(db);
  return NextResponse.json({ results });
}
