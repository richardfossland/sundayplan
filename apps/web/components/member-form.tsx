"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createMember,
  updateMember,
  type MemberFormState,
} from "@/app/(app)/people/actions";
import type { MemberEditable } from "@/lib/data/people";

const initial: MemberFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function MemberFields({ member }: { member?: MemberEditable }) {
  return (
    <>
      <div>
        <label className={label}>Name</label>
        <input
          name="display_name"
          required
          defaultValue={member?.display_name ?? ""}
          placeholder="Full name"
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Phone</label>
          <input
            name="phone_e164"
            type="tel"
            defaultValue={member?.phone_e164 ?? ""}
            placeholder="+47…"
            className={input}
          />
        </div>
        <div>
          <label className={label}>Preferred channel</label>
          <select
            name="preferred_channel"
            defaultValue={member?.preferred_channel ?? "sms"}
            className={input}
          >
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="push">Push</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Email</label>
          <input
            name="email"
            type="email"
            defaultValue={member?.email ?? ""}
            placeholder="name@church.no"
            className={input}
          />
        </div>
        <div>
          <label className={label}>Status</label>
          <select name="status" defaultValue={member?.status ?? "active"} className={input}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Target serves / month</label>
          <input
            name="target_serves_per_month"
            type="number"
            min={0}
            max={31}
            defaultValue={member?.target_serves_per_month ?? ""}
            placeholder="e.g. 2"
            className={input}
          />
        </div>
        <div>
          <label className={label}>Household</label>
          <input
            name="household"
            defaultValue={member?.household ?? ""}
            placeholder="e.g. Hansen"
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
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        Cancel
      </Link>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-[color:var(--color-danger)]">{error}</p>;
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(createMember, initial);
  return (
    <form action={action} className="space-y-4">
      <MemberFields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Add person" cancelHref="/people" />
    </form>
  );
}

export function EditMemberForm({ member }: { member: MemberEditable }) {
  const bound = updateMember.bind(null, member.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <MemberFields member={member} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Save changes" cancelHref={`/people/${member.id}`} />
    </form>
  );
}
