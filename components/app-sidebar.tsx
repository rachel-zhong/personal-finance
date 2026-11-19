import { getDb } from "@/lib/db";
import { syncedLabel } from "@/lib/format";
import NavLinks from "./nav-links";
import SyncButton from "./SyncButton";
import Copyright from "./copyright";

export default async function AppSidebar({ showPay = true }: { showPay?: boolean }) {
  const db = getDb();
  const s = await db.get<{ last: string | null; n: number }>(
    "SELECT MAX(last_synced_at) AS last, COUNT(*) AS n FROM connections",
  );
  return (
    <nav aria-label="Main"
      className="box-border hidden w-[240px] flex-none flex-col gap-7 border-r border-border bg-sidebar px-5 py-7 md:sticky md:top-0 md:flex md:h-screen">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
        </div>
        <span className="font-heading text-lg font-bold">My Money</span>
      </div>
      <NavLinks showPay={showPay} />
      <div className="mt-auto flex flex-col gap-3 text-xs leading-normal text-muted-foreground">
        <div>
          {s?.last ? `Last synced ${syncedLabel(s.last)}` : "Not synced yet"}
          <br />
          {s?.n ?? 0} connection{s?.n === 1 ? "" : "s"}
        </div>
        <SyncButton />
        <Copyright className="border-t border-border pt-3" />
      </div>
    </nav>
  );
}
