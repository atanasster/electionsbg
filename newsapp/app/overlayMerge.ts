/**
 * Plan §4.6(b) — the client half of the base+overlay release (§6.5).
 *
 * An hourly ("cold") release is a full immutable tree. A fast ("hot")
 * release is the same tree plus one small object: the manifest keeps the
 * same `run_id`, so `dataCache.clear()` does not fire and the reader keeps
 * every base payload it already holds, paying one fetch for the overlay
 * instead of re-downloading ~2,100 files.
 *
 * ⚠️ THIS IS A SECOND IMPLEMENTATION OF A RULE THAT ALREADY EXISTS IN
 * PYTHON, AND THAT IS NOT A CHOICE. `news/scripts/overlay_merge.py` is the
 * specification — it is what the publisher verifies against a full rebuild
 * — and a route cannot import Python, exactly as `declared_label` and its
 * TS twin cannot share a definition. What keeps the two from drifting is
 * `news/eval_contract/overlay_vectors.json`: the Python test GENERATES it
 * from real builds and fails when the committed copy is stale;
 * `overlayMerge.test.ts` replays every vector through the functions below.
 * So neither side can change the rule alone.
 *
 * ⚠️ AND THE CLIENT'S MERGE IS DELIBERATELY WEAKER THAN THE PYTHON ONE.
 * The publisher holds a whole release; a browser holds whatever it has
 * fetched. Two consequences are load-bearing:
 *
 *   1. `stories/index-N.json` and `stories/ranked-N.json` are NOT merged
 *      here. The index is a
 *      newest-first pagination over the whole corpus, so one story moving
 *      to the front shifts every page after it — a page merged in
 *      isolation duplicates or drops stories at its own boundary, and its
 *      `total` is recomputed so nothing looks wrong. `useStoryList` merges
 *      the accumulated PREFIX instead, where the arithmetic is sound.
 *   2. A page fetched from the base AFTER an overlay landed can still hold
 *      a row the overlay already moved, so the accumulator dedupes by id
 *      on every append rather than only at merge time.
 */

/** One published path's payload, merged or passed through. */
type Payload = Record<string, unknown>;

export const OVERLAY_SCHEMA_VERSION = 1;

export interface NewsOverlay {
  schema_version: number;
  seq: number;
  base_run_id: string;
  generated_at: string;
  release_generated_at: string;
  latest_limit: number;
  articles: Record<string, Payload[]>;
  removed_article_urls: Record<string, string[]>;
  removed_domains: string[];
  bundle_envelopes: Record<string, Payload>;
  story_details: Record<string, Payload>;
  removed_story_ids: string[];
  home: Payload | null;
  replaced_paths: Record<string, Payload>;
  removed_paths: string[];
}

/** The overlay pointer the manifest carries; the object itself is immutable. */
export interface NewsOverlayPointer {
  seq: number;
  path: string;
  bytes: number;
  sha256: string;
  base_generated_at: string;
}

const isObject = (value: unknown): value is Payload =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isPayloadMap = (value: unknown): value is Record<string, Payload> =>
  isObject(value) && Object.values(value).every(isObject);

/**
 * ⚠️ FAIL CLOSED. An overlay the client does not fully understand must not
 * be half-applied: the unknown arms would simply be skipped, every path
 * would still parse, and the reader would be shown a release nobody built.
 * There is no degrade here on purpose — a caller that cannot parse an
 * overlay stays on the base, which is a real, complete, immutable release.
 */
export const parseOverlay = (value: unknown): NewsOverlay => {
  if (!isObject(value)) throw new Error("overlay: root must be an object");
  const row = value;
  const articlesOk =
    isObject(row.articles) &&
    Object.values(row.articles).every(
      (records) => Array.isArray(records) && records.every(isObject),
    );
  const removedUrlsOk =
    isObject(row.removed_article_urls) &&
    Object.values(row.removed_article_urls).every(isStringArray);
  if (
    row.schema_version !== OVERLAY_SCHEMA_VERSION ||
    !Number.isInteger(row.seq) ||
    (row.seq as number) < 1 ||
    typeof row.base_run_id !== "string" ||
    typeof row.generated_at !== "string" ||
    typeof row.release_generated_at !== "string" ||
    !Number.isInteger(row.latest_limit) ||
    (row.latest_limit as number) < 1 ||
    !articlesOk ||
    !removedUrlsOk ||
    !isStringArray(row.removed_domains) ||
    !isPayloadMap(row.bundle_envelopes) ||
    !isPayloadMap(row.story_details) ||
    !isStringArray(row.removed_story_ids) ||
    !(row.home === null || isObject(row.home)) ||
    !isPayloadMap(row.replaced_paths) ||
    !isStringArray(row.removed_paths)
  ) {
    throw new Error("overlay: invalid or unsupported shape");
  }
  return row as unknown as NewsOverlay;
};

// --------------------------------------------------------------------------
// The published sort order. One rule, two languages — `article_sort_key` and
// `story_sort_key` in build_app_data.py are the originals.
//
// ⚠️ THE TIEBREAK IS THE LOAD-BEARING HALF. Without it, records sharing a
// timestamp keep whatever order they arrived in, which differs between a
// merge and a rebuild — so a hot release would quietly reorder the feed
// relative to the hourly one it claims to extend.
// --------------------------------------------------------------------------

// ⚠️ `<` on a JS string compares UTF-16 CODE UNITS while Python compares
// CODE POINTS, so the two twins order differently for astral-plane
// characters (emoji, some historic scripts) — a real difference, not a
// theoretical one, and the vectors cannot see it because no fixture
// carries such a character. It is confined to TIES: both keys start with
// an ISO timestamp, and the second element only decides between records
// published in the same second. Story ids are `[A-Za-z0-9_-]` by
// construction, so only a URL could reach it.
const compareDesc = (a: [string, string], b: [string, string]): number =>
  a[0] === b[0]
    ? a[1] < b[1]
      ? 1
      : a[1] > b[1]
        ? -1
        : 0
    : a[0] < b[0]
      ? 1
      : -1;

const articleKey = (record: Payload): [string, string] => [
  typeof record.published === "string" ? record.published : "",
  typeof record.url === "string" ? record.url : "",
];

const storyKey = (row: Payload): [string, string] => [
  typeof row.last_published === "string" ? row.last_published : "",
  typeof row.id === "string" ? row.id : "",
];

/**
 * A story's published sort position, as one comparable string.
 *
 * Exported for `useStoryList`, which has to decide whether an overlay's
 * story falls inside the prefix it has revealed — a comparison, not a
 * sort. Built from the same key so the two cannot disagree about order.
 */
export const storyRowKey = (row: Payload): string =>
  storyKey(row).join("\u0000");

/** Newest first, ties broken by id — the published order. */
export const compareStoryRows = (a: Payload, b: Payload): number =>
  compareDesc(storyKey(a), storyKey(b));

const prominenceScore = (row: Payload): number => {
  const block = row.prominence;
  const score =
    block && typeof block === "object"
      ? (block as { score?: unknown }).score
      : undefined;
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
};

/**
 * The `ranked-N` order: `score DESC, last_published DESC, id ASC`.
 *
 * ⚠️ A TWIN OF `merge_story_index`'s prominence sort in overlay_merge.py,
 * and of the three stable passes in `build_app_data.write_story_pages`. A
 * row with no `prominence` block scores 0 — the same default the publisher
 * uses — so it sorts last, after every scored row, rather than throwing
 * the browse for a row an older overlay projected without the field.
 *
 * ⚠️ THE SCORES ARE THE ROWS' OWN, never recomputed here. Prominence decays
 * with the instant it was scored against and the client cannot re-score
 * the corpus; a merged ranked prefix is therefore `stale_ranking` in the
 * publisher's sense, and the screen says so rather than hiding it.
 */
export const compareRankedRows = (a: Payload, b: Payload): number => {
  const sa = prominenceScore(a);
  const sb = prominenceScore(b);
  if (sa !== sb) return sb - sa;
  const [da, ia] = storyKey(a);
  const [db, ib] = storyKey(b);
  if (da !== db) return da < db ? 1 : -1;
  // ⚠️ id ASCENDING — the opposite of the `latest` tiebreak. The publisher's
  // three stable passes sort ids ascending first; `story_sort_key` under
  // `reverse=True` sorts them descending. Two stories tied on score and
  // date would otherwise swap places between the page and a merged prefix.
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};

/** `base` with `incoming` applied by `key`, and `removed` keys dropped. */
export const upsert = (
  base: Payload[],
  incoming: Payload[],
  key: (row: Payload) => string | undefined,
  removed: Iterable<string> = [],
): Payload[] => {
  const gone = new Set(removed);
  const byKey = new Map<string, Payload>();
  for (const row of incoming) {
    const k = key(row);
    if (k !== undefined) byKey.set(k, row);
  }
  const out: Payload[] = [];
  const seen = new Set<string>();
  for (const row of base) {
    const k = key(row);
    if (k !== undefined && gone.has(k)) continue;
    const replacement = k === undefined ? undefined : byKey.get(k);
    if (k !== undefined && replacement) {
      out.push(replacement);
      seen.add(k);
    } else {
      out.push(row);
    }
  }
  for (const row of incoming) {
    const k = key(row);
    if (k === undefined || seen.has(k) || gone.has(k)) continue;
    out.push(row);
    seen.add(k);
  }
  return out;
};

const urlOf = (record: Payload) =>
  typeof record.url === "string" ? record.url : undefined;
const idOf = (row: Payload) =>
  typeof row.id === "string" ? row.id : undefined;

/**
 * The feed's own field set — the builder drops these, so the merge must
 * too. ⚠️ Kept in step by the shared vectors: the overlay carries BUNDLE
 * records, which are wider, and publishing them unnarrowed re-inflates by
 * ~25% the one object every page downloads before it can paint.
 */
const FEED_OMIT = new Set([
  "section_path",
  "image_alt",
  "first_seen",
  "keywords",
]);

export const mergeLatest = (base: Payload, overlay: NewsOverlay): Payload => {
  const delta = Object.values(overlay.articles)
    .flat()
    .map((record) =>
      Object.fromEntries(
        Object.entries(record).filter(([field]) => !FEED_OMIT.has(field)),
      ),
    );
  const removed = Object.values(overlay.removed_article_urls).flat();
  const merged = upsert(
    (base.articles as Payload[]) ?? [],
    delta,
    urlOf,
    removed,
  )
    .filter((record) => Boolean(record.published))
    .sort((a, b) => compareDesc(articleKey(a), articleKey(b)))
    .slice(0, overlay.latest_limit);
  return {
    ...base,
    generated_at: overlay.release_generated_at,
    articles: merged,
  };
};

export const mergeArticlesBundle = (
  base: Payload,
  domain: string,
  overlay: NewsOverlay,
): Payload => {
  const merged = upsert(
    (base.articles as Payload[]) ?? [],
    overlay.articles[domain] ?? [],
    urlOf,
    overlay.removed_article_urls[domain] ?? [],
  ).sort((a, b) => compareDesc(articleKey(a), articleKey(b)));
  return {
    ...base,
    ...(overlay.bundle_envelopes[domain] ?? {}),
    articles: merged,
  };
};

/** The changed story OBJECTS, derived from the changed detail files. */
export const overlayStories = (overlay: NewsOverlay): Payload[] =>
  Object.keys(overlay.story_details)
    .sort()
    .map((id) => overlay.story_details[id].story)
    .filter(isObject);

export const mergeStories = (base: Payload, overlay: NewsOverlay): Payload => {
  const merged = upsert(
    (base.stories as Payload[]) ?? [],
    overlayStories(overlay),
    idOf,
    overlay.removed_story_ids,
  ).sort((a, b) => compareDesc(storyKey(a), storyKey(b)));
  return {
    ...base,
    generated_at: overlay.release_generated_at,
    stories: merged,
  };
};

/**
 * ⚠️ REBUILT per touched story, never patched. When two stories merge their
 * members move, and a dict update leaves the moved urls resolving to a
 * story that no longer contains them — ArticleScreen then fetches a detail
 * file without the article the reader is standing on.
 */
export const mergeStoriesByUrl = (
  base: Payload,
  overlay: NewsOverlay,
): Payload => {
  const stories = overlayStories(overlay);
  const touched = new Set<string>(overlay.removed_story_ids);
  for (const story of stories) {
    const id = idOf(story);
    if (id) touched.add(id);
  }
  const source = (base.stories_by_url as Record<string, string>) ?? {};
  const out: Record<string, string> = {};
  for (const [url, id] of Object.entries(source)) {
    if (!touched.has(id)) out[url] = id;
  }
  for (const story of stories) {
    const id = idOf(story);
    if (!id) continue;
    for (const member of (story.members as Payload[]) ?? []) {
      if (isObject(member) && typeof member.url === "string") {
        out[member.url] = id;
      }
    }
  }
  return {
    ...base,
    generated_at: overlay.release_generated_at,
    stories_by_url: Object.fromEntries(
      Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
};

/**
 * One story as the paginated index carries it.
 *
 * ⚠️ A TWIN OF `story_index_row` IN build_app_data.py, PINNED BY THE
 * VECTORS. It decides which fields a list screen gets, so a client that
 * projected differently would publish rows of a different shape for
 * exactly the stories a hot release touched — a card missing its outlet
 * chips, beside identical-looking ones from the hourly tree. This was a
 * caller-supplied callback until the vectors made it checkable.
 */
export const storyIndexRow = (story: Payload): Payload => {
  const row: Payload = {};
  for (const field of [
    "id",
    "title_bg",
    "title_en",
    "topics",
    "first_published",
    "last_published",
    "blindspot",
    // The T3.3 case membership, stamped by `build_app_data` from the case
    // registry — carried so a list row CAN render or filter on it (today
    // only `StoryScreen` renders the „Казус" chip).
    "case_ids",
    // ⚠️ COPIED, NEVER COMPUTED HERE. Prominence decays with the instant it
    // was scored against, so a second implementation in another language
    // would drift the moment either clock or constant moved — and the
    // symptom would be two rows of one list disagreeing about one story.
    // `build_app_data` stamps it onto the story object the detail file
    // carries, which is exactly the object an overlay ships.
    "prominence",
  ]) {
    if (field in story) row[field] = story[field];
  }
  const members = ((story.members as unknown[]) ?? []).filter(isObject);
  row.member_count = members.length;
  row.domains = [
    ...new Set(
      members
        .map((member) => member.domain)
        .filter((domain): domain is string => typeof domain === "string"),
    ),
  ].sort();
  return row;
};

/**
 * Story index rows, newest first — the accumulated PREFIX, not a page.
 *
 * `include` decides which of the overlay's stories belong in this prefix
 * at all. ⚠️ Without it every touched story is injected, including ones
 * that sort far BELOW the rows the reader has revealed: a story updated
 * on page 5 would appear at the bottom of a two-page prefix, ahead of the
 * six hundred stories that really belong between. The caller knows where
 * its prefix ends; this does not.
 */
export const mergeStoryIndexRows = (
  rows: Payload[],
  overlay: NewsOverlay,
  include: (story: Payload) => boolean = () => true,
  // ⚠️ THE ORDER IS THE CALLER'S, because the same prefix merge serves both
  // orderings: `index-N` sorts by publication, `ranked-N` by prominence, and
  // a merged prefix re-sorted by the wrong key would put a hot story at the
  // top of a ranked list on the strength of its date alone.
  compare: (a: Payload, b: Payload) => number = compareStoryRows,
): Payload[] =>
  upsert(
    rows,
    overlayStories(overlay).filter(include).map(storyIndexRow),
    idOf,
    overlay.removed_story_ids,
  ).sort(compare);

/**
 * ⚠️ THE ONE STORY-ID CHARSET ON THIS SIDE. A story id reaches a URL PATH,
 * so a client that accepted anything else would be building a request out
 * of data; `build_app_data.py`'s `STORY_ID_SAFE` is the producer's own
 * copy and these two must agree. `data.ts` imports this rather than
 * declaring a third.
 */
export const STORY_ID_SAFE = /^[A-Za-z0-9_-]{1,120}$/;

const STORY_DETAIL = new RegExp(
  `^/stories/(${STORY_ID_SAFE.source.slice(1, -1)})\\.json$`,
);
// ⚠️ BOTH ORDERINGS. `ranked-N` is the same pagination over the same corpus,
// ordered by prominence instead of recency, so it is meaningful only beside
// its neighbours for exactly the reason below — and its rank decays with the
// instant it was scored against, which a client cannot recompute at all.
const STORY_INDEX_PAGE = /^\/stories\/(?:index|ranked)-\d+\.json$/;
const WHOLE_STORY_FILES = new Set([
  "/stories/filter-index.json",
  "/stories/retired.json",
]);
const ARTICLES_BUNDLE = /^\/articles\/(.+)\.json$/;

/**
 * Thrown when the overlay retires a path the caller asked for. Handled as a
 * miss rather than an error by the data client — the file is genuinely gone
 * from this release, which is what a 404 on the next cold tree will say too.
 */
export class OverlayRemovedPath extends Error {}

/**
 * Apply `overlay` to one published path's base payload.
 *
 * `path` may be given with or without a leading slash; both name the same
 * published file, and the arms below are compared against ONE normalised
 * form. Before that they were not: `removed_paths` and `replaced_paths`
 * were looked up slash-stripped while every other arm compared the raw
 * string, so a caller passing `latest.json` got its base back unmerged.
 *
 * Returns the merged payload, the base unchanged when the overlay does not
 * touch this path, or THROWS `OverlayRemovedPath` when the release retires
 * it — a retired path is a miss, not an error, and the caller treats it as
 * the 404 the next cold tree will give.
 *
 * ⚠️ `stories/index-N.json` and `stories/ranked-N.json` are ALWAYS returned
 * unchanged, ahead of every
 * other arm including `replaced_paths`. The index is a pagination over the
 * whole corpus, so a page is only meaningful beside its neighbours: the
 * overlay legitimately carries whole index pages when the page COUNT
 * moves, and handing one of those to a client that has merged its own
 * accumulated prefix applies the same change twice. `useStoryList` owns
 * the index; this function must not have an opinion about it.
 */
export const applyOverlayToPath = (
  path: string,
  base: unknown,
  overlay: NewsOverlay,
): unknown => {
  const key = path.replace(/^\//, "");
  const slashed = `/${key}`;

  if (STORY_INDEX_PAGE.test(slashed)) return base;
  // A retired path is a miss whatever kind of file it was — checked before
  // the whole-file arm so the two mergers agree on it (Python pops it).
  if (overlay.removed_paths.includes(key)) {
    throw new OverlayRemovedPath(slashed);
  }
  // ⚠️ NAMED, NOT LEFT TO ARM ORDER. `filter-index` and `retired` both
  // match `STORY_ID_SAFE`, so without this they reach the story-detail arm
  // and are correct only by where that arm happens to sit — which this file
  // calls a correctness rule elsewhere. Both are whole files the publisher
  // carries whole (`WHOLE_STORY_FILES` in overlay_merge.py); the client
  // takes whatever `replaced_paths` gave it.
  if (WHOLE_STORY_FILES.has(slashed))
    return (overlay.replaced_paths ?? {})[key] ?? base;
  const replaced = overlay.replaced_paths[key];
  if (replaced !== undefined) return replaced;

  // ⚠️ THE NAMED FILE UNDER `stories/` COMES FIRST, and the order is a
  // correctness rule rather than style. A story id may contain a hyphen,
  // so `stories/by-url.json` also matches the detail pattern below —
  // reached first, it resolves to a story called "by-url" that no release
  // holds, `story_details` misses, and the base is returned unchanged. The
  // url map then keeps pointing articles at a story the release retired,
  // and the reader lands on a detail file that does not contain the
  // article they are standing on. Caught by the shared vectors, which is
  // the only reason this was not shipped.
  if (slashed === "/stories/by-url.json") {
    return isObject(base) ? mergeStoriesByUrl(base, overlay) : base;
  }

  const detail = STORY_DETAIL.exec(slashed);
  if (detail) {
    const id = detail[1];
    if (overlay.removed_story_ids.includes(id)) {
      throw new OverlayRemovedPath(slashed);
    }
    return overlay.story_details[id] ?? base;
  }
  // ⚠️ BEFORE the `isObject(base)` guard, because a bundle's base may
  // legitimately be ABSENT: an outlet appearing for the first time in this
  // release has no file in the base tree, so the reader's fetch of it
  // 404s. The overlay carries that outlet's whole record set and envelope,
  // so the merge starts from an empty bundle rather than giving up — and
  // the caller is expected to treat a missing base here as empty, not as
  // an error. Without this the first release covering a new outlet renders
  // that outlet's page as broken until the next hourly tree.
  const bundle = ARTICLES_BUNDLE.exec(slashed);
  if (bundle) {
    const domain = bundle[1];
    if (overlay.removed_domains.includes(domain)) {
      throw new OverlayRemovedPath(slashed);
    }
    return mergeArticlesBundle(
      isObject(base) ? base : { articles: [] },
      domain,
      overlay,
    );
  }

  if (!isObject(base)) return base;
  if (slashed === "/latest.json") return mergeLatest(base, overlay);
  if (slashed === "/stories.json") return mergeStories(base, overlay);
  if (slashed === "/home.json") return overlay.home ?? base;
  return base;
};
