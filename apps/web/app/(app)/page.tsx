import { autoFill, detectConflicts } from "@sundayplan/sdk";
import { SectionTitle, StatTile } from "@/components/ui";
import { AutoFillProposal, ConflictPanel } from "@/components/dashboard";
import {
  MEMBER_NAMES,
  ROLE_NAMES,
  SERVICE_LABEL,
  buildAutoFillSlots,
  buildConflictContext,
} from "@/lib/mock";

export default function DashboardPage() {
  const slots = buildAutoFillSlots();
  const proposal = autoFill(slots);
  const conflicts = detectConflicts(buildConflictContext());

  const needed = slots.reduce((s, slot) => s + slot.quantity, 0);
  const hardConflicts = conflicts.filter((c) => c.severity === "hard").length;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <SectionTitle eyebrow="Next service">{SERVICE_LABEL}</SectionTitle>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Roles to fill" value={needed} hint="across the worship team" />
        <StatTile label="Auto-filled" value={proposal.assignments.length} tone="gold" hint="proposed assignments" />
        <StatTile label="Open slots" value={proposal.unfilled.reduce((s, u) => s + (u.needed - u.filled), 0)} tone="warning" hint="need attention" />
        <StatTile label="Hard conflicts" value={hardConflicts} tone={hardConflicts > 0 ? "danger" : "neutral"} hint="must resolve before sending" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AutoFillProposal
          assignments={proposal.assignments}
          unfilled={proposal.unfilled}
          roleNames={ROLE_NAMES}
          memberNames={MEMBER_NAMES}
        />
        <ConflictPanel conflicts={conflicts} roleNames={ROLE_NAMES} memberNames={MEMBER_NAMES} />
      </div>

      <p className="text-center text-xs text-ink-600">
        Running the real <span className="text-ink-400">@sundayplan/sdk</span> engines (scoring · conflicts · auto-fill) against mock data — no backend required.
      </p>
    </div>
  );
}
