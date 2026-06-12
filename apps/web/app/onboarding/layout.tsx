import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { I18nProvider } from "@/lib/i18n/client";
import { getRequestLocale } from "@/lib/i18n/request-locale";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: memberships } = await supabase
    .from("church_member")
    .select("church_id")
    .eq("user_id", user.id);
  if (memberships && memberships.length > 0) redirect("/");

  // Signed in but no church yet — still pre-church, so Accept-Language decides.
  const locale = await getRequestLocale();
  return (
    <I18nProvider locale={locale}>
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </I18nProvider>
  );
}
