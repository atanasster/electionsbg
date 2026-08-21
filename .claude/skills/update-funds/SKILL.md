---
name: update-funds
description: Ingest EU-funds beneficiary data (ИСУН) from the 2020.eufunds.bg public register into data/funds/. Use when the daily watch report flags "ИСУН EU funds" as changed, when the user asks to refresh EU-funds / еврофондове / beneficiary data, or after a fresh git clone if data/funds/ is empty.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Funds skill (ИСУН EU-funds beneficiaries)

Pulls the public "Бенефициенти" register of **ИСУН 2020** — Bulgaria's Management & Monitoring Information System for EU funds — and writes canonical JSON to `data/funds/`. One row per organisation that has signed at least one EU-funds contract, with all-time rollup totals: contracts signed, funds contracted, funds actually paid (all EUR).

This covers the 2014-2020 cohesion operational programmes, the 2021-2027 period, and the National Recovery Plan — all funnelled through ИСУН. It is a major public-money channel the project otherwise does not track.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `ИСУН EU funds (beneficiaries)` changed | Full re-ingest (`npm run funds:ingest`) |
| User asks to "refresh EU funds" / "update еврофондове" / "refresh ИСУН" | Same — full re-ingest |
| `data/funds/` empty (fresh clone) | Same — the ingest is a full rebuild every run |
| The gated MP↔company link set moved — `/update-persons` re-resolved, or `/update-connections` refreshed the declarations it folds in | Re-run — the ingest re-joins the MP cross-reference automatically |
| Ingest aborts with "header row not found" | The eufunds.bg export schema changed — investigate `scripts/funds/parse.ts` BEFORE re-running |
| Ingest aborts with "export looks truncated" | The download was partial or date-filtered — see "Why a full export" below |

## Step 1 — Ingest

```bash
npm run funds:ingest
```

This downloads the full XLSX export — fresh every run — from
`https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel`
(a snapshot is kept at `data/_cache/funds/beneficiaries.xlsx`, gitignored, for
offline `--file` re-runs), parses the ~52k beneficiary rows, rebuilds
`data/funds/` from scratch — `index.json` plus
the sharded `beneficiaries/<0-9>.json` + `beneficiaries/_x.json` files — and,
when the gated MP↔company link set is reachable, cross-references the
beneficiaries against it into `derived/mp_connected.json`.

Expected output on a normal run:

```
→ fetching https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel
  2.4 MB
  parsed 52779 beneficiary row(s)
  ⚠ 4 beneficiary row(s) with a negative EUR rollup (net clawback / rounding residue — kept as-is):
      ...
→ wrote 11 beneficiary shard(s)
→ wrote 45887 per-EIK beneficiary file(s)
→ cross-referencing beneficiaries against the MP↔company link set
  EIK linkage map: … EIK(s) with at least one MP link
  303 MP↔beneficiary pair(s) → derived/mp_connected.json (… MP(s), … company(ies), €… contracted)
✓ index.json written
  52779 beneficiaries · 80705 contracts · €43,500,972,226 contracted · €16,494,577,249 paid · 45887 with EIK (86.9%)
```

⚠️ **[2026-08-20] `303` is the anchor to check, and `43` is the failure it names.** The
payload is joined at the link set's **unrestricted** scope; the contract-restricted
`company_politicians` answers only **43** of those pairs, because every row in that table is
a politically linked *contractor* and an MP-linked company that took EU money and never won
a public contract is exactly the row this payload exists to report. A pair count that lands
near 43 means the builder is reading the wrong scope — see the ⚠️ in
`scripts/lib/mp_linkage.ts`.

Flags:

```bash
npm run funds:ingest -- --dry-run         # parse + validate, no writes
npm run funds:ingest -- --file PATH.xlsx  # ingest a manually-downloaded export
```

`--file` ingests a local XLSX instead of fetching — use it when the operator
has already exported the report by hand (the export endpoint also accepts the
page's filter query string). The same row-count floor applies, so the file
must be a **full** export.

## Step 2 — Verify

```bash
node -e "
const idx = require('./data/funds/index.json');
console.log('totals:', idx.totals);
console.log('byOrgForm:', idx.byOrgForm.map(b => b.key + '=' + Math.round(b.contractedEur)));
console.log('top beneficiary:', idx.topByContracted[0].name);
console.log('cross-reference:', idx.crossReference);
"
git diff --stat data/funds/
```

You should see `index.json`, up to 11 `beneficiaries/*.json` shards, and
`derived/mp_connected.json` changed. `withEik` should stay near ~87% — a sharp
drop means EIK parsing regressed. `byOrgForm` carries the public-law vs
private-law split; `crossReference.pairCount` (the MP-tied payload) should sit
in the low hundreds.

## Step 3 — Contract-level ingest (Проекти)

```bash
npm run funds:ingest-projects
```

This pulls the sibling **Проекти** export from `https://2020.eufunds.bg/bg/0/0/Project/ExportToExcel` (one row per signed contract, ~80k rows, ~10 MB XLSX). Unlike the beneficiary rollup it carries a **per-contract implementation location** (`Местонахождение`) which is resolved against `data/settlements.json` + `data/municipalities.json` into:

- single-settlement EKATTE (~85% of rows) → `data/funds/projects/by-ekatte/{ekatte}.json`
- single- or multi-муни label (~10%) → `data/funds/projects/by-muni/{muni}.json`
- NUTS-region label (~1%) → folded into `multi_location.json`
- national / foreign / TA (~3%) → folded into `multi_location.json`
- unresolved (~0.1%, mostly settlements missing from settlements.json plus genuinely ambiguous bare names) → folded into `multi_location.json`

Also writes per-beneficiary contract lists to `data/funds/projects/by-eik/{eik}.json` (gitignored, same convention as `beneficiaries-by-eik`) and per-programme lists to `by-program/{code}.json`. The top-level `index.json` carries corpus totals, the location-kind histogram, per-programme rollups, and per-status rollups.

The ingest also emits two slim derivatives for the frontend:

- **Per-place summaries** — `by-ekatte/{ekatte}-summary.json` and `by-muni/{обshtina}-summary.json` (~3-5 KB each), carrying rollup + top-3 contracts + top-3 programmes + per-capita €. The муни summary backs the My-Area EU-funds tile and the AI `placeEuProjects` tool (avoids loading the full 18 MB Sofia shard). Money for a contract naming several общини is split evenly between them, so a `topContracts` row can exceed the place rollup — it carries `muniCount` so the reader can be told why. (The EKATTE summary currently has no live reader.)
- **Choropleth map data** — `muni-map.json` (~65 KB) with one denormalised row per муни. Backs the `FundsMuniMapTile` on `/funds`. Includes a synthetic `SOF00` row aggregating S22 + S23xx/S24xx/S25xx so the Sofia districts on the map render as a single Стoлична value.

Per-capita uses **Census 2021** population (`data/census_2021_settlements.json`) — not ГРАО — because the census carries the Sofia city EKATTE (68134 = 1.18M) which ГРАО does not. Re-run this step after `update-census` if NSI ever re-releases the corpus.

Flags mirror Step 1 — `--dry-run`, `--file PATH`.

## Step 3b — My-Area projects map (geo pins)

```bash
npx tsx scripts/funds/build_geo_pins.ts
```

Distils each município's heavy `by-muni/{обshtina}.json` corpus into a slim `by-muni-geo/{обshtina}.json` — the **top-200 contracts by money**, geocoded and non-geocoded together. Each contract that resolves to a `location.ekatte` carries `lat`/`lon` (joined against `data/settlements.json`); the rest carry none. Per-file schema: `sourceContractCount` (município total — the honest headline count), `geocodedCount` (how many resolved to a location), and `contracts[]` (the capped list).

This one slim file backs the My-Area **"Проекти от еврофондовете"** tile: it renders the full `contracts` list (scrollable) and, on demand, a Leaflet map of just the subset carrying `lat`/`lon`. Always re-run after Step 3 rewrites `by-muni/` — the `isun_eu_funds_projects` watcher flips both together. Output is idempotent except the `generatedAt` stamp.

## Step 3c — Interreg (keep.eu)

**Interreg is a different corpus, not a slice of the one above.** `fund_projects`
holds ZERO Interreg operations, and that is a system boundary rather than a
filter: Interreg runs on **Jems** while the Bulgarian operational programmes run
on ИСУН 2020. No re-query of the ИСУН export will ever surface them. Since
Interreg is cross-border by definition, everything it funds sits on a border — so
before this corpus existed, every per-capita EU-money figure the site published
understated exactly the poorest, most depopulated border municipalities.
Measured: **213 of the 256 ranked общини change rank** once it is counted,
Генерал Тошево by 43 places.

Triggered by the `keep_eu_interreg` watcher, which probes each programme's
`date_of_data_import` and NAMES the ones that moved. **Naming them is diagnosis,
not scoping** — `crawl.ts` has no programme filter, so the action is still a
`--full` walk; what the names buy is knowing that a re-import happened at all,
which the id-descending index cannot tell you. (`ingest.ts` does take
`--programme`, but only as a debugging filter that refuses to write.)

The watcher sees **11 of the 22** programmes: the rest publish no
`date_of_data_import`, so a re-import of one of those is invisible to it. "No
change" therefore means "none of the 11 moved", not "nothing moved".

```bash
# 1. Crawl — RATE-LIMITED AND OPERATOR-RUN. One index page first, to gauge the
#    block state cheaply; there is no --probe flag, and unknown flags are
#    SILENTLY IGNORED, so a mistyped one runs the full default crawl.
npm run funds:crawl-interreg -- --index-only --max-pages 1
npm run funds:crawl-interreg            # incremental: stop at a known keep.eu id
npm run funds:crawl-interreg -- --full  # ~2 h at 8-way; needed for RE-IMPORTS

# 2. Ingest the raw cache into the committed corpus (no network, no Postgres)
npm run funds:ingest-interreg -- --dry-run
npm run funds:ingest-interreg

# 3. Load
npm run db:load:interreg:pg
```

**`--full` is not optional after a re-import.** keep.eu's index is
id-DESCENDING and exposes no `modified`, so the incremental walk finds NEW
operations and is blind to REVISED ones — and a programme re-import rewrites
existing rows in place. That is exactly what the watcher detects, so a report
naming a re-imported programme means `--full`, not the default.

**Never build the stage from one programme.** `ingest.ts`'s `--programme` is a
debugging filter that refuses to write, and the loader has no such flag at all:
`stageDeleteSql` is an unscoped anti-join, so a partial stage deletes every other
programme's operations, `ON DELETE CASCADE` takes their partners, and the
row-count parity guard passes.

### Publishing to prod, in this order

```bash
npm run db:load:interreg:pg:cloud          # the corpus
npm run db:load:graph:pg:cloud             # company_public_money's 4th arm reads it
npm run db:load:tr-company-place:pg:cloud  # its money_eur is denormalized from that
```

The last two are the non-obvious half. `company_public_money` (127) gained an
Interreg arm, and the graph loader is its only applier and refresher — so
without step 2 the new corpus contributes nothing to any money figure. Step 3
follows because `tr_company_place.money_eur` is a denormalized copy of 127, and
it ranks the governance "фирми, регистрирани тук" tile.

**Attribution is required, not courtesy.** keep.eu's terms oblige crediting
keep.eu with a link, and every Interreg surface carries it. Do not remove it.

**Scope of what an EIK can answer: Tier L only.** keep.eu publishes a partner's
national id in the 2021-2027 template alone — 0 of 1,080 Bulgarian 2014-2020
rows carry one, against 336 of 413 — so `/company/:eik` and
`company_public_money` reach about a quarter of the €396m corpus and are blind
to the rest BY SOURCE. Place attribution has no such ceiling (98.4% placed), so
the per-capita ranking and the place tiles cover both periods.

### New / modified contract detection (runs inside `funds:ingest-projects`)

`scripts/funds/projects_ingest.ts` calls `scripts/funds/projects_diff.ts` automatically (step 7c). ИСУН carries **no** native new-vs-amendment field — one `status` per contract — so the only way to surface a "new project" / "value or status changed" signal is to diff successive ingests on the stable `contractNumber`. The diff:

- loads the prior snapshot from `state/funds/projects_snapshot.json` (per-machine host state, **gitignored**, ~80k entries, fully rebuildable);
- emits per-município `data/funds/projects/changes/<obshtina>.json` + a national `changes/index.json` (committed — small, capped at 50/obshtina);
- writes the new snapshot.

The `changes/` directory is **reset each run**, so each file reflects only the most-recent ingest's diff (the "what changed in the last update" the My-Area alert feed renders). **First run seeds the snapshot silently** (no prior baseline ⇒ no changes emitted, else all ~80k contracts read as "new"). These change files feed `scripts/myarea/build_alerts.ts` (EU "Нов проект" / "Промяна" events) and the AI `placeEuProjects` tool. Commit `data/funds/projects/changes/` alongside the rest of `data/funds/`.

> **Two-ingest warm-up:** the feature is *visibly silent* until the **second** post-baseline ingest. The first run only seeds `state/funds/projects_snapshot.json`, so `changes/` stays empty, no EU "Нов проект"/"Промяна" events appear in the alert feed, and `placeEuProjects`'s new/modified counts read zero. The first run that has a prior snapshot to diff against is the first one that emits changes.

## Step 4 — Commit + publish to Postgres (Cloud SQL, not the bucket)

The whole `/funds` surface is served from **Cloud SQL** (`/api/db/fund-*`), so
publishing means reloading the DB tables from the fresh on-disk shards — NOT an
rsync to GCS.

```bash
# 1) Commit the committed globals (bulky shards are gitignored — see below)
git add data/funds/
git commit -m "funds: refresh ИСУН EU-funds beneficiaries + projects"

# 2) Reload LOCAL Postgres from the fresh shards
npm run db:load:funds:pg          # fund_beneficiaries + fund_projects + fund_payloads
npm run db:load:funds-fit:pg      # 143+144+145 — keep local in step with prod, or
                                  # funds_fit.data.test.ts fails with "the rollup and
                                  # the corpus disagree", which reads as a derivation bug

# 3) Publish to PROD Cloud SQL (operator runs this — proxy on 127.0.0.1:5434, .pgpass set)
npm run db:load:funds:pg:cloud -- --full   # the flag is REQUIRED — see the scope note
npm run db:load:funds-fit:pg:cloud         # sole applier of 143 + 144 + 145 — see below
```

> ⚠️ **`db:load:funds:pg:cloud` REFUSES without a scope flag — pick one deliberately.**
> It exits 1 in 0 s with "Refusing to guess the scope of a Cloud SQL load", writing
> nothing, so an automated chain HALTS here. The rule:
>
> - **`--full`** — after an ИСУН re-ingest, i.e. whenever `fund_beneficiaries` or
>   `fund_projects` actually moved. ~4.5 min, during which `/api/db/fund-contract`
>   and `/api/db/fund-beneficiary` return 500.
> - **`--payloads-only`** — when only the precomputed page payloads changed.
>   Stage-merged, seconds, never blocks a reader.
>
> Getting it backwards is not symmetric: `--payloads-only` after a re-ingest
> publishes the new page payloads over an unchanged beneficiary table, which
> reconciles perfectly while under-reporting the money. `db:load:funds:pg:cloud` is
> one of the 7 scripts that forward argv, so `-- --full` does reach the loader.
> (Measured 2026-08-21: the flagless form halted a deploy chain at this step —
> `docs/plans/cloud-deploy-speed-v1.md` F34, recurred as F53.)

> ⚠️ **`db:load:funds-fit:pg:cloud` is not optional.** It is the ONLY applier of
> migrations 143 (`fund_fit`, the „финансирано ли е нещо като моето" resolver),
> 144 (`funds_wire` / `funds_news`, the band-0 wire and band-2 news rail) and 145
> (`funds_hub_stats_cache`, every figure on the `/funds` hub). A funds reload
> without it leaves all three serving the previous vintage at a 200 — and a change
> to a 144 function body otherwise reaches prod only via the targeted hatch
> `apply_functions.ts 144_funds_wire.sql` — which is the right tool when ONLY a
> function body changed, since it avoids 145's DROP+CREATE of the live hub cache.

> **Deployment (READ THIS before syncing):** funds is served from **Cloud SQL**
> (Firebase fn `/api/db/*`), **not GCS** — same architecture as procurement.
> `bucket:sync` **excludes** all of `funds/` (the `^funds/.*` term in the `-x`
> regex in package.json), and `bucket_gzip.ts` ships **no** funds file. The
> ingest's JSON is the **local PG-load source** `db:load:funds:pg` reads: every
> precomputed page payload (index, projects-index, muni-map, taxonomy,
> absorption, sankey, integrity + per-programme, mp_connected + per-mp/by-eik,
> political_links + per-eik, confirmed, rrf_context, themes + per-slug, per-place
> + per-programme summaries, geo pins) is loaded verbatim into the
> `fund_payloads(kind, key)` table; per-beneficiary rollups → `fund_beneficiaries`,
> per-contract detail → `fund_projects`. So the prod-deploy path for funds is
> **`db:load:funds:pg:cloud -- --full`** (scope flag required — see above), NOT
> `bucket:sync`. The small curated globals
> (`index.json`, `derived/political_links.json`, `derived/integrity.json`,
> `rrf_context.json`, `themes.json`, …) stay **committed** because the deploy
> build (prerender + sitemap) reads them from the git tree — they are load
> sources, not bucket-served. Verify parity after any loader/serving change:
> `npx tsx scripts/db/gen_funds/parity.ts --full` (asserts PG payloads ==
> on-disk JSON). **Cloud SQL is production — never auto-run
> `db:load:funds:pg:cloud` unprompted; emit it for the operator.**

## Why a full export (no incremental path)

The eufunds.bg report is an **all-time rollup per organisation**, not a feed
of dated contract events. A date-filtered export returns period-scoped totals
that would corrupt the all-time figures if merged. So the canonical refresh is
always a full re-export — it's only ~2.5 MB and the ingest rebuilds the whole
tree idempotently. The `MIN_ROWS` floor (40,000) deliberately **rejects** a
small date-filtered export from overwriting `data/funds/`. A date-filtered
slice is fine to inspect with `--file ... --dry-run`, but never write one as
canonical.

## Political-economy join layer

After the MP cross-reference runs (Step 1 above), the ingest folds in two more
sources into a single derived shard set keyed by beneficiary EIK:

- `company_politicians` at `kind='official'` (Postgres — built by `db:load:tr:pg`
  from the gated person layer, read through `readOfficialLinkRows()` in
  `scripts/lib/mp_linkage.ts`) — non-MP officials with declared stakes or TR
  roles: cabinet, deputy ministers, state-agency heads, regional governors,
  mayors, deputy mayors, council chairs, councillors, chief architects.
  **[2026-08-21]** this was `data/officials/derived/company_links.json` (from
  `/update-officials`), of which only the **high-confidence** slice was used —
  declarations and `namesakeCount == 1` TR roles. That file and its builder are
  deleted (`docs/plans/company-page-consolidation-v1.md`, Tier 6): a name the
  Commerce Registry says belongs to more than one human is now REFUSED by the
  `tr_name_fold_people` fold (148) rather than graded, so there is no confidence
  slice left to take. ⚠️ **The staleness trigger moved with it — `db:load:tr:pg`
  (which needs a resolved person layer), not an `/update-officials` run.**
  This is the OFFICIALS leg only; the MP arm above stays on the link set's
  **unrestricted** scope, because `company_politicians` is contract-restricted
  and this payload's join population is ИСУН beneficiaries, not contractors.
- `data/officials/index.json` **and** `data/officials/municipal/index.json` —
  slug → role / category / tier resolution. **Both**, since 2026-08-21: the first is
  the EXECUTIVE index and resolves 0 of the 116 municipal officials, so on its own
  every councillor lost their `municipality`.
- `data/procurement/derived/top_contractors.json` + per-EIK
  `data/procurement/contractors/{eik}.json` (from `/update-procurement`) — the
  АОП award overlap per flagged EIK.
- `data/procurement/debarred.json` — name-matched debarred-suppliers flag.

Outputs:

| Path | Shape | Size |
|---|---|---|
| `data/funds/derived/political_links.json` | `{ totals, top: top-50, flaggedEiks: [...] }` | ~50 KB committed |
| `data/funds/derived/political-by-eik/{eik}.json` | One PoliticalEntry per flagged EIK | 1–4 KB × ~286 files committed |
| `data/funds/derived/political-by-eik/index.json` | Manifest of flagged EIKs | ~5 KB committed |

The build runs as part of `funds:ingest` (Step 1 — no separate command). For
dev iteration on just this step, run it standalone:

```bash
npx tsx scripts/funds/political_links.ts
```

No new external fetch — purely a join over already-ingested data. Re-run after
`/update-officials` or `/update-procurement` flips, even when ИСУН itself
hasn't moved.

## MP cross-reference

The ingest joins every beneficiary's EIK against the **gated MP↔company link set**
(`scripts/lib/mp_linkage.ts`) and writes `data/funds/derived/mp_connected.json` — one entry
per (MP, beneficiary) pair: the declared relations (a management role or an ownership stake)
plus that beneficiary's contracts / contracted / paid totals. `index.json` also gains a
`crossReference` summary and an `mpTied` flag on the top-beneficiary lists.

The join key is the 9-digit canonical EIK on both sides. Beneficiary rows that share an
EIK — a parent organisation and its sub-units (райони, териториални поделения, клонове),
which the register lists separately — are aggregated before the join, so a connected
beneficiary is counted once with summed totals.

**[2026-08-20] The source is the gated person layer, not `companies-index.json`.** That
file is deleted; its registry arm attached a company UIC to an MP on a NAME match with no
people-per-name guard, so the EIK-keyed join then published the result as a fact about EU
money. The gate is now migration 148's `tr_name_fold_people` fold — a name the Commerce
Registry says belongs to more than one human is **refused**, not graded — unioned with
096's confirmed declared stakes. Editorial guardrail unchanged and now actually true: a
connection is flagged **only** when it is recorded in the Commerce Registry or in a
Court-of-Audit declaration. Plan: `docs/plans/company-page-consolidation-v1.md` (Tier 5.1).

⚠️ **THE SCOPE IS `all`, AND IT MUST NOT BECOME `contractors`.** `company_politicians` is
contract-restricted — its loader inner-joins procurement money, so every row is a politically
linked *contractor*. This join's population is ИСУН beneficiaries, where an MP-linked company
that took EU money and never won a public contract is the whole point. Measured 2026-08-20:
the restricted set answers **43 of this payload's 303 pairs**.

**Absent vs empty are different answers, and only one is a skip.** The ingest probes
`company_politicians` for reachability: **absent** (no Postgres, never loaded) is a fresh
clone, so the raw beneficiary data still lands and only the MP-tied payload is skipped with a
logged hint. A link set that **exists and yields no MP rows** is a broken load and is
**refused** — the old `tr.uic`-coverage hard-fail, one layer over. Rewriting
`mp_connected.json` empty would publish "no MP is linked to any beneficiary" at exit 0.

**Ordering dependency.** The link set is derived in Postgres, so it is `/update-persons` —
not a file from `/update-connections` — that makes a declaration or registry change visible
here. `/update-connections` refreshes the declarations and the TR snapshot; `db:resolve:persons`
plus `db:load:declarations:pg -- --resolve` fold them into `person_role` /
`declaration_stake_company`; only then does this join see them. The watcher source list
already places `cacbg_declarations` and `egov_commerce` before `isun_eu_funds`, so the natural
source-order traversal keeps the chain in that order.

## Data-integrity contract

Fails loud rather than write partial / corrupt data. Surfaces that halt before any write:

| Surface | Trigger | Action |
|---|---|---|
| HTTP error on eufunds.bg | non-200 on the export download | Throws |
| Header row not found | The 7 expected column headers don't match — export schema drift | Throws — investigate `parse.ts` |
| Row-count floor | Fewer than 40,000 beneficiary rows parsed (truncated / filtered download) | Throws |
| Non-finite amount | A contracted/paid value is NaN or Infinity | Throws naming the beneficiary |
| Negative / fractional count | `contractCount` is negative or not an integer | Throws naming the beneficiary |

Surfaces that are **intentionally non-fatal**:

| Surface | Behaviour | Why not a hard fail |
|---|---|---|
| Negative EUR rollup | Listed as a warning, kept as-is | Net clawbacks and cent-level reconciliation residue are legitimate in an upstream rollup |
| 10-digit leading token | `eik` set to `null`, token still stripped from the name | Can't tell legacy BULSTAT from a personal ЕГН — not persisted, avoids storing PII |
| Beneficiary with no EIK | `eik: null`, row still ingested | ~13% of rows (individuals, some public bodies); they just won't cross-reference |

## What this skill does NOT do

- **Does not write frontend UI.** The `/funds` dashboard is a later phase; it consumes `data/funds/` via React Query once that screen exists.
- **Does not auto-fire.** The watcher reports when the register moves; the orchestrator or the user decides when to run.
- **Does not ingest project-level detail.** The "Бенефициенти" report is organisation-grain. Per-project / per-programme breakdowns would need a different ИСУН report.

## File map

| Path | Purpose |
|---|---|
| `scripts/funds/ingest.ts` | CLI entry — fetch, parse, validate, write `data/funds/` |
| `scripts/funds/fetch.ts` | XLSX export download (always fresh) + snapshot writer |
| `scripts/funds/parse.ts` | XLSX → `FundsBeneficiary[]` (header-schema guard, EIK extraction) |
| `scripts/funds/cross_reference.ts` | EIK-keyed join against the gated MP↔company link set → `mp_connected.json`. `buildEikLinkageMap()` is **async and takes no arguments** |
| `scripts/lib/mp_linkage.ts` | The ONE reader of that link set, shared with `scripts/procurement/cross_reference.ts`. Owns the query, the absent-vs-empty availability probe and the mpId parse. ⚠️ This side passes scope `all`; the procurement side passes `contractors` |
| `scripts/funds/political_links.ts` | Political-economy join: MP + officials + АОП overlap + debarred → `political_links.json` + per-EIK shards |
| `scripts/funds/taxonomy.ts` | Programme-code → period + fund-family inference (CCI pattern). Used by both ingest scripts. |
| `scripts/funds/build_taxonomy_derivatives.ts` | Builds `data/funds/taxonomy.json`, `derived/absorption.json`, `derived/sankey.json` from the projects ingest. Runs at the end of `funds:ingest-projects`. |
| `scripts/funds/integrity.ts` | Builds `derived/integrity.json` (slim leaderboard) + per-programme shards (HHI, serial winners, debarred matches). Runs at the end of `funds:ingest-projects`. |
| `scripts/funds/themes.ts` | Builds `derived/themes/{slug}.json` editorial-focus shards from the `data/funds/themes.json` definition file. Runs at the end of `funds:ingest-projects`. |
| `scripts/funds/eik.ts` | EIK/BULSTAT canonicalization (9-digit) |
| `scripts/funds/types.ts` | Shared type definitions |
| `scripts/watch/sources/isun_eu_funds.ts` | Watcher source — fingerprints the export corpus shape |
| `data/funds/index.json` | Totals, by-org-type / by-org-form breakdowns, top beneficiaries, `crossReference` summary — committed |
| `data/funds/beneficiaries/<0-9>.json`, `_x.json` | Beneficiary rows sharded by EIK last digit — committed |
| `data/funds/beneficiaries-by-eik/<EIK>.json` | One small file per beneficiary for O(1) `/company/{EIK}` lookup — bulky (~46k files), **gitignored local PG-load source** → `fund_beneficiaries` (served via `/api/db/fund-beneficiary`) |
| `data/funds/derived/mp_connected.json` | One entry per (MP, beneficiary) pair — the MP-tied journalism payload — committed; PG-load source → `fund_payloads('mp-connected')`. The **aggregate fallback** only; the candidate page reads the per-MP shard below first. |
| `data/funds/derived/per-mp/<mpId>.json` + `per-mp/index.json`; `by-eik/<EIK>.json` + `index.json` | **Data-diet shards + manifest** the `/candidate/:id` EU-funds tile and `/company/:eik` read. Regenerated **every** ingest by `cross_reference.ts` (write-if-changed). **Gitignored PG-load sources** → `fund_payloads('per-mp'/'per-mp-index'/'by-eik'/'by-eik-index')`, served via `/api/db` — NOT bucket-synced. See "Per-MP shard invariant" in process-watch-report. |
| `data/funds/derived/political_links.json` | Slim leaderboard of politically-tied beneficiaries (MP + non-MP officials + АОП overlap + debarred) — committed; PG-load source → `fund_payloads('political-links')` |
| `data/funds/derived/political-by-eik/{EIK}.json` | Per-EIK political-economy shard for the `/company` panel — **gitignored PG-load source** → `fund_payloads('political-by-eik')` |
| `data/funds/taxonomy.json` | Per-programme period + fund-family lookup (~10 KB) — committed; PG-load source → `fund_payloads('taxonomy')` |
| `data/funds/derived/absorption.json` | Per-period / per-fund-type / per-programme absorption% rollup (~10 KB) — committed; PG-load source → `fund_payloads('absorption')` |
| `data/funds/derived/sankey.json` | Precomputed Fund → top-OP Sankey for the `/funds` tile (~5 KB) — committed; PG-load source → `fund_payloads('sankey')` |
| `data/funds/derived/integrity.json` | Slim concentration / serial-winner / debarred leaderboard (~50 KB) — committed; PG-load source → `fund_payloads('integrity')` |
| `data/funds/derived/integrity-by-program/{code}.json` | Per-programme HHI + top-10 beneficiaries + debarred matches (~3-5 KB) — **gitignored PG-load source** → `fund_payloads('integrity-program')` |
| `data/funds/themes.json` | Editorial focus-theme definitions (slug, label, keywords, programme codes, investigative cards) — hand-maintained, **committed** (also read at build by prerender + sitemap) |
| `data/funds/derived/themes/{slug}.json` | Per-theme derived shard (totals, top beneficiaries, top contracts, top munis, programmes, sources) — **gitignored PG-load source** → `fund_payloads('theme')` |
| `data/funds/derived/themes/index.json` | Slim themes index for the `/funds` tile and `/funds/focus/{slug}` router — **gitignored PG-load source** → `fund_payloads('themes-index')` |
| `data/_cache/funds/beneficiaries.xlsx` | Snapshot of the last downloaded export — gitignored |

## Quick command reference

```bash
# Daily ingest after the watcher flags the source
npm run funds:ingest

# Ingest + commit + publish to Postgres (funds is Cloud SQL-served, not GCS)
npm run funds:ingest
git add data/funds/
git commit -m "funds: refresh ИСУН EU-funds beneficiaries"
npm run db:load:funds:pg          # local PG
npm run db:load:funds-fit:pg      # local — 143+144+145
npm run db:load:funds:pg:cloud -- --full   # prod Cloud SQL (operator runs this).
                                           # --full after an ИСУН re-ingest; --payloads-only
                                           # when only payloads moved; it REFUSES with neither.
npm run db:load:funds-fit:pg:cloud

# Dry run (parse + validate, no writes)
npm run funds:ingest -- --dry-run
```
