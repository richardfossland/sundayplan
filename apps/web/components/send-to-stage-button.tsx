"use client";

/**
 * "Send til Stage" — hands this service's running order to SundayStage. The
 * server action builds the canonical ServicePlan and POSTs it to SundayStage's
 * import endpoint, which creates a session pre-seeded with the order of service.
 * On success we surface the 6-digit display code + a deep link that opens the
 * Stage operator (with the session secret in the URL fragment) already laid out.
 */
import { useActionState } from "react";

import { sendServicePlanToStage, type SendToStageState } from "@/app/(app)/services/actions";
import { useT } from "@/lib/i18n/client";

const initial: SendToStageState = { status: "idle" };

export function SendToStageButton({ serviceId }: { serviceId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(
    sendServicePlanToStage.bind(null, serviceId),
    initial,
  );

  return (
    <form action={action} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25 disabled:opacity-50"
      >
        {pending ? t("services.sendToStage.sending") : t("services.sendToStage")}
      </button>
      {state.status === "sent" ? (
        <span className="text-sm text-ink-300">
          {t("services.sendToStage.code", { code: state.code })}{" "}
          <a
            href={state.openUrl}
            target="_blank"
            rel="noreferrer"
            className="text-gold-400 underline transition-colors hover:text-gold-300"
          >
            {t("services.sendToStage.open")}
          </a>
        </span>
      ) : null}
      {state.status === "error" ? (
        <span className="text-sm text-[color:var(--color-danger)]">
          {t("services.sendToStage.error")}
        </span>
      ) : null}
    </form>
  );
}
