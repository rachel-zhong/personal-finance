/** Runs once when the server starts. On a server (Railway), turns on the daily sync (see instrumentation-node.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
