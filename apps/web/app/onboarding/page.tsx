"use client";

import { useActionState } from "react";
import { createChurch, type CreateChurchState } from "./actions";

const initial: CreateChurchState = { error: null };

export default function OnboardingPage() {
  const [state, action, pending] = useActionState(createChurch, initial);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-6">
      <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-gold-400/80">
        Welcome
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-50">Create your church</h1>
      <p className="mt-2 text-sm text-ink-400">
        This is your workspace — your teams, services, and volunteers live here. You can invite
        others once it's set up.
      </p>
      <form action={action} className="mt-5 space-y-3">
        <input
          name="name"
          required
          minLength={2}
          placeholder="Church name (e.g. Alta Frikirke)"
          className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50"
        />
        {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create church"}
        </button>
      </form>
    </div>
  );
}
