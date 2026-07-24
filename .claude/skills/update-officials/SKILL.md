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
| Watcher reports `new declaration year <prev> → <curr>` | The register opened a new cycle. Re-run the flagged ingest with no `--year` — it resolves the newest published year itself. Expect a cold-start-sized run (the whole cycle is new declarations). |
| Adding a new year of filings | Only needed to pin a *non-newest* year: `--year <YYYY>`. The newest is the default. |

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

## Coverage check — did the ingest take everything the register lists?

```bash
npx tsx scripts/declarations/coverage.ts            # every folder on file
npx tsx scripts/declarations/coverage.ts --year 2025
```

Prints listed-vs-held per tier per register folder. Run it after any ingest
change, and whenever a tier looks thin.

It exists because an ingest can hold half the corpus with nothing looking wrong:
the MP leg read only the FIRST `Declaration` node per person and took 246 of the
285 declarations the 2025 folder lists, for years, while every run reported
success. Only the two numbers side by side showed it.

Reading a gap: a small one is usually an upstream fact, a large SHARE of a folder
is usually the ingest dropping rows. Known-good gaps today:

| tier | folder | gap | why |
|---|---|---|---|
| executive | 2018 | 403 (8.5%) | XML 404s upstream; the ingest already warns, and `--max-missing` exists to accept it |
| MPs | various | 4-16 | declarants in the NS category who are not in `data/parliament/index.json` (logged as `no MP match`) |

Anything else, especially a round fraction of a folder, is worth treating as a
parser or filter bug until proven otherwise.

## Step 1b — Municipal tier

```bash
npx tsx scripts/officials/municipal.ts
```

Separate ingest for the local-government tier. The script:

1. Fetches the same `register.cacbg.bg/{year}/list.xml`.
2. Filters Category nodes to the `Кметове…` family (mayors, deputy-mayors, council chairs, municipal councillors, chief architects).
3. Maps each declarant's `Position/Name` role label to a role bucket, fetches + parses the per-person XML (same shared parser and `raw_data/officials/` cache as the executive ingest), and writes one JSON per slug under `data/officials/municipal/declarations/`.
4. Builds `data/officials/municipal/index.json` — a roster with `byRole` counts and one entry per official (slug, name, role, municipality).
5. **Emits per-obshtina shards** under `data/officials/municipal/by_obshtina/{code}.json` (~288 files; SPA's `/settlement/{обshtina}` page fetches only its own slice). Each shard pre-sorts entries in roster-display order so the dashboard tiles render without re-sorting. Sofia districts each get their own S23xx code; Plovdiv (PDV22) and Varna (VAR06) aggregate districts under a single shard with a `district` tag on each entry; the synthetic `SFO_CITY` shard carries the Sofia city-wide tier (mayor + city council + 9 deputies + 2 architects) and is staged for a future Sofia-wide tile — not yet wired into any SPA page.

Expected output:

```
→ municipal: fetching 2025 list…
  6521 declaration(s) in the municipal tier
  processed 6521 declaration(s) for ~6400 unique official(s)
  wrote ~6400 per-official file(s) to data/officials/municipal/declarations
  wrote index.json (~6400 official(s): ~290 mayors, ~700 dep. mayors, ~260 chairs, ~4800 councillors, ~310 architects, 0 other)
  wrote 288 per-obshtina shard(s) to data/officials/municipal/by_obshtina (max ~36000 bytes)
```

Cold start takes ~30–50 minutes (~6,500 per-declaration fetches at a 150 ms politeness sleep). Re-runs are far faster — raw XMLs are cached. Sanity: `byRole.councillor` should dominate (~75%), `byRole.mayor` ≈ 290, `byRole.other` should be 0 (a non-zero `other` count means an unmapped role label — inspect `mapRole` in `scripts/officials/municipal.ts`). Shard count should be ≈ 288 (varies as new municipalities enter the registry); `ls data/officials/municipal/by_obshtina | wc -l` for a quick spot check.

If the run aborts with `N roster entries did not map to an obshtina — add aliases in scripts/officials/_aliases.json`, the registry has introduced a new entity name (or renamed an existing one). Dry-run the resolver to enumerate the unmatched strings without re-scraping:

```bash
npx tsx scripts/officials/municipality_join.ts --dry-run
```

Add aliases to `scripts/officials/_aliases.json` (key = verbatim registry name, value = obshtina code from `data/municipalities.json`, or the synthetic `SFO_CITY` for Sofia city-wide). After fixing aliases you can re-emit shards in seconds without re-scraping the whole register:

```bash
npx tsx scripts/officials/build_municipal_shards.ts
```

## Step 1c — Company cross-reference + connections

```bash
npx tsx scripts/run-officials-links-only.ts        # company_links.json
npx tsx scripts/run-officials-connections-only.ts  # connections.json
```

The first builder joins every executive + municipal official to companies — via their own declared ownership stakes and via a Commerce Registry (TR) officer/owner name match against `raw_data/tr/state.sqlite` — and writes `data/officials/derived/company_links.json`. Each link carries a `confidence` flag. A declared stake is always `high`. A TR name-match is `high` **only when the name is rare on BOTH sides** — unique among officials (`namesakeCount === 1`) AND mapped to a single TR company (`trNamesakeCount === 1`); otherwise it is `low`. This two-sided test is what stops a common name (e.g. "Димитър Георгиев Димитров", which is an officer of ~30 distinct TR companies) from handing one councillor every company that shares the name — the high-only consumers (`pep_connected`, the connections graph) would otherwise surface false ties like a Горна Малина councillor "running" Софарма Трейдинг. Expect ~7,000 links with a large `low` share; a zero TR-link count means the SQLite is missing (run `/update-connections` first to build it).

The second builder joins `company_links.json` against the MP companies-index (`data/parliament/companies-index.json`) to write `data/officials/derived/connections.json` — per official, which MPs and which other officials they share a company with. Edges where the official and the MP/peer have the identical normalised name are dropped: that is the same person (an official who is also an MP) or pure namesake noise, not a connection.

Re-run both after Step 1 / Step 1b so the artifacts reflect the fresh roster. Both also run automatically at the tail of the main declarations pipeline (`scripts/declarations/index.ts`).

> **After a significant officials refresh, also run `/update-connections`.** The two builders above refresh `company_links.json` + the officials `connections.json` bridge, but the MP connections **graph** (`data/parliament/connections.json`, per-MP/official subgraphs) and the per-EIK `company-connections/` both fold the officials links and only rebuild inside the declarations pipeline. If cacbg/data.egov is reachable, `/update-connections` does it; if it's network-blocked, run the offline rebuild `npx tsx scripts/run-connections-rebuild.ts` (no fetch — see `/update-connections`). Skipping this leaves the graph's officials edges stale relative to the new roster.

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
- `byCategory.cabinet` ≥ 80 (PM, deputy PMs and ministers — **not** deputy
  ministers, which have had their own `deputy_minister` bucket since the ingest
  started reading the real position title).
- `byCategory.deputy_minister` ≥ 10 for a re-derived cycle. Zero across a year
  that has been re-derived means `positionTitle` came back null and the
  cabinet/deputy split silently collapsed — check `Position > Name` still
  exists in `list.xml`.
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
# Pin a single year. Omitted, both ingests resolve the newest year the
# register root advertises — no constant to bump when a new cycle publishes.
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

The upstream registry publishes year-keyed directories back to 2015 — `2015`–`2020`, `2022`–`2025`; there is **no plain `2021`** folder (that cycle ships split as `2021_nc` / `2021_nonc` and is not ingested). To add an earlier year:

```bash
npx tsx scripts/officials/index.ts --year 2024
npx tsx scripts/officials/index.ts --year 2023
# etc.
```

Merge semantics (`scripts/officials/merge.ts`): a run is **authoritative for its target year and additive everywhere else**. It drops only the per-slug rows whose `sourceUrl` sits under the target register folder, then writes the fresh set — so re-running a year picks up upstream corrections *and* removals while leaving every other year alone, and re-running an unchanged year is a no-op. Replacement keys on the folder year in `sourceUrl`, never on `declarationYear`: the parsed year comes from inside the XML and does not track the folder (the live 2025 folder holds rows parsing to 2026 and even 2005).

`index.json` accumulates — entries merge by slug with the higher `latestDeclarationYear` winning, and `years` unions. Treat it as a shared universe file: `scripts/funds/political_links.ts`, `declarations/tr/build_company_connections.ts`, `ngo/load_ngo_board_links_pg.ts` and `person/resolve_persons.ts` (`official_roster` → `/officials/<slug>`) all read it, so widening it widens the politically-exposed-person universe those builds produce. Re-run them after a backfill.

`assets-rankings.json` rebuilds from every per-slug file on disk (not just the run's year), so officials whose latest filing predates the run are kept. Per slug it rolls up `decls[0]`, which is the most recently *filed* declaration — declarations sort by `declarationYear`, then `filedAt` desc, then `entryNumber`, then `sourceUrl`. That matters for the ~111 officials who file more than once in a year (annual + exit): the exit filing is usually both later and more complete.

> Before this was fixed, backfilling **destroyed** the current year — per-slug files were overwritten with the run's year alone and `index.json` was stamped `years: [targetYear]`. If you are on an older checkout, do not backfill.

### Year coverage (backfilled 2026-07-23)

All ten published years are loaded: 2015–2020 and 2022–2025, totalling 4,212 declarations across 1,495 officials, 822 of whom have more than one year on file.

Two years carry upstream rot — `list.xml` lists declarations whose XML 404s:

| Year | Missing | Note |
|---|---|---|
| 2024 | 1 / 654 (0.2%) | within the default tolerance |
| 2018 | 54 / 382 (14.1%) | genuinely gone upstream (absent under the `2018`, `2018y` and `2018f1` folders alike) — needs `--max-missing 0.2` to load |

```bash
npx tsx scripts/officials/index.ts --year 2018 --max-missing 0.2
```

## Data-integrity contract

Fails loud rather than write partial data:

| Surface | Trigger | Action |
|---|---|---|
| HTTP non-200 on list.xml | Upstream registry down or year doesn't exist | Throws |
| Per-declaration fetch fails | Network error fetching one official's XML | Throws (no partial writes) |
| Per-declaration fetch 404s | `list.xml` references a declaration whose file is gone upstream | Skipped + logged `[missing]`, not retried (a 404 is permanent) and not cached, so a later run retries it if upstream restores the file |
| `> 5%` of a year's declarations missing upstream | Year is rotted, or we're being rate-limited into 404s | Throws — writing it would publish a partial cohort as complete. Override per run with `--max-missing <0-1>` once you've confirmed the rot is real |
| Zero declarations match the category filter | Upstream renamed categories or shifted XML schema | Throws — investigate `CATEGORY_MAP` in `scripts/officials/categorise.ts` (and mirror any change into `CATEGORY_SUBSTRINGS` in `scripts/watch/sources/cacbg_officials.ts`; `watcher_lockstep.test.ts` enforces it) |
| `assets-rankings.json` total drops > 20% | Likely a regression in category filtering | Inspect diff; do NOT commit until cause is identified |
| Zero entries in the `Кметове…` category | Upstream renamed the municipal category | `municipal.ts` throws |
| > 2% (or > 20) of municipal declarations fail to parse | Upstream schema drift, not isolated bad records | `municipal.ts` throws; failures below that bar are skipped + logged, not fatal |
| `> 10 roster entries did not map to an obshtina` | Upstream rename / new municipality / new район | `municipal.ts` throws; dry-run `scripts/officials/municipality_join.ts --dry-run`, add aliases to `scripts/officials/_aliases.json`, then re-emit with `scripts/officials/build_municipal_shards.ts` |
| Shard for a known обshtina exceeds 40 KB raw | A big city's districts proliferated, or `byRole.councillor` ballooned | Warns (does not throw); consider splitting the shard if the SPA Roster tile becomes janky |

## What this skill does NOT do

- Does NOT build a ranking page for the municipal tier. `municipal.ts` writes per-slug declarations + the global `index.json` + per-obshtina shards under `data/officials/municipal/by_obshtina/` (consumed by the Local government section on every `/settlement/{обshtina}` page); the `/officials/assets`-style sortable ranking remains MP / executive-only because the municipal tier carries no party affiliation.
- Does NOT scrape the judiciary (ВКС/ВАС/прокурори/съдии). Same register, different editorial scope.
- Does NOT cross-reference officials to MP-connected companies. That join lives in `data/procurement/derived/mp_connected.json` and is keyed on MP ids, not official slugs. A follow-up could add an "officials connected contractors" rollup if/when the editorial use case justifies it.
- Does NOT update the `cacbg_declarations` watcher source (that one is mapped to `/update-connections` and tracks the MP scope). The two watchers fingerprint independent slices of the same register.
