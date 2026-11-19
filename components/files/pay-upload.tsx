"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, FileUp, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Result { file: string; ok: boolean; message: string }

/**
 * Drop pay statements, W-2s or a base pay screenshot. They're read on this Mac, filed into the right folder
 * and imported, so the Compensation tab updates right away. Nothing leaves this computer.
 */
export default function PayUpload({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function send(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(list.length); setErr(null); setResults([]);
    try {
      const body = new FormData();
      for (const f of list) body.append("files", f);
      const res = await fetch("/api/files/upload", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || res.statusText);
      setResults(json.results);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(0); if (input.current) input.current.value = ""; }
  }

  const imported = results.filter((r) => r.ok).length;
  return (
    <div className="flex flex-col gap-3">
      <div role="button" tabIndex={0} aria-label="Add pay documents"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 text-left transition-colors",
          compact ? "py-3" : "py-6 md:justify-center",
          over ? "border-primary bg-accent" : "border-input bg-field hover:border-primary/60 hover:bg-accent/40")}>
        <FileUp className={cn("flex-none text-primary", compact ? "size-5" : "size-6")} aria-hidden="true" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {busy ? `Reading ${busy} file${busy === 1 ? "" : "s"}…` : "Drop pay documents here, or click to choose"}
          </span>
          <span className="text-xs text-muted-foreground">Pay statements and W-2s (PDF), or a base pay history screenshot. Read on this Mac only.</span>
        </span>
      </div>
      <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,application/pdf,image/*" className="hidden"
        onChange={(e) => e.target.files && send(e.target.files)} />
      {err && <p className="text-sm text-destructive">{err}</p>}
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 flex-none text-income-ink" aria-hidden="true" />
                : <XCircle className="mt-0.5 size-4 flex-none text-warn" aria-hidden="true" />}
              <span className="min-w-0"><span className="font-medium">{r.file}</span> <span className="text-muted-foreground">· {r.message}</span></span>
            </div>
          ))}
          {imported > 0 && !compact && (
            <Link href="/compensation" className="mt-1 w-fit text-sm font-semibold">See it in Compensation →</Link>
          )}
        </div>
      )}
    </div>
  );
}
