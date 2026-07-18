# NGO risk-signals v1 — plan (rev 2: competitive benchmark + gap audit folded in)

Turn the ЮЛНЦ surface (`/procurement/ngos` list + the per-NGO `/company/:eik` page)
from a plain directory into a **signals product**: every NGO carries computed
public-interest signals — political/PEP connections on its board, public procurement
won, EU-fund and state-subsidy money, foreign funding — surfaced as `SignalPill`s in the
browse list and a signal dashboard on the NGO page.

Builds on the shipped NGO backend (commit `a95a3eba3`) and the procurement risk-v2
infrastructure. **Reuse, don't reinvent.**

> **Rev 2 changes** (this revision): folds in an adversarial gap audit (verified against
> the live DB) and a competitive-research sweep. The headline correction: the
> *connection* signals — the whole differentiator — do **not** work as a free join and
> require a new ingest; the *public-money* signals do work today. Signals are now split
> into those two classes, thresholds are pinned, the matview/registry/sort hazards are
> resolved, and framing/legal conventions are adopted from OpenSanctions / GlassPockets /
> EU Transparency Register / ProPublica. See the **Gap-audit resolutions** table at the
> end for the finding-by-finding trace.

---

## Competitive benchmark (what peers do; what to adopt)

The landscape splits into three archetypes — **none combines all our signals**, which is
the differentiation opportunity, confirmed by the fact that the nearest Bulgarian peer
(ngobg.info) is a self-publishing directory with no scoring at all (first-of-kind
domestically).

1. **US 990-based transparency** (ProPublica Nonprofit Explorer, Candid/GuideStar,
   Charity Navigator, GlassPockets) — frame accountability as *disclosure completeness*,
   not risk. Adoptable:
   - **Person-name search as a first-class entry point** (ProPublica indexes
     officers/directors) — we already have `/person/:name`; make sure NGO board rows link
     there.
   - **Explicit data-freshness / provenance stamp** per dataset (ProPublica states the
     exact processing + fiscal years covered) → put a per-signal **as-of date**.
   - **Related-party-transaction check** (Charity Navigator flags loans to/from
     "disqualified persons") → a concrete new signal: **board member's own company is a
     counterparty** of the NGO's contracts.
   - **Board-affiliations framed constructively** (GlassPockets: publishing board
     affiliations reveals the org's "network and sphere of influence") — a
     non-accusatory framing for our connection tile.
   - **Self-disclosure ≠ verified** caution (Candid seals are self-reported).

2. **Entity/relationship + PEP tools** (OpenSanctions, OCCRP Aleph, OpenScreening,
   Sayari). Adoptable:
   - **The PEP-as-risk-category disclaimer, near-verbatim**: *"being classified as a PEP
     is not an allegation … a risk category that exists because senior public office
     creates a specific kind of exposure to corruption … not because the individual is
     suspected of anything."* This is the single most important framing lift.
   - **Broad PEP scope** (FATF): office-holders **plus close family + associates**.
   - **Multi-property matcher**, not a bare name string (we must reuse the namesake
     guard for exactly this reason).
   - **Alert-on-new-connection** monitoring (OpenScreening saved queries → alerts when a
     new tie to a flagged entity appears) → a future NGO **watchlist/alerts** feature
     (aligns with the procurement-expansion alerts phase).

3. **Political-connection scoring (CEE) — the closest single analog: Czech Hlídač státu
   K-Index.** A multi-parameter procurement risk index (10 core + 1 bonus) mapped to an
   **A–F "energy label"**, *explicitly an indicator of risk factors, not proof of
   corruption*. Adoptable:
   - **Broad political-connection definition**: not just office-holders but **relatives,
     lobbyists, advisors, party sponsors**.
   - **Direct AND indirect ties** (through other firms the person owns), and **current
     AND historical (≈5-year) ties** — designed to catch the *divest-then-resume*
     pattern (transfer to a relative before office, resume after).
   - **Caveat (research):** K-Index scores *buyers*, not suppliers; inverting it to score
     NGOs as *recipients* "is an inversion, not a direct lift." → **We do not force a
     single A–F NGO grade** (see Part B); the headline is the signal set. The buyer/
     supplier `EntityRiskGradeCard` stays only for the rare NGO that awards contracts.

**Bulgarian legal context (load-bearing for the `foreign_funded` signal):** BG's
proposed "foreign-agent" bill would tag any CSO receiving > BGN 1,000 (~€580)/yr from
foreign sources. This makes foreign-funding the **most legally sensitive** signal. No
peer surfaces a dedicated "foreign-funding *risk*" flag; the defensible model is the **EU
Transparency Register**'s neutral **self-declaration + right-of-reply**. → Treat
`foreign_funded` as **neutral public-interest disclosure** (absolute €, distinct
non-red tone, explicitly *not* a risk/red flag), never a ratio, never "agent".

**Right-of-reply (EU Transparency Register):** anyone may trigger an inquiry into a
listed entity; the entity has review/appeal rights. → Add a per-entity **"обжалване /
поправка"** contact path for NGOs to contest a signal.

Sources: hlidacstatu.cz/osoby + texty.hlidacstatu.cz/co-je-to-k-index; opensanctions.org
(/api, /faq/policy/missing-peps, /docs/pep/methodology); projects.propublica.org/
nonprofits; charitynavigator.org methodology; glasspockets.org indicators;
transparency-register.europa.eu; ngobg.info; bcnl.org; civicus foreign-agents report.

---

## Framing guardrails

- **Public-money accountability** is the thesis — not donor/ideology exposure.
- **PEP/connection = risk *category*, not allegation** (OpenSanctions wording, adopted
  verbatim in the tooltip/footnote). Board affiliations framed as "network and sphere of
  influence" (GlassPockets), not wrongdoing.
- **Foreign funding** = neutral disclosure, **absolute €**, non-red tone, never a "%
  foreign" ratio, never "foreign agent". (BG foreign-agent debate; 2020 НПО-portal.)
- Every signal is **"трейс, не доказателство"**, carries an **as-of date** (ProPublica
  provenance convention), and a **right-of-reply** path (EU Transparency Register).
- **Name-matched signals show a confidence tier** and pass the existing namesake guard —
  a public site naming NGOs + people cannot ship silent false positives.

## Non-negotiable operating principles (every phase)

1. **All new data in Postgres — no new served JSON.** Serving is PG-only (postgres-
   migration / funds-pg-only rules). Fetchers write *raw* to `raw_data/…`; loaders parse
   → PG via `COPY`/staging upsert. The one sanctioned JSON is `data/ngo/ai_summary.json`
   — a projection *from* PG for the AI host (can't hit `/api/db`), never a source of
   truth. Retire the hand-curated `data/ngo/foreign_grants.json` for fetched sources.
2. **Every new ingest is wired into the watcher + process-watch-report** (source module +
   source→skill row + `db:load:*:pg:cloud` sync row) before it's "done".
3. **Every new/changed PG query is `EXPLAIN ANALYZE`-tested on its worst-case entity** and
   gets the matview/index it needs; index both sides of every join key.
4. **Blocked / missing public data → log it in `docs/egov-single-source-roadmap.md`** in
   the matching §1B/§2/§3/§4 section.

---

## Reality check — measured signal coverage (audit, live DB, ~30,170 NGO-class rows)

| signal | class | as-planned source | **actual NGO coverage** | status |
|---|---|---|---|---|
| `eu_funds` (ИСУН) | public-money | `fund_projects` | **2,297** | works now |
| `foreign_funded` | public-money | `ngo_funding` (fts/abf/ned) | **193** (FTS only) | works, grows w/ Part A |
| `public_contracts` | public-money | `contracts.contractor_eik` | **192** | works now |
| `budget_subsidy` | public-money | `ngo_funding` (subsidy) | **3** | works (thin seed) |
| `politician_board` | connection | `company_politicians` join | **5** ⚠ | **broken — needs new ingest** |
| `magistrate_board` | connection | `magistrate_company` join | **0** ⚠ | **wrong table — rescope** |
| `new_winner` | derived | `tr_companies.registered_at` | **column absent** ⚠ | **needs loader change** |
| **any signal** | — | — | **2,554 (8.5%)** | — |

**Root cause of the connection gap:** `company_politicians` is built *only from
procurement winners* — `cross_reference.ts:226` and `pep_connected.ts:125` both `continue`
past any EIK with no contract. So a politician on an NGO board only appears if that NGO
*also* won a public contract (→ 5 NGOs). The differentiator signal is **not a free join**;
it is the core new build (Part A2).

---

## DRY / reuse audit (verified against the codebase)

The rule: **reuse first, extract a shared piece only when the same code would otherwise be
written twice, never fork.** What each new artifact reuses or replaces:

| New in plan | Verdict | Reuse / extraction |
|---|---|---|
| `SignalPill` atom | ✅ reuse | already the shared chip (`SignalPill.tsx`) |
| NGO signal chip strip | 🔨 **extract shared** | `RiskBadges` + `TenderRiskChips` each roll their own map today → extract **`SignalPillStrip`** (+ `SignalMeta` type), refactor all three onto it (removes existing dup) — C1 |
| NGO connections tile | ✅ reuse existing | extend the existing **"Политически връзки" tile** + `company.politicians`; add `MpAvatar` from `PoliticalLinksCard`. **No 4th political-links renderer** (already 3) — C3 |
| Board rows / officers | ✅ reuse | NGO board members are `tr_officers` → already in the officers preview + `/company/:eik/officers` |
| Public-money tile | ✅ reuse | group the existing `ngoFunding` tile + `CompanyFundsTile` + `StatCard`s under one heading — C3 |
| Entity grade card | ✅ reuse | `EntityRiskGradeCard` unchanged (contract-winning NGOs) |
| Tone / grade scale | ✅ reuse | `riskGrade.ts` `GRADE_TONE` / `criColor` |
| `ngo_board_links` matcher | ✅ reuse, don't fork | reuse `buildMpConnectedFrom` / `EikLinkageMap` (source-agnostic; param the `getContractor` gate) — A2 |
| `ngo_signals_for()` aggregation | ✅ compose | call `procurement_overview()` + `ngo_funding_for()` + `supplier_risk_grade()` + the `fund_projects` query, not bespoke sums — B1 |
| `ngos_list` registry base | ✅ reuse pattern | same view-as-base pattern as `contracts_list` / `tenders_list` |
| Namesake guard | ✅ reuse | `officer_name_counts` + `COMMON_NAME_TR_ROWS` + `pep_connected` high-conf rule — B4 |

Net *genuinely* new surface: `SignalPillStrip` (shared, dedups existing), the thin
`NgoSignalPills` wrapper, `ngo_signals_for()` + `ngo_signals` matview + `ngos_list` view,
the `ngo_board_links` table + loader, and the AI tools. Everything else extends existing
components/functions.

**Follow-on cleanup (out of scope, worth a task):** three political-link renderers already
coexist (inline tile, `funds/PoliticalLinksCard`, `OfficialConnectionsSection`) reading two
different data paths — a candidate for later consolidation onto the PG-backed tile.

---

## Part A — ingest (three items; all land in PG)

### A1. External funders → `ngo_funding` (extend existing loader)

**SHIPPED (Phase 3, 2026-07-18) — FTS multi-year:** downloaded `{2019..2022}_FTS_dataset_en.xlsx`
into `raw_data/ngo_funding/fts/` (added to the pre-existing 2023–2025) and re-ran
`db:load:ngo-funding:pg` → 7 FTS years now feed `foreign_funded` (VAT→EIK, the reliable
structured leg). This is a **one-off backfill** (raw xlsx are gitignored staging); prod
gets it by downloading the years on the load host + `db:load:ngo-funding:pg:cloud`.

**ABF (America for Bulgaria Fdn) — access CRACKED, scraper + matcher remain (deferred):**
The 990 path is a dead end (grants to BG NGOs are *foreign* grants → US 990 Schedule F,
region-aggregated, no grantee names; ProPublica gives only financial summaries). But ABF's
own **Project Database at `us4bg.org/our-projects/`** lists named grantees + amounts. It is
Cloudflare + Elementor-AJAX walled (curl/WebFetch 403; the automated in-app browser renders
only the shell). **Proven reachable via headed Playwright** (the repo's cik_fetch pattern):
load `/our-projects/?project_year=all&project_area=all`, wait ~6s for CF, click
`button.elementor-button` → the WP `admin-ajax.php` proxy returns `{data:{data:{Page,
TotalPages,html,fields:{url}}}}`. Measured: **TotalPages=129** (~1290 projects). The `html`
carries clean rows — `span.us4bg-project-name`, `span.us4bg-grantee-name`, the EUR/BGN
amount, area, date range, and a `project_id`. The response also exposes a backend
`https://api.us4bg.org/api/Projects?PageSize=N&Page=n&Year=all&Area=all&Lang=en` (CF-walled
to direct curl; a headed browser may pass it for a single big-PageSize bulk pull — probe
inconclusive). **Remaining to ship (a scoped follow-up):** (1) a paginating Playwright
scraper over the 129 pages (or the bulk API) → `raw_data/ngo_funding/abf/projects.json`;
(2) parse → `ngo_funding` source=`abf`; (3) **an English→Bulgarian name-matcher** — the
grantee names are English ("Bulgarian Center for Non-for-profit Law"), which the Cyrillic
`translit_bg_latin` fold cannot join to `tr_companies`; needs an alias map or an EN↔BG fuzzy
layer, else rows stay `unmatched` (eik NULL) and don't feed `foreign_funded`.

**DEFERRED — NED:** ned.org publishes annual grant listings + a grant search, but grantee
records are name-only (no VAT/EIK — weak match to the BG register), BG grants are few
(~$50k avg), and sensitive-source name withholding is possible. A fragile scraper for
marginal, hard-to-match data — not worth building now.

Framing: `foreign_funded` stays a NEUTRAL disclosure (absolute €, slate tone).
`budget_subsidies.json` stays a small manual seed.

### A2. NGO board ↔ politician/PEP links → new PG table `ngo_board_links` **(the critical build)**
Run the officials/MP company-link join against **`tr_officers` for NGO EIKs, WITHOUT the
`getContractor` gate**. For each NGO board member (`ngo_board` / `ngo_representative` /
`trustee` / `verifier` roles), match the folded name against:
- the MP roster (`mp_connected` name set),
- the officials/PEP roster (`pep_connected` / `data/officials`), covering cabinet,
  deputy-ministers, agency heads, governors, mayors, councillors,
- the **magistrate** roster (names from the `magistrate` table).

Emit rows `(eik, person_ref, person_kind, role, confidence, namesake_count, as_of)` into a
new PG table, **high-confidence only** (declared/unique-name), each carrying a
`namesake_count` from `officer_name_counts` so common names are suppressed exactly as the
graph does elsewhere. This is a new loader (`scripts/ngo/load_ngo_board_links_pg.ts`), not
a schema tweak — the plan's rev-1 "just a join" claim was wrong.

**DRY: reuse the existing matcher, don't re-implement it.** The name-match + namesake guard
already lives in `buildMpConnectedFrom(getContractor, linkageMap)` / the `EikLinkageMap`
build (`cross_reference.ts:219`) — and it is explicitly **"source-agnostic"**, taking
`getContractor` as a parameter. The *only* thing starving NGOs is the `if (!contractor)
continue` gate (`:226`). So: reuse the same `EikLinkageMap` (the expensive matched part) and
either (a) pass a `getContractor` that returns a stub rollup for NGO EIKs, or (b) add an
opt-in `requireContractor=false` so the linkage is emitted without contract stats. Do **not**
fork the matcher. Same for the officials/magistrate rosters via the `pep_connected` path.
- Feeds `politician_board` (MP/official) and `magistrate_board` (magistrate-roster match —
  **rescoped**: "магистрат в ръководството по име, висока увереност", not the commercial
  `magistrate_company` holdings which have 0 NGO coverage).
- **Adopt the broad definition** (Hlídač): include family/associate matches only at a
  clearly-lower confidence tier, labelled as such; **defer indirect + historical ties to
  v2** (note them, don't build).

### A3. NGO incorporation date → new `tr_companies.registered_at` column
The parser already reads `FieldEntryDate` ("дата на вписване", `parse_daily_filing.ts:120`)
but does not persist an incorporation date. Store the **earliest** `FieldEntryDate` per
UIC as `registered_at` in the loader. Feeds `new_winner`. If deferred, **cut `new_winner`
from v1** rather than proxy off `last_updated` (a scrape timestamp) — do not ship a wrong
date.

**Missing-data to file in `docs/egov-single-source-roadmap.md`** (principle 4): NGO
financial reports (ГФО/ГФД, PDF-only → §3); no foreign-donor register (2020 bill 054-01-60
never adopted → §4); БУЛНАО party-donations non-machine-readable (blocks K-Index donor
leg → §1B/§3).

---

## Part B — compute the signal set (backend core)

### B1. `ngo_signals_for(eik)` — `scripts/db/schema/pg/0XX_ngo_signals.sql`
Returns an ordered array of `{ code, class, tone, confidence?, valueEur?, count?, asOf, detail }`
— rendered identically on the list cell and the page. Two classes:

**Public-money signals (work today):**
| code | tone | fires when | threshold / source |
|---|---|---|---|
| `public_contracts` | teal | won ≥1 public contract | `contracts.contractor_eik`; €+count |
| `single_bid` | amber | ≥50% of *bid-known* won value on 1-bidder awards | `supplier_risk_grade.components.singleBid`; "unavailable" when <2 bid-known contracts |
| `eu_funds` | emerald | ИСУН beneficiary | `fund_projects` (€); name-fallback for null-EIK (~9%) |
| `budget_subsidy` | emerald | state subsidy | `ngo_funding` source=budget_subsidy |
| `foreign_funded` | **slate (non-red, neutral)** | FTS/ABF/NED grant | `ngo_funding`; absolute €, as-of year |
| `large` | yellow | public money ≥ €1M (Σ) | tunable const |

**Connection signals (need Part A2; each carries `confidence` + `as_of`):**
| code | tone | fires when | source |
|---|---|---|---|
| `politician_board` | violet | MP/official on board, high-conf | `ngo_board_links` |
| `magistrate_board` | fuchsia | magistrate name on board, high-conf | `ngo_board_links` |
| `related_party` | red | a board member's *own company* is a counterparty of the NGO's contracts (Charity-Navigator pattern) | `ngo_board_links` × `company_persons` × `contracts` |
| `debarred` | red | on АОП debarred register (⚠ **name match — no EIK**) | debarred set, **through namesake guard**, confidence-labelled |
| `new_winner` | orange | first public money within **12 months** of `registered_at` | A3; omit if A3 deferred |

Design: no forced A–F headline grade (K-Index caveat). Sort/interest key = `signal_count`
+ `public_money_eur`. Each signal self-carries its detail so tooltips need no extra fetch.

**DRY: `ngo_signals_for` composes existing per-EIK functions, it does not re-aggregate.**
Call `procurement_overview()` (025) for the contracts leg, `ngo_funding_for()` (040) for
funding, `supplier_risk_grade()` (041) for `single_bid`, and the existing `fund_projects`
query for ИСУН — the company endpoint already assembles all of these per EIK
(`db_routes.js:199–354`). Reuse `risk_grade_letter()` if any composite band is ever shown.

### B2. `ngo_signals` matview + `ngos_list` view
- `ngo_signals` matview: `eik, signals jsonb, signal_count, public_money_eur,
  has_connection, has_signal`. Built `WITH NO DATA`, then a first non-concurrent populate;
  **UNIQUE index on `eik`** (enables `REFRESH … CONCURRENTLY`), btree on
  `public_money_eur DESC` and `signal_count DESC`, **GIN** `jsonb_path_ops` on `signals`.
- The registry **cannot LEFT-JOIN** (the `/api/db/table` engine is single-relation,
  `db_table.js:689`). Point the `ngos` registry `base` at a new **`ngos_list` view** =
  `tr_companies ⋈ ngo_signals` (mirrors `contracts_list` / `tenders_list`).

### B3. Serving
- **List:** `ngos_list` view exposes `signals`, `signal_count`, `public_money_eur`; add a
  `signal`-code facet (`filter:"in"`) + a **`has_signal` default filter** (see C2).
- **Page:** add `ngoSignals: ngo_signals_for($1)` to `/api/db/company` (NGO-class gated).
- **Stats:** add "NGOs with signals" card to `/api/db/ngo-stats` (`count WHERE signal_count>0`).

### B4. Namesake / confidence guard (mandatory, all name-matched signals)
`politician_board`, `magistrate_board`, `debarred`, and the ABF/NED matches all run through
the existing high-confidence rule (`pep_connected.ts:26`) + `officer_name_counts` frequency
suppression (`008_connections.sql:238`) + `COMMON_NAME_TR_ROWS` (`integrate.ts:628`). Pills
render a **confidence tier**; low-confidence never fires a red/violet pill unaided.

---

## Part C — UI

### C1. Signal pills — extract a shared strip, don't fork a third copy
**Extract `SignalPillStrip.tsx`** (new shared component) that maps a list of
`{tone, icon, short, tooltip}` items → `<Tooltip><SignalPill/></Tooltip>`, with
`maxVisible=4` + a "+N" overflow chip (mobile guard) and dash-when-empty. Today
`RiskBadges` and `TenderRiskChips` each roll their own copy of this map — so the extraction
**removes existing duplication**, it isn't net-new surface. Refactor both onto
`SignalPillStrip` as part of this work (leave their meta maps in place).
- `NgoSignalPills.tsx` becomes a **thin** wrapper: `NGO_SIGNAL_META: Record<code,SignalMeta>`
  (shared `SignalMeta = {tone,icon,shortKey,longKey,hintKey}` type, also new) → items →
  `SignalPillStrip`. Tooltip carries detail + **as-of** + **confidence tier** + the PEP
  risk-category disclaimer for connection signals. `variant="full"` = the page header strip.

### C2. Browse list (`NgoBrowseDbScreen.tsx`)
- **Signals** column (`cell → <NgoSignalPills variant="chips">`), non-sortable.
- **Public-money €** column, right-aligned, sortable.
- **Default view = `has_signal` filter ON** with a one-click "покажи всички / show all"
  toggle — do **not** default-sort 27,600 signal-less NGOs by EIK-number (audit P1 #8).
  Within the filtered set, sort `public_money_eur DESC`, **tiebreak by name** (keep the
  alphabetical expectation for the tail).
- Signal-code filter via the shared Radix `Select` (never native).
- Stats strip 4th card → "NGOs with signals".

### C3. NGO page dashboard (`CompanyDbScreen.tsx`, NGO branch, ~L781–899; no tabs)
1. **Signal strip** — `<NgoSignalPills variant="full">` under `CompanyRiskChips`.
2. **Connections tile — REUSE the existing "Политически връзки" tile** (CompanyDbScreen
   ~L1511, driven by `company.politicians`); do **not** build a new tile. Extend the
   endpoint's `politicians[]` to carry NGO board members from `ngo_board_links`
   (`kind: mp|official|magistrate`, `role`, `confidence`, `asOf`) so the existing tile
   renders them. Add **`MpAvatar`** rows (borrow the pattern + label helpers already used by
   `PoliticalLinksCard`) and a confidence/as-of line. Footnote = the OpenSanctions
   risk-category disclaimer. **Do not add a 4th political-links renderer** — the repo
   already has three (this inline tile, `funds/PoliticalLinksCard`,
   `OfficialConnectionsSection`); consolidating toward the PG-backed inline tile is the
   direction, not another parallel.
3. **Public money tile** — group procurement rollup + existing `ngoFunding` "Външно
   финансиране" tile + ИСУН (`funds`) under one "Публични пари" heading with a Σ headline €.
   `foreign_funded` visually distinct (neutral), not a red flag.
4. **Right-of-reply** line — "Смятате сигнал за грешен? Подайте поправка." (EU-register
   convention).
5. Existing `EntityRiskGradeCard supplierGrade` unchanged (rare contract-winning NGO).

---

## Part D — cross-cutting

- **i18n** bg/en for every label/tooltip/heading + the disclaimer + right-of-reply copy.
- **AI chat tools** — see the dedicated subsection below.
- **Watchers + process-watch-report** (principle 2): `abf`/`ned` sources →
  `db:load:ngo-funding:pg` (+ `:cloud`); `ngo_board_links` refresh rides `egov_commerce` →
  `tr-daily-refresh` (chained after `company_politicians`); a new
  `db:load:ngo-board-links:pg` step + marker + cloud row.
- **data_map**: place `abf`/`ned` in a SOURCE_GROUP (build_manifest throws on unplaced
  source); edges to `ds:ngo`.
- **Changelog**: `recent_updates` (PG) for every new/refreshed dataset; `data-changes.json`
  for the ABF/NED ingest (two changelogs — don't conflate).
- **SEO/OG**: prerender only the top-N signal-bearing NGOs (the 91% tail stays no-index).
  Refresh `public/og/procurement-ngos.png` if the header changes.
- **Freshness stamps**: every dataset surfaces its as-of date (ProPublica convention).

### AI chat tools — new + updated (do not skip; ships with the data)

The browser AI reads **static JSON only** (no `/api/db` from the AI host), so every number
the assistant can cite must live in `data/ngo/ai_summary.json` — the one sanctioned
JSON, built *from* PG by `scripts/ngo/build_ai_summary.ts` (principle 1). The chat path is
route → `runTool` → narrate over ~155 typed tools with a heuristic router and a
**grounded-number gate** that rejects any inline figure not present in the tool's `facts`.
Three things must move together: the summary blob, the tools, and the router/harness.

**1. Extend `ai_summary.json`** (`build_ai_summary.ts`) with a compact `signals` block —
keep the ~13 KB budget (top-N per signal, not full lists):
```
signals: {
  totals: { withSignal, byClass:{publicMoney,connection}, byCode:{<code>:count} },
  topByCode: { <code>: [{eik,name,valueEur?,count?,confidence?,asOf}] (≤15) }
}
```
Add `asOf` per source (freshness). Regenerate via `npm run ngo:ai-summary` + `bucket:sync`
after every NGO reload.

**2. New tools** (`ai/tools/ngo.ts`, register in `registry.ts`, cases in `harness.ts`):
- `ngoRiskSignals(args)` — national signal distribution (counts by code + by class, top
  signal); with an `eik`/name arg, that NGO's own signal set. `kind:"table"`, `facts`
  carry every count verbatim so the grounding gate passes.
- `ngoBySignal({ code })` — top NGOs carrying one signal (`politician_board`,
  `related_party`, `foreign_funded`, `public_contracts`, …) with €/count + confidence.
- `ngoBoardConnections({ eik|name })` **(Phase 2)** — politicians / magistrates / PEPs on
  an NGO's board from `ngo_board_links`, with confidence + as-of; points to `/company/:eik`
  and `/person/:name` for detail.

**3. Update existing tools** for the changed data:
- `ngoOverview` — add a signals summary row group (NGOs with signals, public-money vs
  connection split, most common signal); extend `facts` accordingly.
- `ngoConflictAwarders` — its "governed via an NGO board" leg becomes **real** once A2/
  Phase 2 lands (today it rests on the sparse actual_owner/liquidator roles); refresh the
  subtitle + keep the K-Index framing. No signature change.
- `ngoTopFunded` — split domestic vs foreign funders and pick up ABF/NED after A1; keep the
  **neutral** foreign framing (absolute €, not a ratio, not "agent").

**4. Router + harness** (`registry.ts` keyword block + `harness.ts` cases): extend the NGO
block — `сигнал / риск / флаг + нпо` → `ngoRiskSignals`; `свързан|политик|магистрат +
нпо/юлнц` → `ngoBoardConnections`; a specific signal word → `ngoBySignal`. Add one harness
router case per new tool + intent (mirrors the existing lines 288–290).

**5. Grounding + gating.** Every new tool exposes its inline numbers in `facts` (connection
counts are *small* — keep them exact, never rounded, or the grounding gate flags them).
**Gate the connection tools** (`ngoBoardConnections`, and `ngoBySignal` for connection
codes) behind Phase 2 — before `ngo_board_links` exists they return ~5/0 rows; ship them
only when the data is real. Public-money signal tools ship in Phase 1.

Provenance for all: `["ngo/ai_summary.json"]`, plus the source's as-of date.

---

## Performance, matviews & indexes (gate before each ship)

`EXPLAIN ANALYZE (BUFFERS)` on the **worst-case entity**, local Docker (`:5433`) then Cloud
SQL (db-g1-small shared-core — the prod bottleneck). Targets: list browse <~5ms server;
company endpoint's added call <~2ms.

| Object | Worst case | Index / matview |
|---|---|---|
| `ngo_signals_for(eik)` | NGO with most contracts + funds | reuse existing FK idxs: `idx_ngo_funding_eik`, `idx_fund_projects_eik` (016:30, **already exists**), `contracts(contractor_eik)`, `idx_magistrate_company_eik` (070:35, **already exists**), `ngo_board_links(eik)` (**add**). Verify, don't blind-add (audit P2 #10). |
| `ngo_signals` matview | full build over ~30k | UNIQUE `(eik)`; btree `public_money_eur DESC`, `signal_count`; GIN `signals jsonb_path_ops`. `WITH NO DATA` → populate → `REFRESH … CONCURRENTLY`. |
| **Daily refresh cost** | 30k rows × ~6 correlated lookups **every day** via `tr-daily-refresh` | **Guard on feeding-table existence** (like `load_tr_pg.ts:376`); **refresh only when a feeding load ran**; measure the full rebuild on db-g1-small, not just one entity (audit P1 #7). If too slow, make `ngo_signals_for` set-based (single pass) rather than per-row. |
| List browse (`ngos_list`) | signal-code filter + money sort, deep page | verify the view uses the unique-eik + money indexes (no seq scan / no sort node on 30k). |
| `ngo_board_links` build | name-match over all NGO officers | index the fold key both sides; reuse `officer_name_counts`. |

Determinism: `ROUND` sums, rounded sort keys + eik tiebreak. Sargable date window for
`new_winner` (COALESCE bounds). **Feature perf test each phase:** drive the real flow in
the preview (`/procurement/ngos` sort + filter; a high-signal NGO page) and read server
timing via `read_network_requests` / `preview_logs` (verify skill) — not just that it
renders.

---

## Phasing (each independently shippable)

- **Phase 1 — public-money signals (ship the working 8.5% now).** B1 (public-money class
  only) + B2 + B3 over data already in PG (contracts/ИСУН/ngo_funding). SignalPill column +
  page strip + `has_signal` list default. **AI**: extend `ai_summary.json` signals block +
  ship the public-money AI tools (`ngoRiskSignals`, `ngoBySignal` for public-money codes) +
  update `ngoOverview`. Zero new ingest, immediate value, low risk.
- **Phase 2 — connection signals (the differentiator, needs A2).** Build `ngo_board_links`
  (politician/official/magistrate name-match, namesake-guarded, confidence-tiered) + the
  `related_party` signal + the connections tile with `MpAvatar` rows + disclaimers +
  right-of-reply. **AI**: ship the connection tools (`ngoBoardConnections`, `ngoBySignal`
  for connection codes) + refresh `ngoConflictAwarders`'s now-real board leg. *This is where
  the competitive edge lives — but it is real ingest work.*
- **Phase 3 — external-funder ingest (A1).** ABF/NED fetchers + FTS multi-year → richer
  `foreign_funded`. Watchers + process-watch-report + egov-roadmap gaps (principles 2, 4).
- **Phase 4 — derived + polish.** A3 `registered_at` → `new_winner`; mobile overflow;
  freshness stamps; SEO/OG top-N.
- **Phase 5 — discovery + finish.** `ngoTopFunded` foreign/domestic split (after A1),
  changelog, data_map, SEO/OG top-N, harness cases. (Core AI tools already shipped in
  Phases 1–2 alongside their data.)
- **Phase 6 (v2) — depth.** Indirect + historical (5-yr) ties (Hlídač); alert-on-new-
  connection watchlist (OpenScreening); sanctions signal; БУЛНАО donor leg.

---

## Open decisions (recommendations **bold**)

1. **Headline = signal set, not a forced A–F grade.** K-Index scores buyers; inverting to
   an NGO "corruption grade" is defamatory-adjacent and unsupported by peers. Keep the
   supplier grade only for contract-winning NGOs.
2. **Ship Phase 1 (public-money) before Phase 2 (connections)?** → **Yes** — the working
   signals ship value immediately while the `ngo_board_links` build (the risky part) is
   done properly.
3. **`new_winner` — build A3 now or defer?** → **Defer to Phase 4**; cut the signal from v1
   if `registered_at` isn't populated (never proxy off `last_updated`).
4. **`foreign_funded` — risk pill or neutral disclosure?** → **Neutral** (non-red tone,
   absolute €), given the BG foreign-agent legal sensitivity.
5. **List default — `has_signal` filter vs money sort?** → **`has_signal` filter ON** with a
   "show all" toggle; name tiebreak preserves the alphabetical tail.

---

## Gap-audit resolutions (finding → resolution)

| # | Audit finding (P) | Resolution in this plan |
|---|---|---|
| 1 | `politician_board` fires for 5 NGOs — `getContractor` gate starves it (P0) | New ingest **A2 `ngo_board_links`** (no gate); moved to **Phase 2**, not a free join |
| 2 | `magistrate_board` = 0; `magistrate_company` is commercial holdings (P0) | **Rescoped** to a magistrate-roster *name match* on NGO board members via A2; honest label + confidence tier |
| 3 | `new_winner` — `registered_at` absent (P0) | **A3** stores earliest `FieldEntryDate`; else **cut** (open-decision 3) |
| 4 | Registry can't LEFT-JOIN (P1) | **B2 `ngos_list` view** as the registry base |
| 5 | Namesake/defamation on name-matched signals; `debarred` has no EIK (P1) | **B4** mandatory guard + confidence tiers on every name-matched signal |
| 6 | Thresholds undefined (P1) | Pinned in **B1** (single_bid ≥50% bid-known; large ≥€1M; new_winner 12mo) |
| 7 | Daily matview refresh cost / first-build / ordering (P1) | **Performance** row: existence guard, `WITH NO DATA`+unique idx, refresh-only-if-fed, set-based fallback |
| 8 | Money-sort strands 91% of list (P1) | **C2** `has_signal` default filter + name tiebreak |
| 9 | `fund_projects` ~9% null-EIK (P2) | **B1** `eu_funds` name-fallback |
| 10 | Perf indexes already exist (P2) | **Performance** table: verify, don't add |
| 11 | Mobile pill overflow (P2) | **C1** `maxVisible=4` + "+N" chip |
| 12 | As-of dates / right-of-reply missing (P2) | **Framing** + C1 as-of + C3 right-of-reply |
| 13 | Colour-only a11y (P2) | Mitigated — `SignalPill` always has text + icon (noted) |
| 14 | AI grounding near-empty pre-A2 (P2) | **Part D**: gate connection-signal AI tools until Phase 2 |
