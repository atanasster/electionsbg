# Home dashboard — operator runbook

The global home page at `/` is served from **two committed JSON artifacts on GCS**, never from
Postgres. This is the runbook for regenerating them, publishing them, telling healthy from
stale from absent, and recovering when one of those goes wrong.

Design: [`docs/plans/home-dashboard-implementation-v1.md`](plans/home-dashboard-implementation-v1.md).
Price thresholds: [`docs/audits/home-price-threshold-replay-2026-09-01.md`](audits/home-price-threshold-replay-2026-09-01.md).

---

## 1. What the page reads

| object | committed file | built by | what it is |
| --- | --- | --- | --- |
| `home/hub_stats.json` | `data/home/hub_stats.json` | `db:gen-home-hub-stats` | the four pulse figures and every tile's metric |
| `home/feed.json` | `data/home/feed.json` | `db:gen-home-feed` | the „what changed" rows, 30-day window |
| — (input only) | `data/home/price_events.json` | `db:gen-home-price-events` | the basket move and promotions the feed's price adapter reads |

⚠️ **`/` fires ZERO `/api/db` requests.** It is the entry page; a database on its critical path
would put every first visit behind a Cloud SQL connection. The one step that reads Postgres is
`db:gen-home-price-events`, and it runs offline and commits its measurements precisely so
`db:gen-home-feed` — and therefore a fresh clone — needs no database at all.

---

## 2. The whole procedure

```bash
npm run db:gen-home-hub-stats     # folds the sibling hubs — run it FIRST
npm run db:gen-home-price-events  # the only step that reads Postgres
npm run db:gen-home-feed          # reads the file the previous step wrote
npm run home:health               # both freshness arms — exits non-zero
npm run home:publish              # bucket:sync:paths -- home  &&  bucket:gz
npm run home:health -- --public   # …and confirm the bucket now serves what we committed
```

`db:refresh` carries the first three at the end of its chain — but **not** the health check and
**not** the publish, so a full refresh still needs the last three.

The automated path is different and does not publish: `process-watch-report` runs the three
generators and `home:health` as **Final post-step 7b**, then records `home` in
`state/upload/pending.json` for `/upload-watch-changes`. `home:publish` above is the operator's
one-liner for working by hand.

### Ordering, and why each one is silent when wrong

- **`hub-stats` before the others.** It is a FOLD of `governance/hub_stats.json`,
  `procurement/derived/hub_stats.json` and `data/macro.json`. Run before a sibling generator it
  folds that sibling's previous vintage, and `/` then disagrees with the page one click away —
  at a 200, with every count reconciling.
- **`price-events` before `feed`.** The feed's price adapter reads the committed file, so the
  other order folds the previous vintage's basket move and promotions.
  `refresh_coverage.test.ts`'s `ORDER_PAIRS` holds this for the `db:refresh` chain.
- **`bucket:gz` after every sync, always.** `gsutil rsync -j json` sets a **transport** encoding
  only — the stored object comes back `identity` — so a sync REVERTS the gzip a previous
  `bucket:gz` established. `home:publish` is one script for exactly this reason; do not run the
  sync on its own.

### Generate once per run, never once per source

Nine families feed the feed. A per-source mapping would run the generators up to nine times in
one orchestrator run, each fold catching whichever siblings had not yet finished.

---

## 3. Healthy, stale, absent — three states that all answer 200

`npm run home:health` exits non-zero on any of them and prints a per-family table.

| symptom | what it means | fix |
| --- | --- | --- |
| `missing — data/home/feed.json` | the generator has never run here | run §2 |
| `corrupt — data/home/feed.json: …` | truncated or half-written, NOT absent | `git checkout -- data/home/feed.json`, then §2 |
| `schema — feed schemaVersion 2` | a version this checker does not read | update the checker, or regenerate |
| `unbuilt — no source has been observed since …` | **the pipeline has stalled** — nothing crawled in over a week | check the watcher and the ingests |
| `unavailable — council: source unreadable` | the adapter could not read its source at all | check the shard tree / snapshot exists |
| `unavailable — prices: declares a 5d cadence but no vintage` | the family is available with no date | check that adapter's `newest` |
| `stale — prices: last moved 2026-08-24, 8d behind, ceiling 5d` | the SOURCE is behind its cadence | investigate the ingest, not the generator |
| `stale — prices: built against a 400d ceiling, the code now declares 5d` | someone tuned `STALE_AFTER_DAYS` | regenerate the feed |
| `unpublished — home/feed.json → HTTP 404` | committed and never uploaded | `npm run home:publish` |
| `unpublished — home/feed.json is stored as identity` | synced without `bucket:gz` | `npm run bucket:gz` |
| `drifted — home/feed.json differs from the committed file` | the bucket holds an older vintage | `npm run home:publish` |

⚠️ **`db:check-generated` CANNOT see the middle rows, and that is the point of `home:health`.**
It compares local bytes against the bucket — „was this published?", never „is this current?".
When a generator is never re-run at all, disk and bucket are both stale, they **agree**, and it
prints OK.

⚠️ **THE TWO FRESHNESS ARMS ARE DIFFERENT QUESTIONS AND NEITHER SUBSTITUTES FOR THE OTHER.**

- **absolute** (`unbuilt`) — the newest OBSERVATION any family reported, against the wall clock.
  ⚠️ Measured on `observedAt`, never on `computedAt`: both artifacts date themselves by their
  newest source vintage, so `hub_stats` sitting weeks back is its ORDINARY state (quarterly
  macro, sibling hub blobs) and flagging that would be a false positive on every run. A crawl
  clock that has not moved in a week means nobody has looked.
- **relative** (`stale`) — each family against its declared cadence. This one cannot see a
  stalled pipeline at all: `stale` is frozen into the artifact and measured against that
  artifact's own `computedAt`, so when everything stops, every lag stays put.

⚠️ **THE TWO `computedAt` VALUES ARE NOT COMPARABLE.** `hub_stats.json` and `feed.json` fold
DIFFERENT source sets — the feed's newest is a daily price crawl, hub-stats' is quarterly macro
— so a gap of weeks between them is normal, and `home:health` prints both dates rather than
asserting they match.

⚠️ **A family with no cadence is reported and never flagged.** `elections` is `null` in
`STALE_AFTER_DAYS` because Bulgaria's last two elections are **539 days** apart — a ceiling
loose enough for that detects nothing, so the honest answer is that the family has no cadence.
`intl_debt` is `null` because it publishes nothing (see §5).

The ceilings live in `STALE_AFTER_DAYS` (`scripts/db/gen_home/events/adapters.ts`) and are a
declared expectation, not a derived one — a threshold inferred from the corpus would just
describe whatever the pipeline last did. They are a first cut, meant to be tuned.

---

## 4. Failure behaviour: nothing half-written reaches the bucket

All **three** generators build in memory, validate, write a temporary sibling and rename. All
three **refuse rather than write an empty artifact**:

- `hub_stats.ts` refuses when no source answered and when no source vintage could be normalised;
- `price_events.ts` skips with a warning when the price corpus is absent or empty — an empty
  rebuild would replace good measurements with none, and the feed would quietly lose its price
  rows;
- `feed.ts` refuses when no adapter produced anything, when no source declared a vintage, and —
  the case that actually reaches production — when nothing survives the 30-day window. That is
  reachable: `openCallsAdapter` contributes a CRAWL date, so a run in which only the crawler
  moved and every call it found opened over a month ago has a `computedAt` with an empty window.
  Every schema gate passes vacuously at zero rows and the browser then shows the outage state
  for a corpus that is fine.

**Do not publish past a red `home:health`.** A half-written file on the entry page is worse than
a stale one.

---

## 5. The editorial-review queue

`intlDebtAdapter` builds Eurobond rows and marks every one `editorial_review`; `feed.ts` drops
them before writing and reports the count. `data/debt-emissions.json` is hand-maintained — no
crawler, no watcher — so a terms error would publish as a claim about the Republic's own
borrowing with nothing able to catch it.

```bash
npx tsx scripts/db/gen_home/feed.ts --include-review   # list what is staged
```

Promoting the family is a one-field change once a structured authority exists. Until then the
rows are built, counted and listable, and none is published.

---

## 6. Replaying and re-deciding the price thresholds

```bash
npx tsx scripts/db/gen_home/price_events.ts --replay --days 90
```

Prints the percentile distribution, the cohort range, and — for each candidate threshold — the
crossing days, the episodes they collapse into and the episode dates. The accepted rule and the
evidence for it are in the audit; re-run the replay and **re-state the audit's figures** before
changing `BASKET_MOVE_PCT`.

⚠️ **Fewer events is not the objective.** ±2.0% produces fewer episodes than ±1.5% and one of
them is a single August episode reported twice — the exact failure the run-collapse exists to
prevent. One row per episode is the target.

Every threshold is written into `data/home/price_events.json` under `thresholds`, from one
exported `THRESHOLDS` object, so a reader of a future rebuild can tell a rule change from a
corpus change.

---

## 7. Recovery

| situation | what to do |
| --- | --- |
| an artifact was published with a bad vintage | regenerate (§2) and republish; the objects are overwritten in place |
| a generator aborted mid-run | nothing was written — the rename is atomic. Re-run it |
| the committed file is wrong and the bucket is right | `git checkout -- data/home/…` then regenerate |
| the bucket is wrong and the committed file is right | `npm run home:publish` |
| both are wrong | regenerate from source, verify with `home:health`, then publish |
| a source is stale | fix the ingest. Regenerating changes nothing — the feed reports what it has |

⚠️ **Never hand-edit a committed artifact.** Both are byte-reproducible from their sources, and
a hand-edit is undone by the next generation with no record that it happened.
