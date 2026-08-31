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
```

The runner activates this key with `gcloud auth activate-service-account`
before each production transaction, so cron does not depend on whichever
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

## 7. Validate before enabling cron

```bash
cd /opt/naiasno/news
python3 verify_install.py
./run_hourly.sh --dry-run
./install_cron.sh --print
```

The dry run performs all twelve pipeline stages (ending in `home_health`)
without fetching, calling the
model, or uploading. It must show `pipeline_exit: 0`. With public upload left
disabled, the upload plan contains only the private archive scope.

Run one production transaction manually and inspect its report:

```bash
./run_hourly.sh
ls -lt var/reports | head
```

## 8. Install the hourly cron job

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
- Cron log: `news/var/cron.log`
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
seed-file updates over it without remote deletion, or stop cron and make a
backup first.
