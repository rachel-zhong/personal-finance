"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const KEY = "hideAmounts";

/** Runs before the page paints (see app/layout.tsx), so hidden numbers never flash on load. */
export const HIDE_AMOUNTS_SCRIPT =
  `try{if(localStorage.getItem("${KEY}")==="1")document.documentElement.setAttribute("data-hide-amounts","")}catch(e){}`;

/**
 * Eye button at the top right of a page: hides the headline numbers on every tab (marked with the "sensitive" class)
 * as dots. Remembered on this device only. Tables and transactions further down stay visible.
 */
export default function PrivacyToggle() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(document.documentElement.hasAttribute("data-hide-amounts")); }, []);
  function toggle() {
    const next = !hidden;
    setHidden(next);
    document.documentElement.toggleAttribute("data-hide-amounts", next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* private mode: still works for this visit */ }
  }
  const Icon = hidden ? EyeOff : Eye;
  return (
    <button type="button" onClick={toggle} aria-pressed={hidden} aria-label={hidden ? "Show amounts" : "Hide amounts"}
      title={hidden ? "Show amounts" : "Hide amounts"}
      className="flex size-11 flex-none items-center justify-center rounded-md border border-input bg-card text-ink-2 hover:bg-hairline md:size-[34px]">
      <Icon className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
