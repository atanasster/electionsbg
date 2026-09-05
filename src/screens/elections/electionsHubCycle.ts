// Which election `/elections` is about (§3.2, Phase 3 item 3).
//
// ⚠ THE PARAM CANNOT BE IGNORED, AND IT CANNOT BE TRUSTED. `elections` is one of the global
// params `usePreserveParams` carries across every `@/ux/Link` navigation, so a reader arriving
// from `/elections/2013_05_12` brings `?elections=2013_05_12` with them. A hub that "defaults to
// the latest event" would then render the latest cycle's outcome while `ElectionContext` — and
// every other reader of that param on the same page — resolves 2013. The two disagree silently,
// at a 200.
//
// ⚠ AND THE FALLBACK IS REPORTED, NOT SILENT. `useElectionContext` resolves an unknown value to
// the latest and says nothing, which is right for a selector whose job is to always have an
// answer. Here it is not: rule 3 says an unknown or malformed value falls back to the latest
// event AND SAYS SO, rather than rendering a first screen the reader cannot account for. So the
// resolution carries `fellBack` and the value it could not read.
//
// ⚠ THE ID IS A KEY AND NEVER A LABEL. `ScopeControl`'s default pill rendered „Този парламент ·
// 2026-04-19" — the folder id with underscores swapped for hyphens — on all 31 surfaces that
// mount it. This module therefore returns an ISO `date` beside the id, and every caller formats
// THAT through `formatDate`, which pins `timeZone: "UTC"` for a date-only value: a calendar day
// formatted in the viewer's zone renders as the previous day for every reader west of
// Greenwich, which shipped on 613 pages.

import allElections from "@/data/json/elections.json";
import allLocalElections from "@/data/json/local_elections.json";
import allPresidentialElections from "@/data/json/presidential_elections.json";
import type { LocalElectionEntry } from "@/data/ElectionContext";
import type { PresidentialElectionEntry } from "@/data/presidentialCatalogue";

/** The three electoral systems this hub can be about. */
export type ElectionsHubKind = "parliamentary" | "local" | "presidential";

/**
 * The cycle the hub is about.
 *
 * ⚠ A DISCRIMINATED UNION ON `fellBack`, so „fell back with no reason" and „a reason with
 * no fallback" cannot be built. They are not pedantic: the screen reads
 * `fellBackReason === "no-surface"` and everything else takes the „we did not recognise
 * it" sentence, so a reasonless fallback would default to the FALSE one — the exact
 * statement this distinction exists to avoid.
 */
export type ElectionsHubCycle = {
  kind: ElectionsHubKind;
  /** The folder id — the URL key. ⚠ NEVER RENDERED. */
  id: string;
  /** ISO `YYYY-MM-DD`, for `formatDate`. */
  date: string;
} & (
  | {
      fellBack: false;
      fellBackReason?: undefined;
      requested?: undefined;
      requestedCycle?: undefined;
    }
  | {
      /** A param was present and this hub could not open it. */
      fellBack: true;
      /**
       * WHY, because the two reasons are different statements about the reader's
       * selection and only one of them is „we do not know that cycle".
       *
       * ⚠ `"no-surface"` NAMES A CYCLE THIS SITE HAS AND CANNOT YET SHOW — a
       * presidential id, until its screens land. Reporting that as `"unknown"` tells the
       * reader we do not recognise an election we publish a catalogue of, which is false
       * and unfixable from their side.
       */
      fellBackReason: "unknown" | "no-surface";
      /** The raw param, so the page can name what it could not open. */
      requested: string;
      /**
       * The catalogued cycle behind that param, when there is one.
       *
       * ⚠ PRESENT ONLY FOR `"no-surface"`, and it is what keeps the folder id out of the
       * prose. This module's header states that an id is a key and never a label — the
       * form once reached 31 surfaces as „Този парламент · 2026-04-19" — and the
       * `no-surface` branch is the one place we know the cycle well enough to name it
       * properly. The `unknown` branch has nothing but the reader's own string, which is
       * why it still echoes it verbatim.
       */
      requestedCycle?: { kind: ElectionsHubKind; date: string };
    }
);

/**
 * Where each kind's canonical per-cycle result lives — the route PATTERN as
 * `src/routes.tsx` spells it, and the href builder for one id.
 *
 * ⚠ THE PATTERN IS HERE SO THE GATE CAN CHECK IT. `electionsHubCycle.test.ts` reads
 * `routes.tsx` and requires a route to exist for exactly the kinds absent from
 * `KINDS_WITHOUT_SURFACE` — a biconditional, so adding the presidential route turns the
 * gate red until that list is emptied, and emptying it early turns it red too. A plain
 * boolean flag would be a hand-flip that rots.
 */
export const CYCLE_SURFACE: Record<
  ElectionsHubKind,
  { routePattern: string; href: (id: string) => string; labelKey: string }
> = {
  parliamentary: {
    routePattern: "elections/:date",
    href: (id) => `/elections/${id}`,
    labelKey: "elections_scope_parliamentary",
  },
  local: {
    routePattern: "local/:cycle",
    href: (id) => `/local/${id}`,
    labelKey: "elections_scope_local",
  },
  presidential: {
    routePattern: "presidential/:cycle",
    href: (id) => `/presidential/${id}`,
    labelKey: "elections_scope_presidential",
  },
};

/**
 * Kinds whose per-cycle screens do not exist yet.
 *
 * ⚠ A CYCLE LISTED HERE IS CATALOGUED BUT NOT RESOLVABLE. It stays in `ELECTION_EVENTS`,
 * so anything counting or searching the corpus sees it, and `resolveHubCycle` refuses to
 * return it — because every destination the hub renders for a resolved cycle would be a
 * 404. The plan's own rule for the tile registry, one control up: a surface must not seed
 * a destination that does not exist.
 *
 * Emptied by plan T5, which adds `/presidential/:cycle`.
 */
export const KINDS_WITHOUT_SURFACE: ElectionsHubKind[] = ["presidential"];

/** `2026_04_19` → `2026-04-19`. The parliamentary catalogue stores no date of its own; the
 *  folder id IS the date, which is why this conversion is safe here and nowhere near a label. */
const idToIso = (id: string): string => id.split("_").join("-");

const PARLIAMENTARY = allElections.map((e) => e.name);
const LOCAL = allLocalElections as LocalElectionEntry[];
const PRESIDENTIAL = allPresidentialElections as PresidentialElectionEntry[];

/** Every event the THREE catalogues know about, newest first.
 *
 *  ⚠ SORTED HERE RATHER THAN TRUSTED. All three happen to be newest-first today, so "the
 *  latest event" would read correctly from `[0]` — and would go on reading correctly right up
 *  until a cycle is appended rather than prepended, at which point the hub silently opens on
 *  2005. */
export const ELECTION_EVENTS: ElectionsHubCycle[] = [
  ...PARLIAMENTARY.map((id) => ({
    kind: "parliamentary" as const,
    id,
    date: idToIso(id),
    fellBack: false as const,
  })),
  ...LOCAL.map((l) => ({
    kind: "local" as const,
    id: l.name,
    date: l.round1Date,
    fellBack: false as const,
  })),
  // ⚠ DATED FROM ROUND 1, like the local entries and for the same reason: the id ends in
  // `_pvr`, so splitting it on underscores yields `2021-11-14-pvr`, which `formatDate`
  // passes through verbatim rather than rejecting — the folder id, on the page.
  ...PRESIDENTIAL.map((p) => ({
    kind: "presidential" as const,
    id: p.name,
    date: p.round1Date,
    fellBack: false as const,
  })),
].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** The newest event of any kind — a fact about the catalogue. */
export const LATEST_ELECTION_EVENT = ELECTION_EVENTS[0];

/**
 * The newest event this hub can actually OPEN — the anchor for the no-param default, for
 * the fallback, and for the „switch to the latest" control.
 *
 * ⚠ NOT `ELECTION_EVENTS[0]`, and the difference is a data change away. The merge is
 * sorted by date across three catalogues, so the newest event becomes PRESIDENTIAL the
 * moment the 2026-11 cycle is catalogued (plan T7) — and until T5 that kind has no route.
 * Anchoring on the bare latest would then point „пълен резултат" at a 404 for every reader
 * arriving with no param at all, and turn „към последния вот" into a control that writes
 * an id this function immediately refuses. That is the guard's own failure mode reached by
 * the one path it did not cover.
 */
export const LATEST_RESOLVABLE_EVENT: ElectionsHubCycle =
  ELECTION_EVENTS.find((e) => !KINDS_WITHOUT_SURFACE.includes(e.kind)) ??
  LATEST_ELECTION_EVENT;

/** Resolve the hub's cycle: `?elections` first, the latest event as the fallback (§3.2 rule 1).
 *
 *  ⚠ AN ABSENT PARAM IS NOT A FALLBACK. Arriving at `/elections` with no param is the ordinary
 *  case, and reporting it as "we could not read your selection" would put a notice on the page
 *  every first visit. `fellBack` is true only when a value was there and did not resolve. */
export const resolveHubCycle = (
  requested: string | null | undefined,
): ElectionsHubCycle => {
  if (!requested) return LATEST_RESOLVABLE_EVENT;
  const hit = ELECTION_EVENTS.find((e) => e.id === requested);
  // ⚠ A KNOWN CYCLE WITH NO SCREENS FALLS BACK TOO, and under its own reason. Returning it
  // would put the reader on a hub whose „full result" link, „other kind" link and scope
  // pill all point at routes that do not exist — while the fallback notice, which exists
  // for a value we cannot read, would say we did not recognise it.
  if (hit && !KINDS_WITHOUT_SURFACE.includes(hit.kind)) return hit;
  return {
    kind: LATEST_RESOLVABLE_EVENT.kind,
    id: LATEST_RESOLVABLE_EVENT.id,
    date: LATEST_RESOLVABLE_EVENT.date,
    fellBack: true,
    fellBackReason: hit ? "no-surface" : "unknown",
    requested,
    ...(hit ? { requestedCycle: { kind: hit.kind, date: hit.date } } : {}),
  };
};

/**
 * The canonical full result for a resolved cycle.
 *
 * ⚠ EXHAUSTIVE OVER THE KIND, so a fourth electoral system is a compile error here rather
 * than a silent parliamentary URL built from a foreign id. That is what the implicit
 * `else` did: `cycle.kind === "local" ? … : \`/elections/${id}\`` sent a `_pvr` id to
 * `/elections/2021_11_14_pvr`, a 404.
 *
 * @param cycle - A cycle `resolveHubCycle` returned.
 * @returns The path of the page this hub hands over to.
 */
export const hubCycleHref = (cycle: ElectionsHubCycle): string =>
  CYCLE_SURFACE[cycle.kind].href(cycle.id);
