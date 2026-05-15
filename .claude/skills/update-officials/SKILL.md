---
name: update-officials
description: Refresh the non-MP officials declarations data — pulls property/interest declarations from register.cacbg.bg (Сметна палата) for cabinet members, deputy ministers, state-agency heads, and regional governors. Use when the daily watch report flags "Сметна палата declarations — executive (officials)" as changed, when the user asks to refresh officials data, when adding a new declaration year (e.g. 2026 filings appear in spring), or after a fresh git clone if `data/officials/assets-rankings.json` is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Officials skill

Scrapes `register.cacbg.bg/{year}/list.xml` for non-MP categories (cabinet, deputy ministers, state-agency heads, regional governors) and writes per-official declaration JSON to `data/officials/declarations/{slug}.json`, plus the `index.json` and `assets-rankings.json` rollups consumed by the `/officials/assets` page, `/officials/{slug}` profile pages, and the dashboard `OfficialsAssetsTile`.

Mayors (6,400/year) and the judiciary live in the same source register but are intentionally out of scope here — they need their own UI scope (paginated table, role-specific filters) and the per-municipality politics is a separate editorial concern.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `Сметна палата declarations — executive (officials): N declarations in scope` changed | Re-run for the current year (`npx tsx scripts/officials/index.ts`) |
| User asks to "refresh officials" / "update cabinet declarations" | Same |
| `data/officials/assets-rankings.json` missing (fresh clone) | Cold-start ingest |
| Adding a new year of filings | Re-run with `--year <YYYY>` after the upstream publishes that year's list.xml |

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
  wrote assets-rankings.json (top: Валери Симеонов €9.5M, Радка Николова €7.7M, …)
```

Cold start takes ~90 seconds (network-bound on per-declaration fetches — 150 ms politeness sleep between requests). Re-runs are faster because raw XMLs are cached under `raw_data/officials/`.

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

## What this skill does NOT do

- Does NOT scrape mayors / municipal councillors. Volume (6,400/year) needs paginated UI design first.
- Does NOT scrape the judiciary (ВКС/ВАС/прокурори/съдии). Same register, different editorial scope.
- Does NOT cross-reference officials to MP-connected companies. That join lives in `data/procurement/derived/mp_connected.json` and is keyed on MP ids, not official slugs. A follow-up could add an "officials connected contractors" rollup if/when the editorial use case justifies it.
- Does NOT update the `cacbg_declarations` watcher source (that one is mapped to `/update-connections` and tracks the MP scope). The two watchers fingerprint independent slices of the same register.
