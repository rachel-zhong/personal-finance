/**
 * Login for the hosted app: one password (APP_PASSWORD), an optional authenticator-app code (TOTP_SECRET),
 * a signed 30-day session cookie, and a lock after 5 wrong tries in a row.
 *
 * Runs in Node (route handlers and the Node.js middleware). No outside service is involved.
 */
import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

export const SESSION_COOKIE = "mm_session";
export const SESSION_DAYS = 30;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

// ---------- Password (hashed comparison) ----------

const SALT = "my-money-login-v1";
let expectedHash: Buffer | null = null;

/** Compares scrypt hashes in constant time, so neither the password nor its length leaks through timing. */
export function passwordMatches(input: string): boolean {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  expectedHash ??= scryptSync(pw, SALT, 32);
  return timingSafeEqual(scryptSync(input, SALT, 32), expectedHash);
}

// ---------- Session cookie ----------

/** Signing key: changes whenever APP_PASSWORD or SESSION_SECRET changes, which signs every device out. */
function key() {
  return createHash("sha256").update(`session:${process.env.SESSION_SECRET ?? ""}:${process.env.APP_PASSWORD ?? ""}`).digest();
}
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) => b64(createHmac("sha256", key()).update(payload).digest());

/** "<expiry ms>.<signature>" */
export function newSessionValue(now = Date.now()) {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

export function sessionValid(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: SESSION_DAYS * 86_400 };
}

// ---------- Authenticator code (TOTP, RFC 6238) ----------

export function totpEnabled() {
  return !!process.env.TOTP_SECRET;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function base32Encode(b: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of b) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function totpAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** The 30-second step the code belongs to (allowing one step of clock drift either way), or null. */
export function totpStep(code: string, now = Date.now()): number | null {
  const secret = process.env.TOTP_SECRET;
  if (!secret || !/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const step = Math.floor(now / 30_000);
  for (const s of [step, step - 1, step + 1]) {
    const want = Buffer.from(totpAt(key, s));
    if (timingSafeEqual(want, Buffer.from(code))) return s;
  }
  return null;
}

// ---------- Lockout ----------

interface Throttle { failures: number; locked_until: string | null; last_totp_step: number | null }

export async function lockState(db: Db, now = Date.now()) {
  const t = (await db.get<Throttle>("SELECT failures, locked_until, last_totp_step FROM auth_throttle WHERE id = 1"))
    ?? { failures: 0, locked_until: null, last_totp_step: null };
  const until = t.locked_until ? Date.parse(t.locked_until) : 0;
  return { ...t, locked: until > now, minutesLeft: Math.max(0, Math.ceil((until - now) / 60_000)) };
}

/**
 * Check a login attempt. Five wrong tries in a row lock login for 15 minutes; the count resets on success.
 * The lock is for the whole app (not per device), so guessing from many places doesn't help.
 */
export async function attemptLogin(db: Db, password: string, code: string, now = Date.now()):
  Promise<{ ok: true } | { ok: false; error: string; needCode?: boolean }> {
  const st = await lockState(db, now);
  if (st.locked) return { ok: false, error: `Too many wrong tries. Try again in ${st.minutesLeft} min.` };

  const pwOk = passwordMatches(password);
  let codeOk = true;
  if (pwOk && totpEnabled()) {
    const step = totpStep(code.trim(), now);
    codeOk = step != null && (st.last_totp_step == null || step > st.last_totp_step); // each code works once
    if (codeOk) await db.run("UPDATE auth_throttle SET last_totp_step = ? WHERE id = 1", [step]);
  }
  if (pwOk && codeOk) {
    await db.run("UPDATE auth_throttle SET failures = 0, locked_until = NULL WHERE id = 1");
    return { ok: true };
  }
  const failures = st.failures + 1;
  const lock = failures >= MAX_FAILURES ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null;
  await db.run("UPDATE auth_throttle SET failures = ?, locked_until = ? WHERE id = 1", [lock ? 0 : failures, lock]);
  if (lock) return { ok: false, error: `Too many wrong tries. Login is locked for ${LOCK_MINUTES} minutes.` };
  const left = MAX_FAILURES - failures;
  // Same message for a wrong password or a wrong code, so a guesser can't tell which part was right.
  return { ok: false, error: `That didn't work. ${left} ${left === 1 ? "try" : "tries"} left before a ${LOCK_MINUTES}-minute lock.` };
}
