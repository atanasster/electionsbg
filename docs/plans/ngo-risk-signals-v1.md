# NGO risk-signals v1 — plan

Turn the ЮЛНЦ surface (`/procurement/ngos` list + the per-NGO `/company/:eik` page)
from a plain directory into a **signals product**: every NGO carries computed
public-interest signals — political/magistrate connections, public procurement won,
EU-fund and state-subsidy money, foreign funding — surfaced as `SignalPill`s in the
browse list and as a risk-signal dashboard block on the NGO page.

Builds directly on the shipped NGO backend (commit `a95a3eba3`) and the procurement
risk-v2 infrastructure. **Reuse, don't reinvent.**

## Framing guardrails (carry over from the NGO ingest work)

- Public-money **accountability** is the thesis — not donor/ideology exposure.
- Foreign funding shown as **absolute €**, never a "% foreign" ratio; the word is
  **exposure**, never "foreign agent". (2020 НПО-portal debate.)
- Every signal is **"трейс, не доказателство"** — a documentation/pattern flag,
  footnoted as such (mirrors the risk-grade "EXPOSURE, not proof" footnote).
- NGOs are **not** buyers; the procurement risk-GRADE (buyer/supplier A–F) is a
  secondary lens, not the headline. The headline is the **signal set**.

## Non-negotiable operating principles (apply to every phase)

1. **All new data lands in Postgres — no new served JSON.** Serving is PG-only,
   local Docker == Cloud SQL (postgres-migration rule; funds-pg-only rule). Fetchers
   write *raw* payloads under `raw_data/…` (staging only, like the FTS xlsx); loaders
   parse raw → `ngo_funding` / new PG tables via `COPY`/staging-table upsert. **No**
   `data/ngo/*.json` serving tree, **no** JSON shards read at request time. The single
   sanctioned exception is `data/ngo/ai_summary.json` — it is *generated FROM* PG
   (`scripts/ngo/build_ai_summary.ts`) solely because the AI hosting target cannot hit
   `/api/db`; it is a projection, never a source of truth. (Retire the hand-curated
   `data/ngo/foreign_grants.json` intermediate for the *fetched* ABF/NED sources — the
   fetcher writes raw JSON to `raw_data/ngo_funding/{abf,ned}/` and the loader parses
   that straight into `ngo_funding`. `budget_subsidies.json` may stay a small **manual
   seed** — it isn't fetched.)
2. **Every new ingest is wired into the watcher + process-watch-report** before it's
   "done" — a source in `scripts/watch/sources/`, a row in the process-watch-report
   `SKILL.md` source→skill table, and a `db:load:*:pg:cloud` row in its Cloud-SQL
   sync section. An ingest with no watcher row is incomplete (Part D).
3. **Every new / changed PG query is performance-tested** with `EXPLAIN ANALYZE` on the
   worst-case entity before it ships; add the matview/index it needs (Performance
   section). Index both sides of every join key (PG perf playbook).
4. **Blocked or missing public data → log it in the egov roadmap.** If an ingest hits a
   source that is PDF-only, paywalled, or nonexistent, record it in
   `docs/egov-single-source-roadmap.md` (the МИДТ feedback doc) in the matching section
   — §1B broken-on-portal, §2 exists-publicly-not-on-portal, §3 locked, §4 nonexistent
   — rather than silently working around it. Known NGO gaps to file there (below).

---

## What already exists (reuse map)

### Data in Postgres (all keyed to the NGO's EIK = `tr_companies.uic`)
- `company_politicians` (008) — politician↔company links; **already includes NGO
  board roles** (ngo_board/ngo_representative flow into `tr_officers` → cross_reference).
- `magistrate_company` (070) — magistrate→company declared holdings/participation.
- Officials/PEP cross-reference (`scripts/procurement/pep_connected.ts`,
  `data/officials/derived/company_links.json`) — cabinet, governors, mayors, councillors.
- `contracts.contractor_eik` (001) — NGO as public-contract winner.
- `supplier_risk_grade(eik)` / `awarder_risk_grade(eik)` + `risk_grade_letter()` (041)
  — A–F composite with singleBid/direct/buyerConcentration/connectedSelf components.
- `awarder_kindex(eik)` (039) — political-connection share for buyers.
- `fund_projects` / `fund_beneficiaries` (ИСУН EU funds) — via the company endpoint.
- `ngo_funding` (040) + `ngo_funding_for(eik)` — eu_fts / budget_subsidy / abf / ned.
- `ngo_details`, generated cols `entity_class` + `ngo_type` (003).

### UI components
- `SignalPill` (`src/screens/components/procurement/SignalPill.tsx`) — 11 tones, icon,
  single-line chip. Wrap in `@/ux/Tooltip` for detail.
- The `computeXRisk → {key, available, fired}` + `criColor` meter model
  (`computeProcurementRisk.ts` / `computeTenderRisk.ts`) — the per-row chips pattern.
- `RiskBadges` / `TenderRiskChips` — table-cell chip strips (the exact thing to mirror).
- `EntityRiskGradeCard` (+ `EntityRiskGrade` type, `riskGrade.ts` `GRADE_TONE` A–F,
  `criColor`, `formatShare`) — the reusable entity 0–100 / A–F grade card.
- `CompanyRiskChips` — the hero boolean-flag chip row (debarred / political-links /
  EU-beneficiary …) already rendered in the CompanyDbScreen hero (line ~696).
- `DbDataTable` custom cell — see `TendersBrowserDbScreen.tsx` status/risk columns
  (a `flex flex-wrap gap-1` of conditional `SignalPill`s in a `cell` accessor).

### Serving
- `ngos` registry in `functions/db_table.js` (base `tr_companies`, entity_class filter).
- `/api/db/ngo-stats`, `/api/db/facets`, `/api/db/company` (`functions/db_routes.js`)
  — the company endpoint already returns `politicians`, `ngoFunding`, `ngoDetails`,
  `awarderKindex`, `funds`, contract rollups.

---

## Part A — Ingest new data (fill the real gaps)

Only three signals need data we don't already have. Everything else is a join.

All rows land in the existing `ngo_funding` PG table (source column) — **no served
JSON**. Fetchers write raw payloads to `raw_data/ngo_funding/{abf,ned}/`; the loader
parses raw → PG (extend `scripts/ngo/load_ngo_funding_pg.ts`).

| Source | Feeds signal | Effort | PG landing / notes |
|---|---|---|---|
| **America for Bulgaria Fdn** (IRS 990 Sch.I via ProPublica JSON) | `foreign_funded` | M | New fetcher → `raw_data/ngo_funding/abf/`; loader parses → `ngo_funding` source=`abf`. Name-only → VAT→exact-fold→fuzzy match scoped to NGO entity_classes. Drops the hand-curated `foreign_grants.json`. |
| **NED** (grants search, light scraper) | `foreign_funded` | M | New fetcher → `raw_data/ngo_funding/ned/`; loader → source=`ned`. |
| **EU FTS multi-year** (2016–2025 xlsx) | `foreign_funded` | S | Extend the existing FTS ingest to loop years; watcher `ec_fts` already exists. Raw xlsx already lands in `raw_data/ngo_funding/fts/`. |
| *(optional)* **EU/OFAC + national sanctions/debarment for ЮЛНЦ** | `sanctioned` | M | New fetcher → PG table `ngo_sanctions` (not JSON). High-value red flag but sparse. Defer to Phase 6. |
| *(optional)* **БУЛНАО donations by/NGOs** | `party_donor` | L | Unblocks K-Index donor leg; needs a new PG donations ingest (party-donation data not yet in PG). Defer to Phase 6. |

**Deliverable A:** ABF+NED fetchers land raw under `raw_data/`, FTS backfilled;
`npm run db:load:ngo-funding:pg` re-run → rows in `ngo_funding` (PG). New watcher rows
`abf`/`ned` → `db:load:ngo-funding:pg` (Part D). This is the only genuinely-new ingest
on the critical path — magistrate/PEP/procurement/ИСУН are all already in PG.

**Missing-data to file in `docs/egov-single-source-roadmap.md`** (per principle 4):
- **NGO annual financial reports (ГФО/ГФД)** — PDF-only in the ТР register (Г2 filing,
  30 Sep deadline), no structured/EIK-keyed source → §3 (locked behind a PDF wall).
  This is why funding is shown as absolute € with no revenue denominator.
- **Foreign-donor register** — the 2020 bill (054-01-60) was never adopted, so there is
  no BG register of foreign funding to NGOs → §4 (nonexistent-but-useful). We
  reconstruct it fuzzily from funder-side sources (FTS/ABF/NED) instead.
- **Party-donation data (БУЛНАО)** — published only as non-machine-readable filings,
  blocking the K-Index donor leg → §1B or §3.

---

## Part B — Compute the NGO signal set (backend, the core of this feature)

### B1. `scripts/db/schema/pg/0XX_ngo_signals.sql`

A single canonical function + a matview, following the 041 pattern.

```
ngo_signals_for(p_eik text) RETURNS jsonb
```
Returns an ordered array of signal objects — the same shape the UI renders on both the
list cell and the page:
```
{ code, tone, valueEur?, count?, detail? }[]
```

Signal vocabulary (code → tone → source):

| code | tone | fires when | source |
|---|---|---|---|
| `politician_board` | violet | ≥1 sitting/former politician on board/representing | `company_politicians` (eik) |
| `magistrate_board` | fuchsia | ≥1 magistrate declared a link | `magistrate_company` (eik) |
| `public_contracts` | teal | won ≥1 public contract | `contracts.contractor_eik` (€, count) |
| `single_bid` | amber | high share of won value on 1-bidder awards | `supplier_risk_grade(eik).components.singleBid` |
| `eu_funds` | emerald | ИСУН beneficiary | `fund_projects` (€) |
| `budget_subsidy` | emerald | state-budget subsidy | `ngo_funding` source=budget_subsidy |
| `foreign_funded` | slate | FTS/ABF/NED grant | `ngo_funding` source in (eu_fts,abf,ned) |
| `new_winner` | orange | first public money within N months of registration | `tr_companies.registered_at` vs first contract/fund |
| `debarred` | red | on АОП debarred register | debarred set (shared with risk scorer) |
| `sanctioned` | red | *(optional, Part A)* | sanctions ingest |

Design notes:
- Each signal carries its own `valueEur`/`count`/`detail` so the tooltip needs no
  extra fetch.
- **No forced A–F "corruption grade"** for the headline (NGOs aren't buyers). Instead
  expose a `signal_count` + a headline `public_money_eur` (Σ contracts + ИСУН +
  subsidies) as the sort/interest key. The buyer/supplier `EntityRiskGradeCard` stays
  available on the page for the rare NGO that awards contracts, unchanged.

### B2. `ngo_signals` matview (for the list)

```
CREATE MATERIALIZED VIEW ngo_signals AS
SELECT uic AS eik,
       ngo_signals_for(uic)                       AS signals,
       jsonb_array_length(...)                     AS signal_count,
       <public_money_eur>                          AS public_money_eur,
       (has politician_board OR magistrate_board)  AS has_connection
FROM tr_companies WHERE entity_class IN (<ngo classes>);
```
- Only NGO rows (~30k) → cheap. Index on `(public_money_eur DESC)`, `(signal_count)`,
  GIN on `signals` for code-filtering. Refresh in `load_tr_pg.ts` after
  `company_politicians` + after `db:load:ngo-funding:pg` (both feed it).
- Follows the "compute the interesting flag, drive product off it, boring 92% stay in
  DB" strategy from the ingest plan.

### B3. Serving

- **List:** extend the `ngos` registry (`db_table.js`) to LEFT JOIN `ngo_signals` and
  `select` `signals`, `signal_count`, `public_money_eur`; add a `signal` facet filter
  (`filter:"in"` over signal codes) and allow sort by `public_money_eur`.
  Change the default sort from alphabetical → `public_money_eur DESC` so interesting
  NGOs surface first.
- **Page:** add `ngoSignals: ngo_signals_for($1)` to the `/api/db/company` response
  (one more `ngo_funding_for`-style call, gated on `entity_class` being an NGO class).
- **Stats strip:** add a "NGOs with signals" card to `/api/db/ngo-stats`.

**Perf:** see the Performance section — `ngo_signals_for` and the list browse are both
gated on `EXPLAIN ANALYZE` before ship; the matview keeps per-row list cost at a lookup.

---

## Part C — UI

### C1. Shared signal meta + pill component

`src/screens/components/procurement/NgoSignalPills.tsx` (mirrors `TenderRiskChips`):
- `NGO_SIGNAL_META: Record<code, { tone, icon, shortKey, longKey, hintKey }>` — one
  source of truth for both the list cell and the page.
- `NgoSignalPills({ signals, variant })` — `variant="chips"` renders
  `<Tooltip><SignalPill tone icon>{short}</SignalPill></Tooltip>` per signal (dash when
  none); `variant="full"` adds the "N signals" count line for the page header.
- Labels short & bilingual (`Политик в УС`, `Магистрат`, `Обществени поръчки`,
  `ЕС фондове`, `Субсидия`, `Външно финансиране`, `Един кандидат`, `Нова, но печели`…).

### C2. NGO browse list (`NgoBrowseDbScreen.tsx`)

- Add a **Сигнали / Signals** column: `cell: ({row}) => <NgoSignalPills signals={row.original.signals} />`.
  Non-sortable, wraps in a flex container (mirror TendersBrowser lines 194–233).
- Add a **public-money €** column (right-aligned, sortable), default sort DESC.
- Add a signal-code **filter** to the toolbar (reuse the shared Radix `Select` /
  `PackSelect`, never native — per the no-native-select rule) alongside the existing
  `ngo_type` facet.
- Stat strip: 4th card → "NGOs with signals" count.

### C3. NGO page dashboard (`CompanyDbScreen.tsx`, NGO branch)

Insert a **risk-signal block** in the existing NGO tile zone (between the hero and the
awarder section, ~lines 781–899). No tabs — stacked dashboard tiles (dashboard-layout /
no-tabs conventions). Order:

1. **Signal summary strip** — `<NgoSignalPills signals={ngoSignals} variant="full" />`
   right under `CompanyRiskChips` in the hero (or as the first NGO card).
2. **Connections tile** — "Свързани лица" — list of politicians (from `politicians`),
   magistrates (new: fold `magistrate_company`), and officials/PEPs on the board, each
   row prepended with the shared **`MpAvatar`** (photo + party colour) and linking to
   `/person/:name` (MP-row convention). This makes the political-proximity signal
   legible, not just a pill.
3. **Public money tile** — reuse the existing procurement rollup + `ngoFunding`
   "Външно финансиране" tile (already shipped) + an ИСУН line from `funds`. Group them
   under one "Публични пари" heading with a Σ headline €.
4. **Procurement behaviour** (only if the NGO won contracts) — keep the existing
   `EntityRiskGradeCard grade={supplierGrade}` unchanged.

Footnote every signal block: *"Сигналите са индикатори за публичен интерес, не
доказателство за нарушение."*

---

## Part D — Cross-cutting (don't ship without)

- **i18n** — bg/en keys for every signal short/long/hint label + tile headings.
- **AI chat** (`ai/tools/ngo.ts`) — add `ngoRiskSignals(eik)` and `ngoBySignal(code)`
  tools; extend `data/ngo/ai_summary.json` (`scripts/ngo/build_ai_summary.ts`) with a
  signal rollup (top NGOs per signal); register in `registry.ts`; add router keyword
  block (сигнал / свързан / политик + нпо). AI reads static JSON only → the summary
  must carry the precomputed lists. `bucket:sync` after reload.
- **Changelog** — new/refreshed datasets MUST wire `recent_updates` (PG changelog) per
  the PG-changelog rule; the ABF/NED ingest also gets a `data-changes.json` row for
  `/data/updates`. (Two changelogs — don't conflate.)
- **data_map** — add `abf`/`ned` sources into a SOURCE_GROUP (build_manifest throws on
  unplaced source, like `ec_fts` did) + edges to `ds:ngo`.
- **Watchers + process-watch-report (principle 2)** — for each new ingest:
  - a source module in `scripts/watch/sources/` (`abf`, `ned`) registered in
    `sources/index.ts` and placed in a data_map SOURCE_GROUP (build_manifest throws on
    an unplaced source, as `ec_fts` did);
  - a row in `.claude/skills/process-watch-report/SKILL.md`'s source→skill table:
    `abf` / `ned` → `db:load:ngo-funding:pg` (mirroring the existing `ec_fts` row —
    "download raw → load into `ngo_funding`; DB-only, no JSON"), sharing the
    `db-load-ngo-funding` ingest marker;
  - a row in that skill's Cloud-SQL sync section → `db:load:ngo-funding:pg:cloud`
    (already present for `ec_fts`; ABF/NED ride it).
  The register/signals path needs **no new watcher** — it rides `egov_commerce` →
  `tr-daily-refresh` (which already reloads `tr_*` + rebuilds the K-Index); the
  `ngo_signals` matview refresh is chained into `db:load:tr:pg` **and**
  `db:load:ngo-funding:pg` (both feed it).
- **SEO/OG** — high-signal NGOs are the pages worth prerendering; consider adding the
  top-N connected/funded NGOs to the sitemap route_defs (the boring 92% stay
  no-index, per strategy). Refresh `public/og/procurement-ngos.png` if the list header
  changes.
- **Perf/deploy** — matview refresh in `load_tr_pg.ts`; deploy path =
  `db:load:tr:pg:cloud` + `db:load:ngo-funding:pg:cloud` + functions redeploy
  (+ `bucket:sync` for ai_summary). No `db:dump`.

---

## Performance, matviews & indexes (principle 3 — gate before each ship)

Every new/changed query gets `EXPLAIN ANALYZE (BUFFERS)` on its **worst-case entity**,
run against local Docker PG (`:5433`), and again post-deploy on Cloud SQL (db-g1-small,
shared-core — the prod bottleneck). Target: list browse < ~5 ms server, company
endpoint's added call < ~2 ms.

| Object | Worst case to test | Index / matview |
|---|---|---|
| `ngo_signals_for(eik)` (page) | the NGO with the most contracts + funding rows (large читалище / sports federation) | relies on existing FK indexes: `idx_ngo_funding_eik`, `idx_company_politicians_eik`, `contracts(contractor_eik)`, `magistrate_company(eik)`, `fund_projects(beneficiary eik)`. **Add any missing** (`magistrate_company` eik, fund_projects beneficiary) — both sides of each join. |
| `ngo_signals` matview | full build over ~30k NGO rows | `CREATE UNIQUE INDEX … (eik)` (enables `REFRESH … CONCURRENTLY`); `idx_ngo_signals_money (public_money_eur DESC)`; `idx_ngo_signals_count (signal_count DESC)`; **GIN** `idx_ngo_signals_gin (signals jsonb_path_ops)` for code-filtering. |
| List browse (`ngos` registry + join) | single signal-code filter + default money sort, page 1 & deep page | composite `idx_tr_companies_class_name` already exists; verify the LEFT JOIN to `ngo_signals` uses the unique eik index and the sort uses `idx_ngo_signals_money` (no seq scan / no sort node on 30k). |
| `/api/db/ngo-stats` "with signals" card | count over matview | `count(*) WHERE signal_count > 0` off the matview — cheap; avoid `count(*)` over `tr_companies` (use reltuples, as the endpoint already does). |

Rules: matview `REFRESH … CONCURRENTLY` (needs the unique index) so the list never
serves an empty table mid-refresh; refresh chained into `db:load:tr:pg` +
`db:load:ngo-funding:pg`. Determinism: `ROUND` money sums, rounded sort keys + eik
tiebreak (PG payload-determinism rule). Sargable date windows if `new_winner` compares
registration dates (COALESCE bounds, not OR-NULL guards).

**Feature perf test (before each phase ships):** drive the real flow in the preview —
load `/procurement/ngos` (sort + a signal filter), open a high-signal NGO page — and
check server timing via `read_network_requests` / `preview_logs`, not just that it
renders (verify skill).

## Phasing (each phase independently shippable)

- **Phase 1 — signals backend (no new ingest).** B1+B2+B3 over data already in PG
  (politician/magistrate/PEP/contracts/ИСУН/existing ngo_funding). PG-only; matview +
  indexes + `EXPLAIN ANALYZE` gate (Performance section). Ships the pills on list +
  page immediately. *Highest value / lowest risk — do first.*
- **Phase 2 — list UX.** C1+C2: SignalPill column, public-money sort, signal filter,
  stats card.
- **Phase 3 — page dashboard.** C3: connections tile (MpAvatar rows) + grouped public-
  money tile + footnotes.
- **Phase 4 — new ingest.** Part A: ABF/NED fetchers (raw→PG) + FTS multi-year → richer
  `foreign_funded` signal. Wire watchers + process-watch-report rows (principle 2); file
  the ГФО / foreign-donor-register / БУЛНАО gaps in the egov roadmap (principle 4).
  Independent of 1–3 (the signal just lights up for more NGOs).
- **Phase 5 — AI + discovery.** Part D: AI tools, changelog, data_map, watchers, SEO/OG.
- **Phase 6 (optional) — sanctions + БУЛНАО donor leg.** New red-flag signals.

Suggested first commit: Phase 1 SQL migration + Phase 2 list column — visible, testable
in the preview, zero new ingest.

---

## Open decisions (recommendations in bold)

1. **Composite grade vs. signal set for the headline?** → **Signal set + public-money €
   sort.** A forced A–F grade misframes NGOs as buyers; keep `EntityRiskGradeCard` only
   for the rare NGO that awards contracts.
2. **`new_winner` window N?** → **12 months** between registration and first public money.
3. **Dedicated `/ngo/:eik` page?** → **No.** Reuse `/company/:eik` (the ingest audit
   explicitly rejected a parallel /ngo universe). Enhance the NGO branch only.
4. **Sanctions / БУЛНАО donations now or later?** → **Later (Phase 6).** Sparse, and the
   donor leg needs a new PG ingest.
