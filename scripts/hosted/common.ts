/** Shared by the hosted:upload and hosted:pay commands: questions in Terminal, the app address, and logging in. */
import readline from "node:readline";

// One reader for every question. Lines are queued, so answers typed (or pasted) quickly all arrive in order.
let rl: readline.Interface | null = null;
let muted = false;
const lines: string[] = [];
const waiting: ((s: string) => void)[] = [];
export function ask(question: string, hidden = false): Promise<string> {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const r = rl as unknown as { _writeToOutput: (s: string) => void };
    const write = r._writeToOutput.bind(rl);
    r._writeToOutput = (s: string) => { if (!muted) write(s); }; // hides the password as you type
    rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  }
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (a: string) => { if (muted) process.stdout.write("\n"); muted = false; resolve(a.trim()); };
    const queued = lines.shift();
    if (queued !== undefined) done(queued); else waiting.push(done);
  });
}

export function closeQuestions() { rl?.close(); }

/** The app's address from the command line. Must be https (encrypted), except for a local test. */
export function appOrigin(arg: string | undefined, usage: string) {
  if (!arg) { console.log(`Usage: ${usage}`); process.exit(1); }
  const base = new URL(arg);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    console.log("Use the https:// address, so your data is encrypted on the way."); process.exit(1);
  }
  return base.origin;
}

/** Asks for the app password (and code), logs in, and returns the session cookie. */
export async function login(origin: string) {
  const password = await ask("App password: ", true);
  const code = await ask("Authenticator code (press Enter if you didn't set one up): ");
  closeQuestions();
  const r = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password, code }),
  });
  if (!r.ok) {
    const why = (await r.json().catch(() => ({}))).error;
    console.log(r.status === 404 ? `Login failed: ${origin} isn't your app's address (404). Copy it from your browser's address bar.` : `Login failed: ${why ?? r.status}`);
    process.exit(1);
  }
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}

/** Turns a network failure into a plain message. */
export function reportFailure(e: Error & { cause?: { code?: string } }) {
  console.log(e.message === "fetch failed"
    ? `Couldn't reach the app (${e.cause?.code ?? "network error"}). Check the address and that the Railway deploy is running.`
    : `Stopped: ${e.message}`);
  process.exit(1);
}
