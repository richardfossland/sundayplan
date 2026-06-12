"use client";

/**
 * GDPR erasure button — a browser confirm() guards the irreversible action
 * (name + contact details are scrubbed; anonymous service history remains).
 */
import { erasePerson } from "@/app/(app)/people/actions";
import { useT } from "@/lib/i18n/client";

export function ErasePersonButton({ id }: { id: string }) {
  const t = useT();
  return (
    <form
      action={erasePerson.bind(null, id)}
      onSubmit={(e) => {
        if (!window.confirm(t("people.erase.confirm"))) e.preventDefault();
      }}
    >
      <button className="rounded-lg border border-[color:var(--color-danger)]/30 px-3 py-1.5 text-sm text-[color:var(--color-danger)] transition-colors hover:border-[color:var(--color-danger)]/60">
        {t("people.erase")}
      </button>
    </form>
  );
}
