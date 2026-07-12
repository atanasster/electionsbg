---
name: update-defense
description: Refresh the Отбрана (defense) data behind /defense — the %GDP-to-5% path and equipment/personnel split in data/defense/{gdp_share,category_split}.json (parsed from the NATO annual "Defence Expenditure of NATO Countries" PDF, Tables 3 & 8a), the arms-export series in data/defense/exports.json (from the Ministry of Economy's annual export-control report), and force readiness in data/defense/readiness.json (from the МО "Доклад за състоянието на отбраната"). These feed the /defense dashboard and the AI defenseSpending / armsExports / defenseProgram / defenseReadiness tools. The mega-programs (F-16, Stryker, MMPV, ammo JV) in data/defense/programs.json are curated MANUALLY. Use when the daily watch report flags `nato_defexp`, `mod_defense_report` or `moe_arms_exports` as changed, when the user asks to refresh defense / отбрана / NATO spending / arms exports data, or after a fresh git clone if data/defense/gdp_share.json is missing. NOTE: the МО procurement pack (25-unit group) renders off the live contracts corpus and needs no ingest here; the МО budget slice rides update-budget, not this skill.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Defense skill

Three watched artifacts (+ one manually-curated one). Each has its own trigger; a
change in one does not force re-parsing the others.

| Artifact | Source | Watcher | Script / method |
|---|---|---|---|
| `data/defense/gdp_share.json` + `category_split.json` | NATO annual report (PDF) | `nato_defexp` | **`npx tsx scripts/defense/__write_nato.ts`** (automated — downloads + parses Tables 3 & 8a) |
| `data/defense/exports.json` | Ministry of Economy export-control report | `moe_arms_exports` | MANUAL — edit the euro figures (МИ has no stable machine-readable feed) |
| `data/defense/readiness.json` | МО "Доклад за състоянието на отбраната" (PDF) | `mod_defense_report` | MANUAL — the vacancy/reserve figures move each year's report |
| `data/defense/programs.json` | ratification laws + press (curated) | — | MANUAL edit only |
| `data/defense/aviation_sustainment.json` | procurement corpus (25 МО EIKs) | — | re-aggregate from the corpus when contracts reload (see the query in the file's `source`) |

The URLs are single-sourced in `scripts/defense/sources.ts` (shared with the
watchers) so the watcher and the parser can't drift onto different pages.

## When to run

- The daily watch report flags `nato_defexp`, `moe_arms_exports` or
  `mod_defense_report` as changed (a new edition/year landed).
- The user asks to refresh defense / отбрана / NATO %GDP / arms-export data.
- After a fresh clone if `data/defense/gdp_share.json` is missing.

## The data files

All five are small hand-verifiable JSON (a few dozen rows total), served via the
`dataUrl` seam at `/defense/*.json` and committed to the repo (no PG, so no
`recordIngestBatch`). Shapes are typed in `src/data/defense/useDefenseData.tsx`
and read at build time by `scripts/prerender/routes.ts` (defenseFacts) — keep the
field names stable.

## Step 1 — NATO %GDP + equipment split (`nato_defexp`) — AUTOMATED

Run the parser — it downloads the latest def-exp PDF (scraping the news page for
the link, else the conventional `def-exp-YYYY-en.pdf` path), `pdftotext -layout`s
it, pulls Bulgaria's row out of Table 3 (share of real GDP) and Table 8a
(Equipment (a) / Personnel (b)), and rewrites both JSON with the estimate flags,
the 2019-spike note and a sum==100 assert:

```
npx tsx scripts/defense/__write_nato.ts               # download the latest
npx tsx scripts/defense/__write_nato.ts --pdf <path>  # or parse a local PDF
```

The `targets` block (2% Wales, 3.5% core, 5% total by 2035) is written from the
constants in the script — change them there only on a new NATO/Hague decision.
If NATO changes the table layout the parser throws (section-not-found or
Bulgaria-row-not-found) rather than writing garbage — inspect the pdftotext output
and adjust the section regexes in the script.

## Step 2 — Arms exports (`moe_arms_exports`)

The Ministry of Economy's annual report gives the euro value of defence-product
exports by year (+ direct-to-Ukraine). Use these euro figures, **not SIPRI TIV**
(TIV excludes ammunition and so undercounts Bulgaria's real exports by an order of
magnitude). Update `exports.json.series` + `cumulativeSinceInvasionEur`. If МИ is
WAF-blocked, the SIPRI national-reports page for Bulgaria mirrors the report links.

## Step 3 — Readiness (`mod_defense_report`)

From the МО "Доклад за състоянието на отбраната" (via `MOD_DOCS_PAGE`, FlateDecode
→ `pdftotext -layout`): the personnel-vacancy % and reserve-fill %. The budget
split (`personnelEur`, `capitalEur`) comes from the State Budget Law МО line
(convert BGN→EUR at 1.95583). Update `readiness.json`.

## Step 4 — Verify, stamp, commit, sync

1. Sanity-check every file loads and the latest year is present:
   `for f in data/defense/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))"; done`
2. `npm run typecheck` (the hooks read the exact field names).
3. Stamp the ingest:
   ```
   npx tsx scripts/stamp-ingest.ts update-defense --summary "gdp <first>-<last>, exports <year>"
   ```
4. Commit `data/defense/` + `bucket:sync data/defense/` (served from the bucket in
   prod). The /defense prerender + OG re-generate on the next build.

## Mega-programs are MANUAL (`programs.json`)

F-16/Stryker/MMPV/ammo-JV milestones are NOT watched — they change on press events,
not a fixed feed. Edit `data/defense/programs.json` by hand when a milestone lands
(a delivery, a new batch, a delay), citing the source. This follows the one-off
rule: only the recurring PDFs are watched.

## One-off backfill

Historical NATO editions (pre-2025) go behind a `--backfill` flag, documented here,
never in CI — the watcher only tracks the latest edition.
