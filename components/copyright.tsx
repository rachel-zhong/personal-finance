/** Ownership line shown in the app (sidebar, login, Connections & files). Matches LICENSE. */
export const COPYRIGHT = "© 2026 rachel-zhong. All rights reserved.";

export default function Copyright({ className = "" }: { className?: string }) {
  return <p className={`text-[11px] leading-normal text-muted-foreground ${className}`}>{COPYRIGHT}</p>;
}
