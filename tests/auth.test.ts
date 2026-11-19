import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqlite } from "@/lib/db";
import { attemptLogin, base32Encode, newSessionValue, sessionValid, totpAt, totpStep } from "@/lib/auth";
import { lastDue } from "@/lib/scheduler";

// Test-only values; never a real password or secret.
const PW = "test-password-123";
const env = { ...process.env };
beforeEach(() => { process.env.APP_PASSWORD = PW; delete process.env.TOTP_SECRET; delete process.env.SESSION_SECRET; });
afterEach(() => { process.env = { ...env }; });

describe("authenticator codes (RFC 6238)", () => {
  it("matches the published SHA-1 test vector", () => {
    // RFC 6238 appendix B: secret "12345678901234567890", T = 59s → 94287082 (last 6 digits)
    expect(totpAt(Buffer.from("12345678901234567890"), Math.floor(59 / 30))).toBe("287082");
  });
  it("accepts the current code and one step of drift, nothing else", () => {
    process.env.TOTP_SECRET = base32Encode(Buffer.from("12345678901234567890"));
    const now = 59_000;
    expect(totpStep("287082", now)).toBe(1);
    expect(totpStep("287082", now + 30_000)).toBe(1); // one step late still ok
    expect(totpStep("287082", now + 90_000)).toBeNull();
    expect(totpStep("12345", now)).toBeNull();
  });
});

describe("session cookie", () => {
  it("is valid until it expires and can't be forged", () => {
    const v = newSessionValue(1_000);
    expect(sessionValid(v, 2_000)).toBe(true);
    expect(sessionValid(v, 1_000 + 31 * 86_400_000)).toBe(false);
    const [exp] = v.split(".");
    expect(sessionValid(`${Number(exp) + 1}.${v.split(".")[1]}`, 2_000)).toBe(false);
    expect(sessionValid(undefined)).toBe(false);
  });
  it("is signed out when the password changes", () => {
    const v = newSessionValue(1_000);
    process.env.APP_PASSWORD = "another-test-password";
    expect(sessionValid(v, 2_000)).toBe(false);
  });
});

describe("login lockout", () => {
  it("locks after 5 wrong tries and resets on success", async () => {
    const db = openSqlite(":memory:");
    for (let i = 1; i <= 4; i++) {
      const r = await attemptLogin(db, "wrong", "", 0);
      expect(r.ok).toBe(false);
    }
    const fifth = await attemptLogin(db, "wrong", "", 0);
    expect(fifth.ok === false && fifth.error).toMatch(/locked/);
    // Even the right password is refused while locked
    expect((await attemptLogin(db, PW, "", 60_000)).ok).toBe(false);
    // After 15 minutes it works, and the count starts over
    expect((await attemptLogin(db, PW, "", 16 * 60_000)).ok).toBe(true);
    const again = await attemptLogin(db, "wrong", "", 16 * 60_000);
    expect(again.ok === false && again.error).toMatch(/4 tries left/);
  });
  it("needs the authenticator code when one is set up, and each code works once", async () => {
    const db = openSqlite(":memory:");
    process.env.TOTP_SECRET = base32Encode(Buffer.from("12345678901234567890"));
    expect((await attemptLogin(db, PW, "", 59_000)).ok).toBe(false);
    expect((await attemptLogin(db, PW, "287082", 59_000)).ok).toBe(true);
    expect((await attemptLogin(db, PW, "287082", 60_000)).ok).toBe(false); // replay
  });
});

describe("daily sync timing", () => {
  it("is due once a day after the sync hour", () => {
    const at = (h: number) => { const d = new Date(2026, 10, 18, h, 30); return d; };
    expect(lastDue(at(7), 6).getDate()).toBe(18);
    expect(lastDue(at(5), 6).getDate()).toBe(17); // before 6am: yesterday's slot
  });
});
