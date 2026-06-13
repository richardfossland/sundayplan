"use client";

/**
 * Pastor's chat — the schedule-page panel for the conversational planning agent.
 *
 * It posts the planner's message (+ prior history) to /api/planner-agent, which
 * runs the tool-use agent server-side and returns a natural-language reply plus
 * a REVIEWABLE diff. The diff is shown as an explicit change set the planner
 * ACCEPTS (re-running the engine server-side) before anything is written — the
 * model never writes. When the route reports the agent is unavailable (no key /
 * no AI consent / quota spent), the panel calmly explains AI is off; the
 * deterministic auto-fill buttons elsewhere on the page are untouched.
 */
import { useRef, useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { applyAgentProposal } from "@/app/(app)/schedule/actions";

interface DiffAddition {
  member_id: string;
  role_id: string;
  service_id: string;
  member_name?: string;
  role_name?: string;
  service_label?: string;
  score: { total: number };
}
interface DiffUnfilled {
  role_name?: string;
  service_label?: string;
  needed: number;
  filled: number;
}
interface AssignmentDiff {
  additions: DiffAddition[];
  unfilled: DiffUnfilled[];
  balanced: boolean;
  totalScore: number;
}

type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; diff: AssignmentDiff | null };

/** History in the Anthropic message shape the route re-sends. */
type WireMessage = { role: "user" | "assistant"; content: unknown };

export function PlannerChat() {
  const t = useT();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, startApply] = useTransition();
  const [applied, setApplied] = useState(false);
  // Raw conversation echoed back so the agent keeps tool context across turns.
  const wire = useRef<WireMessage[]>([]);

  async function send() {
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    setUnavailable(null);
    setTurns((prev) => [...prev, { role: "user", text: message }]);

    try {
      const res = await fetch("/api/planner-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history: wire.current }),
      });
      const data = await res.json();

      if (!data.available) {
        setUnavailable(reasonKey(data.reason));
        return;
      }
      wire.current = [
        ...wire.current,
        { role: "user", content: message },
        { role: "assistant", content: data.reply ?? "" },
      ];
      setApplied(false);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: data.reply ?? "", diff: (data.diff as AssignmentDiff | null) ?? null },
      ]);
    } catch {
      setUnavailable("plannerChat.unavailable.error");
    }
  }

  function accept(diff: AssignmentDiff) {
    startApply(async () => {
      await applyAgentProposal(diff.balanced);
      setApplied(true);
    });
  }

  function reasonKey(reason: string | undefined): string {
    switch (reason) {
      case "no_consent":
        return "plannerChat.unavailable.consent";
      case "quota_exhausted":
        return "plannerChat.unavailable.quota";
      case "no_church":
        return "plannerChat.unavailable.error";
      default:
        return "plannerChat.unavailable.noKey";
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden>💬</span>
        <h2 className="text-sm font-semibold text-ink-900">{t("plannerChat.title")}</h2>
      </div>
      <p className="mb-3 text-xs text-ink-600">{t("plannerChat.intro")}</p>

      <div className="space-y-3" aria-live="polite">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-gold-100 px-3 py-2 text-sm text-ink-900">
              {turn.text}
            </div>
          ) : (
            <div key={i} className="mr-auto max-w-[95%] space-y-2">
              {turn.text && (
                <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-900 whitespace-pre-wrap">
                  {turn.text}
                </div>
              )}
              {turn.diff && turn.diff.additions.length > 0 && (
                <DiffCard diff={turn.diff} onAccept={accept} applying={applying} applied={applied} t={t} />
              )}
            </div>
          ),
        )}
      </div>

      {unavailable && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{t(unavailable)}</p>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(send);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("plannerChat.placeholder")}
          disabled={pending}
          className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-gold-400 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("plannerChat.sending") : t("plannerChat.send")}
        </button>
      </form>
    </Card>
  );
}

function DiffCard({
  diff,
  onAccept,
  applying,
  applied,
  t,
}: {
  diff: AssignmentDiff;
  onAccept: (d: AssignmentDiff) => void;
  applying: boolean;
  applied: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="rounded-lg border border-gold-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold text-ink-700">
        {t("plannerChat.diff.title", { count: diff.additions.length })}
      </p>
      <ul className="space-y-1 text-sm">
        {diff.additions.map((a, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="text-ink-900">
              <span className="font-medium">{a.member_name ?? a.member_id}</span>
              {" → "}
              {a.role_name ?? a.role_id}
              <span className="text-ink-500"> · {a.service_label ?? a.service_id}</span>
            </span>
            <span className="shrink-0 rounded bg-ink-50 px-1.5 py-0.5 text-xs text-ink-600">
              {Math.round(a.score.total)}
            </span>
          </li>
        ))}
      </ul>
      {diff.unfilled.length > 0 && (
        <p className="mt-2 text-xs text-ink-500">
          {t("plannerChat.diff.unfilled", { count: diff.unfilled.length })}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onAccept(diff)}
          disabled={applying || applied}
          className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {applied ? t("plannerChat.diff.accepted") : applying ? t("plannerChat.diff.accepting") : t("plannerChat.diff.accept")}
        </button>
        <span className="text-xs text-ink-500">{t("plannerChat.diff.notSaved")}</span>
      </div>
    </div>
  );
}
