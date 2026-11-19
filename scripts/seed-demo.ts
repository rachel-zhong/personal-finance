/**
 * Fills a SEPARATE demo database (data/demo.db) with made-up data so you can explore or show the app.
 * Never touches your real database. Run: npm run demo
 */
import path from "node:path";
import { seedDemo } from "@/lib/demo/seed";

const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "demo.db");
seedDemo(file)
  .then((r) => console.log(`Demo data written to ${file} (${r.refundsMatched} refunds auto-matched).`))
  .catch((e) => { console.error(e); process.exit(1); });
