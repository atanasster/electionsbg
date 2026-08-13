# Cloud SQL deploy speed v1 — make the post-watch-report publish minutes, not an hour

## Context

After a `process-watch-report` run, the procurement corpus is published to prod with:

```bash
npm run db:load:pg:cloud && npm run db:load:tenders:pg:cloud && npm run db:load:awarder-seats:pg:cloud
```

This takes **over an hour**. It runs after every ingest day, so it is the single
longest step in the daily publish loop and the main reason the loop is not
automated end-to-end.

An earlier round of work already took the contracts leg from 4077s → 722s by
converting `procurement_normalcy_cache` from a twice-built matview into a plain
table shipped from local (`buildOrShipNormalcy`, commit `baa47334d`), and did the
same for `tender_normalcy_cache` (`d39dbd860`, `51e55a3a6`). Since then the
tenders corpus roughly doubled (the pre-2020 РОП backfill: 126k → 232k rows) and
the total has crept back over an hour.

This plan finishes the job by generalising the pattern that already worked, and
by removing the structural sources of waste that survive it.

**Scope (operator directive 2026-07-24):** the whole Cloud SQL publish, not just
the three procurement commands — `db:load:tr:pg:cloud` (~18.6 min estimated; **34.9 min measured 2026-08-07, see F11**) and the other
30 `:cloud` scripts included. `lib/ship.ts`, `applyIfChanged` and `shipDelta` are
shared infrastructure from day one.

**Related:** [[reference_cloud_sql_deploy_perf]], [[reference_contracts_reload_lock]],
[[reference_pg_bulk_load_copy]], [[reference_pg_payload_determinism]],
`docs/plans/postgres-migration-v1.md`, `docs/plans/procurement-normalcy-v1.md`.

---

## Measured baseline (2026-07-24)

### The deploy ships ~2.3 GB to change 69 rows

From `ingest_batches` on prod (`127.0.0.1:5434`):

| id | source | rows shipped | rows new |
|---:|---|---:|---:|
| 142 | `tender` | 232,260 | **67** |
| 141 | `shards` (contracts) | 403,997 | **2** |

### Cloud table sizes

| table | rows | total size |
|---|---:|---:|
| `contracts` | 357,010 | **1732 MB** |
| `tenders` | 231,920 | **564 MB** |
| `procurement_normalcy_cache` | 403,203 | 376 MB |
| `tender_normalcy_cache` | 232,260 | 138 MB |
| `awarder_risk_grade_scoped` | 12,279 | 5.4 MB |
| `awarder_seats` | 3,845 | 736 kB |

### Every derived cache is tiny — and is computed on a 0.5-vCPU instance

| matview | rows | size |
|---|---:|---:|
| `procurement_overview_cache` | 1 | 56 kB |
| `procurement_by_settlement_cache` | 1 | 80 kB |
| `procurement_rankings_cache` | 1 | 160 kB |
| `procurement_risk_indexes_cache` | 1 | 344 kB |
| `awarder_totals` | 4,411 | 456 kB |
| `awarder_kindex_ranking` | 435 | 176 kB |
| `awarder_risk_grade_ranking` | 1,161 | 304 kB |
| `sector_contractor_stats` | 40,605 | 5.5 MB |

Total derived-cache output for the contracts path: **~7 MB**, recomputed from
1.7 GB of input on `db-g1-small` (shared-core ~0.5 vCPU, 1.7 GB RAM,
`shared_buffers` 128 MB).

---

## Measured deploy profile (2026-08-05) — first per-step timing

Phase 0 has **not** shipped (`scripts/db/lib/step.ts` does not exist), so the
admission above — "every claim about *where* the hour goes is inference" — was
still true. This is the first measured profile. It is **chain-granular, not
phase-granular**: each row is one `db:load:*:cloud`, timed by an external
wrapper, so it does not replace Phase 0's in-loader instrumentation. It does
settle which loaders are worth instrumenting first.

Real publish of one `/process-watch-report` run (procurement + ИСУН + КЗК +
budget + macro + council), `db-g1-small`, proxy on `127.0.0.1:5434`:

| # | step | seconds | | note |
|--:|---|--:|---|---|
| 1 | `contracts` | **3878** | 64.6 min | ships **+106 rows** |
| 2 | `annexes` | 41 | | |
| 3 | `tenders` | **1049** | 17.5 min | |
| 4 | `awarder-seats` | **776** | 12.9 min | 3,845-row / 736 kB table |
| 5 | `funds --full` | 230 | 3.8 min | 2 routes 500 for the window |
| 6 | `transport-project` | 247 | | |
| 7 | `water-operator` | 4 | | |
| 8 | `mvr-directorate` | 17 | | |
| 9 | `procurement-scopes` | **945** | 15.75 min | **entirely duplicate — see F1** |
| 10 | `persons-browse` | 362 | 6.0 min | |
| 11 | `person-search` | 421 | 7.0 min | |
| 12 | `graph` | 167 | | |
| 13 | `tr-company-place` | 61 | | |
| | **total** | **8198** | **136.6 min** | |

Verified afterwards: cloud `contracts` = local to the cent (408,483 rows,
€99,293,064,763.34, latest 2026-08-04), `/api/db/procurement-overview` and
`/api/db/fund-beneficiary` both 200 in ~1 s.

### F1 — the scoped-matview refresh runs up to three times per deploy (945 s, 11.5%)

The single largest *removable* cost measured. The six matviews in
`SCOPED_MATVIEWS` are refreshed by:

- `db:load:pg` — logs `scoped precomputes: refreshing 6/6`
- `db:load:awarder-seats:pg` — logs `refreshing 4/4 (changed: awarder_seats)`
- `db:load:procurement-scopes:pg` — refreshes 6/6 **again**

Step 9 therefore recomputed what steps 1 and 4 had already produced, for
**945 s of a 8198 s deploy**. Nothing is wrong per loader — each is correct
standalone, which is exactly why this is invisible: the waste only exists in
the *composition*, and no loader can see it.

This is RC1/RC3 confirmed at chain level, and it suggests a cheap pre-Phase-2
win: a per-run "already refreshed this generation" guard (a refresh ledger
keyed by matview + input digest), so the Nth caller in one deploy is a no-op.
That is strictly smaller than Phase 2 and would have cut this run by ~16 min.

> **EXTENDED 2026-08-07 — see F8.** The duplication is not confined to this one
> step. A run that skipped `procurement-scopes` entirely still refreshed every
> scoped matview **at least twice**, because `db:load:pg` (6/6),
> `db:load:awarder-seats:pg` (4/4) and `db:load:tr:pg` (3/3) each refresh from
> inside themselves. `procurement_payloads` ran **3×** in one deploy. The
> duplicate 4/4 is 656 s of `awarder-seats`' 740 s (**89%**), so the total
> removable duplicate is **~1,600 s ≈ 27 min**, not 945 s. Verification also
> showed all six matviews correct on cloud *without* the standalone step — so
> dropping `db:load:procurement-scopes:pg:cloud` from the publish chain is a
> free ~945 s before any ledger is built.

### F2 — cost is decoupled from data volume, in both directions

`contracts` spent 64.6 min to ship **106 new rows** (0.026% of the table) —
the 2026-07-24 thesis, re-measured on a fuller corpus. But the sharper
evidence is the small tables:

- `awarder-seats` — 3,845 rows, 736 kB — **776 s**, because it fans out to
  matviews 119+123+124.
- `water-operator` — same crosswalk family — **4 s**.
- `transport-project` — same family again — **247 s**, a **60×** spread
  against its sibling.

So "ship less data" (Phase 3) does not by itself fix steps 4/6/9; those are
paying for dependent recompute, not transfer. Phase 2/F1 is the lever there.
Worth splitting the Phase 3 win estimate accordingly.

### F3 — the GCS half is already fast; the hour is entirely Cloud SQL

The same publish's bucket half: **94 s** for **1,085 objects / 7.9 MiB**
across 12 scoped paths (`myarea`, `budget`, `council`, `macro*.json`,
`officials/derived`, the two procurement allowlist files, `data_map.json`,
`data-changes.json`). Against the whole-tree `bucket:sync`'s ~30 min fixed
enumeration cost, the scoped form is ~19× faster and was 0.6% of total deploy
time. No further work needed on that half — it is not where the hour goes.

### F4 — `db:load:funds:pg:cloud` already implements the Phase 4 pattern

It refuses to run against Cloud SQL without an explicit scope, printing:

```
Refusing to guess the scope of a Cloud SQL load.
  --payloads-only   rebuild fund_payloads only (stage-merged, seconds, never blocks a reader)
  --full            also reload fund_beneficiaries + fund_projects. ~4.5 minutes
                    during which /api/db/fund-contract and /api/db/fund-beneficiary return 500
```

Measured `--full` at **230 s**, close to its own estimate. This is the exact
shape Phase 4 wants for `tenders` (RC4/RC6): a fast non-blocking default plus
an opt-in heavy path that *states its own availability cost*. Copy it rather
than designing a new one — and note the guard is what makes the fast path
safe to default to, since it forces the caller to have decided.

### F5 — deploy automation must not pipe, and must not assume a 1-hour cap

Two operational traps hit during this run:

- `npm run <chain> | tail` returns **`tail`'s** exit status, not the chain's.
  Earlier the same day a `db:refresh` halted at step 44 of 51 and reported
  **exit 0** for precisely this reason. Any wrapper this plan adds must run the
  command unpiped and check `$?` per step (the profile above does).
- `contracts` alone (64.6 min) exceeds a 1-hour watcher timeout, so a naive
  monitor expires mid-step and reports nothing. Progress watching has to be
  persistent or re-armed.

### F6 — count comparisons need a stated basis (relevant to Phase 3 / G3)

A pre-deploy sanity check compared `index.json`'s `totals.contracts` (402,338)
against cloud `count(*) FROM contracts` (408,377) and read as "cloud is fuller
than local — this deploy would delete 2,551 rows". It was an artefact:
`totals.contracts` **excludes** the 3,488 `contractAmendment` rows and the
`award`-tag rows, while `count(*)` includes them. Like-for-like, local was a
strict superset (+106 `eop` rows).

Phase 3's delta/verify and G3's row hash must therefore pin the basis
explicitly — same tag filter, same table — or the verifier will produce
confident false alarms of exactly this shape. A cheap guard: have the verifier
report `count(*) GROUP BY tag`, never a single scalar.

> **EXTENDED 2026-08-07 — see F12.** `GROUP BY tag` is necessary but not
> sufficient: there are **four** bases, not two, and the fourth is the dangerous
> one. Even at identical tag and table, PG holds 2,658 rows the shards do not —
> the synthetic `obed-` consortium carriers minted by 087 — and the natural
> "normalisation" of filtering them out under-reports by **€6.13 bn**, because
> 087 zeroed the member rows those carriers replaced.

### F7 — one dataset cannot join any automated deploy chain

`kzk_appeals` (intake) has **no `db:load:*:cloud`** — the crawl *is* the
loader, so publishing means re-running a **headed Playwright** crawl with
`DATABASE_URL` pointed at the proxy (plus `apply_functions.ts
042_kzk_appeals.sql`, which is idempotent). It took ~1 min here (incremental,
33 rows), but it needs a display and Bulgarian egress, so it can never run
unattended in the Phase 5 orchestration. Either it stays a documented manual
tail step, or the intake arm gains a real loader. Phase 5 should say which.

---

## Measured deploy profile (2026-08-07) — second per-step timing

Second full publish, same instrument (external per-step wrapper, unpiped, `$?`
checked per F5), same `db-g1-small`. Two things make it a better data point than
the first: it covers **five steps the 2026-08-05 profile never measured** (`tr`,
`risk-caches`, both NZOK loaders, `prices`), and it deliberately **omits**
`db:load:procurement-scopes:pg:cloud` — turning F1's "entirely duplicate" claim
into an A/B rather than an inference.

Source run: the `/process-watch-report` of 2026-08-06 (ЦАИС ЕОП + TR + macro +
regional + НЗОК + prices), including the one-time stale-base-key sweep.

| # | step | seconds | | vs 2026-08-05 |
|--:|---|--:|---|---|
| 1 | `contracts` | **4045** | 67.4 min | 3878 (+4.3%) |
| 2 | `annexes` | 49 | | 41 |
| 3 | `tenders` | **1135** | 18.9 min | 1049 (+8.2%) |
| 4 | `awarder-seats` | **740** | 12.3 min | 776 (−4.6%) |
| 5 | `transport-project-map` | 224 | 3.7 min | 247 |
| 6 | `water-operator-map` | 4 | | 4 |
| 7 | `mvr-directorate-map` | 16 | | 17 |
| 8 | `tr` | **2092** | 34.9 min | *not measured* |
| 9 | `persons-browse` | 344 | 5.7 min | 362 |
| 10 | `person-search` | 417 | 7.0 min | 421 |
| 11 | `graph` | 177 | 3.0 min | 167 |
| 12 | `tr-company-place` | 78 | 1.3 min | 61 |
| 13 | `risk-caches` | **752** | 12.5 min | *not measured* |
| 14 | `nzok-hospital` | 40 | | *not measured* |
| 15 | `nzok-hospital-map` | 5 | | *not measured* |
| 16 | `prices` | **5744** | 95.7 min | *not measured* |
| | **total** | **15862** | **264.4 min (4.4 h)** | |

The eleven steps present in both profiles reproduce well enough to trust the
instrument. The four that dominate — `contracts`, `tenders`, `awarder-seats`,
`person-search` — agree within **±9%**. The small steps swing more in percentage
terms (`annexes` 41→49 s, `tr-company-place` 61→78 s, `transport-project-map`
247→224 s) but by **at most 23 s each**, which is noise at this scale. So the
2026-08-05 numbers were not a one-off, and percentage comparisons on sub-100 s
steps should not be read as signal.

**Verified afterwards** — local and cloud agree on every count and sum:
`contracts` 408,560 (405,072 `contract` + 3,488 `contractAmendment`),
`procurement_annexes` 24,098 rows / 18,592 keys, `tenders` 237,080,
`tr_companies` 1,020,573, `company_politicians` 521, НЗОК latest bmp 2026-06 with
392 facilities / €1,133,079,162, and all six scoped matviews populated. The only
difference anywhere was **€0.01** on the contracts euro sum (`…864.51` local vs
`…864.50` cloud) — `double precision` accumulation order, not a data difference.
Worth pinning: any Phase 3 verifier that compares money with `=` rather than a
cent tolerance will fail on this permanently.

### F8 — F1 is structural across THREE loaders, not one duplicate step

F1 named `db:load:procurement-scopes:pg` as "entirely duplicate" (945 s). This run
skipped that step entirely and **still** refreshed every scoped matview at least
twice, because the refresh is embedded in the loaders themselves:

| loader | log line | refreshes |
|---|---|---|
| `db:load:pg` | `scoped precomputes: refreshing 6/6` | all six |
| `db:load:awarder-seats:pg` | `refreshing 4/4 (changed: awarder_seats)` | 4 of the 6, ~40 min after contracts did them |
| `db:load:tr:pg` | `refreshing 3/3 (changed: company_politicians, tr_companies)` | `contractor_rank`, `contractor_scope_kpis`, `procurement_payloads` |

Per-matview refresh count in ONE deploy: `procurement_payloads` **3×**; the other
five **2×** each. Had `procurement-scopes` also run, all six would have been 3×.

Cost, from `pg_stat_activity` sampling at 30 s (longest observed run of each):

| matview | one refresh |
|---|--:|
| `procurement_payloads` | 258 s |
| `procurement_settlement_payloads` | 146 s |
| `procurement_settlement_rank` | 126 s |
| `procurement_geo_payloads` | 126 s |
| `contractor_rank` | 198 s |

The duplicate 4/4 inside `awarder-seats` is **656 s of that step's 740 s — 89%**.
Adding the 945 s `procurement-scopes` pass the first profile paid, the removable
duplicate in a full deploy is **~1,600 s ≈ 27 min**, not the 945 s F1 estimated.

This also **retires the standalone step**: the post-deploy verification confirmed
all six matviews correct on cloud without it. `db:load:procurement-scopes:pg:cloud`
is redundant whenever `contracts` + `awarder-seats` have run — the refresh ledger
F1 proposes should be built, but the cheaper first move is to stop calling the
standalone loader in the publish chain at all.

### F9 — RC4 is confirmed by direct measurement: readers get 55P03, not slowness

RC4 was inferred. Measured here, mid-`tenders`, from a second connection:

```
READ-BLOCKED 4991ms  code=55P03  canceling statement due to lock timeout
  LOCK tenders AccessExclusiveLock granted=true
  LOCK tenders ShareLock          granted=true
  LOCK tenders RowExclusiveLock   granted=true
```

A plain `SELECT count(*) FROM tenders` is **rejected**, not delayed. The sampler
saw a **single `COPY tenders` statement running 651 s** (10.9 min) — one
uninterrupted AccessExclusive window inside an 18.9-min step. So the availability
cost of RC4 is not "slow queries during the load": every route touching `tenders`
returns an error for ~11 minutes. That raises Phase 4's priority — it is a
correctness-of-service bug, and `55P03` is exactly the SQLSTATE CLAUDE.md tells
route authors to degrade on, so a route that *doesn't* degrade returns 500.

### F10 — RC6 is mischaracterised: there is no missing-view window

RC6 says every tenders load leaves "a window where the contracts browser has no
view to read". Measured: a 5 s probe of `to_regclass('public.appealed_ocids')` and
`contracts_list` across the **entire** tenders step — **167 samples, zero absent**.

That is not luck, and not a sampling artefact. `042_kzk_appeals.sql` **is** applied
unconditionally on every tenders load (`exec(readFileSync(KZK_FILE))`,
`load_tenders_pg.ts:179`, no `applyIfChanged` guard), and it does contain the
`DROP MATERIALIZED VIEW IF EXISTS appealed_ocids CASCADE`. But `exec()` sends the
file as ONE string, and its own sibling comment in `lib/pg.ts` states the
mechanism: *"the simple query protocol wraps a multi-statement string in a SINGLE
implicit transaction — so every lock is held until the last statement commits."*
042 carries no explicit `BEGIN`/`COMMIT`. The `DROP … CASCADE` and the
`rebuild_contracts_list()` ~30 lines later therefore **commit atomically**: under
MVCC a concurrent reader sees the old view until commit, then the new one. It can
never see neither.

So RC6 is **not a second, independent availability defect**. It is the same
defect as RC4 — a lock wait on the same command — and the fix is the same fix.
Correct the claim before Phase 4 is scoped against it, or the plan will budget
work for a failure mode that does not exist.

(The transactional argument is what settles this; the 167 clean probes are
consistent with it but could not, alone, exclude a sub-5 s window.)

### F11 — TR costs 1.87× what the plan assumes

G21/7b sizes the TR delta-ship against "~18.6 min load". First actual
measurement of `db:load:tr:pg:cloud`: **2092 s = 34.9 min**. Roughly half is its
own work (`COPY tr_person_roles` 171 s, `tr_companies` 95 s, `tr_officers` 93 s,
`company_person_roles` 90 s, the K-Index 72 s, index builds ~46 s) and roughly
half is the duplicate scoped-precompute refresh from F8. Phase 7b's win estimate
should be re-based on 2092 s, and F8 removes part of it for free.

### F12 — `contracts` in PG is NOT row-identical to the shards, by design (blocking for Phase 3 / G3 / G20)

The corpus has a fifth key namespace that exists **only in Postgres**. Measured:

| basis | rows | EUR |
|---|--:|--:|
| `index.json` `totals.contracts` | 402,414 | — |
| shard rows on disk (`contract` + `contractAmendment`) | 405,902 | — |
| PG `count(*)` | 408,560 | — |
| PG `tag='contract'` | 405,072 | 93,387,402,864.51 |
| shard `index.totals.totalEur` | — | 93,387,402,864.50 |
| PG `tag='contract'` **excluding** `obed-` | 402,414 | 87,257,118,672.95 |

The anti-join of PG against every shard key is exactly **2,658 rows, and all of
them are `obed-`** (non-`obed` anti-join: **0**). They are minted by
`087_procurement_consortium.sql`'s `rebuild_consortium()`: for a joint
ДЗЗД/обединение award it moves the full value onto ONE carrier row — a synthetic
`obed-<hash>` entity keyed by the sorted member-EIK set when the source names no
ДЗЗД — and **zeroes the member rows**. The operation is value-neutral, which is
why the money still reconciles to the cent while the row count is +2,658.

Three consequences the plan must absorb:

1. **G3's row hash cannot be taken over shards and compared to PG after load.**
   2,658 PG rows have no shard counterpart, and 087 *mutates* `amount_eur` on
   real member rows post-COPY. The digest must be captured before
   `rebuild_consortium()`, or over a basis that models the carrier split.
2. **G20's no-shrink / anti-join DELETE must whitelist `obed-`.** A mirror that
   deletes "rows cloud has and local doesn't" would delete every carrier and
   silently move €6.13 bn onto rows that 087 has zeroed — a corpus that still
   passes a `count(*)` sanity check while under-reporting by 6.6%.
3. **The obvious normalisation is the wrong one.** "Filter out the synthetic rows
   to compare like-for-like" yields €87.26 bn — **€6.13 bn short** — because the
   members whose value was moved are still zero. The only safe comparisons are
   whole-table `SUM(amount_eur)` with no key filter, or a row count that
   explicitly expects `+N` carriers.

### F13 — two large steps are absent from the plan's cost model

`db:refresh:risk:cloud` (**752 s**) and `prices:ingest:cloud` (**5744 s**) appear
in neither the 2026-08-05 profile nor any phase estimate, yet together they are
**41% of this deploy**. Neither is optional: the risk caches must follow any TR
load (CLAUDE.md's `mpConnected` parity note), and prices is a daily publish.

`prices` deserves its own line in Phase 3's thinking because it is the one step
whose cost is genuinely proportional to shipped volume — two days of ~1.4 M store
rows each. Per-day cloud phases: `COPY price_stage` 226 s, `UPDATE price_facts
SET valid_to` 138 s, `INSERT price_facts` 108 s, `INSERT price_grid_days` 75 s,
`CREATE TEMP TABLE obs` 68 s, `INSERT price_current` 42 s — ~11 min/day against
~2 min/day locally. The tail is the rebuild: `product-days` runs 13 batches at up
to 172 s each (~26 min), then the payload build scans `price_chain_grid_days` in
a single 356 s+ query. So prices is ~40% transfer, ~60% recompute — the same
split as the procurement half, and the same Phase 2 vs Phase 3 question.

### F14 — the success criterion is 9× away, and measures a subset

The stated criterion is the three procurement commands + three crosswalk maps +
`db:load:tr:pg:cloud` under **15 minutes**. Those eight steps in this run:
4045 + 49 + 1135 + 740 + 224 + 4 + 16 + 2092 = **8305 s = 138.4 min**, i.e. a
**9.2× reduction** is required. Worth stating plainly next to the criterion, and
worth noting that the criterion covers 52% of the measured deploy — the person
chain, risk caches, NZOK and prices are all outside it.

---

## Measured deploy profile (2026-08-09) — the first COMPLETE publish, 5 h 13 m

Second per-step profile, same method as 2026-08-05 (external wrapper, chain
granular, halts on first non-zero exit). Three differences from that run:

- it is the **complete** publish for a `/process-watch-report` day — it adds
  `db:refresh:risk:cloud` and `prices:ingest:cloud`, the steps F13 flagged as
  missing from the cost model;
- it **omits** `db:load:procurement-scopes:pg:cloud` on F8's recommendation
  (verified safe — see F20);
- `db:load:funds:pg:cloud` is absent (no ИСУН change that day).

Ingest published: ЦАИС ЕОП +209 contracts / 106 buyers, councils +68
resolutions, macro, policy baseline, ИИСДА services, prices ×2 days.
`db-g1-small`, proxy on `127.0.0.1:5434`, no competing load on the machine.

| # | step | seconds | | vs 2026-08-05 |
|--:|---|--:|---|---|
| 1 | `contracts` | **5005** | 83.4 min | 3878 → **+29%** |
| 2 | `annexes` | 61 | | 41 → +49% |
| 3 | `tenders` | **1168** | 19.5 min | 1049 → +11% |
| 4 | `awarder-seats` | **933** | 15.6 min | 776 → +20% |
| 5 | `tr` | **2886** | 48.1 min | 2092 (F11) → **+38%** |
| 6 | `transport-project` | 217 | | 247 → −12% |
| 7 | `water-operator` | 4 | | 4 → = |
| 8 | `mvr-directorate` | 16 | | 17 → = |
| 9 | `admin-services` | 6 | | not in that run |
| 10 | `persons-browse` | 137 | | 362 → **−62%** |
| 11 | `person-search` | 505 | 8.4 min | 421 → +20% |
| 12 | `graph` | 201 | | 167 → +20% |
| 13 | `tr-company-place` | 78 | | 61 → +28% |
| 14 | `risk` | **1005** | 16.8 min | **never measured** |
| 15 | `prices` | **6546** | 109.1 min | **never measured** |
| | **total** | **18768** | **5 h 13 m** | |

The GCS half the same day, scoped to 12 paths: **180 s** for ~82 objects. F3
holds — the bucket is not the problem, and is now 1.0% of the publish.

Verified afterwards, cloud vs local: `contracts` 408,759 = 408,759 (latest
2026-08-08 both), `tenders` 237,243, `tr_companies` 1,020,707, `admin_services`
2,672, `price_grid_days` max 2026-08-08, `contract_risk_cache` 408,759.
`/api/db/procurement-overview` 200 in 1.03 s, `/api/db/price-payload` 200 in
0.69 s.

One caveat on the verification recipe: `SUM(amount_eur)` came back
€99,492,258,005.**63** on cloud and €99,492,258,005.**64** local. That is float
summation order on a `double precision` column, not a data difference — so the
2026-08-05 note "cloud = local **to the cent**" is not a reliable gate. Compare
`round(sum(...)::numeric, 2)` with a ±0.01 tolerance, or sum in `numeric`.

### F15 — `prices` is the second-largest step in the deploy and was never in the cost model

6546 s is **34.9% of the whole publish** — larger than `tr`, second only to
`contracts`. F13 named two absent steps; this is a third, and the biggest.

It is absent because it does not look like a loader. Prices publish by
**re-running the entire ingest against the cloud URL** (`prices:ingest:cloud` =
`DATABASE_URL=<proxy> npm run prices`) — the same "the ingest IS the loader"
shape as `agri:ingest` and the КЗК crawl, and the same class G17 flags. So the
full pipeline runs twice, once per database: 2 days × ~1.5M store rows of SCD-2
delta, the 116,622-product catalogue rebuild, the 653,660-row `product_days`
build, 753 payload blobs and the slug export.

Local cost of the identical work the same morning: **~600 s**. Cloud: 6546 s —
**10.9×**. Nothing in it is delta-aware or ship-aware.

Two cheap observations before any Phase-3 work:

- the 753 payload blobs total **2.6 MB** and are pure derived output computed
  identically on both sides — the Phase-2 ship-don't-compute pattern applies
  directly, and 2.6 MB is nothing to transfer;
- `product_days` (653,660 rows) is likewise recomputed rather than shipped.

### F16 — `db:refresh:risk` duplicates `db:load:pg`, and only the chain ORDER makes it necessary

`load_pg.ts:527,531` runs `REFRESH MATERIALIZED VIEW
procurement_risk_indexes_cache` then `SELECT rebuild_contract_risk_cache()`.
`refresh_risk.ts:28,39` runs exactly those two statements again.

`db:load:pg` emits **no log line for either** — it only logs `risk-grade scoped:
N scopes precomputed`, which is the unrelated `awarder_risk_grade_scoped`. That
is why the duplication is invisible in a transcript. It was found here only by
catching `SELECT rebuild_contract_risk_cache()` in `pg_stat_activity`, 11 minutes
into step 1.

In THIS chain the second rebuild was **not** waste: `tr` ran at step 5, after
contracts, and `db:load:tr:pg` rebuilds `company_politicians`, which the
`mpConnected` bit of `contract_risk_cache` reads (CLAUDE.md documents this from
the other side). Step 1's rebuild was therefore stale by step 14.

But that is an artifact of the ORDER, not a real dependency:

> **Run `tr` BEFORE `contracts` and `db:refresh:risk:cloud` becomes redundant.**
> `db:load:pg`'s internal rebuild then sees fresh `company_politicians` and fresh
> `contracts` in a single pass. Free saving: **1005 s ≈ 16.8 min**, no code
> change, same guarantees.

Cross-check before adopting: `db:load:tr:pg` also refreshes matviews 122 and 124,
which read `contracts`, so running it first refreshes them against the previous
corpus — but step 1 then refreshes all six again (`scoped precomputes: refreshed
6/6`, observed), so the end state is identical. The cost is one extra 3/3 refresh
inside `tr`, which is already being paid today.

### F17 — four steps are 82% of the publish

`contracts` 5005 + `prices` 6546 + `tr` 2886 + `risk` 1005 = **15,442 s of
18,768 = 82.3%**. The other eleven steps together are 3,326 s (17.7%), and six of
them are under 220 s.

This re-frames the plan's target. Phases 2/3 are aimed almost entirely at the
procurement corpus; on this profile the same effort spent on `prices` (F15) and
the ordering fix (F16) is worth **7,551 s ≈ 2 h 6 m**, versus F1/F8's ~1,600 s.

It also means the F14 success criterion covers **42%** of this deploy, down from
52% — the criterion's denominator keeps shrinking as more of the real publish
gets measured.

### F18 — the client is idle; the cost is entirely server-side dependent recompute

During the 5005 s `contracts` step the local Node process accumulated **9.3 s of
CPU** (`ps -o time=`) while holding one ESTABLISHED socket to the proxy. Over
83 minutes that is 0.19% duty cycle: the client is waiting, not working.

Sampling `pg_stat_activity` through the step showed why — a single
`SELECT rebuild_contract_risk_cache()` held **11+ minutes** on its own, and the
six scoped-matview refreshes ran serially after it.

This is direct evidence for F2's "cost is decoupled from data volume": the step
shipped **406,097 rows to change 199** (`batch 865: 199 new`) and spent its time
on dependent recompute, not transfer. Any plan that optimises transfer alone
cannot touch the majority of this step.

Corollary for Phase 0: in-loader instrumentation should time **server-side
statements**, not client wall-clock per phase — the wall-clock is already known
to be ~100% server.

### F19 — the deploy's own connect timeout needs raising, and 15 s is not enough

A cold `psql`/node-pg connect to the proxy **timed out at
`PGCONNECT_TIMEOUT=15`** and succeeded at 60 s, repeatedly, on an idle instance
before the deploy started. The proxy had been up since 29 Jul; the port accepted
TCP immediately (`nc -z` succeeded), so a port check is not a readiness check.

Relevant to Phase 5 orchestration and to F5 (no 1-hour cap): any automated deploy
wrapper that pre-flights the connection must use a ≥60 s connect timeout and must
probe with a real query, or it will fail closed against a healthy database.

### F20 — F8 re-confirmed live, and dropping `procurement-scopes` is verified safe

Two independent confirmations in this run:

- `db:load:pg:cloud` logged `scoped precomputes: refreshed 6/6` (step 1) and
  `db:load:awarder-seats:pg:cloud` logged `refreshed 4/4 (changed:
  awarder_seats)` (step 4) — the same duplicate F8 describes, reproduced.
- `db:load:procurement-scopes:pg:cloud` was **omitted entirely**, and afterwards
  all six matviews were `ispopulated = true` with sane cardinality on cloud:
  `contractor_rank` 431,327 · `procurement_settlement_payloads` 26,130 ·
  `procurement_settlement_rank` 10,242 · `procurement_payloads` 180 ·
  `procurement_geo_payloads` 30 · `contractor_scope_kpis` 29.

So F8's "free ~945 s" is now measured as taken, not proposed: this deploy did not
pay it and lost nothing. **Remove `db:load:procurement-scopes:pg:cloud` from the
documented publish chain** (it remains correct standalone, e.g. for the January
calendar rollover, which is its real trigger).

### F21 — TR is now a SECOND instance of RC4, created 2026-08-10, and Phase 4 must cover it

Measured while fixing an unrelated defect in the same loader
([tr-loader-cascade-v1](tr-loader-cascade-v1.md): `003_tr_search.sql`'s
`DROP TABLE … CASCADE` was silently deleting three matviews owned by other
migrations on every run). Removing the DROP forced the loader to replace each
table's CONTENTS instead — `TRUNCATE` inside the COPY's transaction — which is
exactly the shape RC4 describes. **The availability profile got worse, and this
plan's cost model needs to know.**

**The old profile was not what it looks like, and F10's own mechanism is why.**
`load_tr_pg.ts` applies 003 with `exec()`, which sends the file as one string, and
the simple query protocol wraps that in a SINGLE implicit transaction (`lib/pg.ts`
says so; 003 carried no explicit `BEGIN`/`COMMIT`). So the `DROP TABLE … CASCADE`
and the `CREATE TABLE` beneath it **committed atomically** — under MVCC no reader
could observe the tables absent, precisely as F10 established for 042. The
AccessExclusive window was the DDL apply alone (sub-second). The four COPYs then
ran in their own later transactions holding only `RowExclusiveLock`, which does
**not** conflict with `AccessShare`.

So under the old scheme readers were **never blocked** during the ~100 s COPY
phase. They read an EMPTY, then progressively filling, table: a **200 with zero
rows**. Search returned "no such company" for a minute and a half, confidently.

**The new profile, measured on a live local `db:load:tr:pg`.** A second connection
probing all three tables at `lock_timeout = 2000ms`, 180 probes across the load:

```
tr_companies      21 / 60 rejected 55P03      tr_officers  16 / 60 rejected
tr_person_roles   13 / 60 rejected 55P03      (50 / 180 total, 28%)
each blocked probe burned the full timeout: 2125-2359 ms
```

Rejected, not delayed — the same finding F9 made for `tenders`, on the same
`55P03`, for the same reason. **28% is a local figure and understates cloud
badly:** F11 measured `db:load:tr:pg:cloud` at **2092 s (34.9 min)** against
112 s locally, and the blocking window is the COPY, so it scales with it.

This trade was made deliberately and is still the right way round — an error a
route can degrade on beats a silently-empty search result, and `55P03` is already
in the documented degrade set. But it converts TR from "wrong answer, no error"
to "no answer, correct error", and only Phase 4 removes the choice.

**Phase 4's pattern does not drop in, and this is the blocker.** Of the four
tables, only two can be stage-merged as written:

| table | rows | key | stage-mergeable |
|---|---|---|---|
| `tr_companies` | 1,020,707 | `uic` PK | yes |
| `ngo_details` | 12,282 | `uic` PK | yes |
| `tr_officers` | 793,949 | deduped to `(uic, name)` by the loader's `GROUP BY`, but **no unique index** | needs one added |
| `tr_person_roles` | 1,244,715 | none — genuinely one row per company × role | **no key exists** |

`lib/stage_merge.ts` requires unique keys for its `ON CONFLICT` upsert and
anti-join delete. `tr_person_roles` has no natural one (the same person can hold
the same role at the same company across separate date ranges), so it needs either
a synthetic key or a different shape — most likely delete-and-reinsert scoped to
the `uic`s the delta touches, which is a per-company `RowExclusiveLock` rather
than a whole-table `AccessExclusive`. Budget this as design work, not as a copy of
the `contracts` fix.

**One operational hazard, observed rather than predicted.** An interrupted TR load
now leaves the tables **populated but missing all 11 secondary indexes** — the
loader drops them up front so each is built once over the finished table. Observed
when this measurement's own loader was killed mid-run: concurrent person queries
that join `tr_officers.name_fold` (`money_eik`, the resolver's Tier-V money basis)
went from sub-second to **>10 minutes**, and the next load's `TRUNCATE` then queued
behind them — at which point every reader of all three tables queued behind the
`TRUNCATE`, because a pending `AccessExclusive` blocks later `AccessShare`. One
killed loader took the whole TR surface down until it was cleared.

Under the old scheme the same interruption left an empty-but-indexed table, which
is a different failure and a quieter one. Recovery needs **no reload**: the data
commits per table, so recreating the 11 indexes from `LOAD_INDEXES` in
`load_tr_pg.ts` is sufficient (verified — row counts were already complete and
correct). Worth stating here because a cloud TR load is 35 minutes long and
therefore the single most likely step in the publish to be interrupted, and
because the resulting state — a fully-populated, unindexed, 1M-row table on prod —
looks healthy to every row-count check in this document.

---

## Measured deploy profile (2026-08-12) — a PARTIAL publish, 2 h 12 m

Third per-step profile, same method (external wrapper, chain-granular, halts on
first non-zero exit). **This is not a complete publish and must not be compared
to the 5 h 13 m headline.** Only two upstreams moved that day, so the chain is
the procurement + open-calls subset: `tr`, `prices`, `agri`, `funds`,
`admin-services` and the three crosswalk maps are all absent because nothing
changed in them. Three further steps were deliberately dropped — see F23.

Ingest published: ЦАИС ЕОП +142 contracts / 85 buyers (already on disk from
b95995eb05), tenders re-index, ИСУН open calls +1. `db-g1-small`, proxy on
`127.0.0.1:5434`, no competing load.

(F-numbers are discovery-ordered, not position-ordered: F22-F23 are the
2026-08-11 person-chain findings and live under `## Operational notes` below.)

| # | step | seconds | | vs 2026-08-09 |
|--:|---|--:|---|---|
| 1 | `gcs` (4 paths, 581 objects) | 55 | | 180 (12 paths) |
| 2 | `open-calls` | 8 | | not in that run |
| 3 | `contracts` | **4982** | 83.0 min | 5005 → −0.5% |
| 4 | `annexes` | 137 | | 61 → **+125%** |
| 5 | `tenders` | **1182** | 19.7 min | 1168 → +1% |
| 6 | `persons-browse` | **640** | 10.7 min | 137 → **+367%** |
| 7 | `person-search` | **555** | 9.3 min | 505 → +10% |
| 8 | `graph` | 195 | | 201 → −3% |
| 9 | `tr-company-place` | 171 | | 78 → **+119%** |
| | **total** | **7925** | **2 h 12 m** | |

Verified afterwards, cloud vs local, all equal: `contracts` 405,479 /
€93,585,357,225.34 (tag='contract') / latest 2026-08-11 · `tenders` 237,386 ·
`procurement_annexes` 24,152 · `open_calls` 73 · `person_browse_table` 135,708 ·
`person_search` 581,246 · `company_public_money` 81,373 · `tr_company_place`
324,039 / 10,202 with a person link. Live: `/api/db/procurement-overview` 200 in
0.97 s, `/api/db/open-calls` 200 in 0.61 s, `/api/db/contractor-scope-kpis` 200
in 0.59 s.

The €-parity used `round((sum(amount_eur) filter (...))::numeric, 2)` per the
2026-08-09 caveat, and matched exactly — confirming that recipe works where the
raw `double precision` comparison did not.

### F24 — 83 minutes to ship 135 rows: the sharpest instance of F2 yet

`contracts` moved **135 rows (0.033% of 405,479)** and **€24.3 m of €93.6 bn
(0.026%)**, and cost **4982 s — 99.5% of the 5005 s the 2026-08-09 run paid to
ship 209 rows**. A 35% smaller delta bought a 0.5% saving.

F2 already states cost is decoupled from volume. This run pins the constant: the
step is ~83 min *regardless*, so the marginal cost of a row is indistinguishable
from zero and the fixed cost is the entire bill. Any phase that reduces
`contracts` must attack the fixed work (RC2 re-ship, RC3 recompute), because
there is no volume-proportional component left to optimise.

The same holds for `tenders`: 65 procedures changed (0.027%), 1182 s vs 1168 s.

### F25 — `awarder-seats` is a SECOND removable step, and this run verifies it

F20 established that `db:load:procurement-scopes:pg:cloud` can be dropped. This
run dropped **both** it and `db:load:awarder-seats:pg:cloud`, and afterwards all
six scoped matviews were `ispopulated = true` with cardinality **identical to
local**:

| matview | cloud | local |
|---|--:|--:|
| `contractor_rank` | 431,432 | 431,432 |
| `procurement_settlement_payloads` | 26,130 | 26,130 |
| `procurement_settlement_rank` | 10,242 | 10,242 |
| `procurement_payloads` | 180 | 180 |
| `procurement_geo_payloads` | 30 | 30 |
| `contractor_scope_kpis` | 29 | 29 |

Combined saving against the 2026-08-09 chain: **933 s + the 945 s F1 measured for
`procurement-scopes` ≈ 31 min**, taken rather than proposed.

⚠️ **State the condition, because it is not unconditional.** `awarder_seats` was
already byte-equal on both sides (3,864 = 3,864), so skipping it shipped nothing.
It remains that table's ONLY loader, so a run where a new buyer appears must
still call it. What is unconditionally duplicate is its *matview refresh* half —
F8's measured 656 s of its 740 s. The correct fix is still the refresh ledger F1
proposes; dropping the step is the cheap interim move, and it needs a guard that
notices when `awarder_seats` itself has changed.

### F26 — step timings are not reproducible, and the cost model rests on single measurements

F22 already flags this for one step ("a single datapoint on this step is worth
±20%", from the resolve's 1733 s cold / 1332 s warm spread). Pooling every
profile shows it is general, and much wider than ±20% on the smaller steps —
including the 2026-08-11 person-chain run, which independently timed three of
these:

| step | 08-05 | 08-09 | 08-11 | 08-12 | spread |
|---|--:|--:|--:|--:|--:|
| `persons-browse` | 362 | 137 | 461 | 640 | **4.7×** |
| `annexes` | 41 | 61 | — | 137 | **3.3×** |
| `tr-company-place` | 61 | 78 | — | 171 | **2.8×** |
| `tr` | 2092 | 2886 | — | — | 1.4× |
| `contracts` | 3878 | 5005 | — | 4982 | 1.3× |
| `person-search` | 421 | 505 | 481 | 555 | 1.3× |
| `graph` | 167 | 201 | 249 | 195 | 1.5× |
| `tenders` | 1049 | 1168 | — | 1182 | 1.1× |

`persons-browse` swung 4.7× while its output moved by **2 rows** (135,706 →
135,708). The obvious culprit was ruled out by direct measurement: every table it
reads had a **100%-complete visibility map** on cloud at the time
(`contracts` 85,045/85,045 pages, `tenders` 42,085/42,085, `agri_subsidies`
94,668/94,680, `tr_officers`, `declaration`, `person_role`, `fund_projects` all
100%) — so `vacuumAfterReload` is working on the cloud side and this is not the
`relallvisible = 0` regression documented in CLAUDE.md.

The remaining explanation is instance-level: `db-g1-small` is shared-core with
burst credits, and this chain ran `persons-browse` immediately behind a
`TRUNCATE`+COPY+VACUUM of `tenders`, where the 08-09 chain had four small steps
between them. Not established — stated as the leading hypothesis.

**Consequence for the plan:** the large steps (`contracts`, `tenders`) are stable
to ~±1% and their targets are safe. The small-and-medium steps are not, so
savings estimates built on a single sample of them (F8's 656 s, F16's 1005 s)
should carry a ±2-3× band until re-measured. Phase 0's instrumentation should
record per-step timings on **every** run, not per profiling exercise, so the
distribution is available rather than three points.

### F27 — a procurement-only publish cannot bring `/connections` to parity

`db:load:graph:pg:cloud` succeeded, and the graph still came out behind local:

| table | local | cloud | gap |
|---|--:|--:|--:|
| `person` | 132,543 | 132,541 | −2 |
| `person_role` | 321,229 | 321,225 | −4 |
| `company_politicians` | 522 | 522 | = |
| `graph_company_node` | 87,029 | 87,027 | **−2** |
| `graph_edge` | 199,681 | 199,677 | **−4** |

The deficit maps 1:1 onto the person layer — 2 missing people → 2 missing company
nodes, 4 missing roles → 4 missing edges. The loader is correct; it reproduced
cloud's `person_role` faithfully. **A graph reload cannot close a gap that lives
upstream of it.**

F22 already prices the person chain (4251 s / 70.8 min, resolve 1733 s), so the
cost is on record. What this run adds is the **coupling**: `graph` appears in
both chains, and running it from the procurement side reaches only the freshness
the person side last established. A procurement publish therefore ships
`/connections` company *money* correctly (`company_public_money` hit parity at
81,373) while leaving its *node and edge set* at the person layer's vintage.

So `graph`'s ~200 s in this profile buys strictly less than the same step buys at
the end of F22's chain, and the two are not interchangeable. When scheduling
against the phase targets, a run that touches only procurement should be costed
as **not closing `/connections`** rather than as closing it for 200 s — and if
parity there matters on a given day, the 70.8 min person chain is the real
prerequisite, not the graph loader.

The gap this run left is 2 people / 4 edges, which is not worth a 70-minute chain
on its own; it rides the next `update-persons`.

### One observation, attribution unestablished

`tender_search_text` was **1,861 rows on cloud** afterwards, equal to local.
CLAUDE.md states (as of this same date) that the dossier family is local-only and
has never reached a serving database. The `tenders` loader logged nothing about
the index, and the table was **not** baselined on cloud before the run — so
whether this publish populated it, or it was already there, is not established.
Worth resolving before either the CLAUDE.md note or the search-arm deploy
ordering in it is relied upon.

---

## Root causes

### RC1 — Five caches are built twice per load, the first time against stale data

`025_procurement_overview.sql`, `030_procurement_by_settlement.sql`,
`031_procurement_rankings.sql` and `033_procurement_risk_indexes.sql` each contain:

```sql
DROP MATERIALIZED VIEW IF EXISTS procurement_overview_cache;   -- unconditional
...
CREATE MATERIALIZED VIEW IF NOT EXISTS procurement_overview_cache AS
  SELECT procurement_overview(NULL, NULL) AS r;                -- no WITH NO DATA
```

These run in the schema-apply block at [`load_pg.ts:276-287`](../../scripts/db/load_pg.ts) —
**before** `readShards()` and before the merge. So:

1. The `DROP` removes a populated cache.
2. The `CREATE` (no `WITH NO DATA`) immediately builds a full-corpus aggregate
   **against the previous corpus** — 100% throwaway work.
3. `REFRESH MATERIALIZED VIEW` at [`load_pg.ts:543-549`](../../scripts/db/load_pg.ts)
   builds the same aggregate again, correctly.

This is exactly the pattern that cost ~40 of the original 68 minutes on normalcy.
`077_dual_corpus_rankings.sql` already gets it right (`WITH NO DATA`) and is the
model to copy. The `IF NOT EXISTS` on the `CREATE` is dead code — the preceding
`DROP` is unconditional.

**The tenders side has the same defect** (found in audit, see G5):
`044_procurement_ai.sql:140,215` DROP+CREATEs `kzk_appeals_summary_cache` with no
`WITH NO DATA`, and [`load_tenders_pg.ts:243`](../../scripts/db/load_tenders_pg.ts)
REFRESHes it — built twice. `042_kzk_appeals.sql:142,152` DROP+CREATEs
`appealed_ocids` and `upheld_ocids` (built once, but see RC6).

Secondary cost: **~40 sequential DDL round-trips** over the Cloud SQL proxy per
contracts load, essentially all of them no-ops on an unchanged schema.

### RC2 — The full corpus is re-shipped every run regardless of churn

`load_pg.ts` COPYs all 403,997 rows into `contracts_stage` then MERGEs;
`load_tenders_pg.ts` TRUNCATEs and COPYs all 232,260 rows. Typical daily churn is
2 and 67 rows respectively. Over 99.98% of the transfer is redundant.

Shard mtimes are **not** a usable churn signal — the ingest rewrites untouched
shards (2013 month files were touched within the last 3 days with no content
change). Any delta scheme must be content-hash based.

### RC3 — Cloud recomputes what local already computed

Beyond the four caches in RC1: `awarder_totals`, `sector_contractor_stats`,
`dual_corpus_rankings_cache`, `awarder_kindex_ranking`,
`awarder_risk_grade_ranking`, `rebuildRiskGradeScoped` (~32 windows: 2011..2026
plus one per election plus `all`), `kzk_appeals_summary_cache`,
`rebuild_consortium()`, `resolve_contract_unp()`, `enrich_contract_lot_names()`.

Every one of these is a deterministic function of tables that `db:refresh` has
already loaded identically on local Docker (dedicated cores) minutes earlier. The
orchestrator's Step 2b runs the local refresh **before** emitting the cloud
loaders, so local is always current at cloud-load time — this precondition is
already relied upon by `buildOrShipNormalcy`.

### RC4 — `tenders` still holds AccessExclusive for its whole COPY

[`load_tenders_pg.ts:174-187`](../../scripts/db/load_tenders_pg.ts) does
`TRUNCATE tenders` + a 564 MB streamed COPY inside **one transaction**. TRUNCATE
takes `AccessExclusiveLock` held until COMMIT, so every read of `tenders` blocks
for the entire multi-minute COPY, hits the serving pool's 10s `statement_timeout`,
and the tender routes return `db error` (Postgres 57014).

This is the identical bug fixed for `contracts` in `46cecf77` (staging merge) and
documented in [[reference_contracts_reload_lock]] — `tenders` never got the fix,
and has since doubled in size. **This is a live serving bug, not just a speed
problem.**

**Confirmed by measurement 2026-08-07 (F9), with one correction to the SQLSTATE.**
A concurrent `SELECT count(*) FROM tenders` mid-load was **rejected with `55P03`**
(lock_timeout) while `pg_locks` showed `AccessExclusiveLock granted=true` on
`tenders`; the sampler caught a single `COPY tenders` statement running **651 s**.
So the blocking window is ~11 min of an 18.9-min step, and the error a route sees
depends on which timeout trips first — `55P03` when `lock_timeout` is set (as the
loaders set it), `57014` when only `statement_timeout` is. Any degrade-set that
lists one and not the other will still 500. Not inferred any more.

**RC4 now has a SECOND instance: `db:load:tr:pg`, as of 2026-08-10 — see F21.**
Fixing 003's `DROP TABLE … CASCADE` (which was silently deleting three other
migrations' matviews) required replacing the tables' contents instead, so TR
acquired the identical `TRUNCATE`-inside-the-COPY shape. Measured: 50 of 180
concurrent probes rejected with `55P03`. At 34.9 min on cloud (F11) it is the
LARGER of the two instances, and unlike `tenders` it cannot simply copy the
`contracts` fix — `tr_person_roles` has no unique key to merge on.

### RC6 — Every tenders load drops the serving view behind `/procurement/contracts`

`042_kzk_appeals.sql:142` is `DROP MATERIALIZED VIEW IF EXISTS appealed_ocids
CASCADE`. Verified on prod: `contracts_list` (relkind `v` — the view the contracts
browser and `/api/db/table` read) depends on `appealed_ocids`, so the CASCADE
drops it. It is recreated ~30 lines later by `SELECT rebuild_contracts_list()`,
but there is a window on **every** tenders cloud load where the contracts browser
has no view to read.

A second, independent availability defect alongside RC4, on the same command.

> **SUPERSEDED 2026-08-07 — see F10. The DROP is real; the missing-view window is
> not.** 042 is applied unconditionally on every tenders load
> (`load_tenders_pg.ts:179`), but via `exec()`, which sends the file as one string
> — and the simple query protocol wraps that in a SINGLE implicit transaction
> (`lib/pg.ts`'s own comment says so; 042 has no explicit `BEGIN`/`COMMIT`). The
> `DROP … CASCADE` and `rebuild_contracts_list()` therefore commit atomically, so
> under MVCC no reader can observe either object absent. Measured: 167 probes at
> 5 s across the whole step, **zero absent**. RC6 is therefore NOT independent of
> RC4 — it is the same lock wait on the same command, and Phase 4 should not
> budget separate work for it.

### RC5 — The instance is the wrong size for the job, and nothing is overlapped

`db-g1-small` is ~0.5 shared vCPU. Every server-side CPU step runs 10-20× slower
than local Docker. The three loads also run strictly serially even though
`awarder-seats` is fully independent.

---

## Target architecture

> **Cloud SQL is a replica, not a compute engine.**

Local Docker Postgres computes the final state of every procurement table —
merge, consortium attribution, unp resolution, lot-name enrichment, and all
derived caches. The cloud step becomes a **content-hash delta sync of
final-state tables**: ship the rows that actually differ, ship the ~7 MB of
derived caches, run nothing expensive server-side.

This is not a new idea in this codebase; it is the `buildOrShipNormalcy` pattern
applied consistently instead of once per emergency.

Two invariants make it safe, both already true:

- **Local is current before the cloud load.** All ingest runs locally via
  `process-watch-report` (operator rule, confirmed against Step 8); the cloud
  loaders are emitted as Next-steps. Verified empirically: `contracts`, `tenders`,
  `awarder_seats`, `kzk_appeals` and `transport_project_link` are row-identical
  local↔cloud today. **But this must be asserted, not assumed** — see G16/G20 for
  the required pre-flight guards, and G17 for the six paths that still write to
  cloud directly.
- **The serving layer never writes.** `functions/db_routes.js` and
  `functions/index.js` contain no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` against
  these tables (verified). Cloud has no independent state to preserve.

---

## Phases

Phases are ordered by (confidence × win) ÷ effort. Phase 0 gates the rest: the
per-phase win estimates below are **inferences from structure**, not measurements,
and Phase 0 exists to replace them with numbers before the expensive phases are
built.

---

### Phase 0 — Instrument the loaders (prerequisite, ~1h)

**Problem.** There is no per-phase timing anywhere. `load_pg.ts` logs one total at
exit; `load_tenders_pg.ts` the same. Every claim in this document about *where*
the hour goes is inference.

**Change.** Add `scripts/db/lib/step.ts`:

```ts
// Label + time one load phase. Logs "  [ 12.3s] refresh procurement_overview_cache"
// and accumulates a summary table printed at exit, so a cloud load produces a
// profile instead of a single wall-clock number.
export const step = async <T>(label: string, fn: () => Promise<T>): Promise<T>
export const stepSummary = (): string
```

Wrap every `exec(...)`, `REFRESH`, COPY, MERGE and helper call in `load_pg.ts`,
`load_tenders_pg.ts` and `load_awarder_seats_pg.ts`. Print `stepSummary()` sorted
descending by duration in the success path.

**Verification.** One local `db:refresh` (fast) confirms the labels are complete
and the total reconciles. Then **one instrumented cloud run** produces the
baseline profile. Everything after this is decided against that profile.

**Deliverable.** A phase profile committed to this document as "Measured
baseline, instrumented".

**Risk.** None — logging only.

---

### Phase 1 — Stop the double-build and the no-op DDL storm (free; do with Phase 0)

Two independent fixes, both zero-risk.

#### 1a. `WITH NO DATA` on the four caches

In `025`, `030`, `031`, `033`, append `WITH NO DATA` to the
`CREATE MATERIALIZED VIEW`, matching `077_dual_corpus_rankings.sql:109-111`. The
post-merge `REFRESH` in `load_pg.ts` is what populates them today anyway, so
correctness is unchanged and one full-corpus aggregate build per cache is removed.

**Tradeoff to be aware of:** with `WITH NO DATA`, a load that *fails between the
DROP and the REFRESH* leaves the cache unreadable rather than stale-but-populated,
so `/procurement` overview/rankings/settlement/risk tiles 500 until the next
successful load. Today's behaviour is a shorter gap (drop → create) but pays a
full build for it. Fix 1b removes the gap entirely in the common case, which is
why the two ship together.

#### 1b. `applyIfChanged` — skip DDL whose file hasn't changed

> **Prerequisite (audit G1): make the schema files pure DDL first.** Several files
> perform their data refresh *as a side effect of being applied* — `042` rebuilds
> `appealed_ocids`/`upheld_ocids` and calls `rebuild_contracts_list()`, `044`
> builds `kzk_appeals_summary_cache`, `005` backfills `changelog_days`. Hash-skipping
> those is a correctness regression. Hoist those side effects into the loaders
> **before** enabling the skip, and land `schema_pure_ddl.data.test.ts` in the same
> commit. This also fixes RC6: an unchanged `042` then never runs its
> `DROP … CASCADE`, so `contracts_list` stops disappearing mid-load.

Add to `scripts/db/lib/pg.ts` (or a new `lib/apply.ts`):

```ts
// Apply a schema file only when its content hash differs from the hash stamped in
// `meta` by the last successful apply against THIS database. Removes ~40 no-op DDL
// round-trips per cloud load — and, for the DROP+CREATE cache files, removes the
// drop/rebuild entirely on an unchanged schema (no serving gap, no wasted build).
//
// Stamped as meta['schema_hash:025_procurement_overview.sql'] = <md5>, written in
// the same transaction as the apply so a failed apply leaves no stamp.
export const applyIfChanged = async (file: string, opts?: { force?: boolean }) => …
```

Replace the ~40 `await exec(readFileSync(X, "utf8"))` calls in `load_pg.ts` (and
the equivalents in `load_tenders_pg.ts`) with `applyIfChanged(X)`.

Escape hatch: `--force-schema` (and `FORCE_SCHEMA=1`) re-applies everything,
for the case where cloud was mutated out-of-band and the stamp lies.

**Verification.**
- Local: `db:refresh` twice. Second run logs `schema: 0 applied, 41 unchanged`.
  `npm run test:data` stays green.
- Touch one byte in `025_procurement_overview.sql`; confirm only that file
  re-applies.
- Cloud: the Phase-0 profile shows the schema-apply block collapsing to near zero
  and the four double-builds gone.

**Expected win.** Removes 4 full-corpus aggregate builds + ~40 proxy DDL
round-trips per contracts load. On the evidence of the normalcy precedent (where
the same double-build pattern was ~40 of 68 minutes) this is plausibly the single
largest remaining item — but it is an inference, which Phase 0 will settle.

**Rollback.** Revert two commits; `--force-schema` restores the old behaviour
without a revert.

---

### Phase 2 — Ship the derived caches instead of computing them (medium effort)

**Change.** Generalise `buildOrShipNormalcy()` into one reusable helper rather
than adding a ninth hand-rolled copy:

```ts
// scripts/db/lib/ship.ts
//
// Compute-on-local, ship-to-cloud for a table that is a deterministic function of
// already-mirrored tables. LOCAL: run `build` in place. CLOUD (:5434): stream the
// local rows in by PG→PG COPY (copyTo → copyFrom) with a local-empty guard and a
// row-count parity check. Extracted from load_pg.ts buildOrShipNormalcy /
// load_tenders_pg.ts buildOrShipTenderNormalcy, which both become one-line callers.
export const buildOrShip = async (
  table: string,
  build: () => Promise<void>,
  opts?: { swap?: boolean },
) => …
```

Convert these from `MATERIALIZED VIEW` to plain tables + a build SQL file (the
`064` → `064`+`064b` split is the template), then route each through
`buildOrShip`:

| object | rows | build cost driver |
|---|---:|---|
| `procurement_overview_cache` | 1 | full-corpus aggregate |
| `procurement_rankings_cache` | 1 | full-corpus aggregate |
| `procurement_by_settlement_cache` | 1 | full-corpus aggregate + settlement join |
| `procurement_risk_indexes_cache` | 1 | full-corpus aggregate |
| `awarder_totals` | 4,411 | `GROUP BY awarder_eik` over 1.7 GB |
| `sector_contractor_stats` | 40,605 | CPV-division window functions |
| `dual_corpus_rankings_cache` | 1 | ЗОП × ИСУН EIK join |
| `awarder_kindex_ranking` | 435 | contracts × company_politicians |

**Appeal-derived — in v1 as of the 2026-07-24 directive (audit G2).**
`awarder_risk_grade_ranking`, `awarder_risk_grade_scoped` (~32 windowed rebuilds —
the biggest single CPU item in the load), `kzk_appeals_summary_cache`,
`appealed_ocids`, `upheld_ocids`. These read `kzk_appeals` / `buyer_appeal_stats`,
so shipping them requires **also** shipping those two base tables — which in turn
means building the missing `db:load:kzk:pg:cloud` (G17a), with union+COALESCE
reconciliation on first cut.

**`company_founded` must ship in the same commit as
`procurement_risk_indexes_cache` (audit G19).** It is 19,844 rows local vs **75 on
cloud** — a live divergence. Shipping the cache without the base table leaves the
cache asserting `newFirmWinner` flags that a live per-entity query on cloud cannot
reproduce: the exact `fn ≠ cache` confusion that cost hours on normalcy.

**`opts.swap`.** `buildOrShipNormalcy` currently does `TRUNCATE` + COPY in
autocommit, leaving a window where cloud reads an empty cache (noted as an
acceptable follow-up when it shipped). Since this plan multiplies the number of
shipped tables by ~10 — including the overview and rankings caches that front the
main dashboard — the helper should ship into `<table>_stage` and swap inside one
short transaction (`DELETE` + `INSERT … SELECT`, which takes RowExclusive, not
TRUNCATE's AccessExclusive). Do this once in the helper, not per caller.

**Determinism.** Established: [[reference_pg_payload_determinism]]. `percentile_cont`
and float sums differ cloud-vs-local at last-ULP because of parallel-aggregation
summation order, so any shipped payload must ROUND its float outputs and use
rounded sort keys with an `eik` tiebreak. Audit each converted build for
unrounded floats **before** shipping — this is the bug that made the normalcy
`fn ≠ cache` comparison confusing on cloud even though the shipped values were
correct.

**Ordering hazard.** `procurement_risk_indexes_cache` is also refreshed by
[`load_tr_pg.ts:447`](../../scripts/db/load_tr_pg.ts) and
`dual_corpus_rankings_cache` by [`load_funds_pg.ts:424`](../../scripts/db/load_funds_pg.ts).
Both must move to `buildOrShip` in the same commit, or a TR/funds load will
recompute on cloud what the contracts load just shipped.

**Duplicate-definition hazard.** Before converting any object, `grep` every
schema file for other definitions of the same name. `procurement_normalcy(text)`
was defined in **both** `063` and `064`; because `064` applied later, its stale
copy silently clobbered `063` on every load and the fix "wouldn't deploy" for
hours. Add a `test:data` guard (below) so this class of bug fails loudly.

**Verification.**
- Parity harness per object: `md5(string_agg(t::text, '|' ORDER BY <pk>))` +
  row count on local vs cloud after a ship. Must match exactly.
- New `scripts/db/tests/shipped_caches.data.test.ts`: for every shipped object,
  local build == shipped content, and every float field is rounded.
- New `scripts/db/tests/schema_no_dupe_defs.data.test.ts`: no function or matview
  name is defined in more than one `schema/pg/*.sql` file.

**Expected win.** Removes all remaining full-corpus aggregate CPU from the cloud
load; replaces it with ~7 MB of COPY.

**Rollback.** Each object is independent — revert one file to go back to
`REFRESH MATERIALIZED VIEW` for that object alone.

---

### Phase 3 — Delta-ship the corpus (medium-high effort, biggest transfer win)

Removes RC2: 2.3 GB → tens of MB.

#### The subtlety that shapes the design

A naive "hash live cloud rows vs incoming rows" delta is **wrong** here, for two
reasons:

1. `rebuild_consortium()` mutates `contracts` *after* the merge — it moves each
   joint award's full value onto one carrier row, **zeroes the member rows'
   `amount_eur`** (a `COLUMN_NAMES` column), and inserts synthetic `obed-…`
   carrier rows that exist in no shard. So the live table deliberately differs
   from the staged corpus for every consortium row.
2. Consequently `rebuild_consortium()` is only valid on a *freshly merged* corpus
   (`087_procurement_consortium.sql` says so explicitly). A delta that skips
   unchanged member rows would leave them zeroed and the rebuild would be invalid.

**Therefore the delta must mirror the FINAL state, not the shard state.** Local
runs the merge, `rebuild_consortium()`, `resolve_contract_unp()` and
`enrich_contract_lot_names()`; cloud receives the post-transform rows, including
`joint_kind` / `consortium_*` / `cais_id` / `lot_name`, and runs none of them.
This is what "cloud is a replica" means concretely, and it makes those four
post-load steps disappear from the cloud path for free.

#### Mechanism

Track what was shipped, so cloud never has to rescan 1.7 GB to compute its side
of the diff:

```sql
-- 094_shipped_digest.sql
CREATE TABLE IF NOT EXISTS shipped_digest (
  tbl text  NOT NULL,
  key text  NOT NULL,
  h   uuid  NOT NULL,          -- md5(row::text) of the row as shipped
  PRIMARY KEY (tbl, key)
);
```

~357k + 232k rows ≈ 25 MB on cloud. Written in the same transaction as the rows
it describes, so it can never claim a row was shipped that wasn't.

Load algorithm (`shipDelta(table, pk)` in `lib/ship.ts`):

1. **Local** computes a row hash over an **explicit column list** (`COLUMN_NAMES`
   plus the derived columns), floats `ROUND`ed and `extra_float_digits` pinned —
   **not** `md5(c::text)`, which depends on physical `attnum` order and float
   rendering and would silently degrade to a daily full re-ship (audit G3). Assert
   the local/cloud column signatures match before starting.
2. Stream those `(key, h)` pairs to cloud into an UNLOGGED `<tbl>_keys_stage`.
   357k × ~50 B ≈ **18 MB**, seconds over the proxy.
3. **Diff on cloud** (no scan of the big table — the digest table is the
   counterparty):
   - `needed` = keys in `_keys_stage` whose `h` is absent from or differs in
     `shipped_digest`
   - `removed` = keys in `shipped_digest` absent from `_keys_stage`
4. Ship `needed` back down: COPY the needed keys into a temp table on **local**,
   then `COPY (SELECT c.* FROM contracts c JOIN needed n USING (key)) TO STDOUT`
   → `copyFrom` into cloud `contracts_stage`.
5. In one transaction: upsert `contracts_stage` → `contracts` (existing
   `CONTRACTS_MERGE_UPSERT_SQL`), `DELETE` the `removed` keys, and update
   `shipped_digest` for both sets. RowExclusive only — readers never block.
6. Drop the stage tables.

Typical day: 18 MB of key hashes + 2 rows, instead of 754 MB.

**Transaction boundary (audit G14).** The row COPY into `contracts_stage` is
deliberately *outside* the merge transaction (so it never holds a lock); the merge
**and** the `shipped_digest` update are *inside* one transaction. A crash between
them must never leave the digest claiming rows that were not merged. First run
(empty digest) correctly degrades to a full ship.

**Excluded from the mirror (audit G4).** The changelog tables — `ingest_batches`,
`contract_first_seen`, `ingest_first_seen`, `changelog_days` — stay
**cloud-computed**. Their ids are per-database (cloud is at batch 142) and they
back served surfaces (`recent_updates`, "Последна активност"), so mirroring them
from local would clobber prod history. No new data is needed: `_keys_stage` from
step 2 already carries the full key set that `contract_first_seen`'s
`INSERT … ON CONFLICT DO NOTHING` consumes.

> **The 18 MB figure is contracts-only, and TR breaks it (audit G21).** With
> `db:load:tr:pg:cloud` in scope, `tr_companies` (1,019,272) + `tr_officers`
> (751,328) add ~1.77M keys ≈ **90 MB** of key hashes per run — on a table whose
> daily churn is a small delta. For TR the "optional" Merkle refinement below is
> **not optional**; size the design for TR, not for contracts.

#### Merkle refinement (optional for contracts, REQUIRED for TR — see G21)

Two-level Merkle: keep `shipped_digest_months(tbl, month, h)` alongside, ship the
few-hundred-row month digest first, and only ship keys for months whose digest
differs. Contracts and tenders are already month-sharded so the grouping is
natural. Cuts the steady-state transfer to a few hundred rows. **Not** in scope
for v1 — 18 MB is already ~40× better and the flat version is far simpler to
reason about.

#### Consistency guard

The digest table is a *trust* model: it records what we believe cloud holds. Add
`--verify` to do the full `md5(c::text)` rescan on both sides and reconcile
(expensive: a 1.7 GB seq scan on shared core, ~1-3 min). Run it weekly from the
orchestrator, on any load failure, and after any manual cloud intervention. A
mismatch triggers an automatic full re-ship of the affected table.

**Verification.**
- Byte-parity recipe from [[reference_pg_bulk_load_copy]]: capture
  `md5(string_agg(t::text,'|' ORDER BY key))` + count before and after; must be
  byte-identical to a full re-ship.
- Deliberate mutation tests: change one contract's amount locally → exactly one
  row ships; delete one → exactly one row deletes; add one → exactly one inserts.
- Idempotence: run the delta load twice; the second run ships **zero** rows.
- Consortium regression: a joint award's carrier/member split on cloud matches
  local exactly after a delta load (this is the case a naive delta breaks).
- `procurement_ingestion_regression.data.test.ts` and `goldens.data.test.ts`
  stay green.

**Rollback.** `shipDelta` keeps a `--full` mode that is the current
ship-everything path. One flag returns to today's behaviour.

---

### Phase 4 — Give `tenders` (and now TR) the staging-merge treatment (availability + speed)

Fixes RC4. Mirror what `contracts` already does in
[`load_pg.ts:306-344`](../../scripts/db/load_pg.ts):

1. COPY into an UNLOGGED `tenders_stage` on its own connection, **outside** the
   merge transaction.
2. `ALTER TABLE tenders_stage ADD PRIMARY KEY (unp)` (dedupe + merge-join speed).
3. `ANALYZE tenders_stage`.
4. In one transaction: upsert-on-conflict + anti-join delete + a live-vs-staged
   parity guard.

Add `TENDERS_MERGE_UPSERT_SQL` / `TENDERS_MERGE_DELETE_SQL` to
`lib/tenders_schema.ts`, derived from `COLUMN_NAMES` exactly as
`lib/procurement_schema.ts` does.

Ship this **before or with** Phase 3 — Phase 3 then plugs the delta into a merge
that already exists, and the availability bug is fixed independently of whether
Phase 3 lands.

**Verification.** Byte-parity before/after; 200+ concurrent tender reads during a
cloud load with zero blocked (the check used for the contracts fix); confirm no
`Lock/relation` waiters in `pg_stat_activity` behind a `COPY tenders` backend.

**4b. The TR tables (F21).** Added 2026-08-10, and NOT a second copy of the above —
scope it separately. `tr_companies` and `ngo_details` take the pattern unchanged
(both are `uic`-keyed). `tr_officers` needs a unique index on `(uic, name)` first —
the loader's `GROUP BY` already guarantees it, nothing declares it. `tr_person_roles`
has **no key at all** and cannot get one naturally (same person, same role, same
company, different date ranges), so it needs its own design: most likely
delete-and-reinsert scoped to the `uic`s the delta touches, which costs a per-company
`RowExclusiveLock` instead of a whole-table `AccessExclusive`.

Sequence it against Phase 3 the same way — but note TR's delta-ship is separately
gated on G21 (the flat key-digest does not scale to 1M+ keys), so 4b is the part
that delivers on its own.

Two verification items the `tenders` list does not cover: the one-shot index
rebuild must survive the change (it is what makes the load fast, and `LOAD_INDEXES`
drops all 11 up front), and an INTERRUPTED load must not leave the tables
unindexed — F21's operational hazard, which is the state that looks healthy to
every row-count check in this document.

---

### Phase 5 — Orchestration (small, mostly free)

**5a. No-op guard.** Stamp the corpus aggregate hash in `meta` on success
(`contracts_corpus_hash`, `tenders_corpus_hash`). If the incoming hash matches,
skip the load entirely and log why. On a day with zero procurement churn — common
— the whole leg becomes one query. Composes naturally with Phase 3, which already
computes per-row hashes.

**5b. Parallelise.** `awarder-seats` (3,845 rows, ~3s) is fully independent — run
it concurrently. `contracts` and `tenders` interact only through
`resolve_contract_unp()` / `enrich_contract_lot_names()`, which both loaders
already re-run idempotently precisely so either order works — and under Phase 3
those move to local anyway. Worth little until Phases 1-3 land (on 0.5 vCPU,
overlap only helps the network-bound phases), so sequence it last.

**5c. Temporary instance scale-up.** Wrap the deploy:

```bash
gcloud sql instances patch electionsbg-pg --tier=db-custom-2-7680   # ~2 min restart
… loaders …
gcloud sql instances patch electionsbg-pg --tier=db-g1-small        # ~2 min restart
```

Cents per hour; documented as the biggest single lever and never actually tried.
It is a prod-DB mutation, so **the operator runs it** — the harness classifier
blocks it (same as the `--database-flags` patch). Keep it as a documented escape
hatch rather than a default: if Phases 1-3 land, the CPU it buys is CPU we no
longer spend.

> Note: a **permanent** RAM bump is a separate, already-justified question —
> `shared_buffers` is 128 MB against a ~5-6 GB hot working set, which is a
> *serving* latency problem (~480 ms cold heap reads), not a load problem. See
> [[reference_cloud_sql_deploy_perf]]. Do not conflate the two.

---

## Audit findings (2026-07-24) — required plan changes

The plan above was audited against the live databases before any implementation.
Four findings are **blocking**: the plan as originally written would have shipped
correctness bugs. They are folded into the phases above; this section is the
record of what was wrong and why.

### G1 (blocking) — `applyIfChanged` silently disables data refreshes hidden in DDL files

Several `schema/pg/*.sql` files are not pure DDL — their apply *is* the data
refresh. Hash-skipping them is a correctness regression, not an optimisation:

| file | hidden side effect | consequence of skipping |
|---|---|---|
| `042_kzk_appeals.sql` | DROP+CREATE `appealed_ocids`, `upheld_ocids` | **the only** refresh of these after a tenders load — `load_pg.ts:593-597` explicitly does *not* refresh them, and `kzk_appeals.ts:691-692` only runs on a КЗК ingest. Contracts-browser appeal badges and the CRI `procedureAppealUpheld` component go stale |
| `042_kzk_appeals.sql` | `SELECT rebuild_contracts_list()` | `contracts_list` not rebuilt after a `contracts` shape change |
| `044_procurement_ai.sql` | CREATE `kzk_appeals_summary_cache` with data | appeals tile stale |
| `005_ingest_tracking.sql` | `INSERT INTO changelog_days … SELECT … FROM ingest_batches` | changelog backfill skipped |
| `025`/`030`/`031`/`033` | CREATE cache with data | (harmless — the loader REFRESHes after) |

**Required change.** Do not add a `SIDE_EFFECT_FILES` allowlist — that preserves
the bug and adds a second place to forget. Instead **hoist the data side effects
out of the DDL files into the loaders**, where every other refresh already lives:
move the `appealed_ocids` / `upheld_ocids` refreshes and `rebuild_contracts_list()`
out of `042` into `load_tenders_pg.ts`, and the `changelog_days` backfill out of
`005`. Then every schema file is pure DDL and the hash-skip is sound by
construction. This also resolves RC6 for free (see G6).

Add `scripts/db/tests/schema_pure_ddl.data.test.ts`: fail if any `schema/pg/*.sql`
contains a top-level `INSERT`/`UPDATE`/`DELETE`/`REFRESH`/`SELECT <fn>()` or a
`CREATE MATERIALIZED VIEW` without `WITH NO DATA`. That is the guard that keeps
this class of bug from coming back.

### G2 (blocking) — Phase 2 silently changes who owns КЗК data

`kzk_appeals` is **not mirrored**. Per `update-kzk-appeals`, there is no
`db:load:kzk:pg:cloud` — "the crawl *is* the loader, which is why publishing means
re-crawling against the cloud URL". Local and cloud are populated by independent
crawls, and the 2,098 merits outcomes are interactively produced and explicitly
**unregenerable from committed code**, protected by `COALESCE(existing, EXCLUDED)`
upsert guards.

They agree right now (verified: 7,841 rows / 2,098 outcomes on both sides) but
nothing enforces it. Shipping from local would overwrite cloud's appeal-derived
state for `awarder_risk_grade_ranking`, `awarder_risk_grade_scoped` (via
`buyer_appeal_stats` — a *cloud-written* table), `kzk_appeals_summary_cache`,
`appealed_ocids`, `upheld_ocids` and `062_procurement_hub_counts`.

**Original required change (SUPERSEDED by the directive below — kept for the
record).** Split the Phase 2 ship list into "pure functions of mirrored tables"
(`procurement_overview_cache`, `procurement_rankings_cache`,
`procurement_by_settlement_cache`, `procurement_risk_indexes_cache` — verified to
contain no appeal reference — `awarder_totals`, `sector_contractor_stats`,
`dual_corpus_rankings_cache`, `awarder_kindex_ranking`) and "appeal-derived, do
not ship" (`awarder_risk_grade_ranking`, `awarder_risk_grade_scoped`,
`kzk_appeals_summary_cache`, `appealed_ocids`, `upheld_ocids`).

**Still required either way:** a pre-flight guard in `buildOrShip` — before
shipping anything appeal-derived, compare `(count(*), md5 of the outcome-bearing
rows)` on both sides and **abort** on divergence rather than overwrite.

> **RESOLVED 2026-07-24 by operator directive: all ingest happens locally via
> `process-watch-report`, so local IS authoritative.** The five deferred objects
> move back **into v1**, including `awarder_risk_grade_scoped` — the largest single
> CPU item in the load. Two consequences:
>
> 1. **`kzk_appeals` needs a ship path that does not exist yet.** Today there is no
>    `db:load:kzk:pg:cloud`; publishing means re-crawling against the cloud URL
>    (audit G17a). Building that wrapper — a `buildOrShip` of `kzk_appeals` +
>    `buyer_appeal_stats` from local — is now **in scope**, and it removes a live
>    network crawl from the prod publish path.
> 2. **The reconciliation must still be union+COALESCE on first cut, not a blind
>    overwrite.** The 2,098 merits outcomes are unregenerable, and cloud may hold
>    rows from a past cloud-only crawl that local never saw. Ship as
>    `INSERT … ON CONFLICT DO UPDATE` with the same `COALESCE(existing, EXCLUDED)`
>    guards the crawler uses on `outcome`/`suspension`/`status`/`unp`/`source_url`,
>    then verify counts match, then switch to a plain mirror in a follow-up once a
>    full cycle has confirmed parity. Counts agree today (7,841 / 2,098 both sides,
>    verified) so this should be a no-op — which is exactly the condition under
>    which it is safe to make the change.

### G3 (blocking) — the Phase 3 row hash is not portable, and fails silently

`md5(c::text)` renders columns in `attnum` order and floats via the
`extra_float_digits` GUC. `contracts` carries 4 `double precision` columns
(`amount`, `amount_eur`, `signing_amount_eur`, `consortium_full_eur`), and Cloud
SQL's flags are patched independently of local docker.

Column order matches today (verified: both sides hash to `ffcebd4f…`) but nothing
enforces it. If a future migration lands in a different order on the two DBs — or
a flag patch changes float rendering — **every row hashes differently, the delta
degrades to a full re-ship every day, and nothing errors.** A performance
optimisation that silently reverts is worse than not having it.

**Required change.** Hash an explicit, code-controlled column list derived from
`COLUMN_NAMES` plus the derived columns, with floats `ROUND`ed, and pin
`extra_float_digits` in the hashing session. At load start, assert that the local
and cloud *column-signature* hashes match and abort with an actionable message.

### G4 (blocking) — the changelog tables have no design, and the obvious answer destroys prod history

`contract_first_seen(key, batch_id)` FKs `ingest_batches(id)`, whose ids are
per-database (cloud is at id 142; local's sequence is independent). These feed
`recent_updates` and "Последна активност" — served surfaces
([[feedback_pg_changelog_required]], [[reference_two_changelogs]]).

Mirroring them would clobber cloud's changelog history with local's.

**Required change.** State explicitly that the changelog tables (`ingest_batches`,
`contract_first_seen`, `ingest_first_seen`, `changelog_days`) stay
**cloud-computed** and are excluded from the mirror. This is cheap and needs no
new data: Phase 3 step 2 already ships `_keys_stage` with the full key set, which
is exactly what `contract_first_seen`'s `INSERT … ON CONFLICT DO NOTHING` needs.
Add a test asserting cloud changelog rows are monotonic across a delta load.

### G5 — RC1 undercounted (folded in above)

Five double-builds, not four: `044`'s `kzk_appeals_summary_cache` is the fifth.

### G6 — RC6 was missing entirely (folded in above)

The `DROP … CASCADE` in `042` takes `contracts_list` with it on every tenders
load. Note the tension with G1: "always apply 042" would preserve the bug. The G1
fix (hoist refreshes into the loader, make `042` pure DDL) resolves both — an
unchanged schema then never drops anything.

### G7 — Phase 1a is deliberately throwaway; say so

The four caches getting `WITH NO DATA` become plain shipped tables in Phase 2.
Phase 1a is a ~1h stopgap that banks the win immediately. Flagged so nobody builds
on it.

### G8 — the local build budget is unmeasured

Phase 2 moves ~8 rebuilds onto local Docker, but `db:refresh` (local) is itself
part of the daily loop at orchestrator Step 2b. `awarder_risk_grade_scoped`'s ~32
windowed rebuilds may be minutes locally.

**Required change.** Phase 0 must instrument the **local** run too, and the
success criterion must be **total daily loop time**, not the cloud leg alone.
Otherwise the plan optimises a number by moving cost somewhere nobody measures.

### G9 — scope boundary (RESOLVED: everything is in scope)

**Operator directive 2026-07-24: `db:load:tr:pg:cloud` is in scope, as is
everything else.** The unit of work is the whole Cloud SQL publish, not the three
procurement commands.

That means all 30 `:cloud` npm scripts, and `lib/ship.ts` / `applyIfChanged` /
`shipDelta` are **shared infrastructure from day one**, not procurement-local
helpers retrofitted later.

`db:load:tr:pg:cloud` specifics (~18.6 min assumed; **34.9 min measured 2026-08-07, F11**, [[reference_cloud_sql_deploy_perf]]):
COPYs are ~1.5 min each; the tail is index builds + the Awarder K-Index matview.
`tr_companies` (1,018,999 rows) and `tr_officers` (750,178) are prime delta-ship
candidates — TR churn is a daily-refresh delta, not a full rewrite. Its matviews
(`company_person_roles` 1.1M/272 MB, `owner_name_counts`, `officer_name_counts`)
are pure functions of those two tables and ship cleanly.

Ordering note: `load_tr_pg.ts:447` also refreshes `procurement_risk_indexes_cache`
and calls `rebuildRiskGradeScoped` — both now shipped objects, so TR must adopt
`buildOrShip` in the same commit as the contracts path or it will recompute on
cloud what contracts just shipped (G12).

### G10 — `--verify` cost is a guess with no failure path

"1-3 min" for a full `md5` rescan of 1.7 GB on 0.5 vCPU with 128 MB
`shared_buffers` is optimistic — near-zero cache retention plus ~900 MB of row
text to hash. Measure it in Phase 0 before promising a weekly cadence. The plan
also says a mismatch "triggers an automatic full re-ship" without saying who runs
`--verify`, where a failure surfaces, or what the operator sees. Wire it into the
orchestrator with an explicit alert path.

### G11 — no stated floor

Irreducible steady-state cost after all phases ≈ 18 MB of key hashes + ~7 MB of
caches + digest updates + the DDL round-trips. Estimate it so "<10 min" is
measured against something rather than being a wish.

### G12 — matview→table conversion needs a completeness sweep

Every `REFRESH MATERIALIZED VIEW <name>` in the repo errors once `<name>` is a
table. Known sites: `load_pg.ts` (7), `load_tenders_pg.ts:243`, `load_tr_pg.ts:447`,
`load_funds_pg.ts:424`, `kzk_appeals.ts:691,692,697,707`. Add a grep-based test
that no `REFRESH MATERIALIZED VIEW` names a converted object.

### G13 — `applyIfChanged` bootstrap ordering

The stamps live in `meta`, which `001_procurement.sql` creates. `000` and `001`
must always apply, or the helper must treat a missing `meta` as "apply
everything". Needs an explicit fresh-DB test.

### G14 — `shipped_digest` transaction boundary is under-specified

First run (empty digest → full ship) is correct but unstated. More importantly:
the stage COPY is deliberately *outside* the merge transaction while the digest
update must be *inside* it. Spell the boundary out, or a crash between them leaves
the digest claiming rows that were never merged.

### G15 — Phase 3 has an unmentioned cloud→local hop

Step 4 sends the `needed` key list cloud→local. Small, but real. Optional
follow-up: cache the digest locally with a generation counter so the 18 MB upload
is skipped when generations match — worth noting now rather than rediscovering it
mid-build.

---

## Ingest-locality audit (2026-07-24)

Prompted by the operator rule: **all ingest happens locally via
`process-watch-report`.** Audited to establish whether the "cloud is a replica"
premise actually holds today.

**The rule is the orchestrator's stated design.** Step 8 of `process-watch-report`:
"Each PG-backed skill reloads the LOCAL Postgres tables inside its own run …
Cloud SQL is a **production** target, so … do NOT auto-run it: instead emit the
matching `db:load:*:cloud` command(s)."

**Empirically local and cloud agree** on everything checkable (verified 2026-07-24):

| table | local | cloud |
|---|---:|---:|
| `contracts` | 406,640 | 406,640 |
| `tenders` | 232,260 | 232,260 |
| `awarder_seats` | 3,845 | 3,845 |
| `kzk_appeals` | 7,841 | 7,841 |
| `kzk_appeals` (outcome not null) | 2,098 | 2,098 |
| `transport_project_link` | 1,163 | 1,163 |
| **`company_founded`** | **19,844** | **75** |

So the premise holds — with one live exception (G19) and six process exceptions
(G17).

### G16 (blocking) — the plan breaks a documented orchestrator invariant

Step 8 states the cloud loaders are correct **independently** of local Postgres:

> "delegates to the base load — which reads the same fresh `data/` artifacts,
> `TRUNCATE`+reloads its table, AND rebuilds the dependent matviews /
> `awarder_risk_grade_scoped` **on cloud** … It reads the on-disk artifacts, not
> local Postgres, so it's **correct regardless of local PG state**."

This plan inverts that contract: after Phases 2-3 the cloud load is *only* correct
when local PG is current. The failure mode is silent — a cloud load run against a
stale local DB ships stale data with no error.

Note the invariant is **already broken**: `buildOrShipNormalcy` reads local `:5433`
and throws if the local cache is empty. The doc is stale today.

**Required change.** Update `process-watch-report` Step 8 in the same commit as
Phase 2, restating the contract as "the cloud load ships from local PG; local
`db:refresh` is a hard prerequisite". Add a **pre-flight assertion** to every
shipping loader: local's corpus stamp (`meta.generated_at` / corpus hash) must be
at least as new as cloud's, else abort with an actionable message. This is not
optional — it is the guardrail that makes the inverted contract safe.

### G17 — six paths still write to cloud directly, violating the local-ingest rule

| # | path | what it does | required action |
|---|---|---|---|
| a | `update-kzk-appeals` | **re-crawls the КЗК register against the cloud URL** — "the crawl *is* the loader" | build `db:load:kzk:pg:cloud` as a `buildOrShip` of `kzk_appeals` + `buyer_appeal_stats`. **Now in scope** — G2 depends on it |
| b | `update-agri` (`agri:ingest`) | re-runs the writer against the proxy | give it a ship wrapper, or document as a deliberate exception |
| c | `db:resolve:persons:cloud` | re-runs the **person resolver on cloud** (`--no-stamp`), reading cloud upstreams | resolver is expensive; ship `person_*` from local instead |
| d | `build:project-members:cloud` | rebuilds dossier members on cloud | ship from local |
| e | `prices:ingest:cloud` | full prices pipeline (re-cluster ~118k catalogue + payloads) on cloud | out of scope for this plan; already has its own daily cloud path ([[project_prices_pg_migration]]) — flag, don't touch |
| f | `fetch_company_founded.ts` | pace-dependent backfill (~14h/10k EIKs healthy, far longer when the source throttles) written directly against the target DB; requires 033's `http_status`/`attempts` columns first | see G19 |

Each is a place the mirror model does not yet apply. (a) is the one this plan must
fix; (b)-(d) are follow-ups; (e) is explicitly left alone.

### G18 — three more cloud loads ride the procurement publish, uncounted

Step 8 emits, alongside the user's three commands:

```
npm run db:load:transport-project-map:pg:cloud
npm run db:load:water-operator-map:pg:cloud
npm run db:load:mvr-directorate-map:pg:cloud
```

…because they are contract-derived crosswalks that go stale on cloud whenever
contracts change (this is why `transport_project_link` drifted). They belong in the
Phase 0 profile and in the ship list. Note the Step-8 rationale — "their row counts
are legitimately NOT equal local↔cloud … cloud's corpus is fuller" — is **stale**:
`transport_project_link` is 1,163 on both sides and the corpora are identical. Once
they are shipped rather than recomputed, that caveat should be deleted from the
skill doc.

### G19 — `company_founded` is a live divergence, and shipping it changes prod behaviour

19,844 rows local (15,138 with a date) vs **75 rows (74 dated) on cloud**. Exactly
as Step 8 warns: "cloud currently holds only a stub, so the `newFirmWinner` flag is
dormant on prod."

`company_founded` feeds `procurement_risk_indexes_cache`
(`033_procurement_risk_indexes.sql:238-244`) — one of the caches certified "safe to
ship" under G2. Two consequences:

1. Shipping the cache **without** the base table leaves cloud asserting
   `newFirmWinner` flags a live per-entity query on cloud cannot reproduce. Ship
   `company_founded` in the same commit.
2. Doing so **lights up a risk flag that is currently dormant on prod**, for 15,138
   firms. That is a defensible fix — the stub is an accident, not a decision — but
   it is a **user-visible behaviour change arriving inside a performance plan**.
   Call it out explicitly at release; do not let it land silently.

### G20 — the mirror's anti-join DELETE is destructive if local ever falls behind

Phase 3 deletes cloud keys absent from local. If local is behind (a failed local
ingest, a fresh clone, a restored-from-older-dump local DB), that silently deletes
live prod rows.

**Required change.** Before any delta ship, abort unless local's row count is
within a configured tolerance of cloud's and local's corpus stamp is not older.
A shrinking corpus must require an explicit `--allow-shrink`. The counts agree
today, which is the right moment to install the guard — not after the first
incident.

---

## Final audit pass (2026-07-24) — G21-G25

Third pass, after the scope expansion. Verified: `tr_companies` (1,019,272) and
`tr_officers` (751,328) are **row-identical** local↔cloud, as are contracts,
tenders, awarder_seats, kzk_appeals and transport_project_link. Every object in
the Phase 2 ship list is populated locally. The mirror premise is empirically
sound across the expanded scope — `company_founded` (G19) remains the sole
divergence.

### G21 (blocking for TR) — the flat key-digest does not scale to TR

The 18 MB key-hash upload was sized on contracts (357k keys). TR adds ~1.77M keys
≈ 90 MB **per run**, to move a daily delta. That is a worse trade than the problem
it solves for the corpus's least-churning big table.

**Required change.** Promote the Merkle refinement from "optional v2" to part of
the Phase 3 design, and pick the grouping key per table: month for
contracts/tenders (already month-sharded), EIK prefix or first-letter bucket for
`tr_companies`/`tr_officers`. Ship the group digest first (hundreds of rows),
descend only into groups that differ. Size the design for TR.

### G22 (blocking for Phase 5b) — parallel loads collide on global stage-table names

`contracts_stage` and `price_stage` are unqualified, database-global names, and
Phase 3 adds `<tbl>_keys_stage` plus a single shared `shipped_digest`. Phase 5b
proposes running loads concurrently. Two loads in flight would corrupt each
other's staging silently.

**Required change.** Either (a) name stage tables per-run (`contracts_stage_<pid>`)
or use `CREATE TEMP TABLE` where the session lifetime allows, and (b) take a
`pg_advisory_lock` keyed on the table name for the duration of each ship, so a
second concurrent load blocks rather than interleaves. Do this **before** Phase 5b,
not as part of it.

### G23 — `db:refresh` does not load TR, so "local is current" is per-dataset

`db:refresh` covers contracts, tenders, funds, awarder-seats, schools,
admin-services, court-load, excise-warehouses, magistrates, the three crosswalk
maps, declarations, persons and person-elections. It does **not** run
`db:load:tr:pg` — TR arrives via `tr:daily-refresh`, and NZOK / NGO-funding / КЗК
have their own skills.

So the Phase 2/3 precondition is not "local `db:refresh` ran" but "**the local
loader for this specific dataset** ran". The G16 pre-flight assertion must
therefore be **per-table** (compare that table's local stamp against cloud's), not
one global corpus check. A single global gate would either block valid loads or
wave through stale ones.

### G24 — cross-DB tests cannot live in `test:data`

`docs/testing-standards.md`: unit tests never touch the network, and the
`scripts/db/tests/*.data.test.ts` exception queries **local** Postgres, auto-skipping
when unreachable. Only one existing test (`procurement_dossiers.data.test.ts`)
references the cloud proxy.

The tests proposed in this plan — `hash_portability`, `changelog_monotonic`, and
the local-vs-cloud parity harness — need **both** databases, and the cloud proxy
is normally down outside a publish window.

**Required change.** Add a separate gate (`npm run db:verify:cloud`, gated on an
env flag, auto-skipping when `:5434` is unreachable) rather than pushing these into
`test:data`. Keep `test:data` hermetic and local — it is a pre-commit gate and must
not depend on prod being reachable.

### G25 — the recovery path is unnamed

The plan says a `--verify` mismatch "triggers an automatic full re-ship" without
naming the mechanism. It already exists: `npm run db:sync:cloud -- --yes`
(pg_dump local → pg_restore cloud, destructive `--clean`) is precisely the
whole-DB reconcile the mirror model wants as its repair tool — and under this plan
its precondition ("local must be the source of truth first") becomes *permanently*
true rather than a caveat.

**Required change.** Write the escalation ladder down explicitly: per-table
`--full` re-ship → `db:sync:cloud -- --yes` → restore from `db:dump:cloud`
snapshot. And take a `db:dump:cloud` restore point **before** the first production
run of Phases 2 and 3, since both change how prod data is written.

### Housekeeping

- **Migration numbering.** 093 is the highest today. This plan needs at least: 094
  `shipped_digest`, 095 cache matview→table conversions, 096 `kzk_appeals` ship
  support. Allocate the block up front so parallel work does not collide.
- **`awarder_seats` stays as-is.** 3,845 rows, ~3s, multi-row INSERT. Under the
  mirror model it is trivially shippable but there is no win; leave it.

---

## Explicitly rejected

- **`db:sync:cloud` (pg_dump/pg_restore --clean) as the daily path.** Destructive,
  ships the entire ~8.75 GB database, drops and recreates every object, and resets
  session GUCs. It is the right tool for a full parity reset, not a daily delta.
- **CSV → GCS → `gcloud sql import csv`.** Genuinely bypasses the proxy and reads
  server-side at bucket speed, and would be the answer if the transfer had to stay
  full-corpus. Phase 3 makes the transfer small enough that the extra moving parts
  (bucket lifecycle, import job polling, CSV's NULL-vs-empty-string ambiguity —
  see [[reference_pg_bulk_load_copy]] on why these loaders use COPY *text*) are not
  worth it.
- **Converting `load_awarder_seats_pg.ts` to `copyRows`.** 3,845 rows, ~3s. The
  1000-row multi-row INSERT is fine. Not worth the parity re-verification.
- **Logical replication local → cloud.** Would subsume Phase 3 elegantly, but
  requires a permanent replication slot against prod, wal_level changes, and
  couples the prod schema to the local one on every migration. Too much standing
  infrastructure for a once-daily batch.

---

## Test plan

Added to `scripts/db/tests/` (all auto-skip when Postgres is down, per the
existing `*.data.test.ts` convention):

| test | asserts |
|---|---|
| `shipped_caches.data.test.ts` | every shipped cache: local build == shipped content; all float fields rounded |
| `schema_no_dupe_defs.data.test.ts` | no function/matview name defined in >1 `schema/pg/*.sql` (the `063`/`064` class of bug) |
| `schema_pure_ddl.data.test.ts` | **(G1)** no `schema/pg/*.sql` has a top-level `INSERT`/`UPDATE`/`DELETE`/`REFRESH`/`SELECT <fn>()`, and no `CREATE MATERIALIZED VIEW` lacks `WITH NO DATA` |
| `no_refresh_of_tables.data.test.ts` | **(G12)** no `REFRESH MATERIALIZED VIEW` anywhere in the repo names an object converted to a table |
| `hash_portability.data.test.ts` | **(G3)** local and cloud column signatures match; the row hash is stable across `extra_float_digits` settings |
| `changelog_monotonic.data.test.ts` | **(G4)** cloud `ingest_batches`/`changelog_days` only grow across a delta load |
| `apply_if_changed_bootstrap.data.test.ts` | **(G13)** a fresh DB with no `meta` applies every file; a second run applies none |
| `delta_ship.data.test.ts` | change/insert/delete one row → exactly one row ships; second run ships zero; consortium carrier/member split preserved |
| `tenders_merge.data.test.ts` | tenders merge is byte-identical to a full reload; parity guard fires on an injected mismatch |
| extend `manifest.data.test.ts` | `meta` carries a `schema_hash:*` stamp for every applied file |

Existing gates that must stay green throughout:
`npm run test:data` (`procurement_ingestion_regression`, `goldens`, `invariants_pg`,
`pg_roundtrip`, `copy`, `sector_stats`, `tender_normalcy`), `npm run functions:test`,
`npm run lint`, `npx tsc -b` (**not** `tsc --noEmit` — the root tsconfig is a
references stub and checks nothing).

Per-phase byte-parity recipe, non-negotiable before any loader change ships
([[reference_pg_bulk_load_copy]]):

```sql
SELECT count(*), md5(string_agg(t::text, '|' ORDER BY key)) FROM contracts t;
```

Capture before, reload, compare after — on **both** local and cloud.

---

## Sequencing and decision gates

| # | Phase | Effort | Gate |
|---|---|---|---|
| 1 | **Phase 0** instrumentation (local **and** cloud, per G8) | ~1h | produces the baseline profile |
| 2 | **G1 prerequisite** — hoist data side effects out of `schema/pg/*.sql` into the loaders + `schema_pure_ddl` test | ~2-3h | must precede Phase 1b; also fixes RC6 |
| 3 | **Phase 1** `WITH NO DATA` + `applyIfChanged` | ~2h | after step 2 |
| 4 | **re-measure** one cloud load | 1 run | **decision gate** — the profile decides whether Phase 2 or Phase 3 dominates |
| 5 | **Phase 4** tenders staging-merge | ~2-3h | ship regardless of profile: it is an availability bug |
| 6 | **Phase 2** ship derived caches (full list — G2 resolved) | ~1-2d | if profile shows server-side CPU dominates |
| 7 | **Phase 3** delta-ship corpus | ~2-3d | if profile shows transfer dominates |
| 8 | **Phase 5** no-op guard, parallelism | ~2-3h | cleanup |

Both prior open questions are now **resolved by operator directive (2026-07-24)**:
local is authoritative (G2) and everything including TR is in scope (G9). That
adds three work items to the critical path:

| # | added work | why |
|---|---|---|
| 2b | **pre-flight guards**: local-not-stale assertion (G16) + no-shrink guard (G20) | the inverted contract is unsafe without them; install before any shipping code |
| 6b | **`db:load:kzk:pg:cloud`** — ship `kzk_appeals` + `buyer_appeal_stats` from local, union+COALESCE | unblocks the five appeal-derived caches incl. `awarder_risk_grade_scoped` |
| 6c | **ship `company_founded`** with `procurement_risk_indexes_cache` (G19) | prevents cache≠fn on cloud; announce the `newFirmWinner` behaviour change |
| 7b | **TR delta-ship** — `tr_companies` (1.02M) + `tr_officers` (751k) + their three matviews, **Merkle-grouped** (G21) | **34.9 min measured** (2026-08-07, F11 — not the ~18.6 min previously assumed), now in scope |
| 7c | **stage-table isolation + advisory locks** (G22) | must precede Phase 5b parallelism |

Also: update `process-watch-report` Step 8 alongside Phase 2 (G16, G18); make the
pre-flight staleness assertion **per-table**, not global (G23); add the
`db:verify:cloud` gate rather than extending `test:data` (G24); take a
`db:dump:cloud` restore point before the first prod run of Phases 2 and 3 (G25).

Phases 2 and 3 are independent and can land in either order — the profile from
gate 2 says which one to build first. Phase 5c is available at any point as a
blunt instrument if a specific night's deploy needs to be short.

**Success criterion.** The **full Cloud SQL publish** — the three procurement
commands, the three crosswalk maps (G18), and `db:load:tr:pg:cloud` (G9) —
completes in **under 15 minutes** on an unchanged `db-g1-small`, with zero
`/procurement` 500s during the window —
and (per G8) the **local** `db:refresh` leg does not grow by more than the cloud
leg shrinks. The measured target is total daily loop time, not the cloud leg
alone. The irreducible floor (G11) must be estimated from the Phase 0 profile
before this number is treated as achievable.

**Distance to it, measured (2026-08-07, F14).** Those exact eight steps ran in
**8305 s = 138.4 min**, so the criterion demands a **9.2× reduction** — worth
stating next to the number rather than discovering later. Two caveats on the
criterion's *scope*, both from the same run:

- It covers **52%** of the real publish. The other 48% — the person chain
  (persons-browse / person-search / graph / tr-company-place, 1016 s), the risk
  caches (752 s) and prices (5744 s) — is outside it, and the full deploy was
  **264 min**. A criterion that can be met while the publish still takes ~2 h is
  the wrong success measure; either widen it or say explicitly that it governs
  the procurement+TR leg only.
- "Zero `/procurement` 500s during the window" is currently **unmeasurable as
  written**, because F9 shows the failure surfaces as `55P03`/`57014` at the
  database, and whether that becomes a 500 depends on each route's degrade set.
  Pin the criterion to the database symptom (no reader rejected on `tenders`),
  not to the HTTP status.

---

## Operational notes

- Long cloud loads must be launched with `run_in_background: true` — a foreground
  poll wrapper's SIGTERM kills the child mid-run ([[reference_cloud_sql_deploy_perf]]).
- To watch phases live: `pg_stat_activity` with `now() - query_start` and
  `left(query, 80)`. Do **not** `SELECT count(*)` on the loading table — it blocks
  behind the swap lock.
- The repo-local `.pgpass` must be passed as an **absolute** path
  (`PGPASSFILE=/Users/atanasster/data-bg/.pgpass`) when invoking `psql` by hand;
  `lib/pg.ts` resolves it automatically for the loaders.
- `.pgpass` is cloud-only — `db:dump` local does not need it.

---

### F22 — the PERSON chain is the second hour, and nothing had ever timed it

Measured end to end on 2026-08-11 while publishing an MP-declarations backfill
(1,644 filings recovered from register years 2015-2020) plus the Tier-2b merge
change. Every step is a `:cloud` wrapper against the proxy at `127.0.0.1:5434`;
`rc=0` throughout.

| step | seconds | note |
|---|---:|---|
| `db:load:place-dim:pg:cloud` | **228** | NOT the usual no-op — see below |
| `db:load:judicial-bodies:pg:cloud` | 6 | |
| `db:resolve:persons:cloud` | **1733** | 28.9 min |
| `db:load:declarations:pg:cloud` (phase 1) | 136 | |
| `db:load:declarations:pg:cloud -- --resolve` | **791** | 13.2 min |
| `db:load:official-candidate-links:pg:cloud` | 6 | |
| `db:load:person-elections:pg:cloud` | 160 | |
| `db:load:persons-browse:pg:cloud` | 461 | |
| `db:load:person-search:pg:cloud` | 481 | |
| `db:load:graph:pg:cloud` | 249 | |
| **total** | **4251** | **70.8 min** |

**This plan's scope line says "the other 30 `:cloud` scripts included" and then
never costs them.** The person chain alone is comparable to the procurement legs
this plan was written to fix, and it is a hard serial dependency — nine of the ten
steps read what the one before them wrote — so none of it parallelises without
restructuring.

**The resolve estimate in circulation was 4.4-5.8x optimistic.** `process-watch-report`
carried `# ~5 min, measured 2026-08-05 — NOT the "multi-hour" CLAUDE.md claims`.
Measured here **twice on the same day and the same corpus**: **1733 s cold, 1332 s
warm** (the second run followed 40 minutes later, with the instance's cache hot).
Both prior claims are wrong in opposite directions. The reconciliation is corpus
growth — this run resolved against 49,627 filings where the August-05 run had
~47,000 — and the spread between the two runs is a caution in itself: a single
datapoint on this step is worth ±20%. Treat **~25-30 min** as the planning figure.

The 400 s cold/warm spread also means the chain cannot be costed by summing
best-case step times; the first person deploy after any instance restart pays the
cold number on every step, not just the resolve.

**`place-dim` is cheap only when it no-ops, and the guidance to "emit it
unconditionally" is about correctness, not cost.** Its fingerprint check found the
dimension had moved, so it fired the refresh it guards — 119
(`procurement_settlement_rank`, `procurement_geo_payloads`) and 123
(`procurement_settlement_payloads`) — taking 228 s instead of seconds. Worth
knowing before budgeting a deploy window. It used `REFRESH … CONCURRENTLY`, so
`/procurement/by-settlement` and the settlement pages stayed readable throughout;
this is NOT the AccessExclusive stall CLAUDE.md warns about for a plain REFRESH.

**A `db:load:*:cloud` wrapper reads the on-disk artifacts, not local Postgres —
except the resolve, which reads the cloud DATABASE.** That asymmetry is what makes
the chain order load-bearing rather than cosmetic, and it produced a real defect on
this deploy: see the ordering note now in `process-watch-report`'s person-chain
block. In short — the emitted chain ran `db:resolve:persons:cloud` BEFORE
declarations phase 1, so the resolve keyed the register gold key against the
previous filing set: **778 mentions aliased to an MP id where local reported 929**,
and 132 MP↔declarant split pairs against local's 124. Every row count on both sides
reconciled exactly (49,627 / 5,575 / 935), which is why it needed a
content-level check to notice at all. The correction cost a second pass of
resolve → `--resolve` → five downstream loaders: **3700 s**, taking the whole publish
from 4251 s to **7951 s (132.5 min)**. After it, prod matched local exactly on all six
checked figures (124 pairs / 72 MPs / 49,627 filings / 49,627 resolved / 4,625
filing-dated roles / 0 unlicensed merges).

**`bucket:sync` never deletes, and on this tree that is a correctness problem, not
just clutter.** Both the `bucket:sync` and `bucket:sync:paths` commands run
`gsutil rsync` WITHOUT `-d`, so an artifact that disappears locally stays served.
Measured on this deploy: the parliament rebuild dropped 10 `mp-management/*.json`
files — MPs whose name-based TR roles the name-frequency guard now suppresses,
because the companies-index grew and more names read as frequent — and all 10 were
still live on the bucket after a successful sync (896 local against 906 remote).
Those are precisely the attributions the guard had just WITHDRAWN, left publicly
readable, against this repo's standing rule that a wrong public link is an
accusation. Removed by hand here; the general fix is either `-d` on a scoped sync
or a post-sync orphan check, and neither exists today.

Note also that `gsutil -m` interleaves parallel progress output, so `Copying
file://…` lines get overwritten by progress bars and a line-oriented grep of the
log **undercounts uploads badly** — it showed 7 objects where 896 had in fact
uploaded. Verify a sync against `gsutil ls -l` timestamps, never against the log.

**Cost model consequence for this plan.** The person chain has the same shape the
procurement legs had before Phase 1-4: a long serial tail dominated by two steps
(`resolve` 41%, `--resolve` 19% — 60% of the total between them), where the
expensive work is recomputed on a 0.5-vCPU instance rather than shipped from a
machine that already computed it. `db:refresh` performs the identical resolve
locally in ~5-6 min. Whether the person tables can be SHIPPED (the `lib/ship.ts`
pattern) rather than recomputed is unexamined and is the obvious next question —
the blocker to check first is that `person_slug_lock` accumulates per database, so
a shipped `person` table would import slug decisions the target never made
(CLAUDE.md's `person:slugs:cloud` note explains why the two databases hand the same
people different slugs).

---

### F23 — the whole publish, measured: 5 h 34 m over 25 steps, and it is TWO whales

F22 timed the person chain. This is the complete post-watch-report publish, run
2026-08-11/12 in the corrected order, every step `rc=0`.

| step | s | share |
|---|---:|---:|
| `prices --backfill` (2 days) | **6690** | **33.4%** |
| `db:load:pg:cloud` (contracts) | **5006** | **25.0%** |
| `db:resolve:persons:cloud` | 1637 | 8.2% |
| `db:load:procurement-scopes:pg:cloud` | 1333 | 6.7% |
| `db:load:tenders:pg:cloud` | 1277 | 6.4% |
| `db:load:declarations:pg:cloud -- --resolve` | 921 | 4.6% |
| `db:load:awarder-seats:pg:cloud` | 895 | 4.5% |
| `db:load:persons-browse:pg:cloud` | 520 | 2.6% |
| `db:load:person-search:pg:cloud` | 493 | 2.5% |
| `db:load:graph:pg:cloud` | 259 | 1.3% |
| `db:load:transport-project-map:pg:cloud` | 216 | 1.1% |
| `bucket:sync:paths` (15 paths) | 202 | 1.0% |
| `kzk_appeals.ts --apply` (live crawl) | 193 | 1.0% |
| `db:load:person-elections:pg:cloud` | 177 | 0.9% |
| `db:load:tr-company-place:pg:cloud` | 74 | 0.4% |
| `db:load:annexes:pg:cloud` | 60 | 0.3% |
| the other 9 steps, summed | 85 | 0.4% |
| **total** | **20023** | **5 h 34 m** |

**Two steps are 58.4% of the publish and seven are 88.7%.** Nine steps finish in
under 20 s. Any future work on this plan that is not aimed at `prices` or
`contracts` is rounding error.

**`prices` is the largest step in the entire publish and this plan has never
mentioned it.** 6690 s to publish a TWO-DAY windowed backfill — more than the
whole contracts corpus. The load itself is fast (both days' facts land in the
first few minutes: +6,012 then +202,123, with 0 unmatched SKUs); the cost is the
payload rebuild that follows, `[product-days] 3,000 head products in 16
weight-balanced batches`, each batch a multi-minute `WITH head AS (SELECT
unnest($1::bigint[]) …)` on the 0.5-vCPU instance. It logs only at phase
boundaries, so it is silent for ~30-minute stretches and looks hung when it is
not — check `pg_stat_activity` rather than the log. This is the same
recompute-on-the-small-instance shape the plan's Phase 1-4 fixed elsewhere, and
it is now the single biggest target.

**`contracts` has drifted to 5006 s (83.4 min) from the ~68 min in CLAUDE.md.**
The corpus is 408,832 rows. Re-baseline the figure quoted in the docs.

**The scoped matviews are refreshed THREE times in one chain.** `db:load:pg`
refreshes all six (119/122/123/124 + the two settlement ones); `awarder-seats`
refreshes 119/123/124 because it moves which buyer sits where; `procurement-scopes`
then refreshes all six again. Each loader is individually correct — it guards its
own inputs — and no loader knows another already did the work. Combined
895 + 1333 = 2228 s, of which a large part is duplicated. A publish-level
"refresh the scoped set once, at the end" would be the cheapest large win after
the two whales.

**`magistrates` costs 15 seconds and its omission costs 481 people.** It is a
`db:resolve:persons` PREREQUISITE (CLAUDE.md is explicit), and the emitted chain
had it in the standalone group AFTER the person steps. Running it there does not
help: the resolve has already happened. Measured on the first pass of this
publish, prod served 3,113 magistrate persons against local's 3,594 — 481
profiles missing at a 200, every row count reconciling — until magistrates was
moved above `judicial-bodies` → `resolve`. **Ordering, not cost:** the fix is 15 s
in the right place and ~30 min of re-resolve in the wrong one.

**`resolve_persons` measured a fourth time: 1637 s.** Same-day range on an
unchanged corpus is **1332-1733 s** across four runs. Plan for ~27 min ±15%; a
single datapoint on this step is not worth quoting.

**Prod verified against local after the run** — magistrate persons 3594/3594,
MP↔declarant split pairs 124/124, MPs affected 72/72, contracts 408,832/408,832,
declarations resolved 49,627, unlicensed cross-source merges 0. One asymmetry
worth noting in the other direction: prod has **3133** magistrate roles carrying a
court against local's 3124, because the cloud run did magistrates →
`judicial-bodies` → resolve in that order while local's `judicial_body` table
predates its last magistrate load. Local is the stale one; a local
`db:load:judicial-bodies:pg` + re-resolve would close it.
