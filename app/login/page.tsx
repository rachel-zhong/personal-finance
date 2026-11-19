import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/hosted";
import { totpEnabled } from "@/lib/auth";
import LoginForm from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!authEnabled()) redirect("/");
  const { next } = await searchParams;
  // Only same-app paths, never another site
  const to = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <LoginForm next={to} needCode={totpEnabled()} />
    </div>
  );
}
