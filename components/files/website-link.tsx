"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Globe, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { post } from "@/components/api";

export interface LinkState { url: string; token: string; lastSent?: string; lastResult?: string; lastOk?: boolean }

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/**
 * Mac app only. Links this Mac to the website so the Compensation tab works on your phone.
 * Sends pay numbers (never PDFs): automatically after you add pay documents, or with "Send now".
 */
export default function WebsiteLink({ link, compact = false }: { link: LinkState | null; compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(link?.url ?? "");
  const [code, setCode] = useState<string | null>(null); // shown right after linking, or on "Show setup"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function linkUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ token: string }>("/api/website/link", { url });
      setCode(r.token);
      router.refresh();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/website/send", { method: "POST" });
    const j = await r.json().catch(() => ({ ok: false, message: "Something went wrong" }));
    setMsg({ ok: !!j.ok, text: j.message ?? j.error });
    setBusy(false);
    router.refresh();
  }
  async function unlink() {
    if (!confirm("Unlink this Mac from the website? Pay numbers already on the website stay there.")) return;
    await fetch("/api/website/link", { method: "DELETE" });
    setCode(null);
    router.refresh();
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMsg({ ok: true, text: "Copied" }); } catch { /* select manually */ }
  }

  const status = msg ?? (link?.lastSent ? { ok: !!link.lastOk, text: `${link.lastResult} · ${when(link.lastSent)}` } : null);
  const statusLine = status && (
    <p className={`flex items-start gap-1.5 text-[13px] ${status.ok ? "text-income-ink" : "text-warn"}`}>
      {status.ok ? <CheckCircle2 className="mt-0.5 size-4 flex-none" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />}
      <span>{status.text}</span>
    </p>
  );

  // Compact (bottom of Compensation): status and a send button, or a pointer to the setup
  if (compact) {
    if (!link) return <p className="text-[13px] text-muted-foreground">To see this tab on your phone, link the website in <a href="/connect#website">Connections &amp; files</a>.</p>;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={send} disabled={busy} className="h-10 gap-2 px-4 font-semibold">
            <Send className="size-4" aria-hidden="true" /> {busy ? "Sending…" : "Send to website now"}
          </Button>
          <span className="text-xs text-muted-foreground">Sent automatically when you add pay documents.</span>
        </div>
        {statusLine}
      </div>
    );
  }

  const setup = code && (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-field p-4 text-[13px]">
      <p className="font-semibold">Finish in Railway (one time)</p>
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        <li>Railway → <b>personal-finance</b> → <b>Variables</b> → <b>+ New Variable</b></li>
        <li>
          Name: <code className="rounded bg-card px-1">PAY_SYNC_TOKEN</code> · Value: this link code
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-input bg-card px-2 py-1.5">{code}</code>
            <Button type="button" variant="outline" onClick={() => copy(code)} className="h-8 gap-1.5 px-2.5"><Copy className="size-3.5" />Copy</Button>
          </div>
        </li>
        <li>Also set <code className="rounded bg-card px-1">HOSTED_INCLUDE_COMPENSATION</code> to <code className="rounded bg-card px-1">true</code></li>
        <li>Click <b>Deploy</b> and wait until it&apos;s green</li>
        <li>Come back here and click <b>Send pay numbers now</b></li>
      </ol>
      <p className="text-xs text-muted-foreground">The link code works like a password between this Mac and your website. Don&apos;t share it.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {!link ? (
        <form onSubmit={linkUp} className="flex flex-wrap items-center gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.up.railway.app" required
            aria-label="Website address" className="h-10 w-full max-w-sm bg-card" />
          <Button type="submit" disabled={busy} className="h-10 gap-2 px-4 font-semibold"><Globe className="size-4" aria-hidden="true" />Link</Button>
        </form>
      ) : (
        <>
          <p className="text-[13px]">Linked to <b>{link.url.replace(/^https?:\/\//, "")}</b></p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={send} disabled={busy} className="h-10 gap-2 px-4 font-semibold">
              <Send className="size-4" aria-hidden="true" /> {busy ? "Sending…" : "Send pay numbers now"}
            </Button>
            <Button variant="outline" onClick={() => setCode(code ? null : link.token)} className="h-10 px-4">{code ? "Hide setup" : "Show setup"}</Button>
            <Button variant="outline" onClick={unlink} className="h-10 px-4">Unlink</Button>
          </div>
        </>
      )}
      {setup}
      {statusLine}
    </div>
  );
}
