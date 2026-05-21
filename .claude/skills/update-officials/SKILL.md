---
name: update-officials
description: Refresh the non-MP officials declarations data — pulls property/interest declarations from register.cacbg.bg (Сметна палата) for cabinet members, deputy ministers, state-agency heads, regional governors, and the municipal tier (mayors, deputy-mayors, council chairs, councillors, chief architects). Use when the daily watch report flags "Сметна палата declarations — executive (officials)" or "Сметна палата declarations — municipal (mayors & councillors)" as changed, when the user asks to refresh officials data, when adding a new declaration year (e.g. 2026 filings appear in spring), or after a fresh git clone if `data/officials/assets-rankings.json` or `data/officials/municipal/index.json` is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Officials skill

Scrapes `register.cacbg.bg/{year}/list.xml` for non-MP categories (cabinet, deputy ministers, state-agency heads, regional governors) and writes per-official declaration JSON to `data/officials/declarations/{slug}.json`, plus the `index.json` and `assets-rankings.json` rollups consumed by the `/officials/assets` page, `/officials/{slug}` profile pages, and the dashboard `OfficialsAssetsTile`.

The municipal tier (mayors, deputy-mayors, municipal-council chairs, councillors and chief architects — ~6,400/year) lives in the same register and is ingested by a separate script, `scripts/officials/municipal.ts`, into its own scope under `data/officials/municipal/` (per-official declarations + a roster `index.json`). It is kept separate because the volume is ~15× the executive set and the declarations carry no party affiliation — there is no `/officials/assets`-style ranking page for it; the output is staged for the cross-MP connections graph. The judiciary (ВКС/ВАС/прокурори/съдии) lives in the same register but remains out of scope.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `Сметна палата declarations — executive (officials): N declarations in scope` changed | Re-run the executive ingest for the current year (`npx tsx scripts/officials/index.ts`) |
| Daily watcher reports `Сметна палата declarations — municipal (mayors & councillors): N declarations in scope` changed | Re-run the municipal ingest (`npx tsx scripts/officials/municipal.ts`) |
| User asks to "refresh officials" / "update cabinet declarations" | Run the executive ingest; run the municipal ingest too if the municipal watcher also flipped |
| `data/officials/assets-rankings.json` missing (fresh clone) | Cold-start executive ingest |
| `data/officials/municipal/index.json` missing (fresh clone) | Cold-start municipal ingest (Step 1b — ~30–50 min) |
| Adding a new year of filings | Re-run the relevant ingest with `--year <YYYY>` after the upstream publishes that year's list.xml |

## Step 1 — Ingest

```bash
npx tsx scripts/officials/index.ts
```

Default year is 2025. The script:

1. Fetches `register.cacbg.bg/2025/list.xml` (the master directory for that filing year).
2. Filters Category nodes to executive substrings: "Министър-председател", "министри и заместник-министри", "Областни управители", "държавни агенции", "изпълнителните агенции".
3. For each matched declaration: fetches the per-person XML (cached under `raw_data/officials/` — gitignored), parses with the shared `scripts/declarations/parse_declaration` parser, and writes one JSON per slug.
4. Builds `index.json` (one row per official with role + institution) and `assets-rankings.json` (sorted by netWorthEur, with byCategory slices).

Expected output on a normal run (incremental, after a couple of new filings):

```
→ officials: fetching 2025 list…
  548 declaration(s) across cabinet/agencies/governors
  processed 548 declaration(s) for 437 unique official(s)
  wrote 437 per-official file(s) to data/officials/declarations
  wrote index.json (437 official(s))
  wrote assets-rankings.json (top: Евтим Милошев €4.1M, Росен Карадимов €1.5M, …)
```

A few 2025 declarations carry an obviously mistyped acquisition price (a
decimal comma dropped at source, inflating an apartment ~100×). The shared
parser auto-corrects these: `correctRealEstateSeparatorTypo` in
`scripts/declarations/parse_declaration.ts` divides a built property back
down whenever its raw price-per-m² is impossibly high — each correction
prints a `[parse] auto-corrected real-estate value …` line in the run log.
Rare /1000 typos it deliberately leaves alone sit in the adjacent
`REAL_ESTATE_VALUE_OVERRIDES` table. If the ranking still looks wrong, run
the suspicious-value scan (Step 2).

The same parser also `/1000`-corrects implausibly priced 20-year-plus
vehicles (`correctOldVehicleSeparatorTypo`) and drops byte-identical
duplicate building rows within a declaration (`dedupeRealEstateRows`) —
both print `[parse] …` lines in the run log. Land parcels are never
de-duplicated: restitution leaves owners holding many genuinely-equal
fragmented plots.

Cold start takes ~90 seconds (network-bound on per-declaration fetches — 150 ms politeness sleep between requests). Re-runs are faster because raw XMLs are cached under `raw_data/officials/`.

## Step 1b — Municipal tier

```bash
npx tsx scripts/officials/municipal.ts
```

Separate ingest for the local-government tier. The script:

1. Fetches the same `register.cacbg.bg/{year}/list.xml`.
2. Filters Category nodes to the `Кметове…` family (mayors, deputy-mayors, council chairs, municipal councillors, chief architects).
3. Maps each declarant's `Position/Name` role label to a role bucket, fetches + parses the per-person XML (same shared parser and `raw_data/officials/` cache as the executive ingest), and writes one JSON per slug under `data/officials/municipal/declarations/`.
4. Builds `data/officials/municipal/index.json` — a roster with `byRole` counts and one entry per official (slug, name, role, municipality).

Expected output:

```
→ municipal: fetching 2025 list…
  6521 declaration(s) in the municipal tier
  processed 6521 declaration(s) for ~6400 unique official(s)
  wrote ~6400 per-official file(s) to data/officials/municipal/declarations
  wrote index.json (~6400 official(s): ~290 mayors, ~700 dep. mayors, ~260 chairs, ~4800 councillors, ~310 architects, 0 other)
```

Cold start takes ~30–50 minutes (~6,500 per-declaration fetches at a 150 ms politeness sleep). Re-runs are far faster — raw XMLs are cached. Sanity: `byRole.councillor` should dominate (~75%), `byRole.mayor` ≈ 290, `byRole.other` should be 0 (a non-zero `other` count means an unmapped role label — inspect `mapRole` in `scripts/officials/municipal.ts`).

## Step 1c — Company cross-reference + connections

```bash
npx tsx scripts/run-officials-links-only.ts        # company_links.json
npx tsx scripts/run-officials-connections-only.ts  # connections.json
```

The first builder joins every executive + municipal official to companies — via their own declared ownership stakes and via a Commerce Registry (TR) officer/owner name match against `raw_data/tr/state.sqlite` — and writes `data/officials/derived/company_links.json`. Each link carries a `confidence` flag: a TR match on a name shared by two or more officials is flagged `low` — Bulgarian namesakes are common, so the match is ambiguous. Expect ~5,000+ links with a substantial low-confidence share; a zero TR-link count means the SQLite is missing (run `/update-connections` first to build it).

The second builder joins `company_links.json` against the MP companies-index (`data/parliament/companies-index.json`) to write `data/officials/derived/connections.json` — per official, which MPs and which other officials they share a company with. Edges where the official and the MP/peer have the identical normalised name are dropped: that is the same person (an official who is also an MP) or pure namesake noise, not a connection.

Re-run both after Step 1 / Step 1b so the artifacts reflect the fresh roster. Both also run automatically at the tail of the main declarations pipeline (`scripts/declarations/index.ts`).

## Step 2 — Verify

```bash
node -e "
const r = require('./data/officials/assets-rankings.json');
console.log('total:', r.total, '/ years:', r.years.join(','));
console.log('by category:');
for (const k of Object.keys(r.byCategory)) {
  console.log('  ', k, r.byCategory[k].length);
}
console.log('top 3:', r.topOfficials.slice(0,3).map(o => o.name + ' €' + Math.round(o.netWorthEur).toLocaleString()).join(', '));
"
```

Sanity:
- `total` ≥ 400 for 2025 (expect ~437; sharp drop signals a category-filter regression).
- `byCategory.cabinet` ≥ 80 (ministers + deputies).
- `byCategory.regional_governor` ≈ 60 (28 oblasts × deputies).
- Top-3 net worths within an order of magnitude of last run.

Scan for mistyped declared values (officials + MPs + municipal, one shared
report):

```bash
npx tsx scripts/declarations/check_suspicious_values.ts
```

A new `FLAG` line for an executive official means a likely separator typo is
inflating the ranking — add a narrow entry to `REAL_ESTATE_VALUE_OVERRIDES`
(or `VEHICLE_VALUE_OVERRIDES`) in `scripts/declarations/parse_declaration.ts`,
then re-run Step 1. Genuinely large holdings keep flagging — that is expected.

Check the diff:

```bash
git diff --stat data/officials/
```

A typical refresh touches `assets-rankings.json` + `index.json` plus a handful of `declarations/{slug}.json` files. Cold-start adds ~437 new files at ~5-25 KB each.

## Step 3 — Upload to bucket

```bash
gsutil -m -h "Cache-Control:no-cache, max-age=0" rsync -r -J \
  data/officials/ gs://data-electionsbg-com/officials/
```

Or use the project-wide rsync:

```bash
npm run bucket:sync
```

## Step 4 — Commit

```bash
git add data/officials/
git commit -m "officials: refresh declarations for FY <year>"
```

## CLI flags

```bash
# Single year (default 2025)
npx tsx scripts/officials/index.ts --year 2024

# Cap declarations processed (debug)
npx tsx scripts/officials/index.ts --limit 30

# Substring filter on declarant name (debug — match a single person)
npx tsx scripts/officials/index.ts --name "Желязков"

# Parse-only, no writes
npx tsx scripts/officials/index.ts --dry-run
```

`scripts/officials/municipal.ts` (Step 1b) accepts the identical `--year` / `--limit` / `--name` / `--dry-run` flags.

## Backfill earlier years

The upstream registry publishes year-keyed directories back to 2015 (see `register.cacbg.bg/`). To add an earlier year:

```bash
npx tsx scripts/officials/index.ts --year 2024
npx tsx scripts/officials/index.ts --year 2023
# etc.
```

The script writes one declaration per (slug, year) into the same per-slug file (newest first), so backfilling does not overwrite the current year. `assets-rankings.json` always rolls up from the *latest* year on file per slug.

## Data-integrity contract

Fails loud rather than write partial data:

| Surface | Trigger | Action |
|---|---|---|
| HTTP non-200 on list.xml | Upstream registry down or year doesn't exist | Throws |
| Per-declaration fetch fails | Network error fetching one official's XML | Throws (no partial writes) |
| Zero declarations match the category filter | Upstream renamed categories or shifted XML schema | Throws — investigate `CATEGORY_MAP` in `scripts/officials/index.ts` |
| `assets-rankings.json` total drops > 20% | Likely a regression in category filtering | Inspect diff; do NOT commit until cause is identified |
| Zero entries in the `Кметове…` category | Upstream renamed the municipal category | `municipal.ts` throws |
| > 2% (or > 20) of municipal declarations fail to parse | Upstream schema drift, not isolated bad records | `municipal.ts` throws; failures below that bar are skipped + logged, not fatal |

## What this skill does NOT do

- Does NOT build any UI for the municipal tier. `municipal.ts` writes data only (`data/officials/municipal/`), staged for the connections graph — there is no `/officials/assets`-style screen or ranking for mayors / councillors.
- Does NOT scrape the judiciary (ВКС/ВАС/прокурори/съдии). Same register, different editorial scope.
- Does NOT cross-reference officials to MP-connected companies. That join lives in `data/procurement/derived/mp_connected.json` and is keyed on MP ids, not official slugs. A follow-up could add an "officials connected contractors" rollup if/when the editorial use case justifies it.
- Does NOT update the `cacbg_declarations` watcher source (that one is mapped to `/update-connections` and tracks the MP scope). The two watchers fingerprint independent slices of the same register.
