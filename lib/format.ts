export function money(cents: number | null | undefined, opts: { sign?: boolean; noCents?: boolean } = {}) {
  if (cents == null) return "—";
  const v = cents / 100;
  const s = Math.abs(v).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: opts.noCents ? 0 : 2, maximumFractionDigits: opts.noCents ? 0 : 2,
  });
  if (v < 0) return `−${s}`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

export const prettyCategory = (c: string | null) =>
  c ? c.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).replace(/ And /g, " and ") : "Uncategorized";

export const monthLabel = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });

export const shortDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Whole dollars, e.g. "$8,420" / "−$1,240". */
export const dollars = (cents: number | null | undefined) => money(cents, { noCents: true });

export const monthShort = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });
export const monthLong = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long" });
export const dayShort = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function syncedLabel(iso: string | null) {
  if (!iso) return "never synced";
  const d = new Date(iso);
  const todayStr = new Date().toDateString();
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === todayStr) return `today, ${t}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${t}`;
}

/**
 * How a transaction amount reads in lists (matches the design):
 * money out plain "$86.40"; money in, refunds included, "+$45.00".
 */
export function displayAmount(amountCents: number, flow: string) {
  if (amountCents > 0 || (flow === "refund" && amountCents === 0)) return { text: "+" + money(amountCents), tone: "in" as const };
  return { text: money(-amountCents), tone: "out" as const };
}
