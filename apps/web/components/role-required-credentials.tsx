"use client";

import { useTransition } from "react";
import { updateRoleRequiredCredentials } from "@/app/(app)/teams/actions";
import { CREDENTIAL_KINDS } from "@sundayplan/sdk";
import type { TeamRoleGroup } from "@/lib/data/teams";
import { useT } from "@/lib/i18n/client";

/**
 * Per-role multi-select for required credentials. Each checkbox submits the form
 * via the action on toggle, so there's no explicit save — flipping a box
 * immediately gates (or un-gates) auto-fill for that role. The set is normalised
 * server-side, so an unknown value can never reach the DB.
 */
export function RoleRequiredCredentials({
  teamId,
  role,
}: {
  teamId: string;
  role: TeamRoleGroup;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const selected = new Set(role.required_credentials);

  return (
    <form
      onChange={(e) =>
        startTransition(() => updateRoleRequiredCredentials(teamId, role.id, new FormData(e.currentTarget)))
      }
      className="mt-2"
    >
      <span className="text-[0.7rem] uppercase tracking-wide text-ink-600">
        {t("credentials.roleRequires")}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {CREDENTIAL_KINDS.map((kind) => (
          <label
            key={kind}
            className="inline-flex items-center gap-1.5 text-xs text-ink-300"
          >
            <input
              type="checkbox"
              name="required_credentials"
              value={kind}
              defaultChecked={selected.has(kind)}
              disabled={pending}
              className="h-3.5 w-3.5 rounded border-white/20 bg-ink-950 text-gold-400 disabled:opacity-50"
            />
            {t(`credentials.kind.${kind}`)}
          </label>
        ))}
      </div>
    </form>
  );
}
