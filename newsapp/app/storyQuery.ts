/**
 * One query contract over the whole corpus.
 *
 * ⚠️⚠️ THE DEFECT THIS REPLACES: the client filters what it happens to have
 * downloaded and reports that as the answer. `HomeScreen` filtered the ≤16
 * stories in `home.json`; `OutletScreen` filtered the revealed prefix and
 * printed the count of matches WITHIN it. Both answered a narrower question
 * than the reader asked, at a 200, with nothing saying so — a topic chip could
 * read „Парламентарни избори · 2" while the corpus held two hundred.
 *
 * `stories/filter-index.json` carries every story's window, topics and outlets
 * for the whole corpus in ~41 KB gzipped, so a predicate here sees all of it
 * and a facet count comes from the same rows as the list beneath it.
 *
 * ⚠️ IT CANNOT SEARCH TEXT, AND SAYS SO RATHER THAN PRETENDING. Measured over
 * 3,082 stories: adding titles to the index costs 288 KB gzipped, an inverted
 * index over them 348 KB, the 24h window's titles alone 234 KB — against a
 * 13 KB home payload. So free-text search runs over the rows the client has
 * HYDRATED, and `searchScope` reports exactly how many that was. Narrowing a
 * search is permissible; doing it silently is not.
 */

/** A row of `stories/filter-index.json`, positional to keep the file small. */
export type FilterRow = readonly [
  id: string,
  lastPublished: string,
  categories: readonly string[],
  domains: readonly string[],
];

export interface FilterIndex {
  readonly query_version: number;
  readonly fields: readonly string[];
  readonly total: number;
  readonly facets_basis: Readonly<Record<string, string>>;
  readonly facets: {
    readonly categories: Readonly<Record<string, number>>;
    readonly domains: Readonly<Record<string, number>>;
  };
  readonly stories: readonly FilterRow[];
}

/**
 * The contract version this client was written against.
 *
 * ⚠️ CHECKED, NOT DECORATIVE — `useGlobalStoryQuery` refuses an index whose
 * `query_version` is not this one. The rows are POSITIONAL, so a v2 that
 * reorders or extends them would be read as v1: `row[2]` becomes whatever v2
 * put there, every facet silently re-buckets, and `withinDays` rejects the
 * non-ISO value now in `row[1]` — so the whole corpus drops out of every
 * window and renders as „empty", at a 200.
 */
export const QUERY_VERSION = 1;

export interface StoryQuery {
  /** `"all"` means every category. */
  readonly category?: string;
  /** `"all"` means every outlet. */
  readonly domain?: string;
  /** Rolling window in days; `0` or absent means no window. */
  readonly days?: number;
  /**
   * ⚠️ CAPTURED ONCE PER BROWSE, never read from the clock per row. A rolling
   * window evaluated per row moves under the reader: page 2 is fetched a
   * minute later, the boundary has shifted, and a story either repeats or
   * disappears between pages.
   */
  readonly now: number;
}

export interface StoryQueryResult {
  /** Matching ids, in the index's own order. */
  readonly ids: readonly string[];
  /**
   * Matching ids as a set, for intersecting with an ordered index page —
   * which is what the `/stories` browse does (`storyBrowse.ts`). It is
   * built unconditionally because a `Set` over the matching ids is the same
   * pass that produces them; nothing is spent per render beyond the ids.
   */
  readonly match: ReadonlySet<string>;
  /**
   * Stories in the WHOLE CORPUS — not the number matching the query, which is
   * `ids.length`.
   *
   * ⚠️ NAMED `corpusTotal` RATHER THAN `total` BECAUSE `listState`'s `total`
   * parameter means the OTHER one. Identical names one autocomplete apart
   * would make an outlet page claim the corpus size as its own participation
   * count, and every assertion in the suite passed either way until
   * „reports the CORPUS total" was added.
   */
  readonly corpusTotal: number;
  /**
   * Facet counts UNDER THE OTHER ACTIVE FILTERS, so a chip's number is what
   * selecting it would actually show. Counting over the unfiltered corpus
   * instead is the same lie one level up: „Енергетика · 139" beside a 24h
   * window holding four.
   */
  readonly facets: {
    readonly categories: Readonly<Record<string, number>>;
    readonly domains: Readonly<Record<string, number>>;
  };
}

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * ⚠️⚠️ THE ZERO WINDOW MEANS OPPOSITE THINGS TO THE TWO CALLERS, WHICH IS WHY
 * IT IS AN ARGUMENT AND NOT A DEFAULT. A corpus query with no window wants
 * every story (`"all"`); the briefing's own filter wants nothing, because
 * there `days` is the window a reader picked and a zero is an absent choice
 * rather than „since the beginning" (`"none"`). These were two copies under a
 * comment claiming they were shared, diverging on exactly this — latent only
 * because `useUrlHomeFilters` clamps `days` to {1, 7, 30}, and a „всички"
 * option shipping as `days = 0` would empty the briefing while the chips
 * counted the whole corpus.
 *
 * ⚠️ A FUTURE TIMESTAMP IS REFUSED in both. A story stamped ahead of the
 * reader's clock is a source-data fault, and admitting it would let one
 * outlet's bad clock pin it to the top of every window.
 */
export const withinWindow = (
  iso: string | null | undefined,
  days: number,
  now: number,
  zeroWindow: "all" | "none",
): boolean => {
  if (!days || days <= 0) return zeroWindow === "all";
  if (!iso || !ISO_INSTANT.test(iso)) return false;
  const published = Date.parse(iso);
  if (!Number.isFinite(published)) return false;
  const age = now - published;
  return age >= 0 && age <= days * 86_400_000;
};

/** The corpus-query reading: no window means no restriction. */
export const withinDays = (iso: string, days: number, now: number): boolean =>
  withinWindow(iso, days, now, "all");

const matchesCategory = (row: FilterRow, category: string): boolean =>
  category === "all" || row[2].includes(category);

const matchesDomain = (row: FilterRow, domain: string): boolean =>
  domain === "all" || row[3].includes(domain);

/**
 * Run one query over the whole corpus.
 *
 * ⚠️ A FACET IS COUNTED WITH ITS OWN DIMENSION RELAXED. „Енергетика · 12"
 * must mean „12 stories if you pick Енергетика, keeping the window and outlet
 * you already chose" — so the category counts ignore the selected category and
 * the domain counts ignore the selected domain. Counting with every filter
 * applied makes every unselected chip read 0, which looks like an empty corpus
 * rather than an unselected option.
 */
export const queryStories = (
  index: FilterIndex | null | undefined,
  { category = "all", domain = "all", days = 0, now }: StoryQuery,
): StoryQueryResult => {
  const ids: string[] = [];
  const match = new Set<string>();
  const categories: Record<string, number> = {};
  const domains: Record<string, number> = {};
  for (const row of index?.stories ?? []) {
    const inWindow = withinDays(row[1], days, now);
    if (!inWindow) continue;
    const okCategory = matchesCategory(row, category);
    const okDomain = matchesDomain(row, domain);
    if (okDomain)
      for (const value of new Set(row[2]))
        categories[value] = (categories[value] ?? 0) + 1;
    if (okCategory)
      for (const value of new Set(row[3]))
        domains[value] = (domains[value] ?? 0) + 1;
    if (okCategory && okDomain) {
      ids.push(row[0]);
      match.add(row[0]);
    }
  }
  return {
    ids,
    match,
    corpusTotal: index?.total ?? 0,
    facets: { categories, domains },
  };
};

/**
 * What a text search could actually see. Rendered by the `/stories` browse;
 * `HomeScreen` reports its own scope in prose, because the briefing's search
 * has nothing to page.
 */
export interface SearchScope {
  /** How many stories the text query could actually see. */
  readonly searched: number;
  /** How many the structured query matched. */
  readonly of: number;
  /** True when every matching story was searched. */
  readonly complete: boolean;
}

export const normalizeQuery = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("bg-BG");

/**
 * Apply a text query to the rows the client has HYDRATED.
 *
 * ⚠️ RETURNS ITS SCOPE, and the caller must render it. „Няма резултати" over a
 * tenth of the corpus reads as „no such story exists"; the same emptiness with
 * „търсено в 150 от 2 314" reads as what it is. This is the whole difference
 * between narrowing a search and narrowing it silently.
 */
export const searchHydrated = <T>(
  rows: readonly T[],
  query: string,
  text: (row: T) => string,
  matchingTotal: number,
): { rows: readonly T[]; scope: SearchScope } => {
  const needle = normalizeQuery(query);
  const scope: SearchScope = {
    searched: rows.length,
    of: matchingTotal,
    complete: rows.length >= matchingTotal,
  };
  if (!needle) return { rows, scope };
  return {
    rows: rows.filter((row) => normalizeQuery(text(row)).includes(needle)),
    scope,
  };
};

/**
 * The identity of one browse snapshot, as a string.
 *
 * ⚠️ NOT CONSUMED BY `StoriesScreen` TODAY, and honestly so: the screen pins
 * its snapshot through the components named here — the window's anchor
 * (`usePinnedInstant`), the sort (a change starts a new prefix), the base
 * vintage (`staleVintage`) and the overlay (merged into prefix, match set
 * and counts together). This function is what a CURSOR would carry — a
 * „load more" URL, a Back-restorable position — the day one exists; a
 * cursor minted without the snapshot in it is the mixed-generation defect
 * T1.3 exists to prevent.
 *
 * ⚠️ A BROWSE IS PINNED TO ONE SNAPSHOT. A hot overlay can change the data
 * without changing `run_id`, so paging across a publish would otherwise mix
 * two generations — showing one story twice, or never. The key changes only
 * when something that can reorder or remove a row changes; when it does, the
 * caller starts a new browse rather than appending to the old one.
 */
export const browseKey = (parts: {
  runId: string | null | undefined;
  overlaySeq: number | null | undefined;
  asOf: string | null | undefined;
  queryVersion: number | null | undefined;
  query: StoryQuery;
  sort: string;
}): string =>
  [
    parts.runId ?? "",
    parts.overlaySeq ?? 0,
    parts.asOf ?? "",
    parts.queryVersion ?? 0,
    parts.sort,
    parts.query.category ?? "all",
    parts.query.domain ?? "all",
    parts.query.days ?? 0,
    // ⚠️ THE WINDOW'S ANCHOR, not the live clock: two browses of „24 часа"
    // started a minute apart are different result sets, and sharing a key
    // would append the second's page 2 to the first's page 1.
    parts.query.now,
  ].join(" ");

/**
 * Which of the five things a list is actually saying.
 *
 * ⚠️⚠️ „EMPTY" AND „LOADING" AND „FAILED" RENDERED IDENTICALLY BEFORE THIS,
 * as one silent empty list, and they are three different claims about the
 * world: „no such story exists", „we have not looked yet" and „we could not
 * look". Only the first is a finding; publishing it in place of the other two
 * is the wrong-answer-at-200 shape.
 *
 * ⚠️ AND „COMPLETE" IS A CLAIM TOO. „Показани са най-новите; може да има още"
 * printed under a list that WAS everything understates the corpus; the same
 * sentence under a partial list is the only thing keeping the count honest.
 * The two are distinguished by the global total, never by the prefix.
 */
export type ListState = "loading" | "failed" | "empty" | "partial" | "complete";

export const listState = ({
  revealed,
  total,
  hasMore,
  ready,
  error,
}: {
  /** Rows the reader can see right now. */
  readonly revealed: number;
  /** Rows matching the query in the WHOLE corpus. */
  readonly total: number;
  /** Whether the ordered index has pages left to reveal. */
  readonly hasMore: boolean;
  /** Whether the corpus-wide index has landed. */
  readonly ready: boolean;
  readonly error?: Error | null;
}): ListState => {
  // ⚠️ `error` BEFORE `ready`, and ONLY when there is nothing to fall back
  // on: a failed FIRST fetch leaves `total` at 0, which is shaped exactly
  // like an empty corpus. A failed REFRESH beside a last-good index still
  // knows the total, so it keeps answering — see the test of that name.
  if (error && !ready) return "failed";
  if (!ready) return "loading";
  if (total <= 0) return "empty";
  // Every page revealed IS the whole corpus, whatever the totals say: the
  // remaining difference is overlay drift, not stories behind a button.
  if (!hasMore || revealed >= total) return "complete";
  return "partial";
};
