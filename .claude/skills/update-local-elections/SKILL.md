---
name: update-local-elections
description: Refresh local-elections (общински избори) data — download ЦИК's csv.zip bundles + per-município HTML pages and rebuild data/<cycle>/. Use when the daily watch report flags "CIK local-elections results bundles" as changed, when the user asks to refresh local-elections data, ingest a new regular cycle (mi2027 etc.) or a partial-elections date (chmi*), or after a fresh git clone if data/2023_10_29_mi/ is missing. Bypasses Cloudflare via a headless Playwright session that warms a cf_clearance cookie once per run.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update local-elections skill

Ingests Bulgarian local-elections data (общински съветници + кметове на община/кметство/район) from `results.cik.bg` into `data/<cycle>/`. Handles both regular cycles (`mi2019`, `mi2023`, future `mi2027`) and partial-elections dates under the rolling `chmi*` umbrella.

Two historical archives are also supported as one-time backfills (not watched, since the data is frozen): `minr2015` (мест. избори + национален референдум, 2015-10-25) and `mipvr2011` (мест. избори + президентски избори, 2011-10-23). They use the same `--local-ingest <slug>` CLI but require parser tolerance the modern cycles don't (different URL pattern `mestni/` vs `rezultati/`, missing CSS class markers, 3- and 4-column council tables, район mayor races split into separate `NNNN_NNNNNr.html` subpages on Sofia/Plovdiv/Varna). See "Historical cycles" below.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `CIK local-elections results bundles: N cycle(s) changed: …` | Run incremental ingest for the changed cycle(s) — Step 2 below |
| User asks to "refresh local elections" / "update мест. избори" / "ingest the new partial" | Same — Step 2 |
| `data/2023_10_29_mi/` is empty on a fresh clone | Cold-start ingest with `--local-ingest mi2023` |
| Adding a new regular cycle (e.g. mi2027 after Oct 2027) | First edit `scripts/watch/sources/cik_results.ts` `REGULAR_CYCLES` to include the new slug; then ingest |

## Architecture (read once)

```
results.cik.bg/{cycle}/csv.zip
results.cik.bg/{cycle}/tur1/rezultati/{oikCode}.html
results.cik.bg/{cycle}/tur2/rezultati/{oikCode}.html
   │
   ▼  scripts/parsers_local/cik_fetch.ts          ← Playwright warms cf_clearance once
   │
   ▼  scripts/parsers_local/ingest_cycle.ts       ← extract CP866-named zip, mirror HTML
   │
raw_data/<YYYY_MM_DD_(mi|chmi)>/
  ТУР1/{ОС,КО,КК,КР}/...
  ТУР2/{КО,КК,КР}/...
  html/tur1/*.html
  html/tur2/*.html
   │
   ▼  scripts/parsers_local/parse_local_elections.ts
   │
data/<cycle>/
  index.json                            ← national rollup (council R1 votes by canonical party + mayors-won)
  municipalities/<obshtinaCode>.json    ← per-município bundle
  region/<oblast>.json                  ← per-oblast rollup (region dashboard — one fetch; each município row carries electedMayor AND topCouncil to drive the council-support choropleth)
  regions_summary.json                  ← national per-oblast control (mayoral + council choropleths, top-regions); each row has topMayor + topCouncil
  national_leaders.json                 ← precomputed country-dashboard leaderboards (top mayors by %, closest races, split-control list, independent mayors) — one fetch instead of fanning out 265 município bundles
  index_trends.json                     ← trimmed sidecar (just councilVoteShare + mayorsByCanonical) so the cross-cycle trends tile pulls ~50 KB per cycle instead of ~100 KB
  _unmatched_coalitions.json            ← operator-review queue
```

`region/<oblast>.json` + `regions_summary.json` + `national_leaders.json` + `index_trends.json` are all produced by `scripts/parsers_local/build_region_json.ts` (`buildRegionRollups`), an additive bundle-only pass folded into the tail of `parseLocalElection` (and `resolveCanonicalsForCycle`). They regenerate automatically on every `--local-ingest` / `--local` / `--resolve-local-canonicals` run for regular `_mi` cycles, so no extra step is needed — chmi partials skip them (single-município, no region dimension). To rebuild only the rollups without re-fetching CIK HTML: `npm run data -- --local-rollups [--local-date <cycle>]`.

Cross-cycle chmi history (`data/local_chmi_history.json`) is built by `scripts/parsers_local/build_chmi_history.ts` (`buildChmiHistory`) at the tail of `parseLocalElection` and `resolveCanonicalsForCycle`. The same builder additionally writes per-município shards to `data/chmi_history/<obshtinaCode>.json` (rewritten from scratch each run) so the município page + settlement dashboard fetch their own ≤ 1 KB file instead of pulling the 61 KB global. The global file is kept for the national `/local/chmi` feed which needs every event.

The fingerprint source `cik_results` in `scripts/watch/sources/cik_results.ts` HEADs each cycle's `csv.zip` for `Last-Modified` + `Content-Length` once a day — when those change, this skill is queued by `process-watch-report`.

## Step 1 — Prerequisites

The parser cross-references canonical parties to credit local coalitions back to their primary national party. If `data/canonical_parties.json` is missing or stale:

```bash
npm run data -- --summary
```

This regenerates the canonical parties index (~5s).

## Step 2 — Ingest the changed cycle(s)

Read `state/watch/cik_results.json` to identify which cycles changed. The describe-line on the watcher report names them — e.g. `"2 cycle(s) changed: mi2023 re-uploaded, chmi2024-2026/2026-03-22_chastichen re-uploaded"`.

For each changed cycle slug, run:

```bash
npm run data -- --local-ingest <cycleSlug>
```

Examples:

```bash
# A regular cycle was re-uploaded:
npm run data -- --local-ingest mi2023

# A new partial-elections date appeared:
npm run data -- --local-ingest "chmi2024-2026/2026-03-22_chastichen"
```

Expected output:

```
[ingest_cycle] mi2023 → /Users/.../raw_data/2023_10_29_mi :: downloading csv.zip
[ingest_cycle] mi2023 :: extracting csv.zip (10362694 bytes)
[ingest_cycle] mi2023 :: extracted 54 files
[ingest_cycle] mi2023 :: mirroring HTML for 265 OIK(s)
[ingest_cycle] mi2023 :: tur1=265, tur2=89, missing tur1=0
[parsers_local] 2023_10_29_mi: wrote 265 município bundles to /Users/.../data/2023_10_29_mi
```

The HTML mirror is sequential with a 250ms delay between requests — full mi2023 takes ~3 min. Partial ingests typically finish in under 30 s.

**Cloudflare cookie**: the first request of the run launches headless Chromium to solve the JS challenge, captures `cf_clearance`, and persists it to `state/cik_clearance.json`. Subsequent requests in the same run use plain `fetch` with that cookie. The cookie typically lives ~30 min — long enough for one cycle's ~530 HTTP requests.

If you see "Cloudflare challenge did not clear within 30 s — manual intervention required (cik_fetch)", CF has updated its challenge. Investigate `scripts/parsers_local/cik_fetch.ts` and consider raising the warm-up wait or adding a stealth plugin.

## Step 3 — Curate unmatched coalitions

After ingest, inspect:

```bash
cat data/<cycle>/_unmatched_coalitions.json
```

If the file has entries, each key is a raw local_party_name from `local_parties.txt` whose fragment lookup against `data/canonical_parties.json` failed. Add overrides to `scripts/parsers_local/local_coalition_overrides.ts`:

```ts
// In localCoalitionRawOverrides
{
  rawName: "Местна коалиция Граждани за X (ВМРО-БНД, БДЦ)",
  primaryCanonicalId: "vmro",
  memberCanonicalIds: ["vmro", "bdc"],
},

// Or, if a fragment recurs across many local coalitions, in
// localCoalitionFragmentOverrides:
{ fragment: "ВМРО-БНД", canonicalId: "vmro" },
```

Re-run the parser only (skip the download/extract steps):

```bash
npm run data -- --local --local-date <YYYY_MM_DD_mi-or-chmi>
```

…until `_unmatched_coalitions.json` is empty or only contains genuinely-local entities you accept bucketing as `independent`.

## Step 4 — Verify

```bash
node -e "
const idx = require('./data/2023_10_29_mi/index.json');
console.log('cycle:', idx.cycle);
console.log('municipalities:', idx.municipalities.length);
console.log('top 5 council vote share:');
idx.councilVoteShare.slice(0, 5).forEach(p =>
  console.log('  ', p.displayName.padEnd(30), p.pctOfValid.toFixed(2) + '%'));
console.log('top 5 mayors won:');
idx.mayorsByCanonical.slice(0, 5).forEach(p =>
  console.log('  ', p.displayName.padEnd(30), p.count));
"
```

For mi2023 expect roughly:
- 265 municipalities
- Top council vote share dominated by ГЕРБ, БСП, ДПС
- Mayors-won dominated by ГЕРБ + independents (Blagoevgrad's Илко Стоянов won as an independent)

Visual check: `npm run dev` → visit `/settlement/BLG03` → the new "Местни избори · 29.10.2023" tile should show Илко Стоянов Стоянов as elected mayor with R2 result.

## Step 5 — Post-ingest decorators

After the parser writes (or rewrites) the per-município bundles, run the two
decorators that enrich the candidate rows. Both walk every
`data/<cycle>/municipalities/*.json` shard, so they cost ~10 s combined and
are idempotent — re-running them when nothing has changed is a no-op.

```bash
# Refresh kметство → EKATTE lookup the My-Area village-mayor tile reads.
npx tsx scripts/parsers_local/backfill_kmetstvo_ekatte.ts

# Stamp mpId on every mayor / councillor / kmetstvo / район candidate whose
# normalised name matches an MP in data/parliament/index.json. Drives the
# parliament.bg photo reuse in `MpAvatar`. Re-run automatically whenever
# either local-election bundles OR parliament index changes — see
# parliament-scrape SKILL.md for the inverse trigger.
npx tsx scripts/parsers_local/decorate_local_mp_links.ts
```

The decorator's summary line reports `N/M candidate rows stamped (X%)`
per cycle. National baseline is ~11% — most village councillors never sat
in parliament. A sudden drop usually means the parliament index lost its
`normalizedName` field; rerun `parliament-scrape` first.

## Step 6 — Stamp the ingest marker

`ingestCycles` writes `state/ingest/cik_local.json` automatically on success. If you ran the parser-only path (`--local --local-date …` rather than `--local-ingest …`), you can stamp manually:

```bash
npx tsx scripts/stamp-ingest.ts cik_local --summary "manual parse of <cycle>"
```

## Adding a new regular cycle

When CIK publishes mi2027 (~Oct 2027):

1. Edit `scripts/watch/sources/cik_results.ts`:
   ```ts
   const REGULAR_CYCLES = ["mi2019", "mi2023", "mi2027"] as const;
   ```
2. Edit `scripts/parsers_local/ingest_cycle.ts` `REGULAR_DATES`:
   ```ts
   const REGULAR_DATES: Record<string, string> = {
     mi2019: "2019_10_27",
     mi2023: "2023_10_29",
     mi2027: "2027_10_xx",  // ← actual election day
   };
   ```
3. Add a single-entry catalogue update to `src/data/json/local_elections.json`.
4. Ingest: `npm run data -- --local-ingest mi2027`.

## Historical cycles (mi2015 / mipvr2011)

The 2015 (`minr2015`) and 2011 (`mipvr2011`) archives are usable via the same CLI:

```bash
npm run data -- --local-ingest minr2015
npm run data -- --local-ingest mipvr2011
```

They are **not watched** — the csv.zip fingerprint source intentionally only tracks `mi2019` / `mi2023` / chmi umbrellas because the older archives are frozen, and adding them to `REGULAR_CYCLES` in `scripts/watch/sources/cik_results.ts` would just add HEAD requests for files that never change. Re-run the backfill manually if `data/2015_10_25_mi/` or `data/2011_10_23_mi/` is missing on a clone.

What's different from 2019+ — already handled in the parser, listed here so you can debug a re-run intelligently:

- **URL pattern**: pages live under `mestni/` not `rezultati/`. `RESULTS_PATH` in `ingest_cycle.ts` maps per-slug.
- **OIK discovery**: 2015's index dropdown is unnamed (not `#obl-select`); 2011's lists 28 oblast codes as bare 2-digit values (`01`–`28`) with a JS-constructed redirect. Both fall through to `readLocationSelectOptions` + `scrapeOikRefs`, which find the largest redirecting `<select>` and union all `NNNN.html` href patterns on the page.
- **Race-section headings**: 2015 uses `<h3>Резултати за кмет на община</h3>` instead of 2019+'s `<h2>Обобщени данни от избор на кмет на община</h2>`. 2011 omits the race-type heading entirely. Parser regex broadened + no-heading fallback added.
- **Winner/elected markers**: 2015 still ships `tr.elected` on the mayor table but drops `candidate-elected` for council. 2011 drops both. Mayor winner is post-pass-inferred (R1: `pctOfValid > 50`, R2: highest votes); per-councillor elected list is not populated (mandate count alone drives the seat-bar).
- **Council column variants**: 2019+ has 5 cols (№ · Партия · Гласове · % · Мандати + interleaved candidate rows). 2011 has 4 (Партия · Гласове · % · Мандати, no № column). 2015 has only 3 (№ · Партия · Мандати — no votes, no %). `detectCouncilCols` in `parse_rezultati_html.ts` maps headers by name so all three layouts coexist.
- **Sofia / Plovdiv / Varna район mayor races (2015 only)**: split into separate `mestni/NNNN_NNNNNr.html` subpages (e.g. `2246_02201r.html` = София район Средец). The OIK discovery's targeted second sweep visits the 3 known multi-район parents (2246/1622/0306) and harvests the extended stems via `scrapeRayonRefs`; the parser's post-pass walks `raw_data/<cycle>/html/tur1/` for `XXXX_NNNNNr.html` files and merges each into the parent's `districts[]`, keyed by the район name from the breadcrumb (`Резултати за община София, район Средец` → "Средец"). `fanOutSofiaRayons` then turns the SOF.districts[] into 24 per-район shards (S2302/S2401/…). Plovdiv (PDV22) and Varna (VAR06) districts stay inside the parent's `districts[]` since they aren't separate obshtinas in the catalogue.
- **NAME_ALIASES additions**: pre-2019 CIK labels for cities differ — `софия` (2011/2015) maps to the synthetic `SOF`; `добрич-град` maps to `DOB28`; `бобовдол` maps to `KNL04`. Live in `parse_local_elections.ts`.
- **Protocol totals**: HTML-only mode leaves voter-registration totals at zero (same as 2019+ HTML-only mode); the SPA's StatsGrid hides the Активност tile in that case.

If a different historical cycle is ever added (`mi2007` lives on a separate host `mi2007.cik.bg` with a different URL grammar, `mi2003` similarly), it would need its own parser branch and a new `CYCLE_DATE_PREFIX` / `RESULTS_PATH` entry — those aren't supported today.

## Adding a new partial-elections umbrella

When the chmi rolls into a new 4-year window (e.g. `chmi2027-2030`):

1. Edit `scripts/watch/sources/cik_results.ts`:
   ```ts
   const PARTIAL_UMBRELLAS = ["chmi2024-2026", "chmi2027-2030"] as const;
   ```
2. The watcher's `discoverPartials` will find new dated subdirectories automatically; no per-date config needed.

## Failure modes

- **`csv.zip empty`** — CIK returned a zero-byte body. Usually a CF challenge gone wrong; retry once. If persistent, check the cookie is being captured (run with `DEBUG=cik:* npm run data -- --local-ingest mi2023`).
- **`discovered 0 OIK codes from sections.txt`** — extraction layout unexpected. CIK occasionally changes the inner directory naming (`ТУР1` vs `Тур1`); inspect `raw_data/<cycle>/` after the run and adjust `discoverOikCodes` if needed.
- **HTML scraper warnings** (`X OIK(s) missing tur1 HTML page`) — sometimes CIK delays publishing a problematic município's page for days while the OIK resolves a recount. Re-run later.
- **Many unmatched coalition fragments** — usually means `canonical_parties.json` is stale. Re-run Step 1.

## Hand-off notes for future runs

The parser is **idempotent on the HTML mirror** (already-downloaded files are skipped). The `csv.zip` is always re-downloaded and re-extracted on each `--local-ingest` invocation. This means re-running after a partial failure is safe and cheap.

The Cloudflare `cf_clearance` cookie is per-IP. If you're running from a residential IP and CI runs from a datacenter IP, they need separate warm-ups — the persisted `state/cik_clearance.json` will simply fail with 403 in the other environment, triggering a fresh Playwright warm-up.

**HTML-only mode leaves `protocol.{numRegisteredVoters,totalActualVoters,numValidVotes}` at zero** — CIK's rezultati HTML pages don't carry voter-registration totals; those live in `protocols.txt` inside `csv.zip` (CSV mode). When `cik_results` is reporting `0/N csv.zip bundles reachable`, every município's protocol block ships as zeros. The SPA's per-município `StatsGrid` (`src/screens/LocalElectionScreen.tsx`) tolerates this by hiding the Активност tile entirely and deriving Действителни гласове from the council total (or the round-1 mayor sum for Sofia район shards, whose council is replicated city-wide). The day CSV mode comes back, the ingested protocol values override both fallbacks automatically — no SPA change needed.
