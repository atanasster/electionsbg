# Приходи (Revenue) view — НАП + Митници — implementation plan v1

Status: DRAFT (2026-07-09). Owner: TBD. Ships behind the existing sector-pack seam; no new
ingest for Phase 1. Grounded in a read of the Roads/НОИ/НЗОК packs, the Води plan
(`docs/plans/water-view-v1.md`), the shipped budget revenue-drilldown, and competitive
research (HMRC, IRS, ATO, EU VAT-Gap, OEC, WCO).

## 1. Goal & thesis

Add НАП (Национална агенция за приходите, **ЕИК 131063188**) and Агенция „Митници"
(**ЕИК 000627597**) as two government-entity dashboards, mirroring the АПИ / НОИ / НЗОК
sector packs.

The reframe — the thing no site tells: every existing pack answers *"where does this body's
money go?"* (they are spenders). НАП and Митници are **collectors**. НАП pulled in **~€21.5bn**
in 2024 (42.03bn BGN, +10.6%, 100.4% of plan); Митници **~€7.4bn** in 2025 (14.53bn BGN,
7.06bn EUR in the ingested 2024 file). Their procurement footprint is a rounding error. So the
pack polarity inverts: the НОИ hero says *"procurement is 0.5% of the fund it pays out"*; the
НАП/Митници hero says *"procurement is a rounding error — here is the revenue this agency
collects, and where it comes from."* Adding these two **closes the loop**: the site shows where
the state spends (budget, procurement, НЗОК/НОИ/АПИ); revenue is the missing half. IME answers
"how much does the state cost you?"; we answer "where does the state's money come from → where
does it go?"

Home surface (Phase 1): a **НАП pack** and a **Митници pack** on their `/awarder/:eik` pages,
plus entries under **Държавни структури** in the управление menu. Phase 3 graduates the
revenue→spend circuit into a first-class `/revenue` (Приходи) surface.

## 2. What ALREADY exists (critical — this is mostly a presentation project)

A recon of the budget subsystem found the revenue **data, hooks, types, ingest, watchers, and
the tax-lever engine are all built.** What is missing is the entity-dashboard surface.

### Built (reuse, do not rebuild)
| Thing | Path | Note |
|---|---|---|
| Customs revenue breakdown, **2022–2025** | `data/budget/revenue_breakdown/customs/{year}.json` | excise → fuels(diesel/petrol/LPG/gas/kerosene)/tobacco/alcohol, import VAT, duties, fines, + by-country. Deepest product split for 2025. |
| НАП VAT breakdown, **2024 only** | `data/budget/revenue_breakdown/vat/2024.json` | declared net by КИД-2008 sector |
| НАП PIT breakdown, **2024 only** | `data/budget/revenue_breakdown/pit/2024.json` | 14 income-type lines + by-sector |
| Hooks | `src/data/budget/useBudget.tsx` | `useCustomsBreakdown(year)`, `useVatBreakdown(year)`, `usePitBreakdown(year)` |
| Types | `src/data/budget/types.ts` (≈L504–592) | `CustomsBreakdownFile`, `VatBreakdownFile`, `PitBreakdownFile` |
| Revenue drill-down UI | `src/screens/components/budget/BudgetFlowRevenueDrilldown.tsx` | VAT/excise/customs/PIT bodies — **but only as a side panel of the budget Sankey**, not an entity view. Tile bodies are reusable. |
| Tax-lever engine (the "reckoner") | `src/lib/bgTaxPolicy.ts` + `/budget/simulator` | static revenue response for VAT/PIT/CIT/excise/МОД. **Phase 3 "reckoner" is already done — link, don't build.** |
| КФП time series | `data/budget/kfp.json` | coarse series only: `revenue/expenditure/balance/euContribution/financing`. **NOT by-tax-type** — the tax split lives in `revenue_breakdown/`. |
| Ingest scripts | `scripts/budget/{run_customs_revenue,run_nap_annual}.ts` | `npm run budget:revenue-breakdown` |
| Watchers | `scripts/watch/sources/{nap_annual,customs_revenue,eurostat_policy}.ts` | already mapped to `update-budget`, already on the data map (`budget` group) |

### Not built (this plan's actual work)
- No НАП / Митници sector pack; nothing on `/awarder/131063188` or `/awarder/000627597`
  beyond the generic buy-side page.
- No standalone `/revenue` (Приходи) surface; no revenue→spend circuit.
- No "revenue by collector (НАП vs Митници vs ЕС)" entity framing.
- No cross-dataset overlays (debtors ∩ contract winners — §7).
- `SectorBrowsePack` / `SECTOR_BROWSE_PACKS` / `SectorBrowseSlot` do **not** exist (proposed in
  the Води plan, unbuilt). **Not needed here** — НАП and Митници are single awarder EIKs, so
  the existing single-entity `getSectorPack(eik)` seam fits; the sector-browse-pack primitive
  is a water/roads concern (many EIKs), out of scope for revenue.

### Data-grain caveat that shapes the tiles
- **Митници pack is rich**: 4 years of composition + deep excise product split → real
  time-series and a proper "колко от цената е акциз" explorer.
- **НАП by-tax-type composition is NOT 2024-only — it is already monthly & current** (see the
  post-2024 finding below). The **КИД-2008 by-economic-sector** VAT/PIT drill is the only
  2024-bound piece.

### Post-2024 НАП revenue — RESOLVED (verified 2026-07-09)
The plan's original "НАП composition is 2024-only" worry was wrong. **`kfp.json` snapshots
already carry the full by-tax-type revenue breakdown every month, current to 2026-05**, from
the МФ КФП egov feed the `update-budget` watcher already refreshes. The 2026-05 snapshot (Jan–
May cumulative) has: Данъчни приходи €8.995bn = ЗКПО €685.7M · ДДФЛ €1.891bn · ДДС €4.839bn ·
Акцизи €1.365bn · Мита €105.4M · застрах. премии €20.4M · други €45.4M. The КФП ingest already
reconstructs this hierarchy (`scripts/budget/kfp.ts` `LINE_ITEM_EN`) — we just collapse the
children into a coarse "revenue" series for the time series, but they are preserved in
`snapshots[].sections`. **The НАП pack reads the tax-type composition straight from the КФП
snapshot — zero new ingest, monthly, current.**

Three caveats:
1. **Consolidated by tax type, not by collecting agency** — ДДС here = НАП domestic VAT +
   Митници import VAT combined; акцизи/мита = Митници; ЗКПО/ДДФЛ = НАП. Attribute in the tile.
2. **Осигуровки (social/health contributions) are NOT in the КФП revenue section** — they flow
   via transfers to Социалноосигурителни фондове, so the "НАП collects ~€21.5bn" headline must
   add them from the transfers section (or omit and headline only tax revenue, labelled).
3. This is the **tax-type** grain; the **КИД-2008 by-economic-sector** VAT/PIT detail
   (`revenue_breakdown/vat|pit`) is still **2024-only** and NAP-report-bound.

Other sources for what КФП snapshots don't give:
- **Per-agency split (НАП vs Митници headline)** — МФ monthly budget-execution bulletins
  (`minfin.bg/bg/statistics/12`, April 2026 already out) publish revenue by administering
  agency. Optional new ingest if we want the exact per-agency number rather than deriving it
  from tax types.
- **2025 КИД-2008 sector detail** — НАП 2025 annual report (publishes ~March; the `nap_annual`
  watcher will catch it). **`scripts/budget/nap_annual.ts` is hardcoded to 2024** (parses "net
  2024", "amount2024", fixed 2024 URLs in `NAP_ANNUAL_REPORTS`) — generalize the parser + add
  the 2025 URL when it lands. Митници (`customs_revenue`) already runs to 2025.

## 3. The common UI vocabulary (from the shipped packs — follow verbatim)

Every pack (`RoadsPack`/`NoiPack`/`NzokPack`) is the SAME skeleton; the Води plan §4 codifies
it as a 10-part grammar. New packs reuse it exactly. Condensed contract:

- **Shell:** `<section className="space-y-4">`.
- **Header:** `flex items-center gap-2 pt-2` + lucide icon `h-5 w-5 text-muted-foreground` +
  `<h2 className="text-lg font-semibold">` bilingual title.
- **Entity KPI row:** `grid gap-3 grid-cols-2` of `StatCard` (`@/screens/dashboard/StatCard`),
  `text-2xl font-bold tabular-nums`. ONLY the entity-unique metric (generic
  total/contracts/suppliers KPIs already sit on the host page above — never duplicate).
- **Auto insight chips:** `insights:{text,warn?}[]` via `useMemo` → pill spans
  `rounded-full border px-2.5 py-1 text-xs`; `warn`→`WARN_CHIP_COLORS` (`../chipStyles`), else
  `border-border bg-muted/40`; slice ≤5.
- **Hero "bridge" `Card`** (composition-bar idiom, see `NoiFundFlowTile`): `flex h-6 w-full
  overflow-hidden rounded-md` colour segments + legend (swatch/label/€/%) + a trailing
  "Друго/Other" residual so the legend sums to the headline.
- **Domain tiles:** `Card / CardHeader / CardTitle(icon) / CardContent` (`@/ux/Card`), each
  closing with an `text-[11px] text-muted-foreground/80` caption.
- **Local control:** shared Radix `Select` (`@/components/ui/select`) only — never native.
- **Money:** `formatEurCompact(v, lang)` (`@/lib/currency`).
- **Gating:** `isLoading` → `h-[280px] animate-pulse rounded-xl border bg-card`; empty →
  `return null`, BUT keep revenue tiles alive with zero contracts in scope (they don't depend
  on the contract corpus — copy `NzokPack`'s per-tile gating).
- **Mount:** `sectorPacks.tsx` registers EIK→`lazy()`; host `CompanyDbScreen.tsx:383,913`
  renders it in `<Suspense>` with `scopeWindow={{from,to}}`.
- **Scope rule:** procurement tiles inherit `[from,to)`; annual revenue uses its OWN year
  picker (parliament window straddles calendar years) — copy `NzokPack`'s `yearOverride`.

## 4. Routing decision — A vs B

- **A — pack seam (Phase 1):** `NapPack`/`MitniciPack` above `/awarder/:eik`, like НЗОК. Cheap,
  consistent, discoverable in the existing menu group. Risk: the generic host header
  (procurement KPIs) is nearly empty for a collector.
- **B — first-class `/revenue`:** dedicated surface; natural home for the circuit + a
  "revenue by collector" view. More work, but research showed the pieces (compare radar,
  simulator) already exist.

**Recommendation: A in mechanics, B in spirit** — build packs (uses the whole §3 vocabulary),
write tiles revenue-first, graduate the circuit to `/revenue` in Phase 3. Also relabel/hide the
generic buy-side KPI header for these two EIKs so the page doesn't open on a near-empty
procurement stat (small conditional in `CompanyDbScreen`, keyed on the two EIKs).

## 5. Tile-by-tile spec

### Митници pack (`/awarder/000627597`) — the rich one
1. **KPI row:** "Събрано през {year}" (customs `total_collected`) · "Акцизи" (excise share %).
   Chips: YoY delta, biggest excise product, "мита {x}% от постъпленията".
2. **Hero — "Откъде идват митническите приходи"**: composition bar (акцизи / ДДС при внос /
   мита / глоби), own year picker (2022–2025). "Per second" shareable sub-line.
3. **Excise explorer**: product donut (fuels/tobacco/alcohol) reusing `RoadWorkGroupDonut`;
   "колко от цената е акциз" mini-callout. Deep for 2025, top-level older years (degrade
   gracefully — the drilldown already does this).
4. **Trade origins**: top countries by import (customs `byCountry`); OEC treemap idiom / bar.
5. **(Phase 2) seizures/контрабанда** trend (Митническа хроника + EU IPR data).
6. Footnote: Митническа хроника + АОП/ЦАИС attribution.

### НАП pack (`/awarder/131063188`) — tax composition (КФП, monthly) + labelled осигуровки band
**Headline basis — DECIDED (Option C, see §15):** the composition and its reconciling total are
**tax revenue only** (the clean КФП `constituentBudget:"state"` revenue slice — ДДС/ДДФЛ/ЗКПО/
акцизи/мита, monthly & current). Осигуровки (social/health contributions НАП collects on behalf
of НОИ/НЗОК) are shown as a **separate, clearly-labelled additive band/stat** — "+ €X събрани за
сметка на НОИ/НЗОК" linking to those packs — so the grand total matches НАП's own ~€21.5bn (2024)
headline **without double-counting** the contributions the НОИ/НЗОК packs already show. The bar
sums to the tax headline; the осигуровки band is explicitly additive, never folded into the base.
1. **KPI row:** "Данъчни приходи, събрани през {year}" (КФП tax revenue) · secondary
   "+ осигуровки за НОИ/НЗОК €X" (the labelled band, from the social-funds КФП constituent or the
   НОИ/НЗОК B1 we already ingest — ONE number, not a second composition) · "Изпълнение на плана"
   (if НАП report parsed). Chips: YoY, VAT share of central revenue.
2. **Hero — "Откъде идват данъчните приходи"**: composition bar (ДДС/ДДФЛ/ЗКПО/акцизи/мита/др.)
   straight from the КФП snapshot — monthly, current, all bars reconcile to the tax headline.
   Осигуровки render as a distinct trailing band with its own label + link, outside the summed
   base. VAT/PIT КИД-2008 detail (2024) is the drill below, not the headline.
3. **VAT by sector** (КИД-2008, 2024) — net-refund sectors highlighted (drilldown body exists).
4. **Tax-gap tile**: BG VAT gap **8.6% / €781M (2023)**, PIT gap **13.8%** vs EU 9.5%, as % of
   theoretical liability; "collected X% of VAT owed" framing; link to `/indicators/compare`.
5. **Cost-to-collect** `StatCard`: стотинки to collect 1 лев (НАП admin budget ÷ revenue) —
   HMRC 0.51p/£1 idea.
6. **"Промени данъка" CTA** → `/budget/simulator` (the reckoner is already built).
7. **(Phase 2) top tax debtors** (BIRD) Top-N → `seeMoreTo` full page; overlay chip (§7).
8. Footnote: НАП годишен отчет + КФП + EU VAT-Gap + BIRD attribution; note that осигуровки are
   collected by НАП but flow to НОИ/НЗОК (shown as an additive band, not part of the tax base).

## 6. Data source inventory (tiered by ingest cost)

### Tier A — already ingested, zero new pipeline (all of Phase 1)
- Customs revenue (2022–2025), НАП VAT/PIT (2024) — `revenue_breakdown/*` + the three hooks.
- КФП `revenue` series (multi-year all-tax total) — `useBudget`.
- Eurostat tax-to-GDP + peer structure — `/indicators/compare` infra.
- Procurement (contracts/tenders by the two awarder EIKs) — the buy-side already on the page.

### Tier B — structured, one parser each (Phase 2)
- **Митници excise registers** — `data.egov.bg` org `2`, CKAN CSV/JSON: licensed excise
  warehouses, чл.57а registrants, tobacco price register. New watcher source + `update-*`.
- **EU VAT-Gap / Mind-the-Gap** — hard-keyed table (CASE/DG TAXUD), like curated macro tables;
  the `eurostat_policy` watcher already exists (maps to `update-budget`).
- **НАП/Митници annual-report enforcement stats** — ревизии count, recovered amounts. Митници
  „Митническа хроника" is scanned → Gemini Vision OCR (reuse capital-programs OCR step).
  `nra.bg` has a broken TLS chain — cert relaxation needed. (The `nap_annual`/`customs_revenue`
  scripts already fetch these PDFs for VAT/PIT/customs; extend, don't add.)

### Tier C — link, don't rebuild
- **Tax debtors** (чл.182 ДОПК >5,000 BGN) — BIRD `scan.bird.bg/debtors`; join by EIK (§7).
- **EU IPR seizures** (DG TAXUD/EUIPO) — for the Митници seizures narrative.

## 7. The moat — cross-dataset overlays (Phase 2, ≥1 shipped)

No single-source portal can do these; they are the differentiator:
- **Top tax debtors ∩ public-contract winners** — BIRD debtors ⋈ `contracts` by EIK.
- **Excise-licence holders ∩ political connections** — egov excise registers through the
  connections graph.
- **Debtors ∩ EU-fund beneficiaries** — companies owing the state that drew ИСУН money.

## 8. SQL performance verification (per the "always EXPLAIN ANALYZE" rule)

Phase 1 revenue tiles are **static JSON** (`revenue_breakdown/*` served from the bucket) — no
SQL, consistent with the budget pillar's static-JSON convention (the NZOK arch decision: tiny
annual files stay JSON). The SQL surface is the procurement side and the Phase-2 overlays:

- **Two new awarder pages** hit the existing `contracts` `/api/db/table` registry scoped by
  `awarder_eik` (`functions/db_table.js`, `scopeCols:["contractor_eik","awarder_eik"]`) — the
  same path `/company/:eik` already uses. Verify (don't assume) an index on
  `contracts(awarder_eik, date)`; `EXPLAIN ANALYZE` the two EIKs (both are small awarders, so
  cheap, but confirm index scan not seq scan).
- **Cross-dataset overlays (§7)**: if a `tax_debtors` PG table is added, index `eik`; the
  overlay is `tax_debtors ⋈ contracts ON eik` (or the awarder rollup) — `EXPLAIN ANALYZE` on
  the **worst case** (the largest debtor set × the full contracts corpus). Index BOTH sides of
  the join key (PG perf playbook). Precompute the overlay to a small blob only if it exceeds
  ~200ms.
- If revenue ever moves off static JSON to a `revenue_payloads` blob table (only if it grows
  materially), follow the payload-determinism rules (ROUND sums, rounded sort keys + eik
  tiebreaks, COLLATE "C" MINs) and run the parity audit against a JSON dump.
- EUR sums: `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.
- Any new `/api/db/table` registry entry (e.g. a debtors browse page) is a REGISTRY row, not a
  new endpoint; the column whitelist is the security boundary; `EXPLAIN ANALYZE` its worst-case
  filter/sort.

## 9. Watchers & process-watch-report wiring

**Phase 1 needs NO new watcher** — the packs are pure consumers of data the `nap_annual` and
`customs_revenue` sources already watch (mapped to `update-budget`, on the data map `budget`
group, run by `npm run budget:revenue-breakdown`). Document that the two new dashboards render
from an already-watched pipeline.

**Phase 2 new ingest gets wired the standard way** (`WatchSource` shape: `id`, `label`, `url`,
`cadence`, `fingerprint()`, `describe()` → add to `SOURCES` in `scripts/watch/sources/index.ts`):
- `customs_excise_registers` (egov org 2) — cadence `monthly`; fingerprint = egov dataset
  modified stamp.
- Tax-gap uses the existing `eurostat_policy` source (no new watcher).
- Debtors (BIRD) — a `--backfill`-gated one-off if scraped, or a link-only tile (no watcher);
  per the one-off-backfill rule, range scrapes go behind `--backfill`, never in the watcher/CI.

Process-watch-report mapping — add any Phase-2 source id → its skill in
`.claude/skills/process-watch-report/SKILL.md`:

| Watcher source id | Skill |
|---|---|
| `customs_excise_registers` | `update-budget` (extend) or a new `update-revenue` |

Skill: Phase 1 needs none (data flows via `update-budget`). If Phase-2 registers/debtors grow
beyond the budget skill's scope, split a `.claude/skills/update-revenue/SKILL.md` (shape on
`update-nzok`) that stamps `state/ingest/update-revenue.json` via
`npx tsx scripts/stamp-ingest.ts update-revenue --summary "…"`.

## 10. recent_updates / changelog

Phase 1 static JSON → **no changelog** (per the rule: static-JSON, no PG serving, no
`recordIngestBatch`). If Phase 2 adds a PG table (debtors, excise registers), wire it into
`recent_updates` via `recordIngestBatch` (`scripts/db/lib/ingest_changelog.ts`) INSIDE the
loader txn with a stable natural key (day-coalesced, auto-summary >500/day per the changelog
rule). Example debtors: `{ source:"tax_debtors", keyExpr:"t.eik", nameExpr:"t.name",
detailExpr:"t.amount_eur || ' € дълг'", amountExpr:"t.amount_eur", rowsTotal }`.

## 11. AI chat tools

Add a revenue tool family mirroring the awarder/budget tools (per the ai/ recipe): create
`ai/tools/revenue.ts`; edit `ai/tools/registry.ts` (import + `ToolDef` in `TOOLS`),
`ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (cases). Tools NEVER
compute numbers in prose — they narrate `env.facts`; data via `fetchData` for the static
`revenue_breakdown/*.json` (or `fetchDb` for any Phase-2 PG blob).

- `napRevenueBreakdown` (domain `fiscal`) — НАП revenue by tax type (VAT/PIT + КФП total), year.
- `customsRevenueBreakdown` (domain `fiscal`) — Митници: excise (by product) / import VAT /
  duties / fines, year, YoY.
- `taxGap` (domain `indicators`) — BG VAT/PIT gap vs EU, as % of theoretical liability.
- `revenueVsSpend` (domain `fiscal`) — the circuit: total collected vs КФП budget-by-function.
- `(Phase 2)` `taxDebtors` (domain `connections`) — top debtors + the contract-winner overlay.

Router keywords: `нап|митниц|акциз|данъ|ддс|ддфл|приход|събрани|митни|excise|customs|vat|
revenue|tax gap|данъчна пропаст`. Provenance strings: `budget/revenue_breakdown/*.json`,
`budget/kfp.json`. **Any `/budget/revenue_breakdown/*` path an ai/ tool reads MUST have an
`AI_PATH_RULES` entry** (§12) or the prebuild fails — check whether `budget` already has one
that covers it.

## 12. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source/path
- Sources are already placed (`budget` group has `customs_revenue`, `nap_annual`,
  `eurostat_policy`). **Add feature nodes** for the two packs and edges from the budget
  dataset: `["ds:budget","f:nap-revenue"]`, `["ds:budget","f:mitnici-revenue"]` (feature nodes
  for the two awarder views). If Phase 2 adds `customs_excise_registers`, add it to the
  `budget` group `members`.
- `AI_PATH_RULES`: ensure a rule covers `/budget/revenue_breakdown/` (likely under the existing
  `budget` dataset — verify; add `{ pattern:/^\/budget\/revenue_breakdown\//, dataset:"budget" }`
  if the ai/ tools read it and it isn't matched).
- Verify with `npm run data:map`.

### README.md
- "Data sources" — the budget/КФП + НАП annual + Митническа хроника rows already exist; add a
  one-liner that НАП and Митници now have **entity revenue dashboards** (not just budget
  drilldown), and note the two EIKs.
- No new `data/` layout entry for Phase 1 (reuses `data/budget/revenue_breakdown/`).
- Phase 2: document the egov excise-register ingest + any `--backfill` flags.

### Data pages (`/data`, `/data/sources`, `/data/updates`)
- These auto-generate from `model.ts`; the feature-node + edge additions above make the two
  packs appear on the generated sources→datasets→features diagram. No hand-editing.

## 13. Sitemap, static page generation & OG cards

`/awarder/:eik` is a **client-only SPA route** — with no prerender a crawler hits the Firebase
rewrite and sees the homepage meta (soft-duplicate, the SEO-discovery gap). The existing packs
solve this through **one source of truth**: `INSTITUTION_PACKS` in
`scripts/prerender/institutions.ts`, which drives all three SEO surfaces. Adding НАП + Митници
is **two array entries** (plus a `data-og` attribute on each hero) — nothing bespoke.

### The single-source-of-truth entry (per agency)
Append to `INSTITUTION_PACKS` an `InstitutionPack`:
- `eik` (`131063188` / `000627597`), `slug` (`nap` / `customs`), `nameBg/En`.
- `titleBg/En`, `descriptionBg/En` — the `<title>`/`<meta description>` (revenue-first copy,
  e.g. "НАП — откъде идват данъчните приходи: ДДС, ДДФЛ, акцизи, данъчна пропаст").
- `bodyBg/En` — crawlable no-JS `<h1>`+`<p>` body (the "collector, not spender" thesis,
  headline figures, internal links to `/budget`, `/procurement`, `/indicators/compare`).
- `ogAnchor` — the `data-og` selector of the pack's signature visual so the OG card leads with
  the chart, not a KPI header: `[data-og="nap-revenue"]` (the composition bar) /
  `[data-og="customs-excise"]` (the excise donut). Set `ogCenter`/`ogSettleMs` if the visual
  reads from the middle or needs render-settle time (charts: ~2500ms, maps: ~3500ms).

This single entry automatically wires:
- **`scripts/prerender/dynamicRoutes.ts`** → per-route static HTML + OG/meta at
  `dist/awarder/<eik>/index.html` (+ `/en`). Cost = 4 files total — negligible against the
  ~84k file-ceiling.
- **`scripts/sitemap/index.ts`** (L701–708) → emits `/awarder/:eik` + `/en/awarder/:eik`
  sitemap URLs (loops `INSTITUTION_PACKS`). Each `<loc>` now has a real prerendered
  `index.html`, so it is NOT a homepage soft-duplicate (satisfies the sitemap-validity rule).
- **`scripts/og/capture-screens.ts`** → captures the OG card framed on `ogAnchor` to
  `public/og/awarder/<slug>.png`.

### Pack-side requirement
Each pack's hero tile must carry the matching `data-og="nap-revenue"` /
`data-og="customs-excise"` attribute (as `NzokBudgetBridgeTile` carries `data-og="nzok-bridge"`
and the roads map `data-og="roads-map"`). This is the only frontend change beyond the pack
itself.

### Verify
`npm run sitemap` (regenerates URLs), `npm run build && postbuild` (prerender + OG), and
`npm run test:seo` (Playwright `--project=seo` asserts crawlable HTML/meta per route). Keep the
EIKs in `institutions.ts` in sync with the `PACKS` registry and the `*_AWARDER_PATH` constants
(the file header calls this out).

## 14. Phasing

- **Phase 1 — zero-new-ingest packs (ship first).** `NapPack` + `MitniciPack` off the existing
  hooks (`useCustomsBreakdown`/`useVatBreakdown`/`usePitBreakdown` + КФП): composition hero,
  KPI row, tax-gap tile (hard-keyed EU numbers), cost-to-collect, simulator CTA. Full §3
  skeleton; nav wired (sectorPacks + ProcurementNav + reportMenus + i18n). Relabel the
  buy-side header for the two EIKs. Митници gets the excise explorer + trade origins; НАП
  headlines the monthly КФП tax composition + a labelled осигуровки band (Option C, §15), with
  VAT/PIT КИД-2008 (2024) as the drill. Reuse the drilldown bodies from
  `BudgetFlowRevenueDrilldown.tsx`. AI tools `napRevenueBreakdown`/`customsRevenueBreakdown`/
  `taxGap`. Data-map feature nodes + README line. **Both `INSTITUTION_PACKS` entries +
  `data-og` hero attributes (§13)** so the two routes prerender, enter the sitemap and get OG
  cards; verify `npm run sitemap` + `npm run test:seo`.
- **Phase 2 — Tier B + the moat.** egov excise registers (+ watcher, §9), annual-report
  enforcement stats (extend `nap_annual`/`customs_revenue`), ≥1 cross-dataset overlay (§7,
  + `taxDebtors` tool + SQL perf §8 + changelog §10).
- **Phase 3 — first-class `/revenue` (Приходи).** Revenue→spend circuit Sankey (collected ×
  КФП budget-by-function), personalized "къде отиват моите данъци" (HMRC Annual Tax Summary;
  fills the calculator gap vs IME kolkodavam — the `bgTaxPolicy` engine already computes the
  per-lever €, so this is UI + income input, not new modelling). Consider a 5th top-level view
  next to the planned Потребление.

## 15. Open questions / risks
- ~~НАП composition is 2024-only~~ RESOLVED (§2): tax-type composition is monthly/current from
  КФП snapshots.
- **Осигуровки in the headline — DECIDED: Option C.** Headline the **tax-revenue composition**
  (clean КФП slice, reconciling total); show осигуровки as a **separate labelled additive band**
  ("+ €X събрани за сметка на НОИ/НЗОК", linked). This matches НАП's own ~€21.5bn total, avoids
  double-counting the contributions the НОИ/НЗОК packs already show, and keeps the composition
  reconciling to one base. The осигуровки figure is a single number from the social-funds КФП
  constituent or the НОИ/НЗОК B1 (already ingested) — not a second composition.
  *Ship-now fallback:* if the осигуровки number isn't wired for Phase 1, headline tax revenue
  with an explicit "без осигуровки" label (Option A), then add the band (→ full C) as a
  fast-follow. Either way the tax bar is unchanged.
- Per-agency НАП/Митници split: derive from tax types, or ingest the МФ monthly bulletin
  (`minfin.bg/bg/statistics/12`) for the exact administered-by number — deferred, not blocking.
- Generalize `scripts/budget/nap_annual.ts` beyond 2024 (currently hardcoded) before the 2025
  НАП report's КИД-2008 sector detail can be shown.
- Buy-side header ergonomics for collector EIKs — confirm the relabel reads well.
- Митници excise product split is sparse before 2025 — the explorer must degrade to top-level.
- Debtors overlay (Phase 2) precision — reuse the procurement namesake-fix high-confidence rule
  (declared stake OR unique TR name) to avoid EIK/name-collision false positives.

## 16. First social card (already in the data)
"Митниците събраха 7,06 млрд. € през 2024 — 50% от тях са акцизи, а €1,36 млрд. само върху
горивата." (customs/2024.json, confirmed against Митническа хроника.)
