"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateChurchState = { error: string | null };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function createChurch(
  _prev: CreateChurchState,
  formData: FormData,
): Promise<CreateChurchState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Church name is too short." };
  const slug = slugify(name);
  if (slug.length < 2) return { error: "Couldn't derive a URL slug from that name." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // church has no INSERT RLS policy by design — first-church creation is a
  // server-side, service-role operation gated by the authenticated user above.
  const admin = createAdminClient();
  const { data: church, error: churchError } = await admin
    .from("church")
    .insert({ name, slug })
    .select("id")
    .single();
  if (churchError) {
    return { error: churchError.code === "23505" ? "That church name is already taken." : churchError.message };
  }

  await admin.from("church_settings").insert({ church_id: church.id });
  const { error: memberError } = await admin
    .from("church_member")
    .insert({ church_id: church.id, user_id: user.id, role: "admin" });
  if (memberError) return { error: memberError.message };

  redirect("/");
}
