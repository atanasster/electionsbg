---
name: update-open-calls
description: Refresh the open-calls register — which EU-programme procedures (ИСУН 2020) and ДФ „Земеделие" Strategic-Plan intakes a reader can APPLY to right now, into data/opencalls/*.json + the open_calls Postgres table. Use when the daily watch report flags `isun_procedures` or `sp2023_indicative` as changed, when the user asks to refresh open calls / отворени процедури / приеми / „какво е отворено сега", or after a fresh clone if the open_calls table is empty. This is the OPEN half of ИСУН — distinct from update-funds, which refreshes the AWARDED corpus. The publish step to Cloud SQL is mandatory and nothing runs it automatically.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update open calls skill

Crawls two registers of things you can still apply to, and publishes them:

- **ИСУН 2020** — `/Active` (real procedures, `kind='call'`) and `/PublicDiscussion`
  (draft guidance out for comment, `kind='consultation'`), into `data/opencalls/isun.json`;
- **ДФ „Земеделие"** — the indicative intake schedule under the CAP Strategic Plan
  2023-2027, into `data/opencalls/sp2023.json`.

Both then load into `open_calls` (migration 142) and surface on the `/funds` band-1 tile,
`/funds/calls`, and the `openCalls` AI tool.

## Read this before anything else: why this dataset is different

Every other dataset here fails by going STALE — a number is out of date. **This one fails by
costing a reader a deadline**, and that inverts three of the usual rules. Do not "simplify"
around them.

1. **Nothing stores a status.** `open_calls_table` derives `open` / `closed` / `upcoming` /
   `indicative` / `consultation` by comparing `closes_at` to `now()`. So if this skill never
   runs again, expired calls disappear on their own and new ones are missing — the failure is
   UNDER-reporting, which is safe. Storing a status at crawl time would show expired calls as
   open all weekend after a Friday failure.
2. **The loader NEVER deletes.** The crawler reads `/Active`, so a call that closes is absent
   BY DESIGN. `db:load:open-calls:pg` is upsert-only and records absence as `last_seen_at`.
   If you ever find yourself adding an anti-join DELETE to it, you are deleting exactly the
   closed calls that make the archive and the base rates possible.
3. **A figure needs a provenance.** `enrichment` is `none` / `source` / `auto` / `reviewed`,
   and a CHECK bars the money columns unless it is `source` or `reviewed`. **This skill only
   ever produces `none` and `source`** — `source` for the ДФЗ XLSX, which has real budget /
   aid-rate / ceiling columns, and `none` for ИСУН, whose procedure page carries no money at
   all. Extraction from documents is a SEPARATE skill (`enrich-open-calls`) precisely so this
   one can run unattended without ever shipping an unreviewed number.

## Step 0 — Pin the local database

`db:load:open-calls:pg` writes Postgres through `scripts/db/lib/pg.ts`, whose default is the
docker container with an inline password. **An ambient `DATABASE_URL` always wins**, and every
`db:*:cloud` script exports a password-less URL, so `pg` falls back to `.pgpass` — which holds
the Cloud SQL password. Against local PG that fails with `28P01`. Any shell that has run a
`:cloud` command this session is poisoned, so pass the local URL inline when in doubt:

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' npm run db:load:open-calls:pg
```

## Step 1 — Crawl ИСУН

```bash
npm run opencalls:isun
```

Serial, ≥1.1 s between requests, identifying User-Agent, ~57 requests for a full run
(two listings + one detail page per procedure). `robots.txt` on `eumis2020.government.bg`
was verified clear for these paths. **Do not parallelise it** — this is a government portal
with a WAF, and the politeness budget is what keeps the crawl working.

Two failure shapes to recognise:

- **A WAF interstitial returns HTTP 200** with a body that parses to zero rows. The fetcher
  detects it (`looksLikeInterstitial`) and treats it as a failure rather than as an empty
  register. If more than 15% of detail pages fail, the run aborts without writing.
- **`data/opencalls/isun.json` is only overwritten when the crawl produced something.** The
  writer refuses an empty result and refuses a >25% shrink. That guard exists because it was
  needed: a throwaway probe script once overwrote the real snapshot with `{calls: []}`.

The snapshot preserves each call's original `crawledAt` when nothing about it changed, so a
no-op run produces a no-op diff.

## Step 2 — Refresh the ДФЗ indicative schedule

```bash
npm run opencalls:sp2023
```

One page fetch plus one XLSX. The year comes from the **filename**, never the URL — the host
is `sp2023.bg`, so a whole-URL match hands every link a phantom 2023.

The parse is header-driven rather than positional, and it declines prose: a cell reading
„съгласно условията" is not a budget, and a range of aid rates is not a single rate. Those
become NULL rather than a guess, and the row keeps its verbatim text.

**Skip this step when only `isun_procedures` was flagged.** The schedule is annual; there is
no reason to re-download it on an ИСУН change.

## Step 3 — Load locally

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' npm run db:load:open-calls:pg
```

It applies `005_ingest_tracking.sql` + `142_open_calls.sql` itself, so it works on a cold
database. Stage-merged upsert, so it is safe against a live database and never blocks readers.

One behaviour worth knowing: the upsert **will not downgrade** a `reviewed` or `source` row
back to `none`. A human's sign-off on a figure survives every subsequent crawl of a source
that does not publish that figure — which is the whole reason Stage 7's enrichment can be
trusted at all.

Check what it did:

```bash
npx vitest run scripts/db/tests/open_calls.data.test.ts
```

## Step 4 — Publish to Cloud SQL (MANDATORY)

**Nothing runs this automatically, and skipping it is invisible.** Local goes green, prod
keeps serving the previous vintage at a 200, and every row count reconciles. This is the
`reference_migrated_family_watch_reload` failure class and it is the single most likely way
this dataset rots.

```bash
npm run db:load:open-calls:pg:cloud
```

Requires the Cloud SQL proxy on 5434. The loader applies 142 there too, including its
reconcile ALTER — which matters on a database that predates the `numeric` → `double
precision` fix, because `numeric` reaches the browser as a STRING and blanks every money cell
while the number sits in the payload.

**The freshness stamp is PER SOURCE**, and the page reports the newest SUCCESSFUL one across all of
them. So running only Step 1 (ИСУН) leaves `sp2023`'s stamp where it was, which is correct — but it
also means a run where ИСУН failed and ДФЗ succeeded shows a fresh „Проверено на" while the ИСУН half
is stale. `open_calls_crawl.ok` records the failure; the page's banner reads the newest `ok = true`
row, so a wholly failed run correctly reports the previous date rather than today's.

There is **no `bucket:sync` step.** `data/opencalls/` is excluded from GCS sync
(`scripts/bucket_sync_paths.ts`) because it is a PG load source, not a serving artifact — a
second copy on the bucket would be a spare serving surface that can go stale.

## Step 5 — Verify what a reader sees

```bash
curl -s "http://localhost:5173/api/db/open-calls?limit=5" | head -c 400
```

Three things to eyeball, each of which has been wrong before:

- the three groups are **separate** (`calls`, `indicative`, `consultations`) — an indicative
  ДФЗ window must never render a countdown, and a draft must never sit beside a real call;
- `totals` are the GROUP sizes, not `calls.length` (the tile's heading count reads them);
- money fields are **numbers, not strings**. A string means 142's reconcile has not been
  applied to whatever database you are talking to.

Then load `/funds` and `/funds/calls` and confirm the freshness line („Проверено на …") is
present and recent. If it says „още не е зареждан", the loader has not run against the
database the page is reading.

## Step 6 — Stamp the update feed

Add a `data/data-changes.json` entry and let `process-watch-report` stamp `recent_updates`
per its own rules. The two changelogs are separate — see `reference_two_changelogs`.

## What this skill does NOT do

- **It does not extract money or eligibility from documents.** That is
  `enrich-open-calls`, and it is separate on purpose: crawl+load is mechanical and safe
  unattended, while enrichment spends tokens per document and must not publish a figure
  without human sign-off.
- **It does not touch the awarded corpus.** `update-funds` does that. If the watch report
  flagged `isun_eu_funds` or `isun_eu_funds_projects`, you want that skill, not this one.
- **It does not cover Interreg.** Interreg runs on Jems rather than ИСУН, so its calls are
  not in either register here. `/funds/calls` states that boundary on the page.
