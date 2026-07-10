# Образование (МОН) — education entity + equity explorer (v1, moonshot)

**Status:** planning · **Owner:** —  · **Route:** `/awarder/000695114` (+ `/school/:id`, `/education*`)
**Goal:** the world's best public education-data view for Bulgaria — not a data dump. The
through-line of every world-class education dashboard is one rule: **never rank raw scores
nakedly.** Contextualize by socioeconomics, measure growth not just level, lead with equity
gaps, let people find *their* school on a map, and refuse the single seductive number.

This plan turns МОН into the equity-and-outcomes lens on Bulgarian schooling, riding the
existing sector-pack pattern (like НЗОК/НОИ/АПИ) plus a new school-level explorer.

---

## 0. Why we're closer than it looks

Already in the repo (no new work):

| Asset | Path | Note |
|---|---|---|
| МОН budget law-vs-execution | `data/budget/ministries/admin-ministerstvo-na-obrazovanieto-i-naukata.json` | EIK `000695114`, 2018–2026, admin+program grain, €350M / 866 procurement contracts |
| Per-school ДЗИ (+НВО slots) | `data/schools/index.json` (344 KB) | 978 schools · 242 общини · `scoresByYear` · keyed by obshtina · **`loc` empty, no SES** |
| Schools hook | `src/data/schools/useSchools.tsx` | `SchoolRecord {id,name,type?,address?,loc?,scoresByYear}`; Sofia районы → `SOF00` fallback |
| Per-obshtina ДЗИ indicator | `data/indicators/MON*.json` + `useIndicators` | `dzi` series, absolute delta kind |
| SES raw material | `data/census/`, `data/indicators.json`, `data/regional.json`, `data/grao_population.json`, `--local-problem-sections` risk-sections | enough to build a BG-ICSEA context index |
| Peer-compare UI | `/indicators/compare` `?peers=` | reuse verbatim for PISA/spend vs RO/GR/HR/EU |
| Money layers | budget · ИСУН EU-funds · procurement · `data/budget/municipal_transfers/` | the money-trail spine no education portal on earth has |

The gap between "data dump" and "world-class" is exactly four missing things: **geocoded
schools, a socioeconomic context index, similar-school comparison, and growth/gap lenses.**
We own the raw material for all four.

---

## 1. Competitive frame (what we're stealing, one line each)

- **Australia MySchool / ICSEA** — the #1 pattern: judge each school against ~SES-similar
  peers, colour cells green/red vs *similar* not vs national. "Над очакваното за средата си."
- **Stanford SEDA / Educational Opportunity Project** — the killer visual: two scatterplots,
  same x-axis (context). SES→*level* is a steep diagonal (wealth buys the starting line);
  SES→*growth* is a flat blob (wealth barely predicts how fast kids learn). Proves value-added
  without a word of statistics. Never collapse **ниво / растеж / тренд** into one number.
- **UK Progress 8 / FFT Datalab** — value-added + five plain bands + confidence intervals;
  ~a third of units land in "неразличимо от типичното" *by design*. "The data is the
  starting point, not the conclusion."
- **Chile MIME / Categoría de Desempeño** — ordinal category (над/близо/под очакваното),
  peer-group cohorting, disclosed recipe, proximity-first parent search.
- **India ASER** — the can-do sentence: "X% от завършващите не покриват задължителната
  матура по БЕЛ" beats a mean score.
- **India UDISE+ / Brazil QEdu** — standardized per-school report card; dual entry (browse
  national→oblast→община→school *or* jump by school code); traffic-light anchored to a named
  target; slugged shareable per-school URLs (helps our SEO-discovery gap).
- **ProPublica Miseducation / EdBuild** — lead with the *gap* (rural vs urban, Roma-neighborhood
  vs rest) as the headline choropleth; self-lookup is the virality lever.
- **Ethics cautionary tales** — Ofsted/Ruth Perry, LA Times teacher-VAM/Ruelas, Campbell's Law:
  no single word/number verdict; publish uncertainty; celebrate over-performers, don't shame
  poor-intake schools. Baking the ethics in *is* a marketing moat (the "responsible" explorer).

Incumbents we beat: **regionalprofiles.bg** (oblast-grain only, annual PDF), **rsvu.mon.bg**
(higher-ed, locked UI), **НСИ** (dry tables), **danybon/nvoresults/klasirane** (naked league
tables — the anti-pattern).

---

## 2. Data foundation (the hard part; everything downstream is a query)

### 2.1 НВО ingest — free win, do first
Reuse the proven ДЗИ pipeline (`scripts/schools/build_index.ts`, `scripts/indicators/sources/mon_dzi.ts`).
НВО (7th-grade external assessment) is the same data.egov.bg org, same CSV/JSON formats, and
the `nvo_bel`/`nvo_math` subject slots already exist in `SchoolsFile.subjects`. Populates
per-school and per-obshtina. **Effort: low.**

### 2.2 Geocode the school registry — the highest-leverage single fix
`loc` is empty for all 978 schools → no map is possible. Fill it from the МОН institution
register (`ri.mon.bg` / `reg.mon.bg` / NEISPUO `neispuo.mon.bg`) or by matching `address` →
EKATTE settlement centroid (we already have EKATTE joins in ГРАО/census pipelines). Store
`loc: "lat,lng"`. Also capture `type` (primary/secondary/mixed/vocational), director contact,
and the МОН institution code so per-school URLs are stable. **Effort: medium (scrape/geocode).**

### 2.3 Enrollment per school — needed for dot-size + per-student spend
Pull student headcount per school from НСИ / the register. Enables SEDA-style enrollment-sized
dots and the "€/ученик" money read. **Effort: medium.**

### 2.4 BG-ICSEA — "Индекс на средата" (the socioeconomic context index)
The engine behind every fair comparison. Build a per-school (fallback per-obshtina/район)
context index from data we already ingest:
- census education attainment (share with tertiary / share with ≤ primary) — `data/census/`
- oblast/община wage + registered unemployment — `data/indicators.json`, `data/regional.json`
- ГРАО population / urban-rural flag — `data/grao_population.json`
- Roma-neighborhood risk-section share — `--local-problem-sections`
Standardize to mean 0 (national-average община = 0), disclose the recipe and weights on a
methodology page (Chile's trust move). This is an *area-level proxy* — weaker than MySchool's
parent-level ICSEA; label it honestly as "средата на общината/района", not a per-family index.
**Effort: medium (pure computation over existing data).**

### 2.5 Eurostat / E&T Monitor decline-narrative series
National + oblast time series for the story numbers, via the Eurostat API already in-project
(`update-macro`/`update-regional`): PISA underperformance (math 53.6% below baseline — worst in
EU), early-leavers (8.2% nat'l; **17.7% rural vs 3.4% cities**), teacher aging (31.4% are 55+),
tertiary attainment (40.5%), per-student spend vs EU (~4.8% GDP). **Effort: low-medium.**

### 2.6 Deferred (scrape/PDF, not v1)
Per-school делегирани бюджети (mon.bg PDF/XLSX behind orders, WAF-blocked), rsvu university
ratings, НАЦИД registers. Wire later as their own tiles.

> Per project rules: any published DATA card number must be confirmed against the primary
> source (not a search summary), figures displayed in EUR, ПГ-migrated datasets wired into
> `recent_updates`. New tables (school SES, enrollment, geocodes) follow the Postgres-first
> convention if they become serving data; static JSON stays the ingest output.

---

## 3. Product surface

Two front doors, one data spine.

### 3.1 `/awarder/000695114` — МОН entity page (sector pack)
Follows the НЗОК template exactly. New files:
- `src/lib/monBenchmarks.ts` — `MON_EIK="000695114"`, CPV→category (it / infrastructure /
  curriculum / services / other), labels, statutory-supplier context.
- `src/screens/components/procurement/mon/MonPack.tsx` + tiles.
- `src/data/procurement/useMonData.tsx` — budget + indicators + schools rollup + contracts.
- register in `sectorPacks.tsx` (`[MON_EIK]: MonPack`, export `MON_AWARDER_PATH`).
- nav item in `reportMenus.ts` → `menu_group_state_entities` → `procurement_mon_nav`
  ("Образование (МОН)"), under "Държавни структури".
- i18n keys.

Pack tiles (sector-unique; generic KPIs/contracts/risk already render above):
1. **Бюджет: закон срещу изпълнение** — МОН budget bridge (data exists).
2. **Къде отиват парите** — делегирани бюджети (ЕРС per-student formula) → EU desegregation
   funds (ИСУН) → procurement. The money-trail spine.
3. **Резултати накратко** — decline-narrative strip (§2.5) as can-do sentences + sparklines,
   each cross-linked to a община.
4. **Училищата в България** — entry card into the school explorer (map + finder).

### 3.2 `/education` — the school equity explorer (the moonshot)
A dedicated view (dashboard shell, homepage-width, no `max-w` cap, no tabs — stacked
sections/tiles per house UX). Sections:

**A. Намери своето училище** — geolocated Leaflet map (stack already has Leaflet) + focus-gated
typeahead (mirror the procurement company-search pattern). Cluster pins; filter by level/type;
click → `/school/:id`. Dual entry: browse map *or* jump by school code.

**B. Картата на неравенството** — the ProPublica-Miseducation headline: oblast/община choropleth
of the ДЗИ/НВО (and dropout where available) **gap** — rural vs urban, Roma-risk-section share
vs rest. Toggle metric. This is the shareable data-journalism artifact and our differentiator.

**C. Ниво срещу среда** — the SEDA двойна scatter. Two charts, same x-axis (Индекс на средата):
left = резултат vs среда (steep diagonal), right = растеж vs среда (flat blob). Each school a
dot sized by enrollment, with the expectation (regression) line drawn. "Над линията = постига
повече от очакваното за средата си." One glance proves the value-added point.

**D. Сравнение с ЕС** — reuse `/indicators/compare` `?peers=` for PISA + per-student spend vs
RO/GR/HR/EU.

### 3.3 `/school/:id` — per-school report card (UDISE+/MIME + MySchool)
Slugged, shareable, prerendered for SEO. Refuses one grade — shows **three verdicts that may
disagree**:
- **Профил** — name, type, обшина/oblast, enrollment, map pin, director contact.
- **Ниво** — raw ДЗИ/НВО, national percentile + "you are here" on the distribution.
- **Постижение спрямо средата** — the ICSEA move: result vs SES-similar cohort (~N nearest by
  Индекс на средата), colour-coded над/близо/под очакваното, with a **confidence interval** and
  **small-N suppression** (grey "недостатъчно данни" for tiny cohorts; never a false-precise rank).
- **Тренд** — 4-year `scoresByYear` sparkline + signed "движение спрямо oblast" chip (poor-man's
  growth until true prior-attainment linkage exists).
- **Контекст** — links out to the община dashboard, census, wages, EU-funds, procurement —
  the cross-linking no education portal has.

Band thresholds anchored to a *named* standard (QEdu/Chile style), shown to the user, not
arbitrary quantiles. Methodology link on every verdict.

---

## 4. Ethics guardrails (product, not decoration)

Bake these in from day one — they're the moat and they prevent real harm (Ruth Perry, Ruelas):
1. **No single composite "best school in Bulgaria" rank.** Ever. Multiple non-composite measures.
2. **Level, growth, trend stay separate** — one toggle, three verdicts allowed to disagree.
3. **Confidence intervals + small-N suppression + outlier capping** — uncertainty is the most
   honest part of the number; most schools honestly labelled "типично за средата си".
4. **Context-adjusted framing celebrates over-performers**, never shames poor-intake schools;
   show raw AND context-adjusted side by side and explain the gap (the CVA lesson — don't force
   one contested "fair" number).
5. **Visible methodology + "данните са начало на разговор, не присъда"** copy.

---

## 5. Data model & SQL performance

Today `data/schools/index.json` is a **static 344 KB file** served as-is (`useSchools` fetches
it whole). That's fine for a top-3 tile, but the moonshot needs server-side paginated browse,
similar-cohort queries, and precomputed scatter/report-card blobs. Migrate schools to Postgres
following the **PG-only convention of the agri/funds packs** (no `build*FromRows`/`db:gen-*`;
ingest writes PG directly; dashboard served from a precomputed blob table). Keep the static JSON
as the ingest artifact for the tiny `useSchools` tile / offline verification net.

### Tables (new)
- `schools` — dim: `id PK` (МОН institution code), `name`, `obshtina`, `oblast`, `type`
  (primary|secondary|mixed|vocational), `lat`, `lng`, `settlement_ekatte`, `awarder_eik`
  (schools ARE awarder EIKs in the contracts corpus — the ЦАИС feed adds ~900 school/kindergarten
  buyers), `enrollment`.
- `school_scores` — fact: `(school_id, year, subject) PK`, `value numeric`, `n int` (cohort size,
  for small-N suppression). subject ∈ `dzi_bel|dzi_math|nvo_bel|nvo_math`.
- `school_context` — the **Индекс на средата** (BG-ICSEA): `(school_id) PK` (fallback obshtina/
  район grain), `ses_index numeric` (mean 0 = national-average община), plus the disclosed
  component columns (`pct_tertiary`, `pct_low_edu`, `wage`, `unemployment`, `roma_risk_share`,
  `urban bool`) so the methodology page can show the recipe.
- `school_payloads` — `(kind, key) PK`, `payload jsonb` — precomputed dashboard blobs, mirroring
  `agri_payloads`/`fund_payloads`. kinds: `report_card` (per `school_id`, the full `/school/:id`
  view incl. its ~N similar cohort + verdict + CI), `scatter` (the `/education` двойна-scatter
  point cloud + regression line + national percentiles), `gap_map` (oblast/обшина choropleth
  values). Serve via `/api/db/education-*` routes.

Budget, EU funds and procurement are **NOT** new tables — joins onto the existing МОН ministry
budget artifact / `fund_*` / `contracts` by `awarder_eik`.

### SQL performance verification (per the "always check DB query perf" rule)
Every new/changed query gets `EXPLAIN ANALYZE` on the **worst-case entity** before shipping, and
an index if it seq-scans (part of "done"). Concretely:
- Index `school_scores(school_id, year, subject)`, `school_scores(subject, year)` (for the
  national scatter / percentile pass), `schools(obshtina)`, `schools(oblast)`,
  `schools(awarder_eik)` (for the report-card procurement join — both sides indexed per the PG
  perf playbook).
- **Worst case = the similar-cohort lookup** (for each school, the N nearest by `ses_index`) and
  the **national scatter build** (all 978 schools × latest-year score × context). Both are
  global-hot and O(n) or O(n·N) — **precompute into `school_payloads` at ingest**, not per page
  load (>200ms if live). The `/education` scatter and every `/school/:id` verdict read one
  `school_payloads` row.
- jsonb builders follow the **payload-determinism rules**: `ROUND` the SES/score numbers, rounded
  sort keys with `school_id` tiebreaks, `COLLATE "C"` for any MIN/label; run the parity-audit
  recipe against a JSON dump of the same query.
- The report card's "училищни поръчки" tile joins `contracts WHERE awarder_eik = <school>` —
  verify the existing `contracts(awarder_eik)` index covers it (it already backs `/company/:eik`).
- Any EUR sums (per-student spend, school procurement) use `totalEur = Σ per-row amountEur` (PG
  basis), never per-currency convert (per `reference_procurement_eur_sum_basis`).

## 6. Browse pages — the "contracts custom pack" pattern

Reuse the server-side `DbDataTable` browse-screen pattern (`ContractsBrowserDbScreen` /
`TendersBrowserDbScreen` in `src/screens/dev/`: a `DbDataTable` with `resource` + `fixedFilters`
+ `extraFilters` + custom `columns`/`toolbar`/`renderAggregates`, backed by a `/api/db/table`
REGISTRY entry — the column whitelist is the security boundary). No pack tile dumps a long list;
each ends in a **"Виж всички"** link to a dedicated server-paginated page.

| Dataset | Top-N tile (in pack/explorer) | Standalone page (route) | DbDataTable registry key |
|---|---|---|---|
| 978 schools (score/context/verdict) | explorer finder + Top-N | `/education/schools` | `schools` (NEW) |
| МОН's own contracts | `MonPack` category/top | `/procurement/contracts?sector=education` | existing `contracts` |
| All school-buyer contracts | (education sector-browse) | `/procurement/contracts?sector=education` | existing `contracts` |

- **`SchoolsBrowserDbScreen` + `/education/schools`** — new screen mirroring
  `ContractsBrowserDbScreen`: columns = училище (→`/school/:id`), обшина/oblast, тип, matura/НВО,
  **постижение спрямо средата** (the над/близо/под verdict chip), тренд sparkline; facet toolbar =
  oblast + type; `renderAggregates` = school count + median score. New `schools` REGISTRY entry in
  `/api/db/table` (whitelist `obshtina`, `oblast`, `type`, `year`, `subject`), `EXPLAIN ANALYZE`d.
- **Education sector-browse pack** — if the Water plan's `SECTOR_BROWSE_PACKS` seam lands first,
  add an `education` entry (`eiks` = МОН + all school-buyer EIKs) so `/procurement/contracts?sector=
  education` shows the whole education procurement slice with an enrichment strip above the table.
  Otherwise the МОН awarder page's own contracts suffice for v1. Reuse, don't fork a bespoke page.

## 7. AI chat tools

Add an education tool family mirroring the place/fiscal tools (per the ai/ tool recipe,
`project_ai_chat_tools`). Files: create `ai/tools/education.ts`; edit `ai/tools/registry.ts`
(import + `ToolDef` entries in `TOOLS`), `ai/orchestrator/router.ts` (keyword block),
`ai/orchestrator/narrate.ts` (cases). Tools follow the Envelope→narrate→UI pipeline — they NEVER
compute numbers in prose, only narrate `env.facts`; data via `fetchDb("education-*", …)` for PG
blobs or `fetchData("/schools/index.json")`.

- `schoolProfile` (domain `place`) — one school: matura/НВО, verdict vs средата, trend, top
  contracts. Resolves by name or МОН code.
- `schoolsNearMe` (domain `place`) — schools in an обшина/oblast ranked, with the над/под-средата
  verdict (not a naked score rank).
- `maturaByPlace` (domain `indicators`) — ДЗИ/НВО averages by обшина/oblast + national trend;
  drill from the existing `dzi` indicator.
- `educationGaps` (domain `indicators`) — the equity headline: rural-vs-urban / Roma-risk gap in
  outcomes; dropout, teacher-aging, per-student spend vs EU.
- `monFiscal` (domain `fiscal`) — МОН budget law-vs-execution + делегирани бюджети + EU-funds +
  procurement (the money-trail spine).

Router keywords: `училищ|матур|дзи|нво|образован|учител|отпаднал|среден успех|school|matura|
education|dropout|pisa`. Provenance strings: `db:education-*` / `schools/index.json`. **Note:**
`/schools/*` is already whitelisted in `AI_PATH_RULES` (`model.ts:106` → dataset `indicators`);
if tools read a new `/education/*.json` path, add an `AI_PATH_RULES` entry or the prebuild fails.

## 8. Watchers & process-watch-report wiring

The ДЗИ path is **already wired**: `scripts/watch/sources/indicators_mon_dzi.ts` → maps to
`update-indicators` in `.claude/skills/process-watch-report/SKILL.md`, which already re-runs
`scripts/schools/build_index.ts` (reuses the МОН per-school CSVs into `data/schools/index.json`).
Extend, don't duplicate.

New watcher sources (`scripts/watch/sources/*.ts`, `WatchSource` shape: `id`,`label`,`url`,
`cadence`,`fingerprint()`,`describe()`; add to `SOURCES` in `scripts/watch/sources/index.ts`):
- `mon_school_register.ts` — cadence `monthly`; fingerprint = latest ri.mon.bg/NEISPUO register
  export date (drives geocodes + enrollment + type).
- `mon_nvo.ts` — cadence `annual` (check monthly); fingerprint = hash of the НВО data.egov.bg
  resource list (7th-grade external assessment; same portal as ДЗИ).
- `eurostat_education.ts` — reuse the existing Eurostat watcher mechanism if one exists
  (`indicators`/`macro` already poll Eurostat); add the education series (early-leavers, tertiary,
  PISA-adjacent, spend %GDP) as a fingerprinted source.

New skill `.claude/skills/update-schools/SKILL.md` (shape on `update-nzok`/`update-indicators`)
owning geocode + enrollment + НВО + **Индекс на средата** compute + the PG load. Mapping rows to
add to the process-watch-report table (all fan out; orchestrator dedupes):

| Watcher source id | Skill |
|---|---|
| `indicators_mon_dzi` | `update-indicators` **+ `update-schools`** (extend the existing fan-out) |
| `mon_school_register` | `update-schools` |
| `mon_nvo` | `update-schools` |
| `eurostat_education` | `update-schools` (or `update-macro` for the national series) |

After a successful run the skill stamps `state/ingest/update-schools.json` via
`npx tsx scripts/stamp-ingest.ts update-schools --summary "…"`. Per the one-off-backfill rule,
the geocode + historical-НВО backfills go behind a `--backfill` flag, never in the watcher/CI;
document in README.

## 9. recent_updates / changelog

Every new PG table wires into `recent_updates` via `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`), called INSIDE each loader's BEGIN/COMMIT txn with a stable
natural key that survives TRUNCATE+reload (per `feedback_pg_changelog_required`):
- scores: `{ source: "school_scores", table: "school_scores", keyExpr: "t.school_id || ':' ||
  t.year || ':' || t.subject", nameExpr: "(SELECT name FROM schools s WHERE s.id=t.school_id)",
  detailExpr: "t.year || ' · ' || t.subject || ' ' || t.value", amountExpr: "NULL", rowsTotal }`
  (day-coalesced + auto-summary >500/day is the default).
- context: `{ source: "school_context", keyExpr: "t.school_id", detailExpr: "'индекс на средата '
  || t.ses_index", … }`.

## 10. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source
Schools already ride the `indicators` dataset (`model.ts:106` AI_PATH_RULES; `indicators_mon_dzi`
is an `indicators` source member ~L224). For a top-level Образование view, promote it:
- `SOURCE_GROUPS`: add a `mon_education` member set (`origin:"state"`, `members:
  ["indicators_mon_dzi","mon_school_register","mon_nvo","eurostat_education"]`, `skills:
  ["update-indicators","update-schools"]`, `tags:["indicators"]`, label/detail/url = МОН).
- `DATASETS`: add `education` (`path:"data/schools/"` or note it's PG-served via `school_payloads`,
  matching how agri/funds are represented). Point `/education` and `/school/` at it (extend the
  `model.ts:106` route pattern or add a new AI_PATH_RULES entry).
- `EDGES`: `["src:mon_education","ds:education"]` + `["ds:education","f:<feature>"]` (a feature node
  for the МОН pack + `/education` explorer). The budget link stays on the fiscal group.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data map"
  if a source is missing from a group.

### README.md
- "Data sources" (~L472) — add НВО (data.egov.bg МОН), the МОН institution register (geocodes +
  enrollment), Eurostat education series, and note ДЗИ is already listed.
- "Data layout" (~L205) — document the new `school_*` PG tables (+ `data/schools/` JSON artifact).
- Document the `update-schools` CLI flags (`--backfill`, geocode/enrollment steps) alongside the
  other `update-*` skills.

## 11. Sitemap, static pages & OG cards

The pack's whole SEO surface flows from ONE source of truth: `INSTITUTION_PACKS` in
`scripts/prerender/institutions.ts`. Adding a single МОН entry there wires three consumers
automatically (prerender static HTML+meta, sitemap `/awarder` URLs, OG-card capture). The new
`/education*` and `/school/:id` routes then need their own prerender + sitemap + OG entries. This
is the fix for the `feedback_static_seo` gap — without it a no-JS crawler hits the SPA rewrite and
sees the homepage meta (a soft-duplicate).

### a. МОН awarder pack — one `InstitutionPack` entry does everything
```
{
  eik: "000695114", slug: "mon",           // → public/og/awarder/mon.png
  nameBg: "Министерство на образованието и науката",
  nameEn: "Ministry of Education and Science (МОН)",
  titleBg/titleEn, descriptionBg/descriptionEn,   // <title>/<meta>
  bodyBg/bodyEn,   // crawlable <h1>+<p>: matura crisis + per-school + money-trail framing,
                   // with internal links to /education, /budget, /procurement
  ogAnchor: '[data-og="education-scatter"]',   // the signature visual — see (c)
  ogCenter: true,        // scatter/map read from the middle
  ogSettleMs: 3500,      // give the scatter + regression line time to render
}
```
For free, this yields:
- **Prerender** (`scripts/prerender/dynamicRoutes.ts`) — static `/awarder/000695114` (+`/en`)
  with the crawlable body, `<title>`, `<meta description>`, `og:image → /og/awarder/mon.png`.
- **Sitemap** (`scripts/sitemap/index.ts`) — `/awarder/000695114` (+`/en`) enumerated straight
  from `INSTITUTION_PACKS` (per the `route_defs.ts:233` note); no `route_defs` edit needed.
- **OG capture** — the capture loop already iterates `INSTITUTION_PACKS` (`capture-screens.ts:344`),
  so the card is produced automatically once the pack hero exposes the `data-og` anchor.

Keep `INSTITUTION_PACKS` ↔ the `PACKS` registry (`sectorPacks.tsx`) ↔ app-side `MON_EIK` in sync
(the `institutions.ts` header calls this out).

### b. /education explorer, /education/schools browse, /school/:id cards
These are NOT institution packs — add explicit entries like the other static screens:
- **Sitemap** (`scripts/sitemap/route_defs.ts`):
  - `{ path: "education", file: "src/screens/EducationScreen.tsx" }`
  - `{ path: "education/schools", file: "src/screens/dev/SchoolsBrowserDbScreen.tsx" }`
  - `{ path: "school/:id", file: "schools-list" }` — dynamic, one URL per school; a new
    `schools-list` enumerator in `dynamicRoutes.ts` reads the schools index / PG. 978 URLs is
    well within the Firebase file ceiling (`project_firebase_deploy_ceiling`).
  - add `"education"` + `"education/schools"` to `ENGLISH_STATIC_PAGES` (needs matching
    `english:` blocks in `scripts/prerender/routes.ts`, else the `/en` entry resolves only via
    runtime i18n).
- **Static page generation** (`scripts/prerender/dynamicRoutes.ts`): `buildSchoolRoutes()` emits,
  per school, a thin crawlable page — `<h1>{name}</h1>`, обшина/oblast, latest matura/НВО, the
  над/под-средата verdict in plain HTML, and internal links to the обшина dashboard + `/education`.
  Per the SEO-discovery memo the win is **crawlable HTML + internal links, not screenshots**.
  Per-school `og:image` reuses the shared `mon.png` (don't screenshot 978 pages; a per-oblast card
  is a later nicety). `/school/:id` is canonical; any обшина-tab surfacing of a school sets
  `<link rel=canonical>` back to it (mirrors the candidate sub-tab pattern).

### c. Beautiful OG cards — lead with a chart or map, never a KPI header
`institutions.ts` is explicit: each card should "lead with the roads map / fund-flow bar / budget
bridge chart rather than a plain KPI header." For МОН, frame the strongest data-journalism image:
- **Pack card (`/og/awarder/mon.png`):** the **SEDA двойна scatter** — tag the pack's hero tile
  `data-og="education-scatter"`; a point cloud + regression line reads beautifully centered
  (`ogCenter:true`). Fallback hero: the **inequality choropleth** (`data-og="education-gap-map"`)
  if the map is the stronger top tile.
- **`/education` explorer card:** add a `captures[]` entry (slug `education`, routePath
  `education`, `waitFor`/`anchor` = `.leaflet-container` for the school-finder map *or* the
  scatter's `.recharts-wrapper`, `centerOnAnchor:true`, `settleMs:3000`) — same recipe as the
  `persistence` (map) and `indicators-compare` (chart) captures.
- **`/education/schools` browse card:** a `captures[]` entry anchored on the table `section`
  (like `procurement-contracts`), leading with the summary strip + verdict-chip column.
- **Render requirements:** the hero exposes a stable `data-og` selector and finishes rendering
  inside the settle window (Recharts `.recharts-surface` / Leaflet `.leaflet-container` present);
  capture runs against the dev server with `/api/db` up (schools served from PG), locale bg,
  1200×630 @2x. Commit the PNGs (`public/og/awarder/mon.png` + `public/og/education*.png`) —
  the other `public/og/awarder/*.png` are committed artifacts.

## 12. Build sequence

| Phase | Deliverable | Wiring done in-phase | Depends on |
|---|---|---|---|
| **P0 Skeleton** | МОН sector pack (`sectorPacks.tsx`, `MonPack`) + nav + budget bridge + decline strip. Ships alone; beats regionalprofiles.bg on grain. | i18n `procurement_mon_nav`; data-map feature node; **`INSTITUTION_PACKS` МОН entry → prerender + sitemap `/awarder/000695114`** | none |
| **P1 Data** | НВО ingest · geocode registry (`loc`/`lat,lng`) · enrollment · Eurostat E&T · **Индекс на средата** · **schools→PG migration** (`schools`/`school_scores`/`school_context`) | new watcher sources; `update-schools` skill; `stamp-ingest`; `recordIngestBatch`; data-map source group; README | P0 |
| **P2 Explorer + report card** | `/education` map + finder + `/school/:id` card (level + trend); `SchoolsBrowserDbScreen` + `/education/schools` | `schools` `/api/db/table` REGISTRY (EXPLAIN ANALYZE); AI `schoolProfile`/`schoolsNearMe`; **`/education*` + `school/:id` routeDefs + `buildSchoolRoutes` prerender** | P1 geocode+PG |
| **P3 Equity engine** | similar-cohorts · SEDA двойна scatter · band/CI verdicts · `school_payloads` precompute | payload-determinism parity audit; AI `maturaByPlace`/`educationGaps`; **`data-og="education-scatter"` on the hero tile** | P1 SES index |
| **P4 Journalism + spine** | inequality choropleth (`OblastChoropleth`) · money-trail spine · `?peers=` PISA panel | AI `monFiscal`; education sector-browse pack (if Water's seam landed); **`data-og="education-gap-map"`** | P2,P3 |
| **P5 Ship** | ethics/methodology page · **OG capture (`mon.png` + `education*.png`) + `ENGLISH_STATIC_PAGES` + `/en` prerender mirrors** · `bucket:sync` · Cloud SQL publish (`apply_functions.ts` + `db:load:*:cloud`) · README/data-map final · `naiasno-post` FEATURE launch | changelog verified; sitemap + data-map build clean; docs updated | all |

## 13. Open questions / risks
- **Geocoding coverage** — if the МОН register isn't cleanly scrapable, fall back to EKATTE
  centroid by `address` (coarser pins but shippable). Gates the whole map.
- **SES index is area-level, not per-family** — label it honestly ("средата на общината/района");
  over-claiming invites the "you're just re-ranking rich vs poor" critique.
- **НВО vs ДЗИ cohorts differ** (7th grade vs graduating) — separate lenses, never averaged.
- **Static-JSON vs PG dual life** — keep `data/schools/index.json` as the tiny-tile artifact +
  verification net while the browse/scatter serve from PG; don't let them drift (parity check).
- **Firebase file-ceiling** (`project_firebase_deploy_ceiling`) — 978 prerendered `/school/*`
  pages is fine; watch total dist file count.
- **Prod deploy** — new PG tables need their DDL applied to Cloud SQL (`apply_functions.ts`
  against the proxy) + a `db:load:school:pg:cloud`-style loader wrapper (write one; `db:dump`
  is only an outward GCS snapshot and creates nothing) + functions redeploy (like the procurement/funds
  migrations); `school_*` excluded from `bucket:sync` if PG-served.
- **Deferred data** (делегирани бюджети per school, rsvu, НАЦИД) — real gaps; wire as later tiles.

## 14. Sources (verify before publishing any DATA card)
data.egov.bg МОН org `a57a2273-…`; ДЗИ dataset `066b4b04-…`; МОН institution register
(ri.mon.bg / neispuo.mon.bg); EU E&T Monitor 2024 (BG)
`op.europa.eu/webpub/eac/education-and-training-monitor/en/country-reports/bulgaria.html`;
MySchool ICSEA guide (myschool.edu.au); Stanford EOP `edopportunity.org`; UK Progress 8 DfE
guidance; Chile Categoría de Desempeño (agenciaeducacion.cl). Full URL set in the research thread.
