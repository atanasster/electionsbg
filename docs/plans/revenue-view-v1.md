# Приходи (Revenue) view — НАП + Митници — implementation plan v1

Status: DRAFT (2026-07-10, audited pre-implementation). Owner: TBD. Ships behind the existing
sector-pack seam; Phase 1 is zero-new-ingest. Grounded in a read of the Roads/НОИ/НЗОК/**ВСС**
packs, the Води plan (`docs/plans/water-view-v1.md`), the shipped budget revenue-drilldown, and
competitive research (HMRC, IRS, ATO, EU VAT-Gap, OEC, WCO).

**Audit note (2026-07-10):** every data claim below was verified against the repo. Five
assumptions from the first draft were wrong and have been corrected in place — see §16 for the
audit log. Two originally-planned tiles (cost-to-collect, осигуровки band) are **cut from Phase 1
for lack of a data source**.

## 1. Goal & thesis

Add НАП (Национална агенция за приходите, **ЕИК 131063188**) and Агенция „Митници"
(**ЕИК 000627597**) as government-entity dashboards, mirroring the АПИ / НОИ / НЗОК / ВСС packs.

The reframe: every existing pack answers *"where does this body's money go?"* (they are
spenders). НАП and Митници are **collectors**. НАП collected **~€21.5bn** in 2024 (42.03bn BGN,
+10.6%, 100.4% of plan); Митници **€7.06bn** in 2024 (rising to 14.53bn BGN / ~€7.4bn in 2025).
Their procurement footprint is small. So the pack polarity inverts: the НОИ hero says
*"procurement is 0.5% of the fund it pays out"*; the НАП/Митници hero says *"here is the revenue
this agency collects, and where it comes from."* Adding these two **closes the loop** — the site
shows where the state spends (budget, procurement, НЗОК/НОИ/АПИ/ВСС); revenue is the missing
half. IME answers "how much does the state cost you?"; we answer "where does the state's money
come from → where does it go?"

Home surface (Phase 1): a **НАП pack** and a **Митници (customs) pack** on their `/awarder/:eik`
pages, plus entries under **Държавни структури**. Phase 3 graduates the revenue→spend circuit
into a first-class `/revenue` (Приходи) surface — following the ВСС precedent (§4).

**Build Митници first.** The audit showed it is the materially stronger pack (4 years of
composition + a full 2025 product split); НАП's Phase-1 surface is thinner. Митници is the
reference implementation.

## 2. What ALREADY exists (this is mostly a presentation project)

The revenue **data, hooks, types, ingest, watchers, and the tax-lever engine are all built.**
What is missing is the entity-dashboard surface.

### Built (reuse, do not rebuild)
| Thing | Path | Note |
|---|---|---|
| Customs revenue, **2022–2025** | `data/budget/revenue_breakdown/customs/{year}.json` | `lines[]` (excise/import-VAT/duties/fines) + `customsByCountry` (top-5). **Product split only in 2025** — see §2.1. |
| НАП VAT, **2024 only** | `data/budget/revenue_breakdown/vat/2024.json` | `declaredNet` + `sectors[]` by КИД-2008 |
| НАП PIT, **2024 only** | `data/budget/revenue_breakdown/pit/2024.json` | 14 income-type `lines[]` + `bySector[]` |
| Hooks | `src/data/budget/useBudget.tsx` (L141–172) | `useCustomsBreakdown(year)`, `useVatBreakdown(year)`, `usePitBreakdown(year)` |
| Types | `src/data/budget/types.ts` (≈L504–592) | `CustomsBreakdownFile`, `VatBreakdownFile`, `PitBreakdownFile` |
| Revenue drill-down UI | `src/screens/components/budget/BudgetFlowRevenueDrilldown.tsx` | VAT/excise/customs/PIT bodies — a side panel of the budget Sankey, not an entity view. Bodies are reusable. |
| Tax-lever engine ("reckoner") | `src/lib/bgTaxPolicy.ts` + `/budget/simulator` | revenue response for VAT/PIT/CIT/excise/МОД. **Already done — link, don't build.** |
| КФП | `data/budget/kfp.json` | `observations[]` = coarse monthly series (`revenue/expenditure/balance/euContribution/financing`). **`snapshots[].sections` carry the by-tax-type hierarchy** — see §2.2. |
| Ingest | `scripts/budget/{run_customs_revenue,run_nap_annual}.ts` | `npm run budget:revenue-breakdown` |
| Watchers | `scripts/watch/sources/{nap_annual,customs_revenue,eurostat_policy}.ts` | already mapped to `update-budget`, already on the data map (`budget` group) |
| `AI_PATH_RULES` | `scripts/data_map/model.ts` | `{ pattern: /^\/budget\//, dataset: "budget" }` **already covers** `revenue_breakdown` — no new rule needed |

### Not built (this plan's work)
- No НАП / Митници pack; nothing on `/awarder/131063188` or `/awarder/000627597` beyond the
  generic buy-side page.
- No standalone `/revenue` surface (route name is free — no collision in `routes.tsx`).
- No cross-dataset overlays (§7).
- `SECTOR_BROWSE_PACKS` / `SectorBrowseSlot` do **not** exist (proposed in the Води plan).
  **Not needed here** — НАП and Митници are single awarder EIKs, so `getSectorPack(eik)` fits.

### 2.1 Митници data grain (VERIFIED)
- **Composition bar works for all 4 years** (2022–2025): `total_collected`, `excise_total`,
  `import_vat_total`, `customs_duties_total`, `fines_total` are populated every year.
- **Excise PRODUCT split exists only in 2025** (12/12 lines filled). In 2022/2023/2024 the
  product lines (`excise_diesel`, `excise_petrol`, `excise_lpg`, `excise_natural_gas`,
  `excise_tobacco`, `excise_alcohol`) are **`null`**; only `excise_fuels` (and sometimes
  `excise_kerosene_net`) carry amounts. ⇒ the **product donut is a single-year (2025) gated
  tile**, not a time series. Gate on non-null products; hide otherwise.
- `customsByCountry` = **top-5 origins of customs *duties*** (Китай 55.0% / 2024, 58.6% / 2025;
  Турция ~6%), with `sharePct`. It is **duty revenue by origin, not trade volume** — label it as
  such. 5 rows ⇒ a ranked bar, **not** a treemap.

### 2.2 НАП revenue grain (VERIFIED — corrects the first draft)
`kfp.json` `snapshots[]` carry the full by-tax-type revenue hierarchy under
`sections[0]` ("I. Приходи, Помощи и дарения" → `Данъчни приходи` → ЗКПО / дивиденти / ДДФЛ /
ДДС / Акцизи / застрах. премии / Мита / Други данъци, plus `Неданъчни приходи` and `Помощи`).
The КФП ingest already reconstructs this (`scripts/budget/kfp.ts` `LINE_ITEM_EN`); the coarse
`observations` series collapses it, but `snapshots` preserve it.

**Snapshots are ANNUAL year-end + one current YTD** — `2021-12, 2022-12, 2023-12, 2024-12,
2025-12, 2026-05`. Not monthly. Consequences:
- ✅ **Five full years** → multi-year composition and YoY both work (a year picker, like НЗОК).
- ⚠️ The **`2026-05` snapshot is a partial year** (Jan–May cumulative). Label it "до май 2026";
  never annualize it or compare it against a full year.
- ❌ **"YTD vs same period last year" is impossible at tax-type grain** — there is no
  same-period prior-year snapshot, and `observations` carry only the coarse total. Drop that
  idea (or restrict it to the coarse `revenue` total, which *is* monthly 2021-06→2026-05).

Reference values (2026-05 YTD): Данъчни приходи €8.995bn = ЗКПО €685.7M · ДДФЛ €1.891bn ·
ДДС €4.839bn · Акцизи €1.365bn · Мита €105.4M · застрах. премии €20.4M · други €45.4M.

Three caveats:
1. **Consolidated by tax type, not by collecting agency** — ДДС here = НАП domestic VAT +
   Митници import VAT; акцизи/мита = Митници; ЗКПО/ДДФЛ = НАП. Attribute honestly in the tile.
2. **Осигуровки are NOT in the КФП revenue section, and NOT obtainable from what we ingest.**
   `kfp.json` carries **only `constituentBudget: "state"`** — there is no social-funds
   constituent. `noi/funds.json` has just two years (2023 `complete:false`, `revenueEur: 0`;
   2024 €6.66bn) and `nzok/execution.json` `revenueEur` (€1.03bn YTD) is **fund revenue incl.
   state transfers**, not contributions collected by НАП. ⇒ see §5 headline decision.
3. The **КИД-2008 by-economic-sector** VAT/PIT detail is **2024-only** and НАП-report-bound.
   `scripts/budget/nap_annual.ts` is **hardcoded to 2024** (parses "net 2024", `amount2024`,
   fixed URLs in `NAP_ANNUAL_REPORTS`) — generalize it before the 2025 report can be shown.
   Митници (`customs_revenue`) already runs to 2025.

### 2.3 Sources for what we do NOT have
- **Осигуровки** — needs either extending the КФП ingest to the *consolidated* constituent
  (egov may publish it) **or** parsing the НАП annual-report total. **New work, not free.**
- **НАП/Митници admin budget** (for cost-to-collect) — **does not exist in the repo.** Both are
  second-level spending units; their EIKs appear nowhere under `data/budget/`, and
  `data/budget/ministries/admin-*.json` is per *first*-level unit only. Source = the НАП annual
  report (agency expenses). **New parse.**
- **Per-agency split (НАП vs Митници headline)** — МФ monthly budget-execution bulletins
  (`minfin.bg/bg/statistics/12`). Optional.

## 3. The common UI vocabulary (from the shipped packs — follow verbatim)

All five packs (`RoadsPack`/`NoiPack`/`NzokPack`/`VssPack`) share one skeleton. Reuse it exactly.

- **Shell:** `<section className="space-y-4">`.
- **Header:** `flex items-center gap-2 pt-2` + lucide icon `h-5 w-5 text-muted-foreground` +
  `<h2 className="text-lg font-semibold">` bilingual title.
- **Entity KPI row:** `grid gap-3` of `StatCard` (`@/screens/dashboard/StatCard`),
  `text-2xl font-bold tabular-nums`. ONLY the entity-unique metric — the generic
  total/contracts/suppliers KPIs sit on the host page above; never duplicate.
  **Flex the column count** (`grid-cols-2` ↔ `grid-cols-1`) when only one card will render, so a
  lone card doesn't leave an empty half-column (the ВСС convention, `VssPack` L162–163).
- **Auto insight chips:** `insights:{text,warn?}[]` via `useMemo` → pill spans
  `rounded-full border px-2.5 py-1 text-xs`; `warn`→`WARN_CHIP_COLORS` (`../chipStyles`), else
  `border-border bg-muted/40`; slice ≤5.
- **Hero "bridge" `Card`** (composition-bar idiom, see `NoiFundFlowTile`): `flex h-6 w-full
  overflow-hidden rounded-md` colour segments + legend (swatch/label/€/%) + a trailing
  "Друго/Other" residual so the legend sums to the headline. **The hero carries the
  `data-og="…"` attribute** (established by `NzokBudgetBridgeTile` / `VssBudgetBridgeTile`).
- **Domain tiles:** `Card / CardHeader / CardTitle(icon) / CardContent` (`@/ux/Card`), each
  closing with a `text-[11px] text-muted-foreground/80` caption.
- **Local control:** shared Radix `Select` (`@/components/ui/select`) only — never native.
- **Money:** `formatEurCompact(v, lang)` (`@/lib/currency`). The data already carries
  `amountEur` (converted at ingest, 1 EUR = 1.95583 BGN). **Read `amountEur`; never re-convert.**
- **Gating:** `isLoading` → `h-[280px] animate-pulse rounded-xl border bg-card`; empty →
  `return null`, BUT keep revenue tiles alive with zero contracts in scope (they don't depend on
  the contract corpus) — gate procurement-derived pieces individually (`NzokPack`/`VssPack`).
- **Mount:** `sectorPacks.tsx` registers EIK→`lazy()`; host `CompanyDbScreen.tsx:383,913`
  renders it in `<Suspense>` with `scopeWindow={{from,to}}`.
- **Scope rule:** procurement tiles inherit `[from,to)`; annual revenue uses its OWN year picker
  (the parliament window straddles calendar years) — copy `NzokPack`'s `yearOverride`.
- **Alias EIKs:** if an agency has multiple registrations, fan the corpus query over them and
  reconcile in the footnote (`VSS_ALIAS_EIKS` in `useVss`). **Check whether Митници has aliases.**

## 4. Routing — settled by the ВСС precedent

The ВСС is the in-repo answer to the A/B question: it has **both** a pack on
`/awarder/121513231` **and** a standalone `/judiciary` screen. The mechanics (verified):

- **They share NO tiles and NO hooks.** Pack tiles live in
  `src/screens/components/procurement/vss/` with `useVss`; screen tiles in
  `src/screens/judiciary/` with `useJudiciaryCaseload`/`useJudiciaryDeclarations`.
- **The division is by subject matter**: the pack owns the *money* story; the screen owns the
  story money can't tell.
- **What IS shared: one dependency-free constants module**, `src/lib/vssReferenceData.ts`
  (EIK, alias EIKs, labels, colors, supplier context). Both surfaces import it.
- **They cross-link rather than co-render** (`JudicialAwardersTile` → `/awarder/:eik`; pack →
  `/judiciary`).
- **Nav diverges**: the ВСС pill points at `/judiciary`, **not** the awarder page, with
  `unscoped: true`; `sectorPacks.tsx` deliberately exports **no** `VSS_AWARDER_PATH`
  ("Don't 'fix' the omission").

**Decision.** Phase 1 = **pack-only**, following the **НЗОК row**: export `NAP_AWARDER_PATH` /
`CUSTOMS_AWARDER_PATH`, nav pills point at the awarder pages. When Phase 3 adds `/revenue`,
**migrate to the ВСС row**: repoint the pills at `/revenue` with `unscoped: true`, keep the packs
mounted, and add a `RevenueAwardersTile`-style cross-link. Build Phase 3 tiles fresh under
`src/screens/revenue/` + `src/data/revenue/` — **do not reuse the pack's hero tile.** Single-source
only the constants (`src/lib/napReferenceData.ts`, `customsReferenceData.ts`).

Also: relabel/hide the generic buy-side KPI header for these two EIKs **only if the measured
procurement footprint warrants it** (§15, S5) — a small conditional in `CompanyDbScreen`.

## 5. Tile-by-tile spec

### Митници (customs) pack — `/awarder/000627597` — BUILD FIRST
1. **KPI row:** "Събрано през {year}" (`total_collected`) · "Акцизи" (excise share %).
   Chips: YoY delta, biggest excise product (2025 only), "мита {x}% от постъпленията".
2. **Hero — "Откъде идват митническите приходи"** (`data-og="customs-revenue"`): composition bar
   (акцизи / ДДС при внос / мита / глоби), **year picker 2022–2025**. "Per second" shareable
   sub-line.
3. **Excise product donut — 2025 only, gated.** Fuels (diesel/petrol/LPG/gas/kerosene) / tobacco
   / alcohol. Hide entirely when the product lines are null (2022–24). **`RoadWorkGroupDonut` is
   NOT reusable** (typed to `WorkGroupAgg[]`) — write `CustomsExciseDonut` or generalize first.
   Optional "колко от цената е акциз" callout using `bgTaxPolicy`'s per-product excise rates.
4. **Duty origins:** top-5 countries by **customs duty** (ranked bar, not a treemap; label as
   duty revenue by origin, not trade volume).
5. **(Phase 2)** seizures/контрабанда trend (Митническа хроника + EU IPR data).
6. Footnote: Митническа хроника + АОП/ЦАИС attribution.

### НАП pack — `/awarder/131063188`
**Headline basis — Option A for Phase 1 (see §15).** The composition and its reconciling total
are **tax revenue only**, from the КФП snapshot, explicitly labelled **"данъчни приходи (без
осигуровки)"**. The осигуровки band (Option C) is a **fast-follow**, blocked on a source (§2.3).
1. **KPI row:** "Данъчни приходи, събрани през {year}" · YoY. (Flex to `grid-cols-1` if only
   one card renders.)
2. **Hero — "Откъде идват данъчните приходи"** (`data-og="nap-revenue"`): composition bar
   (ДДС / ДДФЛ / ЗКПО / акцизи / мита / др.) from the КФП snapshot. **Year picker 2021–2025**,
   plus a "2026 до май" partial-year option, clearly marked and never annualized. All bars
   reconcile to the tax headline.
3. **VAT by sector** (КИД-2008, 2024) — net-refund sectors highlighted; the drilldown body in
   `BudgetFlowRevenueDrilldown.tsx` is reusable. Label the single-year basis.
4. **Tax-gap tile:** BG VAT gap **8.6% / €781M (2023)**, PIT gap **13.8%** vs EU 9.5%, as % of
   theoretical liability; "collected X% of VAT owed" framing; link to `/indicators/compare`.
   Hard-keyed numbers + attribution (CASE / DG TAXUD).
5. **"Промени данъка" CTA** → `/budget/simulator` (the reckoner already exists).
6. **CUT from Phase 1 — cost-to-collect.** No data source (§2.3). Restore once the НАП
   annual-report agency-expense line is parsed.
7. **(Phase 2)** top tax debtors (BIRD) Top-N → `seeMoreTo` full page; overlay chip (§7).
8. Footnote: КФП + НАП годишен отчет + EU VAT-Gap attribution; state that осигуровки are
   collected by НАП but flow to НОИ/НЗОК and are **not** included in the tax base shown.

## 6. Data source inventory (tiered by ingest cost)

### Tier A — already ingested, zero new pipeline (all of Phase 1)
- Customs revenue 2022–2025 (+ `customsByCountry`) — `useCustomsBreakdown`.
- КФП by-tax-type composition 2021–2025 + 2026 YTD — `kfp.json` `snapshots[].sections`.
- НАП VAT/PIT КИД-2008 (2024) — `useVatBreakdown` / `usePitBreakdown`.
- Eurostat tax-to-GDP + peer structure — `/indicators/compare` infra.
- Procurement (contracts/tenders by the two awarder EIKs) — already on the host page.

### Tier B — structured, one parser each (Phase 2)
- **Осигуровки total** — extend the КФП ingest to the consolidated constituent, or parse the НАП
  annual-report total. Unblocks the Option-C band.
- **НАП/Митници agency expenses** — from the annual reports. Unblocks cost-to-collect.
- **Митници excise registers** — `data.egov.bg` org `2`, CKAN CSV/JSON: licensed excise
  warehouses, чл.57а registrants, tobacco price register. New watcher source.
- **EU VAT-Gap / Mind-the-Gap** — hard-keyed table (CASE/DG TAXUD); the `eurostat_policy` watcher
  already exists (maps to `update-budget`).
- **Enforcement stats** (ревизии, recovered) — extend `nap_annual`/`customs_revenue`. Митници
  „Митническа хроника" is **scanned** → Gemini Vision OCR (reuse the capital-programs OCR step).
  `nra.bg` has a **broken TLS chain** — cert relaxation needed.
- **Generalize `nap_annual.ts` beyond 2024** (hardcoded) for the 2025 КИД-2008 detail.

### Tier C — link, don't rebuild
- **Tax debtors** (чл.182 ДОПК >5,000 BGN) — BIRD `scan.bird.bg/debtors`; join by EIK (§7).
- **EU IPR seizures** (DG TAXUD/EUIPO) — the Митници seizures narrative.

## 7. The moat — cross-dataset overlays (Phase 2, ≥1 shipped)
- **Top tax debtors ∩ public-contract winners** — BIRD debtors ⋈ `contracts` by EIK.
- **Excise-licence holders ∩ political connections** — egov registers through the connections graph.
- **Debtors ∩ EU-fund beneficiaries** — companies owing the state that drew ИСУН money.

Precision: reuse the procurement namesake-fix high-confidence rule (declared stake OR unique TR
name) to avoid EIK/name-collision false positives.

## 8. SQL performance verification (per the "always EXPLAIN ANALYZE" rule)

Phase 1 revenue tiles are **static JSON** (`revenue_breakdown/*`, `kfp.json`) — no SQL,
consistent with the budget pillar's static-JSON convention. The SQL surface is:

- **Two new awarder pages** hit the existing `contracts` `/api/db/table` registry scoped by
  `awarder_eik` (`functions/db_table.js`, `scopeCols:["contractor_eik","awarder_eik"]`) — the same
  path `/company/:eik` uses. **Verify (don't assume)** an index on `contracts(awarder_eik, date)`;
  `EXPLAIN ANALYZE` both EIKs. Also confirm the **leading-zero EIK `000627597` round-trips** (roads
  `000695089` works, so likely fine) and that `/api/db/company?eik=` returns rows for both.
- **Cross-dataset overlays (§7)**: if a `tax_debtors` PG table is added, index `eik`; the overlay
  is `tax_debtors ⋈ contracts ON eik` — `EXPLAIN ANALYZE` the **worst case** (largest debtor set ×
  full contracts corpus). Index BOTH sides of the join key. Precompute to a blob only if >~200ms.
- If revenue ever moves to a `revenue_payloads` blob table, follow the payload-determinism rules
  (ROUND sums, rounded sort keys + eik tiebreaks, COLLATE "C" MINs) + parity audit.
- EUR sums: `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.
- Any new `/api/db/table` entry is a REGISTRY row, not a new endpoint; the column whitelist is the
  security boundary.

## 9. Watchers & process-watch-report wiring

**Phase 1 needs NO new watcher** — the packs consume data the `nap_annual` and `customs_revenue`
sources already watch (mapped to `update-budget`, on the data map `budget` group, run by
`npm run budget:revenue-breakdown`). `kfp.json` refreshes via the same skill.

**Phase 2 new ingest** (`WatchSource` shape: `id`, `label`, `url`, `cadence`, `fingerprint()`,
`describe()` → add to `SOURCES` in `scripts/watch/sources/index.ts`):
- `customs_excise_registers` (egov org 2) — cadence `monthly`; fingerprint = egov dataset stamp.
- Tax-gap reuses the existing `eurostat_policy` source (no new watcher).
- Debtors (BIRD) — `--backfill`-gated one-off, or a link-only tile (no watcher). Per the
  one-off-backfill rule, range scrapes never sit in the watcher/CI.

Process-watch-report mapping — add any Phase-2 source id → its skill in
`.claude/skills/process-watch-report/SKILL.md`:

| Watcher source id | Skill |
|---|---|
| `customs_excise_registers` | `update-budget` (extend) or a new `update-revenue` |

If Phase-2 ingest outgrows the budget skill, split `.claude/skills/update-revenue/SKILL.md`
(shape on `update-nzok`) stamping `state/ingest/update-revenue.json` via
`npx tsx scripts/stamp-ingest.ts update-revenue --summary "…"`.

## 10. recent_updates / changelog

Phase 1 static JSON → **no changelog** (rule: static-JSON, no PG serving, no `recordIngestBatch`).
If Phase 2 adds a PG table (debtors, excise registers), wire `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`) INSIDE the loader txn with a stable natural key
(day-coalesced, auto-summary >500/day). Example: `{ source:"tax_debtors", keyExpr:"t.eik",
nameExpr:"t.name", detailExpr:"t.amount_eur || ' € дълг'", amountExpr:"t.amount_eur", rowsTotal }`.

## 11. AI chat tools

Create `ai/tools/revenue.ts`; edit `ai/tools/registry.ts` (import + `ToolDef` in `TOOLS`),
`ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (cases). Tools NEVER
compute numbers in prose — they narrate `env.facts`; data via `fetchData` for the static JSON.

- `napRevenueBreakdown` (domain `fiscal`) — tax revenue by type from the КФП snapshot, by year.
- `customsRevenueBreakdown` (domain `fiscal`) — excise / import VAT / duties / fines, year, YoY;
  product split for 2025.
- `taxGap` (domain `indicators`) — BG VAT/PIT gap vs EU, as % of theoretical liability.
- `revenueVsSpend` (domain `fiscal`) — the circuit: collected vs КФП budget-by-function.
- `(Phase 2)` `taxDebtors` (domain `connections`) — top debtors + the contract-winner overlay.

Router keywords: `нап|митниц|акциз|данъ|ддс|ддфл|приход|събрани|excise|customs|vat|revenue|
tax gap|данъчна пропаст`. Provenance: `budget/revenue_breakdown/*.json`, `budget/kfp.json`.
**`AI_PATH_RULES` already covers `/budget/` → dataset `budget`** — no new rule needed (verified).

## 12. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source/path
- Sources already placed (`budget` group has `customs_revenue`, `nap_annual`, `eurostat_policy`).
- **Add feature nodes** for the two packs + edges: `["ds:budget","f:nap-revenue"]`,
  `["ds:budget","f:customs-revenue"]`. If Phase 2 adds `customs_excise_registers`, add it to the
  `budget` group `members`.
- `AI_PATH_RULES`: **no change needed** (verified above).
- Verify with `npm run data:map`.

### README.md
- "Data sources" — the budget/КФП + НАП annual + Митническа хроника rows exist; add a line that
  НАП and Митници now have **entity revenue dashboards** (not just budget drilldown) + the EIKs.
- No new `data/` layout entry for Phase 1 (reuses `data/budget/revenue_breakdown/`).
- Phase 2: document the egov excise-register ingest + any `--backfill` flags.

### Data pages (`/data`, `/data/sources`, `/data/updates`)
Auto-generate from `model.ts`; the feature-node + edge additions make the packs appear on the
generated diagram. No hand-editing.

## 13. Sitemap, static page generation & OG cards

`/awarder/:eik` is a **client-only SPA route** — without prerender a crawler hits the Firebase
rewrite and sees the homepage meta (soft-duplicate). Two recipes exist; Phase 1 needs **B**,
Phase 3 needs **A**.

### Recipe B — packed awarder route (Phase 1)
Append an `InstitutionPack` to `INSTITUTION_PACKS` (`scripts/prerender/institutions.ts`) per
agency: `eik`, `slug` (`nap` / `customs`), `nameBg/En`, `titleBg/En`, `descriptionBg/En`,
`bodyBg/En` (crawlable no-JS `<h1>`+`<p>`: the "collector, not spender" thesis, headline figures,
internal links to `/budget`, `/procurement`, `/indicators/compare`), `ogAnchor`
(`[data-og="nap-revenue"]` / `[data-og="customs-revenue"]`), `ogSettleMs` (~2500 for charts).

That one entry drives all three surfaces:
- `scripts/prerender/dynamicRoutes.ts` → `dist/awarder/<eik>/index.html` (+ `/en`). 4 files —
  negligible against the file ceiling.
- `scripts/sitemap/index.ts` (L701–708) → `/awarder/:eik` + `/en/...` URLs, each now backed by real
  prerendered HTML (satisfies the sitemap-validity rule).
- `scripts/og/capture-screens.ts` → `public/og/awarder/<slug>.png`, framed on `ogAnchor`.

Keep `institutions.ts` in sync with the `PACKS` registry and the `*_AWARDER_PATH` constants.

### Recipe A — standalone dashboard route (Phase 3, `/revenue`)
- Plain `<Route path="revenue">` + lazy component in `src/routes.tsx`.
- A `staticPage({ path: "revenue", ogImage: "/og/revenue.png", bodyHtml })` entry in
  `scripts/prerender/routes.ts` — note the `judiciaryFacts`-style build-time IIFE that reads the
  data JSON synchronously to quote **real figures** in the crawlable body.
- Sitemap: a bare `"revenue"` string in the `route_defs.ts` static array **and** a `{ path, file }`
  entry for lastmod.
- A static `/og/revenue.png` (not the INSTITUTION_PACKS capture rig).

### Pack-side requirement
Each pack's hero `Card` carries `data-og="nap-revenue"` / `data-og="customs-revenue"` (as
`NzokBudgetBridgeTile` carries `data-og="nzok-bridge"`).

### ⚠️ Test-coverage gap (real)
`tests/seo.spec.ts` asserts against a **hardcoded ROUTES table** that enumerates **no
`/awarder/:eik` route and not `/judiciary`** — it does not import `INSTITUTION_PACKS`. So
"verify with `npm run test:seo`" **will not cover the new routes**. Either add them to that table
manually, or (better, and it fixes ВСС + all existing packs too) **make the ROUTES table iterate
`INSTITUTION_PACKS`**. No test today imports `getSectorPack`/`sectorPacks`/`INSTITUTION_PACKS`.

## 14. Phasing & file checklist

### Phase 1 — zero-new-ingest packs. **Митници first (reference impl), then НАП.**
Per agency:
- `src/lib/customsReferenceData.ts` / `napReferenceData.ts` (NEW) — EIK const, alias EIKs, labels,
  colors, category map. (Naming follows `vssReferenceData.ts`, **not** `*Benchmarks.ts`.)
- `src/data/procurement/useCustoms.tsx` / `useNap.tsx` (NEW) — `useAwarderContracts` +
  classifier + the revenue hooks (`useCustomsBreakdown`; a new `useKfpTaxComposition` reading
  `kfp.json` `snapshots`).
- `src/screens/components/procurement/customs/` + `nap/` (NEW) — `CustomsPack.tsx` +
  `CustomsRevenueBridgeTile` (`data-og`) + `CustomsExciseDonut` (2025-gated) +
  `CustomsDutyOriginsTile`; `NapPack.tsx` + `NapRevenueBridgeTile` (`data-og`) +
  `NapVatSectorTile` + `NapTaxGapTile`.
- `sectorPacks.tsx` (EDIT) — lazy imports, `PACKS` entries, export `NAP_AWARDER_PATH` /
  `CUSTOMS_AWARDER_PATH`.
- `ProcurementNav.tsx` `secondaryItems` + `reportMenus.ts` `menu_group_state_entities` (EDIT).
- `src/locales/{bg,en}/translation.json` (EDIT) — `procurement_nap_nav` = "Приходи (НАП)" /
  "Revenue (НАП)"; `procurement_customs_nav` = "Митници" / "Customs".
- `scripts/prerender/institutions.ts` (EDIT) — two `InstitutionPack` entries (§13, Recipe B).
- `scripts/data_map/model.ts` (EDIT) — two feature nodes + edges.
- `ai/tools/revenue.ts` (NEW) + `registry.ts` / `router.ts` / `narrate.ts` (EDIT).
- `tests/seo.spec.ts` (EDIT) — iterate `INSTITUTION_PACKS` (§13 gap).
- `README.md` (EDIT) — one data-sources line.
- **CUT:** cost-to-collect tile, осигуровки band (no source — §2.3).

### Phase 2 — Tier B + the moat
Осигуровки total + agency expenses (restores the Option-C band + cost-to-collect); egov excise
registers (+ watcher §9); enforcement stats; generalize `nap_annual.ts` past 2024; ≥1
cross-dataset overlay (§7) with `taxDebtors` tool, SQL perf (§8) and changelog (§10).

### Phase 3 — first-class `/revenue` (Приходи)
Revenue→spend circuit Sankey (collected × КФП budget-by-function); personalized "къде отиват
моите данъци" (HMRC Annual Tax Summary; the `bgTaxPolicy` engine already computes the per-lever €,
so this is UI + income input, not new modelling). Follow the ВСС split (§4): fresh tiles under
`src/screens/revenue/`, share only the constants modules, repoint the nav pills (`unscoped: true`),
add Recipe A prerender. Consider a 5th top-level view next to the planned Потребление.

## 15. Verification checklist (before declaring Phase 1 done)
- `npx tsc` clean; `npx eslint . --fix` then `npm run lint` clean.
- `npm run data:map` (prebuild fails on an unplaced source/path).
- `npm run sitemap` — confirm `/awarder/131063188` + `/awarder/000627597` (+ `/en`) emitted.
- `npm run build` + postbuild — confirm `dist/awarder/<eik>/index.html` and
  `public/og/awarder/{nap,customs}.png` exist.
- `npm run test:seo` — **only meaningful after the ROUTES table iterates `INSTITUTION_PACKS`** (§13).
- **Measure the procurement footprint** for both EIKs before writing "rounding error" copy, and
  before deciding whether to relabel the buy-side header. Local PG (`:5433`) must be up;
  `EXPLAIN ANALYZE` the `awarder_eik` scans (§8).
- Render both packs in dev and confirm: year pickers, the 2025-gated excise donut hides on
  2022–24, the "2026 до май" partial-year label, legend sums to the headline.

## 16. Audit log (2026-07-10) — corrections to the first draft
1. **Осигуровки band cut from Phase 1.** No source: `kfp.json` has only `constituentBudget:
   "state"`; `noi/funds.json` has 2 years (2023 `revenueEur: 0`); `nzok` `revenueEur` is fund
   revenue incl. transfers. Option C is **not** zero-ingest → ship Option A, labelled.
2. **Cost-to-collect cut.** No НАП/Митници admin-budget figure exists anywhere in `data/budget/`.
3. **КФП composition is annual (5 year-end snapshots) + one YTD, not monthly.** Multi-year and YoY
   work; "YTD vs same period last year" at tax-type grain is impossible.
4. **Excise product split is 2025-only** — the donut is a gated single-year tile.
5. **Five packs exist, not three** (`VssPack` shipped), and ВСС already answers the A/B routing
   question — §4 rewritten around its verified mechanics.
6. `RoadWorkGroupDonut` is roads-typed and **not reusable**; `customsByCountry` is top-5 **duty**
   origins (not trade volume); `AI_PATH_RULES` **already** covers `/budget/`; `tests/seo.spec.ts`
   covers **no** awarder routes; slug/dir naming unified on `customs`.

## 17. First social card (already in the data)
"Митниците събраха 7,06 млрд. € през 2024 — 50% от тях са акцизи, а €1,36 млрд. само върху
горивата." (`customs/2024.json`, confirmed against Митническа хроника.)
