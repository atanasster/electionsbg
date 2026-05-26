---
name: process-watch-report
description: Compare state/watch/* (what the daily watcher discovered) against state/ingest/* (what each downstream skill last ingested) and invoke every skill whose mapped sources have changed since its last successful run. Use when the user says "process today's watch report", "sync data based on the watcher", "refresh everything that changed", "run the right skills for what changed", or otherwise asks to act on what the daily watcher found. Robust to multi-day gaps between orchestrator runs — never misses an intermediate-day change.
allowed-tools:
  - Read
  - Bash
  - Skill
---

# Process watch report (orchestrator skill)

The daily watcher in `scripts/watch/` writes per-source state to `state/watch/<source>.json` (with a `lastChanged` ISO timestamp) and also produces a human-readable daily report under `data-reports/`. This orchestrator decides what to ingest by comparing watcher state against per-skill ingest markers under `state/ingest/<skill>.json` (with a `lastSuccessfulIngest` timestamp).

Why state-driven, not report-driven? The watcher's `## Changed` section in any one report is relative to the previous watcher run, not the last successful ingest. If a source changed on Monday but the orchestrator wasn't run until Wednesday, Wednesday's report only lists Wednesday's changes — Monday's would be silently missed. State files are the durable truth: `state/watch/<source>.json.lastChanged` is "when did this source last actually move?" and `state/ingest/<skill>.json.lastSuccessfulIngest` is "when did we last ingest that move?". The comparison is invariant under any number of skipped days.

The human-readable reports under `data-reports/` are still useful for narration in the final summary — but they're no longer the decision input.

## Inputs

- `state/watch/<source>.json` for each watcher source — the truth about what's changed when. Always exists once the watcher has run at least once.
- `state/ingest/<skill>.json` for each tier-2 skill that has run successfully under this orchestrator. May be missing on first run after the state-driven migration — see "Bootstrap" below.
- `data-reports/<YYYY-MM-DD>.md` reports — read for narration in the final summary, not for decision-making.

## Source → skill mapping

The "Changed" section of the report contains a bulleted list. Each bullet's label maps to a downstream skill:

| Source label in the report (label prefix is enough) | Skill to invoke |
|---|---|
| `Parliament roll-call votes` | `update-rollcall` |
| `Parliament MPs` (active roster) | `parliament-scrape` |
| `BG Wikipedia polls` | `update-polls` |
| `BG Wikipedia governments list` | _manual edit required — see "Governments: manual edit first" below_ |
| `Сметна палата declarations registry` | `update-connections` |
| `Сметна палата declarations — executive (officials)` | `update-officials` |
| `Сметна палата declarations — municipal (mayors & councillors)` | `update-officials` (Step 1b — municipal ingest) |
| `data.egov.bg Commerce Registry` | `update-connections` |
| `data.egov.bg АОП` (procurement) | `update-procurement` |
| `АОП debarred-suppliers register` | `update-procurement` (Step 5 — debarred-list refresh) |
| `ИСУН EU funds` (beneficiaries) | `update-funds` |
| `data.egov.bg бюджет` (budget execution) | `update-budget` |
| `Per-ministry execution reports` (програмен бюджет) | `update-budget` |
| `Доклад за състоянието на администрацията (IISDA)` | `update-budget` (resolve new file id first — see `iisda_doklad` describe-line) |
| `Агенция "Митници" — Митническа хроника` annual reports | `update-budget` (revenue-breakdown sub-step — runs `scripts/budget/run_customs_revenue.ts`; see "Revenue-breakdown ingest" below) |
| `НАП — Годишен отчет за дейността` | `update-budget` (revenue-breakdown sub-step — runs `scripts/budget/run_nap_annual.ts`; see "Revenue-breakdown ingest" below) |
| `НОИ — месечни B1 отчети по фондове` | `update-noi` (manual download to `raw_data/budget/noi/`, then `tsx scripts/budget/noi/__write_funds.ts`) |
| `ДВ — Инвестиционна програма за общински проекти` | `update-budget` (investment-program sub-step — fetch PDF to `raw_data/budget/investment_program/{year}-annex-iii.pdf`, then `tsx scripts/budget/investment_program/__write_program.ts`) |
| `Общински капиталови програми` (per-município capital lists) | `update-budget` (capital-programmes sub-step — for each (year/muni) flagged in the watcher's describe-line, fetch the source file into `raw_data/budget/capital_programs/<muni>-<year>.{xlsx,pdf}` and run `tsx scripts/budget/capital_programs/<muni>.ts --year <year>` — see "Capital-programmes ingest" below) |
| `Сметна палата party financing` | `update-financing` |
| `Сметна палата annual-report index` | `update-financing` (annual-report year added — runs `scrape_reports.ts`) |
| `Eurostat macro` (BG) | `update-macro` |
| `EC EU budget per-MS spreadsheet` (BG receipts/contributions) | `update-macro` |
| `World Bank WGI` (BG) | `update-macro` |
| `Transparency International CPI` (BG) | `update-macro` (manual paste required first — see below) |
| `BNB domestic ДЦК auctions` | `update-macro` (re-scrapes debt-emissions list) |
| `Minfin КФП monthly bulletins` | `update-macro` (re-scrapes fiscal-reserve via Wayback) |
| `Minfin programme-budget execution reports` (МФ via Wayback) | `update-budget` (operator backfills `raw_data/budget/exec-admin-ministerstvoto-na-finansite-<fy>.pdf` from the Wayback URL in the watcher's describe-line, then activates the manual-pdf entry in `EXECUTION_REPORTS`) |
| `МВнР programmatic execution reports` (via Wayback) | `update-budget` (when a new fiscal-year ZIP lands at `mfa.bg/upload/<id>/...програмен отчет МВнР <date>.zip`, add an `xlsx-in-zip` entry to `EXECUTION_REPORTS` with `entryName: "1100-Otchet programi <YYYY>12_MVnR.xlsx"` — the existing FY2023 entry is the template) |
| `Eurostat regional` (BG) | `update-regional` |
| `AZ (Агенция по заетостта)` | `update-indicators` + `update-regional` |
| `МОН: ДЗИ резултати` | `update-indicators` |
| `НСИ: население по общини` | `update-indicators` |
| `НСИ: раждания, умирания и миграция по общини` | `update-indicators` |
| `ГРАО: население по постоянен и настоящ адрес` | `update-grao` |
| `CIK news` (if re-enabled) | _no skill yet — surface as TODO_ |

Some sources map to the same skill (`update-connections` handles both declarations and Commerce Registry); dedupe so it only runs once.

### Governments: manual edit first

`wiki_governments` is special — `data/governments.json` is hand-maintained from the BG Wikipedia governments-list page, and no ingest script exists. The watcher detects when the page is edited (new cabinet row added, end-date filled on the incumbent, coalition footnote updated) but cannot itself update the JSON.

When this source flips, surface it under a dedicated "Manual action required" block in the plan with the change signal from `state/watch/wiki_governments.json` (`detail` field and the `describe()` line, which distinguishes "+N cabinet row(s)" from "tail of page edited"):

> Manual action required: `wiki_governments` flipped — `{describe-line}`. Check the BG Wikipedia governments-list page (https://bg.wikipedia.org/wiki/Списък_на_правителствата_на_България) and edit `data/governments.json` to add the new cabinet, update the previous incumbent's `endDate` + `endReason`, or fix the coalition footnote. Then re-run the orchestrator.

The user must edit the file by hand. There is no marker to stamp; the next orchestrator run will re-surface the change until the fingerprint matches a future state (i.e. the watcher won't auto-resolve — once the user has done the edit, they can run `npx tsx scripts/stamp-ingest.ts wiki_governments --summary "manually edited data/governments.json"` to stamp).

If the user says "skip governments for this run", drop it from the plan without stamping.

### TI CPI: manual paste first

`transparency_cpi` is special. The CPI values live in a hand-curated `TI_CPI` array at `scripts/macro/fetch_eurostat.ts:572`; the watcher detects when TI publishes a new annual score, but `update-macro` itself does not re-scrape the country page. So when this source flips:

1. **Do not auto-queue `update-macro` for it yet.** Instead, surface it under a dedicated "Manual action required" block in the plan with the new score from `state/watch/transparency_cpi.json` (the `meta.year` and `meta.score` fields):

   > Manual action required: `transparency_cpi` flipped to `{year} CPI = {score}/100`. Paste `{ year: {year}, value: {score} }` into the `TI_CPI` array at `scripts/macro/fetch_eurostat.ts:572`, then re-run `/update-macro`.

2. **If the user confirms they've pasted (or invokes the orchestrator again after the paste),** treat `transparency_cpi` like any other `update-macro` source and queue it. The skill will re-run, write the new point into `data/macro.json`, and the marker stamps as usual.

3. If the user says "skip CPI for this run", drop it from the queue without stamping — the next orchestrator run will surface it again.

### Capital-programmes ingest (`capital_programs`)

The 5 ingested общини (Sofia, Plovdiv, Burgas, Stara Zagora, Ruse) each publish an annual капиталова програма on their own website. The watcher tracks all 5 sources under one fingerprint; its describe-line names exactly which `<year>/<muni>` entries flipped.

Each município has its own parser script (different source formats: Sofia + Burgas = XLSX, Plovdiv + Stara Zagora = PDF), but a shared output schema under `data/budget/capital_programs/{year}/{muni}.json`. Operator workflow when the source flips:

1. **Identify which (year, muni) entries flipped** from the watcher's describe-line — e.g. `"2 capital programme(s) re-uploaded: 2025/sofia, 2025/burgas"`.

2. **Fetch each flagged source** into `raw_data/budget/capital_programs/`. The URLs are catalogued in `CAPITAL_PROGRAM_URLS` in `scripts/watch/sources/capital_programs.ts`; mirror to disk with a browser UA:
   ```bash
   curl -sL -A "Mozilla/5.0" \
     -o raw_data/budget/capital_programs/<muni>-<year>.<ext> \
     "<url from CAPITAL_PROGRAM_URLS>"
   ```
   For Stara Zagora, the catalogued URL is a ZIP — extract the `pr 4 KV*.pdf` file from it. For Sofia/Burgas use the `.xlsx` extension; Plovdiv uses `.pdf`.

3. **Run the matching ingest script** per flagged município:
   ```bash
   tsx scripts/budget/capital_programs/sofia.ts --year <year>
   tsx scripts/budget/capital_programs/plovdiv.ts --year <year>
   tsx scripts/budget/capital_programs/burgas.ts --year <year>
   tsx scripts/budget/capital_programs/stara_zagora.ts --year <year>
   tsx scripts/budget/capital_programs/ruse.ts --year <year>
   ```
   Each writes `data/budget/capital_programs/{year}/{muni}.json` and prints the recap total + per-район or per-village breakdown for canary verification.

4. **Adding a new year** (e.g. when 2026 programmes publish in spring): also add the new (year → urls) entry to `CAPITAL_PROGRAM_URLS` in `scripts/watch/sources/capital_programs.ts` AND update the `SOURCE_URLS` map at the top of each parser. Adding a 5th município follows the existing pattern: write a parser under `scripts/budget/capital_programs/<muni>.ts`, add a row to `CAPITAL_PROGRAM_URLS`, build a frontend tile (see the existing `{Sofia,Plovdiv,Burgas,StaraZagora}CapitalProjectsTile.tsx` for design variants).

After running, stamp `update-budget` with a summary like `"capital_programs: refreshed sofia+burgas 2025"`.

### Revenue-breakdown ingest (`customs_revenue`, `nap_annual`)

Both these sources publish annually — `customs_revenue` (Митническа хроника) in March of T+1 and `nap_annual` (НАП Годишен отчет) also in March of T+1. They share the `update-budget` mapping but run two separate scripts that aren't part of `npm run budget:ingest` yet:

- `customs_revenue` flip → run `npx tsx scripts/budget/run_customs_revenue.ts` (writes `data/budget/revenue_breakdown/customs/<year>.json` for each year in `MITNICHESKA_HRONIKA_REPORTS`).
- `nap_annual` flip → run `npx tsx scripts/budget/run_nap_annual.ts` (writes both `data/budget/revenue_breakdown/vat/<year>.json` and `data/budget/revenue_breakdown/pit/<year>.json`).

When the watcher describe-line says `"N new year(s) added"`, the operator first needs to look up the freshly-published PDF URL and add it to the relevant catalogue:

- Customs: `MITNICHESKA_HRONIKA_REPORTS` in `scripts/budget/customs_revenue.ts`. New URLs come from `customs.bg/wps/portal/agency/media-center/customs-chronicle/mh<YYYY>` (linked from the chronicle index page, but the actual PDF URL is opaque-UUID — find it via WebSearch with `site:customs.bg Mitnicheska_hronika <YYYY>`).
- НАП: `NAP_ANNUAL_REPORTS` in `scripts/budget/nap_annual.ts`. New URLs come from `nra.bg/wps/portal/nra/za-nap/osnovni-dokumenti/Godishni-otcheti-za-deynostta-na-NAP` (same opaque-UUID problem; find via `site:nra.bg "Годишен отчет НАП" <YYYY>`).

If the describe-line is `"N report(s) re-uploaded"` instead, no curation needed — just run the script with `--refresh` to bypass the cache and re-ingest.

After the script runs, stamp `update-budget` with a summary like `"customs: backfilled 2025; vat/pit: 2024 only"`.

## Source → skill mapping (canonical)

Each watcher source maps to one or more downstream skills. Multiple sources can map to the same skill (deduped at queue-build time); a single source can also fan out to several skills (`indicators_az` feeds both `update-indicators` for the municipality rate and `update-regional` for the oblast long-term-unemployment series) — queue each, then dedupe:

| Watcher source id (state/watch/&lt;id&gt;.json) | Mapped skill |
|---|---|
| `parliament_votes` | `update-rollcall` |
| `parliament_mps` | `parliament-scrape` |
| `wiki_polls` | `update-polls` |
| `wiki_governments` | _no skill — manual edit of `data/governments.json` required; see "Governments: manual edit first" below_ |
| `cacbg_declarations` | `update-connections` |
| `cacbg_officials` | `update-officials` |
| `cacbg_local` | `update-officials` (Step 1b — municipal ingest) |
| `egov_commerce` | `update-connections` |
| `egov_procurement` | `update-procurement` |
| `aop_debarred` | `update-procurement` (Step 5 — debarred-list refresh) |
| `isun_eu_funds` | `update-funds` |
| `egov_budget_execution` | `update-budget` |
| `ministry_execution_reports` | `update-budget` |
| `iisda_doklad` | `update-budget` |
| `customs_revenue` | `update-budget` (revenue-breakdown sub-step — re-runs `scripts/budget/run_customs_revenue.ts`) |
| `nap_annual` | `update-budget` (revenue-breakdown sub-step — re-runs `scripts/budget/run_nap_annual.ts`) |
| `nssi_b1` | `update-noi` (operator manually downloads the new B1 XLS files into `raw_data/budget/noi/`, then runs `scripts/budget/noi/__write_funds.ts` — auto-fetch is blocked by an NSSI redirect-to-homepage on GET) |
| `dv_investment_annex` | `update-budget` (investment-program sub-step — operator adds the new fiscal year to both `INVESTMENT_ANNEX_URLS` in `scripts/watch/sources/dv_investment_annex.ts` AND the `SOURCES` map in `scripts/budget/investment_program/__write_program.ts`, fetches the PDF into `raw_data/budget/investment_program/{year}-annex-iii.pdf`, then runs `scripts/budget/investment_program/__write_program.ts`) |
| `capital_programs` | `update-budget` (capital-programmes sub-step — see "Capital-programmes ingest" below; covers Sofia, Plovdiv, Burgas, Stara Zagora) |
| `smetna_palata` | `update-financing` |
| `financing_reports` | `update-financing` |
| `eurostat` | `update-macro` |
| `ec_budget_per_ms` | `update-macro` |
| `worldbank_wgi` | `update-macro` |
| `transparency_cpi` | `update-macro` (gated — see "TI CPI: manual paste first" below) |
| `bnb_auctions` | `update-macro` (debt-emissions sub-step — re-runs `fetch_bnb_auctions.ts`) |
| `minfin_mreports` | `update-macro` (fiscal-reserve sub-step — re-runs `fetch_fiscal_reserve.ts`) |
| `minfin_program_otchet` | `update-budget` (operator backfills the new MoF ProgOtchet PDF from Wayback into `raw_data/budget/exec-admin-ministerstvoto-na-finansite-<fy>.pdf` and activates the matching `manual-pdf` entry in `EXECUTION_REPORTS`) |
| `mfa_program_otchet` | `update-budget` (when a new MVnR fiscal year lands in Wayback, add an `xlsx-in-zip` entry to `EXECUTION_REPORTS`. The describe-line shows the latest period; the FY2023 entry in `fetch_sources.ts` is the template) |
| `eurostat_regional` | `update-regional` |
| `indicators_az` | `update-indicators` + `update-regional` |
| `indicators_mon_dzi` | `update-indicators` |
| `indicators_nsi_pop` | `update-indicators` |
| `indicators_nsi_vital` | `update-indicators` |
| `grao` | `update-grao` |
| `cik` (if re-enabled) | _no skill yet — surface as TODO_ |

## Procedure

1. **Enumerate state.** Inspect both directories via Bash. Each watcher source has `lastChanged`; each ingested skill has `lastSuccessfulIngest`.

   ```bash
   # Watcher state — one per source
   for f in state/watch/*.json; do
     jq -r --arg name "$f" '"\($name) lastChanged=\(.lastChanged // "?")"' "$f"
   done

   # Ingest markers — one per skill (may be empty on first run)
   for f in state/ingest/*.json; do
     [ "$f" = "state/ingest/.gitkeep" ] && continue
     jq -r --arg name "$f" '"\($name) skill=\(.skill) lastSuccessfulIngest=\(.lastSuccessfulIngest)"' "$f"
   done
   ```

2. **Build the work queue.** For each watcher source:
   - Look up its mapped skill in the table above. If no mapping, log it as "skipped — no handler" and move on.
   - Read the mapped skill's `state/ingest/<skill>.json`:
     - **Missing marker (skill never stamped)** → queue the skill AND flag "first-run bootstrap"; see "Bootstrap" below before invoking.
     - **`lastChanged > lastSuccessfulIngest`** → queue the skill.
     - **`lastChanged <= lastSuccessfulIngest`** → skip (already ingested this change).

   Dedupe the queue: if `cacbg_declarations` and `egov_commerce` both flag `update-connections`, queue it once. Preserve the watcher-source-order so the user sees a stable plan.

3. **Confirm the plan with the user before doing destructive work.** Print which sources triggered which skills and the estimated work. Example:

   > Plan for orchestrator run:
   > - `update-macro` ← `eurostat` (changed 2026-05-09, last ingest 2026-05-07) — ~30s
   > - `update-financing` ← `smetna_palata` (changed 2026-05-11, never ingested) — first run, ~10s
   > Proceed?

   Wait for user confirmation (or proceed automatically if they already said "go" / "run all" / "yes proceed"). If the queue is empty, print "Nothing to ingest — every changed source has already been processed since its last change" and stop.

4. **Invoke each skill in sequence.** Use the `Skill` tool, one skill at a time. Don't parallelise — they can conflict on `data/` writes. Capture each invocation's actual stdout (counts, file paths, status) for the final summary. Do NOT paraphrase as "done" — quote specifics.

   Before the next invocation, run `git diff --stat data/` to capture what physically changed on disk vs. what the skill claims. The diff is truth; skill output is narration.

5. **Stamp success.** After each skill completes without error, run:

   ```bash
   npx tsx scripts/stamp-ingest.ts <skill-name> --summary "<one-line recap>"
   ```

   This writes `state/ingest/<skill>.json` with `lastSuccessfulIngest = now`. If the skill threw, do NOT stamp — the orchestrator's halt-on-error rule below applies.

   The summary should reflect what was actually ingested (e.g. `"2 new sessions through 2026-05-10"` for rollcall, `"15 years tracked, 0 net change"` for financing). It lives in the marker file and shows up in `git log -p state/ingest/`.

   **Then append a row to the public data-changes log — but only when data actually changed.** The `/data-changes` SPA page is for readers, not auditors; it should list substantive refreshes, not bootstrap stamps or fetchedAt-only churn. Use `git diff --stat data/` (the truth) as the gate:

   ```bash
   # If the skill actually wrote new/changed bytes under data/, append.
   # If the diff is empty (or only metadata files moved), skip.
   if [ -n "$(git diff --stat data/)" ]; then
     npx tsx scripts/append-data-change.ts <skill-name> \
       --summary "<same one-line recap>" \
       --source "<upstream label, e.g. 'Eurostat macro (BG)'>"
   fi
   ```

   Use the same `--summary` text as the stamp — keeping the two in sync means `git log -p state/ingest/` and the public page tell the same story. The script is also defensive: it auto-skips when the summary matches no-op patterns (`bootstrap:`, `unchanged`, `no data changes`, `only fetchedAt diff`, `timestamp-only diff`, `no run`), so a stray call won't pollute the page — but `git diff --stat` is the cleaner upstream gate.

   **Specifically do NOT append for:**
   - Bootstrap stamps (option (a) from "Bootstrap" above — `"bootstrap: marker seeded, no run"`).
   - Skills that ran but produced no on-disk data diff (e.g. macro where every series is current).
   - Watcher-fingerprint flips that were chrome-only (financing's `subsidii` page churn, etc.).

   **Re-seed (rarely):** if you ever need to rebuild `data/data-changes.json` from current `state/ingest/*.json` markers, run `npx tsx scripts/seed-data-changes.ts`. The seeder applies the same no-op filter, so it's safe to re-run.

## Bootstrap (first orchestrator run after this migration)

When `state/ingest/<skill>.json` is missing for a queued skill, you have two paths — ASK the user which:

**(a) Treat current state as the baseline (recommended for established repos)**
Stamp the marker to `now` without actually running the skill. This says "everything up to this moment is considered ingested; future changes will trigger ingest normally". Use when the user knows the existing data is up to date (typical case — the repo has already had ingests via earlier workflows).

```bash
npx tsx scripts/stamp-ingest.ts <skill-name> --summary "bootstrap: marker seeded, no run"
```

**(b) Actually run the skill (true backfill)**
For a clean clone, an explicit backfill, or when the user is unsure whether existing data is current. The skill runs, ingests anything new, then the marker is stamped on success.

Default to asking unless the user said "bootstrap markers" or "run all" or similar upfront.

6. **Final summary (REQUIRED).** Once all skills have run, print a structured per-skill recap. This is the deliverable — never collapse it into "all done" or a single paragraph. Format:

   ```markdown
   # Watch report ingest — YYYY-MM-DD

   ## <skill-name> · <upstream label from report>
   - **What ran**: one line describing the action.
   - **Captured**: bullet list of concrete things (counts, file paths, new entries with dates/ids).
   - **Files changed**: `git diff --stat` output for the relevant subdir, or "no changes".
   - **Status**: ok | not_implemented | partial | error
   - **Notes**: anomalies surfaced by the skill (e.g. unresolved MP ids, missing canary, retries).

   ## <skill-name> · <upstream label>
   ...

   ## Skipped (no automated handler)
   - **<source label>**: short reason + suggested next step.

   ## Next steps
   - `git status` summary if there are uncommitted changes
   - Suggested commit message (one per logical group of files)
   - Suggested bucket deploy command — see "Bucket deploy" below
   - Whether to `git push` or hold
   ```

   **For a "no changes detected" run** (skill executed but found nothing new — e.g. `update-rollcall` walking past the last known stenogram id and finding no new sessions), explicitly write `**Status**: ok — no data changes detected` and `**Files changed**: none`. Do NOT silently omit the skill from the summary — the user must see that it ran and found nothing.

   **For a "partial" status** (skill produced some output but also surfaced anomalies — unresolved MP ids, mismatched names, etc.), name each anomaly in the **Notes** field. The data was written; the warning is what the user needs to act on.

   **For an "error" status** (skill threw), copy the error message verbatim and stop the orchestrator — don't proceed to the next skill until the user decides how to handle.

   **Quote concrete numbers from skill stdout.** If `update-rollcall` printed `+ 2026-05-09 (id 11124): 11 item(s), 2640 rows · 37 unresolved id(s) → sessions/2026-05-09.json`, that's the kind of detail that belongs in **Captured**. If `update-macro` printed `Loading gdpGrowth (eurostat)... 84 points (latest 2025 Q4)` for 22 indicators, summarise: "22 indicators refreshed; latest period 2025 Q4 (quarterly), 2025 (annual)" — but if any indicator's count changed, name it.

   ### Bucket deploy

   After committing, `data/` lives in two places: the git repo (history, audit) and `gs://data-electionsbg-com` (what the live SPA fetches). The bucket is the one users see. The Next steps section MUST always include the deploy commands when anything under `data/` was modified:

   ```bash
   npm run bucket:sync:dry    # preview which files would upload
   npm run bucket:sync        # push to gs://data-electionsbg-com
   ```

   `bucket:sync` rsyncs the entire `data/` directory (everything: JSON + .webp photos + anything else); `-j json,svg,xml,txt,html,css,md` controls which extensions get gzip transport encoding, not which files upload. The Cache-Control is `public, max-age=3600, stale-while-revalidate=604800` — fresh content propagates within an hour, with SWR letting the SPA serve a slightly-stale copy in the meantime.

   When `Files changed` is "none" for every skill, omit the bucket-sync lines from Next steps — there's nothing new to push. If even one skill wrote files, include them.

   Code/UI changes are out of scope for this orchestrator (`npm run deploy` deploys the Firebase bundle and is not needed for pure-data refresh).

## Examples

### Nothing to ingest

Every watcher source's `lastChanged` is older than or equal to its mapped skill's `lastSuccessfulIngest`. Response:

> Nothing to ingest — all 7 sources are at or behind their last successful ingest. Watcher last ran <UTC>.

### Single change

```
state/watch/wiki_polls.json:    lastChanged = 2026-05-11T01:30:00Z
state/ingest/update-polls.json: lastSuccessfulIngest = 2026-05-04T01:30:00Z
```

Queue: `update-polls`.

### Multiple changes, dedupe

```
state/watch/cacbg_declarations.json:  lastChanged = 2026-05-10T...
state/watch/egov_commerce.json:       lastChanged = 2026-05-11T...
state/watch/eurostat.json:            lastChanged = 2026-05-09T...
state/ingest/update-connections.json: lastSuccessfulIngest = 2026-05-01T...
state/ingest/update-macro.json:       lastSuccessfulIngest = 2026-05-05T...
```

Queue (deduped, declarations + commerce both → update-connections):
1. `update-connections`
2. `update-macro`

### Multi-day gap (the case option B fixes)

You haven't run the orchestrator for 4 days. During that window:
- Tuesday: `eurostat` flipped → `eurostat.lastChanged = Tue`
- Wednesday: `wiki_polls` flipped → `wiki_polls.lastChanged = Wed`
- Friday: `parliament_votes` flipped → `parliament_votes.lastChanged = Fri`

Each downstream skill's `lastSuccessfulIngest` is still Monday's value. The orchestrator queues all three (`update-macro`, `update-polls`, `update-rollcall`) — none are missed, even though the latest report file only mentions Friday's change.

### Unmapped source

```
state/watch/cik.json: lastChanged = ... (changed)
mapping: no skill yet
```

Surface in the final summary's `## Skipped` section: "CIK news & decisions changed but has no automated handler — manual investigation needed."

Response: "1 changed source but no automated handler — `CIK news & decisions`. Manual investigation needed. Nothing to invoke."

### Worked example: full summary for a typical 2-skill run

Today's report flagged Eurostat releases + a Сметна палата page change. Plan: `update-macro` then `update-financing`. After both run, the orchestrator's final output looks like this:

```markdown
# Watch report ingest — 2026-05-11

## update-macro · Eurostat macro (BG): 13 datasets
- **What ran**: re-fetched all 22 macro indicators (13 Eurostat + 3 World Bank + 6 curated).
- **Captured**:
  - 7 series with new upstream releases since last commit: sts_trtu_m, sts_inpr_q, ilc_di12, ilc_li02, namq_10_a10, ei_bssi_m_r2, prc_hpi_q.
  - All 22 series passed the absolute floor + 10% regression check.
  - Latest periods: gdpGrowth 2025 Q4, inflation 2026 Q1, wgiRuleOfLaw 2024.
- **Files changed**:
  ```
  data/macro.json | 12 ++++++++----
  ```
- **Status**: ok
- **Notes**: none.

## update-financing · Сметна палата party financing
- **What ran**: re-scraped bulnao.government.bg/bg/kontrol-partii/.
- **Captured**:
  - otcheti section: 15 years (2011-2025), status=ok, all gfopp URLs intact.
  - subsidii section: status=not_implemented (skipped as expected).
- **Files changed**: none (year list identical to prior commit).
- **Status**: ok — no data changes detected (the watcher fingerprint flipped, but the structured year list is unchanged; the upstream page change was in chrome).
- **Notes**: subsidii still needs a Playwright-based ingest if the user wants the audit-reports list captured.

## Skipped (no automated handler)
_(none)_

## Next steps
- 1 file modified: `data/macro.json`. Suggested commit:
  ```bash
  git add data/macro.json
  git commit -m "macro: refresh through 2026 Q1 (7 new Eurostat releases)"
  ```
- Deploy to bucket (fresh data takes ≤ 1h to propagate):
  ```bash
  npm run bucket:sync:dry    # preview
  npm run bucket:sync        # push to gs://data-electionsbg-com
  ```
- No `git push` needed yet — user decides.
```

The summary is mandatory whether or not data changed. A "no changes detected" run still gets a section per executed skill so the user can see what was checked.

## Data-integrity contract (CRITICAL)

This orchestrator MUST NOT claim success it didn't earn. Specifically:

1. **Trust downstream skills to fail loud.** Every tier-2 ingest skill is built to throw rather than write empty/partial data when upstream restructures. If a Skill invocation returns an error (or its terminal output contains "Error:", a stack trace, or otherwise signals failure), treat that source as **failed**, not "completed with warnings".

2. **Halt on first failure by default.** When a downstream skill fails, STOP the orchestration. Do not proceed to the next mapped skill. Report which skill failed and what error, then ask the user whether to (a) skip and continue with the rest, (b) abort entirely, or (c) investigate.

3. **Never paraphrase ingest output as "done".** Read the actual stdout. Quote the relevant success/failure marker. Examples:
   - `update-rollcall` success looks like `+ YYYY-MM-DD (id N): K item(s), R rows · U unresolved id(s) → sessions/<date>.json` for each session, plus a final summary.
   - `update-financing` success looks like a per-section recap (`· <section>: N years` or `· <section>: not_implemented`).
   - If you don't see those lines, the skill did not write data for that target — say so.

4. **Don't hallucinate counts.** When reporting back, use exact numbers from the skill's actual stdout. If a skill says "found 0 new sessions, nothing to ingest" that is a legitimate result for weekends/recess — report it as zero, do not invent a number.

5. **Surface `not_implemented` separately.** Some skills (like `/update-financing`'s subsidii section) intentionally report `not_implemented` for parts they can't yet handle. Pass that through to the user verbatim — don't fold it into "success".

6. **Errors section of the latest report.** The watcher's own `## Errors` section in the most recent report file lists upstream-fetch failures. Surface those to the user but **do not auto-retry them via this orchestrator** — the watcher will re-probe them on its next run. Manual investigation only.

7. **Only stamp `state/ingest/<skill>.json` on success.** If the skill threw, do NOT stamp. The next orchestrator run will re-detect the source as still-needing-ingest and re-queue the skill. This is the self-healing property — a transient failure isn't masked.

8. **Manual skill invocations don't stamp.** If the user runs `/update-rollcall` directly (outside the orchestrator), no marker is written. The orchestrator's next run will see `source.lastChanged > skill.lastSuccessfulIngest` and re-queue the skill. Since every tier-2 skill is idempotent on no-op input (rollcall walker finds no new sessions, financing scraper writes the same 15 years, etc.), this is wasteful at most — never wrong. The user can manually stamp after a direct run: `npx tsx scripts/stamp-ingest.ts <skill-name>`.

## What this skill does NOT do

- **Does not re-run the watcher.** State files are the input. If you want fresh fingerprints, run `npm run watch` first.
- **Does not commit or push.** Each downstream skill handles its own commit policy. After all skills finish, the user decides whether to `git push`.
- **Does not auto-retry the watcher's Errors section.** Surfaced to the user only.
- **Does not silently skip failed skills.** A downstream failure halts the orchestrator until the user decides how to proceed (see Data-integrity contract above).
- **Does not skip a queued skill just because the latest report doesn't mention it.** The decision is state-driven (`lastChanged` vs `lastSuccessfulIngest`), not report-driven. Multi-day gaps still get fully ingested.

## Quick command reference

```bash
# Inspect today's report manually
cat data-reports/latest.md

# List recent reports
ls -t data-reports/ | head -5

# Trigger this orchestrator (you, by saying "process today's watch report")
# — the user invokes it via /process-watch-report in chat.
```
