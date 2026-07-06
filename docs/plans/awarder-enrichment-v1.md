# Awarder dashboard enrichment — v1

Goal: fold the roads dashboard into the generic awarder page (`/awarder/:eik`)
so one page serves every contracting authority, keep the roads experience (map,
construction categories) as a **sector pack**, and enrich all awarders with the
generic tiles that already existed but were mounted nowhere.

Decisions (agreed): retire `/procurement/roads` into `/awarder/000695089`;
generic category axis = CPV division + curated labels (`cpvDivisionName`);
implement all four phases.

## Shipped (frontend-only, no schema change)

**P1 — generic tiles mounted on the awarder branch** (`CompanyDbScreen`):
- `ProcurementBreakdownTile` kind=`a` ("Какво купува" — CPV divisions + procedure
  mix), reading the breakdown `awarder_procurement()` already emits. Shared
  `toBreakdown()` helper buckets contractor + awarder sides identically.
- `EntityFlowTile` role=`awarder` — buyer→supplier sankey with the MP overlay
  built from `awarder_kindex` linked suppliers (`awarderMpEdges`).
- `CompanyPortfolioTreemap` role=`awarder` — spend composition across suppliers.
- `AwarderTendersTile` — announced-procedures lifecycle (forecast→awarded via ocid).

**P2 — sector-pack seam + roads pack + redirect**:
- `getSectorPack(eik)` registry (`components/procurement/sectorPacks.tsx`) →
  lazy pack component keyed by EIK. Only packed buyers download the corpus.
- `RoadsPack` (`components/procurement/roads/RoadsPack.tsx`) renders the road-
  unique tiles; inherits page scope via a new `useRoads(eik, windowOverride)`.
- `/procurement/roads` → `<Navigate to="/awarder/000695089">`; `RoadsScreen`
  deleted; nav pill + report menu repointed. Route was never in sitemap/
  prerender (dev-gated) → zero SEO impact.

## Remaining — needs DB / migrations / deploy (do with local PG up)

Each item below touches Postgres (new/changed SQL function or column), so follow
the DB workflow: edit `scripts/db/schema/pg/*.sql`, apply to local PG, `EXPLAIN
ANALYZE` on the worst-case entity (add the index if it seq-scans), verify parity,
then `db:push` + functions redeploy for prod. See reference_pg_query_performance,
reference_db_push_cloud.

### P1b — generic competition KPIs + per-buyer KZK (highest value)

1. **Entity-scoped `ProcurementBenchmarksTile`.** Today the tile draws single-bid
   % and no-call % on the EU red-line scale for the national window. Give it an
   entity mode: extend `awarder_procurement()` to also return, on `tag='contract'`
   rows:
   - `singleBidShare` — contracts with `number_of_tenderers = 1` ÷ contracts with
     a known tenderer count (competitive procedures only). Denominator excludes
     direct awards.
   - `directShare` — € on direct-negotiation / no-prior-publication methods ÷
     total € (procedure-method basis, same buckets as `procedureBucket`).
   - `bidCoverage` — share of € with a known tenderer count (honesty line; bid
     counts only exist on the ЦАИС-era feed).
   These are the same definitions `roadAttributes` computes client-side — the SQL
   must match so АПИ shows one number regardless of path. Mount the tile on the
   awarder branch for **every** awarder (not just packed ones). This retires the
   roads-only single-bid/direct KPIs into a generic tile; RoadsPack can keep the
   "на разпознат път" ref-coverage KPI (genuinely roads-only).

2. **Per-buyer KZK appeals tile.** New `kzk_buyer_summary(eik)` jsonb fn over
   `kzk_appeals WHERE buyer_eik = $1`: `{ complaints, resolved, upheld, rejected,
   suspended, byYear[], recent[] }`. Index `idx_kzk_appeals_buyer` already exists.
   New `<AwarderAppealsTile eik>` (model it on `RecentAppealsTile`) in the awarder
   lifecycle section, next to `AwarderTendersTile`. Renders nothing when the buyer
   has no appeals. This is the "КЗК arbitrations for all awarders" ask.

3. **`CompanySectorRankTile` on the awarder side (optional).** Buy-side sector
   percentile — needs a buyer-analogue of `sector_contractor_stats`
   (`sector_awarder_stats` matview). Lower priority; defer unless asked.

### P3 — roads-specific enhancements (client-side, reuse the roads engine)

Add to `RoadsPack` / `buildRoadsModel` (`src/lib/roadAttributes.ts`), no backend:
1. **Chainage coverage strip** — per motorway (A1/A3/Хемус…), a km-axis showing
   which segments have had contracts + spend density. Reuses `lengthOf()`/chainage
   parse; reveals unbuilt gaps. Highest signal.
2. **Capital-vs-maintenance ratio over time** — one trend line from the existing
   `WorkGroup` split (build+rehab vs maintenance) per year. Cheap.
3. **ОПУ regional-maintenance competition heatmap** — per-oblast single-bid share
   on regional-upkeep lots, from `regionOf()`. Surfaces captured local markets.
4. **Repeat-winner-on-corridor** — same contractor taking consecutive lots on one
   corridor; pure aggregation over `model.rows`.
5. **€/km international benchmark band** — turn the static "key factors" text into
   a visual: plot corridor €/km against World Bank/ROCKS ranges by class + tunnel/
   bridge premium.
6. **Forecast-vs-actual per corridor** via `tenders.ocid → contracts.ocid` — flag
   coverage-limited (roads ocid join is ~11–23%; present honestly, not headline).

### P4 — second sector pack: НОИ / ДОО (proves the seam)

Register a second EIK in `sectorPacks.tsx` with a `NoiPack`. **Derive the taxonomy
from the real corpus first** (sample its top contracts + CPV mix via
`/api/db/awarder-contracts?eik=<НОИ>`) rather than guessing — candidate buckets:
IT / pension-payment systems · postal delivery of pensions · facilities / real-
estate · medical assessment (ТЕЛК) · other. Same pack contract (`{eik, window}`),
its own classifier + tiles, no new generic components. Acceptance test: the pack
drops in with zero changes to `CompanyDbScreen`.

## Generalising the classifier (when P4 lands)

`buildRoadsModel` currently fuses parsing + aggregation. Split into:
- `buildAwarderModel(contracts, classifier)` — pure generic aggregation.
- `SectorClassifier` — `{ id, categoryOf, componentOf?, refOf?, unitCostOf?,
  tiles?, insights? }`. `defaultClassifier.categoryOf` = CPV division; roads +
  НОИ implement their own. Only the truly-unique tiles (map, €/km, components)
  are pack-specific; breakdown/time-spine become shared tiles the classifier
  reshapes. Defer the refactor until the second pack forces the abstraction.
