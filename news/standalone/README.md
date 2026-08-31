# Наясно news box

This bundle runs the news pipeline without the electionsbg repository. It
acquires direct and browser-only sources, analyzes only pending articles,
rebuilds public JSON and reciprocal entity indexes, archives full history to a
private GCS bucket, and uploads hot derived JSON to isolated public prefixes.

## Build and copy

On the repository machine:

```bash
python3 news/scripts/build_standalone_bundle.py \
  --out /tmp/naiasno-news-box --include-state
rsync -a /tmp/naiasno-news-box/ macmini:/opt/naiasno-news-box/
```

`--include-state` copies the current corpus, analyses, retry state and
quarantine, but excludes browser/HTML caches, evaluations and gold fixtures.
Omit it for a new empty corpus. The output is intentionally refused if the
target directory already exists, so a rebuild cannot erase live state.

On the Mac mini:

```bash
cd /opt/naiasno-news-box
./setup.sh
$EDITOR config.env
./run_hourly.sh --dry-run
./install_cron.sh
```

`setup.sh` verifies bundle hashes, checks Python 3.10+, Node 22+, npm and
`gsutil`, builds the bundled eval operator, installs the pinned Playwright
runtime, and downloads Chromium. It does not install system packages or
authenticate GCS or Firestore.

## Hourly behavior

`install_cron.sh` installs this exact idempotent block:

```cron
0 * * * * /bin/bash '/absolute/path/run_hourly.sh' >> '/absolute/path/var/cron.log' 2>&1
```

The outer PID lock covers acquisition, analysis **and** upload. If a slow
browser sweep is still running at the next hour, that invocation reports
`already_running` and exits successfully instead of corrupting state. The
inner pipeline has its own lock as a second guard.

The eval order is split across the publication commit. Before bundle generation
the runtime exports raw submissions and the accepted snapshot with the dedicated
eval identity, retains a validated last-known-good snapshot on transient export
failure, reports its age plus current/stale/missing article counts, and writes
private correction proposals. It then builds the desired public task queue into
the same immutable app-data version. Only after the GCS `manifest.json`
compare-and-swap succeeds does it activate that exact task manifest in
Firestore. A failed or disabled public upload never activates tasks for routes
readers cannot inspect.

Each run writes:

- `news/data/_nightly/*.json`: the original per-stage pipeline report;
- `var/reports/*.json`: combined pipeline + upload status;
- `var/cron.log`: cron output.

The configured analysis limit is queue capacity, not spend. Already analyzed
articles are skipped, so running 24 times/day does not re-bill the corpus.
The `home_health` stage records the exact default story IDs, ages, comparison
count, image availability and a builder-reported eligibility ladder. It
recomputes and gates the selected payload; the ladder is diagnostic, not an
independently verified count. It blocks public upload when
there is no story from the last 24 hours or when any implicit-default story is
older than seven days.

`NEWS_EVAL_MODE=disabled` is the pre-pilot default. `optional` may report and
skip a missing eval identity only before accepted overrides exist. Use
`required` once the pilot or human overrides are live: an unavailable operator,
invalid/future/expired accepted snapshot, failed task build, or failed
post-manifest task sync makes the hourly run non-zero and prevents the public
pointer from advancing where applicable. The accepted snapshot SLA defaults to
26 hours. Empty desired queues are real releases, not missing work: their live
release proof atomically deactivates the last Firestore tasks.

The eval service-account JSON named by
`NEWS_EVAL_GOOGLE_APPLICATION_CREDENTIALS` must differ from the GCS path in
`GOOGLE_APPLICATION_CREDENTIALS`; the runtime resolves both and refuses reuse.
Grant the eval identity only the Firestore/Admin permissions required by the
operator. Never grant the public uploader Firestore access. Configure
reproducible community selections through `NEWS_EVAL_SELECTIONS_JSON`, a JSON
array of runtime-contained paths.

## Storage boundary

Three destinations are deliberately separate:

| Data | Local path | GCS behavior | Intended access |
| --- | --- | --- | --- |
| Full articles, analysis, state | `news/data` | additive archive; **never remote-delete** | private |
| News app JSON | `news/app-data` | opt-in immutable `versions/<run-id>` upload; stable manifest advances last | public after explicit cutover |
| Party/person/institution backlinks | `data/news/mentions` | opt-in exact sync with remote deletion, 5-minute cache | public only after explicit cutover |

The archive excludes transient browser/HTML caches, nightly reports, evals and
gold fixtures. Local cleanup therefore cannot erase archived article history.
Do not place the archive in the public data bucket: it contains full article
text and provenance that the app intentionally does not republish.

Public upload defaults to **off** (`NEWS_ENABLE_PUBLIC_UPLOAD=0`). This is the
actual exposure boundary: objects in a publicly readable GCS prefix are public
even when Firebase does not link to them. Keep both public URI settings empty
until the deliberate cutover. Enabling publication requires setting the flag
to `1` and configuring two disjoint, non-root prefixes.

The Firebase build keeps `/news-data` as its local/dev fallback. A production
news-app release can enable the hot uploads and set the stable prefix as
`VITE_NEWS_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com/news/app-data`
The browser revalidates `manifest.json` from that prefix every minute; unchanged
bundle responses remain cached for five minutes. The manifest points at one immutable
`versions/<run-id>` tree, so a browser stays on the previous complete release
while an hourly upload is in flight or fails. `/news-data` does not require a
manifest and remains the development/prerender path.

## GCS setup

Use one private bucket for archive history and isolated prefixes in the
existing public data bucket for derived files. Before the cutover, run
`npm run bucket:cors`; `scripts/bucket_cors.json` is the authoritative policy
and includes `https://news.electionsbg.com`. The private archive needs object
create/update/list plus permission to read the bucket's versioning setting; it
does not need object-delete. The public app prefix needs create/update/list;
version objects use create-only generation preconditions, while the stable
`manifest.json` uses compare-and-swap and refuses a newer remote pointer. It is
replaced only after the complete app version and mentions transfers succeed.
The mentions exact-sync prefix additionally needs object-delete.
Never configure a bucket root or overlapping parent/child prefixes; the
uploader refuses both.

Version directories are deliberately not deleted by the hourly transaction.
Their URL is content-bound by the pipeline timestamp plus a SHA-256 inventory,
and a run ID cannot be reused—even after a partial upload. Retry with a new run.
Apply a bucket lifecycle rule only after choosing a rollback window; retaining
at least the previous few releases lets an already-open browser finish safely
and gives operators a pointer-only rollback.

Recommended private-archive policy:

- uniform bucket-level access, public access prevention enabled;
- object versioning enabled (`gsutil versioning set on gs://PRIVATE_BUCKET`);
- Standard storage initially, lifecycle to colder storage only after observed
  rewrite frequency is known;
- no automatic deletion lifecycle if “preserve history” is the requirement.

The uploader checks versioning on every production run by default and refuses
the archive when it is off. This matters for re-analysis: raw article objects
are normally immutable, but an analysis at the same path can be replaced, and
only bucket versioning preserves the prior generation.

The uploader refuses to publish hot JSON unless public upload is explicitly
enabled, the full twelve-stage report is structurally intact, and the
`mention_index`, `bundles`, and exact-payload `home_health` stages succeeded.
It archives first and does not advance `manifest.json` if the archive, version,
or mentions transfer fails. It can still archive newly acquired raw data after
an analysis/model failure.

For cutover verification, send an `Origin: https://news.electionsbg.com` HEAD
request to `manifest.json`, then inspect it and one referenced `home.json` with
`gsutil stat`. The manifest must be `no-cache`; version objects must be
`public,max-age=31536000,immutable` and `application/json`.

## Operations

```bash
./install_cron.sh --print       # inspect, no mutation
./install_cron.sh               # idempotent install/update
./install_cron.sh --uninstall   # remove only this marked block
./run_hourly.sh                 # manual production run
python3 verify_bundle.py        # detect copied/edited runtime files
```

Keep `config.env` mode `600`. Rotate `var/cron.log` with the host's normal log
rotation policy. Alert on a non-zero `pipeline_exit`/`upload_exit`/
`eval_task_sync_exit`, any `evals.export.alerts`, an accepted snapshot near its
SLA, a growing
`analysis_backlog.pending_total`, repeated source freshness alerts, or hourly
`already_running` skips. The `analyze` stage's `result.billing` object is the
run-level OpenRouter bill; unlike per-article provenance, it also counts
token-ceiling, parse, validation, and probe responses that produced no saved
analysis.

Every hourly run also refreshes the fail-closed image-rights queue and sources
Commons replacements. `NEWS_IMAGE_CANDIDATE_REQUESTS` caps actual HTTP
attempts, including retries;
responses and empty results are persisted in
`news/review/commons_candidates.json` and reused across articles with the same
subject. Candidates remain unpublished until a reviewer records a selection
and runs `news/scripts/apply_commons_images.py`.
