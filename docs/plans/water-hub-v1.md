# /water as a sector hub — plan v1

The /water page is a long single scroll: search, operator map, five procurement tiles,
the НСИ tile, the riverbed tile. This plan turns it into a **sector hub** of the kind
/sector/roads and /culture already are, with the tiles moved onto sub-pages. Before
that, it fixes the data discrepancies the 2026-10-12 audit found.

References:
- `docs/plans/roads-hub-v1.md` (the tier structure)
- `src/screens/roads/*`, `src/screens/culture/*`
- skills `dashboard-hub` and `sector-dashboard`
- prior water plans `water-view-v1.md` and `water-sector-audit-v1.md` (all four of the latter's steps shipped)

## 0. Audit — 2026-10-12, local (5433) and Cloud SQL (5434), read-only

`E` = the 45 EIKs of `WATER_SECTOR_EIKS` (`src/lib/vikReferenceData.ts`).

### What reconciled

- **Hub headline**, `sector_stats.json` water at `basis: procurement`, `tag='contract'`.
  - It equals Σ `amount_eur` over E **to the euro at all 30 scopes**, on local and on cloud.
  - `all` = **€3,326,158,810** over 10,966 contracts. `y:2025` = €557,477,462. `ns:2026_04_19` = €213,610,042.
  - The bucket copy is byte-identical to the committed file.
- **The four EIK copies are in lockstep, and all import the one constant:**
  - generator `SECTOR_EIKS.water`
  - `PROCUREMENT_BUYER_SECTORS.water` → `SECTOR_BROWSE_PACKS.water`
  - `functions/generated/procurement_query.js`
  - `SECTOR_DASHBOARDS` has no water entry, by design.
- **No missing operator.** Name sweeps (`вод|канал|аква|хидро|басейн|пречиств|напоит|язовир`) over awarders outside E find only:
  - РИОСВ and the Басейнови дирекции, which belong to `environment`;
  - КЕВР, which belongs to `energy`;
  - schools, and dead construction firms.
- **Oblast completeness holds:** 27 holding subsidiaries, plus the Sofia concession, plus the Пазарджик exception.
- **Local equals cloud for the set:**
  - contracts, amendments, tenders (8,324, €5.13bn estimated), `fund_beneficiaries` (26 EIKs, €1.41bn contracted / €556M paid);
  - `water_operator_geo` (identical md5);
  - the bodies of `water_operator_map`, `awarder_group_model` and `awarder_procurement` (identical md5).
- **Live prod API** (`water-operator-map`, `awarder-group-model`, `awarder-group-rollup`, `awarder-funds-rollup`) returns the same figures.
- **Consortia:** no double count. 229 carriers hold €517M, and the 630 member rows are €0.
- **All prior findings F1–F5 are fixed**, and their cloud deploy step was run.

### Discrepancies

| ID | Surface | Published | Postgres (local = cloud) | Severity |
|---|---|---|---|---|
| **D1** | `data/water/flood_maintenance.json` → the /water riverbed tile, the AI `vik` tool, and the prerendered /water title, description and body | 688 contracts · **€324.4M** · 184 awarders. Напоителни 86 / €88.1M | 985 · **€427.9M** · 223. Напоителни 117 / €103.0M | **High**: +32%, served live |
| D1a | Same file, its own 688 rows | Σ €324.4M | The same keys now sum to €308.4M: 152 rows re-valued by consortium carrier moves and annex current-value | part of D1 |
| D1b | Riverbed tile at the default scope `ns:2026_04_19` | 9 / €9.16M | 47 / €25.8M | part of D1 |
| **D2** | Riverbed oblast choropleth | SOF €121.2M | 73% of SOF is Напоителни (€88M), placed at its HQ seat although its riverbed works are national | Medium |
| D3 | Operator map | 41 pins, Σ €3,320,186,444 | 45 operators. 4 have no seat (ВиК Свищов, ВКС Пещера, ВиК Добрич ЕООД, ВиК Димитровград), and the gap of **€5,972,366** to the headline is not disclosed | Low |
| **D4** | Headline, the /water tiles, „Топ изпълнители" | All counted as procurement | 18 rows / **€26.98M** are **intra-group loans** (subsidiary → Български ВиК холдинг, „Договор за заем"), plus €3.72M of bank credits. All intra-group rows: 50 / €29.36M (0.88%) | Medium, **needs a decision** |
| D5 | Same | — | 2 rows / €82k where the awarder is its own contractor | Low |
| D6 | `WATER_OPERATORS` status | Only 822106665 and 822106633 are flagged | TR shows Бебреш and Димитровград `in_liquidation`, Дупница `bankrupt`, and Свищов / Добрич ЕООД with no TR row. The comment that Свищов „operates under 200736851" is contradicted by its last contract (2017-02) | Low |
| D7 | `awarder_group_model` local vs cloud | — | Identical totals. 22 supplier display names differ through `min(name)` under different collations, and one cell differs by €1 (float order) | Cosmetic |
| D8 | `company_politicians` | — | 999 vs 995 rows. One water contractor (€778) is linked locally only | Low (known resolve drift) |
| D9 | Contractor keys | — | „ДЗЗД ВМС Пловдив" is keyed `ph-…`, so it cannot be linked. It holds €13.6M all-scope and is #8 in `ns:2026_04_19`. 46 `ph-` rows hold €16.3M in total | Low |

Not reconcilable against PG: `water_stats.json` (НСИ, no PG counterpart) and `rivers.json` (geometry).

### Stale copy (not data, but it ships)

- Prerendered /water "Предстои" still promises НСИ rationing, which already shipped (`scripts/prerender/routes.ts` ~4047/4062).
- The `/governance/sectors` prerender claims „загуби, язовири" (`routes.ts` ~3347/3385), and neither exists.
- `scripts/data_map/model.ts` ~1866: `DATASETS.water` still describes the holding group, and rationing is listed as „planned".
- Stale comments in the `WaterScreen.tsx` header, and in `vikReferenceData.ts:36`, which names a test that does not exist.
- Hub fixtures `GovernanceSectorsScreen.test.tsx:20` and `sectorsHubFigures.test.ts:27` carry €3,273,381,511.

### Root cause of D1

`flood_maintenance.json` and `water_stats.json` have **no regenerator**:
- no npm script;
- not in `db:refresh`;
- no skill and no watcher.

Both were last written 2026-07-12. That is the same "PG-derived committed artifact that does not own its freshness" defect that `hub_stats.json` and the culture blob had.

## 1. Decisions — settled 2026-10-12

| # | Decision |
|---|---|
| W1 | **The hub stays at `/water`.** That is already the governance tile, the sitemap entry and the og target, and culture kept `/culture` the same way. `/sector/water` becomes a literal redirect to `/water`, declared before `sector/:id` so the splat cannot swallow it. |
| W2 | **Intra-group loans, self-contracting and bank credits stay IN the headline.** The headline must equal `sector_stats.all.water` and the register's own basis; changing it would change the basis of the hub tile for every sector. They get a disclosed `#intragroup` section on `/water/procurement`. That set is: 50 rows / €29.36M intra-group (18 / €26.98M of them loans to the holding), and 2 / €82k self-contracting rows. **Amended at T4 (2026-10-13):** the shared `VikContractorHhiTile` deliberately never FILTERS. It LABELS member suppliers „в групата" and states a market-only HHI beside its own when the band differs, a repo-wide rule its header argues for. So the intra-group suppliers are labelled and disclosed, not dropped; at 0.88% they cannot move the band. Bank credits (€3.72M / 9) are external suppliers and stay in the ranking, disclosed on the same card. |
| W3 | **National-scope awarders come off the riverbed choropleth**, Напоителни first. They are shown beside it as a „национални (без място)" bar with the € stated, the same treatment as funds' `placedMoneyPct`. |
| W4 | **EU-funds figures are lifetime**, so they go on `/water/funds` labelled „без период (целият програмен период)", never under a scope toggle. |
| W5 | **Riverbed spend keeps its topic basis** (any awarder, matched by CPV or title), and that basis is named in its own line. It is never a KPI and never summed with the operator figure. |

## 2. Plan audit — gaps found in v1 and folded in below

| # | Gap | Folded into |
|---|---|---|
| G1 | `SECTOR_BROWSE_PACKS.water` lacks `excludeConsortiumMembers`, which roads has. The 630 €0 member rows inflate the „Всички договори" count, so a band tile would land on a different count than the figure beside it. | T1 |
| G2 | **The Vik tiles are SHARED with `VikPack` on `/awarder/206086428`**, which reads the holding universe (28 EIKs). The W2 exclusion must live in the shared model (`buildVikModelFromAggregates`) as an explicit, named set, so both surfaces apply it. The holding's loans to itself are the same intra-group money. Moving the tiles must not break the awarder page. | T3, T4 — **amended at T4:** the shared tile labels rather than filters (see W2), so both surfaces get the label and the market-only HHI with no fork |
| G3 | **The consortium basis of the single-bid KPI was undecided.** `national_competition()` returns both a member-inclusive pair (`singleBid`/`bidKnown`) and an ex-member pair. `awarder_group_model` (the source of `VikCompetitionTile`) counts members. Mixing the two compares different bases (the roads 2026-10-12 lesson). **Rule:** the water rate and its baseline both use the ex-member pair, the same basis as the browse pack after G1. | T2, T4 |
| G4 | KPI 4 (rationing) comes from a committed НСИ file, not PG, so a PG-only blob cannot carry it. | T2: the generator reads `data/water/water_stats.json` as a declared INPUT; the gate pins the blob's value to that file's `latestYear` |
| G5 | **No watcher for НСИ Ecology_9.8.** Nothing flags a new year, so `water_stats.json` would go stale the way the riverbed file did. | T0 |
| G6 | Riverbed staleness was invisible. The tile shows no vintage, so a 3-month-old file read as current. | T0: `generatedAt` + `corpusThrough` in the file, „данни към" on the tile, and a gate failing when the file trails `max(contracts.date)` by more than 45 days |
| G7 | The AI links still send `riverbedCleaning` and `waterServices` to `/water`, which after the split shows neither. | T3: `ai/render/links.ts` and `ai/render/fixtures/subject-destinations.json` → `/water/floods` and `/water/services` |
| G8 | The data map: `DATASETS.water` names the holding, `SOURCE_GROUPS` says rationing is „planned", and `skills: []`. | T0: the copy is fixed and `update-procurement` attached |
| G9 | The hub is unscoped, but an inbound `?pscope` survives through `usePreserveParams`. | T3: no ScopeControl on the hub, and the hub reads no scope hook. Sub-pages resolve the inbound scope per the URL-contract rule |
| G10 | The „Канализация" tile has no data. `water_stats.json` carries `connectedWaterPct` and `wasteTreatmentPct`, not sewerage connection. | §3: the tile is „Водоснабдяване и пречистване" |
| G11 | The prerender says „45 оператора", but the set includes the holding parent, Напоителни and ДП УСЯ, which are not operators. | T3: „45 възложители в сектора, от тях N ВиК оператора", with N derived from `type` |
| G12 | EN mirrors were not mentioned. | T3: `/en/water/*` for the hub and every sub-page (prerender, sitemap and `ENGLISH_STATIC_PAGES`) |
| G13 | The generators run on LOCAL PG while prod serves from Cloud SQL. | T2, T8: before publishing, a recompute of KPI 1 + KPI 3 on cloud must equal the blob (the audit showed local == cloud for the set today; check it, don't assume it) |
| G14 | Dead code after the split: `WaterSearchBox`, and possibly `useVik` call sites, `WaterScreen`. | T5: delete them, with `npm run lint` and `tsc -b` as the check |
| G15 | D5 (self-contracting) and D9 (`ph-` consortium) had no home. | D5 → the `#intragroup` disclosure. D9 → open (§5): re-keying is the `rekey_placeholder_suppliers` chain and moves `/contract/:key` URLs, which is not a hub concern |
| G16 | D7 (collation-dependent supplier names, and a €1 float cell) had no home. | Open (§5). Fixing it needs a deterministic name tiebreak in `awarder_group_model` (061), which affects every group-model page |
| G17 | The D6 liveness change could silently move membership. | T1: verified by re-running `db:gen-sector-stats` and requiring **no diff** |
| G18 | The tile for the Sofia concession had no destination. | §3: `/awarder/130175000?pscope=all` (`SOFIYSKA_VODA_EIK`) |
| G19 | The „Холдингът" tile links to a different universe (28 EIKs vs 45). | §3: tile copy says „холдинговата група (28)", so the figure on the destination cannot read as a contradiction |
| G20 | The order of the riverbed fix vs the hub matters: the prerender reads `flood_maintenance.json` at BUILD time. | T0 ships its own build + deploy, so the corrected figure is live before the redesign starts |
| G21 | The per-function split (`VikCategoryTile`) maps CPV client-side. If the blob re-derives it, the two copies can drift. | T2: the generator imports `src/lib/vikAttributes.ts` (the roads `buildRoadsModel` pattern) rather than restating the mapping in SQL |

## 3. Target shape

### Hub `/water` (unscoped; every scoped link carries `?pscope=all`)

**HubHead**
- eyebrow „СЕКТОР · ВОДИ";
- deck: what a reader can do on the page; `seoDescription` is a different sentence;
- `search` = HubSearch (T5).
- Honest failure line when the blob fails to load.

**KPI band** (4 figures, read aloud as one sentence; each with a `basis` line and its own destination):

1. **€3.33bn ВиК поръчки.** Σ over E at `tag='contract'`; must equal `sector_stats.all.water`. Links to `/water/procurement`.
2. **Single-bid share vs national baseline.** Whole corpus on both sides via `national_competition(NULL, NULL)`, using the **ex-member pair** (G3), stored un-divided. Links to `/water/procurement#competition`.
3. **EU funds contracted / paid.** `fund_beneficiaries` over E, lifetime, with its own basis line. Links to `/water/funds`.
4. **Population under water rationing.** НСИ `rationingPct` for `latestYear`, labelled with that year. Links to `/water/services`.

A `kpiNote` states that the four figures come from different bases and are never summed.

**Evidence rail:** top 5 operators by € (all scope), linking to `/awarder/:eik?pscope=all`. The heading, the rows and the destination are the same set, and these figures appear nowhere else on the head.

**Bands** (3 bands × 4 tiles; each with a description line, a unique accent and its own bespoke scene):

| Band | Tiles |
|---|---|
| **Операторите** — who runs the water | Оператори → `/water/operators` · Карта → `/water/operators#map` · Холдинговата група (28) → `/awarder/206086428?pscope=all` · Софийска вода (концесия) → `/awarder/130175000?pscope=all` |
| **Поръчките** — how they spend | По функция → `/water/procurement#functions` · Конкуренция → `#competition` · Изпълнители и концентрация → `#contractors` · Всички договори → `/procurement/contracts?sector=water&pscope=all` |
| **Услугата и рисковете** — what citizens get | Воден режим → `/water/services` · Водоснабдяване и пречистване → `/water/services#access` · Речни корита → `/water/floods` · Еврофондове → `/water/funds` |

Tiles whose destination a KPI already owns are descriptor-only (`WATER_BAND_TILES`).

### Sub-pages

All sub-pages share a `WaterPageFrame`:
- the page's own Title (matching the prerender);
- a breadcrumb to the hub;
- `ScopeControl mode="toggle"` (only where the page is scoped);
- `useHashScroll`;
- ghost, error and empty states.

| Page | Contents |
|---|---|
| `/water/operators` (existing) | The table, plus the operator map at `#map`. A disclosure line names the 4 unpinned operators and their €5.97M (D3). A liveness column (D6). |
| `/water/procurement` (new, scoped) | The five Vik tiles move here, with the W2 exclusion in the shared model. Sections: `#functions`, `#competition` (with the T4 baseline), `#contractors`, `#concentration`, and `#intragroup` (loans, credits and self-contracting with their €; W2/D5). |
| `/water/services` (new, „без период") | `WaterStatsTile`. The `#access` section covers connection and treatment. |
| `/water/floods` (new, scoped client-side) | `WaterFloodTile` and the map, with the W3 national-awarder split, a basis line (W5) and „данни към" (G6). |
| `/water/funds` (new, „без период") | `VikEuFundsTile` at operator level (W4). |

Literal routes only. Each page has a BG and an EN prerender page.

## 4. Tiers

**T0 — data fixes first (independent of the redesign; ships and deploys alone, G20)**
1. Add npm aliases `water:flood` and `water:stats` for the two writers. Add `generatedAt` and `corpusThrough` to `flood_maintenance.json`, and „данни към" on the tile (G6). Regenerate the file, which closes D1, D1a and D1b.
2. Put the riverbed writer in `db:refresh` as a `REFRESH_GENERATORS` entry after `db:load:pg`, with skip-and-warn preflight. Add an `ORDER_PAIRS` entry.
3. Add a watcher source `nsi_water_stats` (НСИ Ecology_9.8 page fingerprint) mapped to `update-procurement` Step "water", so a new НСИ year is flagged (G5).
4. Gate `water_flood_maintenance.data.test.ts`, mutation-checked:
   - total, count and Напоителни recomputed live from PG;
   - Σ byYear = total;
   - freshness ≤ 45 days behind `max(contracts.date)`.
5. Fix the stale copy:
   - the prerender /water body (and its riverbed figure);
   - „загуби, язовири" on the governance-sectors prerender, BG and EN;
   - data map `DATASETS.water` / `SOURCE_GROUPS` plus its skill (G8);
   - the `WaterScreen` and `vikReferenceData` comments;
   - the two hub fixtures.
6. Publish:
   - `bucket:sync:paths -- water/flood_maintenance.json`, then `db:check-generated`;
   - `npm run build` and `npm run deploy`;
   - verify the live /water description with `curl -sL`.

**T1 — register hygiene** (`vikReferenceData.ts`, `sectorPacks.tsx`)
- Add `status` for Бебреш, Димитровград, Дупница, Свищов and Добрич ЕООД, each with its TR-verified source. Correct the Свищов comment (D6).
- Add `excludeConsortiumMembers: true` on `SECTOR_BROWSE_PACKS.water` (G1). Check that `/procurement/contracts?sector=water&pscope=all` then lands on the count the band tile implies.
- Re-run `db:gen-sector-stats`; it must produce **no diff** (G17).
- Gate: every `status:"active"` row has a contract in the last 36 months or a live TR status.

**T2 — hub figures blob**
- Generator `scripts/db/gen_water/hub_stats.ts` → `data/water/derived/hub_stats.json`.
  - The type lives in `src/data/water/hubStats.ts`: numbers only, pairs un-divided, new fields optional.
  - It imports `vikAttributes.ts` for the function split (G21).
  - `INPUTS` = `contracts`, `fund_beneficiaries`, and `data/water/water_stats.json` (G4).
- Blob contents:
  - KPI 1–4 numerators and denominators, including the ex-member single-bid pairs for both water and national (G3);
  - the top 5 operators;
  - the intra-group, credit and self-contracting € (W2);
  - the riverbed total and vintage;
  - the per-function split;
  - the operator / non-operator split (G11).
- `npm run db:gen-water-hub-stats`. Chain slot after `db:gen-sector-stats`, plus `ORDER_PAIRS` and `REFRESH_GENERATORS` entries.
- Gate `water_hub_figures.data.test.ts`:
  - re-derive every figure;
  - the rejected bases are `notEqual`: all-tag €3.93bn, the holding-only 28, the member-inclusive single-bid pair, pre-annex;
  - KPI 1 == `sector_stats`;
  - KPI 4 == `water_stats.json` latest;
  - byte budget ≤ 5 KB.
- Cloud check before publishing (G13): KPI 1 and KPI 3 recomputed on 5434 must equal the blob.

**T3+T7 — screen and page layer, in ONE commit**
- `src/screens/water/`:
  - `WaterHubScreen`, `waterRegistry.ts` (pure data, copy inline as `{bg,en}`), `waterScenes.tsx` (12 scenes), `WaterPageFrame`;
  - the 4 new sub-pages, with the old `WaterScreen` body split across them;
  - tests mirroring `roads*`: routing, `pscope=all`, `#fragment` existence, scene coverage, unique accents, and both languages.
- `VikPack` keeps working on `/awarder/206086428` with the W2 exclusion applied there too (G2).
- `routes.tsx`: the literal routes and the `/sector/water` redirect (W1). The hub has no scope hook (G9).
- Prerender for the hub and 4 sub-pages, BG and EN (G12), with the corrected operator wording (G11). Then `route_defs.ts`, `npm run sitemap`, and commit the XML.
- AI links → `/water/floods` and `/water/services`, with the fixtures updated (G7).
- og: a hub capture in `capture-screens.ts`; re-shoot and inspect it.
- Gates:
  - `hubHead.gates.test.ts` `HUB_SCREENS`;
  - `ogAndSitemapCoverage.test.ts`;
  - `tests/ui.spec.ts` `HUB_HEAD_BUDGETS` (measured +≤20%, `cells: 4`, `asideRows: 5`) and the path→screen map;
  - `tests/seo.spec.ts` `minBodyChars`.
- Use an import-free path constant so `entryGraph.test.ts` stays green: `vikReferenceData` must never reach the entry chunk.

**T4 — same-window baselines.** On `/water/procurement`, per window: `useNationalCompetition()` with the ex-member pair against a water rate computed ex-members (G3). The rate excludes the W2 set from the HHI and the top-contractors list. Show no baseline rather than a mismatched one, and word risk signals „за проверка".

**T5 — finder.** `waterSearch.ts`:
- a client index over the blob's operators;
- one shared `sharedProcurementSearch` request for contractors and contracts, labelled „в целия регистър".

Delete `WaterSearchBox` and any other dead code (G14), then re-measure the head budget.

**T6 — maps.**
- The D3 disclosure on the operator map.
- The W3 national-awarder split on the choropleth, with a gate that no national-scope awarder's € lands in an oblast.
- The W4 „без период" labels.

**T8 — publish path.** Ship in this order:
1. og;
2. sitemap;
3. `deploy:db`, only if a route changed;
4. `bucket:sync:paths -- water/derived/hub_stats.json water/flood_maintenance.json`, then `db:check-generated`;
5. `npm run deploy`;
6. `curl -sL` the live hub and sub-pages to confirm.

Then add the blob and riverbed regeneration plus the sync line to the `process-watch-report`, `update-procurement` and `update-funds` skills.

**T9 — audit pass.** Run `/audit-sectors water` against the new hub. It checks:
- every destination lands on the same count as its figure;
- honest empty and failed states;
- mobile at 375 px and a11y.

## 5. Open after v1 (not in scope)

- КЕВР benchmarking and tariffs (losses, self-financing).
- МОСВ reservoirs.
- РЗПРН flood-risk.
- A Напоителни pack.
- TR financials per operator.
- D9: re-keying „ДЗЗД ВМС Пловдив" (`ph-`). This is the `rekey_placeholder_suppliers` chain, which moves `/contract/:key` URLs.
- D7: a deterministic name tiebreak in `awarder_group_model` (061). It is corpus-wide.
- D8: `company_politicians` drift, which closes with the next cloud TR / person publish.

Band 3 leaves room for these, but **no tile may promise them**; the „загуби, язовири" over-claim (§0) is exactly that failure.

### Left open by the T9 audit (2026-10-13)

The T9 audit (`/audit-sectors`-style pass, read-only) found every headline figure reconciled
across local PG, Cloud SQL, the blob and the bucket. Fixed in T9: the governance-sectors tile
promising „загуби · язовири", the VikPack КЕВР promise, the operators-table type column and
ex-member map pins, the per-category counts on a second basis, the contractors tile pointing
away from its own figure, the self-contracting gap in the intra-group lead, silent failures in
the rollup and map hooks, the unlisted remainder of the EU-funds list, unplaced riverbed rows
and the Danube agency, and several copy items. Left open, each for a stated reason:

- **Riverbed topic over-capture.** The CPV/title selection admits a few non-riverbed contracts.
  Measured on the top 5: a Bansko ПСОВ + network job (€21.7M), Danube fairway dredging
  (€12.3M) and a Ruse drain/snow-clearing lot (€7.9M), together ~10% of the total. Their
  scale across the remaining 980 rows is unmeasured. Tightening the predicate changes a
  published figure, so it needs its own measured pass.
- **The governance-sectors tile figure is scoped, the hub is not.** Water shows €213.6M at the
  default parliament window and links to an unscoped hub. Roads has the same pattern, so this
  is a hub-wide decision.
- **Heading levels and the shared DataTable's icon-only buttons.** Site-wide patterns, not
  water defects.
- **G19's „(28)" on the holding tile.** Not added: the registry forbids figures in copy. The
  description says „по-тесен кръг от целия сектор" instead.
- **The rationing chart's cabinet colouring.** An editorial question, flagged only.
