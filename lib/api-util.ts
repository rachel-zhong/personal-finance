import { NextResponse } from "next/server";

export function handle(fn: () => Promise<unknown>) {
  return fn()
    .then((data) => NextResponse.json(data ?? { ok: true }))
    .catch((e: unknown) => {
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    });
}
