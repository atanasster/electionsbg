---
name: update-kzk-appeals
description: Refresh the КЗК (Commission for Protection of Competition) procurement-appeals register — жалби по ЗОП from reg.cpc.bg — into data/procurement/kzk_appeals.json + the kzk_appeals Postgres table, then rebuild the AI summary. Use when the daily watch report flags `kzk_appeals` as changed, when the user asks to refresh КЗК appeals / жалби / procurement complaints, or after a fresh clone if the kzk_appeals table is empty. Drives a headed Playwright browser and needs Bulgarian egress.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update КЗК appeals skill

Crawls the КЗК procurement-appeals register (`reg.cpc.bg`), upserts the complaints into
the `kzk_appeals` Postgres table, and rebuilds the AI-tool summary.

Surfaces on `/tenders/:unp` (appeals tile + "under appeal" / "suspended" chips), the
`/procurement` "Recent appeals (КЗК)" tile, and the `procurementAppeals` AI tool.

## Two constraints before you start

1. **Headed Playwright.** A desktop browser window opens for ~2 minutes. Fine on a dev
   machine, which is why the orchestrator runs this unattended — but it is **never** a
   CI or `npm run prod --all` step.
2. **Bulgarian egress.** `reg.cpc.bg` returns 403 to non-BG IPs. From elsewhere the crawl
   fails at page 1; there is no proxy path. Skip the skill and report it.

## Step 0 — Pin the local database (READ THIS FIRST)

`--apply` writes Postgres through `scripts/db/lib/pg.ts`. That module's default is the
docker container with an **inline** password (`postgres:postgres@localhost:5433`), but an
ambient `DATABASE_URL` always wins — and every `db:*:cloud` npm script exports a
**password-less** URL by design, so `pg` falls back to `.pgpass`, which holds the **Cloud
SQL** password. Against local PG that fails:

```
error: password authentication failed for user "postgres"   (code 28P01)
```

Any shell that has run a `:cloud` command this session is poisoned. So always pass the
local URL inline rather than relying on the default:

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
  npx tsx scripts/procurement/kzk_appeals.ts --year <current-year> --apply
```

The crawl is idempotent (`mergeWrite` on the JSON, `COALESCE` upserts in PG), and the
failure above happens at *connect* time — before any write. So a re-run after a `28P01`
loses nothing and double-counts nothing.

## Step 1 — Crawl the complaints (intake)

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
  npx tsx scripts/procurement/kzk_appeals.ts --year 2026 --apply
```

Incremental by design — one calendar year. The full 2020→ history is behind `--backfill`
and stays a one-off operator step (see [[feedback_one_off_backfills]]); `--backfill` and
`--year` are mutually exclusive, as are `--dry-run` and `--apply`.

Expected output:

```
  … kzk crawl: page 1, 5/691
  … kzk crawl: page 126, 630/691
  2026: 691 complaints
Parsed 691 complaints (691 with УНП, 0 without).
Wrote …/data/procurement/kzk_appeals.json (7805 total).
Upserted 691 into kzk_appeals + resolved buyer_eik.
```

The `Wrote …` line lands **before** the PG upsert, so a DB failure still leaves the JSON
correct — check for that line before assuming the crawl needs redoing.

Writes `data/procurement/kzk_appeals.json` (gitignored, PG-served) and upserts the
`kzk_appeals` table: exact УНП→`tenders` join, plus `recordIngestBatch` so the refresh
shows up in `recent_updates`.

## Step 2 — Verify the outcomes survived (MANDATORY)

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d electionsbg -tAc \
  "select count(*) from kzk_appeals where outcome is not null;"
```

**Expect ≥ 2098.** These merits outcomes (626 upheld / 1,472 rejected) were produced
interactively and **cannot be regenerated from committed code** — see the tier-2 gap
below. The upserts protect them with `COALESCE(existing, EXCLUDED)` on `outcome`,
`suspension`, `status`, `unp` and `source_url`, precisely so a markup-drift miss on a
re-scrape never NULLs a known-good value.

If the count drops, the COALESCE guards regressed. **Stop.** Do not commit, do not sync
to cloud, and do not re-run — the local table is now the only copy of whatever survived.

## Step 3 — Rebuild the AI summary

```bash
npm run kzk:summary
```

Writes `data/procurement/derived/kzk_appeals_summary.json` — the file the
`procurementAppeals` AI tool serves. This one **is** committed:

```bash
git add data/procurement/derived/kzk_appeals_summary.json
git commit -m "procurement: refresh КЗК appeals summary (N complaints for YYYY)"
```

Both `kzk_appeals.json` and `kzk_decisions.json` stay gitignored — Postgres serves them,
the client never fetches them.

## Step 4 — Publish to prod (Cloud SQL)

Procurement is served from Cloud SQL, so there is no `bucket:sync` for this dataset.

`kzk_appeals.ts` applies **no DDL of its own** — the table and its two functions must
already exist on the target. Normally they do: `db:load:tenders:pg[:cloud]` applies
`042_kzk_appeals.sql` as part of its own schema pass (`load_tenders_pg.ts`, `KZK_FILE`),
because `tender_appeals()` joins tenders by УНП. So after any `update-procurement` publish,
the cloud table is already there.

If you're publishing КЗК *without* a tenders load (or onto a fresh cloud DB), apply the
migration yourself first. It's idempotent (`CREATE TABLE IF NOT EXISTS` +
`CREATE OR REPLACE FUNCTION`), so running it every time is harmless:

```bash
# 1. (only if 042 hasn't reached this DB) table + tender_appeals() + kzk_recent_appeals()
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 042_kzk_appeals.sql

# 2. re-crawl straight into Cloud SQL
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/procurement/kzk_appeals.ts --year 2026 --apply
```

`apply_functions.ts` takes **bare filenames** relative to `scripts/db/schema/pg/`, not
paths. Both commands need the Cloud SQL proxy on `127.0.0.1:5434` with the `.pgpass` line
present — here the password-less URL is *correct*, which is exactly why it must never leak
into a local invocation (Step 0).

> **`npm run db:dump:cloud` does NOT publish this.** `scripts/db/dump.ts` is a
> snapshotter: it `pg_dump`s whatever `DATABASE_URL` points at and uploads the dump to GCS
> for `db:restore`. Pointed at the proxy it dumps Cloud SQL *outward*. It writes nothing
> into cloud and cannot create the table. Run it after the loaders if you want a restore
> point; never instead of them. (It was called `db:dump` until 2026-07-10 — that name kept
> getting copied into deploy checklists as a no-op.)

There is no `db:load:kzk:pg:cloud` wrapper — the crawl *is* the loader, which is why
publishing means re-crawling against the cloud URL. The alternative is the destructive
whole-DB `npm run db:sync:cloud -- --yes`, which requires local to be source of truth
first — including these unregenerable outcome rows.

## The tier-2 gap: merits outcomes

A complaint's *outcome* is not in the intake register. It lives in a separate decisions
register (`reg.cpc.bg/AllResolutions.aspx?dt=2&ot=2`, field **"Произнасяне"**), joined back
onto `kzk_appeals.outcome` via an **unambiguous** complainant + respondent + year 1:1 match
(ambiguous rows stay null — no low-confidence guesses). It also authoritatively sets
`suspension`, which the intake can only infer from `/спрян/` in `status`.

**⚠ `scripts/procurement/kzk_decisions.ts` does not exist.** The crawler is a TODO. The
~2,098 outcome rows in PG/JSON today were produced interactively and are irreplaceable.
Until it lands:

- Never wipe `kzk_appeals.json` or `TRUNCATE kzk_appeals`.
- Skip tier-2 entirely on a fresh machine — a clone gets intake-only data, and `outcome`
  will be null everywhere.
- Treat Step 2's assertion as a hard gate, not a formality.

## Data-integrity contract

| Surface | Behaviour |
|---|---|
| Non-BG egress | reg.cpc.bg 403s; crawl fails at page 1. Report, don't retry. |
| Ambient cloud `DATABASE_URL` | `28P01` at connect, before any write. Re-run with the local URL pinned. |
| Header-total mismatch | The crawler asserts the parsed count against the page's "Намерени са общо N жалби" header — a pager or Turnstile regression fails loud rather than silently returning a short list. |
| Markup drift dropping a label | `COALESCE` upserts keep the previously-good value; the row does not flip to unresolved. |
| `outcome` count drops after a run | The guards regressed. Halt — see Step 2. |

## Stamping

The orchestrator stamps `state/ingest/kzk_appeals.json` (the marker is named for the
watcher source, not the skill):

```bash
npx tsx scripts/stamp-ingest.ts kzk_appeals --summary "КЗК appeals YYYY intake: N complaints, M total, 2,098 outcomes preserved"
npx tsx scripts/append-data-change.ts kzk_appeals --summary "КЗК procurement-appeals register refreshed: N complaints for YYYY" --source "КЗК (reg.cpc.bg)"
```

Only stamp after Step 2 passes.

## What this skill does NOT do

- **Does not crawl the decisions/merits register.** That script isn't written yet.
- **Does not run `bucket:sync`.** `procurement/` is excluded from the sync; Cloud SQL serves it.
- **Does not run `update-procurement`.** Different source, different corpus. A `kzk_appeals`
  flip must never enqueue the full АОП re-ingest.
- **Does not run in CI.** Headed browser + BG egress.

## File map

| Path | Purpose |
|---|---|
| `scripts/procurement/kzk_appeals.ts` | Headed crawl + JSON merge + PG upsert (`--year` / `--backfill` / `--apply` / `--dry-run`) |
| `scripts/procurement/build_kzk_summary.ts` | `npm run kzk:summary` — the `procurementAppeals` AI-tool payload |
| `scripts/db/schema/pg/042_kzk_appeals.sql` | Table + `tender_appeals(unp)` + `kzk_recent_appeals(limit)` |
| `scripts/db/apply_functions.ts` | Surgical idempotent DDL apply (bare filenames) |
| `data/procurement/kzk_appeals.json` | Full complaint store — gitignored, PG-served |
| `data/procurement/kzk_decisions.json` | Tier-2 outcomes — gitignored; **no generator in repo** |
| `data/procurement/derived/kzk_appeals_summary.json` | AI summary — **committed** |
| `scripts/watch/sources/kzk_appeals.ts` | Watcher source — fingerprints the current-year complaint count + newest id |
