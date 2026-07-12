# Енергетика (Energy / БЕХ) sector view — v1 plan & competitive brainstorm

Status: **RESEARCH + BRAINSTORM (not yet built)** — drafted 2026-07-12.
Closest built siblings to copy: the shipped **DefensePack** (`defense-pack-v1.md` +
`src/lib/defenseReferenceData.ts`) — the freshest multi-EIK state-group pack with a budget bridge
and a standalone `/defense` screen — and `water-view-v1.md` (holding + regional operators, the
holding-vs-regulated-vs-concession ownership discipline, a `SECTOR_BROWSE_PACKS` entry). The
transport plan (`transport-view-v1.md`) is the reference for the "umbrella sector + invisible-money"
narrative shape.

> All corpus figures below are **MEASURED** against the live contracts table
> (`contracts.awarder_eik/awarder_name`, local Docker PG, 2026-07-12), folded by EIK. €m = Σ
> per-row `amount_eur`, the PG basis ([[reference_procurement_eur_sum_basis]]). The frozen EIK
> allowlist already lives in `src/lib/energyReferenceData.ts` (written 2026-07-12).

---

## Audit rev 1.0 (2026-07-12) — verified wiring & gaps closed

Everything below was checked against current code + the live corpus before this doc was committed.

1. **БЕХ parent (`831373560`) awards ZERO ЗОП** — confirmed active in `tr_companies`, but a pure
   holding with no procurement footprint. It is the pack's **group anchor** (like `MOD_EIK`): landing
   `/awarder/831373560` folds `ENERGY_SECTOR_EIKS`; the holding's own header € will read ~0 while the
   pack shows the **€9.76bn group** — this delta MUST be footnoted (the defense МО-proper-vs-МО-group
   precedent). Single subsidiary EIKs (Козлодуй, ЕСО…) show the generic awarder page, no pack.

2. **The signature caveat is MEASURED, not hypothetical.** `АЕЦ Козлодуй – Нови мощности ЕАД`
   (EIK `202671079`, the AP1000 units 7/8 new-build, a ~€14bn program) and `БНЕБ/IBEX` return **zero**
   corpus contracts. The single biggest energy capex in the country's history is invisible via
   procurement — this is the thesis (§0), never a data gap to "fix" by name-matching.

3. **ЕСО branch code folds.** A 13-digit branch `1752013040` ("Управление МЕР") is ЕСО proper;
   `ESO_BRANCH_EIKS` unions it in so the €2.59bn grid line is complete (same 13-digit-branch pattern
   as [[project_oblast_code_shard_mismatch]]). Query the group through the union, not the bare EIK.

4. **Three ownership universes must never be conflated** (water-pack discipline): БЕХ commercial
   holding [state] vs district heating [MIXED — Топлофикация София is municipal, ЕВН/Веолия private,
   the rest МЕ-owned] vs regulators [КЕВР `130098909`, АЯР `000697567`, АУЕР `121459246` — not
   commercial buyers]. `energyReferenceData.ts` carries an `ownership` flag; the МЕ-vs-municipal heat
   split is a **first cut — verify** against the ТР children of `176789460` before promising it.

5. **Name-sweep false positives are catalogued and excluded** in the reference-file header (Община
   Козлодуй €78M, ПГ по ядрена енергетика, МБАЛ Козлодуй, ИЯИЯЕ, ЕВН/Веолия heat, Овергаз €185M). Curate
   **by EIK allowlist, never regex** — the defense-pack lesson holds verbatim here.

6. **`number_of_tenderers` gating required.** The group is **35% single-bid** (3,362 of 9,584
   bid-known of 19,892 contracts) — a real red-flag headline, but coverage is partial. Gate single-bid
   share on `cpv_competition.json` (Fazekas competitive-markets-only) and disclose the covered `n` on
   the tile, exactly as defense/roads do. Do not render a bare % over an unknown denominator.

7. **Scope Dec-31 handling is ALREADY correct on the awarder page.** `CompanyDbScreen` derives a
   half-open `packWindow` (`y:YYYY` → `{from:YYYY-01-01, to:(YYYY+1)-01-01}`) before handing it to the
   pack, so the inclusive→exclusive Dec-31 drop that bit earlier packs does not apply here — but keep
   the COALESCE-bounded sargable window ([[reference_pg_sargable_windows]]); re-verify at build.

8. **Convention reminders:** packs are **bilingual-inline** (`const bg = lang==="bg"`), no i18n keys
   except the nav label; EUR-only display, never footnote leva post-2026 ([[feedback_bg_uses_eur]]);
   Radix Select only, never native `<select>` ([[feedback_no_native_select]]); stacked bands, never
   tabs ([[feedback_no_tabs_ux]]); dashboard shell copies the homepage width, no `max-w-5xl` cap
   ([[feedback_dashboard_layout]]).

9. **Gas-infra awarders verified (2026-07-12).** Чирен storage + Балкански поток transit capex run
   **inside Булгартрансгаз** (`175203478`) — €367.3M / 189 contracts whose title carries
   чирен|балкан|транзит|компресор — so no separate storage/pipeline EIK to add. **But the IGB
   interconnector JV, Ай Си Джи Би АД (ICGB, `201383265`, €13.7M / 42 c), awards under its OWN EIK**
   — a 50% БЕХ / 50% IGI Poseidon joint venture. It is in `ENERGY_JOINT_VENTURES` and **excluded from
   the group total** (half-private; the water Sofia-concession precedent), surfaced as a cross-link.

10. **Revenue-return to the state is NOT company-attributable in ingested data.** The budget KFP carries
    only aggregate non-tax lines ("Приходи и доходи от собственост", "Други неданъчни приходи") — no
    file attributes revenue to БЕХ or any EIK (the "данъци върху дивидентите" line is corporate *tax
    on* dividends, a different thing). Per-company **dividend-to-the-State** + **Балкански поток transit
    revenue** are recoverable only from БЕХ's consolidated annual report + the annual Council-of-
    Ministers dividend РМС — a Tier-C/D curated ingest (§2), the defense mega-programs analogue.

11. **Still genuinely open:** (a) budget node slug `admin-ministerstvo-na-energetikata` is a GUESS —
   confirm against the emitted `data/budget/ministries/` tree before the bridge tile
   ([[project_budget_execution_scope]]). (b) Does `/energy` warrant its own OG capture + route_def, or
   is the БЕХ awarder OG card enough for Phase 1? Decide at Phase 2 (defense gave the screen its own).
   (c) ENTSO-E API needs a free registered key — scope who owns the credential before wiring live gen.

---

## 0. The one-line thesis

**БЕХ is the biggest state-commercial buyer in the country (€9.76bn, bigger than the МО group) and
the crossroads of everything the site already tracks — physics, market prices, geopolitics, the green
transition, household bills — yet the single largest energy investment in Bulgarian history is
completely invisible in the tender corpus.**

Energy is the natural *umbrella sector*: no BG player fuses the **physical system** (generation mix,
net exports), the **market** (IBEX wholesale + КЕВР-regulated bills), **geopolitics** (Russian gas →
Azeri/LNG, Balkan Stream transit, nuclear-fuel diversification), and the **money** (€9.76bn
procurement + BEH dividends to the fiscus) into one accountability frame. ENTSO-E/Ember give the
physics for free; nobody stitches it to the procurement corpus we already own.

The signature finding, measured:

| Entity | In АОП corpus | Reality |
|---|---|---|
| **АЕЦ Козлодуй – Нови мощности** (AP1000 units 7/8) | **€0 / 0 contracts** | A **~€14bn** new-build program — the biggest energy capex ever, procured through bespoke/intergovernmental channels outside ЦАИС |

That gap **is** the thesis (the transport "invisible builder" / defense "sustainment-not-acquisition"
analogue, cleaner data): "You can see €9.76bn of state energy spending — but the €14bn that will
define the next 60 years of Bulgarian power is procured where you cannot look."

---

## 1. Entities — the FROZEN EIK allowlist (measured)

Curate **by EIK allowlist, never name regex**. Three universes; never conflate. All rows already in
`src/lib/energyReferenceData.ts`.

### Universe A — БЕХ state energy group (the folded procurement pack)
| Entity | EIK | Corpus €m | n | Universe |
|---|---|---|---:|---|
| Булгартрансгаз ЕАД | **175203478** | 2,680.2 | 980 | gas — transmission |
| ЕСО ЕАД (+ branch `1752013040`) | **175201304** | 2,587.1 | 4,564 | grid |
| АЕЦ Козлодуй ЕАД | **106513772** | 1,713.7 | 3,740 | nuclear |
| ТЕЦ Марица изток 2 ЕАД | **123531939** | 740.8 | 1,857 | coal — thermal |
| Мини Марица-изток ЕАД | **833017552** | 495.3 | 802 | coal — mining |
| НЕК ЕАД | **000649348** | 325.6 | 1,926 | hydro + public trader |
| Булгаргаз ЕАД | **175203485** | 6.7 | 80 | gas — public supply |
| ВЕЦ Козлодуй ЕАД | **106588180** | 0.8 | 10 | hydro |
| Български енергиен холдинг ЕАД (БЕХ) | **831373560** | 0 | 0 | holding anchor |
| **Group subtotal (folded, excl. ministry)** | — | **~9,760** | **19,892** | 35% single-bid |

### Universe B — Principal & regulators (context, NOT folded into the group total)
| Entity | EIK | Corpus €m | n | Role |
|---|---|---|---:|---|
| Министерство на енергетиката | **176789460** | 4.8 | 127 | Ministry / principal owner of БЕХ |
| Агенция за устойчиво енергийно развитие (АУЕР) | **121459246** | 4.7 | 25 | Energy-efficiency & RES agency |
| Агенция за ядрено регулиране (АЯР) | **000697567** | 2.8 | 60 | Nuclear-safety regulator |
| КЕВР (енергийно и водно регулиране) | **130098909** | 0.9 | 51 | Price/licence regulator |

### Universe C — District heating (a SEPARATE sector; ownership MIXED; own optional band)
| Entity | EIK | Corpus €m | Ownership |
|---|---|---:|---|
| Топлофикация София ЕАД | **831609046** | 578.9 | **municipal** (Столична община) |
| Топлофикация Русе / Бургас / Плевен / Сливен / Враца / Перник / В.Търново / Габрово / Разград | (see ref file) | ~90 total | state (МЕ) — **verify** |
| ЕВН България Топлофикация (Пловдив) `115016602`, Веолия Варна `103195446` | — | ~88 | **private — excluded** |

### Universe D — Joint ventures (state-linked, NOT wholly owned → cross-link, not rollup)
- **Ай Си Джи Би АД (ICGB / IGB interconnector) `201383265` — €13.7M / 42 c.** 50% БЕХ (via
  Булгартрансгаз) / 50% IGI Poseidon; awards under its OWN EIK. Excluded from the group total
  (half-private — the water Sofia-concession precedent); surface as a labelled cross-link.
  *(Verified: Чирен storage + Балкански поток capex, by contrast, run INSIDE Булгартрансгаз —
  €367.3M / 189 c — so no separate storage/pipeline awarder exists.)*

### Invisible / excluded (measured, call out — never silently fold)
- **АЕЦ Козлодуй – Нови мощности `202671079`** — €0 corpus; the ~€14bn AP1000 story (§0).
- **БНЕБ/IBEX** (БЕХ subsidiary, energy exchange) — no material ЗОП footprint.
- **Овергаз мрежи `130533432` (€185M)** + the three electricity ЕРП distributors — **private**.

---

## 2. Data sources, tiered by ingest cost

**Tier A — already ingested, zero pipeline (the MVP renders entirely off this):**
- The АОП/ЦАИС procurement corpus — every Universe-A/B entity is already an awarder. Group model,
  CPV/procedure mix, single-bid, HHI, per-unit rollup, tenders, КЗК appeals, MP-connected all come
  free via `buildAwarderModel` + the generic awarder tiles + `awarder_group_model` (migration 061,
  generic over any EIK set — **no new SQL**).

**Tier B — structured, one parser each (Phase 2):**
- **Generation mix + net exports + emissions — Ember** (CC-BY 4.0, one CSV download; 215 countries,
  yearly + monthly). The "Bulgaria is a net electricity **exporter**" headline, coal share, CO₂
  intensity. Cheapest high-impact ingest.
- **Household energy prices — Eurostat `nrg_pc_204` (electricity) / `nrg_pc_205` (gas)**, EUR-native,
  EU-peer-comparable. **Reuse the existing `update-macro` Eurostat plumbing** ([[project_water_view]]
  Eurostat precedent) — near-zero new code; feeds `/indicators/compare` too.
- **State budget** МЕ envelope — folds into `update-budget` (`__write_energy.ts`), the
  judiciary/defense precedent (budget belongs to update-budget, NOT the domain skill). Verify the
  ministry admin node first (audit §11a).
- **Revenue returned to the State** (the "money that flows back", not procured) — **NOT free**:
  the KFP only has aggregate non-tax revenue, not company-attributable (audit §10). Recover per-company
  from (a) **БЕХ consolidated annual report** — the declared dividend to the sole owner (the State),
  historically one of the largest single budget contributors; (b) the annual **Council-of-Ministers
  dividend РМС** that sets the SOE profit-distribution rate; (c) **Балкански поток transit revenue**
  from the Булгартрансгаз annual report. Tier-C/D: a small curated `data/energy/state_returns.json`
  (defense mega-programs pattern) — one PDF/decision per year, no machine feed.

**Tier C — recurring API / scrape (watcher candidates, Phase 3):**
- **ENTSO-E Transparency API** (free registered key) — real-time generation by fuel, load,
  cross-border flows, day-ahead price. Powers a "power system right now" tile and the IBEX overlay.
- **IBEX/БНЕБ day-ahead** price & volume (rolling 3-month) — wholesale-vs-regulated spread.
- **КЕВР regulated tariff decisions** (PDF, semi-annual) — the household electricity/gas/heat tariff
  path. No clean API — Eurostat is the reliable spine; КЕВР is the annotation.

**Tier D — manual/annotated overlay (no feed):**
- **Козлодуй 7/8 (AP1000)** + **Балкански поток transit** + **nuclear-fuel diversification**
  (TVEL → Westinghouse/Framatome) — curated mega-program registry, *absent by design* from ЦАИС (the
  defense mega-programs analogue). Publicly reported milestones, not procurement rows.
- **JTF / Just Transition Fund** coal-region money — via the existing ИСУН funds pipeline
  ([[project_funds_pg_migration]]); Marica-East transition absorption.

> ⚠ Fact-check before publishing: the "Maritsa-East 2 = largest EU health/environmental damage" claim
> is an EEA ranking from ~2014 — re-verify currency, or frame as "was ranked … in 2014".

---

## 3. Architecture (reuse the shipped grammar — do not reinvent)

Two halves, both patterns already shipped:

1. **`EnergyPack` on `/awarder/831373560`** (БЕХ) — the "money half". Register `ENERGY_GROUP_EIK` in
   `src/screens/components/procurement/sectorPacks.tsx` `PACKS`. `SectorPackProps = {eik, scopeWindow}`.
   Data hook `src/data/procurement/useEnergy.tsx` wraps
   **`useAwarderGroupModel(ENERGY_SECTOR_EIKS, buildEnergyModelFromAggregates, scopeWindow)`** — ONE
   `/api/db/awarder-group-model` call returning `{model, byUnit, groupTotalEur}` (the water fix for
   N-EIK fan-out; ~10-EIK set is far under the 300 cap). Domain constants already in
   `energyReferenceData.ts`; add `src/lib/energyAttributes.ts` = CPV→category classifier +
   `buildEnergyModel`/`buildEnergyModelFromAggregates` (thin wrappers over `buildAwarderModel`,
   lighting up the generic KPI row / chips / category tile for free). **CPV classifier draft:**
   nuclear fuel & services · grid/electrical equipment (31/45) · gas pipeline & compression · lignite
   extraction & haulage · engineering & consultancy · IT/telecom · fuel/energy commodities (09) ·
   other. `byUnit` must be segmentable so "what the group buys" never reads as (say) gas pipe alone.

2. **`/energy` standalone screen** (`src/screens/energy/EnergyScreen.tsx`) — the primary surface,
   managed like `/defense`. Shell = `<Title>` → intro → `<ProcurementThematicNav />` → controlled
   `ProcurementScopeControl` → scoped procurement tiles → unscoped physics/price national tiles →
   cross-link strip. Add the **Zap** pill to `ProcurementThematicNav`, a `energy`
   `SECTOR_BROWSE_PACKS` entry (`?sector=energy` → `ENERGY_SECTOR_EIKS`) so `/procurement/contracts`
   + `/tenders` filter to energy, and the управление/държавни-сектори hub entry.

Reuse verbatim: `PackSection` (stacked bands), `StatCard` KPI row, `RevenueCompositionBar` (the
composition hero), `InsightChips`, the loading skeleton, per-tile `hasModel` gating, `useHashScroll`
deep-links, `OblastChoropleth`/`FeatureMap`, `DbDataTable` see-all. Generic tiles (CPV breakdown,
single-bid gauge, tenders, appeals, MP-connected) render FREE above the pack. Charts = Recharts.

---

## 4. The "world's best dashboard" — tile-by-tile

Ordered physics→market→money→geopolitics→transition, each a `PackSection` band with a stable
deep-link id. Signature tiles ★. The organizing spine: **where the power comes from → what you pay →
who they buy from → who supplies the fuel → the exit from coal**.

1. **★ Hero — generation mix + net exports.** Stacked-area of the fuel mix (nuclear / lignite / hydro
   / RES) over time + a net-import/export flow figure. `data-og="energy-hero"`. Ember data,
   Bulgarianized; the "БГ захранва региона" hook. Fixed-color-by-fuel (never repaint on Select).

2. **★ What you pay.** КЕВР-regulated household electricity/gas/heat tariff (EUR) over time, with the
   IBEX wholesale price overlaid and the Eurostat EU-peer band — answers "why is my bill this much".
   The revenue/price-composition analogue of the NZOK budget bridge (BEST-in-repo bridge pattern).

3. **★ Follow the money — БЕХ group at a glance.** `StatCard` row (group € €9.76bn · single-bid share
   [gated, `n` shown] · direct-award share · top-5 supplier HHI band · tenders count) + a per-unit
   spend bar (Булгартрансгаз / ЕСО / Козлодуй / Марица комплекс / НЕК). Universe Select
   ("група / без газ / ядрена / въглища / …") drives it. Delta-vs-БЕХ-header footnote (audit §1).

4. **★ The invisible €14bn.** One honest KPI+chip: "Козлодуй 7/8 (AP1000): ~€14 млрд планирана
   инвестиция — €0 в търговете. Най-голямата енергийна инвестиция в историята се възлага извън ЦАИС."
   Show it as a *labelled dashed bar* next to the visible group € so the gap is the subject.

5. **★ Geopolitics of gas.** Gas-source composition over time (Gazprom → Azeri via IGB → LNG) as a
   stacked bar + **Балкански поток transit** revenue (Булгартрансгаз) — the one place БЕХ *earns*
   transit money. Nuclear-fuel diversification (TVEL → Westinghouse/Framatome) as a program timeline
   (the `DefenseProgramsTile` pattern).

6. **★ The exit from coal.** Marica-East complex: jobs + emissions + a coal-phase-out target line
   (the `DefenseGdpTile` target-line pattern) + CO₂/ETS cost curve + JTF absorption gauge (ИСУН).
   Positional, non-judgmental framing (education report-card precedent).

7. **What each entity buys — CPV/procedure breakdown** (generic `ProcurementBreakdownTile`) +
   **single-bid competition gauge** per buyer (green <35 / amber / red ≥60, gated on coverage).

8. **★ The money that flows back** (Phase 3): the one sector that *earns* as well as spends —
   **БЕХ dividend to the State** (declared to the sole owner in the consolidated report + the annual
   dividend РМС) + **Балкански поток transit revenue** (Булгартрансгаз) + the aggregate SOE
   property-income budget line for context. A revenue-in tile contrasting the €9.76bn spend hero (the
   transport toll-revenue-tile analogue). Disclose that the dividend figure is per-company from the
   annual report, not the KFP (audit §10).

9. **БЕХ as an enterprise** (Phase 3): consolidated revenue/profit, debt, headcount. Board members →
   the connections graph (constrained by [[project_tr_officer_coverage_ceiling]] — 63% zero-coverage;
   disclose).

10. **Top contracts / top contractors / MP-connected / tenders / КЗК appeals** — all free generic
    tiles; concentration + MP overlay is where the supplier-chain story surfaces.

11. **See-all deep-links** — every Top-N tile → shared `DbDataTable` scoped to `?sector=energy`,
    scope + `?q=` carried forward via `useProcurementHref`.

**dataviz house rules (non-negotiable):** one axis per chart; categorical hues fixed order,
9th→"Other"; color-follows-fuel/entity-not-rank; run the palette validator on the fuel palette
light+dark; heroes = CSS flex bars, Recharts only for the trend/area. See the `dataviz` skill.

---

## 5. Date scoping (as required)

Vocabulary is **strictly `ns | all | y:YYYY`** via `useProcurementScope` — **no calendar from-to
picker; do not add one** ([[feedback_no_native_select]] applies to the year Select).

- **`/energy` screen:** controlled `ProcurementScopeControl` driven by local state (the
  `DefenseScreen`/`JudiciaryScreen` pattern) — `allowAll={false}`, `nsLabelOverride="Latest year"`.
  Procurement tiles re-window on the picked year; **physics/price time-series stay full-history**
  (generation mix, tariff path, emissions are inherently trends) and only the **KPI row re-anchors**.
  Corpus spans ~2008-2026 with a post-2022 energy-crisis surge, so `y:YYYY` is meaningful.
- **`EnergyPack` on the awarder page:** consumes half-open `scopeWindow={{from,to}}` from
  `CompanyDbScreen`'s `packWindow` for contract tiles. **Annual physics/price tiles do NOT honor the
  parliament pill** — follow the NZOK/VSS precedent: an **independent local year `Select`** + a
  "latest data · independent of scope" chip when `scopeWindow` is narrowed; off-scope bands flagged
  via `PackSection`'s `note` prop.
- Nav pill flagged **`unscoped`** in `ProcurementThematicNav` (like judiciary/culture/defense) so the
  standalone screen carries no stale `?pscope`.

---

## 6. Plumbing (mirror water/defense; each a one-liner here, expand at build)

- **Storage:** procurement is already PG (zero work). Tier-B/C artifacts (generation mix, prices,
  emissions) → static JSON under `data/energy/` (small; no `recordIngestBatch`), except the budget +
  dividends line which goes through `update-budget` → `data/budget/energy/`. [[feedback_pg_changelog_required]]
  only bites if any *new PG-migrated* dataset is added.
- **Reference-data file:** `src/lib/energyReferenceData.ts` (SHIPPED). Add `energyAttributes.ts`
  (classifier + model folders) at build.
- **Parity:** add `EnergyPack` to `scripts/defense/__parity_check.ts` `PACKS` so the
  raw-vs-aggregates model equivalence is enforced (both whole-corpus and over a window).
- **Watchers:** `scripts/watch/sources/{ember_generation, eurostat_energy_prices, entsoe_flows}.ts`
  → map to an `update-energy` skill in `process-watch-report` (both mapping surfaces).
- **AI tools** (`ai/tools/energy.ts` + registry/router/narrate): `energySpending`, `generationMix`,
  `electricityPrices`, `gasSupply`, `nuclearProgram`. `ai/` cannot import `@/data/*` → keep engines in
  `src/lib/` ([[project_ai_chat_tools]]).
- **Data map:** add an energy SOURCE_GROUP + DATASET + cross-dataset edges (budget→energy,
  funds→energy) + `/^\/energy\//` AI_PATH_RULE.
- **SEO:** one `INSTITUTION_PACKS` entry for БЕХ auto-wires sitemap + prerender + OG
  ([[feedback_static_seo]]); the `/energy` screen (if built) needs its own route_def + OG capture
  (anchor `data-og="energy-hero"`). Prerender the hero's live figures into the crawlable body
  (judiciary precedent). Note: the БЕХ awarder page is thin (0 contracts) — the pack IS its body.

---

## 7. Phasing

- **Phase 1 (~½–1d):** register БЕХ EIK + `EnergyPack` skeleton off `awarder_group_model` (KPI row,
  per-unit spend hero, the invisible-€14bn call-out, generic tiles free). Nav Zap pill +
  `SECTOR_BROWSE_PACKS` entry + parity-check row. Everything renders off Tier-A, **zero new ingest**.
- **Phase 2 (~1-2d):** `/energy` screen + generation mix (Ember) + Eurostat household-price tile +
  budget/dividends bridge via update-budget. The physics+prices differentiator lands here.
- **Phase 3 (~1-2d):** geopolitics band (gas sources, Balkan Stream, nuclear fuel) + coal-exit/JTF
  band + ENTSO-E live tile + BEH-enterprise tile + AI tools + watchers. Cabinet anchoring last.

## 8. Competitive positioning

Nobody fuses the four layers for BG. **ENTSO-E / Ember** = physics only, pan-EU, not in BG, no money.
**IBEX/КЕВР** = prices only, short window, no accountability. **IME/ИПИ** ([[project_competitor_ime]])
= fiscal transparency, no physical-system or entity-money view. **sigma.midt.bg** is a re-skin of the
same АОП data we already hold ([[reference_sigma_platform]]). Global refs are single-layer. We are the
only place that puts **the power system + the bills + the €9.76bn of spending + the €14bn you cannot
see + the geopolitics** in one Bulgarian frame. Position = **"Цялата енергетика на едно място — и
парите, които не се виждат."**
