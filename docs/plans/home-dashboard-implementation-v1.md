# Bulgaria home dashboard — full implementation plan

**Status:** ready to execute
**Product research:** [home-dashboard-research-v1.md](./home-dashboard-research-v1.md)
**Related election work:** [elections-hub-implementation-v1.md](./elections-hub-implementation-v1.md)
**Audit:** [home-dashboard-plan-audit-2026-09-01.md](../audits/home-dashboard-plan-audit-2026-09-01.md)
**Scope:** replace the parliamentary-only `/` with a global Bulgaria-in-data front door, preserve the country election result at `/parliamentary`, and add a typed national change feed
**Version:** v1 — staged route migration, generated home artifacts, no account or notification delivery system

> **Revision — 2026-09-01, after audit.** Two changes and a set of corrections, all folded
> into the sections below rather than appended.
>
> **1. The preserved country result goes to `/parliamentary`, not `/elections`.** That
> namespace already exists with two hub siblings (`/parliamentary/analysis`,
> `/parliamentary/reports`) and no index, so the country result completes it. Three things
> follow: the `/elections` vs `/elections/<latest date>` duplicate this plan would otherwise
> have created never exists; `/elections` stays free for the cross-kind hub
> [elections-hub-implementation-v1.md](./elections-hub-implementation-v1.md) actually
> designs (parliamentary + local + chmi); and Phase 1's prerender body, JSON-LD, sitemap
> entry and OG image are PERMANENT rather than something that plan overwrites.
>
> **2. Serving and SEO, verified against the tree (final audit).** `/` is served from **two
> GCS objects and nothing else** — §9.3a caps the runtime budget and gates zero `/api/db/`
> before the finder arms; §9.3b adds the `bucket:gz` step without which both objects are
> stored and served UNCOMPRESSED. On the SEO side, three gates were found that this plan
> trips or evades: `tests/seo.spec.ts`'s exact root JSON-LD count (§11.1), the
> `every routed page is DECLARED` gate's structural blindness to index routes like
> `/parliamentary` (§11.2), and `HUB_CAPTURES` — a fifth registry `home` must join and
> `parliamentary` must not (§11.3).
>
> **3. Corrections carried in from the audit.** `LOCALE_BUNDLES` is in `src/locales/bundles.ts`
> (§10); the inflation figure is HICP and `cpi` is already taken by the corruption index
> (§5); the feed window is anchored on source vintage, not on `now` (§6.6); the feed's
> "see all" is `/data/updates` (§6.7); three more gate registries are named (§14.2);
> `pscope`/`elections` param leakage is gated (§4.2); root gains `preloadData` (§11.1);
> and the two byte budgets this plan will trip are named (§14.5).

## 1. Outcome

Ship `/` as a useful answer to “What is happening in Bulgaria?” rather than as an alias for the latest parliamentary election.

The first screen must give a defensible national pulse, a fast way to find a place/person/institution/topic, and direct entry to the subjects people repeatedly seek:

- prices and consumption;
- municipalities and “my area”;
- elections;
- budget, debt, and taxes;
- public procurement;
- EU funds and open calls;
- concrete public sectors such as schools, hospitals, pensions, roads, energy, and justice;
- parliament and government accountability.

Below that stable front door, “What changed” is a small typed feed of material, dated events: new procedures and contracts, calls opening or closing, meaningful price movements and promotions, election events, budget changes, and debt issuance. It is not a scraped news stream, a raw ingest log, or a claim that first discovery equals real-world occurrence.

The implementation must preserve every existing election result and analysis. The current country dashboard moves intact to `/parliamentary` before `/` changes meaning; historical `/elections/:date` and every deep result URL remain unchanged.

## 2. Fixed v1 decisions

These are implementation constraints, not design questions to defer into code review.

1. `/` becomes the canonical global home. It is not redirected.
2. `/parliamentary` becomes the canonical route for the current parliamentary country result — the exact composition `/` renders today. `/elections/:date`, the local-election routes and every deep parliamentary route are unchanged. **This plan does not create `/elections`**; that route belongs to the elections hub, and creating it here would produce two prerendered sitemapped URLs rendering the same latest cycle (`/elections` and `/elections/<latest date>`, which is already prerendered at `scripts/prerender/dynamicRoutes.ts:2583` and already carries a sitemap `<loc>` via `{path:"elections/:id"}`).
3. Route preservation is a prerequisite: `/parliamentary` must render the current country election experience before the root cutover is allowed.
4. The stable hierarchy is search-led and durable. Elections receive normal prominence outside an election period and may be promoted through a data-driven seasonal mode; they never take over root routing again.
5. The head contains exactly four national pulse figures in v1: real GDP growth, **HICP** inflation, seasonally adjusted unemployment, and general-government debt as a share of GDP. Each figure carries period, basis, source, and a destination. ⚠️ **Never call the inflation figure CPI.** In this repo `cpi` is already taken: `macro.indicators.cpi` is Transparency International's *Corruption* Perceptions Index („Корупционен индекс") and `macro.series.cpi` is its 0–100 score. The figure here is Eurostat HICP (`prc_hicp_minr`), which is neither that nor the НСИ national CPI. See §5.1.
6. Head and tile numbers are folds of destination-owned figures. The home generator does not invent parallel formulas and never sums overlapping procurement, funds, or sector corpora.
7. One finder serves the home. It reuses existing place, people, awarder/company, procurement/funds, and product search authorities; it does not build a second global index.
8. The grid has eight primary destinations in two semantic bands of four. Every tile has one destination and at most one non-duplicative metric; descriptor-only is valid when no honest metric exists.
9. Home uses two generated artifacts: `data/home/hub_stats.json` for small numeric facts and `data/home/feed.json` for typed event rows. Text/event details do not inflate the stats blob.
10. `HomeEvent` stores date semantics explicitly. `occurredAt`, `publishedAt`, and `firstSeenAt` are different fields; the UI never relabels first-seen time as the event date.
11. Generated artifacts carry enum/fact arguments, not translated sentences. Bulgarian and English rendering lives in locale bundles.
12. Missing data is absent, never zero. Partial-source states keep the page useful and disclose coverage.
13. The root feed renders no more than six events, no more than two from one category, and at least three categories when the available material permits it.
14. Bulk backfills collapse into a labelled corpus-update summary. They do not become hundreds of “new today” news items.
15. Automatic publication is restricted to events whose source and date semantics meet the event-kind contract. Ambiguous international debt issues and document-only budget changes require editorial review in v1.
16. “Alerts” continues to mean an on-site recent-activity experience in v1. This plan does not promise email, push, login, saved delivery preferences, or real-time monitoring.
17. Every new canonical page ships with prerender body, both sitemap declarations and committed XML, canonical metadata, internal reachability, and a dedicated inspected OG image in the same phase.
18. Root is a hub-of-hubs and composes `HubHead`, `TileHubGrid`/`TileHubSection`, and `HubSearch`. It does not create parallel header, tile, or search systems.
19. All artifacts must be regenerated deterministically, registered in the full refresh, published to the data bucket, and verified from the same public path the browser reads.
20. Each rollout phase has an independent rollback and ships as a separate reviewed commit.

## 3. Current-state contracts and migration boundary

### 3.1 Root ownership today

The present root is an election result page:

- `src/routes.tsx` maps the index route to `src/screens/DashboardScreen.tsx`;
- `DashboardScreen` renders the parliamentary `PlaceHeader` and `DashboardCards`;
- `src/screens/dashboard/DashboardCards.tsx` owns the latest national result and analyses;
- `scripts/prerender/routes.ts` gives `/` election title, body, Dataset JSON-LD, and `/og/dashboard-2026-04-19.png`;
- `src/layout/header/reportMenus.ts`, `ElectionsBreadcrumb`, `placeViews`, and `crossElectionLink` use `/` as the parliamentary-country destination.

The cutover must change all of those contracts together. Changing only the React route would leave breadcrumbs, prerender, sitemaps, navigation state, and cross-election links pointing at unrelated home content.

### 3.2 Route target after migration

| Purpose | Canonical route after v1 | Migration rule |
| --- | --- | --- |
| global Bulgaria dashboard | `/` | new content; no redirect |
| current parliamentary country result | `/parliamentary` | receives the current root result composition; new index on an existing namespace |
| historical parliamentary country | `/elections/:date` | unchanged |
| parliamentary region/municipality/settlement/section | existing routes | unchanged |
| local-election hierarchy | `/local/:cycle/**` | unchanged |
| cross-kind elections hub | `/elections` | **out of scope here** — owned by the elections-hub plan |

The header logo continues to link to `/`. Election menus and election breadcrumbs link to `/parliamentary`. A home link is not added as a fake leaf inside the Elections menu.

**Why `/parliamentary` and not `/elections`.** `src/routes.tsx:3786` already declares a
`parliamentary` route group holding `analysis` and `reports` — two hubs — with **no index**.
The country result is the missing third member and the natural parent of both, so the
namespace is completed rather than a new one invented. The alternative, `/elections`, would
have rendered the same latest cycle as the already-prerendered, already-sitemapped
`/elections/<latest date>`, forcing a canonical decision between two pages with identical
content; and the elections-hub plan then replaces that screen, making Phase 1's body,
JSON-LD and OG image throwaway. Neither cost is paid here.

**Consequence for the elections-hub plan.** Its integration banner and its fixed decisions 1,
2, 15 and 16 say the country result is preserved at `/elections`. That is superseded: the
country result is at `/parliamentary`, and `/elections` is a NEW cross-kind hub with no
preservation duty and no legacy body to inherit. Update that plan's banner in the same commit
as this revision, so the two files cannot disagree about what `/elections` is.

### 3.3 Existing artifacts to retain

`public/og/dashboard-2026-04-19.png` is also referenced by historical/article content. Stop
using it for root metadata, but do not delete it. **It has a live consumer:**
`public/articles/index.json` names it, and `scripts/prerender/routes.ts:1474` is the only other
reference. It is also a hand-made legacy asset — `scripts/og/capture-screens.ts` has **no entry
that produces it** — so `/og/parliamentary.png` is new capture work with no entry to copy from
(§11.2), not a rename.

The existing election `DashboardSkeleton` follows the preserved election screen. Root gets a new `HomeDashboardSkeleton` so a future election-shell change cannot alter home loading geometry.

### 3.4 User-owned overlap

`Header.tsx`, `package.json`, and other files may already contain unrelated work. The implementation must rebase each phase on the then-current tree, inspect overlapping diffs, and make narrow edits. This plan authorizes no cleanup of unrelated changes.

## 4. Product information architecture

### 4.1 Page order

Root renders in this order:

1. `HubHead` — eyebrow/freshness, one H1, short deck, four pulse figures, and the finder;
2. “Everyday Bulgaria” band — prices, my area, elections, sectors;
3. “Public money and power” band — budget, procurement, EU funds, governance/parliament;
4. “What changed” — at most six typed events with a route to the relevant full destination;
5. methods/source note — how dates, coverage, and updates are defined.

No full-width map, decorative hero illustration, or election result chart appears above the primary destinations. Root is a navigation and orientation surface, not a duplicate of any destination dashboard.

### 4.2 Tile registry

Create `src/screens/home/homeRegistry.ts` with bands nested as the only source of tile order:

```text
Everyday Bulgaria
  prices       -> /consumption
  my-area      -> /my-area
  elections    -> /parliamentary
  sectors      -> /governance/sectors

Public money and power
  budget       -> /budget
  procurement  -> /procurement?pscope=all
  funds        -> /funds
  governance   -> /governance
```

The exact Bulgarian and English labels are translation keys. The semantics and order are fixed for v1. `/open-calls` is an action link within the funds tile/feed, not a ninth peer tile. Parliament remains directly reachable from the governance destination and may be a feed destination.

**The `elections` tile points at `/parliamentary` in v1.** When the elections-hub plan ships
`/elections` as the cross-kind hub, that is a one-line change to this registry and to the
tile's label key — gated by the destination-resolves test below, so the repoint cannot be
made without the route existing.

⚠️ **`pscope` and `elections` are GLOBAL preserved params, so a tile link that forces
nothing still carries whatever the reader arrived with.** `src/ux/usePreserveParams.tsx`
holds both in an allowlist and `usePreserveParams()` copies them onto every in-app link.
That has already shipped as a defect on a hub head — the hook's own header records
`/funds/beneficiaries`, "which deliberately forces nothing", coming out of `/governance`
carrying `?pscope=all`, so a scope-free destination silently answered for one window. Home
is the widest instance of the same shape: seven of eight tiles have no scope concept.

The rule for v1:

- `/` itself **ignores** `pscope`. The four pulse figures are fixed-period national
  observations and the tile metrics are destination-owned folds; there is no home window to
  resolve. State it on the page's methods note rather than leaving it inferred.
- `procurement` **forces** `?pscope=all` and must survive an inbound `?pscope=y:2019`.
- the other seven tiles emit **no** `pscope`, inbound or otherwise.
- `elections` is preserved and forwarded to `/parliamentary`, which reads it — so the
  `elections` tile's metric must be honest about which cycle it names. The generator computes
  the LATEST event at build time; a reader carrying `?elections=2013_05_12` would otherwise
  see a 2026 date on a tile whose destination renders 2013. Either the tile reads the param
  client-side and re-captions, or its copy says "последни избори" and never a bare date. Pick
  one in Phase 2 and gate it.

Create `src/screens/home/homeScenes.tsx` for the eight bespoke scenes. `HOME_BANDS` owns the nested tile list and `HOME_TILES` is derived with `flatMap`; no second hand-maintained registry exists.

Tile gates assert:

- exactly two described bands and four tiles per band. ⚠️ `TileHubGrid` is
  `lg:grid-cols-3 xl:grid-cols-4`, so four-across is an **`xl`** (≥1280) layout: at
  1024–1279 a four-tile band wraps 3 + 1. Accepted; the gate asserts the count, and §14.4
  inspects 1280 and 1440 where the four-column claim holds;
- no tile link carries a `pscope` it did not force, under an inbound `?pscope=y:2019`
  (the `usePreserveParams` leak above);
- one scene per tile and no accent collision across the composed page;
- absolute, routed destinations and preserved forced scopes;
- no per-tile CTA or instruction-shaped heading such as “Explore” or “More”;
- no tile number duplicated in the head or another tile;
- every shown number has value, basis, destination, source availability, and period;
- absent data renders the descriptor, not `0` or a skeleton forever.

### 4.3 Seasonal election prominence

Do not reorder the permanent registry by hand. Add a small `homeMode` field to `hub_stats.json`:

```ts
type HomeMode = "standard" | "election_upcoming" | "election_live" | "election_recent";
```

The generator derives it from the canonical election registry/status, not the current date alone:

- `election_upcoming`: a scheduled national election is within 45 days;
- `election_live`: projection/provisional/counting status;
- `election_recent`: final result within 14 days;
- otherwise `standard`.

Mode may add a compact election notice between the head and bands, using the `/parliamentary` destination. It does not hide the pulse, change the root canonical, or remove other subjects. Unknown status falls back to `standard`.

## 5. Home statistics data contract

### 5.1 Shared types

Create import-safe browser/script types at `src/data/home/homeTypes.ts`:

```ts
type HomeFigureId =
  | "gdp_growth"
  | "inflation_hicp"   // NOT "cpi" — see the note under §2 decision 5
  | "unemployment_sa"
  | "government_debt_gdp";

type HomeBasis = {
  period: string;
  frequency: "monthly" | "quarterly" | "annual" | "snapshot";
  unit: "pct" | "pct_gdp" | "eur" | "count";
  adjustment?: "seasonally_adjusted" | "unadjusted";
  comparison?: "yoy" | "qoq" | "level" | "snapshot";
};

type HomeFigure = {
  id: HomeFigureId;
  value: number;
  basis: HomeBasis;
  to: string;
  sourceId: string;
};

type HomeTileMetric = {
  tileId: string;
  value: number;
  unit: "pct" | "eur" | "count" | "date";
  basisKey: string;
  period?: string;
  to: string;
  sourceId: string;
  scope?: string;
};

type HomeHubStatsV1 = {
  schemaVersion: 1;
  computedAt: string;
  homeMode: HomeMode;
  figures: HomeFigure[];
  tiles: Partial<Record<string, HomeTileMetric>>;
  sources: Record<string, {
    available: boolean;
    asOf?: string;
    sourceUrl?: string;
    datasetCode?: string;
  }>;
};
```

The real type may tighten string unions, but must not add React or Node imports. `computedAt` is the maximum meaningful source vintage in the artifact, not `new Date()` on every rebuild.

### 5.2 Four head figures

`scripts/db/gen_home/hub_stats.ts` reads the canonical values already maintained in `data/macro.json`:

| `HomeFigureId` | Value selector | Metadata source | Basis it must carry | Destination |
| --- | --- | --- | --- | --- |
| `gdp_growth` | latest valid `series.gdpGrowth` observation | `indicators.gdpGrowth` — `namq_10_gdp`, "% YoY (real, SCA)" | quarter, YoY, real, seasonally+calendar adjusted | `/indicators/economy` |
| `inflation_hicp` | `latestMonthly.inflation` | **the observation itself** — it carries `datasetCode` + `sourceUrl` | month, YoY, HICP | `/indicators/economy` |
| `unemployment_sa` | `latestMonthly.unemployment` | **`indicators.unemploymentMonthly`** — `une_rt_m`, monthly SA | month, seasonally adjusted | `/indicators/economy` |
| `government_debt_gdp` | latest valid `series.govDebt` observation | `indicators.govDebt` — `gov_10q_ggdebt`, "% of GDP" | quarter, % of GDP, general government | `/indicators/fiscal` |

⚠️ **The metadata column is not decoration — the obvious lookup mislabels half the band.**
`series.*` observations carry only `{period, value}`, so the dataset code, source URL and
adjustment wording have to come from somewhere else, and `macro.indicators[figureId]` is
**not** that somewhere for two of the four:

- `indicators.unemployment` is the **quarterly** series (`une_rt_q`), a different dataset from
  the `latestMonthly.unemployment` (`une_rt_m`) this figure selects. The monthly metadata is
  `indicators.unemploymentMonthly`.
- `indicators.inflation` is captioned "% YoY (HICP, **quarterly avg**)". There is no
  `inflationMonthly` indicators entry, so a naive lookup would label a monthly observation as
  a quarterly average. Read `datasetCode`/`sourceUrl` off the `latestMonthly.inflation`
  observation, which carries both.

Selectors must copy `period` plus source URL, dataset code and adjustment/comparison metadata
from the row named above. `home_hub_stats.data.test.ts` asserts, per figure, that the emitted
`datasetCode` equals the one on the object the value came from — an assertion on the
figure's own metadata alone would pass on a cross-wired pair. Tests also fail if a selector
silently chooses an older valid-looking observation after a schema change.

The generator does not hard-code the currently observed values. Missing one indicator yields three cells plus a disclosed partial state; it never substitutes zero, a prior hard-coded value, or a different indicator.

### 5.3 Tile metric ownership

The generator folds only metrics whose destination already owns the definition:

- prices: a current basket/deal/coverage metric from the consumption payload with its exact observation window;
- my area: descriptor-only in v1 unless the canonical place catalog provides a stable, meaningful coverage count;
- elections: date/status of the **latest** event, not another result percentage — and per §4.2 the copy must not read as a claim about a cycle the reader has selected;
- sectors: destination registry coverage count, never a sum of sector money;
- budget: the same planned/projected selector and basis used by the budget/governance generator;
- procurement: the destination `hub_stats` all-scope metric, with `?pscope=all` preserved;
- funds: a destination-owned funds metric; never ISUN + Interreg + agriculture added together. ⚠️ **Not a stored count of "currently open" calls.** `open_calls_table` (migration 142) derives `open` by comparing `closes_at` to `now()` *at query time*, precisely because a status frozen at generation time shows expired calls as open all weekend after a Friday failure. A static blob cannot hold that answer. Either fold a time-invariant figure (calls in the register, contracted euro), or store `closes_at` values and let the browser derive the count — never store the verdict;
- governance: a destination-owned people/institution/parliament coverage metric not used elsewhere on root.

If a destination does not expose a compatible value, the tile is descriptor-only. Adding a home-only query merely to fill every tile is explicitly rejected.

### 5.4 Artifact and publication budget

- path: `data/home/hub_stats.json`;
- uncompressed ceiling: 16 KiB;
- one request supplies all head and tile figures;
- stable key ordering and deterministic serialization;
- no localized prose, raw row lists, or duplicated source documents;
- rebuild with unchanged semantic content is byte-identical;
- a missing source changes `available`, not unrelated values;
- bucket path: `home/hub_stats.json`.

Add `db:gen-home-hub-stats` to `package.json`, `REFRESH_GENERATORS` in
`scripts/db/refresh_coverage.ts`, and the end of `db:refresh` after
`db:gen-governance-hub-stats`. Governance must continue after its sibling hubs; home is last
because it folds destination artifacts.

The registry entry needs all three fields the interface declares — `artifact`
(`data/home/hub_stats.json`, asserted git-tracked), `reason` (why this slot and not an
earlier one), and `bucketPath` (`home/hub_stats.json`). The third is what
`db:check-generated` uses to fetch the live object and compare bytes; without it the artifact
can be committed, chain-built and never published, which is the exact failure that registry
field was added for after `culture/derived/hub_stats.json` 404'd for two days.

Registration is mechanically enforced, so this cannot be forgotten: `refresh_coverage.test.ts`
scans **every** `db:gen-*` key in `package.json` (not just `gen_procurement/`) and fails any
that writes unconditionally and is absent from `REFRESH_GENERATORS`.

## 6. “What changed” event contract

### 6.1 Type and date semantics

Add to `homeTypes.ts`:

```ts
type HomeEventCategory =
  | "prices"
  | "local"
  | "procurement"
  | "funds"
  | "budget_debt"
  | "parliament_elections";

type HomeDateBasis =
  | "occurred"
  | "published"
  | "effective"
  | "deadline"
  | "first_seen";

type HomeVerification = "automatic" | "editorial_review";

type HomeEventV1 = {
  schemaVersion: 1;
  id: string;
  kind: string;
  category: HomeEventCategory;
  occurredAt?: string;
  publishedAt?: string;
  effectiveAt?: string;
  deadlineAt?: string;
  firstSeenAt: string;
  dateBasis: HomeDateBasis;
  scope: { level: "national" | "oblast" | "municipality"; id?: string };
  source: { id: string; url?: string; labelKey: string };
  coverage: { complete: boolean; noteKey?: string };
  route: string;
  factKey: string;
  factArgs: Record<string, string | number>;
  backfill: boolean;
  verification: HomeVerification;
  materiality: number;
  actionability: number;
};

type HomeFeedV1 = {
  schemaVersion: 1;
  computedAt: string;
  windowDays: number;
  events: HomeEventV1[];
  sourceCoverage: Record<string, { available: boolean; asOf?: string }>;
};
```

`id` is stable from source kind + source record identity + event transition. It must not contain ingestion time. `dateBasis` tells the renderer which date is being presented and which label to use. When only `firstSeenAt` exists, copy says “found/added to the data”, never “happened”.

⚠️ **No stored field may be a function of `now`.** Every date on a `HomeEventV1` is an
absolute instant from a source. A derived value — `daysLeft`, `isOpen`, `closingSoon`,
`isRecent` — is computed by the RENDERER at read time, never written into the artifact. Two
independent reasons, and either alone settles it:

- it is the defect `open_calls` (migration 142) exists to prevent, one layer up. That table
  stores no status because a status frozen at crawl time "would show expired calls as open
  all weekend after a Friday failure"; a `feed.json` carrying "deadline approaching" is the
  same claim with the same failure mode and a longer cache life.
- it breaks §12.3's determinism gate. A now-relative field changes daily with no source
  change, so `db:check-generated` reports permanent drift against the bucket object and the
  byte-identical double-generation assertion in §14.1 can never pass.

`deadlineAt` is stored. "Closes in 3 days" is rendered.

### 6.2 Source adapters

Implement `scripts/db/gen_home/feed.ts` and adapters under `scripts/db/gen_home/events/`. Each adapter owns its event kinds, source gate, materiality rule, and date basis.

| Adapter | V1 events | Date authority | Publication rule |
| --- | --- | --- | --- |
| procurement | tender announced, contract awarded, material annex | source notice/award/annex date; `firstSeenAt` separately | automatic when record route and real date exist |
| funds | project added/modified, call opened, call closed (a PAST transition with a real date) | source publication/effective/deadline; detection separately | automatic; changed amount needs before/after values. „Deadline approaching" is not an event — it is `deadlineAt` rendered against the clock (§6.1) |
| local | council resolution, capital programme, local/partial election | resolution/election/effective date | automatic only for ingested municipalities; coverage disclosed |
| parliament/elections | new sitting/vote, election scheduled, polling/results status transition | sitting/election/status time | automatic for canonical lifecycle transitions |
| prices | official CPI release, material basket movement, verified promotion start/end | observation/release/window date | automatic when comparison window and sample coverage pass |
| budget/debt | KFP release, enacted budget amendment, domestic debt auction/result | document effective/release/auction date | automatic only for structured domestic sources |
| international debt | Eurobond issue/terms | official issue/publication date | `editorial_review` until a structured authority exists |
| budget document | draft/revision document discovered | publication/first-seen | document notice automatic; numeric “budget changed” remains review-gated |

Reuse `recent_updates()` only for first-seen/changelog evidence and source identities. It is not the occurrence clock. Its summary-mode rows become one corpus-update event; detail rows still require the source adapter to supply the real date and destination.

Do not build the national feed by reading and merging all 265 `myarea_alerts` responses. The feed uses their upstream authorities or common builders so one local item is not copied 265 times and national events are not polluted by municipality-specific prose.

### 6.3 Price materiality

The first implementation uses documented deterministic thresholds, stored beside tests rather than in the UI:

- compare identical product/store coverage or a defined basket cohort;
- require the minimum sample count already used by the consumption destination;
- emit a basket move only when absolute 7-day movement is at least the reviewed threshold;
- emit a promotion only from a source promotion/discount field or a defensible regular-price baseline, never from a single low observation;
- name the window, observation count, geography, and coverage change;
- suppress an event if coverage movement could explain the price movement.

The exact numeric threshold is finalized against a 90-day replay in Phase 5. The review artifact records event count/day, false positives, missing days, and category dominance before the threshold is accepted.

**Accepted 2026-09-01** — replay: [`docs/audits/home-price-threshold-replay-2026-09-01.md`](../audits/home-price-threshold-replay-2026-09-01.md). Basket move **±1.5%** over a 7-day mean against the prior 7-day mean, measured over a **fixed cohort** (the settlement×product cells priced on every day of the 14-day span) so coverage movement cannot explain the result — the naive series put 2026-08-26 at −2.82% while its cells moved −4.60%. Consecutive same-sign crossings collapse to **one episode**, dated at its strongest day: 4 episodes over 92 days. Promotions take the /consumption deals board's own corroboration (≥3 store listings, ≥2 chains, chain-deduped baseline regular) with a stricter **30–70%** discount band, a level-anchored start date, and a cap of 3.

⚠️ **The price corpus is Postgres-only, so the price arm reads a COMMITTED INTERMEDIATE.** `db:gen-home-price-events` measures and writes `data/home/price_events.json`; the feed's adapter reads that file. Without the split, `gen_home/feed.ts` would need a database — and the artifact would then differ between a machine with the price corpus and one without, which breaks the byte-identical rebuild §12.3 requires. Every threshold above is stored in the artifact so a future reader can tell a corpus change from a rule change.

### 6.4 Ranking and diversity

The generator calculates a deterministic rank from:

```text
date recency on the declared basis
+ materiality
+ actionability
+ national relevance
- backfill penalty
- incomplete-coverage penalty
```

It then applies:

- maximum 40 rows in the artifact;
- maximum two rows per category in the first six;
- at least three categories in the first six when eligible rows exist;
- national rows before local rows at equal score;
- a municipality row only if material nationally or relevant to a selected place in a later personalized view;
- no stale row solely to satisfy diversity;
- stable tie-break by `id`.

The browser may take the already-ranked first six; it must not invent a different ranking.

### 6.5 Feed rendering

Create `src/screens/home/HomeChangeCard.tsx` as a small renderer around or beside the existing `NewsCard` primitive. It must show:

- category/kind label;
- fact rendered from `factKey` + `factArgs`;
- the date with its date-basis label;
- amount/change/deadline only when present — a deadline renders as a countdown computed HERE, from the stored `deadlineAt` against the reader's clock (§6.1), never from a stored `daysLeft`;
- a clear internal destination;
- source/coverage note when incomplete;
- a backfill or editorial-review label where applicable.

Internal destinations use the app `Link`; source evidence is an external anchor. The card never displays a review-gated event on root until its verification state is promoted by the reviewed artifact path.

### 6.6 Feed artifact budget

- path: `data/home/feed.json`;
- uncompressed ceiling: 64 KiB;
- maximum 40 events;
- window: 30 days **ending at the artifact's `computedAt`**, which is the maximum source
  vintage — never `now`. See the note below;
- no bilingual prose;
- deterministic and byte-stable under unchanged inputs;
- bucket path: `home/feed.json`;
- home fetch failure hides the feed behind a disclosed unavailable state; it does not fail the head or grid.

⚠️ **Anchor the window on source vintage, not on the calendar, or the artifact can never be
deterministic.** A 30-day window whose end is *now* slides every day: rows age out, the
ranking's recency term moves, and the file changes with no source change. That contradicts
§12.3 ("rebuild with unchanged semantic content is byte-identical") and makes
`db:check-generated` — which compares committed bytes against the live bucket object —
report drift permanently, i.e. it stops being a signal. Anchoring on
`computedAt = max(source date)` makes two rebuilds of the same corpus byte-identical and
makes the window's meaning honest: "the last 30 days *of data we have*", which is also the
right thing to say when a source is behind.

The renderer, which does know the clock, is where staleness surfaces: it shows `computedAt`
and says so when the newest event is old. A generator that silently re-anchors on `now` to
keep the feed looking fresh would be hiding a stalled pipeline behind a moving window.

Add `db:gen-home-feed` to `package.json`, `REFRESH_GENERATORS`, and after the stats generator
at the end of `db:refresh`. Neither generator may read the other's artifact, so their relative
order is free and is pinned only for reproducibility.

⚠️ **Do not add an umbrella `db:gen-home` wrapper.** Any key matching `^db:gen-` is scanned by
`refresh_coverage.test.ts`, which requires it to be either in `REFRESH_GENERATORS` — one
entry, one `artifact`, one `bucketPath`, which a wrapper cannot supply — or gated behind
`process.argv.includes("--write")`, which the same test then rejects for anything registered.
A wrapper is unregisterable by construction. Two entry points, both registered, ordered in
the `db:refresh` chain.

### 6.7 Where the feed goes, and how it differs from `/data/updates`

**The root feed shows six rows and must have a full destination.** It is
**`/data/updates`**, and the two are not the same thing — which is exactly why the
relationship has to be stated on both pages rather than left to be inferred.

The site already has three "what changed" surfaces. The home feed is a fourth, and it is the
only one that is national, typed and event-dated:

| Surface | Source | Grain | What it answers |
| --- | --- | --- | --- |
| `/data/updates` | `data/data-changes.json`, appended by the watch orchestrator | one row per successful skill run, free-text `summary` | "when did we last ingest X" |
| `recent_updates()` (PG) | `ingest_first_seen` / `changelog_days` | per (source, day) | the queryable first-seen record; only consumer today is the dev SQL browser |
| `myarea_alerts` | `/api/db/myarea-alerts` | one município | "what happened near me" |
| **home feed** (this plan) | typed adapters over source authorities | one national event | "what happened in Bulgaria" |

Rules:

1. The feed's "see all" links to `/data/updates`, and `/data/updates` gains a reciprocal link
   back. Neither page may present itself as the whole answer.
2. Both pages state their axis in one sentence of copy: `/data/updates` is **when the data
   was refreshed**; the home feed is **when something happened**. §1 already rejects "a raw
   ingest log" for the home feed — that log exists, it is `/data/updates`, and saying so is
   what keeps the two from reading as a contradiction.
3. The home feed does **not** replace, deprecate or re-render `data-changes.json`. No row is
   copied between them.
4. If Phase 4's replay shows the two disagreeing about the same event in a way a reader would
   notice, that is a finding to resolve before launch, not a copy problem.

A dedicated `/changes`-style destination is explicitly **not** in v1 scope: it would be a
fifth surface, and §2.17 would require it to ship with its own prerender body, both sitemap
declarations, canonical metadata and an inspected OG image.

## 7. Alerts convergence

### 7.1 Immediate correctness repair

Before reusing alert concepts, fix the existing contract drift:

- `scripts/myarea/build_alerts.ts` emits `open_call`;
- `src/data/myarea/useMyAreaAlerts.tsx` omits `open_call` from `MyAreaAlertKind`;
- icon/color/kind rendering therefore falls through a generic runtime branch while TypeScript claims the kind cannot exist.

Create `src/data/alerts/alertKinds.ts` as an import-safe exhaustive registry shared by builder output validation and UI mapping. It includes all current kinds, icon/style token, category, default date basis, and translation key. Tests enumerate builder kinds against the registry and make an unhandled kind a compile/data failure.

Do not put translated headlines into the new home event artifact. The existing bilingual `myarea_alerts` storage may remain for compatibility; new kinds use structured facts, and a later migration can converge the old rows.

### 7.2 Freshness and invalidation

`useMyAreaAlerts` currently uses `staleTime: Infinity`. Replace it with one of these explicit mechanisms in the alert repair phase:

- preferred: response `refreshedAt`/version included in a short-lived query (30 minutes); or
- immutable versioned URL/query key published by the loader.

The home hooks use a 30-minute stale time and surface their artifact `computedAt`. A tab can remain open without showing yesterday’s alert/feed indefinitely.

### 7.3 Popular-topic alert additions

Add kinds only where there is an upstream authority and an actionable destination:

- `price_drop`, `basket_change`, `promotion_ending`;
- `tender_announced`, `contract_awarded`, `contract_amended` (split the broad procurement label in presentation while preserving notice type);
- `call_opened`, `call_deadline`, `fund_project_changed`;
- `budget_release`, `budget_amendment`, `debt_auction`;
- `election_scheduled`, `election_status`, `partial_election`;
- `council_resolution`, already present, with explicit municipal coverage.

V1 exposes these on-site. Account-backed subscriptions, per-entity cursors, delivery channels, and notification preferences are a later tier after event stability is measured.

### 7.4 Watchlist evolution, later tier

The current aggregate watchlist signature can tell that a collection changed, not which event the reader has seen. A real alert system requires:

```ts
type WatchSubject =
  | { kind: "place"; id: string }
  | { kind: "company"; id: string }
  | { kind: "institution"; id: string }
  | { kind: "product"; id: string }
  | { kind: "programme"; id: string }
  | { kind: "sector"; id: string };

type WatchCursor = { subjectKey: string; lastSeenEventId: string; lastSeenAt: string };
```

Do not implement this schema until the home feed event IDs survive a 30-day stability test across rebuilds and backfills.

## 8. Finder architecture

### 8.1 One home search configuration

Create `src/screens/home/homeSearch.ts` — a `HubSearchSource[]` module in the shape of `governanceSearch.ts` / `parliamentSearch.ts`, using `HubSearch` (`@/ux/search/HubSearch`), `hubSearchSources`, `buildEntityIndex` and existing adapters. Mount it in the `HubHead` `search` slot; `src/screens/hub_finder_single_render.test.ts` gates one finder per screen and a unique `idPrefix`. Search groups, in order:

1. places — settlements, municipalities, regions;
2. people — officials and MPs;
3. institutions and companies — awarders/contractors;
4. contracts, tenders, funds, and calls;
5. products/prices.

The search is armed only after focus/intent. Place catalogs remain lazy; product and server endpoints are not called on initial page load.

### 8.2 Reuse and refactor boundary

- reuse `buildPlaceItems` and the existing slim place catalog;
- reuse the people search source used by governance;
- extract the shared `/api/db/procurement-search` request/normalization from the procurement/governance consumers so home does not send duplicate requests for awarders, companies, contracts, tenders, funds, and Interreg;
- reuse `/api/db/price-search` for products;
- cap each group and the total result count;
- pass query text to a “see all” destination only where that destination actually reads the parameter.

No new catch-all search API is needed in v1. If parallel existing endpoints exceed the measured latency budget, record the trace before proposing an aggregator.

### 8.3 Search gates

- no search/catalog request before the finder is armed;
- one procurement request per normalized query;
- cancellation/debounce follows the shared source helper;
- keyboard, screen reader group labels, empty/error states, and Bulgarian/Latin query folding work;
- representative place, official, awarder, contractor, tender, fund, and product rows resolve to live routes;
- queries and result labels do not leak raw source fields or unsafe HTML;
- the finder does not exceed the head height budget at 390 px.

## 9. Screen and route implementation

### 9.1 New home files

```text
src/screens/HomeDashboardScreen.tsx
src/screens/home/HomeDashboardSkeleton.tsx
src/screens/home/homeRegistry.ts
src/screens/home/homeScenes.tsx
src/screens/home/homeFigures.ts
src/screens/home/homeSearch.ts
src/screens/home/HomeChangeFeed.tsx
src/screens/home/HomeChangeCard.tsx
src/screens/home/homeHubBands.test.ts
src/screens/home/homeFigures.test.ts
src/screens/home/HomeDashboardScreen.test.tsx

src/data/home/homeTypes.ts
src/data/home/useHomeHubStats.tsx
src/data/home/useHomeFeed.tsx

scripts/db/gen_home/hub_stats.ts
scripts/db/gen_home/feed.ts
scripts/db/gen_home/events/*.ts
scripts/db/tests/home_hub_stats.data.test.ts
scripts/db/tests/home_feed.data.test.ts
```

Keep `HomeDashboardScreen` composition-only. Figure formatting lives in `homeFigures.ts`,
descriptors in the registry, data fetching in hooks, and generation in scripts.

`homeSearch.ts` follows the repo's naming for a `HubSearch` source module —
`governanceSearch.ts`, `budgetSearch.ts`, `parliamentSearch.ts`, `cultureSearch.ts`,
`subsidiesSearch.ts` are the siblings. It exports sources, not a hook; §8 describes what it
composes.

### 9.1a Existing files this plan edits

The list above is only the NEW files, which understates the work: the route migration is
almost entirely edits, and three of the registries below fail the suite if missed.

| File | Change | Phase |
| --- | --- | --- |
| `src/routes.tsx` | `/parliamentary` index route; index → `HomeDashboardScreen`; `withBundle("home", …)` if §10 bundles | 1, 2 |
| `src/data/local/placeViews.ts:152` | country → `/parliamentary` | 1 |
| `src/data/local/crossElectionLink.ts:35` | country → `/parliamentary` | 1 |
| `src/screens/components/ElectionsBreadcrumb.tsx:43` | `nav_elections` → `/parliamentary` | 1 |
| `src/layout/header/reportMenus.ts:64,71` | `electionsMenu` root + mobile-only leaf | 1 |
| `src/screens/components/PlaceHeader.tsx:214` | `?? "/"` fallback | 1 |
| `src/layout/header/Header.tsx` | active-section logic; logo aria copy | 1 |
| `src/screens/ElectionScreen.tsx` | unchanged — already `<DashboardScreen />` | — |
| `scripts/prerender/routes.ts:549,1471` | `homeBodies`, root entry, `preloadData`, new `/parliamentary` entry | 1, 2 |
| `scripts/prerender/dynamicRoutes.ts:2603` | `/elections/:date` breadcrumb gains a parent | 1 |
| `scripts/sitemap/route_defs.ts` | `routeDefs(year)` **and** `ENGLISH_STATIC_PAGES` | 1 |
| `scripts/og/capture-screens.ts` | `home` + `parliamentary` entries | 1, 2 |
| `src/data/myarea/useMyAreaAlerts.tsx` | `open_call`; `staleTime` | 0 |
| `src/screens/myarea/MyAreaAlertsTile.tsx:152` | exhaustive kind mapping | 0 |
| `src/locales/bundles.ts`, `src/i18n.ts` | bundle registration, if §10 bundles | 2 |
| `package.json`, `scripts/db/refresh_coverage.ts` | two generators + chain | 2, 4 |
| `src/ux/infographic/hubHead.gates.test.ts` | `HUB_SCREENS` | 2 |
| `tests/ui.spec.ts` | `HUB_HEAD_SCREENS` **and** `HUB_HEAD_BUDGETS` | 2 |
| `tests/perf.spec.ts` | `HOME_HTML_MAX_BYTES`, locale budgets | 2 |

### 9.2 Election preservation bridge

Before changing the root index:

1. Add an **index route** under the existing `<Route path="parliamentary">` group
   (`src/routes.tsx:3786`), beside its `analysis` and `reports` children.
2. Point it at the current `DashboardScreen`/`DashboardCards` composition, preserving its lazy
   boundary and `DashboardSkeleton`. **This is a one-line screen change**, not a refactor:
   `src/screens/ElectionScreen.tsx` is already `export const ElectionScreen = () =>
   <DashboardScreen />`, so `/elections/:date` and `/parliamentary` are the same component
   differing only in whether `ElectionContext` reads the date from `useParams` or from
   `?elections`. The real work of this phase is items 4–8, not item 2.
3. Make `/parliamentary` render the same selected/latest cycle semantics the root renders
   today: `?elections` when present and valid, otherwise the latest event. Caption the cycle
   whose numbers are on screen; never silently show a different one. `elections` is in the
   `usePreserveParams` allowlist, so a reader arriving from `/elections/2013_05_12` carries it
   and a link cannot clear it.
4. Change parliamentary country destinations in the five sites that encode root-as-election —
   this is the complete set in `src/`, verified by grep:
   - `src/data/local/placeViews.ts:152` (`level === "country"` → `"/"`);
   - `src/data/local/crossElectionLink.ts:35` (and the three `?? "/"` fallbacks at 39/44/46,
     which are correct as written and must stay pointing at the country route);
   - `src/screens/components/ElectionsBreadcrumb.tsx:43` (`{ label: t("nav_elections"), to: "/" }`);
   - `src/layout/header/reportMenus.ts:64` and `:71` (`electionsMenu` root + the mobile-only
     „Обзор" leaf);
   - `src/screens/components/PlaceHeader.tsx:214` (`linkFor({level:"country"}) ?? "/"`).
5. Update `Header.tsx` active-section logic so `/` is neutral/global, `/parliamentary` and
   parliamentary deep routes activate Elections, local-election routes activate Elections, and
   governance/consumption remain independent. `Header.tsx:396` keeps `<Link to="/">` for the
   logo.
6. Keep the logo route `/`; update its accessible description from election-only copy to the
   platform/global description.
7. Add the breadcrumb level. Every static page's `buildBreadcrumbLd` trail starts „Начало" →
   `/`, which stays correct (it now means the global home). What changes is that election
   pages gain a genuine parent: „Начало → Парламентарни избори → …". `/elections/:date`'s
   own JSON-LD (`dynamicRoutes.ts:2603`) currently goes straight from Начало to the dated
   page; insert `/parliamentary` between them.
8. Search production and tests for remaining root-as-election assumptions; every intentional
   historical/article reference receives a comment or fixture name rather than a blanket
   replacement. `public/articles/index.json`'s use of `/og/dashboard-2026-04-19.png` is one
   such intentional reference — see §3.3.

Only after route, link, prerender, sitemap, and browser parity gates pass does `src/routes.tsx` change the index route to `HomeDashboardScreen`.

### 9.3 Runtime behavior

`useHomeHubStats` and `useHomeFeed` use separate React Query keys and fetch `dataUrl()` bucket paths. Stats failure renders a descriptor-complete hub with an unavailable pulse note. Feed failure renders a small unavailable state below the grid. One failure never blanks the other surface.

Loading skeletons reserve final geometry. Heavy destination charts/maps are not imported by the home route. Tile scenes are plain SVG/React and remain within the route chunk.

### 9.3a The home page is served from GCS, never from Postgres

**This is a hard constraint, not a preference, and it is what makes the root route cheap.**
`/api/db/*` is a Cloud Function over Cloud SQL: it cold-starts, it holds a pooled connection,
it is subject to the pool's 10 s `statement_timeout`, and `/api/db/**` is cached
`max-age=300, s-maxage=3600` at the edge. A bucket object is a static GET with no compute
behind it and `Cache-Control: public,max-age=300,must-revalidate` — so the GCS path is both
cheaper AND fresher than the API path. The site's entry page must not depend on the database
being warm.

**The permitted runtime network budget for `/` on first paint is exactly two requests, both
GCS:**

| Request | Path | Origin |
| --- | --- | --- |
| head + tile figures | `dataUrl("/home/hub_stats.json")` | GCS bucket |
| change feed | `dataUrl("/home/feed.json")` | GCS bucket |

`useGovernanceHubStats` (`src/data/governance/useGovernanceHubStats.tsx`) is the pattern to
copy: one `fetch(dataUrl(...))`, `null` on a non-OK response, `undefined` treated as an
ANSWER (descriptor-only) rather than a loading state. Home diverges from it in one place —
§7.2's 30-minute stale time instead of `staleTime: Infinity`, plus a surfaced `computedAt`,
because home is the entry page and a long-open tab must not show yesterday's pulse.

**Postgres is reachable from `/` through exactly one door, and it must stay shut until
intent.** The finder's server sources are PG-backed (`/api/db/procurement-search`,
`/api/db/person-search`, `/api/db/price-search`). `HubSearch` already guarantees this:
`armed` is a ref flipped by `arm()` on **focus or first keystroke**
(`src/ux/search/HubSearch.tsx:109-120`), and `onArm` is what loads sources. Nothing else on
the page may call `/api/db/*`.

⚠️ **Every generator-side PG read happens at BUILD time and is invisible to a reader.** §5.3's
tile folds reach `budget_hub_stats()`, `agri_hub_stats`, `fund_payloads` and the sibling hub
blobs — all inside `scripts/db/gen_home/`, none at runtime. If a tile metric cannot be folded
into the blob, the tile is descriptor-only (§4.2); it does not acquire a live query.

Gates (add to §14.5):

- a request log for `/` contains **zero** `/api/db/` entries before the finder is armed, and
  exactly two `home/*.json` entries;
- both artifact hooks resolve through `dataUrl()`, so the single greppable origin seam
  (`src/data/dataUrl.ts`) still holds;
- no `src/screens/home/**` or `src/data/home/**` module contains the string `/api/db`.

### 9.3b Publication: the two artifacts are stored UNCOMPRESSED unless `bucket:gz` runs

⚠️ **`gsutil rsync -j json` is TRANSPORT encoding, not storage encoding — this is measured in
this repo, not inferred.** `scripts/bucket_gzip.ts`'s header records the live check:
`x-goog-stored-content-encoding: identity`, so an object uploaded by `bucket:sync` or
`bucket:sync:paths` is **served uncompressed to every visitor**. At the §5.4/§6.6 ceilings
that is up to 80 KiB of identity JSON on the site's most-visited route, on the preload path
(§11.1) — roughly 350 ms of transfer at the 1.6 Mbps profile the perf budgets reason about,
for two files that compress ~5–10×.

So publication is **three** steps, not two, and the third is not optional:

```bash
npm run bucket:sync:paths -- --dry-run home
npm run bucket:sync:paths -- home
npm run bucket:gz              # stores them gzipped — MUST come after any sync
```

Add `home/hub_stats.json` and `home/feed.json` to `GLOBAL_FILES` in
`scripts/bucket_gzip.ts`. Two properties make this safe rather than a judgement call:

- **the ordering caveat is real and runs the other way.** `bucket:sync` re-uploads a gzipped
  object UNCOMPRESSED, because the stored object differs from the local file — which is why
  `bucket:sync:all` is `sync && gz` and why a scoped `home` sync after a `bucket:gz` silently
  reverts it. Any runbook that publishes home must end with `bucket:gz`.
- **`db:check-generated` is unaffected.** Its comparison "depends on fetch() decompressing for
  us" (its own note at `check_generated_artifacts.ts:107`), so a gzip-stored object still
  md5-matches the committed file.

`bucket_gzip.ts`'s scope note says "HOT LARGE files", and 16 + 64 KiB is not large — but the
cost of listing them is ~80 KiB added to a run that already reads 402.9 MB, and the benefit
lands on the entry page. If they are deliberately left out, say so in the artifact budget and
size §5.4/§6.6 for identity transfer rather than leaving the reader to assume compression.

Nothing else about the bucket needs changing:

- `data/home` is not matched by any `bucket:sync` `-x` arm and not by `isExcluded`, so both
  the full and the scoped sync pick it up with no new entry;
- `bucket_sync_paths.test.ts` gates EXCLUSIONS, so a new included tree needs no lockstep entry;
- CORS already covers every serving origin plus `http://127.0.0.1:5002`
  (`scripts/bucket_cors.json`), which is the Playwright `baseURL` — so CI's browser gates can
  read the objects cross-origin. CI must also set `VITE_DATA_BASE_URL` on its Build step, or
  `dataUrl()` is the identity and both fetches hit the SPA catch-all, returning the **shell at
  200 stamped `application/json`** — a fetch that looks fine until `JSON.parse`.

## 10. Internationalization

**First, decide whether home copy is bundled at all — it is not obviously right, and the
plan's earlier draft assumed it was.** A bundle is fetched by `import()` at route mount and
is **not** preload-hinted (only the core locale chunk is, by the inline script
`preloadLocale("bg")` in `vite.config.ts`). Tagging the **index route** therefore adds a
serial hop — entry → route chunk → home bundle — before the head can render its own H1, on
the site's highest-traffic route and the one every LCP budget is written against. The
mechanism pays off by sparing *other* routes the home copy's bytes; here it charges the one
route that cannot afford it. Measure both ways in Phase 2 and record the delta before
committing; keeping home copy in core is a defensible outcome.

If it IS bundled, adding one is **four** edits, and the middle one is easy to miss:

1. add `"home"` to `LOCALE_BUNDLES` in **`src/locales/bundles.ts`** — not
   `scripts/i18n/bundles.ts`, which is the reachability *analysis* module and exports no such
   constant. That file is deliberately import-free; `src/entryGraph.test.ts` is the gate;
2. add a `home: { bg, en }` entry to **`BUNDLE_IMPORTS` in `src/i18n.ts`**. Vite needs literal
   specifiers to emit a chunk per file, so a missing entry is a type error rather than a
   silent fallthrough;
3. tag the root route with `withBundle("home", ...)` (`src/routes.tsx:50`);
4. run `scripts/i18n/split_bundles.ts --apply` after the static reachability set is complete,
   then re-ratchet the per-language brotli budgets in `tests/perf.spec.ts`.

Note `changeLanguage` re-merges every bundle the session has asked for before switching, so a
reader who changes language on `/` does not watch the page turn into raw key identifiers.

The home bundle contains:

- head/deck/source/freshness copy;
- band/tile labels and descriptions;
- figure basis labels;
- every `HomeEvent.kind`, `dateBasis`, coverage, backfill, and verification state;
- finder group/empty/error labels;
- methods copy and seasonal election notice.

Generated JSON contains only enums, codes, and fact arguments. Locale parity enumerates every generator-emittable code in Bulgarian and English. Write Bulgarian copy natively and review it beside English.

The election implementation plan’s bundle decision changes with this route migration: election-hub-exclusive copy may use an `elections` bundle, while shared result components stay in core unless reachability proves they are exclusive. Measure and re-ratchet `tests/perf.spec.ts`; do not assume moving root automatically removes all election strings from core.

## 11. SEO, prerender, sitemap, and OG

### 11.1 Root

Replace root election metadata in `scripts/prerender/routes.ts:1471` with unique
Bulgarian/English home metadata and a real static body covering the pulse, eight
destinations, change feed meaning, and source methodology.

Root structured data uses:

- `WebSite` + `Organization` identity;
- an `ItemList` for the primary data destinations;
- Dataset descriptions only for the actual national indicators/corpora represented, not one election Dataset relabelled as a country dashboard.

⚠️ **The root body has ~800 bytes of headroom, and this section spends more than that.**
`tests/perf.spec.ts` holds `HOME_HTML_MAX_BYTES = 18_000` against ~17.2 kB today. A richer
body plus `ItemList` plus per-corpus `Dataset` nodes will trip it. Measure the emitted
`dist/index.html` first, then re-ratchet with the delta recorded beside the constant — do not
discover this at the end of Phase 2. `HOME_MODULEPRELOAD_MAX = 7` (6 in use) is the second
constant on the same page.

⚠️ **`tests/seo.spec.ts:689` asserts root has EXACTLY three JSON-LD blocks and will fail.**
The test is `home page declares 3 JSON-LD blocks (WebSite + Organization + Dataset)` with a
literal `expect(jsonLdBlocks.length).toBe(3)`. Adding an `ItemList` and per-corpus `Dataset`
nodes trips the count before it trips anything about content. Update it in the same commit as
the body, and keep it a COUNT plus an `arrayContaining` of the required `@type`s so it still
catches a root that has lost its identity nodes — do not relax it to "at least one".

⚠️ **Whatever root emits is also served on every unprerendered route.** `dist/index.html` is
Firebase's SPA fallback, so the ~101k non-prerendered `/person/*` URLs and every other
unmatched path inherit root's body and JSON-LD (`dynamicRoutes.ts:3251` and `:3311` document
this for two other families). Today they inherit an election `Dataset` node; afterwards they
inherit the home body and an `ItemList` of eight destinations. That is an improvement, but it
is a change to ~101k pages' structured data and belongs in the phase's review notes rather
than being discovered later.

**The articles strip is a decision, not a side effect.** `homeBodies`
(`scripts/prerender/routes.ts:549`) is `buildHomeBody(...)` joined with
`buildArticlesSection(...)`, and `tests/perf.spec.ts:30` records that the shell grew partly for
"a richer 'latest analyses' strip". Replacing the body wholesale drops those crawlable article
links from the site's strongest page. Decide explicitly whether the strip survives into the
home body; if it does not, it must appear somewhere the crawler still reaches.

**Add `preloadData` for both artifacts.** The root entry has none today, and
`PrerenderRoute.preloadData`'s own header records the cost: "#root is empty, so a data fetch
is discovered only after the browser has run the entry bundle, the i18n chunk AND the route
chunk — five serial round trips before the first data byte is requested." List
`/home/hub_stats.json` and `/home/feed.json` written exactly as `dataUrl()` receives them.
Two constraints from `CLAUDE.md` apply and both are gated: the emitted href's origin must
match the built entry chunk's resolved `VITE_DATA_BASE_URL` (`scripts/prerender/index.ts`
refuses to write otherwise, and `tests/perf.spec.ts` compares them), and the whole hint set is
a small net loss at 1.6 Mbps — so two paths is the budget, and a third needs re-measuring.

Root `lastmod` points to `data/home/hub_stats.json`. ⚠️ `RouteDef.file`
(`scripts/sitemap/route_defs.ts:1`) is a **single optional string**; there is no "max of
several files" contract, so the earlier draft's parenthetical is withdrawn. `hub_stats.json`
is the right one — it is what the head renders. Add and inspect `public/og/home.png`.

### 11.2 Parliamentary

Move the former root election body, Dataset JSON-LD, canonical, and appropriate
title/description to `/parliamentary`. This is a **permanent** home for them: unlike the
withdrawn `/elections` option, no later plan overwrites this page (§3.2).

- `/parliamentary` sitemap `file:` points at the election artifact the page renders —
  `data/${year}/region_votes.json`, the same file root uses today.
- Its breadcrumb is „Начало → Парламентарни избори"; `/elections/:date` becomes its child
  (§9.2 item 7).
- ⚠️ **`public/og/parliamentary.png` is new capture work with no entry to copy.** The current
  root image `/og/dashboard-2026-04-19.png` is a hand-made legacy asset —
  `scripts/og/capture-screens.ts` contains **no entry that produces it** — so this needs a
  fresh `{slug, routePath, waitFor}` entry with a `data-og` anchor on a data-populated node,
  like every other capture. Do not reuse the global home image, and do not delete the legacy
  file (§3.3).
- ⚠️ **Do not add a `/elections` sitemap `<loc>` or prerender entry.** `{path: "elections/:id"}`
  (`route_defs.ts:791`) already enumerates one URL per cycle, and `/elections` is not a route
  in this plan.
- ⚠️⚠️ **NO GATE WILL TELL YOU IF `/parliamentary` IS LEFT UNDECLARED, because it is an INDEX
  route.** `ogAndSitemapCoverage.test.ts`'s `every routed page is DECLARED` clause reads the
  router through `staticRoutedPages()`, and `scripts/prerender/routerCensus.ts:57` states the
  limit in as many words: *"INDEX ROUTES ARE DELIBERATELY EXCLUDED … a future index route
  under a group would be invisible too."* `/parliamentary` is precisely that future index
  route. Undeclared, it still WORKS — Firebase's catch-all serves the SPA shell — and hands
  every crawler the HOME page's title, description and canonical, which is the
  duplicate-content shape this whole section exists to prevent, with nothing red.

  Two things follow. Declare it by hand in `scripts/prerender/routes.ts` **and** both sitemap
  lists as part of Phase 1 rather than relying on a gate to remind you; and add
  `parliamentary` to the census's declared exceptions (or give `routerCensus.ts` index-route
  resolution) so the next index route under a group is not invisible for the same reason.

### 11.3 Coverage changes

- add `parliamentary` to Bulgarian `routeDefs(year)` and to `ENGLISH_STATIC_PAGES` — ⚠️ **both
  lists**; `route_defs.ts:439` records that this pair has already drifted twice, each time
  giving `/en/<path>` a `<loc>` the canonical Bulgarian URL did not have;
- retain root (`{path: "index"}` and `""`) in both languages with its new meaning and its new
  `file:`;
- run `npm run sitemap` and commit `public/sitemap*.xml` in the implementation phase;
- add both pages to `scripts/prerender/ogAndSitemapCoverage.test.ts`, `scripts/og/capture_routes.test.ts`, and SEO body-length coverage;
- add capture entries in `scripts/og/capture-screens.ts` using stable `data-og` anchors and data-populated wait conditions. The CLI filter is a bare `process.argv.slice(2)` match, so verify the accepted names before wiring §16's commands into anything;
- ⚠️ **`home` also joins `HUB_CAPTURES` in `ogAndSitemapCoverage.test.ts` — a FIFTH registry**
  beyond the four in §14.2. That map is `slug → screen` for every module front page rendering a
  `HubHead`, and its `every HubHead screen is named` clause makes the omission a failure rather
  than a silence (it is what caught `governance-mayor-pay` three days after that screen adopted
  a head). Membership buys four clauses: the card frames `[data-hub-head]`, it is shot at
  `OG_CLIP_VIEWPORT`, it is the corpus's dimensions, and it is **fresher than its screen** —
  freshness compared by git COMMIT time, not mtime, so a head change with no re-shoot goes red;
- ⚠️ **`parliamentary` does NOT join `HUB_CAPTURES`.** `DashboardScreen` renders `PlaceHeader`,
  not `HubHead`, so the head clauses do not apply to it. It needs a plain capture entry and an
  `ogImage` — nothing more. Do not add it to `SUB_PAGE_CAPTURES` either: those are HubHead
  sub-pages, and the file's own comment records that mis-filing a non-head card there turns
  three green clauses red at once;
- ⚠️ **the home card's viewport is a real decision, not a default.** The shared capture context
  is 1280 — exactly Tailwind's `xl` — where `TileHubGrid` renders **four** columns and a 1200 px
  clip "slices the fourth one vertically down the middle" (`capture-screens.ts:57`). Home's
  bands are four-wide by design (§4.2), so either set a sub-1280 `viewport` for three full
  columns, or anchor the clip on `[data-hub-head]` (which `HUB_CAPTURES` requires anyway) so the
  grid is below the fold of the card and the crop never reaches it. Inspect the PNG before
  accepting either;
- run OG capture and sitemap before `npm run build`, because the build copies `public/` to `dist/`;
- open both 1200×630 files and inspect them in light/dark-independent capture styling.

## 12. Generation, refresh, and publication

### 12.1 Full refresh ordering

The required tail of `db:refresh` becomes conceptually:

```text
... destination loaders and generators
db:gen-culture-hub-stats
db:gen-governance-hub-stats
db:gen-home-hub-stats
db:gen-home-feed
person slug/data checks as currently ordered
test:data
```

Do not move governance ahead of a destination it folds. Home runs only after every available
destination artifact and event source.

`scripts/db/refresh_coverage.test.ts` already enforces most of this without new clauses: its
`every db:gen-* script is either registered or a --write-gated verifier` test scans all
`db:gen-*` keys in `package.json`, so both new generators fail the suite until they are in
`REFRESH_GENERATORS`; `every registered db:gen-* generator is run by db:refresh` covers chain
membership; and the registry's own `artifact` / `bucketPath` fields are asserted git-tracked
and publishable. What still needs a deliberate entry is ORDER — add the pair to the ordering
assertions the way `db:gen-declarations-hub-stats` is pinned with an `after:` key, so a future
edit cannot move home ahead of the siblings it folds.

⚠️ Home's stats generator reads `data/macro.json` and destination BLOBS, not only Postgres.
That is compatible with the registry (culture and governance already fold blobs) and with the
standing "no JSON from Postgres" rule, whose sanctioned exception is exactly this shape — a
new small hub aggregate the ingest never produced. It does mean a home artifact can go stale
from a source that no PG loader touches, which is what §12.2's mapping is for.

### 12.2 Watcher/update-skill integration

Update the process-watch runbook so any successful ingest that changes a home source schedules the relevant home generator after all selected downstream skills complete:

- prices/macro → stats + feed;
- procurement/funds/open calls/council/elections/parliament/budget → feed;
- destination hub stats → home stats;
- any home artifact change → include `data/home` in the upload manifest.

Generate once per watcher run, not once after every source. Publication happens after both
files are final, and the publish step is `bucket:sync:paths -- home` **followed by
`bucket:gz`** (§9.3b) — a sync alone reverts the stored gzip. A generator failure leaves the
previous public artifact in place and makes the watcher report red; it must not upload a
half-written file.

### 12.3 Determinism and atomicity

- build in memory, validate, write a temporary sibling, then rename;
- semantic `computedAt` derives from sources;
- sort source records and object keys explicitly;
- validate routes and enum codes before write;
- preserve previous bytes when output is semantically identical;
- `db:check-generated` re-derives and compares the committed files;
- dry-run bucket sync shows only the two expected objects before publication;
- fetch both public object URLs and validate schema/version before browser gates.

## 13. Analytics and success criteria

Use the existing analytics mechanism; do not add a vendor. Record a two-week pre-cutover baseline and the first four weeks after launch.

Events:

```text
home_view                 locale, viewport, homeMode, statsAvailable, feedAvailable
home_tile_open            tileId, bandId, position
home_search_open          input method
home_search_result_open   group, rank
home_feed_open            eventKind, category, rank, dateBasis
home_election_notice_open homeMode
```

No raw query text, person name, company name, municipality selection, or watch subject is sent unless the existing privacy contract already permits it.

V1 success/guardrails:

- at least 35% of non-bounce root sessions open a tile, result, or feed item within four weeks;
- at least five of eight tiles receive meaningful traffic; no single tile exceeds 60% outside `election_live` mode;
- finder p75 result-ready latency below 500 ms on the tested production profile after it is armed;
- root JavaScript and LCP remain within the existing performance ceilings; CLS < 0.1;
- feed has at least three eligible categories in 80% of days where three categories have events;
- source/date correction rate below the agreed editorial threshold after the 30-day replay;
- alert/feed unknown-kind and missing-date-basis counts remain zero.

These are decision inputs, not vanity targets. Low traffic to a tile leads to copy/order review; it does not authorize hiding an important accountability destination without research.

## 14. Test and review matrix

### 14.1 Data gates

`home_hub_stats.data.test.ts` independently re-derives every figure and metric from canonical sources and asserts:

- schema and enum completeness;
- figure uniqueness, correct selector/period/basis/destination;
- **per figure, the emitted `datasetCode`/`sourceUrl` equal the ones on the object the VALUE
  was read from** (§5.2). Asserting a figure's metadata against itself passes on a cross-wired
  pair, which is the live trap: `indicators.unemployment` is `une_rt_q` while the value comes
  from `une_rt_m`, and `indicators.inflation` is captioned "quarterly avg" for a monthly
  observation;
- **no figure id contains `cpi`** — a one-line gate, because `cpi` already names the
  corruption index in this corpus;
- no head/tile duplication;
- all-scope procurement route honesty;
- no overlapping-source sum;
- missing is absent, not zero;
- source availability and size ceiling;
- byte-identical double generation.

`home_feed.data.test.ts` asserts:

- stable unique IDs and allowed routes;
- exactly one honest display date basis per row;
- `firstSeenAt` never replaces known occurrence/publication/effective/deadline time;
- **no stored field is a function of `now`** (§6.1) — enumerate the emitted keys and fail on
  a `daysLeft`/`isOpen`/`closingSoon`/`isRecent` shape, and assert `computedAt` equals the
  maximum source date rather than the run time;
- **generating twice with a moved system clock and unchanged sources is byte-identical.** The
  plain double-generation assertion cannot see a sliding window; this one is what makes §6.6's
  anchoring rule non-vacuous;
- the feed's "see all" destination resolves and is `/data/updates` (§6.7);
- every kind has a source adapter, renderer, translations, and materiality rule;
- bulk loads summarize;
- review-gated kinds do not appear in the public automatic set;
- max rows, category cap/diversity, stable ordering, and byte ceiling;
- no localized prose or unsafe external route in facts.

### 14.2 Unit/component gates

- tile registry/scenes/bands/accent/destination gate;
- `homeFigures` formatting and basis gate;
- full, partial, unavailable, stale, and malformed stats states;
- feed loading/error/empty/backfill/review/date-basis rendering;
- alert-kind exhaustive mapping including `open_call`;
- finder lazy-load, grouping, route, debounce, and cancellation;
- root route renders home; `/parliamentary` renders the preserved country result;
- breadcrumbs, place links, cross-election links, and header active state use the new route contract;
- no tile link carries a `pscope` it did not force, under an inbound scope (§4.2);
- `HomeDashboardScreen` has exactly one `HubHead`/H1/SEO owner and joins **all** the hub
  registries — this is four entries, not one, and three of them are hard suite failures:

| Registry | File | What it buys |
| --- | --- | --- |
| `HUB_SCREENS` | `src/ux/infographic/hubHead.gates.test.ts:123` | the static basis-year scan |
| `HUB_HEAD_SCREENS` | `tests/ui.spec.ts:890` | lets the rendered one-`h1` clause name the screen behind a path |
| `HUB_HEAD_BUDGETS` | `tests/ui.spec.ts:547` | the rendered height ceiling + the `cells` count |
| `hub_finder_single_render.test.ts` | `src/screens/` | one finder per screen, unique `idPrefix` |

⚠️ `tests/ui.spec.ts:1019` asserts `HUB_HEAD_SCREENS` and `HUB_HEAD_BUDGETS` have **identical
key sets**, so neither can gain a member without the other. The budget entry needs `maxPx`,
`measured` (taken at the desktop project's **1280** viewport, not the 1024 `lg` breakpoint —
recording the latter makes a future failure read as growth that did not happen) and `cells`.
`cells` is load-bearing rather than decorative: its own comment records `/subsidies` sitting
at 528 px against a 620 ceiling with its band entirely unwired and every assertion green — a
ceiling cannot see a missing band.

Reference points for sizing: `/governance` 430/500 and `/procurement` 477/540 (compact heads),
`/parliament` 443/520 (head + full `HubSearch`), `/funds` 531/600 and `/consumption` 495/600
(head + a search *tile*). Home is a four-KPI head with a full `HubSearch` and eight tiles
below, so it belongs in the `/parliament`–`/funds` band, not the compact one.

### 14.3 Static/SEO gates

- root and `/en` static bodies describe the global dashboard;
- `/parliamentary` and `/en/parliamentary` static bodies describe the parliamentary country result;
- unique canonical/title/description/H1 for both;
- no `/elections` static page, `<loc>` or OG entry is introduced by this plan (§11.2);
- `tests/seo.spec.ts`'s root JSON-LD block count is updated to the new node set and still
  asserts an exact count plus the required `@type`s (§11.1);
- `/parliamentary` is declared in `scripts/prerender/routes.ts` and in BOTH sitemap lists —
  asserted directly, since the `every routed page is DECLARED` gate is structurally blind to
  index routes (§11.2);
- `home` is in `HUB_CAPTURES` and `parliamentary` is in neither capture map (§11.3);
- both sitemap lists and committed XML contain the right routes;
- every sitemap `file:` exists;
- every OG path exists and capture route is registered;
- root no longer emits election-only Dataset metadata;
- no page falls through to root metadata.

### 14.4 Browser/accessibility gates

Test 390, 768, 1280, and 1440 px; Bulgarian and English; light and dark:

- first screen shows one H1, four KPI cells when data is complete, finder, and the start of primary destinations within the hub height budget;
- DOM and visual order agree;
- keyboard can open finder, traverse groups, open a tile/feed item, and return focus;
- dates, changes, and status do not rely on color/arrows alone;
- SVG scenes and muted text meet contrast; reduced motion is respected;
- skeleton-to-content shift stays below CLS 0.1;
- no console/network errors other than deliberately simulated failure cases;
- all eight tiles, six representative feed items, logo, election breadcrumb, and cross-module paths resolve;
- `/parliamentary` is visually/functionally equivalent to the former root before root cutover,
  and `/parliamentary?elections=<older cycle>` captions the cycle it renders rather than
  silently showing the latest.

### 14.5 Performance gates

- home route stays lazy from the entry graph. ⚠️ `src/entryGraph.test.ts` fails if the entry
  reaches a registry or anything a registry names, so `routes.tsx` must not import a constant
  from `homeRegistry.ts` — the `sectorPacks` precedent put ~265 kB of reference data into the
  entry chunk through exactly one such edge;
- no Leaflet/recharts/d3 election modules join the home initial chunk;
- exactly one **core** translation chunk loads for root (the existing
  `a page load fetches exactly one translation bundle` test counts `/assets/translation-*` on
  `/`; deferred bundles are named after their file — `budget-*`, `methodology-*` — so they do
  not collide, and a `home-*` chunk would be an ADDITIONAL request, not a violation. That
  request is the cost §10 asks you to measure);
- no finder endpoints/catalogs before intent — asserted as **zero `/api/db/` requests** in the
  request log for `/` until `HubSearch` arms (§9.3a);
- one stats and one feed request, independently cacheable, both resolved through `dataUrl()`
  and both preloaded from the root prerender at an origin matching the built entry chunk (§11.1);
- no module under `src/screens/home/**` or `src/data/home/**` contains the string `/api/db`;
- both published objects report `x-goog-stored-content-encoding: gzip` (§9.3b);
- stats ≤16 KiB and feed ≤64 KiB raw;
- head inside its `HUB_HEAD_BUDGETS` ceiling with four `data-kpi-cell` nodes;
- these named constants are measured and re-ratcheted with the delta recorded beside each:
  **`HOME_HTML_MAX_BYTES`** (18 000, ~17.2 kB used — §11.1 will trip it),
  **`HOME_MODULEPRELOAD_MAX`** (7, 6 used), the per-language brotli locale budgets if §10
  bundles home, plus entry-graph and route-chunk budgets.

## 15. Implementation phases

Every phase ends with targeted tests, browser inspection where applicable, focused review, repair, a repeated green gate, and its own commit.

### Phase 0 — contracts, baselines, and alert repair

**Goal:** remove known semantic drift and make success measurable before route work.

Work:

1. Add `homeTypes.ts` with stats/event/date/source contracts. Figure ids use
   `inflation_hicp` (§5.1); no stored field is now-relative (§6.1).
2. Add the exhaustive shared alert-kind registry; include `open_call`; repair icon/style/type
   coverage. The drift is real and located: `scripts/myarea/build_alerts.ts:494` emits
   `open_call`, `MyAreaAlertKind` (`src/data/myarea/useMyAreaAlerts.tsx:17`) omits it, and
   `MyAreaAlertsTile.tsx:152-153` swallows it as `ICONS[e.kind] ?? Activity` /
   `COLOR[e.kind] ?? "#888"`.
3. Replace `staleTime: Infinity` (`useMyAreaAlerts.tsx:86`) with explicit invalidation and
   show refreshed/source basis. This is smaller than it reads: the source is
   `/api/db/myarea-alerts`, which **already returns `refreshedAt`** and is mapped to
   `generatedAt` — so the "preferred" option in §7.2 needs no route change.
4. Capture payload, route chunk, LCP/CLS, root navigation, search, and analytics baselines,
   plus the current `dist/index.html` byte size against `HOME_HTML_MAX_BYTES` so §11.1's
   overrun is a measured delta rather than a surprise.
5. Add fixtures for date-basis, backfill, missing source, and unknown-kind failure.
6. Settle the §6.7 relationship in copy: what `/data/updates` answers and what the home feed
   will answer. No code; it decides Phase 4's rendering.

Exit: builders and UI agree on every current alert kind; baseline report committed; shared types compile in browser and script tests; no visible root change.

Rollback: revert registry/hook changes; no route or data artifact dependency exists yet.

### Phase 1 — preserve the country result at `/parliamentary`

**Goal:** create a parity bridge before root changes meaning. Unlike the withdrawn
`/elections` option, nothing built here is throwaway (§3.2).

Work:

1. Add the index route and lazy boundary under the existing `<Route path="parliamentary">`
   group (`src/routes.tsx:3786`).
2. Point it at the current `DashboardScreen`/`DashboardCards` composition without changing its
   internal result logic. One line — `ElectionScreen.tsx` is already `<DashboardScreen />`.
3. Update the five root-as-election link sites named in §9.2 item 4, plus menu, header
   active-state and accessibility copy.
4. Move election prerender/SEO to `/parliamentary`; add it to **both** sitemap lists; add
   `/og/parliamentary.png` as a NEW capture entry (there is no existing entry to copy — §11.2).
5. Insert `/parliamentary` into `/elections/:date`'s breadcrumb trail.
6. Add route/link parity and browser screenshots against the former root, including
   `?elections=<older cycle>` captioning.
7. Update the elections-hub plan's integration banner so the two files agree on what
   `/elections` is (§3.2).

Exit: every former root election validation passes at `/parliamentary`; no existing deep URL changes; no `/elections` route, `<loc>` or OG entry is created; root still temporarily renders elections until the phase is deployed and verified.

Rollback: remove the route/link changes; root is still the old election page.

### Phase 2 — generated home stats and stable hub shell

**Goal:** launch a useful global home without depending on the news feed.

Work:

1. Implement deterministic stats generator, tests, refresh registry/order (all three
   `RefreshGenerator` fields), and publication.
2. Implement hooks, `HubHead`, four figures, two tile bands, scenes, descriptors, and partial states.
3. Register the screen in all four hub registries (§14.2) with a measured height budget.
4. Decide and measure the home locale bundle question (§10); add route skeleton, analytics,
   accessibility/performance gates.
5. Cut the index route to `HomeDashboardScreen`.
6. Replace root prerender/SEO/JSON-LD/sitemap/OG; add root `preloadData`; re-ratchet
   `HOME_HTML_MAX_BYTES` with the measured delta; retain `/parliamentary` artifacts.

Exit: root is a global, bilingual, indexable hub; `/parliamentary` owns the country result; all eight destinations work; public stats artifact validates; no tile leaks an inbound scope; feed is not required.

Rollback: point index route and root static metadata back to the preserved election screen. `/parliamentary` remains valid and additive.

### Phase 3 — unified finder

**Goal:** make the stable hub useful for direct tasks without loading search corpora at startup.

Work:

1. Implement `homeSearch.ts` and place/people/product sources.
2. Extract/reuse one normalized procurement search request.
3. Add lazy-intent, grouping, keyboard, error, and latency gates.
4. Measure endpoint fanout and result-ready latency before/after.

Exit: representative entities across all five groups resolve; no initial search traffic; p75 target and accessibility gates pass.

Rollback: remove the search slot while retaining head, figures, and tiles.

### Phase 4 — core change feed

**Goal:** publish the first honest feed from mature existing event sources.

Initial adapters: procurement, funds/open calls, council/local events, parliament/election lifecycle.

Work:

1. Implement adapters, stable IDs, date semantics, ranking/diversity, backfill summary, and
   artifact tests. **The window anchors on `computedAt = max(source date)` (§6.6) and no
   stored field is now-relative (§6.1)** — settle both before the first adapter is written,
   because retrofitting them means re-deriving every event id.
2. Register generator/refresher/publication paths. Two entry points, no umbrella (§6.6).
3. Implement feed/card rendering and translations, including the countdown computed at read
   time from `deadlineAt`.
4. Wire the reciprocal `/data/updates` links and the one-sentence axis copy on both pages (§6.7).
5. Replay 30 days and review false dates, duplicates, route quality, and category balance.
   Include a moved-clock rebuild in the replay: same sources, different day, byte-identical
   output.
6. Render the first six below the tile grid only after replay acceptance.

Exit: public feed artifact passes schema/date/diversity/size gates; every rendered fact has a working destination and source basis; no ingest timestamp is mislabeled as occurrence.

Rollback: hide the feed section; stats/grid/search remain independent and the prior feed artifact may stay published.

### Phase 5 — prices, budget, and debt events

**Goal:** cover the highest persistent-interest topics with stricter source-specific gates.

Work:

1. Run the 90-day price threshold replay and approve comparison/sample rules.
2. Add official CPI and qualified basket/promotion events.
3. Add KFP releases, enacted amendments, and structured domestic debt auction/results.
4. Add document-only budget notices without claiming numeric change.
5. Add editorial-review flow for international debt; do not auto-publish until a structured authority exists.

Exit: replay and editorial samples meet accepted correction/volume thresholds; price coverage changes cannot masquerade as price moves; debt/budget date basis is explicit.

**Done 2026-09-01.** Nine adapters in total; five new here — `prices` (basket + promotion, via the committed `data/home/price_events.json`), `macro` (the HICP release, dated by Eurostat's own dataset timestamp out of `state/watch/eurostat.json` rather than by the month it covers), `budget` (promulgated laws as document notices, plus the newest КФП period), `debt` (БНБ domestic auctions) and `intl_debt` (Eurobonds, **`editorial_review`, dropped by `feed.ts` before writing** — `debt-emissions.json` is hand-maintained with no crawler and no watcher behind it). `--include-review` lists what is staged.

Four rules are gated rather than asserted in prose, and three of them were written because review found the defect first:

- **a budget fact may carry no money argument**, and **every event route must resolve against `src/routes.tsx`** — the clause that caught `/budget/documents` and `/governance/debt`, neither of which exists;
- **a promotion's date and its price must describe one listing.** The price passes the deals board's outlier floor; `price_product_days.min_promo_eur` does not. Anchored on the raw minimum the walk-back followed an *excluded* listing's run and published „€1.28, since 31 August" for a level live since 21 August — the artifact's top-ranked row, on recency bought by a price we refused to quote. The field is now `atOrBelowSince`, anchored on the gated price, and it is not the row's date;
- **every placeholder a fact's copy interpolates must be supplied.** i18next v24 defaults `interpolation.skipOnVariables` to true, so a conditionally-spread argument renders the literal `{{yieldPct}}` at a 200 — one БНБ auction away, since 9 of 67 emissions carry no settlement yield. Where a field is genuinely optional the fact takes a second key rather than a conditional argument.

⚠️ **The window ends at the newest OBSERVATION, not the newest date any row carries.** A crawl timestamp cannot be in the future; an event date can — a scheduled election, a forecast period. Each adapter declares its `vintageBasis`, the feed folds `computedAt` from the crawl-based families only, and `sourceCoverage` records both numbers so the fold is auditable. Proved by appending a 2027-06-01 election to the registry: `computedAt` stayed at 2026-09-01, all 28 events survived, and the future row was not published. No corpus-relative clamp works instead — Bulgaria's last two elections are 539 days apart, so any ceiling loose enough for that admits a row a year out.

⚠️ **`feed.ts` refuses to publish an EMPTY artifact**, not merely an empty input. The old guard was on what was built; the artifact is written from what survives the window, and `openCallsAdapter` contributes a crawl date, so a run in which only the crawler moved could write `{"events": []}` over a good file with every gate passing vacuously. And `MAX_PER_CATEGORY_ARTIFACT` caps the tail: without it 24 of 40 rows were council resolutions from three protocols — 21 of them carrying the scraper's literal „(no title parsed)", which is truthy and was being published as the substance of a municipal decision in both languages.

Rollback: disable individual adapters by source registry; other categories continue.

### Phase 6 — watcher integration and operational hardening

**Goal:** keep artifacts current without manual generator memory.

Work:

1. Wire process-watch source mapping and one final home generation step.
2. Add upload-manifest coverage and public fetch/schema checks.
3. Add failure reporting, atomic writes, determinism, and stale-source monitoring.
4. Document operator replay/review/runbook and recovery.

Exit: a controlled source change regenerates exactly the expected home files, publishes them, and is visible in the browser; a failed adapter preserves the prior public artifact and reports red.

Rollback: remove watcher mapping; manual `db:gen-home-*` remains available.

### Phase 7 — personalization evaluation, not automatic delivery

**Goal:** decide whether event-level watchlists are ready.

Work:

1. Measure 30-day event-ID stability across rebuilds/backfills.
2. Prototype subject matching for place/company/institution/product/programme/sector.
3. Test per-subject precision and volume with internal fixtures.
4. Write a separate authorization/product plan for accounts and delivery channels if justified.

Exit: an evidence-backed go/no-go decision. Email/push is not part of this plan’s definition of done.

## 16. Required command gates

Exact test file arguments may be narrowed per phase, but final v1 validation includes:

```bash
# Generate and compare
npm run db:gen-home-hub-stats
npm run db:gen-home-feed
npm run db:check-generated

# Data/unit/route/i18n
npx vitest run scripts/db/tests/home_hub_stats.data.test.ts
npx vitest run scripts/db/tests/home_feed.data.test.ts
npx vitest run src/screens/home src/data/home src/data/alerts
npx vitest run src/ux/infographic/hubHead.gates.test.ts
npx vitest run src/screens/hub_finder_single_render.test.ts src/entryGraph.test.ts
npx vitest run scripts/db/refresh_coverage.test.ts
npx vitest run scripts/i18n/key_usage.test.ts scripts/i18n/bundle_reachability.test.ts
npx vitest run scripts/prerender/ogAndSitemapCoverage.test.ts scripts/og/capture_routes.test.ts

# Publish before live-data browser gates. THREE steps: -j json is transport-only,
# so without bucket:gz both objects are stored and served identity (§9.3b).
npm run bucket:sync:paths -- --dry-run home
npm run bucket:sync:paths -- home
npm run bucket:gz                       # must follow any sync, or the gzip is clobbered
curl -sI https://storage.googleapis.com/data-electionsbg-com/home/hub_stats.json \
  | grep -i 'stored-content-encoding\|content-length'   # expect: gzip

# Write public artifacts before build
npx tsx scripts/og/capture-screens.ts home
npx tsx scripts/og/capture-screens.ts parliamentary
npm run sitemap

# Full rendered gates
npm run build
npm run test:seo
npm run test:perf
npm run test:unit -- tests/ui.spec.ts
```

Before using the block, implement/verify the capture CLI’s accepted route names and the bucket sync path. Do not copy a command into automation until its dry run proves the target set.

For each phase:

1. run generator/unit gates;
2. inspect the exact generated diff and byte sizes;
3. publish only after a dry run;
4. fetch the public object and validate it;
5. render affected routes at required breakpoints/locales/themes;
6. inspect OG images, sitemap, console, and network;
7. perform focused review and repair valid findings;
8. rerun the narrow and affected shared suites;
9. commit the phase separately.

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Root cutover destroys election discoverability | parity bridge at `/parliamentary`, route/link/SEO migration before root switch, seasonal notice |
| Home becomes a list of every dataset | fixed eight-tile registry, two semantic bands, one number per destination at most |
| Head repeats destination dashboards | four disjoint national pulse figures with explicit destination ownership |
| Numbers from overlapping corpora are added | fold destination-owned values only; data tests reject cross-corpus sums |
| “News” is really ingest chronology | separate occurrence/publication/effective/deadline/first-seen fields and labelled rendering |
| Backfill floods the feed | summary mode, backfill flag/penalty, per-category cap |
| Prices generate noisy or false discounts | same-cohort/sample/coverage gates and 90-day replay before launch |
| Debt/budget claims outrun sources | structured domestic auto path; international/numeric ambiguity is editorial-review gated |
| Local feed overrepresents active municipalities | national relevance rule, max two/category, source coverage disclosure |
| Home initial load pulls every search corpus | finder arms on intent; source reuse and request-count tests |
| Static artifacts become stale | refresh registry, watcher mapping, bucket publication, public fetch and freshness monitoring |
| Generator rewrites files daily with no data change | source-vintage computedAt, stable sort, byte-identical determinism gate |
| Alert builder/UI kinds drift again | shared exhaustive registry and builder-to-renderer enumeration |
| Home locale copy bloats core | dedicated `home` bundle, reachability analysis, measured brotli budgets |
| New root ships stale election metadata | atomic prerender/sitemap/OG phase and coverage tests for both routes |
| Unrelated dirty work is overwritten | phase-level status/diff inspection and narrow patches/staging |
| A new `/elections` duplicates `/elections/<latest date>` | not created here; the country result is `/parliamentary` and `/elections` belongs to the elections-hub plan (§3.2) |
| The two plans disagree about what `/elections` is | the elections-hub banner is updated in the same commit as this revision (Phase 1 item 7) |
| A now-relative field freezes into a static artifact | §6.1 bans stored derived time; the moved-clock rebuild gate (§14.1) is what makes the ban testable |
| The feed and `/data/updates` present as rival answers | §6.7 names the axis of each, links them both ways, and keeps rows uncopied |
| An inbound `?pscope` answers for a window a tile has no concept of | §4.2 rules + a tile gate under an inbound scope; the same leak already shipped once on `/governance` |
| Root's byte budget is discovered at the end of Phase 2 | `HOME_HTML_MAX_BYTES` measured in Phase 0 and re-ratcheted in Phase 2 with the delta recorded |
| Home's locale bundle costs the index route a serial hop | §10 makes bundling a measured decision, not an assumption; core is an acceptable outcome |
| The band's metadata is cross-wired to the wrong dataset | §5.2 names a metadata source per figure; §14.1 asserts it against the object the value came from |
| The entry page depends on Cloud SQL being warm | §9.3a caps runtime to two GCS objects and gates zero `/api/db/` before the finder arms |
| 80 KiB of identity JSON is preloaded on the busiest route | §9.3b adds both objects to `bucket:gz` and a stored-encoding check to the publish |
| A later sync silently reverts the gzip | publication is three steps, `bucket:gz` last, in both §16 and the watcher runbook |
| `/parliamentary` ships undeclared and serves the home page's head | declared by hand in Phase 1 and asserted in §14.3 — no gate can see an index route |
| Root's JSON-LD change fails an unrelated-looking SEO test | `tests/seo.spec.ts:689`'s exact count is named in §11.1 and §14.3 |
| The home OG card slices its fourth tile column | §11.3 — head anchor or a sub-1280 viewport, inspected before acceptance |

## 18. Definition of done

V1 is complete only when:

- `/` is the canonical global Bulgaria dashboard and `/parliamentary` is the preserved canonical current parliamentary country result;
- every old deep parliamentary and local-election URL remains valid and reachable;
- root composes `HubHead`, shows four sourced/based pulse figures, one lazy finder, and eight tested destination tiles;
- home statistics and feed artifacts are deterministic, budgeted, registered, refreshed, published, and verified from the public path;
- the first six feed rows obey typed date semantics, source/coverage disclosure, materiality, backfill, diversity, and route gates;
- `open_call` and every other alert kind is exhaustively shared between output and UI;
- no missing source renders as zero and no first-seen timestamp renders as occurrence;
- Bulgarian and English locale parity covers every generated enum/fact kind without localized artifact prose;
- root and `/parliamentary` have unique prerender body, canonical, metadata, sitemap entries in BOTH lists, JSON-LD, and inspected OG images, and root carries `preloadData` for both artifacts;
- no `/elections` route, static page, `<loc>` or OG asset was introduced, and the elections-hub plan's banner agrees;
- the feed is deterministic under a moved clock, stores no now-relative field, and links both ways with `/data/updates`;
- the screen is registered in all four hub registries with a measured height budget and a non-zero `cells` count, and in `HUB_CAPTURES` as a fifth;
- `/` makes exactly two runtime requests, both GCS objects, and no `/api/db` call before the finder is armed;
- both published objects are stored gzipped and verified over HTTP from the path the browser reads;
- loading, partial, error, stale, mobile, keyboard, dark/light, contrast, CLS, LCP, entry-graph, and payload gates pass;
- process-watch can regenerate and publish only the expected home artifacts after an eligible source change;
- launch analytics are privacy-safe and the first four-week review is scheduled/documented;
- no email, push, account, or real-time-delivery promise appears in UI or documentation without a separate approved plan;
- final review finds no unresolved correctness, date/source integrity, accessibility, performance, navigation, publication, or SEO issue.

## 19. Explicitly out of scope

- replacing destination dashboards with home summaries;
- redesigning the full election result hierarchy beyond preserving it at `/parliamentary`;
- creating `/elections` — the cross-kind elections hub is a separate plan (§3.2);
- a live newsroom or general-media aggregation product;
- user accounts, email, push, SMS, or real-time notification infrastructure;
- predicting elections, prices, debt terms, or budget outcomes;
- creating a single total for overlapping public-money sources;
- scraping all 265 municipal feeds into a national feed;
- adding a new analytics/search dependency without a measured need;
- changing canonical source authorities or ingest ownership;
- deleting the historical election OG asset while another route/article references it;
- automatically promoting editorial-review events.
