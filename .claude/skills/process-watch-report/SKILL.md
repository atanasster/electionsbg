---
name: process-watch-report
description: Compare state/watch/* (what the daily watcher discovered) against state/ingest/* (what each downstream skill last ingested) and invoke every skill whose mapped sources have changed since its last successful run, timing every step into an append-only trace, then committing the result and following up with /upload-watch-changes to publish it — unless the run hit a major issue, in which case the manifest is left pending and the operator is asked. Use when the user says "process today's watch report", "sync data based on the watcher", "refresh everything that changed", "run the right skills for what changed", or otherwise asks to act on what the daily watcher found. Robust to multi-day gaps between orchestrator runs — never misses an intermediate-day change.
allowed-tools:
  - Read
  - Bash
  - Skill
---

# Process watch report (orchestrator skill)

**The orchestration is a script now: `pnpm run pipeline:nightly`.** It runs the watcher,
plans from state (`state/watch/*` vs `state/ingest/*`, so a multi-day gap never misses an
intermediate change), runs every due **script** handler with timed, logged steps, applies the
gates and post-steps, commits by explicit pathspec, writes the upload manifest, and publishes
when the publish gate passes. This skill is the agent wrapper around it. It covers what a
script cannot do: the **delegated** handlers, and reading the failure packets.

What runs for which source is in the registry (`scripts/pipeline/registry/`), rendered as
**[docs/pipeline-handlers.md](../../../docs/pipeline-handlers.md)**. This skill no longer
carries a source → skill table. If you need to know what a source does, read that page or run
`pnpm run pipeline:plan`. Design and history: `docs/plans/watch-pipeline-scripts-v1.md`.

## Procedure

1. **Check the machine.** Run `pnpm run pipeline:doctor`. It reports egress (BG or not),
   local Postgres, the Cloud SQL proxy, binaries and drives. A handler whose needs are unmet
   is blocked, not failed. Fix what you can (`pnpm run db:pg:up`, `pnpm run
   db:proxy:cloud`). The VPN is the operator's to flip; never change it yourself.
2. **Run it.** Use `pnpm run pipeline:nightly` for the whole chain (`--no-publish` stops
   after the ingest commit, leaving the manifest for `pipeline:publish`). If the watcher
   already ran today, use `pnpm run pipeline:ingest --publish` instead. A run takes hours,
   longer than any foreground tool timeout, and a background shell dies with the session
   that started it — so from an agent, launch it DETACHED (the `setsid` command below) and
   wait with `pnpm run pipeline:wait --newer-than <launch time>` (Bash timeout 600000). It
   returns within ~9 min: exit 0 = finished (prints the run's final line and report path),
   **75 = still running — call it again with the `--session` it printed; never end the turn
   on a 75**, 3 = the run was killed. Do not wait with a Monitor watch: one expires on its
   own, and the 2026-11-19 routine ended its turn on that expiry with the run still going.
   It stops rather than continues
   when something critical happens:
   - **preflight** (the doctor runs first): git mid-rebase/merge or off `main`, low disk
     (repo volume < 10 GB, Docker VM < 8 GB), or local Postgres down AFTER the run tried
     `pnpm run db:pg:up` itself (the container has been found removed after Docker
     restarts; its data is in the `data-bg_pgdata` volume, so recreating it loses nothing)
     — nothing runs, exit 3;
   - **the watcher** crashes or times out — nothing is ingested, exit 5. Per-source watcher
     errors are NOT critical: they are listed as findings (a streak of 3+ marks the
     `watcher` unit `partial`) and the ingest runs on what the watcher found;
   - **mid-ingest**, a step failing with an environment class (`db-local-down`, `disk`,
     `db-auth`) aborts every later handler and holds the publish — unless the environment
     answers again 10 s later (a restarted container), which is recorded as a transient
     blip and the run goes on. A dropped connection in a step pinned to the LOCAL
     database is `db-local-down`, not `proxy-down`;
   - any handler failure holds the publish.

   | exit | meaning |
   | --- | --- |
   | 0 | clean or degraded (only operator/agent items left) |
   | 1 | a handler or post-step failed |
   | 2 | the runner itself crashed (the report still exists; its `runner` unit has the stack) |
   | 3 | another run holds the lock, or preflight refused |
   | 4 | the ingest was fine, but the publish was held or failed |
   | 5 | the watcher failed |
   | 130 | interrupted (Ctrl-C/SIGTERM/SIGHUP) during the watcher |

   Every exit path writes `state/pipeline/runs/<session>/report.md` — preflight refusal and
   crashes included — and prints its path last. Two exceptions: a run refused by the lock
   (read the holder's run instead) and a second Ctrl-C, which kills the running steps and
   exits at once. A preflight refusal caused by git (mid-rebase, off `main`) writes its
   report but does not commit it.

   **A run killed outright** (SIGKILL, the session that launched it ending, a reboot)
   cannot write its report. The next nightly names it in its findings — session, phase,
   the step it died in — from the dead run's `status.json`. To launch a run that outlives
   the terminal or agent session that starts it, detach it from that process group:
   `perl -MPOSIX -e 'setsid; exec @ARGV' pnpm run pipeline:nightly > /tmp/nightly.out 2>&1 &`.

   **Watching a live run.** The first line printed is the live log:
   `tail -f logs/pipeline/<session>/run.log` (`logs/pipeline/LATEST` names the current
   session). One timestamped line per event: each phase, each step's start (command, log
   file, usual duration) and end (status, exit, duration, first error), a heartbeat every
   5 min while a step runs (flagged when over 2× its usual time), and every orchestrator
   decision. `status.json` beside it is rewritten on every event and every minute: the
   phase, the step running now and for how long, counts so far, the last step. Each step's
   full output is `logs/pipeline/<session>/<seq>-<step>.log`. On macOS a desktop
   notification carries the final exit code.

3. **Read the report.** Run `pnpm run pipeline:report` (or open
   `state/pipeline/runs/<session>/report.md`). Its sections, in order: Verdict, Failures,
   Needs operator, Needs agent, What ran, Findings. `--json` gives `run.json`. Under
   nightly, the first unit is `watcher` (its source counts and any standing streak) and
   the Publish decision section says what the publish did, with a link to its own report.
4. **Failures: open the packet, don't re-derive.** Each failed step has
   `state/pipeline/runs/<session>/failures/<seq>-<step-id>.md`, and a unit failed by a
   gate (every step ok, result refused) has `<seq>-<step-id>-gate.md` (the report links
   each one). It holds:
   - the exact command;
   - the log tail;
   - the failure class;
   - the matching known-failure advice;
   - the handler's **Never** rules;
   - what a fix must not break.

   Fix the cause, re-run just that handler with `pnpm run pipeline:ingest --only <handler>`,
   and confirm its verdict. A class of `env` (egress, PG down, proxy) is a machine problem,
   not a code one: say so and stop. Before calling a red `test:data` file a regression,
   re-run it alone; the executor already does this for vitest and records the result.
5. **Needs agent — the delegated handlers.** Each item names a skill and the steps the plan
   would run. Why the handler is still delegated is a comment on its entry in
   `scripts/pipeline/registry/handlers/`. Invoke that skill (`Skill(update-…)`) and pass on the unattended contract below.
   The skill stamps its own marker. Then publish what it produced with `/upload-watch-changes`
   (which runs `pnpm run pipeline:publish`). Do one handler at a time, in the order listed.
6. **Needs operator.** These are listed, not done:
   - manual downloads;
   - pastes;
   - judgement calls.

   Each item has its instruction, URL, drop path and age. An item with a file done-check
   resolves itself once the file lands. Otherwise, once the operator has acted, run
   `pnpm run pipeline:ack <handler> <step>`. An ack covers only changes before it.
7. **Summarise for the user.** Include:
   - the verdict;
   - what was ingested and published;
   - each failure with its packet path and what you did about it;
   - the Needs operator list.

## Unattended mode (the nightly routine)

When the args contain **`unattended`**, nobody is at the keyboard. Every planned ingest and
the publish after it are pre-approved, so:

- **Do not wait or ask.** Run the procedure above straight through.
- **Pass the contract on to every delegated skill.** Put this in each `Skill` call's args:
  `"unattended nightly run from /process-watch-report — do not ask; take the documented
  default at every prompt; skip any step that needs human judgment and report it"`.
- **Skip and report human-judgment steps; never guess them.** A skill whose automated part
  succeeded counts as `partial`. Stamp it only if that skill's own rules say the automated
  part is complete; otherwise leave it unstamped, so the next run queues it again.
- **Handle a failure by skipping it and continuing.** Record it, leave that handler unstamped,
  and go on to the next. A failure never halts the night.
- **Never run anything destructive or outward-facing beyond the documented publish.** That
  includes `db:sync:cloud`, `--clean`, a deploy, or a hand-run `apply_functions.ts` against
  Cloud SQL. Those wait for a human.

## Appendix: the manual procedure

Everything below is the procedure this skill ran before the pipeline existed. Keep it for
two cases:

- running a **delegated** handler's skill by hand;
- recovering when the pipeline itself is broken (say so in the summary if you use it).

Where it says to consult the source → skill mapping, use `pnpm run pipeline:plan` or
`docs/pipeline-handlers.md`. The performance trace is the same: the pipeline writes the same
`state/perf/*.jsonl` rows itself.

## Performance trace — EVERY step is timed

This orchestrator is the longest-running thing in the repo: a single run can invoke a
dozen ingest skills and then a `db:refresh` that is a **75-link `&&` chain**. Until 2026-08-29
none of it was measured, so "the run took four hours" was the only fact available and it
names nothing to fix.

So every step this skill takes is timed and appended to a durable trace:

```
state/perf/process-watch-report.jsonl     ← this skill
state/perf/upload-watch-changes.jsonl     ← /upload-watch-changes (the publish half)
```

**APPEND-ONLY, and committed.** One JSONL row per step, one `session` per orchestrator
invocation. The point is the HISTORY, not this run: a step is only diagnosable against its
own past durations, so the file is never truncated and never gitignored (a per-machine log
would be empty on the machine that later does the optimisation work — which is why the
extension is `.jsonl` and not `.log`, the latter being covered by `.gitignore`).

### The three commands

```bash
# once, at the very top of the run — every step below carries this id.
# ⚠️ PASTE THE PRINTED ID into each later command. `$S` below is shorthand: a shell
# variable does NOT survive between tool calls, and `--session ""` files rows under a
# blank session that no rollup can group.
pnpm run -s perf:step -- session

# a shell command: measured exactly, exit code propagated (so `&&` still works)
pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
  --step "myarea:alerts" --phase derive -- pnpm run myarea:alerts

# an `&&`-chain package script: ONE ROW PER LINK, plus a whole-chain total
pnpm run -s perf:chain -- db:refresh --session "$S" --phase ingest

# something this process did not run — a Skill invocation, a manual wait
date -u +%FT%TZ         # before — read the stamp; it does not survive the tool call
# … Skill(update-procurement) …
pnpm run -s perf:step -- record --run process-watch-report --session "$S" \
  --step "update-procurement" --phase ingest --started 2026-08-29T05:12:33Z --status ok \
  --notes "3 210 new contracts"

# read the trace back (also step 10 below)
pnpm run -s perf:report --run process-watch-report --last 5
```

Four rules, each of which is a way the trace goes quietly WRONG rather than absent — and a
wrong duration is worse than a missing one, because it sends the optimisation work to the
wrong step:

- ⚠️ **Never wrap a chain in `perf:step run`.** `pnpm run db:refresh` under `perf:step` yields
  ONE number for 75 links, which answers "was it slow" and nothing about WHERE — and "where"
  is the entire question when the chain is an hour long. Use `perf:chain`, which reads the
  chain text out of `package.json` (so it cannot drift from what `pnpm run` would have done),
  runs each link through `sh -c` in order, and aborts on the first non-zero exit exactly as
  `&&` does. Same applies to `tr:daily-refresh` (7 links).
- ⚠️ **`--step` labels are compared ACROSS sessions, so keep them deterministic.** No dates,
  no counts, no row totals in the label — those go in `--notes`. A label that changes per run
  makes every run look like a first run and the per-step history never accumulates.
- ⚠️ **Record a SKIPPED step rather than omitting it.** `--status skipped` with a `--notes`
  reason. An unmeasured step and a fast step are indistinguishable in the trace, and a step
  skipped four runs in five is exactly the one whose real cost gets forgotten.
- **A failed step is still a step.** `perf:step run` records the non-zero exit and then
  propagates it; do not swallow the row when the orchestrator halts. Aborted runs are the
  most interesting rows in the file.

`phase` is the coarse grouping — `plan` | `ingest` | `derive` | `verify` | `publish` |
`commit`. Use it consistently; it is what lets a later analysis say "the derive block is
40% of the run" without re-classifying every step by hand.

### Reading the trace

`pnpm run perf:report` prints two views, and the second is the worklist:

- **Last N sessions** — total work and that session's five slowest steps.
- **Cost by step, ranked by TOTAL across all sessions.** Ranked by total rather than by
  median on purpose: a 4 s step that runs sixty times costs more than a 90 s step that runs
  once, and the cheapest win is usually the one that repeats.

⚠️ A session's total is the **sum of its steps' own durations**, never `end − start`. The
gap between two steps is the agent thinking, or the operator answering a prompt, or a manual
download — real wall-clock, but not work this pipeline can attribute or optimise. Reporting
it as "the run took X" would credit the pipeline with time it never spent.

## Procedure

### Step 0 — read "Manual downloads needed" first

The daily report may open with a `## Manual downloads needed` section. It sits above
`## Changed` because a missing input blocks its ingest entirely — there is nothing to run
even when the upstream moved.

Surface every entry to the user before invoking anything, and **do not invoke a skill whose
input is still missing**. Report it as skipped and leave that skill's marker untouched:
these skills mostly skip-and-warn on an absent input and exit 0, so running one stamps
`lastSuccessfulIngest` over the gap and the orchestrator stops queueing the work. The
request itself is disk-derived and keeps firing — what a wrong stamp suppresses is the
ACTION, not the report line, which is why this goes unnoticed.

**A source whose skill has a shared marker needs its own.** `state/ingest/update-budget.json`
backs ~13 sources, so it is stamped whenever any of them fires; a sub-step waiting on a manual
download must key on its own marker or the wait is masked by unrelated activity.

A source can appear in BOTH this section and `## Changed` — they answer different questions
("someone must fetch something" vs "an upstream moved"). The manual entry wins: fetch
first, then re-run the orchestrator.


1. **Open the trace, then enumerate state.** The FIRST command of the run mints the session
   id every later step carries — do it before anything else, because a step recorded under a
   fresh id is a step that vanishes from this run's rollup:

   ```bash
   pnpm run -s perf:step -- session
   ```

   ⚠️⚠️ **SUBSTITUTE THE LITERAL ID INTO EVERY LATER COMMAND.** Each Bash tool call is a fresh
   shell, so `S=$(…)` set in one call is EMPTY in the next and `--session ""` files the row under
   a blank session no rollup can group. `$S` in the examples means "paste what this printed"
   (`--session 20260829T051233Z-a1b2`). Mint it ONCE — a second `session` call starts a second
   run as far as every report is concerned.

   Lost it? Read it back rather than minting a new one:
   `tail -1 state/perf/process-watch-report.jsonl | jq -r .session`.

   Then inspect both state directories via Bash. Each watcher source has `lastChanged`; each ingested skill has `lastSuccessfulIngest`.

   ```bash
   # Watcher state — one per source (`_`-prefixed files such as
   # _health.json are runner bookkeeping, not sources: skip them)
   for f in state/watch/*.json; do
     case "$(basename "$f")" in _*) continue ;; esac
     jq -r --arg name "$f" '"\($name) lastChanged=\(.lastChanged // "?")"' "$f"
   done

   # Ingest markers — one per skill (may be empty on first run)
   for f in state/ingest/*.json; do
     [ "$f" = "state/ingest/.gitkeep" ] && continue
     jq -r --arg name "$f" '"\($name) skill=\(.skill) lastSuccessfulIngest=\(.lastSuccessfulIngest)"' "$f"
   done
   ```

   **Performance note (measured 2026-07-16):** the two `for`-loops above spawn one `jq` per file (~169 processes, ~1.4 s wall). A single batched pass per directory is ~35–80× faster (~0.02 s) and folds the enumerate→map→queue step (2) into one join — reach for it on a large state dir:

   ```bash
   # Watcher state as one object: {id: lastChanged}
   jq -n 'reduce inputs as $x ({}; ($x|input_filename|sub(".*/";"")|sub(".json$";"")) as $id | if ($id|startswith("_")) then . else . + {($id): ($x.lastChanged)} end)' state/watch/*.json
   # Ingest markers as one object: {skill: lastSuccessfulIngest}
   jq -n 'reduce inputs as $x ({}; . + {($x|input_filename|sub(".*/";"")|sub(".json$";"")): ($x.lastSuccessfulIngest)})' state/ingest/*.json
   ```

   The `input_filename`-keyed reduce is the load-bearing trick — one `jq -n … inputs` reads every file in a single process instead of `for f … jq "$f"`.

2. **Build the work queue.** For each watcher source:
   - Look up its mapped skill in the table above. If no mapping, log it as "skipped — no handler" and move on.
   - Read the mapped skill's `state/ingest/<skill>.json`:
     - **Missing marker (skill never stamped)** → queue the skill AND flag "first-run bootstrap"; see "Bootstrap" below before invoking.
     - **`lastChanged > lastSuccessfulIngest`** → queue the skill.
     - **`lastChanged <= lastSuccessfulIngest`** → skip (already ingested this change).

   Dedupe the queue: if `cacbg_declarations` and `bgpost_postcodes` both flag `update-connections`, queue it once. Preserve the watcher-source-order so the user sees a stable plan.

3. **Confirm the plan with the user before doing destructive work.** Print which sources triggered which skills and the estimated work. Example:

   > Plan for orchestrator run:
   >
   > - `update-macro` ← `eurostat` (changed 2026-05-09, last ingest 2026-05-07) — ~30s
   > - `update-financing` ← `smetna_palata` (changed 2026-05-11, never ingested) — first run, ~10s
   > - then `/upload-watch-changes` publishes the result (bucket + Cloud SQL) — withheld
   >   automatically if anything above fails; say "hold the publish" to keep it manual.
   >   Proceed?

   Wait for user confirmation (or proceed automatically if they already said "go" / "run all" / "yes proceed", or the args contain `unattended` — see "Unattended mode"). If the queue is empty, print "Nothing to ingest — every changed source has already been processed since its last change" and stop.

   **The "yes" here covers the publish.** Step 14 invokes `/upload-watch-changes` on the
   strength of this confirmation, and that skill does not re-ask when the orchestrator hands it
   a clean run — so the plan MUST name the publish, every time. A "hold the publish" / "don't
   upload" answer is remembered for step 12's gate: the manifest is still written, only the
   invocation is withheld.

4. **Invoke each skill in sequence — and time each one.** Use the `Skill` tool, one skill at a
   time. Don't parallelise — they can conflict on `data/` writes. Capture each invocation's actual
   stdout (counts, file paths, status) for the final summary. Do NOT paraphrase as "done" — quote
   specifics.

   A `Skill` call is not a shell command, so it cannot be wrapped by `perf:step run`. Bracket it
   instead — capture the clock immediately BEFORE the invocation and record immediately after:

   ```bash
   date -u +%FT%TZ                     # ← run this, READ the output, then invoke the Skill
   ```

   ⚠️ Same rule as the session id: `T0=$(date +%s)` would be gone by the next tool call. Read the
   printed stamp and paste it literally (`--started 2026-08-29T05:12:33Z`); `--started` accepts an
   ISO stamp or epoch seconds. If the start time is lost entirely, use `--seconds <n>` with your
   own estimate and say in `--notes` that it is estimated — an honest estimate beats a hole, and a
   hole reads as "fast" for ever.

   ```bash
   pnpm run -s perf:step -- record --run process-watch-report --session "$S" \
     --step "update-procurement" --phase ingest --started "$T0" --status ok \
     --notes "3 210 new contracts, 41 new tenders"
   ```

   ⚠️ **`--step` is the SKILL NAME and nothing else** — no date, no count. It is the key the
   per-step history joins on across sessions; a label carrying today's numbers makes every run
   look like a first run. The counts belong in `--notes`, which is free text.

   A skill that ran and found nothing still gets a row (`--status ok`, notes `"no new data"`); a
   skill that was queued and then NOT run gets `--status skipped` with the reason. Omitting either
   makes an unmeasured step indistinguishable from a fast one.

   Before the next invocation, run `git diff --stat data/` to capture what physically changed on disk vs. what the skill claims. The diff is truth; skill output is narration.

   **A skill whose body is an `&&`-chain is worth expanding.** `update-procurement` ends in
   `db:refresh` (75 links) and `tr-daily-refresh` is itself 7 links. When a skill's own procedure
   tells you to run one of those, run it as `pnpm run -s perf:chain -- <script> --session "$S"`
   instead of `pnpm run <script>`: identical semantics, one trace row per link. That is where the
   hours are, and a single row for the whole chain names nothing to fix.

5. **Stamp success.** After each skill completes without error, run:

   ```bash
   pnpm exec tsx scripts/stamp-ingest.ts <skill-name> --summary "<one-line recap>"
   ```

   This writes `state/ingest/<skill>.json` with `lastSuccessfulIngest = now`. If the skill threw, do NOT stamp — the orchestrator's halt-on-error rule below applies.

   The summary should reflect what was actually ingested (e.g. `"2 new sessions through 2026-05-10"` for rollcall, `"15 years tracked, 0 net change"` for financing). It lives in the marker file and shows up in `git log -p state/ingest/`.

   **Then append a row to the public data-changes log — but only when data actually changed.** The `/data-changes` SPA page is for readers, not auditors; it should list substantive refreshes, not bootstrap stamps or fetchedAt-only churn. Use `git diff --stat data/` (the truth) as the gate:

   ```bash
   # If the skill actually wrote new/changed bytes under data/, append.
   # If the diff is empty (or only metadata files moved), skip.
   if [ -n "$(git diff --stat data/)" ]; then
     pnpm exec tsx scripts/append-data-change.ts <skill-name> \
       --summary "<same one-line recap>" \
       --source "<upstream label, e.g. 'Eurostat macro (BG)'>"
   fi
   ```

   Use the same `--summary` text as the stamp — keeping the two in sync means `git log -p state/ingest/` and the public page tell the same story. The script is also defensive: it auto-skips when the summary matches no-op patterns (`bootstrap:`, `unchanged`, `no data changes`, `only fetchedAt diff`, `timestamp-only diff`, `no run`), so a stray call won't pollute the page — but `git diff --stat` is the cleaner upstream gate.

   **PG-only ingests that self-report — skip the generic append for these.** A Postgres-only skill writes nothing (or only a tiny artifact like `product_slugs.json`) under `data/`, so `git diff --stat data/` is empty and this gate would silently drop it — e.g. `update-prices` was the single most-frequent `/data/updates` entry, and going Postgres-only would have taken it to zero. Those skills instead call `appendDataChange` from inside the ingest, based on the rows they actually loaded. **Do NOT run `scripts/append-data-change.ts` for them** — the ingest already did. Currently self-reporting: `update-prices` (`scripts/prices/ingest.ts`), `update-persons` (`resolve_persons.ts`), `update-nzok` (`load_nzok_hospital_pg.ts`) and `update-fuel` (`fetch_fuel.ts`).

   ⚠️ **A self-reporting ingest runs TWICE per publish cycle, and it used to report twice.** The `:cloud` twin is the same script with `DATABASE_URL` pointed at the Cloud SQL proxy — `prices:ingest:cloud` is literally `pnpm run prices`, `db:load:agri:pg:cloud` is literally `pnpm run db:load:agri:pg` — so the code that ingested the data locally runs again to publish it. `dedupeSameDay` keys on the calendar date, and the pair straddles UTC midnight often enough that ONE refresh was published as two days of activity three times: 2026-07-28, 2026-08-28 and 2026-08-31 (the last caught by hand, the first two shipped and were removed by the fix). Two things now stop it, both central so a new self-reporter inherits them:

   - `appendDataChange` **refuses any append made while pointed at the serving database** — a publish is not a data change. Nothing to add per script.
   - prefer **`dedupeKey`** over `dedupeSameDay`: a stable identity for the DATA the row describes (for prices, the loaded price day), deduped across the whole log with no time window. Reach for `dedupeSameDay` only when the row legitimately recurs every run with no data day to key on (`resolve_persons` re-derives the whole person layer daily).

   Three tempting alternatives that do NOT work, all measured against the committed log: a wider dedupe **window** (24/48 h) swallows genuine consecutive-day refreshes, and prices publishes daily; the wall-clock **date** is the bug itself; and **`summary` equality** misses it whenever the cloud database was further behind and loaded a different number of archives ("+2 daily archives" vs "+1") — which is exactly the shape of the 2026-07-28 pair. Gate: `scripts/lib/data-changes.test.ts`.

   (`update-agri` is also PG-only and does NOT yet self-report — its `/data/updates` history is a known gap; add the same `appendDataChange` call to `scripts/agri/ingest.ts` when convenient, with a `dedupeKey` naming the financial year or corpus vintage it loaded. It needs no other change: the publish guard already covers `db:load:agri:pg:cloud`.)

6. **Final post-step: rebuild the My-Area alerts feed.** After every queued skill has run (or the queue was empty), unconditionally run:

   ```bash
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "myarea:alerts" --phase derive -- pnpm run myarea:alerts
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "myarea:alerts:cloud" --phase publish -- pnpm run myarea:alerts:cloud
   ```

   ⚠️ **BOTH lines, and the second is not optional.** Since json-retirement-v2 Tier 4b the feed is stored in Postgres (`myarea_alerts`, migration 184) rather than written as 290 files under `data/myarea/alerts/` — so a local-only run leaves **prod serving the previous vintage at a 200**, with `git diff --stat data/` empty and nothing red anywhere. This is the same class as the C1 rollcall gap: the local half looks like a complete run. The builder composes the events in TypeScript (they carry bilingual prose) and only the storage moved; 184's header has the reasoning.

   The script materialises the per-município "Последна активност" feed (the `myarea_alerts` table) from already-ingested data — council resolutions, procurement (now tagged **announced / awarded / annex** via the rollups' `tag`), EU-fund contracts **plus snapshot-diff new/modified projects** (from `data/funds/projects/changes/`, dated by the real detection day), capital programmes, local elections, plenary keyword hits. It's cheap (<5 s) and its output is a function of whatever's now in `data/`, so running it last keeps the feed in sync with whatever the orchestrator just changed. Because `update-funds` writes the EU `changes/` artifact _inside_ its own run (before this post-step), the new/modified EU events are already on disk when this runs. Don't stamp this as a separate skill — it's a derived rebuild, not an upstream ingest.

   **Specifically do NOT append for:**
   - Bootstrap stamps (option (a) from "Bootstrap" above — `"bootstrap: marker seeded, no run"`).
   - Skills that ran but produced no on-disk data diff (e.g. macro where every series is current).
   - Watcher-fingerprint flips that were chrome-only (financing's `subsidii` page churn, etc.).

   **Re-seed (rarely):** if you ever need to rebuild `data/data-changes.json` from current `state/ingest/*.json` markers, run `pnpm exec tsx scripts/seed-data-changes.ts`. The seeder applies the same no-op filter, so it's safe to re-run.

7. **Final post-step: refresh the data map.** After the alerts feed, unconditionally run:

   ```bash
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "data:map" --phase derive -- pnpm run data:map
   ```

   This rebuilds `data/data_map.json` — the `/data` map manifest — baking the latest per-source freshness from `state/watch` and reflecting the watched-sources registry. Like the alerts feed it's a derived rebuild (a function of what's now in `data/` + the registry), not an upstream ingest, so don't stamp it as a skill. The write is **churn-free**: if nothing but the `generatedAt` stamp would change, the file is left untouched, so a quiet day produces no diff. The manifest lives under `data/`, so it ships to the live SPA via the same `bucket:sync` below — no Firebase site deploy is needed to refresh the map.

7b. **Final post-step: rebuild the HOME dashboard's artifacts.** After the data map and
   **before** the artifact check below (which verifies these reached the bucket), unconditionally
   run the four generators and the health check:

   ```bash
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:gen-home-hub-stats" --phase derive -- pnpm run db:gen-home-hub-stats
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:gen-home-flyover" --phase derive -- pnpm run db:gen-home-flyover
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:gen-home-price-events" --phase derive -- pnpm run db:gen-home-price-events
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:gen-home-feed" --phase derive -- pnpm run db:gen-home-feed
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "home:health" --phase verify -- pnpm run home:health
   ```

   Then **record `home` in `state/upload/pending.json`** alongside the other touched subtrees, so
   `/upload-watch-changes` publishes it. ⚠️ Note in the manifest that the home subtree needs
   `pnpm run bucket:gz` after its sync — `/` is the entry page and a `bucket:sync:paths` reverts
   the stored gzip on both blobs. `pnpm run home:publish` is that pair as one command, for an
   operator working by hand.

   Unconditional, and ONCE per run: nine source families feed the home feed, so a per-source
   mapping would run these up to nine times, each fold catching whichever siblings had not yet
   finished. The full reasoning, the ordering constraints and what to do when `home:health` goes
   red are in „The home dashboard — ONE generation step, at the END of the run" above and in
   [`docs/home-dashboard-operations.md`](../../../docs/home-dashboard-operations.md).

   ⚠️ **`home:health` red means DO NOT publish** — a half-written file on the entry page is
   worse than a stale one. It exits non-zero on a missing, corrupt, unbuilt, unavailable, stale,
   unpublished or drifted artifact and names which.

8. **Final post-step: verify the `db:refresh`-generated artifacts actually reached the bucket.** After the data map, unconditionally run:

   ```bash
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:check-generated" --phase verify --ok-exit 1 -- pnpm run db:check-generated
   ```

   **FOURTEEN** COMMITTED artifacts are bucket-served static GCS blobs that a hub reads (count re-taken 2026-10-16). THIRTEEN are regenerated from Postgres by `db:refresh` — `procurement/derived/hub_stats.json`, `procurement/derived/sector_stats.json`, `roads/derived/hub_stats.json` (the /sector/roads hub, since 2026-10-12), `water/flood_maintenance.json` (the /water riverbed tile, since 2026-10-12 — it sat three months stale before it had a generator) and `water/derived/hub_stats.json` (the /water hub, since 2026-10-13; it reads contracts, `national_competition()` and fund_beneficiaries, so both `update-procurement` and `update-funds` move it, and it READS the riverbed file, so it must be regenerated after it), `transport/derived/hub_stats.json` (the /sector/transport hub, since 2026-10-16; contracts, annexes, fund_projects and the project map — `update-procurement` and `update-funds` both move it, and it must follow the two transport map loaders), `culture/derived/hub_stats.json`, `governance/hub_stats.json`, `governance/declarations_hub_stats.json` and the four the HOME dashboard reads (`home/hub_stats.json`, `home/flyover.json`, `home/feed.json`, and `home/price_events.json` — the last an intermediate the feed generator reads, published for inspectability rather than for a browser) — and their registry is `REFRESH_GENERATORS` in `scripts/db/refresh_coverage.ts`. ⚠️ Do not read this count from prose: it said SIX for a while after the home three landed. `REFRESH_GENERATORS` is the authority and this command reads it. The fourteenth, `parliament/votes/derived/hub_stats.json`, is written by `rebuildDerived` from in-memory objects and published by that script's own `--upload` list, so `REFRESH_GENERATORS` structurally cannot hold it; its registry is `UPLOAD_PUBLISHED_ARTIFACTS` in the same file. This command reads BOTH, compares each local file's BYTES against the live bucket object, and prints the exact `bucket:sync:paths` line for any that differ. **It never uploads** — emit that line in Next-steps like every other production command (see "What this skill does NOT do"). Exit 1 means something is unpublished.

   ⚠️ **THE PUBLISH TRIGGER IS NOT THE OWNING SKILL'S TRIGGER — that decoupling is the whole reason this step exists**, and reasoning about which skill "owns" a path is what failed. `db:gen-culture-hub-stats` reads contracts, tenders, fund_projects, agri_subsidies, person_role and interreg_partners, so it moves when **`db:refresh`** runs (i.e. under `update-procurement`) — while `update-culture`, the skill that owns `data/culture/` and names its sync, is woken only by `nfc_film_register` / `ncf_grant_results` / `nfc_commissions` / `mc_dki_register`. The skill holding the PATH is never woken by the thing that changes the CONTENT, so no per-skill instruction can close this. Run the check unconditionally rather than trying to work out whether it applies.

   Both misses this was written for, measured 2026-08-21:

   - `culture/derived/hub_stats.json` — **404 for two days.** Committed 2026-08-19, generator wired into `db:refresh` 2026-08-18, and nothing had ever uploaded it. The hub degrades a 404 to „no figure" by design (`src/data/culture/hubStats.ts`), so `/culture` rendered its tiles without numbers at a **200** with nothing red anywhere.
   - `governance/declarations_hub_stats.json` — **4 days stale, across a SCHEMA change.** The 2026-08-20 rework moved `companies`/`companyMps` → `organisations`/`organisationPeople`, so the deployed bundle was reading keys the served blob did not carry. `update-connections` Step 6 regenerates it and Step 7 commits it, and that skill has **no sync step at all** — so it was stale by construction on every run.

   The two that were fine (`procurement/derived/*`) are exactly the two `update-procurement` names explicitly, which is the tell: this was never a hard command to run, it was an unowned one. ⚠️ "Fine" means PUBLISHED, on 2026-08-21, and nothing more — `procurement/derived/hub_stats.json` was found on 2026-08-27 to have been carrying stale NUMBERS the whole time, which this check cannot see. The two statements are about different axes and different dates; see the blind-spot table below.

   A third, measured 2026-08-27, is why the check now reads two registries:

   - `parliament/votes/derived/hub_stats.json` — **16 days stale, across a SCHEMA change**, and INVISIBLE to this step until then. The 2026-08-25 „the head ranks the groups" commit added `topGroups` / `otherGroups` / `otherMembers`; the bucket copy was from 11 August and carried none of them for any of the nine parliaments. Its only publisher is `rebuildDerived --upload`, which runs on a roll-call INGEST — and the change was a code commit, so nothing ever ran it. Here the publish trigger is not even the owning SCRIPT's trigger. ⚠️ It COMPOUNDS: `gen_governance/hub_stats.ts` folds this file **from disk**, so a stale bucket copy makes `/governance` and `/parliament` — one click apart — disagree about the same parliament while both are green locally.

   A full `pnpm run bucket:sync` would also have caught all four — `culture/` and `governance/` are not in its `-x` exclusions — but nobody runs the ~30-minute full-tree sync day to day; the orchestrator's real path is the scoped `bucket:sync:paths`, whose argument list is assembled per skill. That is the gap.

   ⚠️⚠️ **THIS CHECK IS BLIND TO THE OTHER HALF OF THE CLASS, AND THE TWO FAILURES LOOK NOTHING ALIKE.** `db:check-generated` compares LOCAL BYTES against the BUCKET. It answers "was the artifact published?" — never "is the artifact CURRENT?". So when a generator is never re-run at all, disk and bucket are both stale, they **agree**, and this step prints **OK**.

   Measured 2026-08-27 on `procurement/derived/hub_stats.json`: it published `appeals` 7,998 against a live 8,007 (a КЗК ingest four days earlier) and `connected` short across 15 scopes (a `db:load:tr:pg`), and this check reported it **OK** the whole time — correctly, because both copies carried the same wrong numbers. The two halves fail in opposite directions and only one of them is visible here:

   | failure | disk vs bucket | caught by |
   | --- | --- | --- |
   | regenerated, never uploaded | DIFFER | `db:check-generated` (this step) |
   | never regenerated | AGREE | ✅ `scripts/db/tests/procurement_hub_stats.data.test.ts` — disk vs CORPUS |
   | just uploaded, edge still caching | DIFFER (falsely) | nothing — verify by hash, see below |

   ⚠️ **It also reports a FALSE `STALE` immediately after a successful sync**, because it compares
   over HTTP and does not cache-bust. Measured 2026-08-27: right after `bucket:sync:paths` reported
   all 9 paths synced, this step still called `culture/derived/hub_stats.json` and
   `parliament/votes/derived/hub_stats.json` stale, both quoting a `served` date from the previous
   day. `gsutil ls -L` showed both objects with an update time minutes old and an **md5 identical
   to local** — they were published. Before re-syncing on this step's say-so, check the OBJECT
   rather than the response:

   ```bash
   gsutil ls -L gs://data-electionsbg-com/<path> | grep -E "Update time|Hash"
   openssl dgst -md5 -binary data/<path> | base64
   ```

   ⚠️ **The other artifacts each have a corpus-freshness gate** (`roads_hub_figures.data.test.ts` for the roads blob, added 2026-10-12; `water_hub_figures.data.test.ts` and `water_flood_maintenance.data.test.ts` for the two water ones, added 2026-10-13; `transport_hub_figures.data.test.ts` for the transport blob, added 2026-10-16; the list below is the original set) — an earlier draft of this block said they had none, which was wrong and would have sent someone to rebuild what exists. `culture_hub_figures.data.test.ts` fails with *"The corpus moved under the artifact — re-run db:gen-culture-hub-stats"*; `sector_stats.data.test.ts`, `governance_hub_stats.data.test.ts` and `declarations_hub_stats.data.test.ts` reconcile theirs against live sums; and `hub_stats_pg.data.test.ts` compares the parliament blob against `readHubStatsFromPg()`. `procurement/derived/hub_stats.json` was simply the ONE of the original six that had no such gate — which is exactly why it is the one that went stale — and Tier 1 closed it, so the set is now complete. **The rule that follows: when a skill this run moved one of a generator's INPUTS, re-run that generator, commit, and sync — do not infer from a green `db:check-generated` that the artifact is current.** For the procurement blob the inputs are `contracts`, `awarder_seats`, `tenders`, `kzk_appeals`, `ngo_funding` (its `RELATIONS` list), i.e. `update-procurement`, `update-kzk-appeals` (whose Step 3b now does it) and the `ec_fts` NGO-funding row all move it. The ROADS blob (`db:gen-roads-hub-stats`, gate `roads_hub_figures.data.test.ts`) reads `contracts`, `contract_risk_cache`, `procurement_annexes` and `fund_projects`, so `update-procurement` AND `update-funds` both move it — re-run it after `db:gen-sector-stats` (its headline must equal `sector_stats.json all.roads`), commit, and `bucket:sync:paths -- roads/derived/hub_stats.json`.

8b. **Final post-step: verify Cloud SQL is running the same schema objects as local.** After the artifact check, unconditionally run:

   ```bash
   pnpm run -s perf:step -- run --run process-watch-report --session "$S" \
     --step "db:check-cloud" --phase verify --ok-exit 1 -- pnpm run db:check-cloud
   ```

   `--ok-exit 1` because both verifiers exit 1 when they FIND something — that is the
   finding, not a crash, and recording it as a trace failure every run would make the
   failure count meaningless. The exit code still reaches you; read the output.

   It diffs every public FUNCTION body, VIEW/matview definition and relation between local Postgres and the Cloud SQL proxy, and reports only objects some `schema/pg/*.sql` file still CREATEs — so local scratch tables are classified as scratch and need no allowlist. Read-only; it prints the `apply_functions.ts` line and exits 1.

   ⚠️ **THIS IS THE ONE CLASS STEP 9 STRUCTURALLY CANNOT SEE, which is why it is a separate unconditional step rather than a row in that table.** Step 9 keys its `:cloud` commands on WHICH SKILL RAN, i.e. on a watcher flip in an upstream SOURCE. A serving function, view or index carries no data, so no `db:load:*` ships it and `deploy:db` ships `functions/` code — a different thing from a Postgres function. A migration edited by a **code commit** flips no watcher, so no row of step 9's table ever fires, and prod keeps running the old body indefinitely with every row count reconciling.

   Measured 2026-08-27, on a serving database every other check called healthy — five objects behind, none of them a 500:

   - `budget_hub_stats()` + its cache (156) — **eight fields missing**, all eight read by `budgetHubFigures.ts`, so `/budget`'s KPI band silently fell back to the projected basis and its evidence aside rendered not at all.
   - `budget_admin_list()` (155) — missing the `node_id` tiebreak. 155's own comment says 156's evidence aside ranks on the same expression and must break ties the same way, so **these two must ship together** or the head and `/budget/ministries` disagree about who is fifth.
   - `council_councillor_by_slug()` (161) — **absent entirely**; the route degrades to `null`, so the councillor voting record simply never appeared on `/person`.
   - `person_by_slug()` (082) — missing `linkBasis` on the NGO arm: 5,670 of 5,727 board seats rendered with no basis mark beneath a companies list that marked every row of its own.
   - `mp_tr_roles()` (150) — pre-correlation body, 7,745 buffers against 867.

   ⚠️ **Do NOT paste the emitted command blind.** Several of these files open with `DROP MATERIALIZED VIEW` and rebuild WITH DATA in one transaction (156), so applying them blocks that matview's readers — off-peak only — and where a LOADER is the documented path because it also REFRESHes, use the loader (156 → `pnpm run db:load:budget-hub:pg:cloud`). Order matters: a `LANGUAGE sql` body is validated at CREATE, so a file reading another file's object must follow it.

9. **Resolve the Cloud SQL publish set — and RECORD it, do not run it.** Most skills write static JSON under `data/` and ship via `bucket:sync` — those need **no** Cloud SQL step. But a few datasets are ALSO served live from Postgres (local Docker **and** Cloud SQL). Each PG-backed skill reloads the LOCAL Postgres tables inside its own run (procurement/tenders/awarder-seats via `update-procurement`'s `db:refresh`; TR + NGO register via `tr-daily-refresh`'s chained `db:load:tr:pg`; NGO funding via `db:load:ngo-funding:pg`; EU funds via `db:load:funds:pg`). Cloud SQL is a **production** target, so no command in this skill's own procedure touches it — the loaders below are RECORDED here and RUN by `/upload-watch-changes`, which step 14 invokes after a run with no major issue.

   **Since 2026-08-29 the resolved set is WRITTEN DOWN rather than printed.** Append each command to the upload manifest as you determine it (step 12 finishes the file; `write` merges, so calling it repeatedly is how the list is built):

   ```bash
   pnpm exec tsx scripts/upload_manifest.ts write --session "$S" \
     --cloud "pnpm run db:load:pg:cloud" \
     --cloud "pnpm run db:load:tenders:pg:cloud" \
     --cloud "pnpm run db:load:awarder-seats:pg:cloud"
   ```

   ⚠️ **ORDER IS LOAD-BEARING and the manifest preserves it verbatim.** `--cloud` is repeatable and the list is de-duplicated first-seen-order — never re-sorted — because a loader that reads another's output must follow it (facts before derived on roll-call; `db:load:tr-company-place:pg:cloud` after `db:resolve:persons:cloud`; the whole person-layer block below). Emit them in the order you would have run them.

   ⚠️ **A PG-served tree is a `--cloud` entry, NEVER a `--paths` entry.** `isExcluded` in `scripts/bucket_sync_paths.ts` refuses every PG-served and every retired tree — 20+ branches today and growing every time a family moves to Postgres, so read the list from the guard (or from `bucket:sync:paths:dry`, which prints its per-path reason) rather than from any restatement. Putting one in `--paths` produces a refusal at publish time, and worse, reads as "the data was shipped" when nothing was.

   The table below is still the source of what to emit; `/upload-watch-changes` is what runs it.

   | PG-backed skill that ran this session                                           | Cloud SQL sync command(s) to emit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `update-procurement` (АОП contracts / tenders / debarred / EOP / awarder-seats) | `pnpm run db:load:pg:cloud && pnpm run db:load:tenders:pg:cloud && pnpm run db:load:awarder-seats:pg:cloud`. **ALSO** re-publish the three contract-DERIVED crosswalk maps `db:refresh` rebuilds from the fresh corpus (they go stale on cloud whenever contracts change — this is why `transport_project_link` drifted): `pnpm run db:load:transport-project-map:pg:cloud && pnpm run db:load:water-operator-map:pg:cloud && pnpm run db:load:mvr-directorate-map:pg:cloud`. **ALSO, locally, `pnpm run db:gen-transport-hub-stats` AFTER the two LOCAL transport map loaders (`db:load:transport-project-map:pg && db:load:transport-facility-map:pg` — the generator reads local Postgres, not the `:cloud` loaders above), then `pnpm run bucket:sync:paths transport/derived/hub_stats.json`** — the /sector/transport hub blob reads contracts, procurement_annexes, fund_projects and the project map's coverage; it is a committed bucket blob, so no `:cloud` loader carries it (step 8's `db:check-generated` will flag it if skipped). **ALSO — and it is NOT a fourth member of that set — `pnpm run db:load:transport-facility-map:pg:cloud`.** It never reads `contracts`: it maps the curated `TRANSPORT_ENTITIES` constant through `awarder_seats`, so its trigger here is the awarder-seats reload above, and unlike the three its row count SHOULD match local exactly. A mismatch there is a defect, not the expected asymmetry the parenthetical below describes. (Their row counts are legitimately NOT equal local↔cloud — each is derived from that DB's own `contracts`/`awarder_seats`, and cloud's corpus is fuller.) **ALSO** `pnpm run db:load:persons-browse:pg:cloud && pnpm run db:load:graph:pg:cloud` — the `/persons` money column AND the `/connections` graph both sum this contracts corpus (via `person_browse_table` / `company_public_money`), so both go stale on prod when contracts change; run graph AFTER persons-browse (it reads its facets). **ALSO** `pnpm run db:load:tr-company-place:pg:cloud` — it denormalizes `company_public_money`, so the place-companies tile ranks and counts the previous corpus otherwise. **ALSO** `pnpm run db:load:annexes:pg:cloud` — MANDATORY, not optional. It resolves against the `contracts` table, so ANY contracts reload stales it and the per-annex breakdown plus the чл.116 ал.2-vs-ал.3 labelling drift on prod. The sharpest case is an eviction: the cross-source reconcile ORPHANS the evicted row's `procurement_annexes` entries (16 across 9 contract keys on the 2026-08-04 run) and only this loader re-resolves them — but a run with zero eligible evictions still needs it. **ALSO** `pnpm run db:load:employer-links:pg:cloud` — a pure derivation over `declaration.filed_institution` × `contracts.awarder_name`, so it must follow BOTH corpora: `db:load:pg:cloud` (this row) and declarations **phase 1** (`db:load:declarations:pg:cloud` WITHOUT `--resolve` — phase 2 only fills `person_id`). It is the sole applier of 165+168, and `/api/db/awarder-officers` has no `.catch`, so on a cloud database that never ran it the route **500s** while the UI renders nothing. **ALSO** `pnpm run db:load:grant-links:pg:cloud` — same shape but NOT the same prerequisites: it needs `contracts` and **`tenders`**, and reads no `declaration` at all (its own header says `after db:load:tenders:pg AND db:load:pg`). So a TENDERS reload is also a grant-links trigger, and the preflight only catches an EMPTY `tenders`, never a stale one. It derives `grant_contract_link` from the ПИИ code already sitting in `tenders.subject` and `contracts.title`. ⚠️ **`fund_projects` IS a third input, and this row said the opposite until 2026-08-21** ("the coverage denominator, not an input — do not infer a funds-side trigger from it"). Since the buyer-corroboration fix, `fund_projects.beneficiary_eik` decides each link's `buyer_basis` and therefore its `confidence`: only `code_and_buyer` may be rendered as "this grant paid for this contract", and that verdict is a JOIN against the beneficiary. So **`update-funds` is a grant-links trigger too**, and against an EMPTY `fund_projects` every link comes out `buyer_basis='unknown'` with NOTHING citable — the loader warns, but the table loads and every row count reconciles. ⚠️ It has **no serving reader yet** — the surfaces are `culture-investigative-v1.md` T1.6c, unbuilt — so skipping it breaks nothing a user can see TODAY. It is emitted anyway because it is contract-derived and therefore goes stale like the rest: wiring it now costs a clause, and leaving it out means prod is stale from the day T1.6c ships, which is exactly when nobody will think to check. |
   | `tr-daily-refresh` (TR + NGO register — `egov_commerce`)                        | `pnpm run db:load:tr:pg:cloud && pnpm run db:load:graph:pg:cloud && pnpm run db:load:tr-company-place:pg:cloud && pnpm run db:refresh:risk:cloud` — ⚠️ **`db:load:tr-company-place:pg:cloud` must come after `db:resolve:persons:cloud`, not just after the graph.** Its `person_link_n` column is denormalized from `person_role`, and it is what `place_mp_companies()` (151) FILTERS on, so a stale one does not skew `/settlement/:id/companies`, it empties it at a 200. On this flip the resolve runs under `update-persons` (below), so re-run tr-company-place after that skill rather than leaving it here — `db:load:tr:pg` TRUNCATE+reloads `company_politicians`, the graph's procurement-edge source, so the `/connections` graph + the `/person` "Свързани лица" tile go stale on prod after a standalone TR publish unless the graph re-derives too. `tr_company_place` (133) is the third: it is rebuilt from `tr_companies` AND denormalizes `company_politicians`, so without it every governance page's "фирми, регистрирани тук" tile keeps the previous registry vintage. **`db:refresh:risk` is the fourth and is NOT optional** — `load_tr_pg` refreshes `procurement_risk_indexes_cache` but NOT `contract_risk_cache`, and both score from the same views off `company_politicians`, so a TR load alone leaves the `mpConnected` bit stale on the per-contract index while the browser payload has moved: the contract page and the browser risk column then disagree, which is precisely what `refresh_risk.ts`'s header warns about. Measured 2026-08-05 on local: a TR reload (`company_politicians` 511→521) broke `risk_parity.data.test.ts` on `mpConnected`, and `db:refresh:risk` was what fixed it. **`person_role` is a FIFTH consequence with no loader at all** — `company_politicians` feeds Bridge A inside `resolve_persons.ts:509`, which mints `source='tr'` roles, and NOTHING in this row rebuilds them: only `db:resolve:persons` does. Same measurement: the TR load left `person_role` at 175,261 tr roles and only the re-resolve took it to 175,264. The effect is small per daily flip (single digits) and the resolve is ~5 min, so it need not ride every flip — but say so in Next-steps, and let it ride the next `update-persons` run rather than assuming the graph reload covered it. It does not. |
   | `db:load:ngo-funding` (`ec_fts`)                                                | `pnpm run db:load:ngo-funding:pg:cloud`                                                                                                                                                                                                                                                                                   
   | `db:load:ngo-board-links` (`cacbg_officials`/`cacbg_local` → officials leg)     | `pnpm run db:load:ngo-board-links:cloud`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
   | `update-funds` (EU funds — `isun_eu_funds*`)                                    | `pnpm run db:load:funds:pg:cloud --full` **then** `pnpm run db:load:funds-fit:pg:cloud`. **ALSO, locally, `pnpm run db:gen-transport-hub-stats` then `pnpm run bucket:sync:paths transport/derived/hub_stats.json`** — the /sector/transport hub's EU-funds figures read `fund_projects` on the grant basis (transport-hub-v1 D6), so a funds reload moves the committed blob; no `:cloud` loader carries it. ⚠️ **The scope flag is REQUIRED** — without it the loader exits 1 in 0 s ("Refusing to guess the scope of a Cloud SQL load") and HALTS the chain: use `--full` when `fund_beneficiaries`/`fund_projects` moved (an ИСУН re-ingest; minutes of work re-reading ~128k shard files — measured 250 s on Cloud SQL 2026-08-21. Both tables are stage-merged since then, so neither RELOAD blocks a reader; a `--full` run does still end with a non-concurrent REFRESH of `dual_corpus_rankings_cache` (no unique index, so `CONCURRENTLY` is impossible) which can block that one matview's readers up to the 2 s `lock_timeout` — the route catches the 55P03 and falls back to the live function, so no `/api/db` route 500s), `--payloads-only` when only the precomputed payloads did. `--payloads-only` after a re-ingest is the silent-wrong direction — it republishes payloads over an unchanged beneficiary table and reconciles while under-reporting the money. The second command is not optional and is not cosmetic: it is the sole applier of migrations **143, 144 AND 145**, so it publishes the `/funds/procedure/:code` base-rate card, the band-0 wire + band-2 news rail, and the `/funds` hub stat cache — none of which any other loader ships. Run it even when `fund_fit` itself looks unchanged, because a FUNCTION-body change in 144 reaches prod no other way. ⚠️ Do NOT re-run it after `db:load:interreg:pg:cloud` to "close the cycle": the Interreg loader REFRESHes `funds_hub_stats_cache` itself (CONCURRENTLY), and funds-fit APPLIES 145, which is DROP+CREATE — so re-running it there would blank the `/funds` hub until the rebuild finished, which is precisely why the Interreg loader refreshes instead of applying.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
   | `update-open-calls` (open calls — `isun_procedures` / `sp2023_indicative` / `ahu_calls` / `interreg_calls`) | `pnpm run db:load:open-calls:pg:cloud` |
   | `update-rollcall` (roll-call votes — `parliament_votes`)                        | `pnpm run db:load:rollcall:pg:cloud && pnpm run db:load:rollcall-derived:pg:cloud` — ⚠️ **facts BEFORE derived, always** (the second reads `vote_*`/`mp_seat` the first loads). There is NO bucket half for rollcall any more (json-retirement-v2 Tier 1 retired `sessions/` and `derived/per-mp/`, objects removed), so these two commands ARE the publish: `vote_item`/`vote_cast`/`mp_seat` (134) + `mp_attendance`/`party_cohesion`/`mp_dissent`/`mp_similarity` (135) are **Cloud SQL-served** and back the LIVE routes `/api/db/vote-day-summary`, `contested-votes`, `mp-similarity`, `mp-dissents` (hooks `useVoteDaySummary`/`useContestedVotes`/`useMpSimilarity`/`useMpDissents`), so a new voting session that only ran `bucket:sync` leaves those four tiles on the previous vintage at a 200. `update-rollcall/SKILL.md` (Step 5b) documents the pair; **nothing runs them for you.** Re-run after EVERY `update-rollcall` that added a session. |
   | `update-prices` (КЗП retail prices — `kzp_prices`)                              | `pnpm run prices:ingest:cloud` — the daily production publish: fetches the new day(s), loads the SCD-2 delta into Cloud SQL, and rebuilds the `price_payloads` serving blobs behind `/prices` + the `/consumption` hub tiles. **Postgres-only, no `bucket:sync`.** The narrower `pnpm run prices:payloads:cloud` REBUILDS the serving blobs WITHOUT an ingest (≈4 min; applies 048, seeds `price_last_seen`) — reach for it when the payload BUILDER changed but the corpus did not (a new blob field/kind, or re-folding another skill's JSON per the "Price-hub freshness" note above), **NOT** for a new price day. ⚠️ When the chain pages WIDEN, ship the frontend bundle (`pnpm run deploy`) BEFORE the payloads — an older bundle renders a widened payload wrong (CLAUDE.md's prices section). ⚠️ A day that trips the **>20% feed-drop guard** is HELD, not loaded — a chain gone silent (F50/F55) — because loading it would DELETE that chain's prices from `price_current`; that is a feed problem to resolve upstream, not something to force through here. |
   | `update-schools` (МОН matura/НВО/context — `indicators_mon_dzi`)                | `pnpm run db:load:schools:pg:cloud` (loads `schools`/`school_scores`/`school_context` + all three `school_payloads` kinds — the `directory` payload `/education` + `/school/:id` read, the slim `risk` payload the МОН pack's SchoolRiskTile reads, and the per-place `place` blobs keyed by oblast/obshtina code that the `/governance/region/:oblast` education section reads — one loader writes all three; skip it and that section serves the previous matura vintage at a 200). **ALSO GCS**: `data/schools/index.json` (My-Area tile) + `data/education/*.json` (textbook-market tile, incl. the per-year slices for the scope pill) stay GCS-served, so emit `pnpm run bucket:sync:paths schools education` too. If only the textbook market changed (АОП, no ДЗИ), the bucket sync alone suffices — no Cloud SQL load. |
   | `update-persons` (person-identity layer — ANY people source, incl. `cik_results`/`ivss_declarations`/`cacbg_officials`/`cacbg_local`/`egov_commerce`/`erik_campaign_financing`/`parliament_mps`/`ofac_sanctions`/`comdos_ds`/`regulator_rosters`) | **The full ordered chain below — NOT just the resolve.** See "Person layer: the whole cloud chain" right after this table. The `person_*`/`candidate_person`/`person_election_stats` tables are **Postgres-only** (no serving JSON, no `bucket:sync`) — Cloud SQL is the ONLY publish target, so this MUST be emitted whenever the local re-derivation ran, or `/person` + the merged `/candidate` + `personProfile`/`personConnections`/`person_elections` go stale on prod. Reads the SAME PG upstreams (`magistrate`/`official_roster`/`tr_person_roles`/`contracts`) from the cloud proxy, so those must already be loaded there (they ride procurement/tr/magistrate cloud loads above). The resolve self-bootstraps a fresh Cloud SQL (085 before 082). Also needs a `pnpm run deploy` (functions) once so `db_routes.js` serves the `person-profile`/`candidate-person`/`person-elections` routes. |
   | `update-administration` (ИИСДА services register — `iisda_services`)            | `pnpm run db:load:admin-services:pg:cloud` (loads the `admin_services` table + the `services_overview.json` aggregate behind `/sector/administration`), then `pnpm run db:load:admin-service-requests:pg:cloud` (the еФорми request volumes, migration 201 — no watcher, so it rides this row). The other administration artifacts (egov / digital-skills / service-quality / context) are static JSON under `data/administration/` → GCS via `bucket:sync data/administration/`, no Cloud SQL. |
   | `update-budget` (state budget + the municipal side — `egov_budget_execution`, `ministry_execution_reports`, `budget_law`, `dv_investment_annex`, `minfin_program_otchet`, `municipal_fiscal_due`, `capital_programs`, `ipop_mrrb`, `egov_municipal_execution`) | `pnpm run db:load:place-dim:pg:cloud && pnpm run db:load:municipal-fiscal:pg:cloud && pnpm run db:load:budget:pg:cloud && pnpm run db:load:budget-muni:pg:cloud && pnpm run db:load:budget-hub:pg:cloud` — **in that order.** `place-dim` is a hard prerequisite of 149 (its serving functions JOIN it and a `LANGUAGE sql` body is validated at CREATE, so the file 42P01s and `exec()`'s single transaction leaves NO `municipal_fiscal` table at all); `budget-hub` must be LAST because 156's matview reads eleven relations produced by the four loaders before it (its twelfth, `budget_peer_band`, it fills itself). `budget:pg` and `budget-muni:pg` are different corpora — the STATE budget (152 КФП, 153 admin/programme/COFOG) versus the MUNICIPAL side (154 transfers, execution, capital + ИПОП) — and neither fills the other's tables. Until 2026-08-20 `update-budget/SKILL.md` contained zero `db:load` and zero `:cloud` strings, so the `/budget` module had no written publish path of its own — only `place-dim` was named elsewhere, which is why four exemptions lifted rather than five. |
   | `update-judiciary` (ВСС court statistics / ИВСС register — `vss_court_statistics`, `ivss_declarations`) | `pnpm run db:load:court-load:pg:cloud && pnpm run db:load:magistrates:pg:cloud && pnpm run db:load:magistrate-filing-assets:pg:cloud && pnpm run db:load:judicial-bodies:pg:cloud`, plus `pnpm run db:load:judiciary-payloads:pg:cloud` when `__write_declarations.ts` ran. **The one FORCED edge is `magistrates` → `magistrate-filing-assets`, and it is the edge that gets dropped**: the magistrates loader TRUNCATEs `magistrate`, which blanks the per-filing declaration metadata and the parsed property count on every magistrate card until the asset loader re-runs. `judicial-bodies` is indifferent to that pair but must follow `court-load` AND `magistrates` (it folds `magistrate.court` ∪ `court_load.name`), so it could equally sit before the asset loader. The mechanism, the measured counts and the verification queries are NOT restated here — see `update-judiciary`'s Cloud SQL publish block, which is their one home. ⚠️ `magistrate-filing-assets` reads the gitignored `raw_data/judiciary/filing_cache.json`, so on a machine that never ran the crawl it skips-and-warns at exit 0 — a safe no-op, but not a repair. If `update-persons` runs in the same session its `db:resolve:persons:cloud` must follow `judicial-bodies` — see the person-layer chain below. |
   | `update-kzk-appeals` (`kzk_appeals`)                                            | `DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg pnpm exec tsx scripts/db/apply_functions.ts 042_kzk_appeals.sql` then the same-URL `pnpm exec tsx scripts/procurement/kzk_appeals.ts --year <YYYY> --apply`. There is no `db:load:kzk:pg:cloud` — the crawl **is** the loader, so publishing means re-crawling against the cloud URL. The DDL is idempotent; apply it every time.                                                                                                                                                                                                      |

   **Cross-check the publish set with the resolver.** The table above is
   hand-maintained; to compute the minimal, dependency-ordered `:cloud` commands for
   the base datasets that actually changed, run:

   ```bash
   pnpm run deploy:resolve contracts tenders   # name each changed base table
   ```

   It prints the ordered `pnpm run …:cloud` lines (via the chain-aware resolver,
   `scripts/db/lib/deployResolver.ts` + the v2-c registry), routes the committed-artifact
   generators to a `bucket:sync` note, and flags any change whose base load is a manual
   crawl. Use it as a check that the hand-emitted list is complete and correctly ordered —
   it is not yet the source of truth (that is v2-e's remaining wiring), but a loader it
   emits that you did not is a gap, and vice-versa.

   Each `db:load:*:cloud` wrapper points `DATABASE_URL` at the Cloud SQL proxy (`127.0.0.1:5434`, password read from `.pgpass`) and delegates to the base load — which reads the same fresh `data/` artifacts, reloads its table (`TRUNCATE`+COPY for most; a stage merge for the loaders that have been migrated, e.g. both funds tables), AND rebuilds the dependent matviews / `awarder_risk_grade_scoped` **on cloud** — so the served data stays self-consistent. It reads the on-disk artifacts, not local Postgres, so it's correct regardless of local PG state.

   ### Person layer: the whole cloud chain (emit ALL of it, in THIS order)

   The `update-persons` row above is the one place where emitting "the loader for
   the thing that changed" is not enough. `db:resolve:persons:cloud` READS four
   inputs and DROPS one matview, so four loaders must run BEFORE it and three
   AFTER. Three of the four fail **silently**, by publishing blanks rather than
   erroring; the fourth, `tr-name-fold-people`, is the one that throws — which is
   the good failure, but it aborts a ~29 min cloud resolve, so load it up front
   rather than discovering it at the end. Emit the whole block; do not reconstruct it from memory
   or from CLAUDE.md piecemeal (that is exactly how `place-dim` got dropped from
   the emitted chain on 2026-07-29):

   ```bash
   # BEFORE the resolve — it reads all four. Three of them fail SILENTLY: an empty or stale
   # place-dim / judicial-bodies / declarations-phase-1 publishes blanks, not an error.
   # tr-name-fold-people is the exception — the resolve throws rather than under-publish.
   pnpm run db:load:place-dim:pg:cloud          # 117 — mir/obshtina labels on ~76.5k roles
   pnpm run db:load:judicial-bodies:pg:cloud    # 116 — the court on ~2,700 magistrate roles
   pnpm run db:load:tr-name-fold-people:pg:cloud  # Bridge B's evidence table. The resolve
                                              #   THROWS on an empty one (naming this
                                              #   command), so it is a hard prerequisite
                                              #   rather than a follow-up — and it aborts
                                              #   the ~29 min cloud resolve, not a 5 min one.
   pnpm run db:load:declarations:pg:cloud       # phase 1 — rewrites subject_ref AND is what the
                                               #   resolve reads for the register gold key
   pnpm run db:resolve:persons:cloud            # 7m 35s measured 2026-08-29 on
                                               #   db-custom-2-13312 (61,743 filings).
                                               #   Earlier figures on this line — "~5 min"
                                               #   (2026-08-05) then 1733 s / 28.9 min
                                               #   (2026-08-11, db-g1-small) — are both
                                               #   superseded; the second over-stated by ~4x
                                               #   and was used to argue against running it.
   # AFTER the resolve — 115 drops person_role.place, taking the municipal roster matview with it
   pnpm run db:load:declarations:pg:cloud --resolve   # re-applies 102, rebuilds that matview
   pnpm run db:load:company-politicians:pg:cloud         # re-keys person_id the resolve renumbered — graph refuses without it
pnpm run db:load:employer-links:pg:cloud     # 165+168 — a pure derivation over
                                           # declaration.filed_institution × contracts.awarder_name.
                                           # A declarations-only flip still needs it: 168 joins
                                           # `declaration` live, so only NEW employer spellings go
                                           # missing — silent, not a 500.
   pnpm run db:load:official-candidate-links:pg:cloud    # re-decorates + REFRESHes it
   pnpm run db:load:person-elections:pg:cloud
   pnpm run db:load:persons-browse:pg:cloud              # folds all of the above + contracts
   pnpm run db:load:person-search:pg:cloud              # the combined-search index (reads persons-browse)
   pnpm run db:load:graph:pg:cloud                       # LAST — the /connections graph (reads persons-browse facets + tr + procurement)
   ```

   **Why phase 1 moved ABOVE the resolve on 2026-08-11.** It used to sit below it, with a
   comment reading "BOTH declaration phases, phase 1 FIRST" — which meant first *of the two
   phases*, not first *of the chain*. CLAUDE.md has always said the cloud order is phase 1 →
   resolve → `--resolve`, and this block contradicted it. The cost is specific:
   `registerIdByRef()` reads `declaration` for the Сметна палата gold key, so a resolve that
   runs before phase 1 keys against the PREVIOUS filing set. Measured on the 2026-08-11
   deploy, which published a 1,644-filing MP backfill: the cloud resolve reported **778
   mentions aliased to an MP id where local reported 929**, and prod ended at 132 MP↔declarant
   split pairs against local's 124 — the entire benefit of the backfill, absent, with every
   row count on both sides reconciling exactly (49,627 filings, 5,575 mp-tier, 935 refs).
   Re-running resolve → `--resolve` → the five downstream loaders fixed it, at the cost of a
   second ~65-minute pass.

   **It is invisible unless phase 1 CHANGES something.** On a deploy where the declaration
   corpus is unmoved, the resolve reads the same table either way, which is why the wrong
   order survived. Note the OTHER symptom CLAUDE.md predicts for this misordering — officials
   postings publishing undated — did NOT appear, because prod already held the older filings
   and so already had their `subject_ref`; only the 1,644 new ones were unseen. Do not use
   "office dates look fine" as evidence the order was right.

   What each omission costs, all of them green-locally / blank-on-prod:

   | Omitted | Symptom on prod |
   |---|---|
   | `place-dim` | ~76.5k `mir`/`obshtina` roles publish `placeLabel: null`; the ~2.7k judicial roles keep theirs, so it reads as partial and is easy to miss |
   | `judicial-bodies` | ~2,700 magistrate roles publish with no court |
   | `declarations` phase 1 (running only `--resolve`) | A roster re-slug leaves `declaration.subject_ref` stale, so it joins to nothing: that filing keeps a NULL `person_id` and the person drops off `/person` and out of the "с декларация" facet **while every row count still reconciles**. `--resolve` does print `N/total still NULL`, so it is not literally silent — but a single-digit N against ~48k reads as ordinary residue, which is exactly how it was missed on 2026-07-31 (1 of 47,983). Re-run `persons-browse` after, since `has_declaration` reads `person_id`. |
   | `declarations --resolve` | `declaration.person_id` all NULL → `has_declaration=false` for every person; the "с декларация" filter matches nobody and its KPI reads 0%, while net worth still renders. **Shipped to prod once.** |
   | `official-candidate-links` | municipal roster matview left dropped → `/governance` + officials search degrade to an empty list without erroring |
   | `persons-browse` | `/persons` serves the previous vintage; its money column silently disagrees with `/procurement/contracts` |

   `place-dim` and `judicial-bodies` are cheap and idempotent, so emit them
   unconditionally rather than trying to decide whether their inputs moved —
   deciding wrong is invisible, re-running is ~seconds. `place-dim` stays cheap
   on a no-op run only because it fingerprints the table either side of the
   rewrite and skips its downstream refresh when nothing changed; when the
   dimension GENUINELY moves it also rebuilds the per-scope precomputes that
   store place labels (119 + 123), which is minutes on Cloud SQL, not seconds.
   It says which of the two it did. **Verify before the resolve, not after:**
   `select count(*) from place_dim` and `from judicial_body_alias` must both be
   non-zero on the target.

   **Prereq:** the Cloud SQL proxy must be running on `127.0.0.1:5434` and `.pgpass` must hold the proxy line — if the proxy is down, just list the commands for the user to run once it's up. (See the memory note "db:dump local vs Cloud SQL" for the proxy/`.pgpass`/`host.docker.internal` mechanics.)

   **`db:dump` / `db:dump:cloud` is NOT a publish step.** `scripts/db/dump.ts` is a snapshotter: it `pg_dump`s whatever `DATABASE_URL` points at and uploads the dump to GCS + updates the committed lockfile, so a fresh clone can `db:restore` instead of re-ingesting. Pointed at the proxy (`db:dump:cloud`) it dumps Cloud SQL **outward**. It writes nothing into cloud and cannot create a missing table. Never list it _instead of_ a `db:load:*:cloud`; list it _after_ one only if a restore point is wanted.

   **Datasets with no `db:load:*:cloud` wrapper** publish by re-running their writer against the proxy URL, because the ingest itself is the loader: `update-kzk-appeals` (`apply_functions.ts 042_kzk_appeals.sql`, then the crawl), which needs `DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg` prefixed.

   **`update-agri` used to be in that list and is not** — it has TWO wrappers, and both must run:

   ```bash
   pnpm run db:load:agri:pg:cloud
   pnpm run db:load:agri-hub-stats:pg:cloud
   ```

   The second is the sole applier of migration 163 (`agri_political_link`, `agri_cross_programme`); `agri:ingest` refreshes 162 only. Both are DbDataTable resources with no `missingMigration` degrade, so omitting it leaves `/subsidies/political` and `/subsidies/cross-programme` answering **500**, not an empty page.

   **Opt-in / periodic (no daily watcher — do NOT auto-emit):** `db:load:nzok-tariffs:pg` / `db:load:nzok-tariffs:pg:cloud` (the НРД clinical-pathway tariffs, `nzok_pathway_tariffs`) rides `update-nzok --pathway-tariffs`, which is BG-egress + manual (like `--revenue` on line 477) and not in the default set — publish it only when that opt-in step is actually re-run. Same for the one-off `company_founded` procurement-risk backfill (`scripts/procurement/fetch_company_founded.ts`, written directly against the target `DATABASE_URL`, no loader wrapper) — cloud currently holds only a stub, so the `newFirmWinner` flag is dormant on prod until someone runs the backfill against the proxy. ⚠️ Runtime is **pace-dependent, not a fixed figure** (~14h per 10k EIKs while the source answers; far longer once it throttles), it **requires 033's `http_status`/`attempts` columns to have been applied to that DB first** (the script preflights and exits 2 otherwise), and a run that hits a hard block trips a circuit breaker and exits 1 rather than grinding — resume it from a different egress. A failed fetch is never written, so the run is always safe to re-run.

   For a whole-DB reconcile instead of per-dataset (e.g. several PG-backed skills ran, or disaster recovery): `pnpm run db:sync:cloud --yes` — pg_dump local → pg_restore cloud, destructive (`--clean`), so local must be the source of truth first. Note this includes the unregenerable КЗК tier-2 outcome rows, so run `update-kzk-appeals` locally before syncing.

10. **Close the trace and read it back.** After the publish set is resolved, print this session's
    timings — it is part of the deliverable, not a debugging aside:

    ```bash
    pnpm run -s perf:report --run process-watch-report --last 3
    ```

    Two things to actually look at rather than paste:

    - **The session's slowest steps.** If a step is materially slower than its own median in the
      "cost by step" table, say so in the summary. That comparison is the whole reason the trace
      is append-only — a duration means nothing on its own.
    - **Steps with no row.** Compare the row count against what you ran. A step you forgot to
      record is a hole that reads as "fast" forever.

    Nothing here fails the run. A slow step is a finding for later, not a reason to stop.

11. **Commit the run — automatically, by explicit pathspec.** A run's whole output is files on
    disk: refreshed artifacts under `data/`, the ingest markers, the public change log, the data
    map, this run's trace, and the upload manifest. Leaving them uncommitted is what lets a later
    session's `git add -A` sweep them into an unrelated commit under a misleading message.

    So commit at the end of every run, without asking. This is the ONE place this repo's
    "commit only when asked" default is pre-authorised, because the operator asked for it here.

    ```bash
    # 1. See what moved — and ONLY in the trees this orchestrator writes.
    git status --porcelain -- data state/watch state/ingest state/perf state/upload public
    ```

    ⚠️⚠️ **NEVER `git add -A`, and never a bare `git commit`.** A bare `git commit` ships the
    WHOLE INDEX, and in this repo the index is almost never clean at session start — a concurrent
    process runs `git add -A` mid-session and other sessions leave work staged. Commit by
    pathspec, which builds from HEAD plus exactly those paths and leaves every other index entry
    untouched and still staged:

    ```bash
    git commit -m "watch: ingest <source labels> (<one-line recap>)" \
      -- data/... state/ingest/... state/perf/process-watch-report.jsonl state/upload/pending.json
    ```

    Four rules, each of which has already gone wrong here at least once:

    - **Name every path; sweep none.** Expand the `--` list from the `git status` above. If a
      file in those trees is shown as already STAGED (a first-column `M`/`A`), it is not yours —
      leave it out and say so in the summary.
    - **Nothing outside those five trees.** Source changes, test changes and skill edits
      belong to whoever was editing them. This orchestrator is data-only.
    - **`git commit -- <path>` reads the WORKING TREE, not the index.** You cannot partially
      commit a file another session is also editing; check `git diff -- <path>` first, and an
      EMPTY diff on a file you just wrote means somebody else already committed it.
    - **No `Co-Authored-By` trailer.** Plain message body, end.

    Commit even when only markers moved (a no-data run still advances `state/ingest/*` and the
    trace) — that is a real, meaningful commit. The only run that commits nothing is one where
    `git status` on those five trees is empty.

    Capture the sha for the manifest: `COMMIT=$(git rev-parse --short HEAD)`.

12. **Finish the manifest, then decide whether the run earned its publish.** The commit is the
    end of the INGEST half. Nothing has reached production yet: the bucket still serves the
    previous vintage of every file this run wrote, and Cloud SQL still holds the previous vintage
    of every PG-backed dataset.

    Finish the manifest — the bucket subtrees this run touched, the skills that ran, the commit:

    ```bash
    pnpm exec tsx scripts/upload_manifest.ts write --session "$S" --commit "$COMMIT" \
      --skills update-procurement,update-funds \
      --paths myarea,budget,data_map.json,data-changes.json \
      --notes "<one line: what a reader would see change>"
    pnpm exec tsx scripts/upload_manifest.ts show
    ```

    `--paths` are `bucket:sync:paths` arguments — the subtrees under `data/` that actually moved,
    derived from step 11's `git status`, never a guess. `data_map.json` and `data-changes.json` are
    almost always among them. PG-served trees do NOT go here (see step 9).

    **The generated blobs are added FOR you.** Given `--commit`, the writer reads that commit's
    changed files and appends the `bucketPath` of every `REFRESH_GENERATORS` /
    `UPLOAD_PUBLISHED_ARTIFACTS` artifact it touched (`generatedPathsTouched`,
    `scripts/lib/upload-manifest.ts`), and prints them as `+ generated artifacts touched by …`.
    That covers what `db:refresh` rewrites beside the tree a skill was asked about —
    `procurement/derived/*`, `roads/derived/hub_stats.json`, `water/derived/hub_stats.json`, `transport/derived/hub_stats.json`,
    `water/flood_maintenance.json`, the culture/governance/home blobs — which is the class a
    hand-written `--paths` kept dropping. Pass `--commit` always. ⚠️ It reads THAT commit only: a
    blob another process committed mid-session is not in it, which is why `/upload-watch-changes`
    Step 3 also syncs anything `db:check-generated` still finds unpublished.

    Then apply the gate. **The publish follows automatically (step 14) unless the run hit a
    MAJOR ISSUE**, which means any of:

    - a queued skill ended in `error` — including one the operator chose to skip past under the
      Data-integrity contract's "(a) skip and continue"; the corpus that skill owns is unstamped
      and unverified, and half a publish beside it looks like a whole one;
    - a post-step exited non-zero: `myarea:alerts` / `myarea:alerts:cloud` (6), `data:map` (7),
      any home generator or **`home:health`** (7b — its own rule says red means DO NOT publish);
    - a `perf:chain` (`db:refresh`, `tr-daily-refresh`) aborted part-way — the corpus a loader
      failed to update is unverified, and `test:data` at the end of the chain never ran;
    - the commit at step 11 failed, or a path this run wrote was already staged by another
      session and had to be left out — the manifest would then name a commit that does not
      carry what it claims;
    - the manifest is malformed — a `--paths` entry the sync guard refuses, or a PG-backed skill
      ran and its `--cloud` set could not be resolved (the proxy being DOWN is not this: the
      publish skill checks that itself);
    - the operator said "hold the publish" / "don't upload" at step 3, or at any point since.

    Not a major issue, and not a reason to hold: a skill that ran and found nothing; a `partial`
    status (anomalies go in the summary's Notes); a skill skipped for a still-missing manual
    download (step 0); the watcher's own `## Errors` section; a `STALE` from `db:check-generated`
    (the upload is what fixes it); schema drift from `db:check-cloud` (surfaced, never applied).

    When the gate HOLDS, say so plainly in the summary's Next steps and stop there:

    > Ingest committed as `<sha>`. Nothing is live yet — the bucket and Cloud SQL are both still
    > on the previous vintage. **Not publishing**: <the major issue, one line>. The manifest
    > (N bucket path(s), M cloud command(s)) stays pending — run `/upload-watch-changes` once
    > that is resolved.

    ⚠️ **Never run `bucket:sync` or a `:cloud` loader from this skill.** Whether the publish
    happens now (step 14) or later (the operator), it happens through `/upload-watch-changes`
    reading this manifest — the one path that records what was published and clears the debt.
    (Step 6's `myarea:alerts:cloud` is the standing exception: a derived feed that lives only in
    Postgres, documented there.)

    ⚠️ **A pending manifest is a DEBT, and it survives across runs on purpose.** When the publish
    is held — by the gate or by the operator — the file stays on disk and the NEXT orchestrator
    run merges into it rather than replacing it, so the first run's subtrees cannot be lost. Read it at the top of every run
    (`pnpm exec tsx scripts/upload_manifest.ts show`) and say so in the plan when one is already
    pending — "yesterday's ingest is still unpublished" is a fact the operator needs before
    deciding what to run today.

## Bootstrap (first orchestrator run after this migration)

When `state/ingest/<skill>.json` is missing for a queued skill, you have two paths — ASK the user which:

**(a) Treat current state as the baseline (recommended for established repos)**
Stamp the marker to `now` without actually running the skill. This says "everything up to this moment is considered ingested; future changes will trigger ingest normally". Use when the user knows the existing data is up to date (typical case — the repo has already had ingests via earlier workflows).

```bash
pnpm exec tsx scripts/stamp-ingest.ts <skill-name> --summary "bootstrap: marker seeded, no run"
```

**(b) Actually run the skill (true backfill)**
For a clean clone, an explicit backfill, or when the user is unsure whether existing data is current. The skill runs, ingests anything new, then the marker is stamped on success.

Default to asking unless the user said "bootstrap markers" or "run all" or similar upfront.

13. **Final summary (REQUIRED).** Once all skills have run, print a structured per-skill recap. This is the deliverable — never collapse it into "all done" or a single paragraph. Format:

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

   ## Timings

   | step | this run | median | notes |
   | --- | --- | --- | --- |
   | <step> | <duration> | <its own median> | slower/faster than usual, or blank |

   Total work: <sum of step durations> across <N> steps. Slowest: <step> (<duration>).

   ## Next steps

   - **Committed**: `<sha>` — <N> files. (Or: "nothing to commit" when the five trees were clean.)
   - **Publishing now**: `/upload-watch-changes` follows this summary — <N> bucket path(s),
     <M> cloud command(s). (Or, when step 12's gate held: **Not publishing** — <the major
     issue>; the manifest stays pending, run `/upload-watch-changes` once resolved. Or:
     "nothing to publish" when no manifest was written.)
   - Whether to `git push` or hold
   ```

   **The Timings table is REQUIRED and is not the same thing as the perf report.** Paste the
   handful of rows that matter — the slowest steps, plus any step materially off its own median —
   with the comparison, not the raw numbers. "db:refresh 1h 12m (median 47m)" is the sentence;
   "db:refresh 1h 12m" is a number nobody can act on. Take both columns from
   `pnpm run perf:report`; do not recompute them by hand.

   **For a "no changes detected" run** (skill executed but found nothing new — e.g. `update-rollcall` walking past the last known stenogram id and finding no new sessions), explicitly write `**Status**: ok — no data changes detected` and `**Files changed**: none`. Do NOT silently omit the skill from the summary — the user must see that it ran and found nothing.

   **For a "partial" status** (skill produced some output but also surfaced anomalies — unresolved MP ids, mismatched names, etc.), name each anomaly in the **Notes** field. The data was written; the warning is what the user needs to act on.

   **For an "error" status** (skill threw), copy the error message verbatim and stop the orchestrator — don't proceed to the next skill until the user decides how to handle.

   **Quote concrete numbers from skill stdout.** If `update-rollcall` printed `+ 2026-05-09 (id 11124): 11 item(s), 2640 rows · 37 unresolved id(s) → sessions/2026-05-09.json`, that's the kind of detail that belongs in **Captured**. If `update-macro` printed `Loading gdpGrowth (eurostat)... 84 points (latest 2025 Q4)` for 22 indicators, summarise: "22 indicators refreshed; latest period 2025 Q4 (quarterly), 2025 (annual)" — but if any indicator's count changed, name it.

   ### Publishing is a SEPARATE skill — invoked from here, never re-implemented here

   After committing, `data/` lives in two places: the git repo (history, audit) and
   `gs://data-electionsbg-com` (what the live SPA fetches). The bucket is the one users see, and
   Cloud SQL is the one `/api/db` serves. **Neither is touched by this skill's own commands.**

   Both are published by **`/upload-watch-changes`**, which reads the manifest step 12 wrote and
   which step 14 invokes after a run with no major issue — so this skill's job is to have named
   the right `--paths` and `--cloud` entries and to have judged the gate honestly, not to print
   sync commands. The mechanics (scoped vs whole-tree sync, the refused PG-served trees,
   deletions, gzip transport encoding, the Cloud SQL proxy) live in that skill's own procedure,
   where they are executed rather than quoted.

   Two things stay this skill's responsibility, because only it knows them:

   - **`--paths` is derived from step 11's `git status`, never guessed.** A subtree a skill wrote
     and the manifest omits is a subtree that stays stale on the bucket at a 200, with the commit
     looking complete. This is the single most common publish miss in this repo's history.
   - **When `Files changed` is "none" for every skill and no PG-backed skill ran, write no
     manifest at all** — an empty manifest is a debt the next run has to reason about for nothing.
     Say "nothing to publish" in Next steps instead.

   Code/UI changes are out of scope for this orchestrator (`pnpm run deploy` deploys the Firebase
   bundle and is not needed for pure-data refresh).

14. **Follow up with `/upload-watch-changes` — unless step 12's gate held.** This is the LAST
    thing the run does, after the summary above has been printed: the ingest summary is this
    skill's deliverable and must not wait behind a publish that can take tens of minutes.

    Invoke it with the `Skill` tool, and tell it where it came from:

    ```
    Skill(upload-watch-changes, args: "invoked by /process-watch-report after a clean run —
      ingest session <S>, commit <sha>; proceed without re-asking")
    ```

    Three things about the hand-off:

    - **The step-3 confirmation is the authorisation.** The plan named the publish and the
      operator said yes to it; the publish skill's own "Proceed?" at its step 0 is answered by
      that, which is why the args say so. Without that phrase it asks again and waits — the
      right behaviour when a human invokes it cold, and the wrong one at the tail of a run the
      operator already approved.
    - **It is a separate run with its own trace and its own commit.** It mints its own perf
      session under its own run name, commits `state/perf/upload-watch-changes.jsonl` +
      `state/upload/history.jsonl` + the manifest's deletion itself, and prints its own summary.
      Do not re-summarise its output here, do not record its steps under THIS run's session, and
      do not commit on its behalf — step 11 already committed everything this skill wrote.
    - **A publish failure is that skill's to report, and it leaves the manifest pending.** If a
      loader fails or the proxy is down, the publish skill halts, keeps `pending.json`, and says
      which entries went live; the next orchestrator run reads the debt at step 1. Do not retry
      the publish from here.

    When the gate HELD, do not invoke it — the summary already said why, and what to run.

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
state/ingest/tr-daily-refresh.json:   lastSuccessfulIngest = 2026-05-01T...
state/ingest/update-macro.json:       lastSuccessfulIngest = 2026-05-05T...
```

Queue (`egov_commerce` → `tr-daily-refresh`; `cacbg_declarations` → `update-connections`; `eurostat` → `update-macro`):

1. `tr-daily-refresh`
2. `update-connections`
3. `update-macro`

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

````
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

## Timings

| step | this run | median | notes |
| --- | --- | --- | --- |
| update-macro | 2m 41s | 2m 12s | +22% — 7 upstream releases vs the usual 1-2 |
| update-financing | 18s | 17s | |
| myarea:alerts | 41s | 39s | |
| data:map | 3s | 3s | |
| db:check-generated | 11s | 11s | |
| db:check-cloud | 34s | 33s | |

Total work: 4m 28s across 6 steps. Slowest: `update-macro` (2m 41s).

## Next steps
- **Committed**: `a1b2c3d` — 4 files (`data/macro.json`, `data/data-changes.json`,
  `data/data_map.json`, `state/ingest/update-macro.json`), plus the trace.
```bash
git commit -m "macro: refresh through 2026 Q1 (7 new Eurostat releases)" \
  -- data/macro.json data/data-changes.json data/data_map.json \
     state/ingest/update-macro.json state/ingest/update-financing.json \
     state/perf/process-watch-report.jsonl state/upload/pending.json
````

- **Publishing now**: `/upload-watch-changes` follows this summary — 3 bucket path(s)
  (`macro.json`, `data_map.json`, `data-changes.json`), 0 cloud command(s). Neither
  `update-macro` nor `update-financing` is a Postgres-backed dataset, so the manifest
  carries no `:cloud` entries; had a PG-backed skill run (`update-procurement`,
  `tr-daily-refresh`, `update-funds`), step 9's commands would be in it.
- No `git push` needed yet — user decides.

````

The summary is mandatory whether or not data changed. A "no changes detected" run still gets a section per executed skill so the user can see what was checked.

## Data-integrity contract (CRITICAL)

This orchestrator MUST NOT claim success it didn't earn. Specifically:

1. **Trust downstream skills to fail loud.** Every tier-2 ingest skill is built to throw rather than write empty/partial data when upstream restructures. If a Skill invocation returns an error (or its terminal output contains "Error:", a stack trace, or otherwise signals failure), treat that source as **failed**, not "completed with warnings".

2. **Halt on first failure by default** (in unattended mode, take (a) automatically — see "Unattended mode"). When a downstream skill fails, STOP the orchestration. Do not proceed to the next mapped skill. Report which skill failed and what error, then ask the user whether to (a) skip and continue with the rest, (b) abort entirely, or (c) investigate.

3. **Never paraphrase ingest output as "done".** Read the actual stdout. Quote the relevant success/failure marker. Examples:
   - `update-rollcall` success looks like `+ YYYY-MM-DD (id N): K item(s), R rows · U unresolved id(s) → sessions/<date>.json` for each session, plus a final summary.
   - `update-financing` success looks like a per-section recap (`· <section>: N years` or `· <section>: not_implemented`).
   - If you don't see those lines, the skill did not write data for that target — say so.

4. **Don't hallucinate counts.** When reporting back, use exact numbers from the skill's actual stdout. If a skill says "found 0 new sessions, nothing to ingest" that is a legitimate result for weekends/recess — report it as zero, do not invent a number.

5. **Surface `not_implemented` separately.** Some skills (like `/update-financing`'s subsidii section) intentionally report `not_implemented` for parts they can't yet handle. Pass that through to the user verbatim — don't fold it into "success".

6. **Errors section of the latest report.** The watcher's own `## Errors` section in the most recent report file lists upstream-fetch failures. Surface those to the user but **do not auto-retry them via this orchestrator** — the watcher will re-probe them on its next run. Manual investigation only.

7. **Only stamp `state/ingest/<skill>.json` on success.** If the skill threw, do NOT stamp. The next orchestrator run will re-detect the source as still-needing-ingest and re-queue the skill. This is the self-healing property — a transient failure isn't masked.

8. **Manual skill invocations don't stamp.** If the user runs `/update-rollcall` directly (outside the orchestrator), no marker is written. The orchestrator's next run will see `source.lastChanged > skill.lastSuccessfulIngest` and re-queue the skill. Since every tier-2 skill is idempotent on no-op input (rollcall walker finds no new sessions, financing scraper writes the same 15 years, etc.), this is wasteful at most — never wrong. The user can manually stamp after a direct run: `pnpm exec tsx scripts/stamp-ingest.ts <skill-name>`.

9. **The publish follow-up inherits every halt above.** Step 14 invokes `/upload-watch-changes` only for a run with no major issue (step 12's list). A run that halted on a failed skill, skipped past one, lost a post-step, or could not commit leaves the manifest pending and ASKS — it never publishes a corpus whose ingest it could not vouch for.

## What this skill does NOT do

- **Does not re-run the watcher.** State files are the input. If you want fresh fingerprints, run `pnpm run watch` first.
- **Does not PUSH.** It DOES commit — automatically, by explicit pathspec, at step 11 (that is this repo's one pre-authorised commit; everywhere else the rule is "commit only when asked"). Pushing stays the user's call. It never sweeps the index and never commits outside `data/`, `state/watch/`, `state/ingest/`, `state/perf/` and `state/upload/`.
- **Does not publish with its own commands.** Neither the bucket nor Cloud SQL — both are production — is touched by anything this procedure runs (step 6's `myarea:alerts:cloud` is the one exception: a derived feed that lives only in Postgres). It reloads LOCAL Postgres (inside each PG-backed skill), RECORDS the ordered `db:load:*:cloud` set and the touched bucket subtrees into `state/upload/pending.json`, and then — after the summary, and only when the run hit no major issue — invokes `/upload-watch-changes` (step 14), the ONLY path that publishes. On a run with a major issue it leaves the manifest pending and asks instead.
- **Does not judge its own timings.** It measures every step into `state/perf/process-watch-report.jsonl` and reports what is slower than usual; it never skips or reorders work to go faster. Optimisation is a separate decision made from the accumulated trace.
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

# --- the performance trace (Procedure steps 1, 4, 6-8b, 10) ---
pnpm run -s perf:step -- session               # once per run; PASTE the id, don't use a var
pnpm run -s perf:step -- run    --run process-watch-report --session "$S" --step X --phase derive -- <cmd>
pnpm run -s perf:step -- record --run process-watch-report --session "$S" --step X --phase ingest --started "$T0"
pnpm run -s perf:chain -- db:refresh --session "$S" --phase ingest   # one row PER LINK
pnpm run -s perf:report --run process-watch-report --last 5
pnpm run -s perf:chain -- db:refresh --dry-run                       # list the links, run nothing

# --- the ingest → publish handoff (Procedure steps 9, 12) ---
pnpm exec tsx scripts/upload_manifest.ts show       # is yesterday's ingest still unpublished?
pnpm exec tsx scripts/upload_manifest.ts write --session "$S" --commit "$COMMIT" \
  --skills update-procurement --paths myarea,data_map.json --cloud "pnpm run db:load:pg:cloud"
# then: Skill(upload-watch-changes)  ← step 14 invokes it after a run with no major issue;
#       a run WITH one leaves the manifest pending and asks the user instead

# Cloud SQL commands the manifest carries — /upload-watch-changes runs them.
# Listed here because step 9 is where the set is RESOLVED (proxy on :5434 + .pgpass).
# Per-dataset (non-destructive; rebuilds cloud matviews too):
pnpm run db:load:pg:cloud                # procurement contracts
pnpm run db:load:tenders:pg:cloud        # tenders
pnpm run db:load:tr:pg:cloud             # TR + NGO register
pnpm run db:load:funds:pg:cloud --full   # EU funds — REFUSES without a scope flag;
                                        #   --full after an ИСУН re-ingest, else --payloads-only
pnpm run db:load:funds-fit:pg:cloud      # sole applier of 143+144+145 (fit card, wire, hub cache)
pnpm run db:load:place-dim:pg:cloud      # HARD prerequisite of 149 below
pnpm run db:load:municipal-fiscal:pg:cloud
pnpm run db:load:budget:pg:cloud         # state budget: 152 КФП + 153 admin/programme
pnpm run db:load:budget-muni:pg:cloud    # municipal side: 154 transfers/execution/capital
pnpm run db:load:budget-hub:pg:cloud     # LAST — 156 reads all of the above
pnpm run db:load:ngo-funding:pg:cloud    # NGO funding (EC FTS)
pnpm run db:load:awarder-seats:pg:cloud  # awarder seats
pnpm run db:load:graph:pg:cloud          # /connections graph — re-derive after tr / persons / contracts (run after persons-browse)
pnpm run db:load:tr-company-place:pg:cloud # place-companies tile — re-derive after tr / contracts / agri / funds
pnpm run db:refresh:risk:cloud           # BOTH risk caches — after tr / contracts / debarred / КЗК / a re-applied migration
# Whole-DB reconcile (destructive --clean; local must be source of truth):
pnpm run db:sync:cloud --yes
````
