"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginForm({ next, needCode }: { next: string; needCode: boolean }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Login failed"); setCode(""); return; }
      window.location.assign(next);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary">
          <Lock className="size-5 text-primary-foreground" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">My Money</h1>
          <p className="text-xs text-muted-foreground">Private. Log in to continue.</p>
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <Input type="password" autoComplete="current-password" autoFocus required value={password}
          onChange={(e) => setPassword(e.target.value)} className="h-11 bg-field" />
      </label>
      {needCode && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Code from your authenticator app
          <Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-11 bg-field tracking-[0.3em]" />
        </label>
      )}
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button type="submit" disabled={busy} className="h-11 font-semibold">{busy ? "Checking…" : "Log in"}</Button>
      <p className="text-[11px] text-muted-foreground">Stays signed in on this device for 30 days.</p>
    </form>
  );
}
