/**
 * SDK API surface — placeholder. Will wrap the Supabase client (in web)
 * and a thin REST client (in Edge Functions) under one ergonomic API.
 *
 * Phase 1.3 fills this in. For now we export the type contract so the
 * web + mobile apps can compile against it.
 */

import type {
  Church,
  Member,
  Service,
  Assignment,
  Song,
  Team,
  Role,
} from "@sundayplan/shared";

export interface SundayPlanClient {
  /** ── churches ── */
  churches: {
    list:   () => Promise<Church[]>;
    get:    (id: string) => Promise<Church>;
  };
  /** ── members ── */
  members: {
    list:   (churchId: string) => Promise<Member[]>;
    create: (input: Omit<Member, "id" | "created_at" | "updated_at" | "archived_at">) => Promise<Member>;
  };
  /** ── services ── */
  services: {
    list:     (churchId: string) => Promise<Service[]>;
    upcoming: (churchId: string, fromIso: string, limit?: number) => Promise<Service[]>;
  };
  /** ── songs ── */
  songs: {
    list: (churchId: string) => Promise<Song[]>;
  };
  /** ── teams + roles ── */
  teams: {
    list: (churchId: string) => Promise<Team[]>;
    roles: (teamId: string) => Promise<Role[]>;
  };
  /** ── assignments ── */
  assignments: {
    forService: (serviceId: string) => Promise<Assignment[]>;
  };
}

/** Configuration accepted by `createClient` (Phase 1.3 implementation). */
export interface ClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Optional: bearer token for Edge Function / volunteer magic-link calls. */
  bearer?: string;
}

/** Placeholder factory — throws until wired in Phase 1.3. */
export function createClient(_config: ClientConfig): SundayPlanClient {
  throw new Error(
    "SundayPlanClient not yet implemented — wiring lands in Phase 1.3 once Supabase auth is in place.",
  );
}
