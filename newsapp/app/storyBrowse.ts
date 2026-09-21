/**
 * The corpus browse — `/stories` — as pure rules.
 *
 * ⚠️⚠️ THIS IS THE OTHER HALF OF R1. „Показваме 1 от 139" on the home page
 * names both numbers honestly and, until this existed, offered no route to
 * the other 138: the news app had no browse. The corpus was reachable by the
 * gate (`news/scripts/reachability_gate.py`) and not by a reader. This
 * module is what the gate's fixtures model — a query over
 * `stories/filter-index.json` intersected with the ordered `ranked-N` /
 * `index-N` pages — so a fixture that passes there is a page a reader can
 * actually walk to here.
 *
 * ⚠️ FILTERING PRECEDES PAGINATION, and this is where. The predicate runs
 * over the whole corpus (`queryStories`); the pages supply ORDER, revealed
 * as a prefix; the browse shows the prefix ∩ the match set. So a reader
 * asking for one outlet in one window sees every such story, in rank order,
 * with the count taken from the same rows the list came from — never „the
 * matches within what happened to download".
 */

import { searchHydrated, type StoryQuery } from "./storyQuery";
import type { StoryIndexRow, StorySort } from "./data";

export const BROWSE_SORTS: readonly StorySort[] = ["ranked", "latest"];
export const BROWSE_DEFAULT_SORT: StorySort = "ranked";

/**
 * The windows a browse can ask for. `0` is „всички" — no window — and is a
 * deliberate difference from the home briefing, whose zero is an absent
 * choice (see `withinWindow`). The corpus-query reading is what a browse
 * wants: every story, oldest last.
 */
export const BROWSE_DAYS: readonly number[] = [1, 7, 30, 0];
export const BROWSE_DEFAULT_DAYS = 7;

/** How many matching rows a browse reveals per „покажи още". */
export const BROWSE_STEP = 30;

/**
 * ⚠️ A CEILING ON HOW MANY PAGES ONE FILL MAY FETCH, in rows. A filter that
 * matches nothing on twenty pages would otherwise download the whole
 * ordering (23 × ~40 KB) in one silent burst to fill thirty slots. Past this
 * many revealed rows the fill stops and the button says what it will cost —
 * the reader decides, not the effect.
 */
export const BROWSE_FILL_ROW_CEILING = 900;

export const BROWSE_PARAMS = [
  "category",
  "days",
  "domain",
  "sort",
  "q",
] as const;
export type BrowseParam = (typeof BROWSE_PARAMS)[number];
export const BROWSE_QUERY_MAX = 200;

export interface BrowseFilters {
  category: string;
  days: number;
  domain: string;
  sort: StorySort;
  query: string;
}

/**
 * Read the browse filters off a URL, validating every value.
 *
 * ⚠️ AN UNKNOWN VALUE IS THE DEFAULT, NEVER AN EMPTY PAGE. `?category=x`
 * for a topic the taxonomy does not know would otherwise be a permanently
 * empty shared link that reads as „no such coverage". `known` lists carry
 * the vocabulary; while one is still loading (`null`) the raw value is kept
 * so a deep link does not flash the unfiltered corpus first.
 */
export const parseBrowseFilters = (
  params: URLSearchParams,
  known: {
    categories: readonly string[] | null;
    domains: readonly string[] | null;
  },
): BrowseFilters => {
  const pick = (
    raw: string | null,
    vocabulary: readonly string[] | null,
  ): string =>
    raw && raw !== "all" && (!vocabulary || vocabulary.includes(raw))
      ? raw
      : "all";
  const rawDays = params.get("days");
  // ⚠️ DIGITS ONLY before `Number`: `Number("")` is 0, and 0 is a real
  // member of BROWSE_DAYS, so `?days=` would open the whole corpus while the
  // parser's contract is „an unknown value is the default".
  const days =
    rawDays !== null &&
    /^\d+$/.test(rawDays) &&
    BROWSE_DAYS.includes(Number(rawDays))
      ? Number(rawDays)
      : BROWSE_DEFAULT_DAYS;
  const rawSort = params.get("sort");
  const sort = BROWSE_SORTS.includes(rawSort as StorySort)
    ? (rawSort as StorySort)
    : BROWSE_DEFAULT_SORT;
  return {
    category: pick(params.get("category"), known.categories),
    days,
    domain: pick(params.get("domain"), known.domains),
    sort,
    query: (params.get("q") ?? "").slice(0, BROWSE_QUERY_MAX),
  };
};

/**
 * The search string for a browse, defaults OMITTED so a link to the default
 * view is the bare `/stories`. The inverse of `parseBrowseFilters`.
 */
export const browseSearch = (
  filters: Partial<Omit<BrowseFilters, "sort">> & { sort?: StorySort },
): string => {
  const next = new URLSearchParams();
  if (filters.category && filters.category !== "all")
    next.set("category", filters.category);
  if (
    typeof filters.days === "number" &&
    filters.days !== BROWSE_DEFAULT_DAYS &&
    BROWSE_DAYS.includes(filters.days)
  )
    next.set("days", String(filters.days));
  if (filters.domain && filters.domain !== "all")
    next.set("domain", filters.domain);
  if (filters.sort && filters.sort !== BROWSE_DEFAULT_SORT)
    next.set("sort", filters.sort);
  if (filters.query?.trim())
    next.set("q", filters.query.slice(0, BROWSE_QUERY_MAX));
  const text = next.toString();
  return text ? `?${text}` : "";
};

/** The href the home page's „Показваме N от M" line points at. */
export const browseHref = (
  filters: Parameters<typeof browseSearch>[0],
): string => `/stories${browseSearch(filters)}`;

/**
 * The rows a browse shows: the revealed ordered prefix, kept to the query's
 * match set, then the text query over what is in hand.
 *
 * ⚠️ `matchingTotal` IS THE CORPUS COUNT FOR THE QUERY, from the same
 * filter index the match set came from — not `rows.length`. `searchHydrated`
 * reports its scope against it, which is what lets the page say „търсено в
 * 60 от 139" instead of implying the search saw everything.
 */
export const browseRows = <T extends Pick<StoryIndexRow, "id">>(
  revealed: readonly T[],
  match: ReadonlySet<string>,
  query: string,
  text: (row: T) => string,
  matchingTotal: number,
) =>
  searchHydrated(
    revealed.filter((row) => match.has(row.id)),
    query,
    text,
    matchingTotal,
  );

/** The query the browse runs, from its filters and one pinned instant. */
export const browseQuery = (
  filters: Pick<BrowseFilters, "category" | "days" | "domain">,
  now: number,
): StoryQuery => ({
  category: filters.category,
  domain: filters.domain,
  days: filters.days,
  now,
});

// --------------------------------------------------------------------------
// Back-button depth. ⚠️ A PER-VIEWER CONVENIENCE IN sessionStorage, nothing
// more: the list a reader had revealed before opening a story is restored
// on Back so the browser's own scroll restoration has the same height to
// land on. Keyed by the browse's search string, never by its snapshot — a
// reader coming Back after a publish gets the depth, then the new-release
// notice, which is the honest order. Every access is guarded: a private
// window or blocked storage must degrade to „start at the top", not throw.
// --------------------------------------------------------------------------

const DEPTH_PREFIX = "naiasno.news.browse.depth:";

export const readBrowseDepth = (search: string): number => {
  try {
    const raw = window.sessionStorage.getItem(DEPTH_PREFIX + search);
    const depth = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(depth) && depth > BROWSE_STEP
      ? Math.min(depth, BROWSE_FILL_ROW_CEILING)
      : BROWSE_STEP;
  } catch {
    return BROWSE_STEP;
  }
};

export const writeBrowseDepth = (search: string, depth: number): void => {
  try {
    if (depth > BROWSE_STEP)
      window.sessionStorage.setItem(DEPTH_PREFIX + search, String(depth));
    else window.sessionStorage.removeItem(DEPTH_PREFIX + search);
  } catch {
    // Storage is a convenience; a browse works without it.
  }
};
