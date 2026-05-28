import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Middleware already gates this, but guard server-side too.
  if (!user) redirect("/sign-in");

  // A planner with no church yet goes through onboarding first.
  const { data: memberships } = await supabase
    .from("church_member")
    .select("church_id")
    .eq("user_id", user.id);
  if (!memberships || memberships.length === 0) redirect("/onboarding");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-white/[0.06] md:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar userEmail={user.email ?? null} />
        <main className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
