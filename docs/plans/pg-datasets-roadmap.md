# Moving the next data tables to Postgres — roadmap

Postgres is now the single source of truth for **procurement contracts** + the
**Commerce Register (TR)**, generating the static JSON and serving live search +
the person/company pages (see [postgres-migration-v1.md](postgres-migration-v1.md)).
This roadmap picks the next datasets, prioritised by the brief: **large + changes
often**, with a secondary weight on **query/join value** and **regeneration
churn**.

## The landscape (measured 2026-07-02)

| Dataset | On-disk | Rows | Change cadence | Joins the PG entity graph? | Migrated? |
|---|---|---|---|---|---|
| Procurement contracts | 2.6 G | 301k | ~daily (watcher) | — (is the graph) | ✅ |
| Commerce Register (TR) | 0.4 G (state.sqlite) | 1.0M co + 1.0M ppl | daily deltas | — (is the graph) | ✅ |
| **Tenders (procedures)** | **788 M** (`data/procurement/tenders`) | ~120k (24k in 2025) | **~daily (ЦАИС ЕОП feed)** | **YES — `ocid` → contracts (190k distinct); `buyerEik` → awarders/TR** | ⬜ |
| **ИСУН EU funds** | **1.0 G** | many (projects×muni×program×ekatte) | periodic (weeks) | **YES — `beneficiaryEik` → contracts / tr_companies** | ⬜ |
| **КЗП prices** | **462 M** | **1.29M** | **DAILY** | by EKATTE (geographic) | ⬜ |
| **Parliament roll-call votes** | **454 M** | many (votes × MPs); dissents 29 M | per-session (bursty, frequent when sitting) | mpId → parliament | ⬜ |
| Council minutes/votes | (growing) | per-município | as municipalities publish | eik / person names | ⬜ |
| Election cycles (`YYYY_MM_DD`, `sections`) | 500–700 M each | huge | **static** (once per election) | — | ⬜ (low priority) |
| Census 2021, settlements | 100–200 M | large | **~decennial / static** | EKATTE | ⬜ (low priority) |
| macro / regional / indicators / grao / air / landuse / noi | small | small | periodic, small | — | ⬜ (low value — stay JSON) |

**Read of the table:** the biggest dirs after what's already done are the
election cycles + `sections` — but those are **static** (they never change once an
election is ingested), so they fail the "changes often" test and are low-priority.
The datasets that are *both* large *and* frequently changing are the three in
bold: **funds, prices, votes**.

## Status (updated 2026-07-02)

**Tenders — foundation + live serving SHIPPED.** The `tenders` table
(`009_tenders.sql`) + loader (`load_tenders_pg.ts`, 125,505 procedures, full
precision from the by-tender shards) + the `ocid` lineage to contracts are in
(commit tenders→Postgres). Live serving is in (commit live tender pipeline):
`010_tenders_api.sql` (`tenders_buyer_summary` / `tenders_by_buyer` /
`tender_awards`) → `/api/db/tenders` + `/api/db/tender` (dev plugin + `db`
function) → the **"Announced procedures" tile on `/awarder/:eik`** (forecast Σ vs
actual awarded, contracted share, recent procedures). One follow-up:
- **Prod-enablement (operator)** — the tenders table + API functions live only
  in local PG; the tile stays hidden in prod until the Cloud SQL snapshot
  includes them: `npm run db:push` (pg_dump/restore covers the new table +
  functions), then redeploy `functions:db`. The read-only role auto-grants
  (ALTER DEFAULT PRIVILEGES) SELECT on the new table + EXECUTE on the new
  functions.

## Recommended sequence

**0. Tenders (procedures) — the fastest, most natural first move.** It's the
**same procurement domain already in Postgres**, so it reuses the shard→PG loader
shape and the `/api/db` serving. It's large
(788 M, #2), changes ~daily (same ЦАИС ЕОП feed as contracts), and — via `ocid`
— **completes the procurement lifecycle in one engine: procedure → award**. That
lineage unlocks the questions contracts alone can't answer: forecast
(`estimatedValueEur`) vs actual spend, was an award competitively tendered,
cancelled procedures, per-buyer pipeline. Crucially, tenders is currently
*quarantined* out of the JSON totals (forecast ≠ spend); a **separate `tenders`
table** in PG is exactly the clean way to keep it out of contract totals while
making it fully queryable + joinable. Lowest risk + effort, high value → do first.

**1. ИСУН EU funds** — the largest un-migrated dataset (1.0 G)
AND the only one whose rows carry `beneficiaryEik`, so it **joins straight onto the
entity graph already in Postgres** (contracts + TR). The moment it lands, the
person/company pages and unified search we just shipped can show *a company's
procurement AND its EU funds AND its registry* in one place — the highest-payoff,
lowest-risk move (it reuses procurement's exact "full rebuild → source-agnostic
builders → JSON verification net" pattern). It changes often enough (ИСУН
refreshes) to qualify.

**2. КЗП prices** — the purest "large + changes often" fit (DAILY, 1.29M rows). It
also forces the one pattern procurement/TR didn't need: **incremental daily append
(time-series)** rather than full rebuild. Establishing that muscle is worth doing
deliberately, and it unlocks live price queries (per settlement/product/chain, the
index over time, cross-place comparison) without regenerating 462 M of JSON daily.

**3. Parliament roll-call votes** — per-MP voting records + dissents (29 M) +
loyalty/similarity metrics; changes per session. PG enables live per-MP vote
queries + similarity and trims the mega-JSON. MPs join the existing parliament data.

> If you weight the unified-entity payoff over raw change-frequency, funds is the
> clear #1. If you weight change-frequency strictly, prices edges it (daily). Both
> are defensible; the sequence above leads with funds for the join synergy + reuse
> of the proven pattern, then prices to build the append pattern.

## Per-dataset migration sketch

### 0. Tenders / procedures (same domain — reuse procurement wholesale)
- **Schema** `tenders` (unp, ocid, date, buyer_eik, buyer_name, subject, cpv,
  cpv_desc, **estimated_value_eur** (FORECAST — never summed into spend), currency,
  lots_count, is_cancelled, nuts) + index on ocid + buyer_eik + a GIN trgm on a
  `buyer_fold` / `subject_fold`. Lives beside `contracts` in the same DB.
- **Load** `load_tenders_pg.ts` from the existing tender ingest (full rebuild from
  `data/procurement/tenders/**` shards, exactly like `load_pg.ts` does contracts).
  DONE. The ingest keeps writing the tenders JSON; not regenerated from PG (scope
  decision).
- **Live payoff:** join `tenders.ocid = contracts.ocid` →
  forecast-vs-actual, "competitively tendered?", cancelled/failed procedures,
  per-buyer pipeline; surface a "tenders" section on the awarder + company pages.
- Effort: **lowest** (same domain, all infra exists). Keeps the quarantine honest
  (separate table, never in contract totals).

### 1. ИСУН EU funds (full-rebuild pattern — reuse procurement's)
- **Schema** `fund_projects` (contract_number PK, title, total_eur, paid_eur,
  status, program_code, program_name, **beneficiary_eik**, beneficiary_name,
  ekatte/muni, dates) + GIN trgm on a `beneficiary_fold` for name search.
- **Load** `load_funds_pg.ts` from the raw ИСУН ingest → PG (full rebuild). The
  existing ingest keeps writing `data/funds/**`; we do NOT regenerate it from PG
  (see scope decision).
- **Live payoff:** `funds_by_eik(eik)` → add an "EU funds" section to the
  company/person pages (contractor_eik = beneficiary_eik), and fold beneficiaries
  into `search_all`. **This is the unified entity graph.**
- Effort: **low–medium** (pattern already built; the win is the join).

### 2. КЗП prices (NEW: incremental daily-append / time-series)
- **Schema** `price_obs` (date, ekatte, product_id, chain_id, min/avg/max/median
  eur) — a daily-partitioned/indexed time-series; + `price_index` (date, scope,
  value) materialised from it.
- **Ingest** `load_prices_pg.ts`: **append the day's ~1.29M rows** (idempotent
  upsert on (date,ekatte,product,chain)); never re-load history. This is the new
  pattern vs procurement's truncate+reload.
- The ingest keeps writing `data/prices/**`; we do NOT regenerate it from PG.
  Serve the heavy per-settlement / time-series views live instead.
- **Live payoff:** `/api/db/price?ekatte=&product=` — price of a basket in a
  place over time; cross-place ranking; chain comparison — all without shipping
  462 M of JSON.
- Effort: **medium** (new append + time-series aggregation; partitioning for the
  growing history).

### 3. Parliament roll-call votes (append-per-session)
- **Schema** `votes(session_id, mp_id, vote)` + `sessions` + derived per-MP
  metrics (loyalty, attendance, similarity, cohesion) as views/materialised.
- **Ingest** append new sessions (the watcher flags "N new sessions"). The ingest
  keeps writing the per-MP + dissents JSON; we do NOT regenerate it from PG.
- **Live payoff:** per-MP voting record + similarity served live from PG (the
  29 M dissents.json becomes a live query, not a shipped file).
- Effort: **medium** (similarity/cohesion metrics are the fiddly part).

## Scope decision (2026-07-02): NO JSON-from-PG generation

We will **NOT** build the "regenerate the static JSON FROM Postgres, verified in
`db:build`" step for **any** new dataset (funds, prices, votes, …). The offline
ingests already produce that JSON correctly; PG is for **live serving + queryable/
joinable tables** only. Reproducing the shards from PG is low value and invasive
(shards are written in non-deterministic order at full float precision). So per
dataset: build the **schema + loader + `/api/db` live serving**, and stop. The
contracts + TR `db:gen-*`/`db:build` machinery that already exists stays; we just
don't extend it. (Steps 2 and 4 below are therefore struck.)

## The reusable checklist (from procurement/TR — apply to each)

1. **Golden/verification net FIRST** — hash the current JSON (volatile-insensitive)
   so the loader is provably lossless (`scripts/db/lib/canonical.ts`, a round-trip
   check). Confirms the table captures the corpus; not a `db:build` gate.
2. ~~**Source-agnostic builders** (`build*FromRows`)~~ — SKIP (see scope decision).
3. **Schema + loader** — `schema/pg/NNN_*.sql` + `load_*_pg.ts`. Choose the
   ingestion pattern: **full rebuild** (funds) vs **incremental append** (prices,
   votes).
4. ~~**Generators read PG** (`db:gen-*` → `db:build` 0-diff)~~ — SKIP (see scope
   decision). The ingest stays the source of the on-disk JSON.
5. **Live serving** — add `/api/db/*` routes (the `db` Cloud Function) for the
   dynamic/joined views; keep bulk/static as JSON on the bucket.
6. **Distribution** — the `pg_dump` snapshot + lockfile already covers new tables.

## Cross-cutting payoff: the unified entity graph

`contracts.contractor_eik` = `tr_companies.uic` = `fund_projects.beneficiary_eik`
= (council/officials) — one EIK ties **procurement + registry + EU funds +
connections**. Migrating funds (then wiring council/officials) turns the
person/company pages into a single "everything the state paid this entity + who's
behind it" view. That synergy — not raw size — is the real reason to keep pulling
datasets into the one engine.
