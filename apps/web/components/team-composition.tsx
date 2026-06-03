"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import type { SkillLevel } from "@sundayplan/shared";
import {
  addMemberToRole,
  createRole,
  removeMemberFromRole,
  setKeyPerson,
  type CompositionState,
} from "@/app/(app)/teams/actions";
import type { TeamRoleGroup } from "@/lib/data/teams";
import type { MemberOption } from "@/lib/data/people";
import { SkillBadge } from "@/components/people-ui";
import { RoleRequiredCredentials } from "@/components/role-required-credentials";
import { Card, CardHeader } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const SKILLS: SkillLevel[] = ["training", "capable", "lead", "trainer"];
const initial: CompositionState = { error: null };

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-2.5 py-1.5 text-sm text-ink-100 outline-none focus:border-gold-400/50";
const ghostBtn =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-50";

function AddMemberRow({
  teamId,
  role,
  memberOptions,
}: {
  teamId: string;
  role: TeamRoleGroup;
  memberOptions: MemberOption[];
}) {
  const t = useT();
  const [state, action, pending] = useActionState(
    addMemberToRole.bind(null, teamId, role.id),
    initial,
  );
  const taken = new Set(role.members.map((m) => m.id));
  const available = memberOptions.filter((m) => !taken.has(m.id));
  if (available.length === 0) return null;

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <select name="member_id" defaultValue="" required className={input}>
        <option value="" disabled>
          {t("teams.addMember")}
        </option>
        {available.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select name="skill_level" defaultValue={role.skill_required} className={input}>
        {SKILLS.map((s) => (
          <option key={s} value={s}>
            {t(`teams.skill.${s}`)}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-1.5 text-xs text-ink-400" title={t("teams.designatedLeadTitle")}>
        <input type="checkbox" name="is_key_person" className="h-3.5 w-3.5 rounded border-white/20 bg-ink-950 text-gold-400" />
        {t("teams.lead")}
      </label>
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? t("teams.adding") : t("common.add")}
      </button>
      {state.error ? (
        <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span>
      ) : null}
    </form>
  );
}

function RoleBlock({
  teamId,
  role,
  memberOptions,
}: {
  teamId: string;
  role: TeamRoleGroup;
  memberOptions: MemberOption[];
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <li className="px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-100">{role.role}</span>
        <span className="text-[0.7rem] uppercase tracking-wide text-ink-600">
          {t("teams.needs", { skill: t(`teams.skill.${role.skill_required}`) })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {role.members.length === 0 ? (
          <span className="text-xs text-ink-600">{t("teams.noneAssigned")}</span>
        ) : (
          role.members.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pl-3 pr-1.5 text-sm text-ink-200"
            >
              <Link href={`/people/${m.id}`} className="hover:text-gold-300">
                {m.name}
              </Link>
              <SkillBadge skill={m.skill} />
              <button
                onClick={() =>
                  startTransition(() => setKeyPerson(teamId, role.id, m.id, !m.is_key_person))
                }
                disabled={pending}
                aria-label={
                  m.is_key_person
                    ? t("teams.unsetLeadAria", { name: m.name, role: role.role })
                    : t("teams.setLeadAria", { name: m.name, role: role.role })
                }
                title={m.is_key_person ? t("teams.leadSetTitle") : t("teams.leadUnsetTitle")}
                className={
                  m.is_key_person
                    ? "text-gold-300 transition-colors disabled:opacity-40"
                    : "text-ink-700 transition-colors hover:text-gold-300 disabled:opacity-40"
                }
              >
                {m.is_key_person ? "★" : "☆"}
              </button>
              <button
                onClick={() =>
                  startTransition(() => removeMemberFromRole(teamId, role.id, m.id))
                }
                disabled={pending}
                aria-label={t("teams.removeMemberAria", { name: m.name, role: role.role })}
                className="text-ink-600 transition-colors hover:text-[color:var(--color-danger)] disabled:opacity-40"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <AddMemberRow teamId={teamId} role={role} memberOptions={memberOptions} />
      <RoleRequiredCredentials teamId={teamId} role={role} />
    </li>
  );
}

function AddRoleForm({ teamId }: { teamId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(createRole.bind(null, teamId), initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 px-5 py-4">
      <input name="name" required placeholder={t("teams.newRolePlaceholder")} className={input} />
      <select name="skill_required" defaultValue="capable" className={input}>
        {SKILLS.map((s) => (
          <option key={s} value={s}>
            {t("teams.needs", { skill: t(`teams.skill.${s}`) })}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? t("teams.adding") : t("teams.addRole")}
      </button>
      {state.error ? (
        <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span>
      ) : null}
    </form>
  );
}

export function TeamComposition({
  teamId,
  roles,
  memberOptions,
}: {
  teamId: string;
  roles: TeamRoleGroup[];
  memberOptions: MemberOption[];
}) {
  const t = useT();
  return (
    <Card>
      <CardHeader title={t("teams.rolesTitle")} sub={t("teams.positionsCount", { count: roles.length })} />
      <ul className="divide-y divide-white/[0.05]">
        {roles.map((role) => (
          <RoleBlock key={role.id} teamId={teamId} role={role} memberOptions={memberOptions} />
        ))}
      </ul>
      <div className="border-t border-white/[0.06]">
        <AddRoleForm teamId={teamId} />
      </div>
    </Card>
  );
}
