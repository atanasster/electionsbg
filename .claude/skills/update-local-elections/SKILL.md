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

| Trigger                                                                                   | Action                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daily watcher reports `CIK local-elections results bundles: N cycle(s) changed: …`        | Run incremental ingest for the changed cycle(s) — Step 2 below                                                                                                                                                                                                                                                                             |
| Describe-line ends `<cycle> тур2 (runoff) re-check`                                       | A mayoral partial's round-2 runoff window opened (the watcher re-flags each fresh partial ~9 and ~16 days after election day). **Re-run the same `--local-ingest <cycle>`** — idempotent on the round-1 mirror, pulls the round-2 (`tur2/`) pages now published, resolving the real winner (round-1 HTML stubs both finalists as elected). |
| User asks to "refresh local elections" / "update мест. избори" / "ingest the new partial" | Same — Step 2                                                                                                                                                                                                                                                                                                                              |
| `data/2023_10_29_mi/` is empty on a fresh clone                                           | Cold-start ingest with `--local-ingest mi2023`                                                                                                                                                                                                                                                                                             |
| Adding a new regular cycle (e.g. mi2027 after Oct 2027)                                   | First add the new slug → bundle URL to `scripts/watch/sources/cik_results.ts` `REGULAR_BUNDLE_URL`; then ingest                                                                                                                                                                                                                            |

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

The fingerprint source `cik_results` in `scripts/watch/sources/cik_results.ts` tracks two kinds of cycle daily and queues this skill via `process-watch-report` when either changes:

- **Regular cycles** (`mi2019`, `mi2023`) — HEADs the section bundle (`REGULAR_BUNDLE_URL`; mi2023's is `tur1/opendata/export.zip`, NOT a uniform `csv.zip`) for `Last-Modified` + `Content-Length`.
- **Partial cycles** — enumerates every dated subdirectory under each `PARTIAL_UMBRELLAS` entry from CIK's root index, matching **both** `<date>_chastichen` (partial) **and** `<date>_nov` (new election, incl. full council re-elections). These are HTML-only; a newly-appeared date folder is the round-1 change signal. **Round-2 runoffs** publish into the _same_ date folder ~7 days later under `tur2/`, with no fresh folder to detect — and CIK serves a populated `tur2/` shell even for roundless `_nov` cycles, so there's no reliable server signal to probe. The source instead schedules re-ingests purely off the election date in the slug: each freshly-seen partial advances a `runoffStage` at fixed day offsets (`RUNOFF_RECHECK_DAYS = [9, 16]`), and every advance re-flags the cycle with a `тур2 (runoff) re-check` describe-line. Pre-existing partials are grandfathered (never re-flagged), so shipping the mechanism is a no-op.

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

`--local-ingest` is the **HTML-only** path: it discovers the OIK catalogue from the cycle's dropdowns, mirrors the per-município pages, and parses. It does NOT download the section CSV bundle (that's `--local-csv`, see below).

Examples:

```bash
# A regular cycle was re-uploaded (HTML re-parse):
npm run data -- --local-ingest mi2023

# A new partial-elections date appeared (either kind works the same):
npm run data -- --local-ingest "chmi2024-2026/2026-03-22_chastichen"
npm run data -- --local-ingest "chmi2024-2026/2025-10-12_nov"
```

Expected output:

```
[ingest_cycle] chmi2024-2026/…_chastichen :: discovering OIK catalogue
[ingest_cycle] chmi2024-2026/…_chastichen :: discovered 10 OIK code(s)
[ingest_cycle] chmi2024-2026/…_chastichen :: tur1=10, tur2=10, missing tur1=0
[parsers_local] 2025_10_12_chmi: wrote 10 município bundles to …/data/2025_10_12_chmi
```

**chmi structural variants are auto-handled** (no per-cycle flags):

- Both `_chastichen` and `_nov` use the same id'd `obl-select`/`obs-select` dropdowns as mi2019/mi2023 (discovery is keyed off `usesIdSelects` in `ingest_cycle.ts`, which now includes any `chmi*` slug).
- The single-round "нови избори за общински съветници" partials publish at `<cycle>/rezultati/...` with **no `tur1/` segment** — `ingestCycle` probes the tur1 index, detects the 404, and switches to the roundless layout. A full council re-election surfaces in `/local/chmi` as a `council`-kind event (leading party + seats; see `build_chmi_history.ts`).

The HTML mirror is sequential with a 250ms delay between requests — full mi2023 takes ~3 min. Partial ingests typically finish in under 30 s.

### Section-level CSV (votes + turnout per polling station)

For **regular cycles only** (2015/2019/2023), `--local-csv <slug>` additionally downloads the section bundle and re-parses, layering per-station data on top of the HTML bundles:

```bash
npm run data -- --local-csv mi2023   # or minr2015 / mi2019
```

This fixes the council vote share for cycles whose HTML summary omits it (2015), fills real `protocol` turnout, and writes the two-tier section data — `data/<cycle>/sections/<obshtina>.json` (light index: the map + top-sections + `LocalSectionsTile` table) + `data/<cycle>/sections/<obshtina>/<sectionCode>.json` (per-station full breakdown for the detail page). Follow with `--local-coords` (Step 5.5) to stamp GPS/address. Per-cycle bundle URLs + the cp866 extractor live in `download_csv_bundle.ts` / `extract_bundle.ts`. chmi partials are HTML-only — they have no section bundle, so `--local-csv` does not apply to them.

**Mayor section votes (powers the colored-by-mayor section map).** `augment_sections.ts` also reads the `ТУР1/КО` (община mayor) and `ТУР1/КР` (район mayor) race folders and attaches per-section `mayorVotes`/`mayorValid` + `rayonMayorVotes`/`rayonMayorValid` to each section — the mayor map reads these (the council map reads `partyVotes`). Two gotchas baked in: (a) `КО` can ship MULTIPLE dated `votes_*.txt` (original tabulation + a later 1-município re-count) — they are merged later-date-wins, since `resolveRaceFile` would otherwise return only the tiny re-count and drop everyone else's mayor votes; (b) Sofia районs (`S2***`) get their OWN per-район light-index shard (`sections/S2***.json`, ~50KB) instead of narrowing the ~2MB `SOF.json` client-side — the per-station detail files stay shared under `sections/SOF/`. Both depend on `--local-csv` having pulled the `КО`/`КР` folders, **and** on `--local-coords` (Step 5.5) running afterward — the parse drops station GPS, so skipping it hides ALL section maps.

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

## Step 5.5 — Section coordinates (powers the per-município section map)

The local section shards carry no GPS of their own — stamp coordinates +
building address onto the section index from the parliamentary section archive:

```bash
npm run data -- --local-coords
```

Idempotent; walks every cycle. The join is settlement-name-gated (local and
parliamentary section codes/numbers diverge — see
`backfill_local_section_coords.ts`); ~98% coverage. Run after any section data
lands, **and** after a new parliamentary election adds fresh section coordinates.
Note the section data is now two-tier — every ingest/parse path emits a light
`sections/<obshtina>.json` index (top-5 parties/station; drives the map +
top-sections + table) plus per-station `sections/<obshtina>/<sectionCode>.json`
full-breakdown files (the detail page fetches just one) via `emitSectionFiles`.

## Step 5.6 — Problem sections (powers the município "Risk votes" tile)

Flag the curated Roma-neighborhood polling sections inside the local council
data — the council-ballot analogue of the parliamentary `problem_sections`
report. Writes `data/<cycle>/problem_sections.json` for every regular `_mi`
cycle (the município dashboard's **Risk votes / Problem votes by party** tile
reads it; self-hides for municípios with no flagged neighborhood):

```bash
npm run data -- --local-problem-sections
```

**Run this AFTER `--local-coords`** — most neighborhoods key on EKATTE + the
building `address` that the coords step stamps onto the shards. Reuses the
watchlist in `scripts/reports/problem_sections/neighborhoods.ts` (same source as
parliamentary); matching is local-specific (`problem_sections_local.ts`) because
local section codes are NSI-oblast-prefixed while parliamentary are
МИР-prefixed, so the codes can't be joined. Three match paths, first hit wins:
(1) **section prefix** — Plovdiv only, where МИР=NSI (Stolipinovo); (2)
**МИР-agnostic section suffix** — the 9-digit code minus its 2-digit prefix,
EKATTE-gated, for махала stations the CIK local feed ships with a BLANK
`address` (Филиповци: parliamentary `254619069` ↔ local `224619069` share suffix
`4619069`) — this path is **address-independent**, so Филиповци does not need
`--local-coords`; (3) **address keyword + normalized EKATTE** (the rest). Reads
the per-station detail files for full party votes. Idempotent; also folded into
`--all`.

Each emitted neighborhood carries a `rayonCode` (section-code digits 5-6 = the
административен район it sits in). The município dashboard ignores it (shows all
its neighborhoods), but the **район drill-down pages** join on it so a
neighborhood surfaces on the right район too: Sofia районите (S2xxx → код =
last 2 digits), Пловдив/Варна (`<muni>-<code>`). E.g. Максуда → район Младост
(VAR06-03), Столипиново → Източен (PDV22-02), Филиповци → Люлин (S2519). общини
без районно деление get `00`. No new step — it falls out of this same run.

## Step 6 — Stamp the ingest marker

`ingestCycles` writes `state/ingest/cik_local.json` automatically on success. If you ran the parser-only path (`--local --local-date …` rather than `--local-ingest …`), you can stamp manually:

```bash
npx tsx scripts/stamp-ingest.ts cik_local --summary "manual parse of <cycle>"
```

## Adding a new regular cycle

When CIK publishes mi2027 (~Oct 2027):

1. Edit `scripts/watch/sources/cik_results.ts` — add the slug → section-bundle URL (check CIK's actual path; it's moved each cycle: mi2019 `csv.zip`, mi2023 `tur1/opendata/export.zip`):
   ```ts
   const REGULAR_BUNDLE_URL: Record<string, string> = {
     mi2019: `${ROOT}/mi2019/csv.zip`,
     mi2023: `${ROOT}/mi2023/tur1/opendata/export.zip`,
     mi2027: `${ROOT}/mi2027/…`,
   };
   ```
2. Edit `scripts/parsers_local/ingest_cycle.ts` `REGULAR_DATES`:
   ```ts
   const REGULAR_DATES: Record<string, string> = {
     mi2019: "2019_10_27",
     mi2023: "2023_10_29",
     mi2027: "2027_10_xx", // ← actual election day
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

They are **not watched** — the fingerprint source intentionally only tracks `mi2019` / `mi2023` / chmi umbrellas because the older archives are frozen, and adding them to `REGULAR_BUNDLE_URL` in `scripts/watch/sources/cik_results.ts` would just add HEAD requests for files that never change. Re-run the backfill manually if `data/2015_10_25_mi/` or `data/2011_10_23_mi/` is missing on a clone. Both **2015** (`--local-csv minr2015`) and **2011** (`--local-csv mipvr2011`) have section CSVs that backfill council vote share + turnout + per-station data. 2011's bundle (`el2011_t1.zip`) is a separate schema (CP1251 content, `общински съветници` folder, `coalitions` file, pair-encoded votes, no admin/serials columns) read by `augment_sections_2011.ts`, which the orchestrator falls back to automatically. NB: 2011's HTML council table was incomplete (omitted also-ran parties), so the CSV raises its council total from ~2.73 M to the complete ~3.27 M.

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

## Legacy chmi umbrellas (2012-2023 — historical backfill)

The umbrellas BEFORE the current one — `chmi2019-2023`, `chmi2016-2018`,
`chmi2012-2015` — use a different page model: one numbered page per individual
race (`tur{1,2}/<N>.html`, e.g. a single village by-election) rather than one
OIK-município page. They are ingested by a dedicated path
(`scripts/parsers_local/ingest_legacy_chmi.ts` + `parse_legacy_chmi.ts`), which
`--local-ingest` routes to automatically for those umbrella slugs:

```bash
npm run data -- --local-ingest "chmi2016-2018/2018-10-14_chastichen"
```

It enumerates the numbered pages, parses each kmetstvo / obshtina / район mayor
or council race (reusing `parseMayorTable` / `parseCouncilTable`), resolves the
obshtina from the heading's "община X, област Y" or the 9-digit section code's
OIK, and emits bundles so `buildChmiHistory` surfaces them on `/local/chmi`
(spanning 2012-2026). Notes:

- Within an umbrella later dates migrated to the modern OIK structure; when the
  legacy ingest finds no numbered pages it delegates to `ingestCycle`.
- These are a **one-time historical backfill, not watched** (`PARTIAL_UMBRELLAS`
  tracks only the current umbrella). Re-run the whole set with the loop in the
  ingest module's header, or one slug at a time.
- The full backfill (~47 dates, ~258 obshtina bundles) was run 2026-05-31.

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

**HTML-only ingest leaves `protocol.{numRegisteredVoters,totalActualVoters,numValidVotes}` at zero** — CIK's rezultati HTML pages don't carry voter-registration totals; those live in `protocols.txt` inside the section bundle. Running `--local-csv <slug>` afterwards backfills them (the section aggregator resolves the per-cycle protocol column offset against the votes-derived valid total — see `parse_local_protocols.ts`). Until then, the SPA's per-município `StatsGrid` (`src/screens/LocalElectionScreen.tsx`) tolerates zeros by hiding the Активност tile and deriving Действителни гласове from the council total (or the round-1 mayor sum for Sofia район shards, whose council is replicated city-wide). 2023's council vote share comes from the HTML, so only its turnout needs `--local-csv`; chmi partials have no section bundle and stay HTML-only by design.
