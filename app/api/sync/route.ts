import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { syncAll } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  return handle(() => syncAll(getDb()));
}
