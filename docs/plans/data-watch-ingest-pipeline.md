# PRD: Data Watch / Ingest Pipeline

A two-tier system for keeping electionsbg.com's upstream data fresh without
manual checking. Tier 1 detects changes; Tier 2 ingests them. The headline
new dataset this unlocks is **parliament.bg roll-call votes**.

## Context

- **Current state.** The site is a JAMstack SPA on Firebase Hosting. As of
  the GCS migration (commit `5743f3bc3`), per-election data, parliament/,
  polls/, census/, declarations live under `/data/` and ship to
  `gs://data-electionsbg-com/` via `gsutil cp -Z` (gzipped). Updating data
  no longer requires a Firebase deploy — scrapers write JSON locally then
  rsync to the bucket; the SPA fetches via the `dataUrl` helper which
  prefixes `VITE_DATA_BASE_URL` (`https://storage.googleapis.com/data-electionsbg-com`).
- **Existing skills** that already handle ingest for specific sources:
  - `/update-connections` — refreshes MP business connections from
    register.cacbg.bg + data.egov.bg Commerce Registry
  - `/update-polls` — scrapes BG Wikipedia polls + analyses accuracy
  - `parliament-scrape` — re-runs `scripts/parliament/scrape_mps.ts`
- **The problem we're solving.** The user manually checks several upstream
  sources for updates ("did parliament.bg post new votes?", "are there new
  Сметна палата filings?"). This is daily cognitive overhead. New roll-call
  votes are added almost daily during session weeks; declarations and
  financing change weekly-to-monthly. Manual polling doesn't scale.

## Goals

1. **Stop the manual "is anything new?" check.** Replace with a daily push
   notification that lists what's new across all upstream sources.
2. **Ship parliament.bg roll-call votes** as a new dataset, with an ingest
   script reliable enough to run automatically once it's been stable for
   a month.
3. **Make new ingest sources cheap to add.** A new upstream becomes one
   `scripts/watch/<source>.ts` module + one `/update-<source>` skill.
4. **Never silently break the live site.** Failed parses, schema
   regressions, or oversized diffs should halt before any commit/deploy.

## Non-goals (this PRD)

- The roll-call **frontend** features (loyalty index, MP-similarity matrix,
  bill tracker UI). Spec'd separately once data lands and stabilises.
- Replacing existing skills (`/update-connections` etc.) — they keep
  working as-is and become Tier 2 ingest siblings.
- Auto-ingest for slow sources (declarations, financing). Watcher pings
  the user; user decides when to run the ingest skill.

## Architecture: two tiers

### Tier 1 — Watcher (cheap, frequent, dumb)

One scheduled job. Per source:
1. Fetch a small "index" page (HTML or JSON).
2. Compute a fingerprint — SHA-256 of relevant content, record count, or
   max `Last-Modified` timestamp.
3. Compare to last-seen fingerprint stored in `state/watch/<source>.json`
   (gitignored; could also live in a private GitHub Gist for portability).
4. If changed, append a one-line entry to a daily report:
   `parliament.bg/votes: 3 new sessions (since 2026-05-09)`.
5. Post the report to a single notification channel.

**Failure modes are benign by design.** A layout change at the upstream
manifests as "fingerprint changed" — false positive, the user notices
when no actual ingest follows. The watcher never parses, never commits,
never deploys, so it can't break the site.

### Tier 2 — Ingest (expensive, brittle, triggered)

One per source. Each is implemented as a Claude Code skill (the user
already has the pattern — see `.claude/skills/`). When triggered:
1. Scrape the upstream.
2. Parse into structured form.
3. Validate against schema + canary.
4. Write JSON locally to `data/<domain>/...`.
5. Run derived metrics (where applicable).
6. `gsutil cp -Z` to bucket.
7. Commit the source-of-truth files (`index.json`, summaries) to git.
8. Report anomalies for human review.

Triggered manually from Claude Code (user clicks "run /update-rollcall")
OR auto-fired by the watcher's daily routine for sources where the
ingest has been stable long enough to trust.

## Data sources to watch

| Source | URL | Fingerprint | Cadence |
|---|---|---|---|
| **parliament.bg roll-call votes** *(new)* | `/api/v1/voting-list/...` or HTML index | session count | hourly during session weeks; daily otherwise |
| parliament.bg MPs | `/api/v1/coll-list-ns/bg` | hash of MP roster | daily |
| register.cacbg.bg (Сметна палата declarations) | declarations index per current MP | per-MP filing count | weekly |
| Сметна палата party financing | filings index page | hash | weekly during cycles, monthly otherwise |
| data.egov.bg Commerce Registry | bulk export "last updated" header | timestamp | weekly |
| CIK (Централна избирателна комисия) | events / упсу page | hash | hourly during election cycles, weekly between |
| BG Wikipedia polls page | `/wiki/Парламентарни_избори_в_България_(YYYY)` | row count | daily during cycles, weekly otherwise |
| Eurostat (macro indicators) | dataset metadata "last updated" | timestamp | monthly |

The watcher itself is ~50 lines of Node per source plus a shared runner.
No LLM needed at the Tier 1 level.

## Tier 1 implementation

### Module shape

```
scripts/watch/
  index.ts                  # runner — iterates all sources, writes report
  parliament_votes.ts       # one per source
  parliament_mps.ts
  cacbg_declarations.ts
  smetna_palata.ts
  egov_commerce.ts
  cik.ts
  wiki_polls.ts
  eurostat.ts
state/watch/                # gitignored
  parliament_votes.json     # { fingerprint, lastChecked, lastChanged }
  ...
```

Each source module exports:

```ts
export interface WatchSource {
  id: string;                 // 'parliament_votes'
  label: string;              // human-readable, used in the report
  url: string;
  cadence: 'hourly' | 'daily' | 'weekly' | 'monthly';
  fingerprint(): Promise<{ value: string; detail?: string }>;
  // Optional: format the "what changed" line for the report when
  // fingerprint differs (e.g. "3 new sessions since 2026-05-09").
  describe?(prev: string, curr: string): string;
}
```

### Runner (`scripts/watch/index.ts`)

```ts
// npm run watch  →  scripts/watch/index.ts
// Reads each source module, compares fingerprints, writes a one-page
// report to stdout (also returned for the notification step).
```

Should be runnable locally for debugging (`npm run watch`) and from CI.

### State storage

Two options — pick one:

- **Local JSON files (`state/watch/*.json`), gitignored.** Simplest.
  Tied to whoever runs the watcher. Fine if always one runner.
- **Private GitHub Gist** (one gist per source or one big JSON).
  Portable across runners, survives runner reinstalls. ~20 lines of
  helper code.

Recommend local first; migrate to gist only if multiple runners need it.

### Notification channel

Pick one. In rough order of recommendation:

1. **GitHub issue** in the repo, one per watch run. Pros: zero new infra,
   shows up in your normal repo inbox, easy to thread comments under it.
   Cons: slight noise in issues list (mitigate with a `watch-report` label).
2. **Email** via SendGrid free tier or a GH Action that sends. Pros:
   already in the user's inbox. Cons: easy to ignore.
3. **Slack DM** to a personal channel. Pros: low friction. Cons: requires
   a Slack workspace + webhook URL.

If the user has a Slack/Discord they already check, that wins. Otherwise
GitHub issue is the path of least resistance.

### Where it runs

**GitHub Actions, scheduled.** The repo is already on GitHub
(`atanasster/electionsbg`). Free for the volume we'd use. Workflow:

```yaml
name: watch-sources
on:
  schedule:
    - cron: '0 6 * * *'   # daily at 06:00 UTC = 09:00 Sofia
  workflow_dispatch:        # also runnable on demand
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run watch
      - name: Post report
        ...
```

For sources flagged as `cadence: 'hourly'` during an active session week,
add a second cron pinned to a tighter schedule.

## Tier 2 implementation

### Existing skills as templates

Look at:
- `.claude/skills/update-connections/SKILL.md`
- `.claude/skills/update-polls/SKILL.md`

Both have the same structure: read upstream, parse, write to `/data/<domain>/`,
upload to bucket via `gsutil cp -Z`, commit. New skills follow this pattern.

### New skills to create

- `/update-rollcall` — primary deliverable. Spec below.
- `/update-financing` — Сметна палата party financing filings.
- `/update-declarations` — register.cacbg.bg MP asset declarations
  (currently runs as part of `/update-connections`; could split for
  cadence reasons).

Each skill should be triggerable by:
- The user, manually, when watcher pings.
- The watcher's CI job, automatically, after a stability period
  (initially manual; flip to auto per-source after ~30 days of clean runs).

### Roll-call ingest specifics

Single new dataset. Storage:

```
data/parliament/votes/
  index.json                   # { sessions: [{date, billId, title}], lastUpdated }
  sessions/<YYYY-MM-DD>.json   # one per session day (small, 240 MPs × N votes)
  bills/<bill-id>.json         # bill metadata + sponsors (optional second index)
  derived/
    loyalty.json               # per-MP party-line adherence (recomputed weekly)
    similarity.json            # MP-vs-MP cosine similarity matrix (weekly)
    cohesion.json              # per-party cohesion stats (weekly)
```

Per-session files are small (~10-50 KB each). Daily ingest only writes
1-2 new files plus the touched index. Diffs are small and reviewable.

**Validation rules.** Each session must:
- Have N votes within ±1 of the seated MP count for that NS (240 currently).
- Be tagged with a date that parses.
- Reference an MP id that exists in `/data/parliament/index.json`.
  Unknown MP id → fail loud.

**Canary record.** Pin one historical session as a parser regression test.
If the canary stops parsing identically, the parser drifted — block
ingest, surface for human review.

**Derived metrics.** Compute on a weekly schedule (`rebuild-derived`),
not on every ingest. They're O(N²) over MPs and don't need same-day
freshness.

## Schedule design

Three scheduled jobs (whether GH Actions or Claude scheduled agents):

| Job | Cadence | What |
|---|---|---|
| `watch-sources` | daily 06:00 UTC | Tier 1 watcher across all sources. Posts report. |
| `ingest-rollcall` | triggered, OR daily 06:30 UTC after watcher | Re-walks parliament.bg vote sessions, ingests new ones. Initially manual; auto after ~30 days of clean runs. |
| `rebuild-derived` | weekly Sunday 23:00 UTC | Recomputes loyalty/similarity/cohesion. Heavy but stable. |

Watcher silence is worse than noise — the daily report should fire even
when nothing changed (one-line "all clean" entry).

## Guardrails (the part that keeps the site safe)

- **Schema validation.** Each parser declares an output schema (zod or
  hand-rolled). Validation failure halts ingest before write.
- **Canary record per parser.** Pin a known-good historical input. If
  the parser produces different bytes, the parser drifted.
- **Diff size cap.** If an ingest touches >5% of existing files in the
  domain, block the commit and require human review. Catches catastrophic
  parser breakage (e.g. all sessions returned empty).
- **Idempotent ingests.** Same input → same output bytes. Lets you
  re-run safely after a parser fix.
- **Two-phase upload.** Always upload to a `pending/` prefix in the
  bucket first, smoke-test fetch, then atomic rename to live path.
  (Optional polish; not blocking for v1.)
- **Never auto-deploy on warnings.** Auto-commit + auto-upload only on
  clean runs. Anything weird → commit to a branch, open a draft PR.

## Implementation phases

Each phase ships independently and provides standalone value.

**Phase 0 — Pre-flight (~1 day)**
- Decide notification channel (GitHub issue / email / Slack).
- Decide state storage (local files vs gist).
- Pin GitHub Actions runner versions.

**Phase 1 — Watcher MVP (~3 days)**
- `scripts/watch/` runner + 4 source modules: parliament.bg MPs, BG
  Wikipedia polls, Сметна палата declarations index, CIK events.
- GitHub Actions workflow on daily cron.
- Notification posted to chosen channel.
- **Ship value:** the user stops manually checking these sources.

**Phase 2 — Roll-call ingest skill (~5 days)**
- `scripts/parliament/scrape_rollcall.ts` — fetches session list, parses
  votes per session, validates against MP index.
- `/update-rollcall` Claude Code skill that wraps the script.
- Storage layout per the spec above.
- Ingest manually for a month; verify stability.
- **Ship value:** roll-call data lands in `/data/parliament/votes/`.
  Frontend can start showing it.

**Phase 3 — Auto-trigger from watcher (~2 days)**
- After roll-call ingest is stable, add it to the daily watcher's
  auto-fire list.
- Same pattern available for other sources as they harden.

**Phase 4 — Derived metrics (~3 days)**
- `rebuild-derived` weekly job.
- Loyalty index, similarity matrix, faction cohesion writers.
- Outputs feed `/data/parliament/votes/derived/`.

**Phase 5 — Add remaining sources to watcher (~1 day each)**
- Eurostat, Commerce Registry, party financing, etc. Cheap once the
  framework exists.

## Success criteria

- The user receives exactly one daily notification listing source changes.
  Silence (zero notifications) is treated as a failure (CI alert).
- New parliament.bg roll-call sessions land in the bucket within 24h
  of being published.
- Adding a new upstream source to the watcher takes < 2 hours.
- Manual `/update-*` skill invocations drop to one-per-week or less
  (currently the user re-checks sources daily).
- Zero site-breaking deploys caused by ingest failures
  (validation + canary + diff cap should make this structural).

## Open questions for the implementation chat

1. **Notification channel** — GitHub issue, email, or Slack/Discord?
2. **State storage** — local `state/watch/` (gitignored) or private gist?
3. **Where does the watcher run?** GitHub Actions (recommended) or local
   cron on the user's Mac?
4. **Sofia time vs UTC** — schedule in UTC for portability, but the
   report's "freshness" timestamps should display in Europe/Sofia.
5. **Scope of roll-call MVP** — only current NS (52nd), or back-fill all
   parliaments parliament.bg has? Recommend current + previous (51st)
   for v1 to keep diffs reviewable; full backfill in a separate pass.
6. **Bill metadata** — second-tier; do we need bill titles + sponsors
   for the loyalty index, or just vote tuples? Recommend tuples-only for
   v1; bills can layer on later.

## Reference: existing infrastructure to reuse

- `src/data/dataUrl.ts` — the bucket URL prefix helper. New SPA hooks
  for roll-call data wrap fetches through this.
- `gsutil cp -Z` upload pattern — see commit `5743f3bc3` for the
  bucket-upload conventions (gzip in flight, immutable cache headers).
- `scripts/parliament/scrape_mps.ts` — best reference for the scraper
  pattern: fetch parliament.bg API, parse, write minified JSON, sharp-
  encode binaries, upload non-text without `-Z`.
- `scripts/polls/*` — best reference for an ingest pipeline that's
  already wrapped by a Claude Code skill (`/update-polls`).

## Glossary

- **Народно събрание (НС)** — National Assembly, Bulgarian parliament
- **NS folder** — `52` for the 52nd parliament; matches parliament.bg's URLs
- **CIK** — Централна избирателна комисия (Central Election Commission)
- **Сметна палата** — Court of Audit (handles party financing oversight)
- **register.cacbg.bg** — official MP asset/declarations registry
- **Roll-call vote** — поименно гласуване; per-MP vote on a specific
  motion or bill
