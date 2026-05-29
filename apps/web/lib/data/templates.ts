/**
 * Service-template data layer — templates are the reusable shape of a service:
 * a default order (template_item) plus the roles a service needs
 * (service_team_requirement). A service created from a template inherits both:
 * its items seed the order of service, and its requirements drive the
 * unfilled-slot detection on the schedule.
 *
 * NB: template_item has a composite primary key (template_id, position) and no
 * id column, so items are identified by their position — mutations key on it.
 */
import type { SkillLevel, TemplateItemKind } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export interface TemplateSummary {
  id: string;
  name: string;
  default_duration_min: number;
  item_count: number;
  required_roles: number; // sum of quantities
}

export interface TemplateItemRow {
  position: number;
  label: string;
  kind: TemplateItemKind;
  duration_min: number;
}

export interface RequirementRow {
  role_id: string;
  role_name: string;
  quantity: number;
}

export interface TemplateDetailFull {
  id: string;
  name: string;
  default_duration_min: number;
  items: TemplateItemRow[];
  requirements: RequirementRow[];
}

export interface TemplateEditable {
  id: string;
  name: string;
  default_duration_min: number;
}

export interface RoleOption {
  id: string;
  name: string;
  team_name: string;
  skill_required: SkillLevel;
}

interface TemplateListEmbed {
  id: string;
  name: string;
  default_duration_min: number;
  template_item: { position: number }[] | null;
  service_team_requirement: { quantity: number }[] | null;
}

/** All templates in the church, with item + required-role counts. */
export async function getTemplates(): Promise<TemplateSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .select("id, name, default_duration_min, template_item(position), service_team_requirement(quantity)")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as TemplateListEmbed[]).map((t) => ({
    id: t.id,
    name: t.name,
    default_duration_min: t.default_duration_min,
    item_count: (t.template_item ?? []).length,
    required_roles: (t.service_team_requirement ?? []).reduce((sum, r) => sum + r.quantity, 0),
  }));
}

interface TemplateFullEmbed {
  id: string;
  name: string;
  default_duration_min: number;
  template_item: TemplateItemRow[] | null;
  service_team_requirement: { role_id: string; quantity: number; role: { name: string } | null }[] | null;
}

/** One template with its ordered items + role requirements. */
export async function getTemplate(id: string): Promise<TemplateDetailFull | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .select(
      "id, name, default_duration_min, template_item(position, label, kind, duration_min), service_team_requirement(role_id, quantity, role(name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const t = data as unknown as TemplateFullEmbed;
  return {
    id: t.id,
    name: t.name,
    default_duration_min: t.default_duration_min,
    items: (t.template_item ?? []).slice().sort((a, b) => a.position - b.position),
    requirements: (t.service_team_requirement ?? [])
      .map((r) => ({ role_id: r.role_id, role_name: r.role?.name ?? "—", quantity: r.quantity }))
      .sort((a, b) => a.role_name.localeCompare(b.role_name)),
  };
}

export async function getTemplateEditable(id: string): Promise<TemplateEditable | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .select("id, name, default_duration_min")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as TemplateEditable | null) ?? null;
}

interface RoleOptionEmbed {
  id: string;
  name: string;
  skill_required: SkillLevel;
  team: { name: string } | null;
}

/** Every role in the church (across teams) — for the requirement picker. */
export async function getChurchRoleOptions(): Promise<RoleOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role")
    .select("id, name, skill_required, team(name)")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as RoleOptionEmbed[]).map((r) => ({
    id: r.id,
    name: r.name,
    team_name: r.team?.name ?? "—",
    skill_required: r.skill_required,
  }));
}
