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
- `AwarderAppealsTile` — per-buyer КЗК appeals (total / upheld / suspended +
  recent list), via the generic `/api/db/table` engine scoped by `buyer_eik`
  (`useAwarderAppeals`). No new endpoint or migration — `aggregates.count` gives
  the totals. Every awarder with appeals gets it.

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

1. ~~**Entity-scoped `ProcurementBenchmarksTile`.**~~ **SHIPPED** (`7527bdddd`).
   `awarder_procurement()` (023) + `company_procurement()` (011) now return
   `bidKnownN` + `singleBidN`; the client derives single-bid share from them and
   no-call from the procedure buckets, feeding the reused tile (now takes optional
   entity `data`) on `/awarder/:eik` + `/company/:eik`. АПИ single-bid 22.5% =
   191/849, parity with the roads model. RoadsPack deduped to the roads-only "на
   разпознат път" KPI.
   **Prod:** needs `db:push` + functions redeploy for the new jsonb fields; until
   then the tile hides itself (bidKnownN absent → below coverage floor).

2. ~~**Per-buyer KZK appeals tile.**~~ **SHIPPED** without a migration — the
   generic `/api/db/table` engine already scopes `kzk_appeals` by `buyer_eik` and
   returns `aggregates.count`, so `AwarderAppealsTile` needs no `kzk_buyer_summary`
   fn. If a byYear breakdown or single-round-trip is later wanted, add the jsonb fn
   then; not required for the current tile.

3. **`CompanySectorRankTile` on the awarder side (optional).** Buy-side sector
   percentile — needs a buyer-analogue of `sector_contractor_stats`
   (`sector_awarder_stats` matview). Lower priority; defer unless asked.

### P3 — roads-specific enhancements (client-side, reuse the roads engine)

Add to `RoadsPack` / `buildRoadsModel` (`src/lib/roadAttributes.ts`), no backend:
1. **ОПУ regional-competition heatmap** — **SHIPPED** (`d48cf56b1`,
   `RoadRegionCompetitionTile`). Single-bid share per oblast directorate from
   `model.regions`, green→red, sized by €.
2. **Repeat-winner-by-corridor** — **SHIPPED** (`d48cf56b1`,
   `RoadRepeatWinnersTile`). Corridors where one contractor holds ≥40% of the money
   over ≥2 contracts, from `model.rows`.
3. **Chainage coverage strip** — **SHIPPED** (`386ebf56e`,
   `RoadChainageStripTile`). Per-motorway km-axis spend-density heat strip;
   `lengthOf()` now returns absolute `kmFrom`/`kmTo`, and a per-motorway
   plausible-length cap (`MOTORWAY_MAX_KM`) rejects km markers borrowed from
   cross-referenced roads (fixed Струма 442→78 km).
4. **€/km international benchmark band** — **SHIPPED** (`386ebf56e`,
   `RoadCostBenchmarkTile`). Corridor p25–p75 IQR + median vs ROCKS/BG/RO/GR.
5. **Capital-vs-maintenance ratio over time** — deferred (overlaps
   `RoadTimeSpineTile`'s category mode).
6. **Forecast-vs-actual per corridor** — **decided out.** Measured: only 112 of
   АПИ's 2034 contracts (5.5%) join a tender via `ocid`, so a corridor grid would
   be mostly empty. `AwarderTendersTile` already shows the honest entity-level
   forecast→actual; a corridor breakdown would add noise, not signal.

### P4 — prove the seam (НОИ / ДОО) — DONE, and the finding is "no pack needed"

Verified `/awarder/121082521` (НОИ, 2279 contracts). It renders the **full generic
enrichment with zero new code**: CPV "Какво купува", EU benchmarks (single-bid
42.3% — red, worse than roads' 22.5%), money-flow sankey (→ Информационно
обслужване АД, Български пощи — its IT + postal spend surfacing naturally),
treemap, tenders, КЗК appeals. No roads pack (correctly).

Conclusion: **a sector pack is only warranted when a buyer needs domain-specific
geometry the generic tiles can't express — i.e. the roads network map.** НОИ/ДОО's
"taxonomy" (IT / postal / facilities / ТЕЛК) is already legible from CPV divisions
+ the flow tile, so it needs no `NoiPack`. The seam exists (`sectorPacks.tsx`) for
the next buyer that genuinely does — register an EIK + a `<Pack eik window/>` and
it drops in with no `CompanyDbScreen` change. The `buildAwarderModel` /
`SectorClassifier` refactor below is only worth doing once such a second pack
actually materialises.

## Generalising the classifier (when P4 lands)

`buildRoadsModel` currently fuses parsing + aggregation. Split into:
- `buildAwarderModel(contracts, classifier)` — pure generic aggregation.
- `SectorClassifier` — `{ id, categoryOf, componentOf?, refOf?, unitCostOf?,
  tiles?, insights? }`. `defaultClassifier.categoryOf` = CPV division; roads +
  НОИ implement their own. Only the truly-unique tiles (map, €/km, components)
  are pack-specific; breakdown/time-spine become shared tiles the classifier
  reshapes. Defer the refactor until the second pack forces the abstraction.
