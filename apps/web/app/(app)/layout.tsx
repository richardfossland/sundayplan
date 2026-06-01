import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { createClient } from "@/lib/supabase/server";
import { I18nProvider } from "@/lib/i18n/client";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/messages";

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

  const { data: church } = await supabase
    .from("church")
    .select("name, locale")
    .eq("id", memberships[0].church_id)
    .maybeSingle();

  const locale = isLocale(church?.locale as string | undefined)
    ? (church!.locale as "no" | "en")
    : DEFAULT_LOCALE;

  return (
    <I18nProvider locale={locale}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-white/[0.06] md:block">
          <Sidebar />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar userEmail={user.email ?? null} churchName={(church?.name as string) ?? "Your church"} />
          <main className="flex-1 px-6 py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <CommandPalette />
      </div>
    </I18nProvider>
  );
}
