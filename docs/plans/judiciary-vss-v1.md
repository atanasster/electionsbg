# Съдебна власт (ВСС / judiciary) view — implementation plan v1

Status: DRAFT (2026-07-09). Owner: TBD. Ships behind the existing sector-pack seam;
Phase 1 needs no routing changes. Mirrors the **Води (water) plan**
(`docs/plans/water-view-v1.md`) — shared infrastructure (`OblastChoropleth`,
`SectorBrowseSlot`) is designed once there and reused here; this doc only calls out
the judiciary specifics.

## 1. Goal & thesis

Add a "Съдебна власт" government-entity view covering Bulgaria's judiciary, mirroring
the АПИ / НОИ / НЗОК sector packs. The reader-facing thesis no existing site tells:
the **backlog + натовареност dissonance** — cases pile up while courts sit at wildly
uneven load (Sofia District Court ~2× the national average, military courts idle),
and the money-and-integrity layer (judicial budget per case, magistrate asset
declarations) lives only in ВСС PDFs, NGO microsites, and the Инспекторат register.
We are the only place that *joins* caseload, money, geography, and integrity.

Home surface: a **VssPack** on `/awarder/121513231` (Висш съдебен съвет) plus a
dedicated `/judiciary` screen for the caseload/map story, and a "Съдебна власт (ВСС)"
entry under **Държавни структури** in the управление menu (next to Пътища/АПИ,
Осигуряване/НОИ, Здравна каса/НЗОК, Води).

## 2. Entities — the judicial sector set

Unlike a single fund, the judiciary is a **multi-body sector** (like water's holding
+ 26 subsidiaries). Procurement is fairly centralised on the ВСС (it procures
buildings + IT for ВСС/ВАС/Прокуратура jointly — confirmed in a КЗК decision in our
corpus), but the sibling bodies are separate awarder EIKs.

| Body | EIK | Note |
|---|---|---|
| **Висш съдебен съвет (ВСС)** | **121513231** ✓ | The hub / pack anchor; administers the съдебна власт budget |
| Прокуратура на РБ | **121817309** ✓ | Separate awarder |
| Върховен административен съд (ВАС) | **121267370** ✓ | Separate awarder |
| Върховен касационен съд (ВКС) | TBD — resolve from awarder corpus | |
| Инспекторат към ВСС (ИВСС) | TBD | Also the **declarations register** source (§3, §7) |
| Национална следствена служба (НСлС) | TBD | |
| Individual courts (районни/окръжни/апелативни/административни) | each its own EIK | Resolve the set from the awarder corpus |

✓ = EIK verified in `data/procurement/tenders/index.json`. Action before build:
resolve the full judicial-EIK set (grep the awarder corpus for court/prosecution
names) and store in `src/lib/vssReferenceData.ts` (`VSS_EIK="121513231"` + the sibling
set + a court-code→EIK crosswalk). The consolidated-group rule from the SIGMA audit
applies: sector-wide procurement tiles aggregate across the whole EIK-set, not just
the ВСС parent.

## 3. Data source inventory (tiered by ingest cost)

Three sources are **already in our data** — the Tier-A MVP renders before any new ingest.

### Tier A — already ingested, zero new pipeline
- **Procurement** across the judicial EIK-set (`contracts` / `tenders`, keyed by
  awarder EIK). Consolidated group roll-up. ВСС alone: 142 procedures in the tenders
  index.
- **Judicial budget** — the съдебна власт is a distinct first-level spending body in
  the state budget we already ingest (`data/budget/`). Slice it out → budget-per-case,
  salary share, capital.
- **EU funds (ИСУН / ОПДУ „Добро управление")** — ВСС + ИВСС are named beneficiaries
  (justice-system reform projects). Join by beneficiary EIK.

### Tier B — structured, official, backfillable (one parser each)
- **ВСС statistical tables** (vss.justice.bg, XLS / „машинночетим формат", 2005–2025):
  cases filed / resolved / pending, within-3-month-deadline %, judge/prosecutor/
  investigator headcount, by court and court level (ВКС / ВАС / ПРБ / НСлС). The spine
  of the caseload + натовареност + duration story. Needs a **stable court-ID crosswalk**
  (courts get reorganised across the span — same class of problem as the oblast-code
  shard mismatch).
- **SINS натовареност** — complexity-weighted judge workload (contested methodology —
  show raw + weighted, cite IME/Capital).

### Tier C — new scrape (integrity differentiator)
- **Magistrate asset declarations** — Инспекторат към ВСС register (inspectoratvss.bg;
  **separate from the cacbg register** we already scrape for MPs/officials; ~25k
  declarations 2017–2024). Feeds the integrity tile (wealthiest magistrates, cars,
  apartments) cross-linked into the **Връзки** graph — the differentiator no competitor
  (BILI, fathers.bg) matches.

### Tier D — benchmarks (reuse existing)
- **EU Justice Scoreboard / CEPEJ** — clearance rate, disposition time, budget/capita,
  judges/100k, digitalization, trust; BG vs peers via `/indicators/compare`.
- **Trust in judiciary** — reuse the existing Eurobarometer table.

## 4. Architecture

### 4.1 The shared sector-pack grammar (extracted from АПИ/НОИ/НЗОК)
All three shipped packs share one 10-part skeleton; VssPack reuses it verbatim.
Reference `src/screens/components/procurement/{roads,noi,nzok}/*Pack.tsx` and the full
grammar table in the water plan §4. In brief:

| # | Element | Reuse | Vss usage |
|---|---|---|---|
| 1 | Section shell | `<section className="space-y-4">` | verbatim |
| 2 | Icon + title | `flex items-center gap-2 pt-2` + lucide icon + `<h2 text-lg font-semibold>`, bilingual | `Scale`, "Съдебна власт (ВСС)" |
| 3 | Domain-only KPI row | `grid gap-3 grid-cols-2` of `StatCard`, `text-2xl font-bold tabular-nums` | "Поръчки на година" + "Бюджет на съдебната власт" |
| 4 | Auto insight chips | `{text,warn?}[]`, `rounded-full`; `warn`→`WARN_CHIP_COLORS`; ≤5 | peak year, top category, direct-award % (warn >10%) |
| 5 | Hero "bridge" tile | fuse contract ledger with the bigger money | **budget bridge**: procurement as % of the judicial budget (clone `NzokBudgetBridgeTile`) |
| 6 | "What X buys, by function" | CPV→function `categoryLabel(id,lang)` | IT/сгради/охрана/услуги |
| 7 | Domain visuals | `Card/CardHeader/CardTitle/CardContent` (`@/ux/Card`), `text-[11px]` caption | budget/procurement/funds tiles |
| 8 | Optional local control | shared Radix `Select` only | budget-year picker (clone NZOK) |
| 9 | Static explainer | roads' "what drives cost/km" | "Как се измерва натовареността" (SINS caveat) |
| 10 | Provenance footer | `text-[11px] text-muted-foreground/80` | "бюджет — ЗДБРБ; поръчки — АОП/ЦАИС ЕОП; статистика — ВСС" |

Gating: `isLoading` → `h-[280px] animate-pulse rounded-xl border bg-card`; empty →
`return null`, but keep budget/statistics tiles alive with zero contracts in scope
(NZOK nuance).

### 4.2 Why the judiciary also needs a dedicated screen
The three packs are **procurement-centric** (everything hangs off
`useAwarderContracts`). That fits the judiciary's money story but not caseload flow,
натовареност map, duration, or declarations. So: **Phase 1 = pack** (money, fast,
on-pattern); **Phase 2 = dedicated `/judiciary` screen** built from the same primitives
(Card, StatCard, insight chips, `OblastChoropleth`, DbDataTable), homepage shell, no
tabs. The pack becomes the screen's "Пари" section (or links to `/awarder/121513231`).

Screen tiles, each mapped to a reused primitive:
- **Headline KPIs** — `StatCard` row (cases resolved, clearance rate, %-within-deadline,
  backlog, active magistrates, budget).
- **Каселоад flow** (signature) — filed/resolved/pending area chart 2005–2025 +
  clearance gauge. New Recharts tile.
- **Натовареност съдебна карта** — `OblastChoropleth` small-multiples (raw case count ·
  SINS-weighted load · clearance), click-to-filter the league table. Reuse the water
  plan's `OblastChoropleth` extraction (§4.1a there).
- **Court league table** — DbDataTable "See all" page `/judiciary/courts` (sortable by
  load/clearance/duration/staffing/vacancies, deep-links to court pages).
- **Продължителност** — duration distribution + within-deadline %.
- **Интегритет** — magistrate declarations tile (MpAvatar rows) → `/judiciary/magistrates`
  DbDataTable, cross-linked into Връзки.
- **EU compare + trust** — reuse `/indicators/compare` radar + Eurobarometer.

### 4.3 Contracts custom pack (sector browse pack — shared prerequisite)
The judicial bodies are multiple awarder EIKs, so — exactly like water — the "see all
судебна власт contracts" surface is the **sector browse pack** on `/procurement/contracts`,
NOT a bespoke fork. This seam is **designed in the water plan §4.3 but not yet built**
(`grep SECTOR_BROWSE_PACKS` → nothing today), so whoever ships first builds it:

- New registry `SECTOR_BROWSE_PACKS` in `sectorPacks.tsx`, keyed on a **sector id →
  EIK-set** (vs `getSectorPack(eik)`'s single entity). Add a `{ id: "judiciary", eiks:
  [<judicial EIK-set>], fixedFilters → awarder_eik IN eiks, Section?, columns? }` entry.
- `SectorBrowseSlot` mounted in `ContractsBrowserDbScreen` / `TendersBrowserDbScreen`
  reads `?sector=judiciary`, merges the EIK filter into the existing scope/CPV/method
  filters, and renders a judiciary enrichment strip above the table.
- The "Съдебна власт (ВСС)" nav pill links `/procurement/contracts?sector=judiciary`.
- **Backend prerequisite:** `contracts` `/api/db/table` registry must whitelist
  `awarder_eik` as a filter column (likely already — `/company/:eik` filters by it;
  verify). EXPLAIN-ANALYZE the `awarder_eik IN (…)` + window filter (§5).

### 4.4 Nav (two surfaces) + files
- **управление menu** — `src/layout/header/reportMenus.ts`, `menu_group_state_entities`
  group: add `{ title: "procurement_vss_nav", link: VSS_AWARDER_PATH }`.
- **Procurement sub-nav** — `ProcurementNav.tsx` `secondaryItems`: add
  `{ to: VSS_AWARDER_PATH, icon: Scale, key: "procurement_vss_nav" }` (uses
  `useProcurementHref` so scope survives).
- i18n: `procurement_vss_nav` = "Съдебна власт (ВСС)" / "Judiciary (ВСС)" in
  `src/locales/{bg,en}/translation.json`.
- Frontend files (mirror NZOK): `src/lib/vssReferenceData.ts` (NEW: EIK + sibling set +
  court crosswalk + category labels), `src/lib/vssAttributes.ts` (NEW: CPV→function
  classifier), `src/data/procurement/useVss.tsx` (NEW: contracts + budget + funds →
  `VssModel`), `src/data/budget/useBudget.tsx` (EDIT: `useJudicialBudget`,
  `useJudicialStats`), `src/screens/components/procurement/vss/` (NEW:
  `VssPack.tsx`, `VssBudgetBridgeTile`, `VssCategoryTile`), register `121513231`→`VssPack`
  + export `VSS_AWARDER_PATH` in `sectorPacks.tsx`. Phase 2 adds the `/judiciary` screen
  + `src/screens/dev/JudicialCourtsDbScreen.tsx` / `JudicialMagistratesDbScreen.tsx`.

## 5. Data model & SQL performance

PG-only convention (like agri/funds — no build*FromRows/db:gen; ingests write PG
directly; dashboard served from a precomputed blob table).

### Tables (new — Phase 2/3)
- `court_dim` — `eik PK`, `court_code`, `name`, `level` (районен|окръжен|апелативен|
  административен|ВКС|ВАС), `oblast`, `active_from/to` (the crosswalk for reorganisations).
- `court_caseload` — fact: `(court_code, year, half) PK`, `filed`, `resolved`, `pending`,
  `within_deadline`, `load_raw`, `load_sins`.
- `court_staffing` — `(court_code, year) PK`, `judges`, `vacancies`.
- `magistrate_declarations` — `(magistrate_id, year) PK`, `name`, `court_code`, `apartments`,
  `cars`, `assets_eur`, … (Tier C).
- `judiciary_payloads` — `(kind, key) PK`, `payload jsonb` (kind = `overview` | `court` |
  `sector_map` | `magistrates`), mirroring `agri_payloads` / `fund_payloads`; served via
  `/api/db/judiciary-*`.

Budget, EU funds, procurement are **joins onto existing** `budget` / `fund_*` /
`contracts` by EIK — not new tables.

### SQL performance verification (per the "always check DB query perf" rule)
Every new/changed query gets `EXPLAIN ANALYZE` on the **worst-case entity** before
shipping; add the index if it seq-scans (part of "done"):
- Index `(court_code, year)` on `court_caseload`, `court_staffing`; `(magistrate_id,
  year)` on `magistrate_declarations`; `court_dim(oblast)`, `court_dim(eik)`.
- **Worst case = the consolidated group roll-up** — `contracts WHERE awarder_eik IN
  (<judicial EIK-set>)` and the funds join on `fund_beneficiary_eik IN (…)`. Verify
  `contracts(awarder_eik)` and the funds beneficiary FK are indexed on **both sides** of
  the join (PG perf playbook); the `IN` list must be an index scan, not a seq scan over
  the whole corpus. This is the exact query the §4.3 sector browse pack fires.
- **Precompute** the group roll-up + натовареност sector-map into `judiciary_payloads`
  at ingest (global-hot, >200ms if live), not per page load. jsonb builders follow the
  payload-determinism rules: `ROUND` sums, rounded sort keys with eik tiebreaks,
  `COLLATE "C"` MINs; run the parity-audit recipe against a JSON dump of the same query.
- **DbDataTable** "See all" pages: register `/api/db/table` REGISTRY entries (a registry
  row each, not new endpoints; the column whitelist is the security boundary) —
  `judiciary-courts` (court × caseload/staffing, oblast+level+year filters),
  `judiciary-magistrates` (magistrate × declarations). Contracts "See all" reuses the
  existing `contracts` registry with the judicial EIK filter (§4.3). EXPLAIN-ANALYZE each.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.

## 6. AI chat tools

Add a judiciary tool family mirroring the procurement/awarder tools (per the ai/ tool
recipe): create `ai/tools/judiciary.ts`; edit `ai/tools/registry.ts` (import + `ToolDef`
entries in `TOOLS`), `ai/orchestrator/router.ts` (keyword block),
`ai/orchestrator/narrate.ts` (cases). Tools NEVER compute numbers in prose — they only
narrate `env.facts`; data via `fetchDb("judiciary-*", …)` for PG blobs or
`fetchData("/…")`.

- `courtCaseload` (domain `indicators`) — filed/resolved/pending + clearance, national
  or per-court.
- `courtWorkload` (domain `indicators`) — натовареност (raw + SINS) by court/oblast;
  most/least loaded.
- `judicialBudget` (domain `fiscal`) — судебна власт budget, budget-per-case, procurement
  share, EU funds drawn.
- `courtProfile` (domain `place`) — one court: caseload, duration, staffing, top contracts.
- `magistrateDeclarations` (domain `connections`) — wealthiest magistrates / cars /
  apartments (Tier C), with Връзки cross-links.
- `judiciaryEuCompare` (domain `compare`) — clearance/duration/budget/trust vs EU peers.

Router keywords: `съд|съдилищ|съдебн|прокуратур|магистрат|дела|натоварен|правосъд|ВСС|
court|judge|caseload|judiciary|prosecut`. Provenance strings: `db:judiciary-*` /
`vss.justice.bg`. Any `/…json` path an ai/ tool reads MUST have an `AI_PATH_RULES` entry
(§9) or the prebuild fails.

## 7. Watchers & process-watch-report wiring

Watcher sources (`scripts/watch/sources/*.ts`, `WatchSource` shape: `id`, `label`, `url`,
`cadence`, `fingerprint()`, `describe()`), imported and added to `SOURCES` in
`scripts/watch/sources/index.ts`:
- `vss_court_statistics.ts` — cadence `monthly` (annual + I-полугодие tables, check often);
  fingerprint = hash of the latest statistics-table link/date on vss.justice.bg.
- `ivss_declarations.ts` — cadence `monthly`; fingerprint = latest declaration-register
  publication on inspectoratvss.bg (Tier C).

(Budget / EU-funds / procurement changes already flow through the existing
`data.egov.bg бюджет`, `ИСУН EU funds`, `data.egov.bg АОП` watchers — no new source.)

Process-watch-report mapping — add rows to the table in
`.claude/skills/process-watch-report/SKILL.md` (all fan out to one skill; the
orchestrator dedupes):

| Watcher source id | Skill |
|---|---|
| `vss_court_statistics` | `update-judiciary` |
| `ivss_declarations` | `update-judiciary` |

Skill: create `.claude/skills/update-judiciary/SKILL.md` (shape on `update-nzok`). After a
successful run it stamps `state/ingest/update-judiciary.json` via
`npx tsx scripts/stamp-ingest.ts update-judiciary --summary "…"` (`IngestState` =
`{skill, lastSuccessfulIngest, summary}`). Follow the one-off-backfill rule: the 2005–2025
historical table backfill goes behind a `--backfill` flag, never in the watcher/CI;
document in README.

## 8. recent_updates / changelog

Every new table wires into `recent_updates` via `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`), called INSIDE each loader's BEGIN/COMMIT txn with a
stable natural key that survives TRUNCATE+reload:
- caseload: `{ source: "court_caseload", table: "court_caseload", keyExpr:
  "t.court_code || ':' || t.year || ':' || t.half", nameExpr: "t.court_code", detailExpr:
  "t.year || ' · ' || t.resolved || ' решени'", amountExpr: "NULL", rowsTotal }`
  (day/period-coalesced + auto-summary >500/day per the changelog rule).
- declarations: `{ source: "magistrate_declaration", keyExpr: "t.magistrate_id || ':' ||
  t.year", … }`.

## 9. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — the prebuild fails on an unplaced source
- `SOURCE_GROUPS`: add one `judiciary` group (`origin: "state"`, `members:
  ["vss_court_statistics", "ivss_declarations"]`, `skills: ["update-judiciary"]`, `tags:
  ["indicators"]`, `label/detail/desc/url` → ВСС / ИВСС).
- `DATASETS`: add `judiciary` (`path: "data/judiciary/"`, or note PG-served via
  `judiciary_payloads` — check how agri/funds are represented on the map).
- `EDGES`: `["src:judiciary", "ds:judiciary"]` + `["ds:judiciary", "f:<feature>"]` (feature
  node for the Vss pack / `/judiciary` screen).
- `AI_PATH_RULES`: add `{ pattern: /^\/judiciary\//, dataset: "judiciary" }` if any ai/ tool
  reads a static judiciary JSON.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data
  map" if a source is missing from a group. The `/data`, `/data/sources`, `/data/updates`
  pages render from this model — no separate edit needed.

### README.md
- "Data sources" (~L472) — add ВСС court statistics, ИВСС magistrate declarations, judicial
  budget slice (reuse), ОПДУ EU-funds reuse.
- "Data layout" (~L205) — document `data/judiciary/` (or the `court_*` / `judiciary_payloads`
  PG tables).
- Note the `update-judiciary` CLI flags (`--backfill` etc.) alongside the other `update-*`
  skills.

## 10. Phasing

- **Phase 1 — money pack (Tier A, renders today, no new ingest):**
  `vssReferenceData.ts` (EIK 121513231 + sibling set), register the pack,
  `VssBudgetBridgeTile` (procurement as % of the judicial budget), `VssCategoryTile`, auto
  chips + KPI, budget-year picker, both nav links + `procurement_vss_nav` i18n. Shared
  prerequisite: build the §4.3 `SECTOR_BROWSE_PACKS` seam (or wait for the water plan to)
  and add the `judiciary` sector entry + `/procurement/contracts?sector=judiciary` pill.
- **Phase 2 — the `/judiciary` screen (Tier B):** `update-judiciary` skill + ВСС statistics
  parser (caseload/duration/staffing + court crosswalk) → caseload-flow hero, натовареност
  `OblastChoropleth` triptych, `/judiciary/courts` DbDataTable, duration tile. Wire watcher,
  changelog, data map, README, AI tools.
- **Phase 3 — integrity + benchmarks (Tier C/D):** ИВСС magistrate-declaration scrape →
  integrity tile + `/judiciary/magistrates` + Връзки cross-links; EU Justice Scoreboard /
  CEPEJ compare on `/indicators/compare`; Eurobarometer trust.

## 11. Open questions / risks
- Resolve the full judicial EIK-set (ВКС, ИВСС, НСлС, individual courts) from the awarder
  corpus for `vssReferenceData.ts`.
- Court reorganisations (съдебна карта) shift unit boundaries 2005–2025 — the court-ID
  crosswalk (`court_dim.active_from/to`) is the hard part.
- SINS натовареност methodology is politically contested (IME/Capital) — show raw +
  weighted with a one-line "why these differ".
- Magistrate declarations are public and precedented, but magistrates aren't elected —
  mirror the MP-declaration framing, don't sensationalize; ИВСС register may need OCR (reuse
  the Gemini Vision pattern from council/capital-programmes).
- `SECTOR_BROWSE_PACKS` is unbuilt — coordinate with the water plan so it's built once.

## 12. Competitive context (why this wins)
Public data exists but lives as government-CMS PDFs (vss.justice.bg, 2005–2025) or one-off
NGO analyses on separate microsites — nobody has an interactive, longitudinal, geographic,
integrity-linked judiciary dashboard. Closest players: **ИПИ/IME** (натовареност essays, no
live data), **BILI** (`appointmentsboard.bg` + `judicialprofiles.bg` + asset analyses;
fragmented, appointment-centric), **fathers.bg** (single-axis wealth ranking), **Инспекторат
към ВСС** (the raw declaration register). Наясно's edge: geographic + longitudinal +
cross-linked (magistrate ↔ declarations ↔ Връзки ↔ procurement) + EU peer compare, all on
infrastructure already built.
