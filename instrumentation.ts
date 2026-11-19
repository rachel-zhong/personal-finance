/** Runs once when the server starts. Server only: the daily sync, or the demo's sample data (see instrumentation-node.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./instrumentation-node");
    await start();
  }
}
