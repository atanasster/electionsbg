---
name: update-rollcall
description: Ingest new parliament.bg roll-call vote sessions into data/parliament/votes/. Use when the daily watch report flags new sessions ("Parliament roll-call votes: N new sessions"), when the user asks to refresh roll-call data, backfill votes for a parliament, investigate a flagged canary mismatch, or rebuild the per-MP loyalty/attendance/similarity/cohesion metrics.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Roll-call skill

Pulls per-MP roll-call vote data from parliament.bg's stenogram CSV attachments ("Поименно гласуване") and writes canonical JSON to `data/parliament/votes/`. Optionally uploads to the GCS bucket and rebuilds the derived loyalty/attendance/similarity/cohesion metrics.

## When to run

| Trigger                                                              | Action                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily watcher reports `Parliament roll-call votes: N new session(s)` | Run incremental ingest (`npm run rollcall:scrape`)                                                                                                                                                       |
| User asks to "refresh roll-call" or "ingest new votes"               | Same — incremental                                                                                                                                                                                       |
| `data/parliament/votes/` is empty (fresh clone)                      | Cold-start ingest from the canary id (defaults to id 11100, ~Feb 2026)                                                                                                                                   |
| Canary mismatch warning surfaced in a recent ingest                  | Investigate `scripts/parliament/rollcall/parse.ts` BEFORE re-running                                                                                                                                     |
| Derived loyalty/similarity/cohesion metrics look stale               | They shouldn't — the ingest rebuilds them in-process after every run that ingests ≥1 session (Step 5). To force a standalone rebuild (e.g. after editing a metric script), run `npm run derived:rebuild` |

## Step 1 — Prerequisites

The ingest depends on `data/parliament/index.json` (the MP roster). If you got a "data/parliament/index.json not found" error or you're on a fresh clone, run the parliament-scrape skill FIRST:

```bash
npx tsx scripts/parliament/scrape_mps.ts --all --refresh-current
```

That writes the MP roster used to validate that every vote row refers to a known MP id.

## Step 2 — Incremental ingest

```bash
npm run rollcall:scrape
```

Walks parliament.bg stenogram ids forward from the last-known max (stored in `data/parliament/votes/index.json`), discovers new plenary sessions, downloads their roll-call CSVs, validates, and writes one JSON file per session day under `data/parliament/votes/sessions/`.

Expected output on a normal day:

```
→ walking pl-sten forward from id 11130 (gap-stop 30, max 500)
  scanned id=11150, found=2
  found 2 new stenogram(s)
→ running canary on pinned stenogram 11120
  canary OK (sha256=8a3f4d1c…)
→ ingesting 2 session(s)
  + 2026-04-30 (id 11140): 8 item(s), 1920 rows → sessions/2026-04-30.json
  + 2026-05-02 (id 11141): 12 item(s), 2880 rows → sessions/2026-05-02.json
✓ wrote data/parliament/votes/index.json (47 session(s))
```

If the canary line is missing, the canary id was inside the new batch (the run treated it as part of normal ingest, which also seeds/validates the fixture). That's fine.

## Step 3 — Verify

Quick sanity:

```bash
node -e "
const idx = require('./data/parliament/votes/index.json');
console.log('NS:', idx.ns, 'sessions:', idx.sessions.length, 'last:', idx.lastDate);
const latest = require('./data/parliament/votes/' + idx.sessions[idx.sessions.length-1].file);
console.log('Latest day:', latest.date, 'items:', latest.sessions.length);
console.log('Tallies item 1:', latest.sessions[0].tallies);
"
```

You should see:

- `sessions:` count incremented by the number reported in the run.
- `Tallies item 1:` summing to roughly 240 (seated count ± a few for swearing-in days).

Check the diff before committing:

```bash
git diff --stat data/parliament/votes/
```

Should be: `index.json` modified + N new files under `sessions/`. If you see >5% of the existing tree touched, the ingest aborted with a "diff cap exceeded" error — investigate why before bypassing.

## Step 4 — Upload to bucket

Two options:

```bash
# Combined: ingest + upload in one pass
npm run rollcall:scrape -- --upload

# Or upload separately after the ingest
gsutil -m -h "Cache-Control:no-cache, max-age=0" rsync -r -J \
  data/parliament/votes/ gs://data-electionsbg-com/parliament/votes/
```

The combined form uses `scripts/lib/upload.ts` and applies the right Cache-Control headers automatically.

## Step 5 — Derived metrics (automatic — runs inside the ingest)

The derived loyalty / attendance / similarity / cohesion / embedding / party-correlation / topic+search index / dissents / party-pair-breaks metrics and the per-MP shards are a **pure function of the session files on disk**, so any newly-ingested (or re-ingested) session invalidates them. `scrape_rollcall` therefore rebuilds them **in-process right after writing the index**, whenever the run ingested ≥1 session — sub-second over a year of plenary days, so the metrics never lag the votes. When the ingest runs with `--upload`, the same tree push ships the refreshed `derived/` files; in the orchestrator path the subsequent bucket sync does. There is **no separate weekly recompute** — the old `.github/workflows/rebuild-derived.yml` was removed once this became automatic.

Force a standalone rebuild only when you've edited a metric script (no new votes) and want to regenerate without re-walking parliament.bg:

```bash
npm run derived:rebuild           # local only
npm run derived:rebuild -- --upload  # write + upload
```

`scripts/parliament/derived/index.ts` exports `rebuildDerived()` (imported by `scrape_rollcall.ts`); its CLI stays dormant when imported and only runs when invoked directly.

## Step 6 — Commit

```bash
git add data/parliament/votes/ tests/fixtures/parliament/votes/
git commit -m "rollcall: ingest sessions through YYYY-MM-DD"
```

The canary fixture is committed too — that's the regression-test baseline.

## Data-integrity contract

This skill is designed to **fail loud rather than write a corrupt or partial vote record**. The frontend reads these JSONs and treats them as authoritative; silent ingest of wrong data would poison every downstream metric (loyalty, similarity, cohesion).

Surfaces that halt the ingest before any write:

| Surface                                 | Trigger                                                                    | Action                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTP error on parliament.bg             | 5xx after 3 retries, or any 4xx                                            | Throws                                                                   |
| Stenogram body shorter than expected    | API returned non-JSON or empty                                             | Throws                                                                   |
| CSV column missing                      | Header doesn't include NAME/textbox7/etc                                   | Throws naming the missing column                                         |
| Unknown vote code                       | Cell value not in `+/-/=/0/О/П/Р/empty` map                                | Throws naming the code                                                   |
| Session has zero vote items             | Parser found no items in the CSV                                           | Throws                                                                   |
| Tally sum ≠ vote count                  | Indicates parser dropped rows                                              | Throws naming the item                                                   |
| Vote count outside `seated ± tolerance` | Seated 240, vote count outside the band                                    | Throws (override per-run with `--seated-tolerance` for swearing-in days) |
| Canary mismatch                         | Pinned stenogram 11120 produces bytes different from the committed fixture | Throws                                                                   |
| Diff-cap exceeded                       | Run would touch > 5% of existing files                                     | Throws                                                                   |

Surfaces that are **intentionally non-fatal** (and why):

| Surface                                                           | Behaviour                                                                               | Why not a hard fail                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Stenogram has no roll-call CSV                                    | Logged as "skipped" with date + id                                                      | Procedural sessions legitimately have no vote attachments                                                         |
| MP id present in CSV but missing from `data/parliament/profiles/` | Collected into `unresolvedMpIds[]` on the session file; CSV name preserved in `mpNames` | parliament.bg's mp-profile API has known gaps the vote CSVs don't share; rejecting these would discard real votes |
| Walker finds 0 new stenograms                                     | Logged as "nothing to ingest"                                                           | Weekends/recess legitimately have no new sessions                                                                 |

Successful ingest always prints a final summary line per session: `+ YYYY-MM-DD (id N): K item(s), R rows · U unresolved id(s) → sessions/<date>.json`. If you don't see that line, no JSON was written for that session.

## Common pitfalls

### Canary mismatch

The canary id (currently 11120, 2026-04-01) is re-parsed at the start of every run. If the output bytes drift from the committed fixture, the parser regressed — usually because parliament.bg changed the CSV column order or vote-code mapping. Steps:

1. Inspect the diff: `gsutil cat ...` is overkill; just re-fetch the CSV and inspect:
   ```bash
   curl -s -A "Mozilla/5.0" "https://www.parliament.bg/pub/StenD/<filename>.csv" | head -20
   ```
2. Identify the change (new column? new vote code?).
3. Update `scripts/parliament/rollcall/parse.ts` (header detection, `VOTE_MAP`).
4. Re-seed the fixture by deleting it:
   ```bash
   rm tests/fixtures/parliament/votes/canary.json
   npm run rollcall:scrape -- --session-id 11120
   ```
5. Diff the new fixture against git history to verify only intended fields changed.

### Vote count outside tolerance

Validation fails with "item N: vote count X differs from seated 240 by …". Either:

- A new MP was sworn in mid-session day (legitimate); pass `--seated-tolerance 10` to that one run.
- The CSV is genuinely broken (parliament.bg layout change); inspect manually.

Do NOT widen the tolerance permanently — the 5-vote band is intentional. It catches catastrophic parser breakage where rows are silently dropped.

### Unknown MP id

Validation fails with "vote refers to unknown MP id NNNN". The MP roster is stale. Run:

```bash
npx tsx scripts/parliament/scrape_mps.ts --all --refresh-current
```

Then retry the ingest.

### Empty stenograms / 33-byte responses

parliament.bg returns a tiny error stub for non-existent ids. The walker treats these as gaps and stops after 30 consecutive gaps. If you suspect a real gap (e.g. last known id was 11140 and the next is 11200 with 60 in between), bump `WALK_GAP_STOP` in `scripts/parliament/rollcall/api.ts` for that one run, or specify `--session-id` directly.

### Vote code we don't know yet

The parser maps `+/-/=/0/О/П/Р` to `yes/no/abstain/absent`. If a CSV contains a code outside this set the parser throws `unknown vote code: "X"`. Add the mapping to `VOTE_MAP` in `scripts/parliament/rollcall/parse.ts` based on context (look up the MP in the stenogram body to see how parliament.bg describes the absence).

### Backfilling older sessions

The walker walks FORWARD. To backfill older data, pass `--session-id <oldId>` for each known historical stenogram, or temporarily lower `COLD_START_ID` in `scripts/parliament/scrape_rollcall.ts` and re-run. Backfill in batches of ~50 sessions so the diff stays reviewable.

## What this skill does NOT do

- **Does not write frontend UI for the roll-call data.** That's a separate task — once `data/parliament/votes/` is populated and uploaded, hooks under `src/data/parliament/` can fetch through `dataUrl()` and screens consume them.
- **Does not parse stenogram bodies for bill metadata.** v1 stores vote tuples (date, mpId, vote) plus per-item tallies. Bill titles/sponsors will layer on later if needed.
- **Does not auto-fire on its own.** The watcher reports new sessions; the user (or `.github/workflows/ingest-rollcall.yml`) decides when to run this skill.

## File map

| Path                                                                                                                                                                                                                                    | Purpose                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `scripts/parliament/scrape_rollcall.ts`                                                                                                                                                                                                 | CLI entry — walk, ingest, validate, write, upload                                                                             |
| `scripts/parliament/rollcall/api.ts`                                                                                                                                                                                                    | parliament.bg endpoint wrappers + stenogram walker                                                                            |
| `scripts/parliament/rollcall/parse.ts`                                                                                                                                                                                                  | CSV → canonical SessionItem[]                                                                                                 |
| `scripts/parliament/rollcall/validate.ts`                                                                                                                                                                                               | Schema + canary + diff-cap checks                                                                                             |
| `scripts/parliament/derived/index.ts`                                                                                                                                                                                                   | Derived-metrics runner — exports `rebuildDerived()`, auto-invoked by the ingest after each new session; also a standalone CLI |
| `scripts/parliament/derived/{loyalty,attendance,similarity,cohesion,embedding,party_correlation,topic_index,search_index,important_votes,dissents,party_pair_breaks,per_mp_shards}.ts`                                                  | Per-metric writers                                                                                                            |
| `scripts/lib/upload.ts`                                                                                                                                                                                                                 | Shared GCS upload helper (gsutil cp -Z wrapper)                                                                               |
| `data/parliament/votes/index.json`                                                                                                                                                                                                      | Session catalog — committed                                                                                                   |
| `data/parliament/votes/sessions/<YYYY-MM-DD>.json`                                                                                                                                                                                      | One file per plenary day — committed                                                                                          |
| `data/parliament/votes/derived/{loyalty,attendance,similarity,cohesion,embedding,party_correlation,topic_index,search_index,dissents,party_pair_breaks}.json` + `derived/important_votes/<ns>.json` + `derived/per-mp/<ns>/<mpId>.json` | Derived outputs — rebuilt automatically on every ingest that adds a session; committed                                        |
| `tests/fixtures/parliament/votes/canary.json`                                                                                                                                                                                           | Pinned parser regression baseline — committed                                                                                 |

## Quick command reference

```bash
# Daily ingest after watcher flags new sessions
npm run rollcall:scrape

# Ingest + upload + commit in one pass
npm run rollcall:scrape -- --upload
git add data/parliament/votes/ && git commit -m "rollcall: ingest"

# Parse a specific session only (debugging or backfill)
npm run rollcall:scrape -- --session-id 11120

# Dry run (validate without writing)
npm run rollcall:scrape -- --dry-run

# Skip canary (only when intentionally updating the fixture)
npm run rollcall:scrape -- --session-id 11120 --skip-canary

# Standalone derived rebuild (only after editing a metric script — the ingest
# already rebuilds derived metrics in-process after each new session)
npm run derived:rebuild -- --upload
```
