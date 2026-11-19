"use client";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Signs this device out (the 30-day session ends here only). */
export default function LogoutButton() {
  async function run() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }
  return (
    <Button variant="outline" onClick={run} className="h-10 w-fit gap-2 px-4 font-semibold">
      <LogOut className="size-4" aria-hidden="true" /> Log out on this device
    </Button>
  );
}
