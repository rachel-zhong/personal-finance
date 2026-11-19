import { NextResponse } from "next/server";
import { getDb, type Param } from "@/lib/db";
import { authEnabled, compensationEnabled } from "@/lib/hosted";

export const runtime = "nodejs";

/** Parents first when adding, children first when removing (lines, deposits and vests belong to a statement). */
import { PAY_TABLES, type PayTable } from "@/lib/compensation/pay-tables";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Pay numbers from your Mac (run `npm run hosted:pay`). Your Mac reads the PDFs; only the resulting rows come here.
 * Replaces all pay rows on the server in one step, and touches nothing else (banks, transactions, settings).
 * Only with login on, and only when HOSTED_INCLUDE_COMPENSATION=true.
 */
export async function POST(req: Request) {
  if (!authEnabled()) return fail("Set APP_PASSWORD first.", 403);
  if (!compensationEnabled()) return fail("Compensation is off here. Set HOSTED_INCLUDE_COMPENSATION=true in Railway first.", 403);
  const body = (await req.json().catch(() => null)) as { tables?: Record<string, Record<string, unknown>[]> } | null;
  const tables = body?.tables;
  if (!tables || typeof tables !== "object") return fail("Nothing to save.");
  const unknown = Object.keys(tables).filter((t) => !(PAY_TABLES as readonly string[]).includes(t));
  if (unknown.length) return fail(`Not pay tables: ${unknown.join(", ")}`);

  const db = getDb();
  // Only columns the server's own tables have; anything else is ignored.
  const cols: Record<string, Set<string>> = {};
  for (const t of PAY_TABLES) {
    cols[t] = new Set((await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
  }
  const counts: Partial<Record<PayTable, number>> = {};
  try {
    await db.tx(async (tx) => {
      for (const t of [...PAY_TABLES].reverse()) await tx.run(`DELETE FROM ${t}`);
      for (const t of PAY_TABLES) {
        const rows = tables[t] ?? [];
        if (!Array.isArray(rows)) throw new Error(`${t} must be a list`);
        for (const r of rows) {
          const keys = Object.keys(r).filter((k) => cols[t].has(k));
          if (!keys.length) continue;
          const vals = keys.map((k) => {
            const v = r[k];
            if (v === null || typeof v === "string" || typeof v === "number") return v as Param;
            if (typeof v === "boolean") return v ? 1 : 0;
            return JSON.stringify(v);
          });
          await tx.run(`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, vals);
        }
        counts[t] = rows.length;
      }
    });
  } catch (e) {
    return fail(`${(e as Error).message}. Nothing was changed.`);
  }
  return NextResponse.json({ ok: true, counts });
}
