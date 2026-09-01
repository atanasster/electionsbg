// Shared fixtures for the home dashboard's four awkward states, so the screen tests, the
// hook tests and the generator gates all reason about the SAME objects.
//
// The four are the ones the plan names because each renders as something plausible when it is
// handled wrongly (docs/plans/home-dashboard-implementation-v1.md, Phase 0 item 5):
//
//   date basis   — a row whose only date is `firstSeenAt` must read „found on", not „happened
//                  on". Both shapes are here so a renderer test can prove it distinguishes.
//   backfill     — a bulk load must collapse into one labelled corpus-update row rather than
//                  becoming hundreds of „new today" items.
//   missing      — an unavailable source is ABSENT, never `0`. A zero is a claim.
//   unknown kind — a kind with no adapter/renderer must fail loudly in the gate rather than
//                  render as a blank card.
//
// ⚠️ TEST-ONLY, and under `__fixtures__/` for two mechanical reasons rather than by taste.
// `vitest.config.ts` excludes `**/__fixtures__/**` from coverage, so outside this directory
// the file counts as production code in the report; and the path is what marks it non-shipping
// at a glance, since NOTHING else would catch an import of it — `src/entryGraph.test.ts`
// derives its forbidden set from two sector registries and has no fixture awareness at all.
// An earlier header claimed that gate would fail on such an import. It would not.
//
// A `__fixtures__` directory is an ordinary importable path, so the `scripts/db/tests/*.data.test.ts`
// consumers reach it through the `@/` alias like any other module.

import type {
  HomeEventV1,
  HomeFeedV1,
  HomeFigure,
  HomeHubStatsV1,
} from "../homeTypes";

const iso = (day: string): string => `${day}T00:00:00.000Z`;

/** A complete four-figure band. Values are illustrative, but every BASIS is copied from the
 *  real selectors in §5.2 so a formatting test cannot pass on a shape the generator never
 *  emits. */
export const HOME_FIGURES_FIXTURE: HomeFigure[] = [
  {
    id: "gdp_growth",
    value: 2.7,
    basis: {
      period: "2026-Q2",
      frequency: "quarterly",
      unit: "pct",
      adjustment: "seasonally_adjusted",
      comparison: "yoy",
    },
    sourceId: "eurostat_namq_10_gdp",
  },
  {
    id: "inflation_hicp",
    value: 4.4,
    basis: {
      period: "2026-07",
      frequency: "monthly",
      unit: "pct",
      adjustment: "unadjusted",
      comparison: "yoy",
    },
    sourceId: "eurostat_prc_hicp_minr",
  },
  {
    id: "unemployment_sa",
    value: 3,
    basis: {
      period: "2026-06",
      frequency: "monthly",
      unit: "pct",
      adjustment: "seasonally_adjusted",
      comparison: "level",
    },
    sourceId: "eurostat_une_rt_m",
  },
  {
    id: "government_debt_gdp",
    value: 28.5,
    basis: {
      period: "2026-Q1",
      frequency: "quarterly",
      unit: "pct_gdp",
      comparison: "snapshot",
    },
    sourceId: "eurostat_gov_10q_ggdebt",
  },
];

export const HOME_STATS_FIXTURE: HomeHubStatsV1 = {
  schemaVersion: 1,
  computedAt: iso("2026-07-31"),
  homeMode: "standard",
  figures: HOME_FIGURES_FIXTURE,
  tiles: {},
  sources: {
    eurostat_namq_10_gdp: { available: true, asOf: "2026-Q2" },
    eurostat_prc_hicp_minr: { available: true, asOf: "2026-07" },
    eurostat_une_rt_m: { available: true, asOf: "2026-06" },
    eurostat_gov_10q_ggdebt: { available: true, asOf: "2026-Q1" },
  },
};

/**
 * THE MISSING-SOURCE STATE. One indicator is unavailable, so its figure is ABSENT from
 * `figures` and its source says so — it is not present with `value: 0`.
 *
 * ⚠️ A renderer test must assert THREE cells and a disclosed partial state, never four cells
 * one of which reads „0%". „Inflation is zero" and „we could not read the inflation series"
 * are different claims and only the second is true.
 */
export const HOME_STATS_PARTIAL_FIXTURE: HomeHubStatsV1 = {
  ...HOME_STATS_FIXTURE,
  figures: HOME_FIGURES_FIXTURE.filter((f) => f.id !== "inflation_hicp"),
  sources: {
    ...HOME_STATS_FIXTURE.sources,
    eurostat_prc_hicp_minr: { available: false },
  },
};

const baseEvent: Omit<HomeEventV1, "id" | "kind" | "dateBasis" | "factKey"> = {
  schemaVersion: 1,
  category: "procurement",
  firstSeenAt: iso("2026-07-30"),
  scope: { level: "national" },
  source: { id: "aop", labelKey: "home_source_aop" },
  coverage: { complete: true },
  route: "/procurement/contracts",
  factArgs: {},
  backfill: false,
  verification: "automatic",
  materiality: 0.5,
  actionability: 0.5,
};

/** A row with a REAL occurrence date. Copy may say „happened on". */
export const HOME_EVENT_OCCURRED_FIXTURE: HomeEventV1 = {
  ...baseEvent,
  id: "procurement:contract:abc123:awarded",
  kind: "contract_awarded",
  occurredAt: iso("2026-07-28"),
  dateBasis: "occurred",
  factKey: "home_fact_contract_awarded",
  factArgs: { buyer: "Агенция „Пътна инфраструктура“", amountEur: 1250000 },
};

/**
 * A row whose ONLY date is `firstSeenAt`.
 *
 * ⚠️ The renderer must label this „found in the data on …", never „happened on …". The two
 * fixtures are otherwise the same shape on purpose: a test that passes on both without
 * distinguishing them is not testing the date basis at all.
 */
export const HOME_EVENT_FIRST_SEEN_FIXTURE: HomeEventV1 = {
  ...baseEvent,
  id: "funds:call:BG16RFOP002-1.001:seen",
  kind: "call_opened",
  category: "funds",
  route: "/funds/calls",
  dateBasis: "first_seen",
  factKey: "home_fact_call_opened",
  factArgs: { programme: "Иновации и конкурентоспособност" },
};

/** A bulk load, collapsed. `materiality` is deliberately low so the ranking's backfill
 *  penalty has something to bite on, and `factArgs` carries the COUNT rather than the feed
 *  carrying that many rows. */
export const HOME_EVENT_BACKFILL_FIXTURE: HomeEventV1 = {
  ...baseEvent,
  id: "procurement:corpus:2026-07-30",
  kind: "corpus_updated",
  dateBasis: "first_seen",
  backfill: true,
  materiality: 0.1,
  actionability: 0.1,
  factKey: "home_fact_corpus_updated",
  factArgs: { rows: 41233, source: "aop" },
};

/**
 * A kind with no adapter, renderer or translation.
 *
 * ⚠️ EXISTS TO BE REJECTED. `home_feed.data.test.ts` asserts every kind has all three, so
 * this fixture is what proves that gate still discriminates — an assertion that only ever
 * sees valid input passes on an implementation that checks nothing.
 */
export const HOME_EVENT_UNKNOWN_KIND_FIXTURE: HomeEventV1 = {
  ...baseEvent,
  id: "mystery:1",
  kind: "not_a_registered_kind",
  dateBasis: "occurred",
  occurredAt: iso("2026-07-29"),
  factKey: "home_fact_not_a_registered_kind",
};

export const HOME_FEED_FIXTURE: HomeFeedV1 = {
  schemaVersion: 1,
  // The window ENDS at the newest source date, not at the run time — see HomeFeedV1.
  computedAt: iso("2026-07-30"),
  windowDays: 30,
  events: [
    HOME_EVENT_OCCURRED_FIXTURE,
    HOME_EVENT_FIRST_SEEN_FIXTURE,
    HOME_EVENT_BACKFILL_FIXTURE,
  ],
  sourceCoverage: {
    aop: { available: true, asOf: iso("2026-07-30") },
    isun: { available: true, asOf: iso("2026-07-29") },
  },
};
