"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { post } from "./api";

interface Result {
  results: { institution: string; added: number; error?: string }[];
}

export default function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<Result>("/api/sync", {});
      const added = r.results.reduce((s, x) => s + x.added, 0);
      const errors = r.results.filter((x) => x.error);
      setMsg(errors.length ? `⚠️ ${errors.map((e) => e.institution).join(", ")} failed — see Connections` : `✓ ${added} new`);
      router.refresh();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2 text-xs text-muted-foreground" : "flex flex-col gap-1.5"}>
      {compact && msg && <span className="max-w-[45vw] truncate">{msg}</span>}
      <Button variant="outline" size="sm" onClick={run} disabled={busy} className="w-fit">
        {busy ? "Syncing…" : "↻ Sync now"}
      </Button>
      {!compact && msg && <span>{msg}</span>}
    </div>
  );
}
