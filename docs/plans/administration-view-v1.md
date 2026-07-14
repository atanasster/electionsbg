# Административно обслужване / Държавна администрация — /sector/administration (v1 plan)

A government-entity view around **административно обслужване** (administrative services) and the
**държавна администрация** as an institution — its size, cost, workforce, service quality,
digitalization, and the procurement money behind e-government.

---

> **Rev 2.0 (2026-07-14) — SUPERSEDES the original Part I/II.** The original plan was written
> on the old `/culture`-standalone pattern. The repo has since shipped a **config-driven
> `/sector/<slug>` grammar** (energy is the reference, tourism is the next planned), and
> **`/sector/administration` already exists** as a single-member (МЕУ) procurement sector.
> The task is therefore **expand an existing config**, not build a new screen. This rev rewrites
> the whole plan to the sector grammar and adds the full civic-administration competitive scan.
> Rev 1.0 research on the data landscape (§3) and tile ideas survives, re-slotted.
>
> **Rev 2.1 (2026-07-14)** — the improvement suggestions are integrated as committed, phase-mapped
> build priorities (§8 table) and the decisions they settle are moved to Locked (§9); the phasing
> (§4) is sequenced to match.

---

## 0. Thesis (one line)

The Bulgarian state grew +10% while the population shrank −10%, it costs €X/citizen, it is
**last in the EU on e-government use (35.3%)** — and the ministry that is supposed to fix that
(МЕУ) is a rounding error in the procurement corpus. One view fuses the institution, its service
quality, the EU digital gap, and the money.

## 1. Status — what already exists (do NOT rebuild)

- **`/sector/administration` is live.** `src/screens/sector/sectorDashboards.ts:172` registers
  `SECTOR_DASHBOARDS.administration` — a single-member sector: `agency:"МЕУ"`,
  `leadEik: ADMIN_EIK = "180680495"`, `browsePackId:"administration"`, one member chip. It renders
  today via the generic `SectorDashboardScreen`: `<Title>` → breadcrumb → `<ScopeControl>` →
  4-KPI group rollup + spend-by-year + top-contractors → `<SectorAwardersTile>`.
- **Registry + hub** already list it: `sectorRegistry.ts` (`id:"administration"`, `to:"/sector/administration"`),
  and `SECTOR_BROWSE_PACKS.administration` in `sectorPacks.tsx` powers `?sector=administration`.
- **Route/server/sitemap need no work** — `sector/:id` covers the slug; `awarder_group_model`
  and the `awarder_eik IN` browse filter are already generic.
- **The institution data is already ingested** — `data/budget/personnel.json` (the annual *Доклад
  за състоянието на администрацията*, 2017–2025) + `data/cofog.json` GF01. See §3.

**What is missing (this plan's work):** (a) expand the single МЕУ member into the real
**e-government EIK group** so the money rollup is meaningful; (b) ship bespoke
**`AdministrationThematicTiles`** — the institution/quality/digital signature tiles the generic
KPI row can't express; (c) the quality + digital data ingests (§3 Tiers 1–3); (d) scene/OG/prerender
copy. No new screen, no new route.

## 2. Entities — the e-government EIK group (measured from the corpus)

The generic KPI row folds every EIK in `members` via `awarder_group_model`. Today it folds only
МЕУ (which barely procures). Expand to the digitalization trio — the entities that actually hold
the e-government spend (counts = buyerName occurrences in `data/procurement`):

| Role | Entity | EIK | Note |
|---|---|---|---|
| Lead (policy+budget) | Министерство на електронното управление (МЕУ) | **180680495** | current ministry; thin own procurement |
| Infrastructure (main buyer) | ИА „Инфраструктура на електронното управление" (ИА ИЕУ) | **180742160** | largest e-gov procurement volume |
| Legacy predecessor | Държавна агенция „Електронно управление" (ДАЕУ) | **177098809** | pre-МЕУ/ИА ИЕУ spend; folds the history |

- **Lead stays МЕУ** (180680495) — the policy seat + the `/sector/administration` slug. Its
  `/awarder/180680495` page suppresses its pack and links to the sector dashboard (the
  `sectorDashboardForLeadEik` convention — same as БЕХ→/sector/energy).
- Freeze the set in a new `src/lib/administrationReferenceData.ts` as `ADMIN_SECTOR_EIKS`
  (mirrors `energyReferenceData.ts`), reused by `SECTOR_BROWSE_PACKS` + `sector_stats` + the
  thematic tiles' `useAwarderGroupModel` key.
- **The institution is horizontal.** "Административно обслужване" is performed by all ~590
  structures, not one buyer. So the *money* view is the e-gov trio (procurement); the
  *institution* view (headcount/cost/quality/digital) comes from `personnel.json` + Eurostat +
  the Доклад — rendered as `AdministrationThematicTiles`, independent of the EIK rollup.

## 3. Data sources, tiered by ingest cost

- **Tier 0 — in hand (Phase 1 ships on this alone):**
  - `data/budget/personnel.json` — annual 2017–2025: `positions` (total 145 623, central,
    territorial, municipal, filled, vacant, vacantOverSixMonths), `nsiHeadcount` (by structure
    type), `structureCounts` (structure counts by type); plus `byMinistry` 2022–2024 with
    **`avgAnnualCostPerFte`** (BGN+EUR). Watcher `iisda_doklad`; refreshed by `/update-budget`.
  - `data/cofog.json` — **GF01 = General public services** (Общи държавни служби); EU-comparable.
  - Procurement corpus — the e-gov trio's contracts (already in PG; `awarder_group_model`).
- **Tier 1 — Eurostat, cheap (rides `update-macro`/`update-regional`):**
  - **EU e-government indicators** — Eurostat `isoc_ciegi_*` / DESI Digital Public Services:
    share of individuals using e-gov (BG **35.3%, lowest in EU** vs EU27 avg; DK 98.6%), basic
    digital skills (BG 35.5%). The single most differentiating, shareable, BG-damning tile.
  - **EU eGovernment Benchmark** (Capgemini for EC, biennial): user-centricity, transparency,
    key enablers, cross-border — country score (EU27 avg 76/100). Peer bars vs RO/GR/HU/HR.
- **Tier 2 — parser extension (moderate):** extend `scripts/budget/doklad.ts` to capture the
  Доклад's **административно обслужване** section — citizen-satisfaction score, "таен клиент"
  (mystery-shopper) pass/fail, complaints/signals volume, one-stop-shop (КАО) coverage,
  channel mix, statutory-vs-actual service time. Emit a `national[year].service` block.
- **Tier 3 — new ingest (heavier):**
  - **Административен регистър (ИИСДА)** — the ~590-structure register + the services catalogue
    (fee, statutory deadline, e-available). **Check data.egov.bg for clean open data first**;
    else reuse `scripts/officials/municipal_contacts/scrape_iisda.ts`. Land in PG →
    `DbDataTable` catalogue explorer.
  - **eGov usage** — `analytics.egov.bg` / Единен модел statistics: live e-service counts +
    e-application volumes by provider/type/channel (monthly).

## 4. Architecture — reuse the shipped grammar (two-phase)

### Phase 1 — config + thematic tiles from data in hand (no ingest, no screen)

Files to touch (tourism §9 checklist format):

| Concern | File | Change |
|---|---|---|
| Buyer allowlist | `src/lib/administrationReferenceData.ts` **(new)** | `ADMIN_SECTOR_EIKS` (МЕУ+ИА ИЕУ+ДАЕУ), lead const, member names |
| Sector config | `src/screens/sector/sectorDashboards.ts` | expand `administration.members` to the trio; set `ThematicTiles: AdministrationThematicTiles` (lazy) |
| Browse filter | `src/screens/components/procurement/sectorPacks.tsx` | point `SECTOR_BROWSE_PACKS.administration` at `ADMIN_SECTOR_EIKS` |
| Hub tile € | `scripts/db/gen_procurement/sector_stats.ts` | `administration: [...ADMIN_SECTOR_EIKS]`; rerun `npm run db:gen-sector-stats` |
| Thematic tiles | `src/screens/sector/administration/AdministrationThematicTiles.tsx` **(new)** + sub-tiles | signature tiles (§5) off `personnel.json` + `cofog.json` |
| Data hook | `src/data/administration/useAdministration.tsx` **(new)** | `useAdministrationPersonnel()` → `/budget/personnel.json` |
| Scope helper | `src/data/administration/scopeOverview.ts` **(new)** | pure `scopeAdminYear(personnel, year)` (§6) |
| Hub scene | `src/screens/governance/sectorScenes.tsx` | SVG scene keyed `administration` (currently may fall back) |
| i18n | `src/locales/{bg,en}/translation.json` (+ `public/locales/*`) | tile strings (config keys `sector_admin_*` already exist) |
| OG card | `public/og/sector-administration.png` | run `scripts/og/screenshot_sectors.ts` (auto-loops `SECTOR_DASHBOARD_IDS`) |
| Prerender copy | `scripts/prerender/routes.ts` | add/verify `SECTOR_PAGES.administration` (**build fails without it**) |
| Data map | `scripts/data_map/model.ts` | DATASET (personnel) + feature node `route:/sector/administration` + edges |
| recent_updates | via `ingest_changelog.ts` path | changelog row for the personnel/administration dataset |

Sitemap needs no edit (auto from `SECTOR_DASHBOARD_IDS`); route/server need no edit.

Phase 1 realizes the top-ranked wins (§8 #1, #3, #6): the config expansion + tiles 1–5 with the
decade-divergence OG hero, laid out on the OECD input→process→output→outcome spine. Ships with no
ingest and no screen code.

### Phase 2+ — the sequenced roadmap (each slice self-contained; ordered by §8 impact/cost)

- **P2 — EU e-gov gap (§8 #2, High/Low).** Tier-1 Eurostat `isoc_ciegi_*` via `update-macro` →
  tile 10 ("BG last in Europe, 35.3%") + peer bars (tile 17). Cheapest high-impact win after P1;
  the launch card's second punch. New thematic tile only.
- **P3 — service quality (§8 #4, High/Med).** Extend `scripts/budget/doklad.ts` to parse the
  административно обслужване section → tiles 6–9 (satisfaction / таен клиент / complaints / КАО),
  each with a mandatory self-reported caveat chip. Parse defensively (OCR-fragile); render a tile
  only for years that yield data.
- **P4 — services register (§8 #5, Med/High).** Tier-3 ИИСДА ingest → catalogue explorer (tile 12,
  `DbDataTable`), GOV.UK-style per-service scorecard, and the once-only/RegiX tracker (tile 13) tied
  to the Feb-2026 burden-reduction reform. First backend; reuse `CpvFilterCombobox`/`RiskBadges` on
  any contract lists.
- **P5 — adoption + AI + launch.** Tier-3 eGov usage stats (analytics.egov.bg) → tile 11;
  AI tools (`ai/tools/administration.ts`, registered in `registry.ts`, `SECTION.administration` in
  `ai/render/links.ts`); naiasno FEATURE post after P1, DATASET posts as P2–P4 land (§8 #7).

## 5. The dashboard — tile-by-tile (OECD input→process→output→outcome spine)

Signature tiles marked ★. CSS/flex bars where possible (house rule: instant OG render). Each a
band with a stable deep-link id. Provenance tagged ● real / ◐ needs-ingest.

**Institution (input) — from `personnel.json` (●):**
1. ★ **Decade divergence** — dual line: administration headcount (+10%) vs population (−10%)
   since 2015. The OG hero. *Full-history (ignores year scope).*
2. **State KPI strip** — щатна численост (145 623), structures (590), filled/vacant %, cost of
   administration (GF01) % GDP + €/citizen. *Year-scoped.*
3. **Headcount by structure type** — central/territorial/municipal stacked area 2017–2025;
   filled-vs-vacant overlay. *Full-history.*
4. **Structures treemap** — `structureCounts` sized by type; drill to register (P4). *Year-scoped.*
5. **Cost per civil servant** — `avgAnnualCostPerFte` ranked by ministry (2022–2024 only; hide
   years without data — no silent caps). *Year-scoped within window.*

**Service quality (process/output) — Tier-2 доклад section (◐):**
6. ★ **Citizen-satisfaction gauge** + trend — caveat chip: self-reported by each administration.
7. **"Таен клиент" results** — pass/fail on mandatory service standards.
8. **Complaints & signals** — жалби/сигнали vs похвали; channel mix (гише/телефон/online/е-връчване).
9. **One-stop-shop (КАО) coverage** — share offering комплексно обслужване; statutory-vs-actual time.

**Digital (output/outcome) — Tier-1 Eurostat + Tier-3 eGov (◐):**
10. ★ **EU e-gov gap** — BG e-gov use **35.3% (last in EU)** vs peer bars (EU27 76 pts; DK 98.6%).
    The killer comparison; from Eurostat (cheap). *Latest year.*
11. **e-service adoption** — live e-service count + e-application volume trend (analytics.egov.bg).
12. ◐ **Service-catalogue explorer** (`DbDataTable`) — searchable services (fee, deadline,
    e-available); GOV.UK-style. Repeat-visit + SEO long-tail. (P4)
13. ◐ **Once-only / RegiX tracker** — share of services pulling from base registers vs asking
    the citizen; the административна-тежест reform in one number. (P4)

**Money (the sector's procurement rollup) — generic KPI row + (●):**
14. **e-gov spend group KPIs** — total awarded / contracts / contractors / top integrator, folded
    over the trio (the generic `SectorDashboardScreen` row). *Scope-windowed.*
15. **Digitalization CPV/per-unit spend** — where the e-gov money goes, by subsidiary + category
    (mirror energy `PerUnitSpendTile`); single-bid gauge. *Scope-windowed.*
16. **EU-fund cross-link** — most e-gov capital is ОПДУ/ЕС-funded; link to the funds view.

**Context (outcome):**
17. **EU peer comparison** — GF01 cost + eGov-benchmark score vs RO/GR/HU/HR (reuse
    `/indicators/compare` COFOG + `macro_peers`).

## 6. Date scoping — how `?pscope` flows here (the requirement)

The framework already renders the filter and resolves the window — nothing bespoke:

- `SectorDashboardScreen` renders `<ScopeControl mode="toggle" />` (URL-backed `?pscope`,
  vocabulary `ns | all | y:YYYY`) and derives `scopeWindow = useScopeWindow()`.
- **Money tiles (14–15):** the generic KPI row + any procurement-derived thematic tile call
  `useAwarderGroupModel(ADMIN_SECTOR_EIKS, …, windowOverride=undefined)`, which falls back to the
  URL scope → they **re-window on `?pscope`** automatically. No work.
- **Institution/quality/digital tiles (2, 4–9, 11):** these read committed JSON, not the corpus.
  They opt into the year via `useScope()` + a pure `scopeAdminYear(personnel, year)`:
  `y:YYYY` → that Доклад year; `ns`/`all` → latest year (2025). Documented per tile.
- **Trend tiles (1, 3, 10, 17):** **full-history** regardless of scope (comment
  `// full-history: ignores year scope`), same rule as energy's generation/price tiles.
- **Half-open caveat:** any P4 tile that drives a *DB* fetch must normalize `y:YYYY` to
  `to=(Y+1)-01-01` (not `YYYY-12-31`) or Dec-31 rows drop — the tourism/energy §5 gotcha.

## 7. Competitive research — civic administration platforms

No platform, in Bulgaria or abroad, fuses **institution + service quality + digital gap +
procurement money** in one citizen-facing view. The layers exist separately; we integrate them.

| Platform | Layer | Best-in-class feature | Gap / our wedge |
|---|---|---|---|
| **OECD Government at a Glance 2025** | Comparative institution | The gold standard: input→process→output→outcome spine; Digital-Government Index, Open-Gov-Data Index, trust, satisfaction, workforce management; interactive country dashboard | BG is **not** an OECD member → design template, not a BG feed; no procurement/money layer; no per-structure BG granularity |
| **GOV.UK Performance Platform / Service Std SS10** | Service delivery | Per-service 4 KPIs — cost per transaction, digital take-up, completion rate, user satisfaction — **mandatory** publication | UK-only; central platform retired 2021 (now per-dept). Model for our per-service scorecard (12) |
| **EU eGovernment Benchmark 2024 (Capgemini/EC) + DESI** | Digital delivery | BG-**inclusive** scores (EU27 avg 76/100; BG e-gov use 35.3% lowest, digital skills 35.5%); user-centricity / transparency / enablers / cross-border | Biennial, country-level only, no institutional or money layer → we localize + add the money + per-structure drill |
| **e-Estonia / Ukraine Diia** | Service UX exemplar | Once-only principle, X-Road interoperability, single app | Not a transparency dashboard; aspirational benchmark. BG analog = RegiX → tile 13 |
| **USASpending / Partnership for Public Service** | Workforce+budget transparency | Federal workforce dashboards, agency-level spend viz | US-only; workforce-viz patterns to borrow (tiles 3, 5) |
| **Look at Cook / Kenya Open Data** | Budget explorer | Deep drill-down budget transparency, open-sourced/replicable | Generic; no administration-quality layer |
| **BG: Доклад за състоянието на администрацията** | Authoritative source | The real data (headcount, structures, service quality) | **100+ page OCR'd PDF, once a year** — unusable as a product. We already parse it |
| **BG: Административен регистър (ИИСДА)** | Register | Every structure + service catalogued | 2000s-era UI, no analytics/trends/cost/quality overlay |
| **BG: eGov statistika / analytics.egov.bg** | Usage stats | Live e-service transaction counts | Portal-only; no institutional context, no comparison |
| **BG: ИПИ Регионални профили / 265obshtini.bg** | Regional/economic | 68 indicators, strong on economy, per-município | Thin on administration-as-institution & service quality; not the central-state picture |
| **BG: opendata.yurukov.net/pubadminreg** | Civic attempt | Downloaded all 16 555 structures | **Explicitly abandoned WIP** ("still only raw HTML"), nothing shipped — the space is open |
| **BG: БСК/strategy.bg административна тежест** | Policy | Reform tracking (burden-reduction plan, Feb 2026) | Prose/PDF policy pages, not a data dashboard |
| **BG: TI-BG LISI** | Municipal integrity | 27-city transparency index (we already ingest) | Municipal only; complements, doesn't compete |

**Positioning:** Наясно = the only place fusing the institution (size/cost/workforce), service
quality (satisfaction/таен клиент/complaints), the digital gap (EU-benchmarked, BG-last), and the
procurement money behind digitalization — in one Bulgarian, EUR-denominated, per-structure-drillable,
shareable view. The authoritative data is trapped in a yearly PDF; the one civic attempt stalled;
the portals show usage without context. We own the integration.

## 8. Adopted build priorities (integrated into §4/§5)

Each improvement is a committed slice, ranked by impact/cost and mapped to the phase that realizes
it — not a floating recommendation.

| # | Priority | Impact/Cost | Realized in | Tiles |
|---|---|---|---|---|
| 1 | Ship Phase 1 from data in hand (config + tiles) | High / Low | **P1** | 1–5 |
| 2 | EU e-gov gap ("BG last in Europe, 35.3%") via Eurostat | High / Low | **P2** | 10, 17 |
| 3 | Decade-divergence OG hero (admin +10% / pop −10%) | High / Low | **P1** | 1 |
| 4 | Service-quality section (satisfaction/таен клиент/complaints/КАО) | High / Med | **P3** | 6–9 |
| 5 | Services register → per-service scorecard + once-only/RegiX tracker | Med / High | **P4** | 12, 13 |
| 6 | OECD input→process→output→outcome band order (narrative spine) | Med / Low | **P1** (§5) | all |
| 7 | AI tools + naiasno launch post | Low / Low | **P5** / post-P1 | — |

## 9. Decisions

**Locked (settled by the priorities above):**
- **Fold the e-gov trio** (МЕУ + ИА ИЕУ + ДАЕУ 177098809), history included — energy folds its
  subsidiaries and defense folds 25 units; precedent says fold, and the legacy spend is the point.
- **OECD input→process→output→outcome** is the band order (§5).
- **Self-reported caveat chip is mandatory** on the quality tiles (6–9).
- **Lead stays МЕУ** (180680495); its `/awarder` page suppresses its pack and links to the sector.

**Still open (verify at build time; do not block P1):**
- Confirm МЕУ/ИА ИЕУ/ДАЕУ display names + current EIK validity via `/awarder/:eik` before copy.
- Does data.egov.bg expose the ИИСДА services register as clean open data (determines P4 cost)?
- Is the Доклад административно обслужване section machine-parseable across years, or OCR-fragile
  like the headcount tables (determines P3 cost)?
