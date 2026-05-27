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
| `/update-connections` refreshed `companies-index.json` | Re-run — the ingest re-joins the MP cross-reference automatically |
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
when `data/parliament/companies-index.json` is present, cross-references the
beneficiaries against the MP-companies graph into `derived/mp_connected.json`.

Expected output on a normal run:

```
→ fetching https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel
  2.4 MB
  parsed 52779 beneficiary row(s)
  ⚠ 4 beneficiary row(s) with a negative EUR rollup (net clawback / rounding residue — kept as-is):
      ...
→ wrote 11 beneficiary shard(s)
→ wrote 45887 per-EIK beneficiary file(s)
→ cross-referencing beneficiaries against the MP-companies graph
  EIK linkage map: 938 EIK(s) from 938/1110 TR-enriched companies
  100 MP↔beneficiary pair(s) → derived/mp_connected.json (86 MP(s), 98 company(ies), €168,527,162 contracted)
✓ index.json written
  52779 beneficiaries · 80705 contracts · €43,500,972,226 contracted · €16,494,577,249 paid · 45887 with EIK (86.9%)
```

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

- **Per-place summaries** — `by-ekatte/{ekatte}-summary.json` and `by-muni/{обshtina}-summary.json` (~3-5 KB each), carrying rollup + top-3 contracts + top-3 programmes + per-capita €. Backs the `EuFundsTile` on settlement and муни dashboards (avoids loading the full 18 MB Sofia shard for the tile).
- **Choropleth map data** — `muni-map.json` (~65 KB) with one denormalised row per муни. Backs the `FundsMuniMapTile` on `/funds`. Includes a synthetic `SOF00` row aggregating S22 + S23xx/S24xx/S25xx so the Sofia districts on the map render as a single Стoлична value.

Per-capita uses **Census 2021** population (`data/census_2021_settlements.json`) — not ГРАО — because the census carries the Sofia city EKATTE (68134 = 1.18M) which ГРАО does not. Re-run this step after `update-census` if NSI ever re-releases the corpus.

Flags mirror Step 1 — `--dry-run`, `--file PATH`.

## Step 4 — Commit + deploy

```bash
git add data/funds/
git commit -m "funds: refresh ИСУН EU-funds beneficiaries + projects"
npm run bucket:sync       # push data/ to gs://data-electionsbg-com
```

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

- `data/officials/derived/company_links.json` (from `/update-officials`) —
  non-MP officials with declared stakes or TR roles: cabinet, deputy ministers,
  state-agency heads, regional governors, mayors, deputy mayors, council chairs,
  councillors, chief architects. Only the **high-confidence** slice is used —
  declarations and `namesakeCount == 1` TR roles.
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

When `data/parliament/companies-index.json` is present, the ingest joins every
beneficiary's EIK against the MP-companies graph (built by `/update-connections`
from Court-of-Audit declarations + Commerce Registry filings) and writes
`data/funds/derived/mp_connected.json` — one entry per (MP, beneficiary) pair:
the declared relations (a management role or an ownership stake) plus that
beneficiary's contracts / contracted / paid totals. `index.json` also gains a
`crossReference` summary and an `mpTied` flag on the top-beneficiary lists.

The join key is the 9-digit canonical EIK (`companies[].tr.uic` on the
companies side). Beneficiary rows that share an EIK — a parent organisation
and its sub-units (райони, териториални поделения, клонове), which the register
lists separately — are aggregated before the join, so a connected beneficiary
is counted once with summed totals. Editorial guardrail: a connection is
flagged **only** when it is recorded in the official declarations or the
Commerce Registry — no name-match guessing. The cross-reference **hard-fails** if `companies-index.json`
is present but TR-enrichment is missing on >90% of entries (the silent
"`/update-connections` TR refresh wasn't run" failure mode).

If `companies-index.json` is absent (fresh clone before `/update-connections`),
the ingest still completes — the raw beneficiary data lands; only the MP-tied
payload is skipped, with a logged hint.

**Ordering dependency.** When the orchestrator queues both `/update-connections`
and `/update-funds`, `/update-connections` must run first — it produces
`companies-index.json`. The watcher source list already places
`cacbg_declarations` and `egov_commerce` (→ `update-connections`) before
`isun_eu_funds`, so the natural source-order traversal handles this.

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
| `scripts/funds/cross_reference.ts` | EIK-keyed join against `companies-index.json` → `mp_connected.json` |
| `scripts/funds/political_links.ts` | Political-economy join: MP + officials + АОП overlap + debarred → `political_links.json` + per-EIK shards |
| `scripts/funds/taxonomy.ts` | Programme-code → period + fund-family inference (CCI pattern). Used by both ingest scripts. |
| `scripts/funds/build_taxonomy_derivatives.ts` | Builds `data/funds/taxonomy.json`, `derived/absorption.json`, `derived/sankey.json` from the projects ingest. Runs at the end of `funds:ingest-projects`. |
| `scripts/funds/integrity.ts` | Builds `derived/integrity.json` (slim leaderboard) + per-programme shards (HHI, serial winners, debarred matches). Runs at the end of `funds:ingest-projects`. |
| `scripts/funds/eik.ts` | EIK/BULSTAT canonicalization (9-digit) |
| `scripts/funds/types.ts` | Shared type definitions |
| `scripts/watch/sources/isun_eu_funds.ts` | Watcher source — fingerprints the export corpus shape |
| `data/funds/index.json` | Totals, by-org-type / by-org-form breakdowns, top beneficiaries, `crossReference` summary — committed |
| `data/funds/beneficiaries/<0-9>.json`, `_x.json` | Beneficiary rows sharded by EIK last digit — committed |
| `data/funds/beneficiaries-by-eik/<EIK>.json` | One small file per beneficiary for O(1) `/company/{EIK}` lookup — bulky (~46k files), uploaded to the bucket, gitignored |
| `data/funds/derived/mp_connected.json` | One entry per (MP, beneficiary) pair — the MP-tied journalism payload — committed |
| `data/funds/derived/political_links.json` | Slim leaderboard of politically-tied beneficiaries (MP + non-MP officials + АОП overlap + debarred) — committed |
| `data/funds/derived/political-by-eik/{EIK}.json` | Per-EIK political-economy shard for the `/company` panel — committed |
| `data/funds/taxonomy.json` | Per-programme period + fund-family lookup (~10 KB) — committed |
| `data/funds/derived/absorption.json` | Per-period / per-fund-type / per-programme absorption% rollup (~10 KB) — committed |
| `data/funds/derived/sankey.json` | Precomputed Fund → top-OP Sankey for the `/funds` tile (~5 KB) — committed |
| `data/funds/derived/integrity.json` | Slim concentration / serial-winner / debarred leaderboard (~50 KB) — committed |
| `data/funds/derived/integrity-by-program/{code}.json` | Per-programme HHI + top-10 beneficiaries + debarred matches (~3-5 KB) — committed |
| `data/_cache/funds/beneficiaries.xlsx` | Snapshot of the last downloaded export — gitignored |

## Quick command reference

```bash
# Daily ingest after the watcher flags the source
npm run funds:ingest

# Ingest + commit + deploy
npm run funds:ingest
git add data/funds/
git commit -m "funds: refresh ИСУН EU-funds beneficiaries"
npm run bucket:sync

# Dry run (parse + validate, no writes)
npm run funds:ingest -- --dry-run
```
