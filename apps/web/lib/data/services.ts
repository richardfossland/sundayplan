/**
 * Services data layer — real Supabase queries behind the cookie-bound server
 * client (reads run under the signed-in planner's RLS, scoped to their church).
 *
 * A service is the order-of-service (a list of service_items) plus the people
 * filling its roles (assignments). The schedule grid owns assignment *editing*;
 * this layer reads them so the service page can show who's filling what and
 * how many roles are still open.
 *
 * Required-role counts come from the service's template (service_team_requirement)
 * when it has one — services aren't required to be templated, so fill status is
 * "N assigned" until a template gives us a target to measure against.
 */
import type { ServiceItemKind, ServiceState, TemplateItemKind } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export interface ServiceSummary {
  id: string;
  name: string;
  starts_at_utc: string;
  state: ServiceState;
  template_id: string | null;
  item_count: number;
  total_duration_min: number;
  /** Distinct roles with at least one active (not declined/removed) assignment. */
  filled_roles: number;
  /** Sum of required quantities from the template, or null when untemplated. */
  required_roles: number | null;
}

export interface ServiceItemRow {
  id: string;
  position: number;
  label: string;
  kind: ServiceItemKind;
  duration_min: number;
  notes: string | null;
  song_id: string | null;
  scripture_ref: string | null;
}

export interface ServiceAssignmentRow {
  id: string;
  role_id: string;
  role_name: string;
  member_id: string;
  member_name: string;
  status: string;
}

export interface ServiceDetail {
  id: string;
  name: string;
  starts_at_utc: string;
  notes: string | null;
  state: ServiceState;
  template_id: string | null;
  template_name: string | null;
  items: ServiceItemRow[];
  assignments: ServiceAssignmentRow[];
}

export interface ServiceEditable {
  id: string;
  name: string;
  starts_at_utc: string;
  notes: string | null;
  template_id: string | null;
}

export interface TemplateOption {
  id: string;
  name: string;
  default_duration_min: number;
}

export interface TemplateDetail extends TemplateOption {
  items: Array<{ position: number; label: string; kind: TemplateItemKind; duration_min: number }>;
  required_roles: number;
}

const ACTIVE_STATUSES = new Set(["pending", "invited", "accepted", "no_response"]);

interface ServiceListEmbed {
  id: string;
  name: string;
  starts_at_utc: string;
  state: ServiceState;
  template_id: string | null;
  service_item: { duration_min: number }[] | null;
  assignment: { role_id: string; status: string }[] | null;
}

interface RequirementEmbed {
  id: string;
  service_team_requirement: { quantity: number }[] | null;
}

/** All services in the planner's church, newest first, with fill status. */
export async function getServices(): Promise<ServiceSummary[]> {
  const supabase = await createClient();

  const [servicesRes, templatesRes] = await Promise.all([
    supabase
      .from("service")
      .select(
        "id, name, starts_at_utc, state, template_id, service_item(duration_min), assignment(role_id, status)",
      )
      .order("starts_at_utc", { ascending: true }),
    supabase.from("service_template").select("id, service_team_requirement(quantity)"),
  ]);
  if (servicesRes.error) throw servicesRes.error;
  if (templatesRes.error) throw templatesRes.error;

  const requiredByTemplate = new Map<string, number>(
    ((templatesRes.data ?? []) as unknown as RequirementEmbed[]).map((t) => [
      t.id,
      (t.service_team_requirement ?? []).reduce((sum, r) => sum + r.quantity, 0),
    ]),
  );

  return ((servicesRes.data ?? []) as unknown as ServiceListEmbed[]).map((s) => {
    const items = s.service_item ?? [];
    const activeRoles = new Set(
      (s.assignment ?? [])
        .filter((a) => ACTIVE_STATUSES.has(a.status))
        .map((a) => a.role_id),
    );
    const required = s.template_id ? requiredByTemplate.get(s.template_id) ?? null : null;
    return {
      id: s.id,
      name: s.name,
      starts_at_utc: s.starts_at_utc,
      state: s.state,
      template_id: s.template_id,
      item_count: items.length,
      total_duration_min: items.reduce((sum, i) => sum + i.duration_min, 0),
      filled_roles: activeRoles.size,
      required_roles: required && required > 0 ? required : null,
    };
  });
}

interface ServiceDetailEmbed {
  id: string;
  name: string;
  starts_at_utc: string;
  notes: string | null;
  state: ServiceState;
  template_id: string | null;
  service_template: { name: string } | null;
}

/** One service header (with template name), or null if not visible under RLS. */
export async function getService(id: string): Promise<ServiceDetail | null> {
  const supabase = await createClient();

  const [headerRes, itemsRes, assignmentsRes] = await Promise.all([
    supabase
      .from("service")
      .select("id, name, starts_at_utc, notes, state, template_id, service_template(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("service_item")
      .select("id, position, label, kind, duration_min, notes, song_id, scripture_ref")
      .eq("service_id", id)
      .order("position"),
    supabase
      .from("assignment")
      .select("id, role_id, member_id, status, role(name), member(display_name)")
      .eq("service_id", id),
  ]);
  if (headerRes.error) throw headerRes.error;
  if (!headerRes.data) return null;
  if (itemsRes.error) throw itemsRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;

  const header = headerRes.data as unknown as ServiceDetailEmbed;
  const items = (itemsRes.data ?? []) as unknown as ServiceItemRow[];

  interface AssignmentEmbed {
    id: string;
    role_id: string;
    member_id: string;
    status: string;
    role: { name: string } | null;
    member: { display_name: string } | null;
  }
  const assignments: ServiceAssignmentRow[] = (
    (assignmentsRes.data ?? []) as unknown as AssignmentEmbed[]
  )
    .filter((a) => a.status !== "removed")
    .map((a) => ({
      id: a.id,
      role_id: a.role_id,
      role_name: a.role?.name ?? "—",
      member_id: a.member_id,
      member_name: a.member?.display_name ?? "—",
      status: a.status,
    }))
    .sort((a, b) => a.role_name.localeCompare(b.role_name));

  return {
    id: header.id,
    name: header.name,
    starts_at_utc: header.starts_at_utc,
    notes: header.notes,
    state: header.state,
    template_id: header.template_id,
    template_name: header.service_template?.name ?? null,
    items,
    assignments,
  };
}

/** Editable header fields for the edit form. */
export async function getServiceEditable(id: string): Promise<ServiceEditable | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .select("id, name, starts_at_utc, notes, template_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ServiceEditable | null) ?? null;
}

/** Templates in the church — for the "create from template" picker. */
export async function getServiceTemplates(): Promise<TemplateOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .select("id, name, default_duration_min")
    .order("name");
  if (error) throw error;
  return (data ?? []) as TemplateOption[];
}

interface TemplateDetailEmbed {
  id: string;
  name: string;
  default_duration_min: number;
  template_item: { position: number; label: string; kind: TemplateItemKind; duration_min: number }[] | null;
  service_team_requirement: { quantity: number }[] | null;
}

/** A template's items + required-role count — used to seed a new service. */
export async function getTemplateDetail(id: string): Promise<TemplateDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .select(
      "id, name, default_duration_min, template_item(position, label, kind, duration_min), service_team_requirement(quantity)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const t = data as unknown as TemplateDetailEmbed;
  return {
    id: t.id,
    name: t.name,
    default_duration_min: t.default_duration_min,
    items: (t.template_item ?? []).slice().sort((a, b) => a.position - b.position),
    required_roles: (t.service_team_requirement ?? []).reduce((sum, r) => sum + r.quantity, 0),
  };
}
