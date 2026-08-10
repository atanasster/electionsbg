// The "Длъжности" list: which of a person's roles are OFFICES, deduped to one row per
// seat, each carrying the full span it was held for.
//
// Extracted from PersonProfileScreen's useMemo so the fold can be tested. The dedupe is
// older than the dates; the SPAN MERGE is what the dates made necessary — see foldOffices.

import { isOfficialSource } from "@/lib/officialSources";

/** The fields the fold reads. Structural, so ProfileRole satisfies it. */
export type OfficeRole = {
  source: string;
  role: string;
  placeCode?: string | null;
  start?: string | null;
  end?: string | null;
  dateBasis?: "term" | "election" | "filing" | null;
};

const isOffice = (r: OfficeRole): boolean =>
  r.source === "mp" ||
  isOfficialSource(r.source) ||
  r.source === "magistrate" ||
  r.source === "local";

/**
 * One seat is one (role, placeCode) pair regardless of which source recorded it.
 *
 * A place-less role can only be deduped against another place-less one: two seats we
 * cannot locate are not evidence of being the same seat — so those key on the source too.
 */
const dedupeKey = (r: OfficeRole): string =>
  r.placeCode ? `${r.role}\t${r.placeCode}` : `${r.source}\t${r.role}\t`;

/** One continuous stretch of holding a seat. `end: null` means still held. */
export type OfficeSpan = { start: string | null; end: string | null };

/** A folded office row: the representative role plus every stretch it was held for. */
export type FoldedOffice<T> = T & { spans: OfficeSpan[] };

/** Whole days from ISO date `a` to ISO date `b`. */
const daysBetween = (a: string, b: string): number =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/**
 * Merge terms into CONTIGUOUS runs — never into one span across a gap.
 *
 * Consecutive terms of one seat abut rather than overlap: a local mandate's end IS the next
 * election's date (`end === next.start`), and a parliamentary term ends the day before the
 * next begins. Anything wider is a real absence from the office, so the 1-day tolerance
 * covers both shapes without ever merging one away.
 *
 * Measured on the corpus, 1,675 people hold a local seat with a genuine gap — a village
 * mayor who served 2007-2011 and returned in 2025 must read "2007 - 2011, since 2025", not
 * "since 2007", which is what merging the group into one span claimed.
 */
const mergeRuns = (spans: OfficeSpan[]): OfficeSpan[] => {
  // ISO-8601 sorts lexicographically. A wholly undated term says nothing about when the
  // seat was held and is dropped rather than allowed to open or extend a run.
  const sorted = spans
    .filter((s) => s.start || s.end)
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));

  const out: OfficeSpan[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    const joins =
      prev &&
      // An OPEN run absorbs anything later: the seat is still held, so a later term cannot
      // be a separate stretch.
      (prev.end === null ||
        (s.start !== null && daysBetween(prev.end, s.start) <= 1));
    if (!joins) {
      out.push({ ...s });
      continue;
    }
    // Extend, letting a null end win — an open term must never be max()'d shut.
    if (prev.end !== null)
      prev.end = s.end === null ? null : s.end > prev.end ? s.end : prev.end;
  }
  return out;
};

/**
 * Offices held, one row per seat, each carrying every stretch it was held for.
 *
 * The dedupe collapses the same seat recorded twice (a councillor appears in BOTH the
 * local-election results and the Court-of-Audit roster) and the same seat held repeatedly
 * (an MP is one row per parliament, `ref = '<mpId>:<ns>'`, and the resolver replicates one
 * place across all of them). Before the rows carried dates that was lossless — the
 * collapsed rows rendered identical text. It is not lossless now: keeping the first row's
 * dates alone would state ONE parliament as the whole tenure. Measured on the corpus,
 * 303 of 562 people with dated MP roles have 2–9 terms folded into one row, hiding 960 of
 * the 1,522 dated roles.
 *
 * Hence `spans`, PLURAL — a re-elected holder reads as one stretch, someone who left and
 * came back as two. Merging a group into a single start..end looks right and is not: it
 * states a continuous tenure across an absence.
 *
 * Only terms sharing the representative's `dateBasis` are merged: folding a mandate bound
 * together with a declaration's filing date would reintroduce exactly the conflation the
 * basis column exists to prevent. Rows on a different basis keep the seat row but
 * contribute no dates to it.
 */
export const foldOffices = <T extends OfficeRole>(
  roles: T[],
): FoldedOffice<T>[] => {
  const groups = new Map<string, T[]>();
  for (const r of roles.filter(isOffice)) {
    const k = dedupeKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  return [...groups.values()].map((group) => {
    const rep = group[0];
    if (!rep.dateBasis) return { ...rep, spans: [] };
    const same = group.filter((g) => g.dateBasis === rep.dateBasis);
    return {
      ...rep,
      spans: mergeRuns(
        same.map((g) => ({ start: g.start ?? null, end: g.end ?? null })),
      ),
    };
  });
};
