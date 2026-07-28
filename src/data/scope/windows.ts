// The ONE definition of what a pscope means as a date window.
//
// WHY THIS MODULE EXISTS. The mapping "scope → [from, to)" had two independent
// implementations: useScopeWindow (the React hook every scoped view reads) and an inline
// copy in scripts/db/lib/riskGradeScoped.ts (the Node loader that precomputes per-scope
// rows). They agreed only by inspection — and a precompute keyed on a window the UI
// computes differently does not fail, it silently serves the WRONG PERIOD'S numbers under
// the right label. Every scoped precompute added since would have been a third copy.
//
// So both sides now call this. It is UI-free (no react / react-router imports) for the same
// reason constants.ts is: the Node loaders import it directly.
//
// THE WINDOWS:
//   all          the whole corpus                     → (null, null)
//   y:<year>     one calendar year                    → [YYYY-01-01, YYYY+1-01-01)
//   ns:<date>    one parliament's tenure              → [election, NEXT-NEWER election)
//
// `ns` is the default scope and depends on the SELECTED election, not just on ?pscope —
// which is why its key carries the election date.

import { SCOPE_FIRST_YEAR } from "./constants";

export type ScopeWindow = {
  /** Stable key for a precomputed row: 'all' | 'y:<year>' | 'ns:<YYYY_MM_DD>'. */
  key: string;
  /** Inclusive lower bound, or null for the full corpus. */
  from: string | null;
  /** EXCLUSIVE upper bound; null means "to the end of the corpus". */
  to: string | null;
};

export type ElectionRef = { name: string };

/** `2026_04_19` → `2026-04-19`. The shards key elections with underscores; the contract
 *  dates are ISO. */
export const dashDate = (d: string): string => d.replace(/_/g, "-");

/** Elections newest-first. Sorted EXPLICITLY rather than trusting the file's order: the
 *  upper bound of a parliament window is the NEXT-NEWER election, so an oldest-first source
 *  would invert every ns window (from > to) and silently return empty sets everywhere. */
export const newestFirst = <T extends ElectionRef>(elections: T[]): T[] =>
  elections.slice().sort((a, b) => b.name.localeCompare(a.name));

/** The window for ONE parliament, given the elections list (any order) and the selected
 *  election name.
 *
 *  An election absent from the list still gets its own date as the lower bound and an open
 *  upper bound — deliberately, matching the hook this replaced. A newly added election that
 *  has not reached elections.json yet then reads "everything since it" rather than
 *  collapsing to the full corpus and overstating the period. */
export const parliamentWindow = (
  elections: ElectionRef[],
  selected: string,
): { from: string | null; to: string | null } => {
  const sorted = newestFirst(elections);
  const idx = sorted.findIndex((e) => e.name === selected);
  return {
    from: dashDate(selected),
    // Newest-first, so the NEXT-NEWER election sits at the PREVIOUS index; the newest
    // election has no successor and its window runs open-ended.
    to: idx > 0 ? dashDate(sorted[idx - 1].name) : null,
  };
};

/** The scope key for the active scope + selected election — the key a precomputed row is
 *  looked up by. Mirrors the scope vocabulary in useScope (`ns` | `all` | `y:<year>`). */
export const scopeKeyFor = (scope: string, selected: string): string =>
  scope === "all" || /^y:\d{4}$/.test(scope) ? scope : `ns:${selected}`;

/** The date window for the active scope + selected election. The single implementation
 *  behind BOTH useScopeWindow and every Node precompute. */
export const scopeWindowFor = (
  scope: string,
  selected: string,
  elections: ElectionRef[],
): { from: string | null; to: string | null } => {
  if (scope === "all") return { from: null, to: null };
  const y = /^y:(\d{4})$/.exec(scope);
  if (y) {
    const year = Number(y[1]);
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  return parliamentWindow(elections, selected);
};

/** EVERY window a precompute must cover, so the UI can never request a scope with no
 *  precomputed rows. Order is stable (all, then years ascending, then elections
 *  newest-first) so a loader's output is deterministic. */
export const allScopeWindows = (
  elections: ElectionRef[],
  nowYear: number,
  firstYear: number = SCOPE_FIRST_YEAR,
): ScopeWindow[] => {
  const out: ScopeWindow[] = [{ key: "all", from: null, to: null }];
  for (let y = firstYear; y <= nowYear; y++)
    out.push({ key: `y:${y}`, from: `${y}-01-01`, to: `${y + 1}-01-01` });
  const sorted = newestFirst(elections);
  sorted.forEach((e, i) =>
    out.push({
      key: `ns:${e.name}`,
      from: dashDate(e.name),
      to: i > 0 ? dashDate(sorted[i - 1].name) : null,
    }),
  );
  return out;
};
