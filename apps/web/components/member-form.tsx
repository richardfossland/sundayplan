"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createMember,
  updateMember,
  type MemberFormState,
} from "@/app/(app)/people/actions";
import type { MemberEditable } from "@/lib/data/people";
import { useT } from "@/lib/i18n/client";

const initial: MemberFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function MemberFields({ member }: { member?: MemberEditable }) {
  const t = useT();
  return (
    <>
      <div>
        <label className={label}>{t("people.fieldName")}</label>
        <input
          name="display_name"
          required
          defaultValue={member?.display_name ?? ""}
          placeholder={t("people.fullNamePlaceholder")}
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("people.phone")}</label>
          <input
            name="phone_e164"
            type="tel"
            defaultValue={member?.phone_e164 ?? ""}
            placeholder="+47…"
            className={input}
          />
        </div>
        <div>
          <label className={label}>{t("people.preferredChannel")}</label>
          <select
            name="preferred_channel"
            defaultValue={member?.preferred_channel ?? "sms"}
            className={input}
          >
            <option value="sms">SMS</option>
            <option value="email">{t("people.channelEmail")}</option>
            <option value="push">{t("people.channelPush")}</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("people.email")}</label>
          <input
            name="email"
            type="email"
            defaultValue={member?.email ?? ""}
            placeholder="name@church.no"
            className={input}
          />
        </div>
        <div>
          <label className={label}>{t("people.colStatus")}</label>
          <select name="status" defaultValue={member?.status ?? "active"} className={input}>
            <option value="active">{t("people.statusActive")}</option>
            <option value="inactive">{t("people.statusInactive")}</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("people.targetServes")}</label>
          <input
            name="target_serves_per_month"
            type="number"
            min={0}
            max={31}
            defaultValue={member?.target_serves_per_month ?? ""}
            placeholder={t("people.targetServesPlaceholder")}
            className={input}
          />
        </div>
        <div>
          <label className={label}>{t("people.household")}</label>
          <input
            name="household"
            defaultValue={member?.household ?? ""}
            placeholder={t("people.householdPlaceholder")}
            className={input}
          />
        </div>
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

export function AddMemberForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createMember, initial);
  return (
    <form action={action} className="space-y-4">
      <MemberFields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("people.addPerson")} cancelHref="/people" />
    </form>
  );
}

export function EditMemberForm({ member }: { member: MemberEditable }) {
  const t = useT();
  const bound = updateMember.bind(null, member.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <MemberFields member={member} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("people.saveChanges")} cancelHref={`/people/${member.id}`} />
    </form>
  );
}
