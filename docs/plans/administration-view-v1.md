# Административно обслужване / Държавна администрация — pack + view (v1 plan)

Competitive research + dashboard brainstorm for a new government-entity pack around
**административно обслужване** (administrative services to citizens & business) and the
**държавна администрация** as an institution — its size, cost, service quality, and
digitalization.

Status: planned (audited against code 2026-07-11). Not started.

---

## 0. Audit — what was verified against the code

Every load-bearing assumption below was checked against the repo; corrections folded in.

- **Pack dispatch** — `src/screens/components/procurement/sectorPacks.tsx` works exactly as
  described: a `PACKS: Record<eik, Component>` map + `getSectorPack(eik)`. Adding a pack =
  import an EIK const, `lazy()` the pack, add one map row, export a `*_AWARDER_PATH`. ✅
- **Personnel data is richer than assumed** — `data/budget/personnel.json` is a committed
  **annual time series**: `national` = **2017–2025**, `byMinistry` = 2022–2024. Each
  `national[year]` has `positions` (total 145 623, central, territorial, municipal, filled,
  vacant, vacantOverSixMonths), `nsiHeadcount` (by structure type, central/territorial), and
  `structureCounts` (count of structures by type). `byMinistry[year]` carries
  **`avgAnnualCostPerFte`** (BGN+EUR) per ministry and per programme — so a "cost per
  civil servant" tile is free. **P1 needs no DB and no new ingest.** ✅ (Corrects §1's
  "marginal cost is low" — it's near-zero for P1.)
- **COFOG** — `data/cofog.json` uses codes, not BG labels: **`GF01` = General public
  services** = Общи държавни служби. EU compare via GF01 is feasible with the existing
  `/indicators/compare` machinery. ✅
- **Date/scope machinery** — `src/data/procurement/useProcurementScope.ts` (`?pscope` =
  `ns | all | y:<year>`, `scopeYear()`), `ProcurementScopeControl.tsx` (year picker with
  `years` / `nsLabelOverride` / `allowAll` props, plus a **controlled** mode for pack pages).
  `/culture` is the exact template for an annual standalone view. ✅ (See §II date-scope.)
- **Anchor EIK** — МЕУ **180680495** is a real buyer present in the procurement corpus
  (`data/procurement/tenders/*`). Confirm the display name at build time via `/awarder/180680495`.
  ✅ (Corrects §1/§8 "unverified".)
- **Nav** — `ProcurementThematicNav.tsx` already lists standalone dashboards (`/judiciary`,
  `/culture`, `/subsidies`) and flags `unscoped` ones. `/administration` IS `?pscope`-scoped
  (year), so it is added WITHOUT the `unscoped` flag. ✅
- **recent_updates** — wired via `scripts/db/lib/ingest_changelog.ts` from the PG loaders
  (mandatory per repo convention). P1 (committed JSON) needs a changelog row added the same
  way the other JSON-committed datasets do. ✅

---

## 1. What the topic is, and why it's a strong pack

"Административно обслужване" is not one agency — it is a **horizontal function** performed
by all ~590 administrative structures (114 central + 467 territorial). So this is closer to
the standalone-dashboard model (`/judiciary`, `/culture`, `/pensions`) than a single-EIK
procurement seat. The winning shape is a **hybrid**:

- a standalone **/administration** dashboard (the институция: how big, how much it costs,
  how well it serves, how digital it is), and
- a **procurement pack** on the digitalization anchor's `/awarder/:eik` seat — the money
  behind e-government — that cross-links into the standalone view.

Why it differentiates (per the competitor scan below): **nobody owns this narrative in one
place.** The raw data is scattered across an OCR'd annual PDF, a clunky register, and a
portal statistics page. Наясно already ingests the hardest piece (the annual Доклад), so the
marginal cost to be best-in-class is low.

**The anchor entity (procurement seat):** Министерство на електронното управление (МЕУ) —
EIK reported as **180680495** (VERIFY against our own Търговски регистър / Булстат mirror
before wiring; do not hard-code an unverified EIK). Its executive arm ИА „Инфраструктура на
електронното управление" is a secondary candidate. МЕУ's procurement corpus = the capital
behind eGov.bg, е-идентификация, е-връчване, the Единен модел, base registers.

---

## 2. Data landscape

### 2.1 Already ingested in this repo (big head start)

- **`scripts/budget/doklad.ts`** parses the annual *Доклад за състоянието на администрацията*
  (Council of Ministers, indexed at `iisda.government.bg/annual_reports`). `DOKLAD_FILE_IDS`
  already maps **2017–2025**. Extracts: total щатна численост, central vs territorial vs
  municipal, filled/vacant positions, vacant >6 months, count of structures by type (Table 1),
  NSI list-headcount by type (Table II-1).
- **`scripts/budget/personnel_facts.ts`** → **`data/budget/personnel.json`** — combines the
  Доклад national aggregates with per-ministry programme headcount. Frontend types already in
  `src/data/budget/types.ts`.
- **`scripts/watch/sources/iisda_doklad.ts`** — weekly watcher that fires when a new annual
  Доклад id appears. Wired into `/update-budget`.
- **`scripts/officials/municipal_contacts/scrape_iisda.ts`** — proven ИИСДА scraping path
  (mayors registry). Reusable for the services/structures register.
- **`data/cofog.json`** — COFOG function **"Общи държавни служби" (General public services)**
  = the money the administration costs, already available and EU-comparable
  (`/indicators/compare`).

### 2.2 To ingest (new)

- **Административен регистър (ИИСДА, `iisda.government.bg`)** — the register of ~590 structures
  (name, type, functions, contacts) and the catalogue of administrative *services* per
  structure (fee, statutory deadline, e-service availability). Also mirrored as открити данни
  on data.egov.bg — check for a clean CSV/JSON before scraping HTML.
- **Доклад "административно обслужване" section (Раздел за адм. обслужване)** — the report has a
  dedicated section we don't yet extract: satisfaction surveys, "таен клиент" (mystery-shopper)
  observations, complaints/signals volumes, one-stop-shop (КАО) coverage, phone/online channel
  mix, average service times. This is the quality layer — high value, currently unextracted.
- **eGov statistics** — `egov.government.bg/.../statistika`, the Единен модел statistics
  (`unifiedmodel.egov.bg/.../statistics`) and real-time `analytics.egov.bg`: number of
  e-services, volume of e-applications, by provider / service type / channel. Monthly cadence.
- **Procurement** — МЕУ (+ ИА ИЕУ) contract corpus is already in the procurement DB; the pack
  reads it via `/api/db/awarder-contracts` like every other pack.

### 2.3 Grounded reference numbers (2025 Доклад)

- **145,623** щатна численост; **590** structures (581 reporting: 114 central, 467 territorial).
- Over the last decade: **administration +10%, population −10%** (IPI/ИПИ framing) — a ready
  headline the dashboard should own.

---

## 3. Competitive landscape (who shows this today, and the gaps)

| Source | What it does | Gap we exploit |
|---|---|---|
| **Доклад за състоянието на администрацията** (gov.bg / iisda) | The authoritative data, but a 100+ page OCR'd **PDF once a year** | No interactivity, no time series, no per-structure drill, unreadable |
| **Административен регистър (ИИСДА)** | Register of structures + services | 2000s-era UI, no analytics, no trends, no cost/quality overlay |
| **opendata.yurukov.net/pubadminreg** (civic) | Downloaded 16,555 structures — **explicitly WIP, "still only raw HTML", no visualizations shipped** | Abandoned/unfinished — the space is open |
| **eGov statistika / analytics.egov.bg** | Live e-service usage stats | Portal-only, no institutional context (cost, headcount, quality), no comparison |
| **ИПИ Регионални профили / 265obshtini.bg** | 68 regional + 32 municipal indicators; strong on economy | Thin on *administration-as-institution* & service quality; municipal, not the central-state picture |
| **Диагноза-style single-issue sites** | — | None covers administrative services |

**Verdict:** the authoritative data exists but is trapped in a PDF; the one civic attempt
stalled; the portals show usage without institutional context. A single view that fuses
**size + cost + service quality + digitalization + procurement**, with trends and per-structure
drill, would be genuinely first-of-its-kind.

---

## 4. Reusable skeleton from existing packs (the house UI vocabulary)

Grab these — every mature pack (NZOK v2 is the reference) is built from them:

**Dispatch & shell**
- `src/screens/components/procurement/sectorPacks.tsx` — register `AdminPack` under the
  anchor EIK; add `ADMIN_AWARDER_PATH`. `getSectorPack(eik)` dispatches in
  `src/screens/dev/CompanyDbScreen.tsx`.
- Standalone `/administration` route → `LayoutScreen` + `src/screens/dashboard/DashboardSection.tsx`
  / `DashboardCards.tsx` (same shell as `/judiciary`, `/culture`).
- `PackSection.tsx` — banded sections (icon+title+note+anchor id). **Stacked bands, never tabs**
  (house rule).
- `ProcurementThematicNav.tsx` — sibling-dashboard hop strip.

**Tile / KPI primitives**
- `src/screens/dashboard/StatCard.tsx` — the KPI tile (label + big tabular number + drill `to`).
- `src/ux/Card.tsx`, `src/components/ui/InsightChips.tsx` (auto-headline chips),
  `src/ux/Sparkline.tsx`, `PercentChange.tsx`, `ThousandsChange.tsx`, `Hint.tsx`.

**Charts / tables / maps**
- `src/components/ui/chart.tsx` (Recharts wrapper) + palettes `chartColors.ts`,
  `procurementPalette.ts`, `treemapPalette.ts`.
- `src/ux/data_table/DbDataTable.tsx` (server-paged) / `DataTable.tsx` (client).
- Treemap: `ProcurementTreemapTile.tsx`, `treemapCell.tsx`. Choropleth:
  `ProcurementChoroplethTile.tsx`, `OblastChoropleth.tsx`. Leaderboard:
  `RiskGradeLeaderboardTile.tsx`.

**Scope & deep-linking**
- `src/data/procurement/useProcurementScope.ts` (`?pscope` = `ns|all|y:<year>`),
  `ProcurementScopeControl.tsx`, `useHashScroll.ts` (async band deep-link scroll).

**Data serving**
- Contract corpus: `useAwarderContracts` → `/api/db/awarder-contracts`, client-windowed by
  `scopeWindow`, fed to a pure `buildAdminModel` engine (mirror `src/lib/nzokAttributes.ts`).
- Facts: static committed JSON in `data/budget/` via `useBudget.tsx` hooks (personnel already
  there) and/or new `/api/db/admin-*` endpoints. For payload-style blobs mirror
  `agri_payloads` (`src/data/agri/fetchAgriPayload.ts`).

**AI + changelog**
- `ai/tools/administration.ts` (mirror `ai/tools/nzok.ts`), register in `ai/tools/registry.ts`,
  add `SECTION.administration` + tool→section map + deep-link chips in `ai/render/links.ts`.
- Wire the new datasets into `recent_updates` (mandatory per repo convention).

---

## 5. The dashboard — tile-by-tile brainstorm ("world's best")

Money-first, then quality, then digital, then procurement — the NZOK v2 band order applied.
Every tile has a one-line "so what", a trend, and a drill.

**A. Hero — "Колко ни струва държавата, и колко сме"**
1. **State-of-the-administration KPI strip** (`StatCard` row): щатна численост, брой структури,
   заети/незаети %, cost of administration (COFOG "Общи държавни служби") as % of GDP and €/citizen.
2. **The decade divergence** — a single dual-line: administration headcount (+10%) vs population
   (−10%) since 2015. Instantly shareable; owns the IPI framing with our own chart.

**B. Structure & headcount**
3. **Headcount by administration type** — central / territorial / municipal split, stacked
   time series 2017–2025 (from `personnel.json`). Filled vs vacant overlay.
4. **Structures inventory treemap** — 590 structures sized by headcount, colored by type
   (министерства, агенции, областни, общински). Drill → the register list.
5. **Vacancy stress** — % vacant and vacant >6 months by type; flags chronically understaffed
   bodies.

**C. Service quality (the differentiator — from the Доклад's adm-обслужване section)**
6. **Citizen satisfaction gauge** — national satisfaction score + trend; note the caveat that
   it's self-reported by administrations.
7. **"Таен клиент" (mystery shopper) results** — pass/fail on mandatory service standards.
8. **Complaints & signals** — volume of жалби/сигнали vs похвали, trend; channel mix
   (гише / телефон / online / е-връчване).
9. **One-stop-shop (КАО) coverage** — share of structures offering комплексно адм. обслужване
   and average statutory-vs-actual service time.

**D. Digitalization / e-government**
10. **e-service adoption** — number of live e-services and volume of e-applications
    (eGov statistics), trend; online share of all administrative transactions.
11. **Base-register & е-идентификация usage** — е-връчване volumes, е-идентичност issuance —
    the plumbing of digital government.
12. **Service catalogue explorer** (`DbDataTable`) — searchable table of administrative services
    (name, provider, fee, statutory deadline, e-available yes/no). The "what can I actually do
    online?" utility that drives repeat visits and SEO long-tail.

**E. Money behind digitalization (the procurement pack on МЕУ's seat)**
13. **МЕУ procurement lens** — total contracted, direct-award share, top integrators
    (mirror `NzokProcurementLensTile`). The recurring "who builds Bulgaria's e-government" question.
14. **e-gov project treemap / CPV** — where the digitalization money goes (software, hardware,
    integration, support).
15. **Vendor concentration & risk leaderboard** — top suppliers, single-bidder rate, reuse
    `RiskGradeLeaderboardTile`.

**F. Compare & context**
16. **EU peer comparison** — cost of general public services vs RO/GR/HU/HR
    (reuse `/indicators/compare` COFOG machinery), plus e-gov maturity if a clean EU index exists.
17. **Per-structure entity cards** — deep-link each structure to its `/awarder/:eik` procurement
    seat where one exists, so the institutional view and the money view interlock.

---

## 6. Route & anchoring decision

- **Standalone view:** `/administration` (BG: „Държавна администрация"), sitting under the
  Governance view group. Tiles A–D + F.
- **Procurement pack:** `AdminPack` on МЕУ's `/awarder/<verified-eik>` — tiles E (+ a compact
  A strip and a link up to `/administration`).
- Cross-link both directions via `ProcurementThematicNav` and a hero link.

---

## 7. Phasing

- **P1 (data already in hand):** standalone `/administration` with tiles 1–5 + 16 from
  `personnel.json` + `cofog.json`. Ships fast; establishes the view.
- **P2:** extend `doklad.ts` to parse the административно обслужване section → quality tiles 6–9.
- **P3:** ИИСДА services-register ingest → catalogue explorer (12) + structures treemap (4).
- **P4:** eGov statistics ingest → digital-adoption tiles 10–11.
- **P5:** МЕУ procurement pack (13–15) + AI tools + recent_updates + naiasno launch post.

---

## 8. Open questions / to verify

- Confirm МЕУ EIK (180680495 is unverified) against our Търговски регистър / Булстат mirror;
  decide МЕУ vs ИА ИЕУ as the procurement anchor (МЕУ is the policy+budget seat; ИА ИЕУ holds
  more of the infrastructure contracts — may want both, packed on МЕУ with a link).
- Is the административно обслужване section machine-parseable across years, or OCR-fragile like
  the headcount tables? Determines P2 cost.
- Does data.egov.bg expose the Административен регистър services as clean open data (avoids HTML
  scraping)? Determines P3 cost.
- Satisfaction/таен клиент data is self-reported by each administration — surface the caveat
  prominently (methodology note chip on those tiles).

---

# PART II — Full implementation plan (v1)

## II.0 Decisions locked

- **Two surfaces:** standalone **`/administration`** (the institution; annual data) + an
  **`AdminPack`** on `/awarder/180680495` (МЕУ; the digitalization money). They cross-link.
- **P1 ships from committed JSON only** (`personnel.json` + `cofog.json`) — no DB, no ingest,
  no backend route. This is the fastest path to a live view and is the whole of Phase 1.
- **View group:** Governance. Route sits beside `/judiciary`, `/culture`, `/pensions`.
- **House UX:** stacked `PackSection`/dashboard bands, homepage width, **no tabs**, BG default
  language, EUR display, `StatCard` KPIs, Recharts via `components/ui/chart.tsx`. No emojis.

## II.1 Date-filter scope — the design (called out explicitly)

Two scope dimensions, one per surface. Both use the existing `?pscope` contract so the filter
is shareable and survives navigation — nothing bespoke.

### A. Standalone `/administration` — annual year scope (copy `/culture`)

The data is a point-in-time annual series (2017–2025), so the filter is a **year picker**, not
a range. Exactly the culture pattern:

```ts
// src/data/administration/scopeOverview.ts  (new, pure, UI-free — mirrors scopeOverview.ts)
export const ADMIN_FIRST_YEAR = 2017;
export const scopeAdminOverview = (p: PersonnelFile, year: number | null) => {
  const years = Object.keys(p.national).map(Number).sort((a, b) => b - a);
  const y = year ?? years[0];                 // ns → latest year (2025)
  return { year: y, national: p.national[String(y)], trend: years /* full history */ };
};
```

In `AdministrationScreen.tsx`:

```tsx
const { scope } = useProcurementScope();      // ?pscope
const year = scopeYear(scope);                // number | null
const scoped = useMemo(() => data ? scopeAdminOverview(data, year) : undefined, [data, year]);

<ProcurementScopeControl
  years={adminYears}                          // [2025..2017]
  nsLabelOverride={bg ? "Най-нова година" : "Latest year"}
  allowAll={false}                            // no cross-year headcount aggregate (like judiciary)
/>
```

Scope rules:
- **`ns` (default, param omitted)** → latest year (2025). Pill relabeled "Latest year".
- **`y:<year>`** → KPI + structure + quality tiles re-aggregate to that Доклад year.
- **Trend tiles stay full-history** regardless of scope (the decade-divergence line, the
  headcount-by-type stack) — same rule as culture's time-spine. Each such tile is documented
  with a `// full-history: ignores year scope` comment so it isn't "fixed" later.
- `allowAll=false`: there is no meaningful "all years" headcount total (it's a snapshot), so
  the option is hidden — matches the judiciary-caseload precedent.

### B. `AdminPack` (МЕУ seat) — procurement `[from,to)` window

The pack receives `scopeWindow: ScopeWindow` from `CompanyDbScreen`'s `ProcurementScopeControl`
(controlled mode) and windows the МЕУ contract corpus client-side via `scopeByWindow` — identical
to NZOK/NOI. The awarder page already renders the pill; the pack just consumes `scopeWindow`.
`?pscope=y:2024` on the awarder URL therefore scopes the digitalization-spend tiles too. No new
scope code.

## II.2 File-by-file — Phase 1 (standalone view from data in hand)

New files:
- `src/lib/administrationBenchmarks.ts` — `export const MEU_EIK = "180680495";` +
  `ADMIN_FIRST_YEAR`, `ADMIN_PATH = "/administration"`. (EIK const lives in a dependency-free
  module so nav surfaces can import it without pulling react-query — same rule as `nzokBenchmarks`.)
- `src/data/administration/useAdministration.tsx` — `useAdministrationPersonnel()` →
  `queryKey ["budget","personnel"]`, `fetchJson("/budget/personnel.json")`. (Reuse the existing
  `useBudget.tsx` fetcher; add the hook there if a personnel hook already exists.)
- `src/data/administration/scopeOverview.ts` — pure `scopeAdminOverview` + `ADMIN_FIRST_YEAR`
  (see §II.1A).
- `src/screens/administration/AdministrationScreen.tsx` — the dashboard shell (`Title` +
  `ProcurementThematicNav` + `ProcurementScopeControl` + stacked tile bands). Model on
  `CultureScreen.tsx`.
- Tile components under `src/screens/administration/`:
  - `AdminKpiStrip.tsx` — Tile 1 (`StatCard` row: щатна численост, structures, filled/vacant %,
    cost of admin % GDP + €/citizen from `cofog.json` GF01).
  - `AdminDivergenceTile.tsx` — Tile 2, dual-line headcount vs population since 2015
    (population from existing census/GRAO series; **full-history**).
  - `AdminHeadcountByTypeTile.tsx` — Tile 3, stacked area 2017–2025 (`nsiHeadcount`;
    **full-history**).
  - `AdminStructuresTreemapTile.tsx` — Tile 4, `structureCounts` treemap (reuse
    `ProcurementTreemapTile`/`treemapCell`). (Full 590-structure drill deferred to P3 register.)
  - `AdminVacancyTile.tsx` — Tile 5, % vacant + vacant>6mo by type (year-scoped).
  - `AdminCostPerFteTile.tsx` — bonus, `byMinistry.avgAnnualCostPerFte` ranked (year-scoped to
    2022–2024 window; hide years without byMinistry data).
  - `AdminEuCompareTile.tsx` — Tile 16, GF01 vs RO/GR/HU/HR (reuse euCompare COFOG helpers).

Wiring:
- `src/routes.tsx` — `lazy()` import `AdministrationScreen`; add `<Route path="administration">`
  under the governance group (beside `judiciary`/`culture`), inside `<LayoutScreen>`.
- `src/screens/components/procurement/ProcurementThematicNav.tsx` — add
  `{ to: "/administration", icon: Landmark, key: "administration_nav" }` (scoped, no `unscoped`
  flag). Add i18n keys `administration_nav` (bg/en).
- i18n — add strings to `src/locales/{bg,en}/translation.json` (+ `public/locales/*`).
- `recent_updates` — add a changelog row for the personnel/administration dataset via the
  established path so `/data/updates` lists it.

Phase-1 acceptance: `/administration` renders tiles 1–5 + 16 + cost-per-FTE; `?pscope=y:2020`
re-scopes the KPI/structure/vacancy tiles to 2020 while the divergence + by-type trend stay
full-history; the sibling-nav strip links it; `npm run build` + `npm run lint` clean.

## II.3 Phase 2 — quality tiles (extend the Доклад parser)

- `scripts/budget/doklad.ts` — extend the parser to capture the **административно обслужване**
  section: satisfaction score, "таен клиент" pass/fail, complaints/signals volumes, one-stop-shop
  (КАО) coverage, channel mix, statutory-vs-actual service time. Emit into a new
  `national[year].service` block in `personnel.json` (or a sibling `data/budget/administration.json`
  if the shape is large). Update `src/data/budget/types.ts` (types mirror scripts/ per repo rule).
- New tiles 6–9 (`AdminSatisfactionTile`, `AdminMysteryShopperTile`, `AdminComplaintsTile`,
  `AdminOneStopShopTile`) — each carries a **methodology caveat chip** (self-reported by each
  administration). Year-scoped; add a full-history trend where the series exists.
- Risk: the section may be OCR-fragile across years (the headcount tables already are). Parse
  defensively, null-fill per year, and only render a tile for years that yielded data.

## II.4 Phase 3 — Административен регистър (services + structures)

- Ingest the ИИСДА services catalogue + 590-structure register. **First check data.egov.bg for
  clean open data** (avoids HTML scraping); fall back to the proven
  `scripts/officials/municipal_contacts/scrape_iisda.ts` path. Land it in a PG table
  (`admin_services`, `admin_structures`) with a `DbDataTable` registry entry — this is the point
  a backend appears.
- Tile 12 `AdminServiceCatalogueTile` — server-paged `DbDataTable` (name, provider, fee,
  statutory deadline, e-available). Free-text `?q=` search like the contracts browser.
- Tile 4 upgrade — treemap drills into the real 590-structure list.

## II.5 Phase 4 — e-government adoption

- Ingest eGov statistics (`egov.government.bg/.../statistika`, `unifiedmodel.egov.bg` stats,
  `analytics.egov.bg`) — number of e-services, e-application volumes, by provider/type/channel,
  monthly. New watcher source under `scripts/watch/sources/`.
- Tiles 10–11 (`AdminEServiceAdoptionTile`, `AdminEDeliveryTile`).

## II.6 Phase 5 — МЕУ procurement pack + AI + launch

- `src/lib/administrationBenchmarks.ts` already exports `MEU_EIK`.
- `src/screens/components/procurement/administration/AdminPack.tsx` — composed of `PackSection`
  bands + tiles 13–15 (procurement lens, e-gov CPV treemap, vendor concentration/risk via
  `RiskGradeLeaderboardTile`) + a compact KPI strip + an up-link to `/administration`. Data via
  a new `src/data/procurement/useAdministration.tsx` (`useAwarderContracts` +
  `buildAdminModel` engine mirroring `src/lib/nzokAttributes.ts`).
- Register in `sectorPacks.tsx`: import `MEU_EIK`, `lazy()` the pack, add `[MEU_EIK]: AdminPack`,
  export `ADMIN_AWARDER_PATH`. Point `ProcurementThematicNav`'s administration entry at the МЕУ
  seat vs the standalone view — decide by parity with judiciary/culture (standalone is home).
- AI: `ai/tools/administration.ts` (mirror `ai/tools/nzok.ts`), register in `ai/tools/registry.ts`,
  add `SECTION.administration` + tool→section map + deep-link chips in `ai/render/links.ts`.
- Launch: `/naiasno-post` FEATURE post after P1, DATASET posts as P2–P4 data lands.

## II.7 Acceptance criteria (per phase) & test surface

- Each phase: `npm run build` (tsc + vite) and `npm run lint` clean; the new route renders in
  the dev preview; `?pscope=y:<year>` verified to re-scope point-in-time tiles and leave
  full-history tiles unchanged (verify via the browser preview + a read_page assertion).
- Data integrity: KPI headline (145 623 for 2025) matches `personnel.json`; EUR figures use the
  shared `formatEur*` helpers (1 EUR = 1.95583 BGN at ingest, never display-time).
- AI (P5): `ai/render/links.harness.ts` + a new `ai/tools/administration.harness.ts` pass.

## II.8 Risks / watch-outs

- Do not hard-code МЕУ's EIK anywhere but `administrationBenchmarks.ts`; confirm its display
  name from `/awarder/180680495` before writing copy.
- `byMinistry` only covers 2022–2024 — the cost-per-FTE tile must hide/disable years outside
  that window (don't imply coverage you don't have — repo convention on silent caps).
- The self-reported quality data (P2) needs the caveat chip on every quality tile.
- Keep the standalone view P1 backend-free; resist adding a DB until P3 genuinely needs the
  services register.
