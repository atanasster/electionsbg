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
import type { LocalElectionEntry } from "@/data/ElectionContext";

export type ElectionsHubCycle = {
  kind: "parliamentary" | "local";
  /** The folder id — the URL key. ⚠ NEVER RENDERED. */
  id: string;
  /** ISO `YYYY-MM-DD`, for `formatDate`. */
  date: string;
  /** True when a param was present and this hub could not resolve it. */
  fellBack: boolean;
  /** What it could not read, so the page can name it rather than just apologise. */
  requested?: string;
};

/** `2026_04_19` → `2026-04-19`. The parliamentary catalogue stores no date of its own; the
 *  folder id IS the date, which is why this conversion is safe here and nowhere near a label. */
const idToIso = (id: string): string => id.split("_").join("-");

const PARLIAMENTARY = allElections.map((e) => e.name);
const LOCAL = allLocalElections as LocalElectionEntry[];

/** Every event both catalogues know about, newest first.
 *
 *  ⚠ SORTED HERE RATHER THAN TRUSTED. Both files happen to be newest-first today, so "the
 *  latest event" would read correctly from `[0]` — and would go on reading correctly right up
 *  until a cycle is appended rather than prepended, at which point the hub silently opens on
 *  2005. */
export const ELECTION_EVENTS: ElectionsHubCycle[] = [
  ...PARLIAMENTARY.map((id) => ({
    kind: "parliamentary" as const,
    id,
    date: idToIso(id),
    fellBack: false,
  })),
  ...LOCAL.map((l) => ({
    kind: "local" as const,
    id: l.name,
    date: l.round1Date,
    fellBack: false,
  })),
].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export const LATEST_ELECTION_EVENT = ELECTION_EVENTS[0];

/** Resolve the hub's cycle: `?elections` first, the latest event as the fallback (§3.2 rule 1).
 *
 *  ⚠ AN ABSENT PARAM IS NOT A FALLBACK. Arriving at `/elections` with no param is the ordinary
 *  case, and reporting it as "we could not read your selection" would put a notice on the page
 *  every first visit. `fellBack` is true only when a value was there and did not resolve. */
export const resolveHubCycle = (
  requested: string | null | undefined,
): ElectionsHubCycle => {
  if (!requested) return LATEST_ELECTION_EVENT;
  const hit = ELECTION_EVENTS.find((e) => e.id === requested);
  if (hit) return hit;
  return { ...LATEST_ELECTION_EVENT, fellBack: true, requested };
};
