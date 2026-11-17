import "./env";
import { getDb } from "@/lib/db";
import { refreshDerived } from "@/lib/store";
import { runAutoMatch } from "@/lib/refunds/matcher";

async function main() {
  const db = getDb();
  await refreshDerived(db);
  const { created } = await runAutoMatch(db);
  console.log(`Auto-matched ${created} refund(s).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
