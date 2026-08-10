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

/**
 * Offices held, one row per seat, each spanning every term of that seat.
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
 * So the group's span is merged rather than discarded:
 *
 *   start  the earliest start in the group.
 *   end    the latest end — UNLESS some term in the group is still open, in which case
 *          null. An open term max()'d away would retire a sitting member.
 *
 * Only spans sharing the representative's `dateBasis` are merged: folding a mandate bound
 * together with a declaration's filing date would reintroduce exactly the conflation the
 * basis column exists to prevent. Rows on a different basis keep the seat row but
 * contribute no dates to it.
 */
export const foldOffices = <T extends OfficeRole>(roles: T[]): T[] => {
  const groups = new Map<string, T[]>();
  for (const r of roles.filter(isOffice)) {
    const k = dedupeKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  return [...groups.values()].map((group) => {
    const rep = group[0];
    if (!rep.dateBasis) return rep;
    const spans = group.filter((g) => g.dateBasis === rep.dateBasis);

    const starts = spans.map((g) => g.start).filter((d): d is string => !!d);
    const ends = spans.map((g) => g.end).filter((d): d is string => !!d);
    // "Still holding it" is a term that STARTED and has no end. A row with neither date
    // says nothing about whether the seat is current, so it must not open the span.
    const stillHeld = spans.some((g) => g.start && !g.end);

    // ISO-8601 dates sort lexicographically, so min/max need no parsing.
    const start = starts.length
      ? starts.reduce((a, b) => (a < b ? a : b))
      : null;
    const end = stillHeld
      ? null
      : ends.length
        ? ends.reduce((a, b) => (a > b ? a : b))
        : null;

    return start === rep.start && end === rep.end
      ? rep
      : { ...rep, start, end };
  });
};
