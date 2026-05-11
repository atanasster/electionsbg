---
name: process-watch-report
description: Read the latest daily watch report at data-reports/latest.md (or a specific date) and invoke the matching tier-2 ingest skill for every upstream source flagged as Changed. Use when the user says "process today's watch report", "sync data based on the watcher", "refresh everything that changed", "run the right skills for what changed", or otherwise asks to act on what the daily watcher found.
allowed-tools:
  - Read
  - Bash
  - Skill
---

# Process watch report (orchestrator skill)

The daily watcher in `scripts/watch/` produces a markdown report under `data-reports/` listing which upstream sources changed since the last run. This skill is the bridge from that report to the tier-2 ingest skills — read the report, identify which sources flipped, invoke the matching skill for each.

Use this instead of asking the user to remember which skill maps to which source.

## Inputs

By default, read `data-reports/latest.md` (the file the watcher overwrites on each run). If the user names a date — e.g. "process the 2026-05-11 report" — read `data-reports/2026-05-11.md` instead.

If the file doesn't exist, suggest running `npm run watch` first.

## Source → skill mapping

The "Changed" section of the report contains a bulleted list. Each bullet's label maps to a downstream skill:

| Source label in the report (label prefix is enough) | Skill to invoke |
|---|---|
| `Parliament roll-call votes` | `update-rollcall` |
| `Parliament MPs` (active roster) | `parliament-scrape` |
| `BG Wikipedia polls` | `update-polls` |
| `Сметна палата declarations registry` | `update-connections` |
| `data.egov.bg Commerce Registry` | `update-connections` |
| `Сметна палата party financing` | `update-financing` |
| `Eurostat macro` (BG) | `update-macro` |
| `CIK news` (if re-enabled) | _no skill yet — surface as TODO_ |

Some sources map to the same skill (`update-connections` handles both declarations and Commerce Registry); dedupe so it only runs once.

## Procedure

1. **Read the report.** Default to `data-reports/latest.md`. If the user provided a date, use that file instead. If the file is missing, tell the user to run `npm run watch` first and stop.

2. **Identify changes.** Parse the markdown's `## Changed` section. The body is either `_(no changes — all upstreams stable)_` (do nothing, tell the user the report is clean) or a list of bullets, each starting with `- **<source label>**:` followed by the change detail.

3. **Build the deduped skill list.** Walk each changed source, look up the mapping table above, collect the unique target skills in the order they first appeared. Skip sources with no skill mapping but list them at the end as "no automated handler — manual investigation needed".

4. **Confirm with the user before doing destructive work.** Some of these skills are heavy (multi-minute scrapes, bucket uploads, git commits). Print the plan first:

   > "Today's report has 2 changed sources mapping to 2 skills:
   > 1. `update-macro` — Eurostat new releases (~30s)
   > 2. `update-financing` — Сметна палата party-financing index (~10s)
   > Proceed?"

   Wait for user confirmation (or proceed automatically if they already said "go" / "run all" / "yes proceed").

5. **Invoke each skill in sequence.** Use the `Skill` tool, one skill at a time. Don't parallelise — the downstream skills can conflict on `data/` writes. After each skill returns, capture the actual stdout for the final summary (counts, file paths, status). Don't paraphrase as "done" — extract specifics.

   Before the next invocation, run `git diff --stat data/` (or the specific subdir the skill writes to) to capture what physically changed on disk vs. what the skill claims. The truth is the diff; the skill output is the narration.

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

### Clean report (no changes)

Report's Changed section: `_(no changes — all upstreams stable)_`.

Response: "Today's watch report shows no upstream changes (all 7 sources stable). Nothing to ingest."

### Single change

Report:
```
## Changed
- **BG Wikipedia polls (2026 cycle)**: +3 rows since 2026-05-04 (110 → 113)
```

Plan: invoke `update-polls`.

### Multiple changes, dedupe

Report:
```
## Changed
- **Сметна палата declarations registry**: index hash <new>
- **data.egov.bg Commerce Registry (Търговски регистър)**: 1 new resource on top: …
- **Eurostat macro (BG): 13 datasets**: new release · sts_inpr_q …
```

Plan: 2 skills (declarations + commerce both map to update-connections, dedupe to one invocation):
1. `update-connections`
2. `update-macro`

### Unmapped source

Report:
```
## Changed
- **CIK news & decisions**: 4 new news items, latest: …
```

(CIK is currently in the no-handler bucket.)

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

6. **Errors section of the report.** The watcher's own `## Errors` section lists upstream-fetch failures from the previous day. Surface those to the user but **do not auto-retry them via this orchestrator** — the watcher will re-probe them on its next run. Manual investigation only.

## What this skill does NOT do

- **Does not re-run the watcher.** The report is the input. If you want a fresh fingerprint, run `npm run watch` first.
- **Does not commit or push.** Each downstream skill handles its own commit policy. After all skills finish, the user decides whether to `git push`.
- **Does not act on Unchanged or Errors sections.** Only `## Changed` triggers ingest. Errors are surfaced to the user but not auto-retried.
- **Does not silently skip failed skills.** A downstream failure halts the orchestrator until the user decides how to proceed (see Data-integrity contract above).

## Quick command reference

```bash
# Inspect today's report manually
cat data-reports/latest.md

# List recent reports
ls -t data-reports/ | head -5

# Trigger this orchestrator (you, by saying "process today's watch report")
# — the user invokes it via /process-watch-report in chat.
```
