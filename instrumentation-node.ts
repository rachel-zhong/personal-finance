import { isHosted } from "./lib/hosted";
import { startDailySync } from "./lib/scheduler";

// Node.js only (imported from instrumentation.ts). Daily sync on the server unless DAILY_SYNC=off.
if (isHosted() && process.env.DAILY_SYNC !== "off") startDailySync();
