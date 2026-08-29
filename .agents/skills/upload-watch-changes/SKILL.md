---
name: upload-watch-changes
description: Publish what /process-watch-report ingested — push the touched data/ subtrees to the GCS bucket and run the ordered db:load:*:cloud commands against Cloud SQL, timing every step into an append-only trace. Reads state/upload/pending.json (the manifest the ingest run wrote) so nothing is guessed. Use when the user says "upload the changes", "publish to cloud", "sync the bucket", "push the data live", "качи промените", or answers yes to the orchestrator's "upload to cloud now?" prompt.
allowed-tools:
  - Read
  - Bash
---

# Upload watch changes (publish skill)

`/process-watch-report` is the INGEST half: it refreshes `data/`, reloads LOCAL Postgres and
commits. Nothing it does reaches a reader. This skill is the PUBLISH half — the bucket the SPA
fetches (`gs://data-electionsbg-com`) and the Cloud SQL instance `/api/db` serves.

**Both targets are PRODUCTION.** That is why they are a separate, user-invoked skill rather than
the tail of the orchestrator: the operator decides when the site changes.

## Inputs

- **`state/upload/pending.json`** — the manifest. The ingest run wrote it because it is the only
  thing that knows what moved: which `data/` subtrees it touched, which ordered `:cloud` loaders
  the changed datasets need, which skills ran, and the commit sha.
- `state/perf/upload-watch-changes.jsonl` — the append-only publish trace this skill extends.

⚠️ **The manifest is the work list — do not re-derive it from a git diff.** Every documented
publish miss in this repo is that re-derivation going wrong: a subtree left out of the scoped
sync, a `:cloud` loader nobody ran, prod serving the previous vintage at a **200** with every row
count reconciling. If the manifest looks wrong, fix it in the manifest and say so; do not quietly
substitute your own list.

**No manifest is a valid answer.** `npx tsx scripts/upload_manifest.ts show` printing "No pending
upload" means everything ingested has already been published. Say that and stop — do not go
looking for something to sync.

## Performance trace — EVERY step is timed

Same harness as the ingest half, different file:

```
state/perf/upload-watch-changes.jsonl
```

Append-only, committed, one row per step, one `session` per publish run. It exists because the
publish is where the *unpredictable* time is: a `bucket:sync:paths` is ~1 min or ~30 min depending
on what it was handed, and a cloud loader is 3 s or 40 min depending on which one and how much
moved. Those are exactly the numbers nobody has, and a single "the upload took a while" names
nothing to fix.

```bash
# once, at the top of the run — then PASTE the printed id into every later command.
# ⚠️ A shell variable does NOT survive between tool calls: `S=$(…)` set in one call is
# EMPTY in the next, and `--session ""` files rows under a blank session that no rollup
# can group. `$S` below is shorthand for "the literal id this printed".
npm run -s perf:step -- session

# every command goes through this
npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
  --step "bucket:sync:paths myarea" --phase publish -- npm run bucket:sync:paths -- myarea

# read it back
npm run -s perf:report -- --run upload-watch-changes --last 5
```

Four rules, all of them ways the trace goes quietly WRONG rather than absent:

- ⚠️ **`--step` labels must be deterministic across runs.** For a bucket sync the label is
  `bucket:sync:paths <subtree>` — **one step per subtree**, not one step for the whole call, and
  never with today's file count in it. Per-subtree is the point: "which tree is the slow one" is
  the question, and a single row for `myarea budget data_map.json` cannot answer it. For a cloud
  loader the label is the npm script name (`db:load:pg:cloud`), args and all.
- ⚠️ **Record bytes where they are known.** `--bytes <n>` on a sync step turns a duration into a
  throughput, which is the only way to tell "the bucket was slow" from "we pushed 400 MB".
- ⚠️ **A refused or skipped command still gets a row** (`--status skipped` plus the reason). A
  cloud command the operator declined and a cloud command nobody noticed look identical in a
  trace that only records what ran.
- **A failed step is still a step.** `perf:step run` records the non-zero exit, then propagates
  it. Do not swallow the row when the publish halts — an aborted publish is the most interesting
  row in the file.

`phase` here is `publish` for the two upload blocks and `verify` for the checks.

## Procedure

### Step 0 — read the manifest, and confirm before touching production

```bash
npm run -s perf:step -- session      # mint once; PASTE the printed id into every later command
npx tsx scripts/upload_manifest.ts show
git log --oneline -1
```

Print the plan and **wait for a yes** (unless the user already said "publish it" / "go"):

> Publishing the ingest committed as `<sha>` (`update-procurement`, `update-funds`):
>
> - Bucket: `myarea`, `budget`, `data_map.json`, `data-changes.json`
> - Cloud SQL: 5 loader(s), in order — `db:load:pg:cloud` → `db:load:tenders:pg:cloud` → …
>
> Proceed?

Three things to check before proceeding, each of which turns into a wasted or dangerous run:

- **Is the working tree at the commit the manifest names?** `git log --oneline -1` against
  `manifest.commit`. A newer HEAD is fine (another session committed); an OLDER one means you are
  about to publish files that are not the ones the ingest verified.
- **Is anything in `--paths` a tree the guard refuses?** `isExcluded` in
  `scripts/bucket_sync_paths.ts` refuses every PG-served and every retired tree — 20+ branches
  today (`funds/`, `opencalls/`, `prices/`, `council/`, `budget/municipal_fiscal/`, most of
  `parliament/`, `myarea/{alerts,place_tenders}/`, most of `procurement/`, `_cache/`) and the
  list grows every time a family moves to Postgres. **Do not restate it here or anywhere —
  read it from the dry run**, which prints the guard's own per-path reason. A refusal is a
  manifest bug, not a publish failure: correct the manifest and note it.
- **Is the Cloud SQL proxy up?** Only when `cloudCommands` is non-empty:
  `nc -z 127.0.0.1 5434 && echo proxy-up`. It is a real and recurring failure mode — a dead proxy
  surfaces mid-load as `Connection terminated unexpectedly`, which reads like a database problem.
  Start it with `npm run db:proxy:cloud`; `.pgpass` in the repo root holds the credentials.

### Step 1 — bucket: dry run first, then push, one timed step per subtree

```bash
npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
  --step "bucket:sync:paths:dry" --phase verify \
  -- npm run bucket:sync:paths:dry -- myarea budget data_map.json data-changes.json
```

**Read the dry run before pushing.** It lists what would be copied; a count wildly larger than the
ingest's `git diff --stat` means the manifest named a subtree the run did not regenerate.

Then push **one subtree per timed step**, so the trace attributes the time:

```bash
S=20260829T051233Z-a1b2        # ← the id step 0 printed, pasted literally
for p in myarea budget data_map.json data-changes.json; do
  npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
    --step "bucket:sync:paths $p" --phase publish -- npm run bucket:sync:paths -- "$p"
done
```

(A variable set at the top of a block IS visible to the rest of THAT block — it just does not
survive into the next tool call, which is why it is re-pasted rather than carried.)

What matters about the sync, all of it load-bearing:

- **Prefer the scoped sync — always.** The whole-tree `npm run bucket:sync` must enumerate BOTH
  full listings before diffing (~1.03M local files, ~761k bucket objects) and its `-x` exclusions
  filter only AFTER enumeration, so the PG-served `procurement/`, `funds/` and `prices/` are
  walked anyway. That fixed overhead is **~30 min regardless of churn**; scoped to a typical day's
  subtrees it is ~1 min (measured 2026-07-10). Same flags, same result. Reach for the whole tree
  only after a run that rewrote unknown parts of it (e.g. `npm run prod`) — and record it as its
  own step, because it will dominate the trace.
- **Never sync `prices`.** Since migration 048 the price layer is Postgres-only: every dashboard
  payload lives in `price_payloads`, served by `/api/db/price-payload`. The two files still under
  `data/prices/` (`product_slugs.json`, `product_overrides.json`) are read from the local repo
  path at build time and never fetched over HTTP. `bucket:sync:paths` deliberately still ACCEPTS
  `prices` so the one-time `--delete` reap of the orphaned pre-048 tree stays possible — do not
  pass it in a routine publish.
- ⚠️ **Deletions do not happen on their own.** Neither sync passes `-d`, so a file removed from
  `data/` lingers on the bucket and is served forever (three `prices/settlement/*.json` dropped
  2026-07-10 and stayed live). When the ingest REMOVED files, dry-run the delete and read the
  "Would remove" lines before executing:

  ```bash
  npm run bucket:sync:paths:dry -- --delete <subtree>
  npm run bucket:sync:paths     -- --delete <subtree>
  ```

  Never pass `--delete` for a subtree this ingest did not fully regenerate, and never wire `-d`
  into the whole-tree `bucket:sync` — it would delete bucket-served artifacts that are merely
  absent from this machine.
- `-j json,svg,xml,txt,html,css,md` controls which extensions get gzip **transport** encoding, not
  which files upload. Cache-Control is `public,max-age=300,must-revalidate`.

### Step 2 — Cloud SQL: in manifest order, one timed step each

```bash
npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
  --step "db:load:pg:cloud" --phase publish -- npm run db:load:pg:cloud
```

⚠️⚠️ **RUN THEM IN THE ORDER THE MANIFEST LISTS, AND STOP ON THE FIRST FAILURE.** The order is
not cosmetic — a loader that reads another's output must follow it, and running them out of order
publishes a corpus derived from the previous vintage with every row count reconciling. Named
cases, all documented in AGENTS.md: roll-call facts before derived; `db:load:tr-company-place`
after `db:resolve:persons`; the whole person-layer block (`place-dim`, `judicial-bodies`,
`tr-name-fold-people`, declarations phase 1 → resolve → `--resolve` → the downstream loaders).
Half a chain is worse than none of it, because the half that ran looks like success.

Four things to expect:

- **These are slow and the trace is the point.** A contracts publish is minutes; the person-layer
  resolve is tens of minutes. Do not poll — run each in the foreground under `perf:step run` and
  let it finish. The accumulated per-loader medians are what a later optimisation pass reads.
- ⚠️ **`Connection terminated unexpectedly` is the PROXY, not the database.** Check
  `nc -z 127.0.0.1 5434` before suspecting `temp_file_limit` or corruption. Nothing is corrupted
  when it dies mid-load — the load had not committed. Restart with `npm run db:proxy:cloud` and
  re-run that loader; they are idempotent.
- ⚠️ **Some loaders block readers while they run.** A plain `REFRESH MATERIALIZED VIEW` takes an
  AccessExclusiveLock, and a TR publish TRUNCATEs. Off-peak is better; if the operator asked for
  it now, say which pages are affected rather than silently proceeding.
- **A loader that fails does NOT mean re-run the whole set.** They are individually idempotent
  and the sliced ones (`db:load:tender-dossier:pg:cloud`) repair by re-running. Fix the cause,
  re-run that one, continue down the list.

### Step 3 — verify the publish actually landed

```bash
npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
  --step "db:check-generated" --phase verify --ok-exit 1 -- npm run db:check-generated
npm run -s perf:step -- run --run upload-watch-changes --session "$S" \
  --step "db:check-cloud" --phase verify --ok-exit 1 -- npm run db:check-cloud
```

`--ok-exit 1` because both exit 1 when they FIND something — that is the finding, not a crash, and
recording it as a trace failure every run would make the failure count meaningless.

⚠️ **`db:check-generated` reports a FALSE `STALE` immediately after a successful sync.** It
compares over HTTP and does not cache-bust. Measured 2026-08-27: right after `bucket:sync:paths`
reported all 9 paths synced, it still called two artifacts stale, quoting a `served` date from the
previous day — while `gsutil ls -L` showed both objects minutes old with an md5 identical to
local. **Before re-syncing on its say-so, check the OBJECT rather than the response:**

```bash
gsutil ls -L gs://data-electionsbg-com/<path> | grep -E "Update time|Hash"
openssl dgst -md5 -binary data/<path> | base64
```

⚠️ **`db:check-generated` is blind to half the class it appears to cover.** It compares LOCAL
BYTES against the BUCKET — "was the artifact published?", never "is the artifact CURRENT?". When a
generator was never re-run, disk and bucket are both stale, they AGREE, and it prints **OK**. That
half is caught by the data tests (`procurement_hub_stats.data.test.ts` and friends, disk vs
corpus), not here. Do not report an OK from this step as "the artifacts are current".

`db:check-cloud` is the other half: it diffs every public function body, view/matview definition
and relation between local Postgres and the proxy. Objects it names are a SCHEMA gap, not a data
one — no `db:load:*` ships a function body. ⚠️ **Do not paste its emitted `apply_functions.ts`
line blind**: several of those files open with `DROP MATERIALIZED VIEW` and rebuild in one
transaction, which blocks that matview's readers, and where a LOADER is the documented path
(156 → `db:load:budget-hub:pg:cloud`) use the loader, which also REFRESHes. Surface what it found
and let the operator decide; applying schema is not this skill's job.

### Step 4 — close out: clear the manifest, commit the trace

Only after every step in the manifest has succeeded (or the operator has explicitly accepted a
partial publish):

```bash
npx tsx scripts/upload_manifest.ts done --session "$S"
npm run -s perf:report -- --run upload-watch-changes --last 3
```

`done` ARCHIVES rather than deletes: the manifest is appended to `state/upload/history.jsonl` with
this publish's session id, so the trace can be joined back to what it published. Without it the
perf file would record how long a publish took and nothing would record WHAT it published.

⚠️ **A PARTIAL publish must NOT clear the manifest.** If a cloud loader failed and the rest were
skipped, leave `pending.json` on disk — it is the debt, and the next `/process-watch-report` run
reads it and reports "yesterday's ingest is still unpublished". Clearing it after a half-publish
is how a subtree stays stale for weeks. Instead, note in the summary exactly which entries
succeeded, and say the manifest was deliberately left pending.

Then commit — by explicit pathspec, same rules as the ingest half:

```bash
git status --porcelain -- state/perf state/upload
git commit -m "publish: <what went live> (<sha of the ingest commit>)" \
  -- state/perf/upload-watch-changes.jsonl state/upload/history.jsonl state/upload/pending.json
```

⚠️⚠️ **NEVER `git add -A`, and never a bare `git commit`.** A bare `git commit` ships the WHOLE
INDEX, and this repo's index is almost never clean — a concurrent process runs `git add -A`
mid-session and other sessions leave work staged. Commit by pathspec, and commit **only**
`state/perf/` and `state/upload/`: this skill writes nothing else. If `data/` moved during the
publish, something other than this skill wrote it — say so, do not commit it. No
`Co-Authored-By` trailer.

(`state/upload/pending.json` appears in the pathspec so its DELETION is committed. Drop it from
the list on a partial publish, where the file is deliberately still there.)

### Step 5 — final summary (REQUIRED)

```markdown
# Publish — YYYY-MM-DD

Published the ingest committed as `<sha>` (`<skills>`).

## Bucket

| subtree | result | duration |
| --- | --- | --- |
| myarea | 214 objects | 48s |

## Cloud SQL

| loader | result | duration |
| --- | --- | --- |
| db:load:pg:cloud | 410,144 contracts | 5m 06s |

## Verification

- `db:check-generated`: <verbatim result, plus the md5 check if it reported STALE>
- `db:check-cloud`: <objects behind, or "in step">

## Timings

Total work: <sum> across <N> steps. Slowest: <step> (<duration>, median <median>).

## Next steps

- Whether to `git push` or hold
- Anything left pending, and why
```

Rules for it, each pinning a way a publish gets over-reported:

- **Quote the loaders' own row counts.** "loaded 407464 shard rows → 410144 contracts" is the
  evidence; "synced" is narration. If a loader printed a count, it goes in the table.
- **Say what is NOT live.** A manifest entry that was skipped, refused or deferred belongs in
  Next steps in plain words. "Published" with an asterisk is the failure mode this whole handoff
  exists to prevent.
- **Never report an edge-cached artifact as current on the strength of an HTTP check** — see the
  false-STALE note in step 3, which cuts both ways.
- **Compare each step against its own median** from `perf:report`, and name anything materially
  off. A cloud loader that took 3× its usual time published something unusual, or the proxy is
  degraded; either is worth a sentence.

## What this skill does NOT do

- **Does not ingest.** It publishes what `/process-watch-report` already produced and committed.
  If the manifest is empty there is nothing to do — running an ingest is that skill's job.
- **Does not deploy the app.** `npm run deploy` (Firebase hosting) and `npm run deploy:db` (the
  `db` Cloud Function) ship CODE. A pure-data publish needs neither. When a route or bundle change
  is also pending, say so and stop — the hosting/function deploy ORDER matters (AGENTS.md's
  three-step purge) and is not something to fold into a data sync.
- **Does not apply migrations.** `db:check-cloud` may report schema drift; surface it, do not
  paste its command. Several of those files DROP and rebuild a matview, blocking readers.
- **Does not push.** The operator decides.
- **Does not clear a manifest it did not fully publish.** The debt is the point.
