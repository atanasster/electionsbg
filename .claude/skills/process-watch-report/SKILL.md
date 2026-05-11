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

5. **Invoke each skill in sequence.** Use the `Skill` tool, one skill at a time. Don't parallelise — the downstream skills can conflict on `data/` writes. After each skill returns, summarise what it did before moving to the next.

6. **Final summary.** Once all skills have run, print a one-paragraph recap: which sources were touched, what data changed in `data/`, what's left to do (e.g. commit, deploy, manual investigation for unmapped sources).

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

## What this skill does NOT do

- **Does not re-run the watcher.** The report is the input. If you want a fresh fingerprint, run `npm run watch` first.
- **Does not commit or push.** Each downstream skill handles its own commit policy. After all skills finish, the user decides whether to `git push`.
- **Does not act on Unchanged or Errors sections.** Only `## Changed` triggers ingest. Errors are surfaced to the user but not auto-retried.

## Quick command reference

```bash
# Inspect today's report manually
cat data-reports/latest.md

# List recent reports
ls -t data-reports/ | head -5

# Trigger this orchestrator (you, by saying "process today's watch report")
# — the user invokes it via /process-watch-report in chat.
```
