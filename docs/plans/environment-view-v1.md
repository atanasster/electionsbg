# Околна среда (Environment / МОСВ) sector view — v1 plan, competitive research & brainstorm

Status: **BUILT & SHIPPED — Phase 0 + Phase 1 live at `/sector/environment`.** (2026-07-16) Two audit
passes (see §0.5) preceded the build; all findings were folded in. Shipped: the 27-EIK group dashboard +
the bespoke `EnvironmentPack` (air-station map hero, money-vs-outcome, EU-funds absorption by OP code,
МОСВ budget bridge, GF05 EU-peer strip, what-МОСВ-buys with CPV-coverage disclosed, HHI, per-unit
competition, universe Select, 27-awarder tile). Verified in-browser (desktop + 375px, light + dark; 0
console errors; `?sector=environment` browse filter works). **Phase 2 (partial) also shipped:** the
**waste/recycling-vs-EU-target tile** (`scripts/environment/fetch_waste.ts` → `data/environment/waste.json`
from Eurostat `cei_wm011`/`env_wasmun`; `useWaste` + `EnvironmentWasteTile`). Signature finding: BG's
municipal-recycling rate **peaked ~35% (2020) then fell to 16.7% (2023)** — 38pp below the 55% 2025
target and well under the EU average (~48%), while waste-per-capita rose to 490 kg. The **`eurostat_env` watcher** is also wired
(fingerprints `cei_wm011`, registered + placed in the data-map `eurostat` source group; on a new release
its `describe()` tells the operator to run `fetch_waste.ts`). Deferred to Phase 2/3: ПУДООС grant register
(PG), Natura strip, AI tools, the `update-environment` skill (the watcher currently instructs a manual
fetch), README/data-map dataset+edge, `db:gen-sector-stats` rerun for the hub € badge (needs live PG), a
dedicated air-map OG capture, and `bucket:sync` of `data/environment/` for prod.
Closest built siblings to copy: the **energy / security group dashboards** (`sectorDashboards.ts` +
`SectorAwardersTile`) for the cheapest Phase-1 group ship, the **water pack** (`VikPack` +
`VikEuFundsTile`) for the EU-funds + sector-map grammar, and **transport** (`data/transport/*.json` +
`SectorPointMap` + `useRailSubsidy`) for the "tiny static-JSON outcome series beside the money" pattern.

> Corpus € are **MEASURED** from `data/procurement/derived/awarders_index.json` (dict → `awarders`
> list, 4,398 rows; each row `{eik, name, totalEur, contractCount, tier}`), scan dated 2026-07-16.
> €m = per-row `amountEur`, the PG basis. Budget / COFOG / waste figures are **EXTERNAL** (State
> Budget Law, Eurostat) and MUST carry a source chip, kept clearly separate from measured ЗОП money.

---

## 0. The one-line thesis

**GF05 „Опазване на околната среда" is the last untouched top-level COFOG function in the app — an
entire €0.64bn/yr function with zero coverage. And it is the one sector where we already measure the
outcome: we ingest the air.** МОСВ is the only ministry where Наясно can close the loop the whole
genre is missing — **put the money next to the result**: ПУДООС grants + ОП „Околна среда" EU money +
МОСВ/ИАОС procurement on one side, and the **measured PM10/PM2.5 levels we already hold** (`data/air/
index.json`, from ИАОС — an МОСВ agency; ⚠ a current SNAPSHOT vs the EU limit, **not yet a multi-year
trend** — see §0.5) plus recycling-rate-vs-EU-target on the other.

Positioning: **"Парите за чист въздух — и въздухът."** No Bulgarian portal ties environmental spend to
a measured environmental outcome. sigma.midt.bg re-skins the same АОП data; ИПИ/IME
([[project_competitor_ime]]) do fiscal transparency but never join money to air quality or recycling.

The signature structural finding, measured against the corpus:

| Entity | In АОП corpus | Reality |
|---|---|---|
| **ИАОС** (the air-quality monitoring body) | **€75.9M / 733 contracts** | Nearly the size of the whole ministry (€82.7M) — the agency that produces the very PM10 series we render is itself a top-tier buyer. Money and outcome share one owner. |

Completing GF05 also finishes the COFOG top-level map: every function (GF01–GF10) then has at least
one sector view.

---

## 0.5 Audit & data verification (2026-07-16 — pre-build pass, no code committed)

A full data + template audit was run against the live repo before any build. Findings below are
**load-bearing corrections** to §§3/5/6 — read these first; they change what Phase 1 can ship.

**Verified accurate (build on these as-is):**
- **Corpus € per EIK** — `awarders_index.json` (4,398 rows) confirms МОСВ €82.72M/691, ИАОС
  €75.89M/733, ПУДООС €9.25M/65, НП Рила €10.79M/35, НИМХ €4.18M/129. The signature ИАОС≈МОСВ
  finding holds.
- **Air-station geocode** — `data/air/index.json` has **37 foreground stations** (35 with PM10) on
  **26 distinct obshtina codes**; **25/26 join `data/municipalities.json` centroids** cleanly
  (`obshtina`→`loc` `"lng,lat"`). **Only `SOF00` (Столична) misses** — municipalities.json has no
  Столична row, so pin a one-line override `SOF00 → [23.3219, 42.6977]`. The **14 background stations
  carry an empty `obshtina`** → omit from the map (footnote), confirming open-question 5.
- **EU-funds absorption** — `data/funds/derived/absorption.json` `byProgramme[]` (46 programmes)
  carries **all five** env codes: `2014BG16M1OP002` (ОПОС 2014-20, €1.709bn, **95.08%**),
  `2021BG16FFPR002` (ПОС 2021-27, €1.763bn, **17.79%**), plus `BGENVIRONMENT` (€11M, 95.48%),
  `MODAIRN` (air quality, €19M, 0%) and `PEST` (pesticides, €29M, 0%). The MODAIRN air grant is
  on-thesis for the air loop.
- **COFOG GF05** — `data/cofog.json` `peers.GF05 = {year:2024, bgPctGdp:0.6, euAvgPctGdp:0.8,
  rank:17, total:26, top:{geo:"NL", pctGdp:1.6}}`. The peer series key is **`EU27_2020`** (not
  `EU27`); `peerSeriesByYear[2024].BG.GF05 = 0.6`. The EU-peer tile clone works unchanged with
  function code swapped to `GF05`.
- **МОСВ budget node** — `admin-ministerstvo-na-okolnata-sreda-i-vodite.json` has the 2018→2025
  `years[]` with `expenditure.amountEur` + the 3 policy programs. Budget-bridge tile renders as planned.
- **Template** — transport is the exact clone target. `SectorDashboardScreen` mounts
  `getSectorPack(config.leadEik)` passing `{eik, scopeWindow}`, so registering
  `[MOSV_EIK]: EnvironmentPack` in `PACKS` (sectorPacks.tsx) makes the pack the whole dashboard body.

**⚠ CORRECTIONS — the plan is wrong on three mechanisms:**
1. **No air TIME SERIES exists.** `air/index.json` stations carry only `latestReadings` +
   `maxObserved` (snapshot `snapshotAsOf: 2026-03-31`), **no annual/historical trend** (`history7d` is
   absent in the current file). So **tile 3's "measured PM10/PM2.5 trend" is NOT buildable from
   `data/air`.** Redesign tile 3 honestly: pair the **budget/spend trend (money, multi-year)** with the
   **current measured national PM10/PM2.5 mean vs the EU limit (outcome SNAPSHOT, not a trend)**, framed
   "€X on monitoring & clean-air — here is where the air stands vs the 50/25 µg/m³ limit." A real
   money-vs-outcome *trend* needs a Phase-2 ingest of the ИАОС annual series (see §3 addendum).
2. **`useFundsAbsorption()` does not exist.** No such hook in `src/data/funds/` (only
   `useFundsProgramSummary`, `useFundsTaxonomy`, …). The absorption data is the **static JSON
   `data/funds/derived/absorption.json`** — the env EU-funds tile should fetch it directly
   (React Query, `staleTime:Infinity`, `dataUrl("/funds/derived/absorption.json")`) and filter
   `byProgramme` to the five env codes. This is *simpler* than the plan (no server call at all), and
   OP-code join is exact. Transport's `useTransportFunds` uses a different path
   (`/api/db/awarder-funds-rollup`, per-beneficiary EIK) — **do NOT copy that**; use the JSON.
3. **All 18 `TILE_ACCENTS` tokens are already used** by the sector registry (clay/teal/steel/amber/
   olive/rose/green/emerald/brass/azure/indigo/moss/plum/gold/terracotta/copper/aqua/slate). Env needs a
   **genuinely NEW token** added to `src/ux/infographic/tileAccents.ts` — a nature/leaf green distinct
   from edu's `green` (#3a7a5e), defense's `moss` (#6e845d) and water's `teal`. Proposed:
   `leaf: "#5a9e3d"` (a brighter yellow-green); eyeball on both grounds per the file's contrast note.

**EIK count clarification:** the env-core group is **27 EIK** as enumerated in §1 (3 core + 3 parks +
1 meteo + 4 basin + 16 РИОСВ), not "~24" — the group-total € (~€216M) is unchanged; fix the label.

### Second audit pass (2026-07-16, later same day — deeper cross-reference sweep)

A second, deeper audit re-checked every figure and every component/hook/script the plan names. Three
**new material findings** on top of the three above:

4. **⚠ THE MEASURED € ARE ALREADY STALE — the corpus refreshes intra-day.** `awarders_index.json` was
   **regenerated at 23:10 the same day** (EOP gap-fill + tender refresh; 4,398→**4,400** rows) *after*
   the plan's figures were taken. Re-measured now: **МОСВ €82.72M→€88.04M** (707 contracts), **ИАОС
   €75.89M→€75.95M**, **ПУДООС €9.25M→€13.52M (+46%)**, and the **group total €216.4M→≈€226.6M**. No
   duplicate-EIK artifact (4,400 rows = 4,400 distinct EIK). **Consequences:** (a) every € in this plan
   is *as-of-a-timestamp*, not frozen — **re-measure at build time** and label the source-date; (b)
   tile 5's framing "the fund is small in procurement (€9.25M)" must become **€13.5M**; (c) the ИАОС≈МОСВ
   headline still holds directionally but is now **€76.0M vs €88.0M** (ИАОС ≈ 86% of the ministry, was
   ~92%). Do NOT hard-code any of these into `environmentReferenceData.ts` — keep it EIK-only, figures
   live from the model, exactly like transport.
5. **⚠ `PassThroughHero` DOES NOT EXIST.** §6 lists it as a "reuse as-is" (`src/screens/components/
   procurement/PassThroughHero.tsx`, "built once by the social-assistance plan"). A repo-wide grep finds
   **zero** references — the social-assistance plan is itself unbuilt, so the component was never
   written. **Drop the PassThroughHero reuse claim** (or build the hero from scratch and own it here); it
   is not a free reuse. The money-strip can be a plain KPI/`StatCard` band instead.
6. **CPV coverage — RESOLVED at build (the "<half the money" worry was UNFOUNDED).** The per-awarder
   `breakdowns/a/*.json` `cpvKnownEur/totalEur` reads low (МОСВ 46%, ИАОС 39%, ПУДООС 33%), BUT the
   **group-model** builder (`buildAwarderModelFromAggregates`) folds no-CPV value into a `cpv=""` bucket
   → the classifier's `"other"` sink, so **the category tile's categories sum to the FULL group total**
   (`model.totalEur`), not to cpv-known only (awarderModel.ts L396-397). Measured live: the „Друго/Other"
   share is only **~15% all-time** (so ~85% is classified into a named function), not >50%. The two
   `cpvKnownEur` metrics differ because the breakdown file uses a stricter CPV-validity rule over a
   different row set. **Action taken:** the shipped tile discloses the classified share ("X% от
   стойността е класифицирана по функция; останалото е в „Друго“ — договори без CPV код или извън тези
   категории"), which is accurate for either denominator.

**Minor path/name corrections (fix inline where the plan cites them):**
- `useAwarderGroupModel` is at `src/data/procurement/useAwarderGroupModel.**ts**` (not `.tsx`).
- `fetch_cofog.ts` lives at **`scripts/macro/fetch_cofog.ts`**, not `scripts/transport/` (§3 Tier B).
- The prerender build guard is an **inline throw** (`prerender SECTOR_PAGES missing sector(s): …`), not a
  named `assertAllSectorsHavePrerenderCopy` function (§§4/9) — the guard is real, the name is wrong.

**Newly confirmed solid (no change needed):**
- **All 27 core EIKs present** in the corpus; **Universe B** parks present too (Витоша €1.92M, Странджа
  €1.52M) — the nature-parks extension is viable.
- **Tile 2 needs NO server route** — `SectorPointMap` takes a `points[]` prop and has client-fed
  precedent (WaterOperatorMap, CourtLoadMap, ExciseWarehouseMap, NzokHospitalMap). Feeding it
  air-station points computed client-side from `air/index.json` + `municipalities.json` is sound.
- Every other named artifact exists: `absorption.json` (all 5 OP codes), `useCofog`
  (`src/data/macro/useCofog.tsx`), `useBudget`, `VikContractorHhiTile`, `MvrEuPeerTile`, `euFlags.tsx`,
  `PackSection`, `StatCard`, `packInsights`, `ScopeControl`, `useScopeWindow`, `SectorAwardersTile`, the
  `awarder_group_model` SQL fn (migration 061), the `eurostat_rail` watcher + `data_map/model.ts` to
  mirror, and the AI `airQuality` tool (registry ~4346) + its router block (~3426).

---

## 1. Entities — the FROZEN EIK allowlist (measured 2026-07-16; re-measure at build — §0.5 pt 4)

Curate **by EIK allowlist, never a name regex** — a "околна среда" / "парк" sweep hits the
**historical-monument museum** „Шипка — Бузлуджа" (`000804161`, €7.1M, a national-**park-museum**, NOT
an МОСВ directorate) and the **forestry** РДГ (under МЗХ, not МОСВ). Every entity below is
EIK-verified from the corpus; no alias-EIK duplicates exist for the core bodies.

### Universe A — Environment core group (the МОСВ system, roll these up)

| Universe | Entity | EIK | Corpus €m | n |
|---|---|---|---:|---:|
| ministry | **Министерство на околната среда и водите (МОСВ, lead)** | **000697371** | 82.7 | 691 |
| agency | **ИАОС** — Изпълнителна агенция по околна среда (air/monitoring) | **831901762** | 75.9 | 733 |
| fund | **ПУДООС** — Предприятие за управление на дейностите по опазване на околната среда | **131045382** | 9.25 | 65 |
| parks | Дирекция „Национален парк Рила" | 101157692 | 10.8 | 35 |
| parks | Дирекция „Национален парк Пирин" | 101549540 | 8.44 | 46 |
| parks | Дирекция „Национален парк Централен Балкан" | 107061359 | 7.71 | 67 |
| meteo | **НИМХ** — Национален институт по метеорология и хидрология | 000663814 | 4.18 | 129 |
| basin | Басейнова дирекция „Черноморски район" (Варна) | 103776654 | 1.58 | 18 |
| basin | Басейнова дирекция „Дунавски район" (Плевен) | 114597909 | 1.56 | 10 |
| basin | Басейнова дирекция „Източнобеломорски район" (Пловдив) | 115756766 | 1.54 | 18 |
| basin | Басейнова дирекция „Западнобеломорски район" (Благоевград) | 101619985 | 0.76 | 9 |
| riosv | 16 × РИОСВ (regional inspectorates) — see below | (16 EIKs) | 11.96 | 119 |
| — | **Env-core group total (27 EIK — §0.5)** | — | **≈216.4** | **1,940** |

**16 РИОСВ** (regional inspectorates on environment & water). 8 carry the city in the name; 8 are the
generic „Регионална инспекция по околната среда и водите" and were disambiguated via
`data/procurement/derived/buyer_oblast_map.json` (each `distinct:1`, no collision):

| РИОСВ | EIK | €m | РИОСВ | EIK | €m |
|---|---|---:|---|---|---:|
| Русе | 000530415 | 4.32 | София | 000776025 | 1.64 |
| Варна | 000093339 | 1.42 | Бургас | 102007021 | 1.19 |
| Пловдив | 000471013 | 0.96 | Благоевград | 000024617 | 0.73 |
| Монтана | 000320510 | 0.18 | Смолян | 000614817 | 0.66 |
| Стара Загора | 000817529 | 0.16 | В. Търново | 000133513 | 0.20 |
| Пазарджик | 000351519 | 0.14 | Хасково | 126004380 | 0.13 |
| Враца | 000193955 | 0.06 | Плевен | 000414414 | 0.07 |
| Перник | 113594988 | 0.05 | Шумен | 000932129 | 0.06 |

> Caveat to bake into `environmentReferenceData.ts`: РИОСВ seats derived from `buyer_oblast_map` are
> **delivery-location NUTS3, not registered seat** (named row Русе `000530415` maps geo→Силистра).
> The 8 named rows are trusted by name; the 8 generic rows by geo. Pin all 16 EIKs as literals.

### Universe B — Optional "protected areas" extension (nature parks; decide at Phase 2)
11 Дирекции на природни паркове (Витоша `130044740` €1.45M, Странджа `102664798` €1.52M, Българка,
Шуменско плато, Русенски лом, Персина, Сините камъни, Беласица, Врачански балкан, Златни пясъци,
Рилски манастир) — МОСВ-adjacent, ~€12.5M / ~218 combined. Include as a `nature_parks` universe if the
view wants "protected areas" beyond the 3 national parks; a `Select` isolates them. **Recommendation:**
fold into the group in Phase 2 as their own universe (they are МОСВ regional bodies), footnoted.

### Universe C — Adjacent-but-EXCLUDED (cross-link, never in the rollup)
- **Forestry (МЗХ, not МОСВ):** Изпълнителна агенция по горите `121486802` (€6.83M) + 16 РДГ
  (€1.3–3.9M each). This is **agriculture-universe** — cross-link only, never in the env total.
- **Шипка — Бузлуджа park-museum** `000804161` (€7.1M) — historical monument, keyword false-positive.
- **ВиК / Напоителни** — the existing `/water` view. Environment = pollution/waste/nature; water =
  water-supply utilities. **Cross-link, do not overlap** (§6). The ОП „Околна среда" водни-цикъл
  projects belong to `/water`'s tile; environment claims the air/waste/nature slices of the same OP.

---

## 2. Competitive research — best-in-class environmental-transparency dashboards

Surveyed 2026-07-16. The genre splits into **outcome portals** (air, waste, nature — rich on results,
silent on money) and **money portals** (procurement/EU-funds — silent on outcomes). Nobody joins them;
that gap is our thesis.

| Source | What's world-class | Adopt for МОСВ |
|---|---|---|
| **EEA — European air quality index / Air Quality Viewer** ([eea.europa.eu](https://www.eea.europa.eu/en/analysis/maps-and-charts/european-air-quality-index)) | Live per-station map, pollutant-vs-WHO/EU-limit colour bands, country league table | The station map + EU-limit colour bands — we already hold the ИАОС station data; this is the outcome hero |
| **OpenAQ** ([openaq.org](https://openaq.org/)) | Open per-station API, historical trend per pollutant, "is my air improving?" framing | The per-station PM10/PM2.5 trend framing; the "did it improve?" question that our money-vs-outcome tile answers |
| **Eurostat — Environment / Circular economy** ([ec.europa.eu/eurostat](https://ec.europa.eu/eurostat/web/environment)) `env_wasmun` (municipal waste), `cei_wm011` (recycling rate) | Recycling-rate-vs-EU-target time series, per-country comparison | The waste/recycling-vs-EU-2025/2035-target gauge; peer bars (reuse `useCofog` peer machinery) |
| **EEA — Natura 2000 barometer** ([eea.europa.eu](https://www.eea.europa.eu/en/analysis/maps-and-charts/natura-2000-barometer)) | % territory protected per country, site count, habitat coverage | A "% от територията в Натура 2000" context strip (BG ~34.9% — one of the EU's highest) |
| **EU Cohesion Open Data / Kohesio** ([kohesio.ec.europa.eu](https://kohesio.ec.europa.eu/)) | Per-programme absorption burn-down, planned→contracted→paid | The ОП „Околна среда" absorption-contrast tile — **we already hold this in PG** (§3 Tier A) |
| **ИПИ / IME** ([[project_competitor_ime]]) | Fiscal transparency, regionalprofiles.bg | The domestic incumbent — does NOT tie environmental money to air/waste outcomes; our differentiator |

**The pattern to steal:** (1) a measured outcome next to the money; (2) a hard EU target/limit as the
yardstick (WHO PM limit, 2025 55% recycling target); (3) per-station / per-oblast normalization; (4)
absorption burn-down for EU money; (5) plain "did the spend move the number?" framing, not causation.

**The differentiated thesis (money → outcome), three concrete loops nobody in BG ships:**
1. **Air loop ⭐ (flagship):** МОСВ/ИАОС air-quality monitoring budget + ПУДООС/ОПОС air projects
   (МODAIRN, clean-air municipal grants) vs the **measured PM10/PM2.5 levels** from `data/air` (a
   current snapshot vs the EU limit today; a multi-year trend awaits the Phase-2 ИАОС annual ingest,
   §0.5). "€X on air monitoring and clean-air projects — where does ФПЧ10 stand vs the norm?" We are
   the only site holding both halves.
2. **Waste loop ⭐:** ПУДООС waste-facility grants + waste-CPV procurement vs the **recycling rate vs
   the EU 2025 (55%) / 2035 (65%) targets** (Eurostat `cei_wm011`; BG ~35–40%, below target).
3. **EU-money loop ⭐:** ОПОС 2014-20 closed at ~95% vs ПОС 2021-27 at ~17.8% — the absorption-risk
   contrast, straight from PG.

---

## 3. Data sources & availability (tiered by ingest cost; PG-preferred for new)

**Tier A — already ingested, zero pipeline (the MVP renders entirely off this):**
- **Procurement** — the ~24-EIK env-core group is already in the corpus. Group rollup, CPV/procedure
  mix, single-bid, HHI, tenders, КЗК appeals, MP-connected all come FREE via `useAwarderGroupModel` →
  the server-side `awarder_group_model` fn ([[reference_awarder_group_model]], no client fan-out).
- **EU funds (ИСУН / ОП „Околна среда")** — **in PG, no new ingest.** ОПОС appears as **two OPs**:
  `2014BG16M1OP002` „Околна среда" 2014-20 (391 contracts, €1.709bn contracted, €1.625bn paid, **~95%**)
  and `2021BG16FFPR002` Програма „Околна среда" 2021-27 (186 contracts, €1.763bn contracted, €0.314bn
  paid, **~17.8%**), plus EEA/Norway grants `BGENVIRONMENT`, `MODAIRN` (air-quality), `PEST`.
  ⚠ **Corrected mechanism (§0.5):** there is **no `useFundsAbsorption()` hook** — fetch the static
  `data/funds/derived/absorption.json` (`byProgramme[]` → `{programCode, programName, contractedEur,
  paidEur, absorptionPct, contractCount}`, verified to contain all five env codes) directly with React
  Query `staleTime:Infinity`; filter to the env codes. The richer per-programme
  `useFundsProgramSummary('2021BG16FFPR002')` (`fund-payload?kind=program-summary`) stays available for
  a drill-down. **Caveat:** ИСУН carries contracted + paid, **no
  planned/allocation column and no dates** — so the funnel is contracted→paid (the *planned* envelope,
  if wanted, is a curated constant from the programme's approved budget, not from `data/funds/`).
  Join by **OP code** (the accurate path) rather than the ВиК pack's EIK-sum approximation.
- **Air quality** — `data/air/index.json` (12KB, ~37 município + ~14 background stations, PM10/PM2.5;
  the schema already declares NO₂/O₃/SO₂ with `euLimit`s). Hook `src/data/air/useAirQuality.tsx`
  (Sofia-район→SOF00 fallback). Refreshed by the **already-wired** `update-air-quality` skill; watcher
  `iaos_air_quality`. **This is the outcome asset the whole view is built around.**
- **МОСВ program budget** — `data/budget/ministries/admin-ministerstvo-na-okolnata-sreda-i-vodite.json`
  (EIK `000697371`, node id `admin-ministerstvo-na-okolnata-sreda-i-vodite`), written by
  `update-budget`. 2018→2025 expenditure €25.5M→**€75.5M**; carries the 3 policy programs (опазване на
  компонентите; мониторинг/ИАОС; метеорология). Feeds the budget-bridge tile — no new ingest.
- **COFOG GF05** — `data/cofog.json` (`useCofog`): BG series (valueEur, ~€0.64bn) + `peers.GF05`
  (**BG 0.6% GDP 2024, rank 17/26, EU avg 0.8%, top NL 1.6%**) + `peerSeriesByYear`. The EU-peer bar is
  near-mechanical: reuse `MvrEuPeerTile`/`euFlags.tsx` with function code **GF05**. Rides the existing
  `eurostat` (gov_10a_exp) watcher — no new source.

**Tier B — structured, one parser each → small static JSON under `data/environment/` (Phase 2):**
- **Waste & recycling** — Eurostat `env_wasmun` (municipal waste per capita) + `cei_wm011` (recycling
  rate) + `cei_wm030` (landfill rate), BG + EU peers, annual → `data/environment/waste.json`. Mirror
  `scripts/transport/fetch_rail_ridership.ts` / `fetch_cofog.ts` exactly. **The recycling-vs-target
  gauge's data.** New watcher `eurostat_env` (fingerprint `cei_wm011`), monthly.
- **ПУДООС grants** — per-project environmental-fund grants (municipal water/waste/clean-air projects)
  from ПУДООС annual reports / pudoos.bg. Grain = per-project (recipient município, purpose, €, year).
  This is a multi-year, per-município, row-per-grant register (expected hundreds–thousands of rows) →
  **ingest into PG as a `pudoos_grants` table** (COPY-loaded via `lib/copy.ts`), served through a
  precomputed `environment_payloads` overview blob (grant-flow aggregate) plus a DbDataTable "see all"
  for the row-level register — the funds/procurement precedent, per the operator's "only very small
  datasets stay in JSON" directive. `scripts/environment/parse_pudoos_grants.ts` → COPY loader. **This
  is the grant-flow tile's data** and the differentiator's spend half. Cadence annual; wire into
  `recent_updates` ([[feedback_pg_changelog_required]]). If the source is scan-only/brittle, curate a
  cited subset (defense mega-programs precedent) and expand later — but the target store is PG.
- **Natura 2000 coverage** — % territory protected + site count from EEA Natura 2000 barometer / МОСВ →
  a small `data/environment/natura2000.json` (or curated constants in reference data). Context strip
  only; low cadence.

- **ИАОС air ANNUAL series (§0.5 addendum — needed for the true money-vs-outcome TREND).** The current
  `air/index.json` is a latest-snapshot only, so tile 3's trend half is not yet buildable. To ship the
  full "did the spend move ФПЧ10 over the years?" loop, extend `update-air-quality` (or a sibling step)
  to emit a small `data/air/annual.json` — national + per-oblast PM10/PM2.5 annual means from the ИАОС
  data.egov.bg resources (the same source already fetched, aggregated by year instead of latest). Tiny
  JSON, annual cadence. Until then tile 3 = money-trend + outcome-snapshot (§5 tile 3).

**Tier C — extend the existing air asset (Phase 3, no new pipeline):**
- **NO₂ / O₃ / SO₂** — the air index schema already supports them (`euLimit` present); `update-air-
  quality` **Step 0** just needs the per-pollutant data.egov.bg resource UUIDs appended to `POLLUTANTS`
  in `scripts/air/build_index.ts`. Adds pollutant depth to the air hero with zero new plumbing.

**Storage decision (per the "only very small datasets stay in JSON" directive).**
- **PG (preferred default for new data):** the **ПУДООС grant register** — a per-project, per-município,
  multi-year table (hundreds–thousands of rows, DbDataTable-shaped) → new `pudoos_grants` PG table +
  `environment_payloads` serving blob + `recent_updates` changelog ([[feedback_pg_changelog_required]]).
  Heavy queryable data (procurement, ИСУН funds) is **already in PG** and stays there.
- **JSON (only the genuinely tiny reference series):** `waste.json` (annual Eurostat recycling/landfill,
  ~2KB), `natura2000.json` (a handful of coverage constants, <1KB), and the existing **air**
  `index.json` (12KB, quarterly, station-keyed — same class as `cofog.json`/`road_safety.json`). These
  are small annual/quarterly source-ingested reference files, fetched with React Query
  `staleTime:Infinity` in 1–2ms; a PG round-trip would add latency for no gain. This is consistent with
  [[feedback_no_json_from_pg]] (which forbids generating JSON *from* PG, not small source ingests).

So: **one new PG table (`pudoos_grants`)**; waste/Natura/air stay JSON on their small-dataset merit.

---

## 4. Architecture — generic first (energy/security playbook)

### Phase 1 — generic `/sector/environment` (cheapest real-data ship, no new ingest)
Add config; no new screen. Delivers the real ~€216M / 1,940-contract group dashboard with date scoping
and the per-unit awarders tile immediately.

1. **`src/lib/environmentReferenceData.ts`** (NEW, the one load-bearing artifact) — the curated ~24-EIK
   allowlist with universe tags, mirroring `securityReferenceData.ts`/`transportReferenceData.ts`:
   `ENV_ENTITIES` (`{eik, name, universe}`), `ENV_SECTOR_EIKS`, `ENV_ALIAS_EIKS` (none today),
   `MOSV_EIK = "000697371"`, `IAOS_EIK = "831901762"`, `PUDOOS_EIK = "131045382"`, `ENV_UNIVERSES`
   (ministry/agency/fund/parks/basin/riosv/meteo[/nature_parks]), `ENV_UNIVERSE_LABEL`,
   `MOSV_BUDGET_NODE = "admin-ministerstvo-na-okolnata-sreda-i-vodite"`.
2. **`src/screens/sector/sectorDashboards.ts`** — add `SECTOR_DASHBOARDS.environment`
   (`leadEik: MOSV_EIK`, `members` = `ENV_ENTITIES.map(...)` grouped by universe, `agency: "МОСВ"`,
   `browsePackId: "environment"`, `titleKey/descKey`). Multi-EIK `members` fold into the KPI rollup
   exactly like `energy`/`security`.
3. **`src/screens/components/procurement/sectorPacks.tsx`** — add `environment` to
   `SECTOR_BROWSE_PACKS` (`eiks: ENV_SECTOR_EIKS`, label „Околна среда (МОСВ)"). Enables
   `?sector=environment` on `/procurement/contracts|tenders`. `awarder_eik` is already `filter:"in"` —
   **no server change** (the water plan's blocker is long since resolved).
4. **`src/screens/governance/sectorRegistry.ts`** — add a `Sector` to `sectors_cluster_infra` (next to
   `water`), `id:"environment"`, `to:"/sector/environment"`, `agency:"МОСВ"`, a **new nature-green
   accent** (§10 decision). (Alternative cluster: `sectors_cluster_land` with agri/nature — but the
   МОСВ↔water sibling tie makes infra the clearer home. Decide; infra recommended.)
5. **`src/screens/governance/sectorScenes.tsx`** — an `environment` SVG scene (a leaf / mountain +
   bars; a green reads distinctly from teal-water and moss-defense).
6. **`scripts/db/gen_procurement/sector_stats.ts`** — add `environment: ENV_SECTOR_EIKS` to
   `SECTOR_EIKS`; rerun `db:gen-sector-stats` (needs live PG) → hub € badge populates per `?pscope`.
   Non-blocking: dashboard KPIs come from the runtime `awarder-group-model` call.
7. **i18n** — `sector_environment_title` / `sector_environment_desc` in `src/locales/{en,bg}/
   translation.json` (the only translated strings besides the nav label).
8. **`scripts/prerender/routes.ts`** — add `environment` SEO copy to `SECTOR_PAGES` (the build guard
   `assertAllSectorsHavePrerenderCopy` fails prerender otherwise). Sitemap needs no edit (derives from
   `SECTOR_DASHBOARD_IDS`).

### Phase 2 — bespoke `EnvironmentPack` (the money-vs-outcome story)
Register under `MOSV_EIK` in `PACKS` so `getSectorPack(leadEik) → EnvironmentPack` becomes the whole
dashboard content (the security/transport path). Files mirror `security/` + `transport/`:
- **`src/data/procurement/useEnvironment.tsx`** — clone `useMvr.tsx`: fan out the group, universe
  filter, two `useAwarderGroupModel` calls (active-universe + whole-group for a filter-invariant
  `groupTotalEur`); return `{model, units, groupTotalEur, isLoading}`.
- **`src/lib/environmentAttributes.ts`** — CPV→function classifier (clone `securityAttributes.ts`):
  waste (90.5 отпадъци), water_pollution (90.4/45.25 ПСОВ), air/monitoring (38 instruments, 90.7),
  nature/forestry_works (77/45.11 terrain), lab/measurement (38.4), construction (45), services (71/79),
  supplies, other. `buildEnvironmentModelFromAggregates(p) = buildAwarderModelFromAggregates(p,
  environmentClassifier)`.
- **`src/screens/components/procurement/environment/EnvironmentPack.tsx`** + tiles (§5).
- **`src/data/environment/useWaste.tsx`, `useNatura2000.tsx`** — React Query hooks over the tiny Tier-B
  JSON (mirror `src/data/procurement/useRailSubsidy.tsx`). **`usePudoosGrants.tsx`** instead reads the
  PG `environment_payloads` overview blob + a DbDataTable feed (mirror the funds hooks).
- **⚠ §0.5:** the OP tile reads the static `data/funds/derived/absorption.json` (`byProgramme` filtered
  to the five env codes) — there is **no `useFundsAbsorption()` hook**; write a tiny React-Query reader
  (`useEnvironmentFunds.tsx`) over the JSON, no server call.

### Phase 3 — pollutant depth + Natura + AI/watchers
NO₂/O₃/SO₂ into the air index (Step 0), Natura tile, `ai/tools/environment.ts`, `eurostat_env` watcher,
`update-environment` skill (or extend `update-air-quality`) — §8/§10.

---

## 5. The "world's best dashboard" — tile by tile (NO tabs, stacked `PackSection` bands)

House grammar: single vertical stack, money-first ordering, each band a `PackSection` with a stable
deep-link `id`, each external tile a provenance chip: `● real` (OCDS/ЦАИС, measured) · `◆ budget` (ЗДБ)
· `◇ context` (Eurostat/ИАОС/EEA). Universe `Select` pinned right (never native — Radix
`@/components/ui/select`). Bilingual-inline (`const bg = lang==="bg"`), EUR-only ([[feedback_bg_uses_eur]]).

`Title → AwarderBreadcrumb → ScopeControl → universe Select → KPI row → tiles → awarders bridge → footer`

1. **KPI scorecard** (`StatCard` row, scope + universe aware, `● real`): Договорено ЗОП (~€216M
   all-time) · Договори · Изпълнители · Структури с договори · От което ИАОС % (the monitoring-agency
   share caveat, the "of which ВМА/Мед. институт" analogue). Universe Select drives it.
2. **★ Air-station map hero — „Качеството на въздуха, което измерваме"** (`● real ÷ context`). The
   signature visual: reuse **`SectorPointMap`** (`src/screens/components/maps/SectorPointMap.tsx`, the
   court-load/МВР/transport marker map) — one marker per município with an ИАОС station, coloured by
   latest PM10 vs the 50 µg/m³ EU limit (green<25 / amber / red≥50), badge = station count, popup =
   per-station latest reading + maxObserved, linking to `/place`. **Geocode:** stations key on obshtina
   codes (no coords in source) → município centroids from `settlements.json`/`municipalities.json` (the
   transport-map title→centroid precedent). `data-og="environment-air-map"` for the OG card.
3. **★ Money-vs-outcome — „Парите за чист въздух срещу въздуха"** (the differentiator, `● real ◆ budget
   ÷ context`). Two honest panels, not one twinned axis: (a) МОСВ monitoring-program budget +
   ПУДООС/ОПОС air projects €/yr (the money TREND); (b) — **⚠ corrected (§0.5): `data/air` has NO
   time series, only a latest snapshot** — the **current** national PM10/PM2.5 station-mean vs the EU
   limit (50 / 25 µg/m³), an outcome SNAPSHOT with `maxObserved` peaks. Framing "€X за мониторинг и чист
   въздух — ето къде е въздухът спрямо нормата" (context, not causation; education report-card
   precedent). **A true money-vs-outcome TREND requires the Phase-2 ИАОС annual-series ingest** (§3
   addendum) — until then this tile is money-trend + outcome-snapshot. This tile is why the view exists.
4. **★ EU-funds absorption — ОПОС 2014-20 vs ПОС 2021-27** (`◇ context`, from PG, no ingest). Burn-down
   bars: ~95% closed vs ~17.8% new; contracted→paid per OP by fetching
   `data/funds/derived/absorption.json` and filtering `byProgramme` to the five env codes
   (§0.5 — **no `useFundsAbsorption()` hook exists**; the JSON join by OP code is exact and needs no
   server call). Absorption-risk is the story. Clone `VikEuFundsTile`'s VISUAL but source from the JSON,
   not the EIK-sum.
5. **★ ПУДООС grant flow** (`◇ context`, Tier B). Where the environmental fund's grants land: per-
   município / per-purpose (water / waste / clean-air / nature) `€` flow, Top-N → a DbDataTable "see
   all". The fund is small in procurement (€9.25M) but disburses grants — the money that doesn't show
   up as ЗОП. If grants data is thin at Phase 2, ship a purpose-split bar from the cited subset.
6. **★ Waste & recycling vs EU target** (`◇ context`, Tier B). Recycling rate trend + the EU 2025 (55%)
   / 2035 (65%) target lines; BG below target. Pair with waste-CPV procurement + ПУДООС waste grants
   (the spend half). Peer bars reuse the `useCofog` peer machinery style.
7. **Разход по функция — what МОСВ buys** (`● real`, universe-segmentable): waste / ПСОВ / air-
   monitoring instruments / nature works / lab / construction — CPV-classified via
   `environmentAttributes`, marked a classification not an official taxonomy.
8. **EU-peer context strip — GF05 %GDP** (`◇ context`, near-mechanical): reuse `MvrEuPeerTile` +
   `euFlags.tsx` with function **GF05** → BG 0.6% vs EU 0.8%, rank 17/26. From `useCofog`.
9. **Пазар на изпълнителите (HHI)** + **конкуренция по структура** (single-bid share by unit) — reuse
   `VikContractorHhiTile` + the competition heatmap (gated on `cpv_competition.json`, covered-`n`
   disclosed). `● real`.
10. **Natura 2000 context strip** (`◇ context`, Phase 3) — % територия защитена (BG ~34.9%), site count.
11. **Институции bridge** — `SectorAwardersTile` listing all ~24 units grouped by universe (ministry /
    agency / fund / parks / basin / riosv / meteo), each chip → `/awarder/:eik`.
12. **See-all deep-links** — every Top-N tile → the shared `DbDataTable` scoped to `?sector=environment`,
    scope + `?q=` carried forward (`useScopedHref`).

**dataviz house rules:** form before colour; one axis per chart (money-vs-outcome = two stacked panels,
never a twinned axis); categorical hues fixed-order, 9th→"Other"; CSS flex bars for heroes (OG-
screenshottable), Recharts only for the one trend; run `scripts/validate_palette.js` on the env palette
light+dark. Air-limit bands use a fixed green/amber/red ramp keyed to the EU limit, not rank.

---

## 6. Common UI elements inventory (reuse; build only what's bespoke)

**Reuse as-is (no rebuild):** `SectorDashboardScreen` + `SectorAwardersTile` (Phase-1 group dashboard),
`SectorPointMap` (air-station map, tile 2), `useAwarderGroupModel` / `awarder_group_model`
([[reference_awarder_group_model]]), the static `data/funds/derived/absorption.json` /
`useFundsProgramSummary` (`src/data/funds/`, tile 4 — ⚠ §0.5: `useFundsAbsorption` does NOT exist),
`useCofog` + `MvrEuPeerTile` + `euFlags.tsx` (GF05 peer strip, tile 8), `VikContractorHhiTile`
(HHI), `PackSection` (stacked bands), `StatCard` (KPI row), `buildPackInsights` (linkified chips),
`InfographicTile` + `TILE_ACCENTS` (the hub tile), `AwarderBreadcrumb`, `ScopeControl` /
`useScope`/`useScopeWindow`, `DbDataTable` ("see all"), `useAirQuality` (`src/data/air/`). **⚠ §0.5 pt 5: `PassThroughHero` does NOT exist** (never built —
the social-assistance plan is itself unbuilt), so it is **not** a free reuse. For the money strip (≈€227M
procured vs the GF05 envelope) use a plain `StatCard` band, or build a hero from scratch and own it here.

**Near-mechanical clones:** `EnvironmentPack` ← `MvrPack`; `useEnvironment.tsx` ← `useMvr.tsx`;
`environmentAttributes.ts` ← `securityAttributes.ts`; `EnvironmentCategoryTile` ← `MvrCategoryTile`;
the EU-funds tile ← `VikEuFundsTile` (swap EIK-sum for OP-code join).

**Genuinely bespoke (the differentiator):** the **money-vs-outcome tile** (tile 3), the **air-station
map** wiring (obshtina→centroid geocode + EU-limit bands), the **waste/recycling-vs-target gauge**, and
the **ПУДООС grant-flow** tile. Everything else is config or a clone.

---

## 7. Date scoping (`?pscope`) — the explicit requirement

Reuse `src/data/scope/` unchanged. `Scope = ns | all | y:<year>` via `useScope`:
- **`/sector/environment`:** `SectorDashboardScreen` already renders `<ScopeControl mode="toggle">` and
  reads the URL hook — the group KPIs + spend-by-year re-window on `?pscope` for free. Corpus spans
  ~2011–2026; `y:YYYY` is meaningful.
- **`EnvironmentPack`:** consumes the controlled `scopeWindow={{from,to}}` for **contract** tiles
  (KPIs, category, HHI, competition). **Annual/outcome** tiles (air trend, waste/recycling, GF05 peers,
  EU-funds absorption, budget bridge, Natura) **ignore `scopeWindow`** — they pin latest + full series
  and show a "latest data · independent of scope" chip (the МВР/transport convention; no independent
  year picker).
- **⚠ Half-open caveat** (confirmed elsewhere): any DB-backed scoped tile must normalize a `y:` scope to
  half-open `to=(Y+1)-01-01` — the group-rollup SQL is `date >= COALESCE($2,'') AND date <
  COALESCE($3,'99999999')`, so an inclusive `to=YYYY-12-31` silently drops Dec-31 rows
  ([[reference_pg_sargable_windows]], transport-plan audit item 4).

---

## 8. Routing / registry wiring

- **Sector id:** `environment`. **Route:** `/sector/environment` (generic `SectorDashboardScreen` via
  `/sector/:id` — no static route needed; `routes.tsx` only intercepts sectors with a bespoke screen
  like administration, which environment is not — the pack renders inside the generic screen).
- **Cluster:** add to `SECTOR_CLUSTERS[sectors_cluster_infra]` next to `water` (МОСВ↔water sibling;
  recommended over `sectors_cluster_land`). New accent token (§10).
- **Air surface relationship:** today air is surfaced ONLY in My-Area (`MyAreaAirTile` /
  `MyAreaQualityStrip`, per-район tile) — there is **no standalone air screen**. `/sector/environment`
  becomes the first national air surface; the map hero (tile 2) is the app's first all-station view.
  Cross-link My-Area's air tile → `/sector/environment#environment-air-map`.
- **Browse pack:** `SECTOR_BROWSE_PACKS.environment` → `?sector=environment` filters
  `/procurement/contracts|tenders` to the env EIK-set (a filter-only `Section` in v1).
- **CLAUDE.md URL contract:** `?pscope` already documents the sector views; add environment to that
  list. No new URL param.

---

## 9. Sitemap, OG screenshot, prerender (exact files)

- **Sitemap:** `/sector/environment` (+ `/en/`) is **auto-derived** from `SECTOR_DASHBOARD_IDS`
  (`scripts/sitemap/route_defs.ts`) once the config lands — no edit.
- **Prerender SEO:** add an `environment` entry to `SECTOR_PAGES` in `scripts/prerender/routes.ts`
  (title/description/intro naming GF05, ИАОС air quality, ПУДООС, ОП Околна среда, recycling; keyword-
  rich, bilingual). **Required** — `assertAllSectorsHavePrerenderCopy` is a build guard. Prerender the
  hero's live figures (air trend, €216M, absorption %) into the crawlable body (judiciary precedent,
  [[feedback_static_seo]]).
- **OG image:** `scripts/og/screenshot_sectors.ts` auto-captures `public/og/sector-environment.png`
  (2400×1260) from `#sector-dashboard` for every id in `SECTOR_DASHBOARD_IDS` — **free** for a generic
  dashboard. **But** if the air-station **map** is the hero (tile 2, like transport), add a dedicated
  `scripts/og/screenshot_environment.ts` (clone `screenshot_transport.ts`: frame
  `[data-og="environment-air-map"]`, gate on `.leaflet-container` + ≥4 tiles, sharp-quantise the
  raster) and **exclude `environment` from the bulk loop** (`SECTOR_IDS.filter(id !== "transport" &&
  id !== "environment")`) so a bulk re-run can't clobber the hand-framed map OG. Decide at Phase 2;
  the flat bulk capture is fine for Phase 1.

---

## 10. Watcher + process-watch-report wiring

- **Air rides the EXISTING `iaos_air_quality` watcher → `update-air-quality` skill** — already wired in
  `scripts/watch/sources/index.ts` and `.claude/skills/process-watch-report/SKILL.md`. Adding
  NO₂/O₃/SO₂ (Step 0) needs **no new source** (all ИАОС pollutants publish on one cadence).
- **New watcher `scripts/watch/sources/eurostat_env.ts`** (`eurostat_env`, fingerprints Eurostat
  `cei_wm011` recycling rate, monthly) → register in `scripts/watch/sources/index.ts`. Mirror
  `eurostat_rail.ts` exactly.
- **COFOG GF05 rides the EXISTING `eurostat` (gov_10a_exp) watcher** — no new source.
- **ПУДООС grants** → a new source `pudoos_grants` (fingerprint the pudoos.bg report-list page) IF the
  register is machine-fetchable; else a manual annual refresh noted in the skill (no watcher).
- **process-watch-report mapping** (both surfaces in `SKILL.md`): `eurostat_env` → `npx tsx
  scripts/environment/fetch_waste.ts`; `pudoos_grants` → `npx tsx scripts/environment/
  parse_pudoos_grants.ts` **then the PG COPY loader + `environment_payloads` rebuild** (the
  procurement/funds ingest shape). **Skill decision:** create a small **`update-environment`** skill
  (covers waste + Natura JSON **and the ПУДООС PG ingest**, the `data/environment/` tree + `pudoos_grants`
  table) rather than overloading `update-air-quality` (which stays air-only, single-responsibility). Air
  remains its own skill/source; environment's new skill handles the money-adjacent outcome series and the
  grant register. Wire the `pudoos_grants` migration into `recent_updates` ([[feedback_pg_changelog_required]]).

---

## 11. Docs

- **README.md** (3 places, mirror security/transport): a "What's in here" Environment/МОСВ feature
  bullet, a `data/environment/` data-directory row, and data-source entries (Eurostat `cei_wm011`
  waste/recycling + ПУДООС + reuse of ИАОС air + ОП Околна среда ИСУН).
- **/data data-map** (`scripts/data_map/model.ts` → regenerate `data/data_map.json` via
  `npm run data:map`): new `environment` SOURCE_GROUP (members `["eurostat_env"]` +
  cross-reference the existing `iaos_air_quality`), `environment` DATASET (`origin` mixed,
  `path: "data/environment/"`, `tags:["fiscal"]` or `["indicators"]`), edge `src:environment →
  ds:environment`, and an **AI_PATH_RULE** `{ pattern: /^\/environment\//, dataset: "environment" }`
  (the `/air/` rule already exists at line ~120). `data:map` asserts every watcher source is placed —
  `eurostat_env` must be covered. Edge `ds:environment → f:ai` auto-derives from the AI tool.
- **/data/updates label:** add `data_changes_skill_update-environment` to `src/locales/{bg,en}/
  translation.json` (the page reads `t(\`data_changes_skill_${entry.skill}\`)`).

---

## 12. AI chat tools

- **`airQuality` already exists** (`ai/tools/registry.ts` line ~4339, `run: airQuality`; router keyword
  block `router.ts` ~3396: `въздух|air|фпч|pm10|pm2|замърся|pollut` → place-based). **Keep it** — it is
  the per-place air answer.
- **New `ai/tools/environment.ts`** (money/outcome family; envelope→narrate, never compute numbers in
  prose): `environmentSpending` (МОСВ group ЗОП + universe split, `db:awarder-group-model`),
  `pudoosGrants` (fund grant flow, PG `environment_payloads` blob / `db:pudoos-grants`), `wasteRecycling` (recycling rate
  vs EU target, `environment/waste.json`), `environmentFunds` (ОП Околна среда absorption,
  `db:fund-payload`). Register in `ai/tools/registry.ts`; narrate cases in `ai/orchestrator/narrate.ts`.
- **Router keyword block** (`ai/orchestrator/router.ts`, a NEW block distinct from the air one):
  `околна среда|мосв|пудоос|отпадъц|рецикл|боклук|натура 2000|биоразнообраз|национален парк|environment|
  waste|recycl|natura` → `environmentSpending`/`wasteRecycling`/`pudoosGrants` by cue. **Guard against
  the air collision:** an air/place query (`въздух|pm10`) must still route to `airQuality`; the env
  block fires on money/waste/nature cues, and air keeps precedence for air words.
- **`AI_PATH_RULES`** must carry `{ pattern: /^\/environment\//, dataset: "environment" }` or
  `scripts/db/tests/manifest.data.test.ts` fails the build (any `ai/` data path needs a rule).

---

## 13. Performance

- **Critical path = ONE parallel DB call:** `awarder-group-model` over the ~24-EIK env set. Worst case
  = all-time, full group. Expect ~**60–90ms** (the security 75-EIK group is ~74ms/285KB, transport
  11-EIK ~74ms; env's 24 EIKs sit between) on `idx_contracts_awarder` bitmap scan — **no new index**.
  EXPLAIN ANALYZE on ИАОС (`831901762`, the worst-case single entity at 733 contracts) + the full-group
  windowed path before ship ([[feedback_db_query_perf]]).
- **Funds:** `fund-payload?kind=absorption` is a single indexed jsonb lookup (~2ms). No new query.
- **ПУДООС grants (PG):** `pudoos_grants` COPY-loaded, served via a precomputed `environment_payloads`
  overview blob (single jsonb lookup ~2ms) + a paginated DbDataTable feed for the row-level register.
  Index the join/filter keys (recipient município, year); EXPLAIN ANALYZE the worst-case município page
  ([[feedback_db_query_perf]], [[reference_pg_query_performance]]).
- **Tiny static JSON:** `air/index.json` 12KB, `environment/waste.json` ~2KB, `natura2000.json` <1KB —
  1–2ms, `staleTime:Infinity`.
- **One new PG table (`pudoos_grants`)** + its `environment_payloads` blob. The 24-EIK procurement group
  rollup needs **no** precompute (well under the 200ms threshold; the judiciary 58-EIK rollup measured
  15.8ms). EUR sums = Σ per-row `amountEur`, the PG basis ([[reference_procurement_eur_sum_basis]]).
- If an air-station map serving fn is added later (per-station folding), mirror the transport/МВР
  facility-map pattern — but tile 2 renders **client-side** off the already-loaded `air/index.json`, so
  no new route is needed in Phase 2.

---

## 14. Mobile responsive (verify at 375px)

- KPI row: `grid-cols-2` mobile → 3–4 desktop (StatCard convention). Universe `Select` pinned right,
  wraps under the `<h2>` on mobile.
- **Air-station map risk:** Leaflet at 375px — `SectorPointMap` is already mobile-verified on
  transport/МВР/judiciary; keep the legend + metric caption **below** the map (not overlaid), and the
  popup card `max-w` capped. The transport map (113 markers) renders clean at 375 — env's ~37 station
  markers are lighter.
- Money-vs-outcome tile: the two panels **stack** (grid `1 → 2` cols) on mobile, never a side-by-side
  twinned axis. Waste/recycling + GF05 peer bars are CSS flex bars — scale to column width.
- Verify: 0px horizontal overflow, all bands render, Leaflet loads, KPIs stack, both light+dark themes
  (`resize_window` colorScheme). The §5 dataviz palette validated CVD≥12 light+dark.

---

## 15. Phased rollout (concrete file lists)

**Phase 0 (~½d) — decisions + reference data.** Write `src/lib/environmentReferenceData.ts` (the 24-EIK
allowlist, §1); decide cluster (infra vs land) + accent token; add `environment` to
`SECTOR_DASHBOARDS`, `SECTOR_BROWSE_PACKS`, `SECTOR_EIKS` (`sector_stats.ts`), `sectorRegistry.ts`,
`sectorScenes.tsx`, i18n keys, `SECTOR_PAGES` (prerender). **Renders the real ~€216M group dashboard,
zero new ingest.** Add `TILE_ACCENTS.<new>` to `tileAccents.ts`.

**Phase 1 (~1d) — bespoke `EnvironmentPack` off Tier-A data only.** `useEnvironment.tsx`,
`environmentAttributes.ts`, `EnvironmentPack.tsx` + tiles 1/2/3(air-only)/4(funds)/7/8/9/11. The air
map (tile 2, `SectorPointMap` + obshtina→centroid) and the **air money-vs-outcome tile** (tile 3, from
`data/air` + budget node + `absorption.json`, §0.5) — the flagship, all from already-ingested data.
Register `[MOSV_EIK]: EnvironmentPack` in `PACKS`. OG decision (bulk vs dedicated map capture).

**Phase 2 (~1–2d) — Tier-B ingest + waste/grants tiles.** `scripts/environment/fetch_waste.ts`
(Eurostat `cei_wm011`/`env_wasmun` → `data/environment/waste.json`, tiny JSON) + `parse_pudoos_grants.ts`
→ **`pudoos_grants` PG table (COPY loader) + `environment_payloads` blob** (not JSON); hooks
`useWaste.tsx` (JSON) / `usePudoosGrants.tsx` (PG blob + DbDataTable); tiles 5 (ПУДООС flow) + 6
(recycling-vs-target). New `eurostat_env` watcher + `update-environment` skill + process-watch mapping +
`recent_updates` changelog row for `pudoos_grants`. Nature-parks universe (Universe B) folded in, footnoted.

**Phase 3 (~1d) — depth + AI + docs.** NO₂/O₃/SO₂ into the air index (Step 0); Natura 2000 tile;
`ai/tools/environment.ts` + router block + `AI_PATH_RULES`; data-map `environment` source/dataset/edge;
README; `bucket:sync` of `data/environment/` (waste/Natura JSON); `pudoos_grants` served from PG.
Cabinet anchoring last.

---

## Open questions

1. **Cluster placement** — `sectors_cluster_infra` (next to water; recommended, МОСВ sibling) vs
   `sectors_cluster_land` (with agri/nature; thematically "земя и природа"). One-line decision.
2. **ПУДООС grants source** — is pudoos.bg's grant register machine-fetchable/structured, or scan-only?
   Gates whether tile 5 is a full DbDataTable or a curated purpose-split. Needs a source probe.
3. **Nature-parks universe** — include the 11 природни паркове (~€12.5M) in the group total, or keep the
   core 24 EIK and cross-link parks? (Recommended: include as their own `nature_parks` universe, Phase 2.)
4. **OP-code vs EIK join for the funds tile** — OP-code (via static `absorption.json`, accurate, recommended; §0.5)
   vs the ВиК EIK-sum. And whether to curate the *planned* envelope (not in ИСУН) for a full funnel.
5. **Air-station map geocode coverage** — obshtina→centroid covers ~37 município stations; the ~14
   background/mountain stations (Витиня, Копитото, Рожен) have no município bind — show as a separate
   "regional context" layer or omit from the map.
6. **МОСВ vs МЕ energy overlap** — climate/emissions policy straddles МОСВ and Министерство на
   енергетиката; keep environment = pollution/waste/nature, cross-link energy for emissions/ETS.
