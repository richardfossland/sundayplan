"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createTeam, updateTeam, type TeamFormState } from "@/app/(app)/teams/actions";
import type { TeamInfo } from "@/lib/data/teams";
import { useT } from "@/lib/i18n/client";

const initial: TeamFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function TeamFields({ team }: { team?: TeamInfo }) {
  const t = useT();
  return (
    <>
      <div>
        <label className={label}>{t("teams.field.name")}</label>
        <input
          name="name"
          required
          defaultValue={team?.name ?? ""}
          placeholder={t("teams.field.namePlaceholder")}
          className={input}
        />
      </div>
      <div>
        <label className={label}>{t("teams.field.accentColor")}</label>
        <input
          name="color"
          type="color"
          defaultValue={team?.color ?? "#D4A017"}
          className="h-10 w-20 cursor-pointer rounded-lg border border-white/10 bg-ink-950/60 p-1"
        />
      </div>
      <div>
        <label className={label}>{t("teams.field.description")}</label>
        <textarea
          name="description"
          rows={3}
          defaultValue={team?.description ?? ""}
          placeholder={t("teams.field.descriptionPlaceholder")}
          className={input}
        />
      </div>
    </>
  );
}

function Actions({
  pending,
  submitLabel,
  cancelHref,
}: {
  pending: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t("common.saving") : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        {t("common.cancel")}
      </Link>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-[color:var(--color-danger)]">{error}</p>;
}

export function AddTeamForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createTeam, initial);
  return (
    <form action={action} className="space-y-4">
      <TeamFields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("teams.createTeam")} cancelHref="/teams" />
    </form>
  );
}

export function EditTeamForm({ team }: { team: TeamInfo }) {
  const t = useT();
  const bound = updateTeam.bind(null, team.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <TeamFields team={team} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("common.save")} cancelHref={`/teams/${team.id}`} />
    </form>
  );
}
