import "./env";
import { getDb } from "@/lib/db";
import { syncAll } from "@/lib/sync";

const fmt = (n: number) => n.toLocaleString();

async function main() {
  const db = getDb();
  const started = Date.now();
  const { results, refundsMatched } = await syncAll(db);
  if (!results.length) console.log("No connections yet. Run `npm run dev` and connect an account at http://127.0.0.1:3000/connect");
  for (const r of results) {
    if (r.error) console.log(`✗ ${r.institution}: ${r.error}`);
    else console.log(`✓ ${r.institution}: ${r.accounts} accounts · +${fmt(r.added)} new · ${fmt(r.updated)} updated · ${fmt(r.removed)} removed`);
  }
  console.log(`Refunds auto-matched this run: ${refundsMatched}`);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (results.some((r) => r.error)) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
