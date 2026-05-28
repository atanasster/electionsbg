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
  _unmatched_coalitions.json            ← operator-review queue
```

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

## Step 5 — Stamp the ingest marker

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
