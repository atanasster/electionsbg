// When a LOCAL mandate ran — derived, with no new source, from what the ref already says.
//
// Every `local` person_role ref is `<cycle>:<obshtinaCode>:…` by construction
// (scripts/parsers_local/localPersonRefs.ts), and the cycle is the raw-data folder name:
// `2023_10_29_mi`, `2024_06_23_chmi`, `2025_10_12_chmi_nov`. So the election that produced
// the mandate is already in the row; nothing needs fetching.
//
// The END is the harder half, and it is derived from the corpus rather than assumed:
//
//   - a REGULAR cycle (`*_mi`) contests every local office in the country, so it ends every
//     local mandate outstanding on that date;
//   - a PARTIAL (`*_chmi`, `*_chmi_nov`) contests ONE seat, so it ends only that seat's.
//
// Hence "the next regular cycle, or the next partial for THIS seat, whichever is sooner".
// Treating a partial as ending every mandate would retire a whole council because one
// village elected a new mayor; ignoring partials would leave a mayor voted out in 2024
// looking as though they served to 2027.
//
// The dates are `date_basis: 'election'` (081) — the day of the VOTE, not of taking office.
// A mandate legally begins at the constitutive session, days to weeks later, and the UI says
// so; this module must never be read as publishing a day of investiture.

/** `2023_10_29_mi` → `2023-10-29`. Null for anything not shaped like a cycle folder. */
export const localCycleDate = (cycle: string): string | null => {
  const m = /^(\d{4})_(\d{2})_(\d{2})_/.exec(cycle);
  if (!m) return null;
  const [, y, mo, d] = m;
  // Reject an impossible folder name rather than minting an invalid ISO date: these come
  // from directory listings, and `2023_13_45_mi` would otherwise become a date no reader
  // could interpret and no `date` column would accept.
  const iso = `${y}-${mo}-${d}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso)
    return null;
  return iso;
};

/**
 * A REGULAR cycle contests every local office nationally; a partial contests one seat.
 *
 * The suffix test is exact for the same reason the ref parse is: `2024_06_23_chmi` also ends
 * in "mi", so a `.includes("mi")` — or an `endsWith("mi")` — would classify every partial as
 * a general election and retire the entire country's mandates on the day one village voted.
 */
export const isRegularLocalCycle = (cycle: string): boolean =>
  cycle.endsWith("_mi");

export type LocalTermIndex = {
  /** Sorted ISO dates of the regular cycles. */
  regular: string[];
  /** seat key → sorted ISO dates of the PARTIALS that contested it. */
  partialsBySeat: Map<string, string[]>;
};

/**
 * Build the index once from every local role in the run.
 *
 * `seat` is `localSeatKey`'s cross-cycle identity, which is null for the role shapes this
 * repo cannot name stably (район mayors; кметства whose place degraded to the община). A
 * partial with no seat key is dropped — it could only be attributed to every seat or to
 * none, and every seat would retire the country.
 */
export const buildLocalTermIndex = (
  rows: Array<{ cycle: string; seat: string | null }>,
): LocalTermIndex => {
  const regular = new Set<string>();
  const partialsBySeat = new Map<string, Set<string>>();
  for (const { cycle, seat } of rows) {
    const date = localCycleDate(cycle);
    if (!date) continue;
    if (isRegularLocalCycle(cycle)) {
      regular.add(date);
      continue;
    }
    if (!seat) continue;
    const s = partialsBySeat.get(seat) ?? new Set<string>();
    s.add(date);
    partialsBySeat.set(seat, s);
  }
  return {
    regular: [...regular].sort(),
    partialsBySeat: new Map(
      [...partialsBySeat].map(([k, v]) => [k, [...v].sort()]),
    ),
  };
};

/** The first entry in a SORTED list strictly after `after`, or null. */
const firstAfter = (sorted: string[], after: string): string | null =>
  sorted.find((d) => d > after) ?? null;

/**
 * The span of ONE local mandate.
 *
 * `end: null` means "not ended by anything in the corpus" — for the most recent cycle that
 * is a sitting officeholder, which is what the UI's open-ended phrasing says.
 *
 * A seat with no key still gets its regular-cycle end: a general election contests every
 * local office, so that bound does not depend on naming the seat. What is lost is only the
 * EARLY end — a by-election that replaced a район mayor mid-term is invisible, so those 46
 * roles can read up to four years long. Over-stating a term is the failure taken here, in
 * exchange for not dropping the end date for that whole role class.
 */
export const localTermBounds = (
  cycle: string,
  seat: string | null,
  index: LocalTermIndex,
): { start: string | null; end: string | null } => {
  const start = localCycleDate(cycle);
  if (!start) return { start: null, end: null };

  const nextRegular = firstAfter(index.regular, start);
  const nextPartial = seat
    ? firstAfter(index.partialsBySeat.get(seat) ?? [], start)
    : null;

  const end =
    nextRegular && nextPartial
      ? nextRegular < nextPartial
        ? nextRegular
        : nextPartial
      : (nextRegular ?? nextPartial);
  return { start, end };
};
