import { scoreCandidate } from "@sundayplan/sdk";
import { Badge, Card, CardHeader, ScoreBar, SectionTitle, StatTile } from "@/components/ui";

const RAMPS: Array<[string, string[]]> = [
  ["royal", ["royal-300", "royal-400", "royal-500", "royal-600", "royal-700", "royal-800", "royal-900"]],
  ["gold", ["gold-200", "gold-300", "gold-400", "gold-500", "gold-600", "gold-700", "gold-800"]],
  ["ink", ["ink-200", "ink-300", "ink-400", "ink-500", "ink-700", "ink-800", "ink-900"]],
];

const sampleScore = scoreCandidate({
  candidate: {
    member_id: "demo",
    skill_level: "lead",
    accepted_recent_count: 6,
    days_since_last_assignment: 14,
    days_since_last_assignment_same_role: 28,
    target_serves_per_month: 2,
    availability: [],
    consecutive_weeks_served: 1,
    has_frequent_partner_on_service: true,
    has_trainer_paired: false,
  },
  slot: { service_starts_at: new Date("2026-06-07T09:00:00Z"), role_skill_required: "lead" },
});

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="h-12 rounded-md ring-1 ring-inset ring-white/10" style={{ backgroundColor: `var(--color-${token})` }} />
      <span className="font-mono text-[0.65rem] text-ink-500">{token}</span>
    </div>
  );
}

export default function DesignPage() {
  return (
    <div className="space-y-10">
      <SectionTitle eyebrow="Design system">Style guide</SectionTitle>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-200">Color</h2>
        <div className="space-y-4">
          {RAMPS.map(([name, tokens]) => (
            <div key={name}>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-ink-500">{name}</div>
              <div className="grid grid-cols-7 gap-2">
                {tokens.map((t) => (
                  <Swatch key={t} token={t} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wider text-ink-500">status</div>
            <div className="grid grid-cols-4 gap-2 sm:w-1/2">
              {["success", "warning", "danger", "info"].map((t) => (
                <Swatch key={t} token={t} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-200">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>neutral</Badge>
          <Badge tone="gold">gold</Badge>
          <Badge tone="success">accepted</Badge>
          <Badge tone="warning">pending</Badge>
          <Badge tone="danger">declined</Badge>
          <Badge tone="info">info</Badge>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-200">Stat tiles</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Filled" value="8/10" tone="gold" />
          <StatTile label="Open" value={2} tone="warning" hint="3 days away" />
          <StatTile label="Conflicts" value={1} tone="danger" />
          <StatTile label="SMS used" value="142" hint="of 500 this month" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-200">Score breakdown</h2>
        <Card>
          <CardHeader title="Maria Hansen" sub="Lead vocal candidate" action={<Badge tone="gold">{sampleScore?.total ?? "—"}</Badge>} />
          <div className="px-5 py-4">{sampleScore ? <ScoreBar score={sampleScore} /> : null}</div>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-200">Typography</h2>
        <Card className="space-y-2 px-5 py-4">
          <p className="text-2xl font-semibold tracking-tight text-ink-50">Volunteer scheduling, finally simple</p>
          <p className="text-base text-ink-300">Inter for UI — matching SundayRec and SundayStage for brand parity.</p>
          <p className="font-mono text-sm text-ink-500">JetBrains Mono · tabular numbers 0123456789</p>
        </Card>
      </section>
    </div>
  );
}
