// The contracts the global home dashboard is built on — shared by the browser and by the
// generators under scripts/db/gen_home/.
//
// ⚠️ DELIBERATELY IMPORT-FREE. A generator runs in Node and a hook runs in the browser, so a
// single React or `node:` import here would break one of the two callers. Same rule, and the
// same reason, as src/locales/bundles.ts.
//
// ⚠️ EVERY ENUM HERE IS DECLARED AS AN ARRAY AND THE UNION IS DERIVED FROM IT, never the
// other way round. Written union-first, the array needs a `readonly X[]` annotation, which
// throws away what `as const` would have given and makes the guard ONE-directional: a bad
// member in the array is a compile error, while a member added to the UNION and forgotten in
// the array is silent — and the array is what the runtime guards and the data gates iterate,
// so the forgotten member is exactly the one nothing checks.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §5.1 and §6.1.

// ---------------------------------------------------------------------------
// Head figures
// ---------------------------------------------------------------------------

/** How prominently elections are promoted, derived by the generator from the canonical
 *  election registry's STATUS rather than from the calendar alone — an unknown status falls
 *  back to `standard` rather than guessing. Plan §4.3. */
export const HOME_MODES = [
  "standard",
  "election_upcoming",
  "election_live",
  "election_recent",
] as const;

export type HomeMode = (typeof HOME_MODES)[number];

/**
 * The four national pulse figures.
 *
 * ⚠️ `inflation_hicp`, NEVER `inflation_cpi` — and the collision is real rather than
 * stylistic. In this corpus `cpi` already names something else entirely:
 * `macro.indicators.cpi` is Transparency International's **Corruption** Perceptions Index
 * („Корупционен индекс") and `macro.series.cpi` is its 0–100 score. The figure here is
 * Eurostat HICP (`prc_hicp_minr`), which is neither that nor the НСИ national CPI.
 * `homeFigureIdIsHonest()` below is the gate.
 */
export const HOME_FIGURE_IDS = [
  "gdp_growth",
  // NEVER "inflation_cpi" — see the note above.
  "inflation_hicp",
  "unemployment_sa",
  "government_debt_gdp",
] as const;

export type HomeFigureId = (typeof HOME_FIGURE_IDS)[number];

/**
 * A figure id may not claim to be a CPI.
 *
 * Exported rather than inlined into the data test because the same check has to run on both
 * sides — the generator refuses to emit such an id, and the gate refuses to accept one — and
 * a rule copied into two files is a rule that drifts.
 */
export const homeFigureIdIsHonest = (id: string): boolean =>
  !/(^|_)cpi(_|$)/i.test(id);

export type HomeFrequency = "monthly" | "quarterly" | "annual" | "snapshot";
export type HomeUnit = "pct" | "pct_gdp" | "eur" | "count" | "date";
export type HomeAdjustment = "seasonally_adjusted" | "unadjusted";
export type HomeComparison = "yoy" | "qoq" | "level" | "snapshot";

export type HomeBasis = {
  /** The source's own period label — "2026-Q2", "2026-07". Never a rendered date. */
  period: string;
  frequency: HomeFrequency;
  unit: HomeUnit;
  adjustment?: HomeAdjustment;
  comparison?: HomeComparison;
};

export type HomeFigure = {
  id: HomeFigureId;
  value: number;
  basis: HomeBasis;
  /** Key into `HomeHubStatsV1.sources`. */
  sourceId: string;
};

/**
 * ⚠️ A FIGURE CARRIES NO DESTINATION, AND THAT IS DELIBERATE. It used to hold a `to`, written
 * by the generator from a hardcoded `/indicators/economy` — a FOURTH restatement of a map
 * `indicatorsRegistry.ts` already owns, and one that silently dropped the per-indicator anchor
 * the other three consumers carry. `IndicatorsLandingScreen`'s own comment names the failure:
 * „a template of `/indicators/${entry.domain}` restates the map and silently drops the
 * per-indicator anchor some entries carry".
 *
 * A stored href is also a COPY that goes stale: rename a section anchor and every published
 * artifact keeps linking to a hash that matches nothing, with nothing failing. Resolved at
 * render time (`homeFigures.ts` → `homeFigureHref`) the link is a function of code, so a
 * renamed anchor is a red test rather than a dead scroll.
 */

/**
 * A basis key is an i18n KEY, never a sentence.
 *
 * Same reason `homeFigureIdIsHonest` exists: a rule stated only in a comment is a rule the
 * generator can violate. Prose in this field renders as prose in the language it was written
 * in and as a raw identifier in the other — the silent half-translated failure
 * `src/locales/bundles.ts` is written around.
 */
export const isHomeBasisKey = (key: string): boolean =>
  /^home_basis_[a-z0-9_]+$/.test(key);

export type HomeTileMetric = {
  tileId: string;
  value: number;
  unit: HomeUnit;
  /** An ENUM KEY, not prose — `isHomeBasisKey()` is the gate; the locale bundle turns it
   *  into a caption. */
  basisKey: string;
  period?: string;
  to: string;
  sourceId: string;
  /** A forced scope the destination must open on, e.g. "all" for procurement. */
  scope?: string;
};

export type HomeSource = {
  available: boolean;
  /** The source's own vintage, not the run time. */
  asOf?: string;
  sourceUrl?: string;
  datasetCode?: string;
};

export type HomeHubStatsV1 = {
  schemaVersion: 1;
  /** ⚠️ The maximum meaningful SOURCE vintage in this artifact — never `new Date()`. Two
   *  rebuilds of the same corpus must be byte-identical (plan §12.3). */
  computedAt: string;
  homeMode: HomeMode;
  figures: HomeFigure[];
  tiles: Partial<Record<string, HomeTileMetric>>;
  /** ⚠️ `Partial`, like `tiles`. `HomeFigure.sourceId` is an open string key into this map,
   *  so a plain `Record` lets `sources[fig.sourceId].available` type-check and throw on a
   *  dangling id — and the missing-source case is the one `HOME_STATS_PARTIAL_FIXTURE`
   *  exists to represent. The compiler should be nudging consumers toward it, not hiding it. */
  sources: Partial<Record<string, HomeSource>>;
};

// ---------------------------------------------------------------------------
// The change feed
// ---------------------------------------------------------------------------

export const HOME_EVENT_CATEGORIES = [
  "prices",
  "local",
  "procurement",
  "funds",
  "budget_debt",
  "parliament_elections",
] as const;

export type HomeEventCategory = (typeof HOME_EVENT_CATEGORIES)[number];

/**
 * Which date a row is presenting, so the renderer can label it truthfully.
 *
 * `first_seen` is the weakest and means „we found this on that day" — copy for such a row
 * says found/added, never happened. `effective` covers a date that is real but not a day
 * anything occurred (a programme year, a budget taking force).
 */
export const HOME_DATE_BASES = [
  "occurred",
  "published",
  "effective",
  "deadline",
  "first_seen",
] as const;

export type HomeDateBasis = (typeof HOME_DATE_BASES)[number];

export type HomeVerification = "automatic" | "editorial_review";

export type HomeScopeLevel = "national" | "oblast" | "municipality";

export type HomeEventV1 = {
  schemaVersion: 1;
  /** Stable across rebuilds: source kind + source record identity + the transition. ⚠️ It
   *  must not contain ingestion time, or every rebuild mints a new row. */
  id: string;
  kind: string;
  category: HomeEventCategory;
  occurredAt?: string;
  publishedAt?: string;
  effectiveAt?: string;
  deadlineAt?: string;
  firstSeenAt: string;
  /** Which of the above the renderer is showing. */
  dateBasis: HomeDateBasis;
  scope: { level: HomeScopeLevel; id?: string };
  source: { id: string; url?: string; labelKey: string };
  coverage: { complete: boolean; noteKey?: string };
  route: string;
  /** A locale key plus its arguments — never a rendered sentence. */
  factKey: string;
  factArgs: Record<string, string | number>;
  backfill: boolean;
  verification: HomeVerification;
  materiality: number;
  actionability: number;
};

export type HomeFeedV1 = {
  schemaVersion: 1;
  /** ⚠️ `max(source date)`, and the window below ENDS here — never `now`. A window anchored
   *  on the calendar slides daily with no source change, which breaks the byte-identical
   *  rebuild gate and hides a stalled pipeline behind a moving horizon. Plan §6.6. */
  computedAt: string;
  windowDays: number;
  events: HomeEventV1[];
  sourceCoverage: Partial<
    Record<
      string,
      {
        available: boolean;
        /** How current this family IS — its STALEST arm when it reads several snapshots. */
        asOf?: string;
        /**
         * When we last OBSERVED the source, for the families that have such a clock (a crawl
         * timestamp, a corpus day, a publisher's release stamp).
         *
         * ⚠️ THIS IS WHAT `computedAt` IS FOLDED FROM, and it is recorded so that fold is
         * auditable from the artifact alone. An observation cannot be in the future; an event
         * date can, and taking the plain maximum over event dates let one row dated three
         * months out drag the whole window with it.
         */
        observedAt?: string;
        /**
         * How far `asOf` may fall behind the artifact's `computedAt` before this family counts
         * as stale — the source's declared cadence, carried so a consumer can say „behind"
         * without hard-coding an expectation of its own.
         *
         * ⚠️ ABSENT MEANS „HAS NO CADENCE", NOT „IS FINE". Elections are 539 days apart; a
         * ceiling loose enough for them would detect nothing.
         */
        staleAfterDays?: number;
        /** True when `asOf` is behind `computedAt` by more than `staleAfterDays`. */
        stale?: boolean;
      }
    >
  >;
};

/**
 * Field names that must NEVER appear on a stored event.
 *
 * Each is a function of the reader's clock, so freezing one into a published artifact is the
 * defect `open_calls` (migration 142) exists to prevent, one layer up: that table stores no
 * status because a status frozen at crawl time shows expired calls as open all weekend after
 * a Friday failure. `deadlineAt` is stored; "closes in 3 days" is rendered.
 *
 * Exported so the generator can refuse and the data gate can assert over the same list.
 */
export const NOW_RELATIVE_FIELD_NAMES: readonly string[] = [
  "daysLeft",
  "daysAgo",
  "daysUntil",
  "isOpen",
  "isClosed",
  "isRecent",
  "isExpired",
  "closingSoon",
  "closesIn",
  "opensIn",
  "age",
  "ageDays",
  "timeLeft",
  "remainingDays",
] as const;

/** Every now-relative key present on `value`, at any depth. Empty means the object is safe to
 *  publish. Used by the generator (to refuse) and by the data gate (to assert). */
export const findNowRelativeFields = (value: unknown): string[] => {
  const hits = new Set<string>();
  const banned = new Set(NOW_RELATIVE_FIELD_NAMES);
  // A `seen` set, because this runs on the GENERATOR's in-memory object before serialisation,
  // not only on parsed JSON. Parsed JSON cannot carry a cycle; a half-built artifact holding a
  // back-reference can, and without this the walk does not return — it throws
  // `Maximum call stack size exceeded` from inside a validator whose whole job is to refuse
  // cleanly. It also collapses a heavily shared subtree to one visit.
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (banned.has(key)) hits.add(key);
      walk(child);
    }
  };
  walk(value);
  return [...hits].sort();
};
