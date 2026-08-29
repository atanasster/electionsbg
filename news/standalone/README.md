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

`setup.sh` verifies bundle hashes, checks Python 3.10+, Node 20+, npm and
`gsutil`, installs the pinned Playwright runtime, and downloads Chromium. It
does not install system packages or authenticate GCS. Authenticate the machine
with a least-privilege service account before enabling cron.

## Hourly behavior

`install_cron.sh` installs this exact idempotent block:

```cron
0 * * * * /bin/bash '/absolute/path/run_hourly.sh' >> '/absolute/path/var/cron.log' 2>&1
```

The outer PID lock covers acquisition, analysis **and** upload. If a slow
browser sweep is still running at the next hour, that invocation reports
`already_running` and exits successfully instead of corrupting state. The
inner pipeline has its own lock as a second guard.

Each run writes:

- `news/data/_nightly/*.json`: the original per-stage pipeline report;
- `var/reports/*.json`: combined pipeline + upload status;
- `var/cron.log`: cron output.

The configured analysis limit is queue capacity, not spend. Already analyzed
articles are skipped, so running 24 times/day does not re-bill the corpus.

## Storage boundary

Three destinations are deliberately separate:

| Data | Local path | GCS behavior | Intended access |
| --- | --- | --- | --- |
| Full articles, analysis, state | `news/data` | additive archive; **never remote-delete** | private |
| News app JSON | `news/app-data` | opt-in exact sync with remote deletion, 5-minute cache | public after explicit cutover |
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

The current Firebase news deployment still embeds `/news-data` at build time.
Hourly archive upload does **not** redeploy Firebase. A later news-app release
can enable the hot uploads and set
`VITE_NEWS_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com/news/app-data`
and, eventually, move the Firebase project to the main site. Until that
explicit cutover, these GCS objects are a ready serving layer and archive.

## GCS setup

Use one private bucket for archive history and isolated prefixes in the
existing public data bucket for derived files. The private archive needs object
create/update/list plus permission to read the bucket's versioning setting; it
does not need object-delete. Each public exact-sync prefix additionally needs
object-delete. Public-prefix sync uses `-d`, so never configure a bucket root
or overlapping parent/child prefixes; the uploader refuses both.

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
enabled, the full nine-stage report is structurally intact, and both the
`mention_index` and `bundles` stages succeeded. It archives first and does not
advance public data if that archive transfer fails. It can still archive newly
acquired raw data after an analysis/model failure.

## Operations

```bash
./install_cron.sh --print       # inspect, no mutation
./install_cron.sh               # idempotent install/update
./install_cron.sh --uninstall   # remove only this marked block
./run_hourly.sh                 # manual production run
python3 verify_bundle.py        # detect copied/edited runtime files
```

Keep `config.env` mode `600`. Rotate `var/cron.log` with the host's normal log
rotation policy. Alert on a non-zero `pipeline_exit`/`upload_exit`, a growing
`analysis_backlog.pending_total`, repeated source freshness alerts, or hourly
`already_running` skips.
