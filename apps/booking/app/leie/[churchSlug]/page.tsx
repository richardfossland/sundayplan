/**
 * Public rental landing — `/leie/<churchSlug>` (Phase 3). PUBLIC, no session.
 *
 * The church is resolved SERVER-SIDE from the slug; only bookable_by='public'
 * resources are exposed. The renter picks a resource + time (or, for a `person`
 * resource, an appointment slot), enters name + contact + purpose, and submits
 * → a PENDING booking + a status magic-link they can follow.
 *
 * NOTE: the spec's path is `/[churchSlug]/leie`; we use `/leie/[churchSlug]` so
 * the public slug segment can't shadow the planner app's top-level static routes
 * (/calendar, /resources, /queue). Functionally identical (slug-scoped public).
 */
import { notFound } from "next/navigation";
import { RentalForm } from "@/components/rental-form";
import { listEventTypes, listPublicResources, resolveChurchBySlug } from "@/lib/data/booking";
import { I18nProvider } from "@/lib/i18n/client";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

export default async function RentalPage({
  params,
}: {
  params: Promise<{ churchSlug: string }>;
}) {
  const { churchSlug } = await params;
  const church = await resolveChurchBySlug(churchSlug);
  if (!church) notFound();

  const locale: Locale = isLocale(church.locale) ? church.locale : DEFAULT_LOCALE;
  const [resources, eventTypes] = await Promise.all([
    listPublicResources(church.id),
    listEventTypes(church.id),
  ]);

  // Strip to anon-safe fields for the client form.
  const safeResources = resources.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    description: r.description,
    capacity: r.capacity,
    requires_approval: r.requires_approval,
  }));
  const safeEventTypes = eventTypes.map((e) => ({
    id: e.id,
    name: e.name,
    default_duration_min: e.default_duration_min,
    requires_approval: e.requires_approval,
    terms: e.terms,
  }));

  return (
    <I18nProvider locale={locale}>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-base font-bold text-gold-300">
            S
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink-100">
            {church.name}
          </span>
        </div>
        <RentalForm
          churchSlug={church.slug}
          resources={safeResources}
          eventTypes={safeEventTypes}
        />
      </main>
    </I18nProvider>
  );
}
