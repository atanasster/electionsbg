# Култура (Culture) government-entity view — v1 plan

**Status:** draft / research complete
**Owner:** —
**Related:** [nzok-health-pack-v1.md](./nzok-health-pack-v1.md), [water-view-v1.md](./water-view-v1.md), `project_agri_subsidies_pack`, `project_contracts_browser_deeplink_risk`

> The [Води plan](./water-view-v1.md) is the closest structural precedent and already
> solves the four cross-cutting concerns this plan reuses verbatim: SQL-perf (§5 there),
> AI tools (§6), watcher wiring (§7), changelog (§8), data-map/README (§9). Where a
> pattern is identical, this plan points at Води rather than repeating it.

Министерство на културата as a government-entity dashboard, alongside the existing
packs for НЗОК (health fund), НОИ (social security) and АПИ (roads). This plan
first grades the **common UI grammar** the three existing packs already share, then
maps a Култура build onto it — and flags the one way Култура genuinely differs.

---

## 1. The pack grammar (graded from the three live implementations)

Read from `NzokPack.tsx`, `NoiPack.tsx`, `RoadsPack.tsx`. Every sector pack is a
`<Pack eik scopeWindow />` component, lazy-registered by EIK in
`src/screens/components/procurement/sectorPacks.tsx`, and rendered by
`CompanyDbScreen` as a hero section **below** the generic awarder KPIs. They render
ONLY the domain-unique tiles — the generic buy-side tiles (total/contracts/suppliers
KPIs, top contracts/contractors, "Какво купува" by CPV, money-flow treemap, EU
benchmarks, tenders, appeals) already sit on the awarder page above.

The shared skeleton, in render order — this is the checklist a new pack fills in:

| # | Element | Shared implementation | Present in |
|---|---------|-----------------------|------------|
| 1 | **Section wrapper** | `<section className="space-y-4">` | all 3 |
| 2 | **Titled header** | Lucide icon + `<h2 className="text-lg font-semibold">`, bilingual (`HeartPulse` / `PiggyBank` / `Waypoints`) | all 3 |
| 3 | **Domain KPI row** | `grid grid-cols-2` (roads `lg:grid-cols-3`) of `StatCard{label,hint}` — keeps ONLY the entity-unique KPI ("Поръчки на година", "На разпознат път"); generic KPIs live in the header above | all 3 |
| 4 | **Auto-insight chips** | `flex flex-wrap gap-2`; `useMemo` derives ≤5 headlines from the model (peak year, top category, direct-award %); `WARN_CHIP_COLORS` for red flags, muted otherwise | all 3 |
| 5 | **Hero "bridge" tile** | the signature move — fuse procurement with the *bigger money it sits inside*: `NzokBudgetBridgeTile` (€5.5bn ЗБНЗОК), `NoiFundFlowTile` (€12.6bn ДОО), roads `RoadNetworkMap` (spatial hero, no external budget) | all 3 |
| 6 | **Category breakdown** | classifier CPV→function → `NzokCategoryTile` / `NoiCategoryTile` / `RoadWorkGroupDonut` | all 3 |
| 7 | **Benchmark tile** | vs external reference: `NoiAdminBenchmarkTile` (SSA/DRV admin cost), `RoadCostBenchmarkTile` (ROCKS/RO/GR €/km) | noi, roads |
| 8 | **Concentration / repeat-winner tile** | `NoiStrategicSuppliersTile`, `RoadRepeatWinnersTile`, `RoadRegionCompetitionTile` (where competition collapses) | noi, roads |
| 9 | **Time spine** | spend by year, stacked (`RoadTimeSpineTile`; NZOK/NOI carry it in the bridge) | roads |
| 10 | **Planned-tenders pipeline** | `RoadPlannedTendersTile` (what's announced to be built) | roads |
| 11 | **Provenance footnote** | `text-[11px] text-muted-foreground/80`, bilingual, names every source + the "outside-ЗОП" caveat | all 3 |

Cross-cutting conventions (non-negotiable, copy verbatim):
- **Loading**: `<div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />`
- **Empty-gate**: `return null` when nothing to show; each tile also gated on its own
  data so a scope-pill pivot with no contracts doesn't delete the whole pack (see the
  NZOK `hasModel` comment — budget/hospital/drug tiles survive an empty contract window).
- **Own-picker independence**: annual data (budget/fund years) gets its OWN Radix
  `Select` fiscal-year picker, independent of the procurement `?pscope` window — the
  parliament window straddles calendar years and is meaningless for a budget.
- **Bilingual**: `const bg = lang === "bg"` gate on every string.
- **Money**: `formatEurCompact(v, lang)`; figures `tabular-nums`; EUR at ingest (÷1.95583).
- **Cards**: `Card/CardHeader/CardTitle/CardContent` from `@/ux/Card`; tile titles
  sentence-case (not ALL-CAPS); `StatCard` from `@/screens/dashboard/StatCard`
  (supports `to`/`seeMoreTo` for drill-down).

**Design lesson from grading them:** the hero bridge (row 5) is what makes each pack
worth building — it reframes a small procurement ledger against the real money the
entity moves. НЗОК: "ЗОП is 1.5% of the fund." НОИ: "procurement vs €12.6bn paid out."
A Култура pack without a strong bridge tile would be the weakest of the four.

---

## 2. The one way Култура differs — subsidies, not procurement

The three existing packs all decorate a *procurement* page: the entity is a big
**buyer**, and the pack's job is to contextualize its ЗОП contracts. Култура inverts
this. Министерство на културата procures little of interest; its money is **subsidies
and grants** — театри, филми, читалища, НФК — almost none of which touch ЗОП. So the
"other 98.5%" that НЗОК's bridge merely *gestures at* (hospital payments) is, for
Култура, the **whole product**, and it needs per-recipient data the procurement
corpus doesn't contain.

The precedent for that is not a sector pack — it's the **agri `/subsidies` pack**
(`project_agri_subsidies_pack`, `AgriRecipientFile`, `/farm/:eik`, the cross-program
card gated on `AGRI_PAYER_EIK` in `CompanyDbScreen`). That's a dedicated,
recipient-grained subsidy dataset with its own page, plus a card on the paying
agency's awarder page linking into it.

**Architecture decision → hybrid, mirroring how ДФ „Земеделие" is handled:**

1. **`KulturaPack` on `/awarder/000695160`** (procurement decorator) — follows the
   grammar in §1 for МК's small ЗОП slice, with the hero **budget bridge** showing
   the €269M МК budget and how little of it is procurement (the rest is subsidy).
   This is the nav entry point in "Държавни структури".
2. **A recipient-grained subsidy dataset** (the agri model) — per-film / per-grant /
   per-institute awards, surfaced as tiles inside the pack now, and as a dedicated
   view later. Cross-program tiles on `/company/:eik` and `/awarder/:eik` (a
   production company that also wins procurement, a театър that also received a grant).

Start with the pack; grow the dedicated view as the recipient corpus lands.

---

## 3. Confirmed facts (locked from research)

- **МК EIK: `000695160`** (strategy.bg institution profile) — pack key + `KULTURA_EIK`.
- **МК 2026 budget: €269.4M** (~527M лв) — hero bridge number. Programs: музеи/галерии,
  библиотеки/читалища, сценични изкуства, кино, културно наследство.
- **Читалища 2026:** standard €11,240/subsidized unit × 7,856 units ≈ **€88.3M**.
- **НФК 2026:** 18.3M лв ≈ **€9.36M** across grant programs.
- **Sofia Програма „Култура" 2026:** €2.3M, 119 of 455 funded (ready-made success rate).
- **mc.government.bg / nfc.bg / ncf.bg all serve plainly** — no Cloudflare/WAF/login
  (unlike the minfin.bg mirror). Culture money is easy to reach.
- **Competitive field is open** — no Bulgarian portal shows per-recipient culture
  spending; ИПИ/regionalprofiles has *activity counts* only; НФК/НФЦ publish raw
  who-got-what with zero visualization/search/time-series.

---

## 4. Tile inventory — Култура mapped onto the grammar

Header: `Palette` icon, "Культура (МК)" / "Culture (MC)".

| Grammar slot | Култура tile | Data |
|--------------|--------------|------|
| 3 KPI | "Субсидии на година" + "Бюджет на МК" | budget.json + subsidy corpus |
| 4 chips | top program, celebrity-vs-independent split, biggest repeat recipient | model |
| 5 **hero bridge** | **Culture budget bridge** — €269M МК → делегирани бюджети / НФК / НФЦ / читалища / ЗОП; the "most of it is subsidy, here's who gets it" reframe | budget law + отчет |
| 6 breakdown | **Спенд по дисциплина** — театър / опера / кино / наследство / читалища | recipient corpus |
| 7 benchmark | **Културни разходи на глава по област** (per-capita choropleth over census/GRAO layers already in-app) — the ACE "Culture & Place" differentiator; "is my area under-funded?" | subsidy corpus × population |
| 8 concentration | **НФЦ repeat film-money winners** — production-company concentration + **connections-graph jury↔beneficiary conflict lens** (the rigged-competition hook) | NFC register |
| 8b | **Театрална дисциплина** — МК's own published "120%-overspend" lists; subsidy-per-ticket where reconstructable (Phase 2) | МК lists / ДВ standards |
| 9 time spine | subsidies by year + by cabinet (reuse `?cabinet=` anchor) | corpus |
| — new | **НФК success rate** — applied vs funded per program/session (nobody publishes this) | NCF session PDFs |
| — new | **`/culture/grant/:id` deep-link records** — every award a permanent shareable page (clone the `/procurement/contract/:id` stack, §6b) | corpus |
| 11 footnote | sources: МК budget law, НФЦ регистър, НФК класиране, АОП | — |

---

## 5. Ingest plan (ranked by value × ease)

1. **НФЦ Единен публичен регистър** — direct `.xls`, per-film/per-producer, exact
   subsidy, verified schema (`Вид · Наименование · Рег.№ · Продуцент · Субсидия(лв) ·
   Бюджет · Протокол`), annual 2014–2025, no WAF. **Cleanest source in the domain —
   start here.** Feeds tiles: film awards + repeat-winners + connections + `/grant/:id`.
2. **МК program-budget execution** (`Pril201-Otchet*.xlsx`) — reuse the `update-budget`
   program-execution parser; scrape `mc.government.bg/документи/бюджет-*`. Anchors the
   bridge (€269M).
3. **НФК grant-result PDFs** — Google-Sheets exports (extractable tables, not scans);
   crawl `ncf.bg/bg/novini` + `web/files/richeditor/YYYY-rezultati/`. Powers
   success-rate + celebrity-concentration hooks.
4. **Sofia Програма „Култура"** — per-project HTML/PDF; template for other oblast
   centres later.
5. **Читалища** — reconstruct €88.3M from ДВ per-unit standard × subsidized-unit counts.

**Storage:** follow the agri precedent — recipient corpus is a good candidate for
PG-direct (`kultura_subsidies` + a `kultura_payloads` blob table for precomputed
overviews), served via `/api/db`. The MК budget bridge stays a hand-keyed static
`data/budget/kultura/budget.json` (NZOK pattern, `__write_budget.ts`). Respect
`feedback_no_json_from_pg` and `feedback_pg_changelog_required`.

---

## 6. Build recipe (files to touch)

Pack (mirrors NZOK):
- `src/lib/kulturaBenchmarks.ts` — `KULTURA_EIK = "000695160"`, category map, labels
- `src/lib/kulturaAttributes.ts` — `buildKulturaModel()` classifier
- `src/data/procurement/useKultura.tsx` — fuse procurement + budget + subsidy corpus
- `src/data/budget/types.ts` + `useBudget.tsx` — `KulturaBudgetFile` + `useKulturaBudget()`
- `data/budget/kultura/budget.json` + `scripts/budget/kultura/__write_budget.ts`
- `src/screens/components/procurement/kultura/KulturaPack.tsx` + tiles
- `sectorPacks.tsx` — register `[KULTURA_EIK]: KulturaPack`, export `KULTURA_AWARDER_PATH`
- `reportMenus.ts` (Държавни структури group) + `ProcurementNav.tsx` (pill) + i18n keys
  `procurement_kultura_nav`
- `scripts/prerender/institutions.ts` — one `INSTITUTION_PACKS` entry (§12, feeds
  sitemap + prerender + OG); add `data-og="kultura-hero"` to the hero tile in the pack

Subsidy corpus (mirrors agri):
- `scripts/kultura/` ingest (НФЦ `.xls` first) → PG `kultura_subsidies`
- `src/data/kultura/` hooks + types (`KulturaRecipientFile`)
- cross-program card in `CompanyDbScreen` gated on `KULTURA_EIK` (mirror the
  `eik === AGRI_PAYER_EIK` subsidies card already there)
- Phase 3: dedicated `/culture` view + per-grant records (§6b)

### 6b. Per-grant record + grants browser (clone the contracts stack)

The contracts implementation (`project_contracts_browser_deeplink_risk`) is the exact
template for per-award pages and a searchable browser. Onboard grants by replicating
the *shape*, not the logic:

| Contracts file | Clone → grants | Note |
|---|---|---|
| `src/screens/ContractDetailScreen.tsx` | `CultureGrantDetailScreen.tsx` | 2/3 + 1/3 layout, `KvRow` pairs, `RiskBadges` → culture flags (jury↔recipient conflict, celebrity flag, over-budget); connected-people panel reuses the connections graph |
| `src/data/procurement/useContract.tsx` (`/api/db/contract?key=`) | `useGrant.tsx` (`/api/db/grant?id=`) | DB-backed lookup |
| `src/screens/dev/ContractsBrowserDbScreen.tsx` | `CultureGrantsBrowserScreen.tsx` | DbDataTable, facets (program, discipline, year, status), `?q=` on recipient/title |
| `scripts/procurement/by_id_shards.ts` (`buildByIdBuckets`, 4096 buckets, 3-hex prefix) | `scripts/kultura/by_id_shards.ts` | reuse `buildByIdBuckets()` verbatim for static/GCS serving of `/culture/grant/:id` |
| `functions/db_table.js` REGISTRY `contracts` entry | add `culture_grants` registry entry | column whitelist = security boundary (§7) |
| `functions/db_routes.js` contract handler | add `/api/db/grant` handler | mirror the single-entity lookup |
| `src/routes.tsx` (`procurement/contract/:id`) | add `culture/grant/:id` + `/culture/grants` | wrap in `LayoutScreen` |

Route note: the live contract route is `/procurement/contract/:id` served from
`/api/db/contract?key=` — the by-id shards are the static/GCS fallback, not the dev
path. Grants follow the same dual: PG-served live, sharded for static.

Also adopt the Води plan's **sector-browse-pack** idea (`SECTOR_BROWSE_PACKS` in
`sectorPacks.tsx`): a `culture` sector keyed on the МК+НФЦ EIK-set so
`/procurement/contracts?sector=culture` enriches the shared browse page instead of
forking a bespoke screen — reusable and consistent with roads/water.

---

## 7. SQL & data-model performance

Follow the **PG-only** convention of the agri/funds packs (no `build*FromRows`/`db:gen-*`,
per `feedback_no_json_from_pg`). Ingests write PG directly; the dashboard reads a
precomputed blob table. Mirrors Води §5.

### Tables (new)
- `kultura_subsidies` — fact: award grain. `id PK`, `program` (nfc_feature | nfc_doc |
  ncf_<prog> | sofia | …), `discipline` (film | theatre | music | heritage | …),
  `recipient_eik`, `recipient_name`, `year`, `amount_eur numeric`, `status`
  (funded | reserve | rejected), `source_url`, `jury_meta jsonb` (for the conflict lens).
- `kultura_payloads` — `(kind, key) PK`, `payload jsonb` — precomputed dashboard blobs
  (kind = `overview` | `discipline_map` | `recipient` | `program`), mirroring
  `agri_payloads`/`fund_payloads`. Serve via `/api/db/culture-*`.

The МК **budget bridge** stays a hand-keyed static `data/budget/kultura/budget.json`
(NZOK pattern) — not a table. Procurement is a **join** onto the existing `contracts`
by `awarder_eik = KULTURA_EIK`, not a new table.

### Performance verification (per `feedback_db_query_perf` — part of "done")
`EXPLAIN ANALYZE` every new/changed query on the **worst-case entity** before shipping;
add the index if it seq-scans. Per `reference_pg_query_performance`, index every entity
FK and **both sides** of every join key.

- Index `kultura_subsidies(recipient_eik)`, `(program, year)`, `(discipline, year)`,
  `(year)`. The recipient page (`/farm/:eik` analog) filters `recipient_eik` — verify
  index scan on the highest-award recipient (the celebrity-recipient case is worst-case
  for row count).
- **Repeat-winner / concentration tile** groups by `recipient_eik` over the whole
  corpus — precompute into `kultura_payloads(kind='overview')` at ingest (global-hot,
  >200ms if live), don't compute per page load.
- **Per-capita-by-oblast map** joins award→recipient-seat→oblast→population. Precompute
  into `kultura_payloads(kind='discipline_map')`; derive oblast from the obshtina prefix,
  never trust a raw `area.oblast` (`project_oblast_code_shard_mismatch`).
- The `culture_grants` **DbDataTable** registry query (browser + "See all") gets the same
  worst-case `EXPLAIN ANALYZE` — sort on `amount_eur DESC`, filter by program/year, `?q=`
  on recipient/title (ensure a `pg_trgm` or prefix index backs the text search).
- jsonb payload builders follow `reference_pg_payload_determinism`: `ROUND` sums, rounded
  sort keys with `eik` tiebreaks, `COLLATE "C"` MINs; run the parity-audit recipe against
  a JSON dump of the same query.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert
  (`reference_procurement_eur_sum_basis`). НФЦ amounts are historical BGN → convert at
  ingest (÷1.95583).

## 8. Watchers & process-watch-report wiring

New watcher sources (`WatchSource` shape from `scripts/watch/types.ts`: `id`, `label`,
`url`, `cadence`, `fingerprint(): Promise<Fingerprint>`, optional `describe(prev,curr)`),
each a file under `scripts/watch/sources/`, imported into `SOURCES` in
`scripts/watch/sources/index.ts`:

| Source file | `id` | cadence | fingerprint |
|---|---|---|---|
| `nfc_film_register.ts` | `nfc_film_register` | monthly | hash of the latest `Registar-finansirani-filmi-*.xls` link/date on nfc.bg |
| `mc_budget_execution.ts` | `mc_budget_execution` | monthly | hash of the newest `Pril201-Otchet*.xlsx` link under mc.government.bg/документи/бюджет-* |
| `ncf_grant_results.ts` | `ncf_grant_results` | weekly | hash of the latest класиране post list on ncf.bg/bg/novini |

The watcher writes `state/watch/<id>.json` (`fingerprint`, `detail`, `meta`,
`lastChecked`, `lastChanged`); "changed" = current `fingerprint.value` ≠ stored value.

Process-watch-report mapping — add rows to the canonical source→skill table in
`.claude/skills/process-watch-report/SKILL.md` (all fan out to one skill; the
orchestrator dedupes):

| Watcher source id | Skill |
|---|---|
| `nfc_film_register` | `update-culture` |
| `mc_budget_execution` | `update-culture` |
| `ncf_grant_results` | `update-culture` |

Skill: create `.claude/skills/update-culture/SKILL.md` (shape on `update-nzok`/
`update-agri`). After a successful run it stamps `state/ingest/update-culture.json`
(`IngestState = {skill, lastSuccessfulIngest, summary}`) via
`npx tsx scripts/stamp-ingest.ts update-culture --summary "…"`. The orchestrator re-runs
the skill whenever any mapped source's `lastChanged` > the skill's `lastSuccessfulIngest`.

Per `feedback_one_off_backfills`: the 2014→2025 НФЦ backfill and any historical NCF
crawl go behind a `--backfill` flag, never in the watcher/CI; document in README.

## 9. recent_updates / changelog

Per `feedback_pg_changelog_required`, every new PG table wires into `recent_updates` via
`recordIngestBatch` (`scripts/db/lib/ingest_changelog.ts`), called INSIDE the loader's
BEGIN/COMMIT txn with a stable natural key that survives TRUNCATE+reload:

```
{ source: "kultura_subsidies", table: "kultura_subsidies",
  keyExpr: "t.id",
  nameExpr: "t.recipient_name",
  detailExpr: "t.program || ' · ' || t.year",
  amountExpr: "t.amount_eur", rowsTotal }
```

Day-coalesced + append-only history via `changelog_days`; auto-summary kicks in >500
rows/day (the НФЦ backfill will trip this — expected).

## 10. AI chat tools

Add a culture tool family per the ai/ recipe (`project_ai_chat_tools`): create
`ai/tools/culture.ts`; edit `ai/tools/registry.ts` (import + `ToolDef` entries in
`TOOLS`), `ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts`
(cases). Tools return an `Envelope` and NEVER compute numbers in prose — they only
narrate pre-computed `env.facts`; data via `fetchDb("culture-*", …)` for PG blobs.

Tools (domain `fiscal`):
- `cultureOverview` — total МК culture spend, split by discipline/program; headline +
  bar. facts: `totalEur`, `beneficiaries`, `biggestProgram`.
- `topCultureGrantees` — most-funded recipients (the concentration/celebrity story).
- `cultureForEntity` — awards for one organisation/person (EIK or name); the
  `/culture/grant` + recipient join. Pairs with the connections graph.
- `filmSubsidyForProducer` — НФЦ subsidy for a production company (per-producer `.xls`).
- `culturePerCapitaByOblast` — the map metric; "is my oblast under-funded for its size?"

Router keywords: `култур|театр|филм|кино|опера|читалищ|музей|грант|субсид|culture|
theatre|film|cinema|grant`. Provenance strings: `db:culture-*`. Any `/culture/*.json`
path an ai/ tool reads MUST have an `AI_PATH_RULES` entry (§11) or the prebuild fails.

## 11. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — `npm run data:map`; **prebuild fails on an unplaced source or an unmapped ai/ path**
- `SOURCE_GROUPS`: add a `culture` group — `origin: "state"`, `members:
  ["nfc_film_register", "mc_budget_execution", "ncf_grant_results"]`, `skills:
  ["update-culture"]`, `tags: ["fiscal","culture"]`, bilingual label/detail/desc, url.
- `DATASETS`: add `culture` (note PG-served via `kultura_payloads` — check how agri/funds
  are represented since they have no static JSON tree).
- `EDGES`: `["src:culture", "ds:culture"]` and `["ds:culture", "f:<culture-feature>"]`.
- `AI_PATH_RULES`: add `{ pattern: /^\/culture\//, dataset: "culture" }` if any ai/ tool
  reads a `/culture/*.json` path (the budget bridge JSON, at minimum).
- The validator also fails if a `SOURCE_GROUPS` member isn't in the watcher `SOURCES`, so
  §8 and this section must land together.

### README.md
- Feature list (top) — add "Culture spending — per-recipient subsidies to theatres, film,
  НФК grants".
- Data-sources / pipeline section — add НФЦ film register (`.xls`), МК program-budget
  execution, НФК grant results; parser path `scripts/culture/`, output `kultura_*` PG
  tables + `data/budget/kultura/budget.json`.
- Build commands — add the `update-culture` CLI + the `--backfill` flag.
- Update `CLAUDE.md`'s URL-contract / routes notes if `/culture` routes are added.

---

## 12. SEO surfaces — sitemap, static prerender, OG card

All three static/SEO surfaces read **one source of truth**: the `INSTITUTION_PACKS`
array in `scripts/prerender/institutions.ts`. Appending a single `InstitutionPack`
entry feeds the sitemap, the prerendered HTML, and the OG screenshot — the roads/НОИ/
НЗОК/ДФЗ packs are all wired this way. So the Култура work here is **one entry + one
`data-og` attribute on the hero tile**.

### The entry (append after the ДФЗ entry)
```ts
{
  eik: "000695160",
  slug: "kultura",                        // → public/og/awarder/kultura.png
  nameBg: "Министерство на културата",
  nameEn: "Ministry of Culture (МК)",
  titleBg: "Министерство на културата — къде отиват парите за култура | Наясно",
  titleEn: "Ministry of Culture — where culture money goes | Naiasno",
  descriptionBg: "Държавни субсидии за театри, кино (НФЦ), НФК грантове и читалища …",
  descriptionEn: "State subsidies to theatres, film (NFC), NCF grants and читалища …",
  bodyBg: `<h1>Министерство на културата — публични разходи</h1><p>…</p>`,  // crawlable, no scripts
  bodyEn: `<h1>Ministry of Culture — public spending</h1><p>…</p>`,
  ogAnchor: '[data-og="kultura-hero"]',   // the signature chart/map (below)
  ogCenter: true,                          // center-clip — reads best for a map
  ogSettleMs: 3000,                        // chart/map render-settle
}
```

### Sitemap (`scripts/sitemap/index.ts`)
No edit needed — it loops `INSTITUTION_PACKS` and pushes `/awarder/000695160` +
`/en/awarder/000695160`. **Validity rule** (`project_sitemap_validity_audit`): every
`<loc>` must resolve to a real prerendered `dist/<path>/index.html`, which the prerender
step below produces — so sitemap and prerender ship together, never sitemap alone.
`npm run sitemap`.

### Static prerender (`scripts/prerender/dynamicRoutes.ts` → `buildInstitutionAwarderRoute`)
No edit needed — it iterates `INSTITUTION_PACKS` and emits BG + EN static HTML at
`dist/awarder/000695160/index.html` (and `/en/…`) with the entry's title/description/
body + the `og:image` pointing at `public/og/awarder/kultura.png`. This is what fixes
the SEO-discovery gap (`feedback_static_seo`, `project_seo_discovery_gap`): crawlers get
real `<meta>` + crawlable body, not the empty SPA shell. `npm run prerender`.

### OG card — lead with a chart or map (`scripts/og/capture-screens.ts`)
No edit needed — it loops `INSTITUTION_PACKS`, and for each runs Playwright against the
live pack page, waits for `ogAnchor`, and clips a 1200×630 card centred on that visual
(roads → network map, НОИ → fund-flow bar, НЗОК → budget bridge). **The card leads with
the chart/map, not a KPI header** — so the Култура hero visual must carry a
`data-og="kultura-hero"` attribute.

- **Hero-visual choice:** the **per-capita-by-oblast choropleth** makes the most
  striking card (a coloured map of Bulgaria) — set `ogCenter: true`. Fallback: the
  **budget-bridge chart** (€269M → subsidy split). Whichever is chosen for the OG anchor,
  add `data-og="kultura-hero"` to its outer tile element (the same way roads/НОИ/НЗОК tag
  their hero). This is a Phase-1 build task on the pack component, not just a script edit.
- Capture (dev server + `/api/db` backend must be up):
  `npx tsx scripts/og/capture-screens.ts awarder/kultura` → `public/og/awarder/kultura.png`.
- The screenshot is a committed PNG (like `public/og/awarder/{roads,noi,nzok,dfz}.png`),
  regenerated only when the hero visual changes materially — not on every data refresh.

## 13. Phasing

Each phase carries its own wiring — a phase isn't "done" until its data is watched
(§8), changelogged (§9), placed on the data map (§11), prerendered + in the sitemap with
an OG card (§12), and its queries EXPLAIN-checked (§7). Don't defer the wiring to a later
phase; the data-map validator will fail the build if a source ships unplaced.

**Phase 1 (ship the pack):** НФЦ film register `.xls` ingest → `kultura_subsidies` +
`kultura_payloads`; МК budget bridge (static json) + НФЦ film-awards tile (repeat-winners
+ connections) + spend-by-discipline + per-capita map + procurement lens + nav.
Wiring: `nfc_film_register` + `mc_budget_execution` watchers, `update-culture` skill,
changelog, data-map `culture` group, `cultureOverview`/`topCultureGrantees`/
`filmSubsidyForProducer` AI tools, README, **and the SEO surfaces (§12): the
`INSTITUTION_PACKS` entry, the `data-og="kultura-hero"` attribute on the hero visual,
`npm run prerender` + `npm run sitemap`, and the captured `public/og/awarder/kultura.png`
card.** All buildable from the clean `.xls` + budget law. Ships the "Държавни структури"
entry.

**Phase 2 (recipient depth):** НФК grants with success rates + `/culture/grant/:id` deep
links (§6b) + Sofia program + читалища; add the `ncf_grant_results` watcher +
`cultureForEntity` tool + `culture_grants` DbDataTable registry. Theatre
subsidy-per-ticket where МК's published overspend lists + ДВ standards allow (may need
ЗДОИ for full per-institute reconstruction).

**Phase 3 (dedicated view):** standalone `/culture` explorer (agri `/subsidies` analog)
— searchable per-recipient table, discipline × oblast × year × МИР facets, CSV export;
the `culture` sector-browse-pack on `/procurement/contracts?sector=culture` (§6b).

---

## Open question for greenlight

Ship Phase 1 without the theatre subsidy-per-ticket data (defer to Phase 2 / ЗДОИ), or
source the per-institute delegated-budget reconstruction first? The signature
"does this theatre earn its subsidy?" tile is the highest-differentiation piece but the
hardest to source; МК's own published 120%-overspend lists give a partial path without
a ЗДОИ.
