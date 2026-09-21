# Standalone news machine setup

The `news/` directory is the deployment unit. Copy it as-is; the target does
not need the rest of the electionsbg repository.

## 1. Copy the directory

From the repository machine:

```bash
rsync -a --exclude node_modules --exclude var news/ macmini:/opt/naiasno/news/
```

If this is the first deployment, include the existing `news/data/` corpus so
the new machine continues the current history. Later code-only updates should
not use `--delete`: the target's corpus and analysis state are authoritative.

## 2. Install machine prerequisites

The target needs:

- Python 3.10 or newer;
- Node.js 20 or newer and npm;
- Google Cloud CLI (`gsutil`);
- an authenticated service-account JSON key with access only to the configured
  news buckets.

On an Apple Silicon Mac with Homebrew, one suitable starting point is:

```bash
brew install python@3.12 node google-cloud-sdk
cd /opt/naiasno/news
./setup.sh
```

`setup.sh` copies the four example environment files when their live versions
do not exist, installs the pinned Playwright package and Chromium, creates the
runtime directories, and verifies the copied folder.

## 3. Configure API access

Edit `/opt/naiasno/news/.env.api`:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
NEWS_LLM_URL=https://openrouter.ai/api/v1/chat/completions
NEWS_LLM_ALLOW_REMOTE=1
```

This file is mode `600` and gitignored. Never commit it.

## 4. Select or swap the model

Edit `/opt/naiasno/news/.env.model`:

```dotenv
NEWS_LLM_MODEL=z-ai/glm-5.3-flash
NEWS_LLM_MAX_TOKENS=4096
NEWS_LLM_TEMPERATURE=0.2
NEWS_LLM_REASONING_EFFORT=low
NEWS_LLM_THINKING=0
NEWS_LLM_WORKERS=4
NEWS_LLM_SCHEMA_RETRIES=1
NEWS_LLM_TRIAGE_MODEL=
NEWS_LLM_TRIAGE_TIMEOUT=12
```

To switch models later, change this file only. The next hourly run uses the
new model and records it in each analysis's provenance. Set `NEWS_LLM_THINKING`
to `1` only for a model that requires its reasoning channel. Reduce workers if
the provider rate-limits concurrent requests. `NEWS_LLM_MAX_TOKENS` controls
the paid analysis response budget. The 4,096 default is measured: the
2,048-token live pass ended 126 of 1,547 generations at the ceiling, while
the 4,096 retry ended 10 of 178 there at essentially the same mean request
cost. `NEWS_LLM_TEMPERATURE` controls sampling and accepts values from 0
through 2.

## 5. Configure GCS credentials and destinations

Place the service-account key at:

```text
/opt/naiasno/news/credentials/gcs-service-account.json
```

Then protect it:

```bash
chmod 600 /opt/naiasno/news/credentials/gcs-service-account.json
```

Edit `/opt/naiasno/news/.env.upload`. The default credential line resolves
relative to the copied directory. Configure a dedicated private archive:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS="${NEWS_DEPLOY_ROOT}/credentials/gcs-service-account.json"
NEWS_GCS_ACTIVATE_SERVICE_ACCOUNT=1
NEWS_ARCHIVE_GCS_URI=gs://your-private-news-archive/news/archive
NEWS_REQUIRE_ARCHIVE_VERSIONING=1
NEWS_ENABLE_PUBLIC_UPLOAD=0
NEWS_PUBLIC_GCS_URI=
NEWS_MENTIONS_GCS_URI=
NEWS_PRUNE_VERSIONS=0
NEWS_PRUNE_KEEP=8
```

The runner activates this key with `gcloud auth activate-service-account`
before each production transaction, so the scheduler does not depend on whichever
interactive account happened to be active on the machine. Set the activation
flag to `0` only when the host already supplies an intentional workload
identity or other preconfigured `gcloud` credential.

Enable object versioning once, before the first production run:

```bash
gsutil versioning set on gs://your-private-news-archive
gsutil versioning get gs://your-private-news-archive
```

The archive service account needs bucket-metadata read and object
create/update/list permissions. It does not need object-delete. The archive
sync is additive and never removes remote history.

Keep `NEWS_ENABLE_PUBLIC_UPLOAD=0` until the news-app cutover. At cutover, set
it to `1` and fill two disjoint non-root prefixes. Those public prefixes need
object-create for the create-only version uploads; the mentions prefix also
needs object-delete for its scoped `rsync -d`. App JSON is snapshotted, hashed,
and uploaded under an immutable `versions/<run-id>` path; `manifest.json` at
the configured app prefix is generation-guarded and replaced last only after
every transfer succeeds. Reuse of a partially uploaded run ID is refused—run
again with a new ID.
Point `VITE_NEWS_DATA_BASE_URL` at that stable app prefix, not at a version.

**Retention and continuity (plan T1.5).** Every hourly release is a ~37 MB
immutable `versions/<run-id>` tree, so with pruning off the bucket grows ~27 GB a
month. Set `NEWS_PRUNE_VERSIONS=1` to keep the newest `NEWS_PRUNE_KEEP` (8) trees
after each successful public publish — `news/scripts/prune_published_versions.py`
reads the live manifest fresh and never deletes the live tree or anything newer;
K=8 spans the 75 s a reader can still hold an old manifest plus an hour of cache
grace, with six hourly releases of rollback room. A pruned tree breaks no
bookmark: story URLs resolve through the CURRENT manifest. The uploader refuses a
public release that stops serving a story id the live release serves unless
`news/config/retired_stories.json` names it with a reason (`stories/retired.json`
is what the story page then shows); `NEWS_ALLOW_STORY_DROPS=1` is the hatch for a
deliberate corpus rebuild, and the drop is recorded in the upload result either
way. Since the same change the client verifies every listed payload's `bytes` and
`sha256` against the manifest, and the overlay against its pointer — a mismatch is
refused (base) or dropped (overlay), never rendered.

For an urgent removal between hourly releases use the hot path: the overlay's
`removed_story_ids` (see `build_overlay.py`) retires the detail within one
five-minute cadence, and the manifest is `no-cache`, so no immutable cache has
to expire first. **Add the id to `news/config/retired_stories.json` in the same
change** — `build_overlay.py` refuses to write an overlay that retires a story
the registry does not name, and the next hourly publish is refused
(`story_continuity`) for the same id; the entry is the precondition of the
removal, not an afterthought. One known gap: a story that only ever existed
through an overlay (introduced hot, never in a base inventory) is invisible to
the cold gate, which compares base inventories.

Before deploying that build, apply the authoritative public-bucket CORS policy
and verify both metadata classes:

```bash
npm run bucket:cors
curl -fsSI -H 'Origin: https://news.electionsbg.com' \
  https://storage.googleapis.com/data-electionsbg-com/news/app-data/manifest.json
gsutil stat gs://data-electionsbg-com/news/app-data/manifest.json
gsutil stat gs://data-electionsbg-com/news/app-data/versions/RUN_ID/home.json
```

The response must allow `https://news.electionsbg.com`; the pointer must be
`no-cache`, and the versioned object must be one-year `immutable` JSON.

## 6. Tune hourly capacity

Edit `/opt/naiasno/news/.env.pipeline` if needed. The defaults fetch the latest
20 items per source, analyze up to 100 pending articles, use four concurrent
model requests, and allow a stage up to two hours. Each run also adds up to 24
licensed Commons candidate sets, making at most 12 uncached searches. Search
results (including empty results) are cached and shared by equal subjects, so
running hourly does not repeat old searches. Already-analyzed articles are
skipped, so running hourly does not re-bill them.

`NEWS_IMAGE_CANDIDATE_REQUESTS` is a hard ceiling on actual HTTP attempts,
including retry attempts. A stateful standalone export (`--include-state`)
copies the cache; the rights queue itself is deterministic and is regenerated.

## 7. Validate before enabling the scheduler

```bash
cd /opt/naiasno/news
python3 verify_install.py
./run_hourly.sh --dry-run
./install_launchd.sh --print     # macOS; ./install_cron.sh --print on Linux
```

The dry run performs all fourteen pipeline stages (ending in `home_health`)
without fetching, calling the
model, or uploading. It must show `pipeline_exit: 0`. With public upload left
disabled, the upload plan contains only the private archive scope.

Run one production transaction manually and inspect its report:

```bash
./run_hourly.sh
ls -lt var/reports | head
```

## 8. Install the hourly job

**On a Mac, use the LaunchAgent, not cron.** cron does not wake a sleeping Mac
and silently drops every run whose minute passed while it slept; launchd runs a
missed `StartCalendarInterval` on wake — once, however many hours were missed,
and not at all for time the Mac was powered off:

```bash
./install_launchd.sh             # ~/Library/LaunchAgents/com.naiasno.news-hourly.plist
launchctl print gui/$(id -u)/com.naiasno.news-hourly | head
./install_launchd.sh --uninstall # remove it
```

The two installers refuse each other: one scheduler only, because two are two
writers of one release pointer.

`install_launchd.sh` also installs a second agent, `com.naiasno.news-staleness`,
which runs `scripts/check_staleness.py` every 30 minutes (and at load). It is a
separate agent on purpose — a scheduler that has stopped cannot report its own
absence — and it raises a macOS notification (plus a JSON POST to
`NEWS_ALERT_WEBHOOK_URL` when set in `.env.upload`, or `config.env` in the
bundle) when the set of alarms that have persisted for `NEWS_STALENESS_GRACE_S`
(default 45 min — both agents fire on wake, and the catch-up run needs time to
close the gap a long sleep opened) changes, including recovery:

- `manifest_stale`: the public manifest's `generated_at` is older than
  `NEWS_STALE_AFTER_S` (default 7200 s, twice the hourly cadence);
- `no_recent_run`: no combined run report in that window — the scheduler is
  not firing;
- `run_failed`: the newest run had a non-zero `pipeline_exit` / `upload_exit` /
  `eval_task_sync_exit`;
- `manifest_unreadable`.

While an alarm persists it re-notifies every `NEWS_STALENESS_RENOTIFY_S`
(default 6 h); a NEW failing run is announced at once rather than folded into
the previous one. `NEWS_STALENESS_INTERVAL_S` (default 1800) sets how often the
agent runs; it is read when `install_launchd.sh` runs, so re-run the installer
after changing it. Its log is `var/staleness.log`, its state
`var/staleness_state.json`. Run it by hand with
`python3 scripts/check_staleness.py` (exit 1 on any alarm). It cannot alert
while the Mac is powered off — only an external watchdog can.

**On Linux there is no staleness agent** — `install_cron.sh` schedules only the
hourly job. Set `NEWS_ALERT_WEBHOOK_URL` (a desktop notification reaches nobody
on a server) and add the check to the crontab by hand:

```cron
*/30 * * * * python3 '/opt/naiasno/news/scripts/check_staleness.py' --root '/opt/naiasno/news' --notify >> '/opt/naiasno/news/var/staleness.log' 2>&1
```

On Linux, install the cron job instead:

```bash
./install_cron.sh
crontab -l
```

The installed entry is:

```cron
0 * * * * /bin/bash '/opt/naiasno/news/run_hourly.sh' >> '/opt/naiasno/news/var/cron.log' 2>&1
```

Installation is idempotent. A whole-transaction PID lock covers acquisition,
analysis, derived-data generation and upload. If one run lasts longer than an
hour, the next invocation exits successfully as `already_running`.

To remove only this job:

```bash
./install_cron.sh --uninstall
```

## 9. Operations and updates

- Combined reports: `news/var/reports/*.json`
- Stage reports: `news/data/_nightly/*.json`
- Scheduler log (launchd or cron): `news/var/cron.log`
- Full local corpus and analysis: `news/data/`
- Hidden reciprocal backlink shards: `news/mentions/`
- Public news-app bundles: `news/app-data/`
- Commons review queue/cache: `news/review/image_rights_queue.json` and
  `news/review/commons_candidates.json`

The hourly Commons stage only proposes appropriately licensed replacements;
it never publishes one automatically. After visually checking relevance and
licence metadata, add the exact choice to
`news/config/commons_image_selections.json` and run
`python3 news/scripts/apply_commons_images.py`. The next hourly bundle build
will then admit that article under the fail-closed image-rights policy.

Each `analyze` stage result contains a `billing` object for the complete run,
including generations that failed parsing or validation. Inspect the newest
stage report with:

```bash
jq '.stages[] | select(.stage == "analyze") | .result.billing' \
  "$(ls -t news/data/_nightly/*.json | head -1)"
```

`responses_with_cost` should equal `responses` on OpenRouter. A lower number
means the provider returned one or more decoded responses without billing
metadata, so the printed `cost_usd` is a lower bound.

Never replace the live `news/` directory with a clean copy that omits
`news/data/`, `.env.*`, `credentials/`, `mentions/`, or `var/`. Copy code and
seed-file updates over it without remote deletion, or stop the scheduler
(`./install_launchd.sh --uninstall` on a Mac, `./install_cron.sh --uninstall`
on Linux) and make a backup first. The LaunchAgent plist embeds absolute paths,
so after MOVING the folder re-run `./install_launchd.sh`.
