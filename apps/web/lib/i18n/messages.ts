/**
 * Message catalogs — dependency-free i18n for the Sunday suite. Norwegian-first
 * (the launch locale) with English as the structural source and fallback. New
 * keys land in `en` first; any locale missing a key falls back to English, so
 * the UI never shows a raw key or crashes mid-migration.
 *
 * Keys are flat dotted strings to keep lookup trivial in both server and client
 * components. `{var}` placeholders are interpolated by `translate()`.
 */
export const LOCALES = ["no", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "no";

export function isLocale(v: string | null | undefined): v is Locale {
  return v === "no" || v === "en";
}

type Catalog = Record<string, string>;

const en: Catalog = {
  // Navigation shell
  "nav.dashboard": "Dashboard",
  "nav.services": "Services",
  "nav.schedule": "Schedule",
  "nav.songs": "Songs",
  "nav.people": "People",
  "nav.teams": "Teams",
  "nav.messages": "Messages",
  "nav.reports": "Reports",
  "nav.settings": "Settings",
  "nav.section.plan": "Plan",
  "nav.section.people": "People",
  "nav.section.engage": "Engage",
  "nav.styleGuide": "Style guide",
  "shell.search": "Search",
  "shell.searchPlaceholder": "Search people, songs, services — or jump to a page…",
  "shell.signOut": "Sign out",
  "shell.noMatches": "No matches",
  "shell.group.goTo": "Go to",
  "shell.group.actions": "Actions",
  "shell.group.people": "People",
  "shell.group.songs": "Songs",
  "shell.group.services": "Services",
  "action.newService": "New service",
  "action.newService.sub": "Plan a Sunday or gathering",
  "action.newPerson": "New person",
  "action.newPerson.sub": "Add a volunteer",
  "action.newTeam": "New team",
  "action.newTeam.sub": "Create a ministry team",
  "action.openSchedule": "Open schedule",
  "action.openSchedule.sub": "Auto-fill and send invites",
  "action.compose": "Compose message",
  "action.compose.sub": "Notify volunteers",
  "action.calendar": "Month calendar",
  "action.calendar.sub": "See services by date",

  // Dashboard
  "dash.welcome": "Welcome",
  "dash.welcomeTitle": "Let's plan your first service",
  "dash.ready.title": "Your dashboard is ready",
  "dash.ready.blurb":
    "Once you've added people and a service, this is where you'll see who's serving, who hasn't replied, and what needs your attention before Sunday.",
  "dash.ready.cta": "Add your first team",
  "dash.nextService": "Next service",
  "dash.noUpcoming": "No upcoming services",
  "dash.stat.rolesFilled": "Roles filled",
  "dash.stat.rolesFilled.hint": "on the next service",
  "dash.stat.pending": "Pending replies",
  "dash.stat.pending.hint": "volunteers not yet answered",
  "dash.stat.openSlots": "Open slots",
  "dash.stat.openSlots.hint": "near the deadline",
  "dash.stat.conflicts": "Hard conflicts",
  "dash.stat.conflicts.hint": "resolve before sending",
  "dash.nextCard.coverage": "Coverage and quick actions",
  "dash.nextCard.empty": "Nothing scheduled ahead",
  "dash.nextCard.roles": "{filled}/{required} roles",
  "dash.openService": "Open service",
  "dash.scheduleVolunteers": "Schedule volunteers →",
  "dash.noService.title": "No upcoming services",
  "dash.noService.blurb": "Create a service to start planning the order and scheduling volunteers.",
  "dash.noService.cta": "New service",
  "dash.swaps.banner": "{count} volunteer(s) need cover — someone handed a slot back.",
  "dash.swaps.cta": "Find cover →",

  // Onboarding checklist
  "onb.title": "Get set up",
  "onb.sub": "Five steps to your first rota — under 15 minutes",
  "onb.step.team": "Create your first team",
  "onb.step.team.hint": "e.g. Worship, Tech, Hospitality",
  "onb.step.role": "Add roles to a team",
  "onb.step.role.hint": "the positions you schedule for",
  "onb.step.people": "Add at least 3 people",
  "onb.step.people.hint": "the volunteers you'll schedule",
  "onb.step.service": "Create a service",
  "onb.step.service.hint": "a Sunday or gathering to plan",
  "onb.step.invite": "Send your first invites",
  "onb.step.invite.hint": "auto-fill the rota, then notify",
  "onb.start": "Start →",
  "onb.dismiss": "Dismiss",

  // Conflicts
  "conflict.title": "Conflict checks",
  "conflict.found": "{count} found across the schedule",
  "conflict.hard": "{count} hard",
  "conflict.noHard": "no hard conflicts",
  "conflict.clear": "No conflicts — you're clear to send.",
  "conflict.action.reassign": "Reassign",
  "conflict.action.rebalance": "Rebalance",
  "conflict.action.pickTrained": "Pick trained",
  "conflict.action.fillSlot": "Fill slot",
  "conflict.action.review": "Review",
  "conflict.action.resolve": "Resolve",

  // Common
  "common.church": "Your church",
};

const no: Catalog = {
  // Navigation shell
  "nav.dashboard": "Oversikt",
  "nav.services": "Gudstjenester",
  "nav.schedule": "Vaktliste",
  "nav.songs": "Sanger",
  "nav.people": "Personer",
  "nav.teams": "Team",
  "nav.messages": "Meldinger",
  "nav.reports": "Rapporter",
  "nav.settings": "Innstillinger",
  "nav.section.plan": "Planlegg",
  "nav.section.people": "Personer",
  "nav.section.engage": "Engasjer",
  "nav.styleGuide": "Stilguide",
  "shell.search": "Søk",
  "shell.searchPlaceholder": "Søk personer, sanger, gudstjenester — eller hopp til en side…",
  "shell.signOut": "Logg ut",
  "shell.noMatches": "Ingen treff",
  "shell.group.goTo": "Gå til",
  "shell.group.actions": "Handlinger",
  "shell.group.people": "Personer",
  "shell.group.songs": "Sanger",
  "shell.group.services": "Gudstjenester",
  "action.newService": "Ny gudstjeneste",
  "action.newService.sub": "Planlegg en søndag eller samling",
  "action.newPerson": "Ny person",
  "action.newPerson.sub": "Legg til en frivillig",
  "action.newTeam": "Nytt team",
  "action.newTeam.sub": "Opprett et tjeneste-team",
  "action.openSchedule": "Åpne vaktliste",
  "action.openSchedule.sub": "Auto-fyll og send invitasjoner",
  "action.compose": "Skriv melding",
  "action.compose.sub": "Varsle frivillige",
  "action.calendar": "Månedskalender",
  "action.calendar.sub": "Se gudstjenester etter dato",

  // Dashboard
  "dash.welcome": "Velkommen",
  "dash.welcomeTitle": "La oss planlegge din første gudstjeneste",
  "dash.ready.title": "Oversikten din er klar",
  "dash.ready.blurb":
    "Når du har lagt til personer og en gudstjeneste, ser du her hvem som tjener, hvem som ikke har svart, og hva som trenger oppmerksomhet før søndag.",
  "dash.ready.cta": "Legg til ditt første team",
  "dash.nextService": "Neste gudstjeneste",
  "dash.noUpcoming": "Ingen kommende gudstjenester",
  "dash.stat.rolesFilled": "Roller fylt",
  "dash.stat.rolesFilled.hint": "på neste gudstjeneste",
  "dash.stat.pending": "Ventende svar",
  "dash.stat.pending.hint": "frivillige som ikke har svart",
  "dash.stat.openSlots": "Åpne roller",
  "dash.stat.openSlots.hint": "nær fristen",
  "dash.stat.conflicts": "Harde konflikter",
  "dash.stat.conflicts.hint": "løs før du sender",
  "dash.nextCard.coverage": "Dekning og hurtigvalg",
  "dash.nextCard.empty": "Ingenting planlagt fremover",
  "dash.nextCard.roles": "{filled}/{required} roller",
  "dash.openService": "Åpne gudstjeneste",
  "dash.scheduleVolunteers": "Sett opp frivillige →",
  "dash.noService.title": "Ingen kommende gudstjenester",
  "dash.noService.blurb":
    "Opprett en gudstjeneste for å begynne å planlegge rekkefølgen og sette opp frivillige.",
  "dash.noService.cta": "Ny gudstjeneste",
  "dash.swaps.banner": "{count} frivillig(e) trenger erstatter — noen ga fra seg en rolle.",
  "dash.swaps.cta": "Finn erstatter →",

  // Onboarding checklist
  "onb.title": "Kom i gang",
  "onb.sub": "Fem steg til din første vaktliste — under 15 minutter",
  "onb.step.team": "Opprett ditt første team",
  "onb.step.team.hint": "f.eks. Lovsang, Teknikk, Vertskap",
  "onb.step.role": "Legg til roller i et team",
  "onb.step.role.hint": "posisjonene du setter opp",
  "onb.step.people": "Legg til minst 3 personer",
  "onb.step.people.hint": "de frivillige du skal sette opp",
  "onb.step.service": "Opprett en gudstjeneste",
  "onb.step.service.hint": "en søndag eller samling å planlegge",
  "onb.step.invite": "Send dine første invitasjoner",
  "onb.step.invite.hint": "auto-fyll vaktlisten, så varsle",
  "onb.start": "Start →",
  "onb.dismiss": "Lukk",

  // Conflicts
  "conflict.title": "Konfliktsjekk",
  "conflict.found": "{count} funnet i vaktlisten",
  "conflict.hard": "{count} harde",
  "conflict.noHard": "ingen harde konflikter",
  "conflict.clear": "Ingen konflikter — klar til å sende.",
  "conflict.action.reassign": "Bytt person",
  "conflict.action.rebalance": "Balanser",
  "conflict.action.pickTrained": "Velg trent",
  "conflict.action.fillSlot": "Fyll rolle",
  "conflict.action.review": "Se nærmere",
  "conflict.action.resolve": "Løs",

  // Common
  "common.church": "Din menighet",
};

export const CATALOGS: Record<Locale, Catalog> = { no, en };

/** Resolve a dotted key for `locale`, falling back to English, then the key. */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = CATALOGS[locale]?.[key] ?? CATALOGS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
