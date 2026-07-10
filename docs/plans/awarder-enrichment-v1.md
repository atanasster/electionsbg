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
then for prod apply the DDL against the Cloud SQL proxy —
`DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts <file.sql>`
— plus the matching `db:load:*:cloud` if a table's rows changed, and redeploy
`functions:db`. (**Not `db:dump`**: that only `pg_dump`s outward to GCS.)
See reference_pg_query_performance, reference_db_push_cloud.

### P1b — generic competition KPIs + per-buyer KZK (highest value)

1. ~~**Entity-scoped `ProcurementBenchmarksTile`.**~~ **SHIPPED** (`7527bdddd`,
   parity-fixed `a17cbbf11`). `awarder_procurement()` (023) + `company_procurement()`
   (011) emit four competition counts — `bidKnownN`, `singleBidN`, `noCallN`,
   `methodKnownN` — computed IDENTICALLY to the national `procurement_benchmarks`
   (037, ECA SR 28/2023): single-bidder over COMPETITIVE procedures only (excludes
   direct/no-call, method known), no-call by the explicit direct-method list. The
   client uses them directly (no procedureBucket derivation). Verified vs a
   national-style oracle for АПИ: 143/794/71/1108 → single-bid **18.0%**, no-call
   6.4%. (The first cut counted single-bid over all bid-known rows → an inflated
   22.5%; the audit caught it.) RoadsPack deduped to the roads-only "на разпознат
   път" KPI.
   **Prod: DEPLOYED.** Applied 011 + 023 to Cloud SQL via the new surgical
   `scripts/db/apply_functions.ts` (CREATE OR REPLACE only — no destructive
   `db:sync:cloud`, no full reload). Verified end-to-end: `electionsbg.com/api/db/
   company?eik=000695089` returns bidKnownN 794 / singleBidN 143 / noCallN 71 /
   methodKnownN 1108, exact parity with local. `db_routes.js` unchanged (forwards
   the whole jsonb), so no Firebase Functions redeploy was needed.

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

### P4 — НОИ / ДОО pack — SHIPPED (the fund-fusion justified it after all)

The earlier P4 conclusion ("no pack needed") was right on its own terms — НОИ's
procurement taxonomy is legible from CPV + the flow tile, and there's no roads-
style geometry. But it missed the actual differentiator surfaced in competitive
research: we already ingest the **ДОО fund execution** (`data/budget/noi/funds.json`,
via `useNoiFunds`), and **nobody fuses a social fund's execution with its
procurement ledger** (not НОИ's own PDF bulletins, not ИПИ's static deficit
articles, not USASpending / OpenTender / ProZorro, which are procurement-only).
That fusion is domain geometry the generic tiles structurally can't express, so
it passes P4's own test. `NoiPack` shipped:

- `src/lib/noiBenchmarks.ts` — SSA/DRV admin-cost band, CPV→function taxonomy
  (`categoryOfCpv`), and the statutory-supplier context registry
  (Информационно обслужване = systems integrator by law; Български пощи = pension
  delivery under the НПОС чл. 92 mandate expiring 1.07.2026).
- `src/lib/noiAttributes.ts` — pure classification engine (mirrors
  `roadAttributes`): functional categories, supplier dependence, single-bid /
  direct-award, year spine. `buildNoiModel(rows)`.
- `src/data/procurement/useNoi.tsx` — `useAwarderContracts` + scope window +
  `useNoiFunds` join; flattens the latest ДОО year (admin = Персонал + Издръжка
  executed, from B1).
- Tiles (`screens/components/procurement/noi/`): **NoiFundFlowTile** (hero — the
  €12.6bn ДОО the €106M of contracts sits inside, contributions-vs-transfer
  coverage, pension-type split), **NoiCategoryTile** (the industry-function
  breakdown), **NoiAdminBenchmarkTile** (НОИ 0.75% vs SSA ~0.5% / DRV 0.9–1.3%,
  execution-basis; €/pensioner; procurement's share of издръжка = the zIndex
  visibility lens), **NoiStrategicSuppliersTile** (Tussell-style dependence bar
  with the two statutory context chips). `NoiPack.tsx` assembles them.
- Registered `NOI_EIK → NoiPack` in `sectorPacks.tsx`; nav pill "Осигуряване
  (НОИ)" added to `ProcurementNav` `secondaryItems` (`procurement_noi_nav`).

Measured on the corpus: €105.9M / 2282 contracts / 651 suppliers / 2011–2026;
ИТ и системи €29.5M is the largest function; 44% single-bid overall (but the two
statutory suppliers carry the context chip so it doesn't read as scandal); top-8
suppliers = 41% of value. Admin ratio 0.75% lands honestly inside the SSA–DRV band.

### P4b — НОИ ТП map + trend depth (deferred, needs an ingest)

The one enhancement deliberately NOT shipped is the **28-ТП territorial map**
("procurement € / pensioner served per oblast"). It is a genuine Phase-2 because
the data isn't in the repo and faking it would violate the site's honesty
standard:
- Contracts carry no execution-location column (only `awarder_region` = the
  buyer seat = Sofia for НОИ's ЦУ), so a procurement choropleth would be
  Sofia-only and misleading.
- The honest version needs **pensioners-/benefit-recipients-by-ТП** from
  data.egov.bg (НОИ publishes it since 2010) as the denominator, joined to
  title-parsed per-ТП contracts ("ТП на НОИ – Варна" style) — and the ТП-attribution
  coverage must be measured first (same rule as the roads chainage strip).
  Reuse `ProcurementOblastMap` (already metric-generic) once the denominator lands.
- `funds.json` currently covers only **2023–2024**; the admin-ratio and
  €/pensioner *trend* lines want a few more years of B1 backfill (nssi.bg's B1
  URL template is year-parameterised → the `update-noi` skill's parser handles
  prior years).

### Generic follow-ups the second pack now unlocks (optional)

- **Peer scorecard (zIndex 0–100)** vs НАП / НЗОК / АСП rather than the national
  mean — wants to be a *generic* awarder feature (inputs already exist via
  `computeProcurementRisk` + the EU benchmarks tile), with a pack merely pinning
  the peer group. Build generic, not per-pack.
- The `buildRoadsModel` / `buildNoiModel` duplication is now real; the
  `buildAwarderModel(contracts, classifier)` + `SectorClassifier` unification
  below is finally worth doing (two concrete packs to abstract over).

## Generalising the classifier (now that P4 has landed)

`buildRoadsModel` currently fuses parsing + aggregation. Split into:
- `buildAwarderModel(contracts, classifier)` — pure generic aggregation.
- `SectorClassifier` — `{ id, categoryOf, componentOf?, refOf?, unitCostOf?,
  tiles?, insights? }`. `defaultClassifier.categoryOf` = CPV division; roads +
  НОИ implement their own. Only the truly-unique tiles (map, €/km, components)
  are pack-specific; breakdown/time-spine become shared tiles the classifier
  reshapes. Defer the refactor until the second pack forces the abstraction.
