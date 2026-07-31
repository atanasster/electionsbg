# Stop `/api/db/person-connections` timing out at 10 s (084 query rewrite)

`/api/db/person-connections` ran at **8.2–10.1 s** in production — still 200, but one request
already **over** the pool's 10 s `statement_timeout` (`functions/index.js:427`), i.e. one bad
day from a 500. Flagged as the next `person_by_name`-shaped defect in
[db-route-timeouts-v1 §9.1](docs/plans/db-route-timeouts-v1.md), which is this plan's worked
example.

Status: **IMPLEMENTED AND LIVE** (see §6 for the production measurements). Local numbers are
measured on 2026-07-31 against the local Docker Postgres (`:5433`); the prod numbers are from
Cloud SQL through the proxy and from Cloud Run `httpRequest.latency`.

---

## 1. The defect

This is db-route-timeouts-v1's **outcome 1 — a query rewrite**, not an index and not a
precompute. There is no new object, no loader, no matview, no `SCOPED_MATVIEWS` entry and no
route change.

`person_connections` opened with a `co` CTE: the distinct-public-officer count **per company**,
which is the input to the association-noise guard (drop any company with more than 6 public
officers — a board or professional association is not a business tie).

```sql
co AS (
  SELECT r.ref AS eik, count(DISTINCT r.person_id) AS officers
    FROM person_role r JOIN person p USING (person_id)
   WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
   GROUP BY r.ref
),
```

The file's own comment called this "cheap". `EXPLAIN (ANALYZE, BUFFERS)` of the function body,
planned the way a SQL function's parameter actually plans it (`plan_cache_mode =
force_generic_plan` — a literal lets the planner constant-fold what a parameter cannot):

```
CTE Scan on subj  (actual time=65.519..65.528 rows=1)
  Buffers: shared hit=6984
  CTE co
    ->  GroupAggregate (actual time=55.660..59.962 rows=18278)
          Buffers: shared hit=6737
          ->  Hash Join (rows=32412)
                ->  Seq Scan on person_role r   (rows=32412, Rows Removed by Filter: 111452)
                      Buffers: shared hit=3880
                ->  Seq Scan on person p        (rows=56910)
                      Buffers: shared hit=2857
Execution Time: 66.063 ms
```

Three things compound:

1. **It is 96.5% of the query.** 6,737 of 6,984 buffers and 60 ms of the 66 ms. The actual
   per-subject graph traversal — the thing the function is *for* — is ~250 buffers.
2. **It is entirely independent of the subject.** The same 18,278-row map is rebuilt on every
   request, for every person, from two sequential scans. Only **~19–38** of those companies are
   ever consulted.
3. **A person with no companies pays it in full.** `co` is referenced twice, so Postgres
   materializes it rather than inlining — the CTE is built before anything discovers the
   subject has nothing to look up. Measured: **7,294 buffers to return an empty graph.**

### 1.1 Point 3 is the one that matters, because of what the traffic actually is

The prod request log is not users browsing. Every slug appears **exactly once**, in alphabetical
order — a crawler walking `/person/{slug}`:

```
vladimir-metodiev-iordanov-0f3912   vladimir-ivanov-vlchev-459552
vladimir-georgiev-enchev-07a11c     vladimir-chavdarov-simeonov-c10636   …
```

So the population being served is *all persons*, of whom the overwhelming majority have no
company at all. The common case was the expensive one, and its cost was pure waste. This is
the same observation §1.1 of db-route-timeouts-v1 made about `person_by_name`: the miss path
is the one arbitrary input reaches.

### 1.2 Why local looked fine and prod did not

Prod runs the **same corpus** — 58,192 persons and 32,412 tr/ngo roles against local's 58,193
and 32,412 — and the tables are the same size on disk (`person` 2,888 pages vs 2,857,
`person_role` 3,786 vs 3,880, `n_dead_tup` 0 on both). So this is neither a data-volume
difference nor bloat; that hypothesis was checked and disproved. But the same no-company
subject costs:

| | Buffers | Warm |
|---|---|---|
| local (`:5433`) | 7,294 | 66 ms |
| **Cloud SQL** | **25,135** (196 MB) | 362 ms |

3.4× the pages for identical logical content on identically-sized tables. The amplification
was not isolated further — the likely candidate is repeated heap access where local gets a
clean index-only scan — because the fix removes the scan entirely, so there is nothing left
for it to amplify. What matters is the direction it establishes: **196 MB of reads per request
on a `db-g1-small` with 1.7 GB of RAM is the 8–10 s**, local warm wall-clock predicts nothing,
and prod is worse than local by a factor local cannot show you. That is why buffers are the
signal, and why the measurement is taken against Cloud SQL and not only against `:5433`.

---

## 2. The fix

Compute the officer count **per eik** instead of for all 18,278 companies, riding the existing
`idx_person_role_source_ref (source, ref)` + `person_pkey`. Kept as one function rather than
inlined at its two call sites, so `MAX_CO_OFFICERS` (6) and the public-figure/active gate stay
single-sourced exactly as the `co` CTE kept them:

```sql
CREATE OR REPLACE FUNCTION public_officer_count(p_eik text)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT r.person_id)
    FROM person_role r JOIN person p USING (person_id)
   WHERE r.source IN ('tr','ngo') AND r.ref = p_eik
     AND p.is_public_figure AND p.status = 'active';
$$;
```

`co` is deleted; its two consumers become `AND public_officer_count(r.ref) <= 6`. Nothing else
in the function changes.

A single per-eik lookup is **56 buffers / 0.44 ms**, fully index-driven. Per-company fan-out is
bounded by the data: max 55 roles on any one company, mean 1.77.

Measured, same `force_generic_plan` conditions as §1:

| Subject | Before | After |
|---|---|---|
| no companies (the crawler's common case) | 7,294 buffers, 66 ms | **560** buffers, 1.6 ms |
| — the same, with the function body inlined | | **19 buffers**, no seq scan left |
| heaviest real subject in the corpus | 8,242 buffers, 66 ms | **2,160** buffers, **3.7 ms** |

**The `source` filter is applied before the function**, so a person with many non-TR roles does
not pay per role — verified on the person with the most non-tr/ngo roles in the corpus (24 of
them, 0 tr/ngo): 560 buffers, function never called.

### 2.1 Rejected alternatives

| Option | Why not |
|---|---|
| An index | There is no index that removes a `GROUP BY` over the whole table. The fix is to stop asking for all 18,278 groups, not to compute them faster. |
| A precompute matview `(eik, officers)` | Would reach ~150 buffers instead of ~560 — a real but small further gain, bought with a new object, a loader, a `db:load:*:cloud` command, a `SCOPED_MATVIEWS` entry and a standing staleness risk on a table `db:resolve:persons` rewrites. The rewrite already removes 96.5% of the cost with none of that. |
| Raise `statement_timeout` | Turns a slow route into a slower one and weakens a guard protecting ~40 other routes. |
| `VACUUM FULL` on prod to shed the 3.4× bloat | Treats the multiplier, not the defect: 25,135 → ~7,300 buffers still leaves the whole-corpus scan on every request. Worth doing separately (§7). |

---

## 3. Correctness

The rewrite is an algebraic identity — `co` filtered to `officers <= 6` and joined on `eik` is
the same predicate as a per-eik count — with **one edge case that looks like a behaviour change
and is not.** The old `co` was joined with an INNER JOIN, so an eik absent from the map (a
company with no public+active officer) was *dropped*; a scalar count returns 0 for it, and
`0 <= 6` *keeps* it. The two agree because neither call site can reach such an eik: both start
from a person who is themselves public+active (`subj` for `subj_co`, `rel`/`agg` for `p_co`),
and that person's own role contributes to the count, so every candidate eik has a count ≥ 1 by
construction.

That argument is the kind that is right until it isn't, so it is **verified empirically** rather
than trusted.

The pre-fix body was pinned from git as `person_connections_old` and compared against the
applied function over the population that can differ:

```
compared 16,103 | mismatches 0 | 12m29s
  14,103 graph-bearing (every public person with ≥1 tr/ngo role — the COMPLETE population)
   2,000 with no company at all

  subjects with direct edges 4,065   direct edges   7,692
  subjects with indirect     927     indirect edges 2,594
```

The comparison is on the whole `jsonb` payload (`IS DISTINCT FROM`), so subject, direct edges,
indirect edges, bridge companies, party colours, ordering and the disclaimer are all covered —
and the edge counts confirm it is not vacuous: 10,286 edges were actually produced and matched
on both sides, not 16,103 empty payloads compared against each other.

---

## 4. The gate — `scripts/db/tests/person_connections.data.test.ts`

Six tests. Five are behavioural: direct edges resolve and `sharedCount` agrees with the bridge
list; the association-noise guard excludes the corpus's largest mass-membership org; indirect
edges are second-degree only (never direct, never self, never the same company twice); the §6
privacy gate holds on both endpoints and a `review`-status subject is unservable; an unknown
slug returns null and the disclaimer is never droppable.

**The sixth is the one that earns its place**, and it is the reason this file exists rather
than an extra case in an existing one. All five behavioural tests **pass against the old body
too** — the one that was 60 ms of waste per request and reached the timeout on prod.
Correct-but-quadratic is exactly what a behavioural suite cannot see. So the last test asserts
a buffer ceiling for a subject with no companies, and then **proves the ceiling still
discriminates** by restoring the pre-fix body inside a rolled-back transaction and asserting it
would have failed. A ceiling raised to silence a flaky measurement makes *that* assertion fail
instead.

**It skips on the SOURCE, never on the target.** `reachable()` probes `person` / `person_role`
and the function's existence — the inputs. It deliberately does not skip on "the graph came
back empty", because an empty graph is one of the states the file exists to catch.

---

## 5. Deploy

No loader, no migration, no route change, no `deploy:db`. The person serving functions carry no
data, so nothing loads them; the only cloud path that applies 084 is `db:resolve:persons:cloud`,
a multi-hour rebuild that also re-resolves the whole identity layer. Ship the function alone:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 084_person_connections.sql
```

Idempotent and safe at any time — `CREATE OR REPLACE` throughout, no `DROP`, so no dependent
object breaks and there is no window where the route has no function to call.

**A function-only change is invisible to every row count and every loader**: local goes green,
prod keeps running the previous body indefinitely, and nothing reports a difference. That is
the failure mode this section exists to prevent, and it is now recorded in CLAUDE.md.

---

## 6. Production, measured after deploy (2026-07-31)

### Database side (Cloud SQL, via the proxy)

Both measured on a warmed connection, same slugs, same method:

| Subject | Before | After |
|---|---|---|
| no companies (the common crawler case) | 25,135 buffers, 362 ms | **46 buffers, 3.2 ms** |
| `mp-2954` | 25,355 buffers, 401 ms | |
| heaviest subject | 26,105 buffers, 377 ms | |

**546× fewer buffers.** The route stopped touching 196 MB per request.

### Server-side latency (Cloud Run `httpRequest.latency`)

Acceptance is held on `httpRequest.latency`, not end-to-end wall clock: `/api/db/*` responses
go out uncompressed, so transport dominates the browser number and belongs to
[db-payload-diet-v1](docs/plans/db-payload-diet-v1.md).

| | Before | After |
|---|---|---|
| observed range | 8.2–10.1 s (one at 10.073 s, **over** the ceiling) | 0.008–0.747 s |
| median | — | **0.189 s** |
| p95 | — | **0.264 s** |
| status | 200, but one request already past `statement_timeout` | **32/32 200** |

The last request over 1 s was at 20:18:58Z; the most recent batch runs **0.008–0.040 s**. The
0.19–0.26 s band immediately after the change is cold-cache warming, not steady state.

Acceptance met: no request near the 10 s ceiling, no 500, and the improvement is visible in
server-side latency rather than inferred from local timing.

---

## 7. What this does not fix

- **The 3.4× prod bloat.** Cloud SQL touches 25,135 buffers where local touches 7,294 for
  identical logical content. The rewrite makes the route fast regardless, but the bloat still
  taxes every other query against `person` / `person_role`. A separate maintenance concern.
- **Transport.** Unchanged and untouched here.
- **The other defect §9.1 recorded.** `/api/db/price-history` and `/api/db/price-product`
  return 500 at ~2.0–2.1 s — the pool's `lock_timeout`, i.e. a writer holding a lock readers
  queue behind (most likely the daily prices loader's TRUNCATE+COPY). That is a loader-side
  fix (the staging-swap pattern in `reference_contracts_reload_lock`) and is not addressed here.
