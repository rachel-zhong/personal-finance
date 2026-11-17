// Load .env.local for CLI scripts (Next.js loads it automatically for the web app).
for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(f); } catch { /* file not present */ }
}
