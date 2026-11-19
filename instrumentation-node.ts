import path from "node:path";
import { isDemo, isHosted } from "./lib/hosted";
import { startDailySync } from "./lib/scheduler";

/** Node.js only (called from instrumentation.ts before the first request is served). */
export async function start() {
  if (isDemo()) {
    // Demo website: fresh sample data now, and again every night at 3:00, so visitors' changes don't pile up.
    process.env.DATABASE_PATH ||= path.join(process.cwd(), "data", "demo.db");
    const { seedDemo } = await import("./lib/demo/seed");
    await seedDemo(process.env.DATABASE_PATH);
    console.log("[demo] sample data ready");
    let lastReset = new Date().toDateString();
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 3 && now.toDateString() !== lastReset) {
        lastReset = now.toDateString();
        seedDemo(process.env.DATABASE_PATH!).then(() => console.log("[demo] sample data reset")).catch((e) => console.error("[demo] reset failed", e));
      }
    }, 10 * 60_000).unref();
    return;
  }
  if (isHosted() && process.env.DAILY_SYNC !== "off") startDailySync();
}
