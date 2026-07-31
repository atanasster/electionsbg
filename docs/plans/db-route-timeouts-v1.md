# Stop the three remaining `/api/db` routes timing out at 10 s (migration 124)

Three routes still hit the 10 s `statement_timeout` set at `functions/index.js:427` and
return HTTP 500 in production. They are **two different defects**, and only one of them is
the shape [procurement-settlement-precompute-v1](docs/plans/procurement-settlement-precompute-v1.md)
already solved.

Status: **plan only, nothing implemented.** Every local number below is measured on
2026-07-31 against the local Docker Postgres (`:5433`), warm buffers. The production 500s
are from Cloud Run logs (`elections-bg`, service `db`, `europe-west3`, last 24 h).

---

## 1. The defects

| Route | Prod | Cause | Fix |
|---|---|---|---|
| `/api/db/procurement-overview?from=2023-04-02&to=2024-06-09` | 10.010 s → 500 | Windowed scope falls through to a live whole-corpus aggregate; only `all` is cached (025) | Per-scope precompute |
| `/api/db/procurement-flow` | 10.006 s → 500 | Same aggregate shape, **no cache at all**, not even for `all` | Per-scope precompute |
| `/api/db/person-profile?slug=ОБЩИНА КИРКОВО` | 10.034 s and 10.051 s → 500 | `person_by_name` full-scans `person` **and** re-evaluates the fold per row | Query rewrite — **not** a precompute |

The third is the one worth separating out. It looks like the other two from the log line and
is nothing like them underneath: it is a *lookup* that has been accidentally turned into a
scan, it has both indexes it needs already, and it is fixed by changing one function body.
Precomputing it would be building a cache for a point query.

### 1.1 `person_by_name` — two stacked defects, both in one SQL function

`/api/db/person-profile` tries `person_by_slug` first (6.7 ms, index seek on
`person_slug_key`) and only calls `person_by_name` when that misses. `ОБЩИНА КИРКОВО` is an
institution name, not a person, so both miss — and the route spends 10 s producing `null`.

`EXPLAIN (ANALYZE, BUFFERS)` of the function body, planned the way a SQL function's
parameter actually plans it (`plan_cache_mode = force_generic_plan`):

```
Index Scan using person_slug_key on person p  (actual time=318.493..318.494 rows=0)
  Filter: (is_public_figure AND (status = 'active')
           AND ((name_fold = translit_bg_latin($1)) OR (hashed SubPlan 2)))
  Rows Removed by Filter: 58152
  Buffers: shared hit=3912
Execution Time: 318.562 ms
```

Two things are wrong there, and they compound:

1. **The `OR` defeats both indexes.** `idx_person_name_fold` (btree on `name_fold`) and
   `idx_person_alias_fold` (btree on `alias_fold`) both exist and neither drives the scan.
   Postgres cannot use an index for `a = x OR EXISTS(...)`, so it reads **every one of the
   58,152 person rows** — 3,912 buffers, ~31 MB.
2. **The fold is re-evaluated per row.** In the generic plan the filter reads
   `name_fold = translit_bg_latin($1)`, not a constant. `translit_bg_latin` is `IMMUTABLE`
   and cheap (~0.2 µs), but 58,152 calls is ~290 ms of the 318 ms. Planned with a *literal*
   the same query is 12 ms — which is why this never showed up in a `psql` spot check.

The 31 MB is the part that matters on prod. Local warm those 3,912 buffers are already in
cache; on a `db-g1-small` with a cold buffer cache they are 31 MB of random reads on the
miss path — the same cold-cache multiplier §1 of the settlement plan measured at ~25×.

**And the miss path is the one arbitrary input reaches.** A real `/person/{slug}` link never
calls `person_by_name` at all. Every crawler hit, stale link and hand-typed URL does. That
makes this not only a latency defect but the cheapest way to make the `db` service do 31 MB
of I/O per request.

### 1.2 `procurement_overview` and `procurement_flow` — whole-corpus aggregates

Local, warm, per `EXPLAIN (ANALYZE, BUFFERS)`. Buffers are ×8 kB:

| Function | `all` (NULL/NULL) | Buffers | `ns:2023_04_02` | Buffers |
|---|---|---|---|---|
| `procurement_overview` | 1,323 ms | 199,323 (1.6 GB) | **136 ms** | **45,375** (363 MB) + 3,350 temp |
| `procurement_flow` | **598 ms** | **395,166** (3.2 GB) | 117 ms | — |

A `db-g1-small` has 1.7 GB of RAM. `procurement_flow(NULL, NULL)` touches ~3.2 GB of pages —
it cannot be served from cache on that instance at any point, which is why it is the one that
500s with no window at all.

Neither is an indexing problem, for the same reason §1 of the settlement plan gave: the cost
is `GROUP BY` over the contract corpus, and no index removes a grouped aggregate. The only
way to stop paying it per request is to stop computing it per request.

### 1.3 Four *more* routes share this defect — measured, not assumed

The three that 500'd in the last 24 h are not the whole set. The rest of the
procurement-dashboard function family is the same shape, and two of them are **worse** than
`procurement_flow`:

| Function | `all` | Buffers (`all`) | `ns` window | Buffers (window) | Cache today |
|---|---|---|---|---|---|
| `procurement_overview` | 1,323 ms | 199,323 | 136 ms | 45,375 | `all` only (025) |
| `procurement_rankings` | 1,240 ms | **444,064** | 161 ms | 56,254 | `all` only (031) |
| `procurement_concentration` | 664 ms | **457,712** | 103 ms | 58,887 | **none** |
| `procurement_flow` | 598 ms | 395,166 | 117 ms | — | **none** |
| `procurement_sectors` | 525 ms | **438,753** | 71 ms | 51,624 | **none** |
| `procurement_benchmarks` | 296 ms | 299,048 | 50 ms | 38,888 | **none** |

`procurement_concentration` touches more pages than `procurement_flow` and has no cache
whatsoever. It has not 500'd yet; nothing about the code makes it safer, only its traffic.

This is a scope decision, not a discovery to act on silently — see §2.3. The plan below is
written for **all six**, with the two-kind variant costed alongside it.

---

## 2. Why a precompute, and how wide

### 2.1 The windows already exist and already match

`procurement_scopes` (118) enumerates all 30 windows, written by
`load_procurement_scopes_pg.ts` from `src/data/scope/windows.ts` — *the same function the
React hook calls*. Verified against the failing request:

```
ns:2023_04_02   date_from 2023-04-02   date_to 2024-06-09   ← the 500ing overview URL, exactly
all             date_from NULL         date_to NULL         ← the 500ing flow call
```

`useProcurementByNs` does not go through `useScopeWindow` — it derives `from`/`to` from
`elections.json` directly — but it produces the same pair by construction:
`[selected election, next-newer election)`, and `to = null` for the newest. That is 118's
`ns:` definition verbatim. No client change is needed for any of the six routes.

### 2.2 The fan-out is cheap

Measured end to end, local warm, on the exact `UNION ALL` shape §3.1 ships:

| Coverage | Rows | Size | Build |
|---|---|---|---|
| `overview` only, 30 scopes | 30 | 837 kB | 3.7 s |
| `flow` only, 30 scopes | 30 | 3.46 MB (max row 446 kB) | 3.5 s |
| **All six kinds × 30 scopes** | **180** | **26 MB** (max row 988 kB) | **13.1 s** |
| **NULL payloads** | | | **0 of 180** |

For comparison, the precomputes already on this path: 119 ~12 s, 122 ~20 s, 123 ~9.3 s /
22 MB. The whole six-kind family costs **13.1 s and 26 MB** — in line with a single one of
its neighbours, and it lands in a loader that already takes ~40 s.

The zero-NULL result is load-bearing for §3.2: every `(kind, scope)` pair yields a real
object, so "row present, payload NULL" is unambiguously *not built* and never a legitimate
empty. That makes the miss logic simpler than 123's, which had to distinguish "this
settlement has no seated buyer" from "this scope was never built".

### 2.3 Two kinds or six

| | Two (`overview`, `flow`) | Six (the family) |
|---|---|---|
| Build | ~7.2 s | 13.1 s |
| Size | 4.3 MB | 26 MB |
| Code paths | one shared helper | **the same one shared helper** |
| Routes still able to 500 | 4 | 0 |

The marginal cost of the four extra kinds is ~6 s of loader time and 22 MB. The marginal
code is four more strings in a `UNION ALL` and four one-line route changes, because §3.2's
helper is shared. Recommended: **six.** Shipping two leaves
`procurement_concentration` — the heaviest of the set — uncached, which is the state that
produced this plan.

If only the two are wanted, everything below holds unchanged; delete four lines from §3.1
and four from §3.3.

### 2.4 Rejected alternatives

| Option | Why not |
|---|---|
| Add an index (procurement) | The cost is a `GROUP BY` over the corpus, not a lookup. |
| Add an index (`person_by_name`) | Both needed indexes **already exist**. The `OR` is what stops them being used; a third index would not be used either. |
| Raise `statement_timeout` | Turns a 500 into a 10 s page, and weakens a guard protecting ~40 other routes. |
| Cache in the function | Per-instance, cold on every deploy and scale-out, invisible when stale. |
| One matview per function | Six near-identical files and six entries to keep in step, for a table whose whole content is `(kind, scope_key, payload)`. |

---

## 3. Design

### 3.1 `person_by_name` — rewrite in place (082), no new object

Turn the `OR` into a `UNION` of two index-driven branches, and materialize the fold once so
it is computed one time rather than per row:

```sql
CREATE OR REPLACE FUNCTION person_by_name(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- MATERIALIZED, deliberately: without it the fold inlines into each branch's index
  -- condition as translit_bg_latin($1) and a SQL function's generic plan re-evaluates it
  -- once per candidate row. That was ~290 ms of the 318 ms this function used to cost.
  WITH f AS MATERIALIZED (SELECT translit_bg_latin(p_name) AS fold),
  m AS (
    -- UNION, not OR. `name_fold = fold OR EXISTS(alias …)` cannot use either btree index,
    -- so it read all 58,152 person rows (3,912 buffers) to answer a point lookup. Split
    -- into two branches, each rides its own index: idx_person_name_fold /
    -- idx_person_alias_fold. UNION (not UNION ALL) preserves the DISTINCT the OR form had.
    SELECT u.slug FROM (
      SELECT p.slug FROM person p, f
       WHERE p.name_fold = f.fold
         AND p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
      UNION
      SELECT p.slug FROM f
       JOIN person_alias a ON a.alias_fold = f.fold
       JOIN person p ON p.person_id = a.person_id
       WHERE p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
    ) u LIMIT 2
  )
  SELECT CASE WHEN (SELECT count(*) FROM m) = 1
    THEN person_by_slug((SELECT slug FROM m LIMIT 1)) END;
$$;
```

Measured, same `force_generic_plan` conditions as §1.1:

| | Before | After |
|---|---|---|
| Execution | 318.6 ms | **1.9 ms** (167×) |
| Buffers | 3,912 (31 MB) | **18** (144 kB, 217×) |
| Plan | full scan of `person`, 58,152 rows filtered | two nested loops on `idx_person_name_fold` / `idx_person_alias_fold` |

**The privacy gate and the ambiguity rule are unchanged, and that is checked rather than
argued.** `status = 'active' AND is_public_figure` appears on both branches, and the
`count(*) = 1` wrapper still returns NULL for a 0- or >1-match name. Verified over 553 real
names — 400 active public figures, 50 `review`-status persons, 150 aliases, plus
`ОБЩИНА КИРКОВО`, `Иван Иванов` and `Ivan Ivanov`:

```
compared 553 | mismatches 0 | resolved_old 494 | resolved_new 494
```

`LIMIT 2` moves from inside the `DISTINCT` scan to after the `UNION`. It costs nothing: an
exact fold match returns 1–2 rows, so there is no early-exit to lose.

This ships **independently of everything else in this plan** — one function body, no
migration, no loader, no route change. `apply_functions.ts 082_person_api.sql` on each
database.

### 3.2 Migration `124_procurement_payloads.sql`

One matview, one row per `(kind, scope_key)`:

```sql
CREATE MATERIALIZED VIEW procurement_payloads AS
  SELECT 'overview'::text AS kind, scope_key,
         procurement_overview(date_from, date_to) AS payload      FROM procurement_scopes
  UNION ALL SELECT 'flow',          scope_key,
         procurement_flow(date_from, date_to)                     FROM procurement_scopes
  UNION ALL SELECT 'rankings',      scope_key,
         procurement_rankings(date_from, date_to)                 FROM procurement_scopes
  UNION ALL SELECT 'concentration', scope_key,
         procurement_concentration(date_from, date_to)            FROM procurement_scopes
  UNION ALL SELECT 'sectors',       scope_key,
         procurement_sectors(date_from, date_to)                  FROM procurement_scopes
  UNION ALL SELECT 'benchmarks',    scope_key,
         procurement_benchmarks(date_from, date_to)               FROM procurement_scopes
WITH NO DATA;

CREATE UNIQUE INDEX idx_pp_kind_scope ON procurement_payloads (kind, scope_key);
GRANT SELECT ON procurement_payloads TO app_readonly;
```

Conventions inherited from 119/122/123, each for the reason those files state:

- **It unnests the existing functions rather than re-implementing them.** A methodology
  change lands in 025/026/027/031/036/037 alone and this follows.
- **`WITH NO DATA`** — the file applies in one implicit transaction; a populating `CREATE`
  would hold an `AccessExclusiveLock` for the whole 13 s build *and* be recomputed by the
  loader's `REFRESH` immediately after.
- **One unique index, and only one.** The matview is read by exactly one query shape, a
  `(kind, scope_key)` point lookup, and `REFRESH … CONCURRENTLY` requires the unique key
  anyway.
- **The explicit `GRANT`** — belt-and-braces, but §3.3's fallback means a database whose
  default privileges were never applied would not fail loudly; it would serve the live path
  forever, correctly, at today's speed.

`kind` is `text` rather than an enum so that adding a seventh function is a one-line change
here and one line in §3.3's `KIND` map, with no type migration.

**Inputs: `contracts` only.** None of the six functions reads `awarder_seats` or `place_dim`,
so in `SCOPED_MATVIEWS` terms this is `inputs: ["contracts"]` — the same narrow declaration
`contractor_rank` carries, and for the same reason. A seats or place reload must **not**
rebuild it; that is 22 MB of pointless work on an input it cannot see.

### 3.3 Route change — one shared helper, NULL-safe

All six routes become one call. The lookup **must** use `IS NOT DISTINCT FROM`, for the
reason [procurement-settlement-precompute-v1 §3.2](docs/plans/procurement-settlement-precompute-v1.md)
sets out at length and which applies here identically: two of the thirty scopes carry a NULL
bound, and they are the two that matter —

```
all            date_from NULL, date_to NULL   ← the AI tools, and /api/db/procurement-flow's 500
ns:2026_04_19  date_from 2026-04-19, to NULL  ← the newest parliament = the page DEFAULT
```

`date_from = NULL` is never true. With `=`, this change would serve precomputed rows for the
16 `y:` windows and the 12 *closed* `ns:` windows — every one of which a spot check would
pass — while `all` and the default parliament, the two that produced the 500s, missed on
every request forever.

```js
// Every per-scope payload route (124). The (from,to) → scope_key mapping is NULL-SAFE:
// `all` and the newest parliament both carry a NULL bound, the client omits the parameter
// when a bound is null, and `date_from = NULL` is never true — so `=` here would miss on
// exactly the two scopes that 500 while passing every spot check. See
// docs/plans/db-route-timeouts-v1.md §3.3.
const scopedPayload = async (dbRows, kind, from, to) => {
  try {
    // Every (kind, scope) pair has a non-NULL payload by construction (180/180 measured),
    // so — unlike 123 — a present row with a NULL payload is unambiguously "not built"
    // and there is no legitimate-empty case to distinguish.
    const hit = await dbRows(
      `SELECT sc.scope_key, p.payload AS r
         FROM procurement_scopes sc
         LEFT JOIN procurement_payloads p
           ON p.kind = $1 AND p.scope_key = sc.scope_key
        WHERE sc.date_from IS NOT DISTINCT FROM $2
          AND sc.date_to   IS NOT DISTINCT FROM $3
        ORDER BY sc.sort_ord
        LIMIT 1`,
      [kind, from, to],
    );
    if (!hit.length) {
      // Keyed on a CONSTANT + kind, never on the window: from/to are raw query parameters
      // and keying on them would let any caller grow this Set without bound.
      logMissOnce(`pp:no-scope:${kind}`, `${kind}: [${from} , ${to}) is not a precomputed scope — serving live. (Logged once.)`);
    } else if (!hit[0].r) {
      logMissOnce(`pp:not-built:${kind}:${hit[0].scope_key}`,
        `${kind}: procurement_payloads holds no payload for ${hit[0].scope_key} — serving live. Run db:load:procurement-scopes:pg.`);
    }
    if (hit[0]?.r) return hit[0].r;
  } catch (e) {
    // NARROW, exactly as the settlement route: degrade only where the live path is the
    // better answer — matview absent (42P01), unreadable (42501), or locked by a plain
    // REFRESH (55P03 / 57014). A pool error is none of these; retrying it as a second,
    // heavier query just doubles the load on a saturated pool, so it rethrows.
    if (!["42P01", "42501", "55P03", "57014"].includes(e?.code)) throw e;
    logMissOnce(`pp:read-failed:${kind}:${e.code}`, `${kind}: precompute read failed (${e.code}) — serving live.`);
  }
  return null;
};
```

Each route becomes:

```js
"procurement-flow": async (dbRows, q) => {
  const from = orNull(q, "from"), to = orNull(q, "to");
  const hit = await scopedPayload(dbRows, "flow", from, to);
  if (hit) return { body: hit };
  const rows = await dbRows("SELECT procurement_flow($1, $2) AS r", [from, to]);
  return { body: rows[0]?.r ?? null };
},
```

**Degrading to live is correct here**, for the reason
[§3.3 of the settlement plan](docs/plans/procurement-settlement-precompute-v1.md) gives and
which does not transfer from `cpv_catalog`: degrading `cpv_catalog` yields a *wrong* answer
(an empty picker); degrading this yields the *right* answer, slowly — today's behaviour. So
the route ships in any order, to any database.

The cost is that every reason the fast path was skipped is otherwise silent, which is what
`logMissOnce` buys. `lock_timeout: 2000` is already set pool-wide (`functions/index.js`, from
123), so a read landing mid-`REFRESH` becomes a fast miss rather than a 10 s wait followed by
a fallback with no budget left.

### 3.4 The existing `all`-only caches (025, 031) are subsumed — retire them, but last

`procurement_overview_cache` (025) and `procurement_rankings_cache` (031) answer exactly what
`procurement_payloads` answers for `scope_key = 'all'`. Two caches for one question is the
drift this codebase keeps paying for, so they go — but **not in the same step**, because the
ordering has a real failure window:

- If the route stops reading `procurement_overview_cache` before 124 is populated on Cloud
  SQL, the full-corpus overview (1,323 ms, 199k buffers locally) reverts to live on prod,
  where it is a plausible 500 in its own right.

So §5 sequences the retirement **after** acceptance confirms 124 is being read on prod. Until
then the two matviews stay, unread by the new route and still refreshed by `load_pg` — dead
weight for one deploy cycle, which is the cheap side of this trade.

Correctness is order-free either way (§3.3); this is purely about not putting the
full-corpus scope back on the live path for the length of a deploy.

---

## 4. Wiring

`load_procurement_scopes_pg.ts` already applies 119/122/123 and refreshes their five
matviews via `scripts/db/lib/scopedMatviews.ts`. 124 joins that list — `SCOPED_MATVIEWS`
gains one entry:

```ts
// 124 — the per-scope dashboard payloads behind /api/db/procurement-{overview,flow,
// rankings,concentration,sectors,benchmarks}. contracts ONLY: none of the six functions
// reads awarder_seats or place_dim, so a seats or place reload must not rebuild it.
{ name: "procurement_payloads", inputs: ["contracts"] },
```

Position: after `contractor_scope_kpis`, before `procurement_settlement_payloads`. It has no
dependency on any other entry, so the placement is free; this keeps the two existing pairwise
orderings (`contractor_rank` → `contractor_scope_kpis`) undisturbed.

`procurement_settlement_payloads.data.test.ts` already fails on any matview that reads
`procurement_scopes` and is missing from `SCOPED_MATVIEWS`, so forgetting this line is caught
by an existing gate rather than by a stale page.

| Trigger | Command | Why |
|---|---|---|
| Scopes change (new election, January rollover) | `db:load:procurement-scopes:pg` | A new `ns:`/`y:` window needs its six rows |
| Contracts reload | `db:load:pg` | Already re-REFRESHes the five; 124 joins that guarded block |
| Cloud | `db:load:procurement-scopes:pg:cloud` | Nothing on the cloud side is automatic |
| `awarder_seats` / `place_dim` reload | — | **Deliberately not a trigger.** Neither is an input. |

Expect the scopes loader to go from ~40 s to ~53 s locally. **Cloud SQL is unmeasured and
will be materially slower** — 123's 9.3 s local build took 75 s on Cloud SQL, a factor of 8.
Budget for minutes, and record the real number on the first run.

---

## 5. Steps

| # | Step | Files |
|---|---|---|
| 1 | Rewrite `person_by_name` (§3.1) | `scripts/db/schema/pg/082_person_api.sql` |
| 2 | Data test: the rewrite resolves, rejects ambiguity, and holds the privacy gate | `scripts/db/tests/person_search.data.test.ts` |
| 3 | Migration 124 — matview + unique index + `GRANT` (§3.2) | `scripts/db/schema/pg/124_procurement_payloads.sql` |
| 4 | Wire into `SCOPED_MATVIEWS`, the scopes loader's apply list, and `load_pg`'s guarded refresh block | `scripts/db/lib/scopedMatviews.ts`, `scripts/db/load_procurement_scopes_pg.ts`, `scripts/db/load_pg.ts` |
| 5 | Route: the shared `scopedPayload` helper + the six call sites (§3.3) | `functions/db_routes.js` |
| 6 | Route tests — **no-window request HITS**, `ns:` window hits, non-scope window falls back, matview-absent falls back | `functions/db_routes.procurement.test.js` |
| 7 | Data test: 180 rows, 0 NULL payloads, stored == live across all three scope kinds, `SCOPED_MATVIEWS` exhaustive | `scripts/db/tests/procurement_payloads.data.test.ts` |
| 8 | CLAUDE.md: 124 in the cloud-loader list, alongside 119/122/123 | `CLAUDE.md` |
| 9 | Deploy: `db:load:procurement-scopes:pg:cloud` → `deploy:db`; re-measure prod | — |
| 10 | **After acceptance only** — retire 025/031's caches (§3.4): drop the route reads, the matviews, and their `load_pg` REFRESHes | `functions/db_routes.js`, `scripts/db/schema/pg/025_*.sql`, `031_*.sql`, `scripts/db/load_pg.ts` |

**Step 6's first test is the one that earns its place**, exactly as in the settlement plan. A
request carrying neither `?from` nor `?to` is what the AI tools send and what
`/api/db/procurement-flow` 500'd on. The other three tests all pass against a NULL-unsafe
lookup: a `y:` scope hits, a bogus window falls back as designed, an absent matview falls
back. Only an assertion that the **no-window request reads the matview** distinguishes "the
fallback works" from "the fallback is all that works". Step 7 cannot cover it either — it
tests the matview's contents, not the route's mapping into it.

Steps 1–2 are independent of 3–10 and can ship first; they need no migration, no loader and
no deploy ordering. Steps 3–4 are shippable alone (the matview is inert until step 5 reads
it). Step 5 is the visible change.

For step 9, prefer `apply_functions.ts 124_procurement_payloads.sql` plus a single plain
`REFRESH` over the full scopes loader, for the reason
[§7.2 of the settlement plan](docs/plans/procurement-settlement-precompute-v1.md) records:
the loader DROPs and recreates 119's and 122's matviews before refreshing them, and the
routes reading *those* do not degrade — running it would mean a multi-minute 500 window on
`/procurement/by-settlement` and `/procurement/contractors` to rebuild data already correct
on cloud. 124 is new and unread, so applying and refreshing it alone is zero-impact. Use the
loader when the **scopes** change, which is what it is for.

---

## 6. Acceptance

- `/api/db/procurement-flow` (no window) and
  `/api/db/procurement-overview?from=2023-04-02&to=2024-06-09` return **200** on a cold
  production instance, and so do the four other family routes on both the `all` and the
  default open-ended `ns:` scope — not only on a `y:` window, which would pass while §3.3's
  NULL hazard is live.
- `/api/db/person-profile?slug=ОБЩИНА КИРКОВО` returns **200 with a null body** in
  single-digit ms.
- No `httpRequest.latency` near `10.0xx s` for any of these routes in Cloud Run logs over
  24 h:
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="db" AND httpRequest.latency>="9s"' --project elections-bg --freshness=24h --limit=20 --format="value(timestamp,httpRequest.latency,httpRequest.status,httpRequest.requestUrl)"
  ```
- **No `pp:not-built` or `pp:read-failed` log lines** after the loader has run. This is the
  criterion that fails loudly if the lookup, the `GRANT` or the cloud-side loader is wrong;
  every latency criterion above can be met by a fallback quietly doing the work.
  `pp:no-scope` is exempt — a caller may legitimately ask for a window that is not one of the
  thirty, and serving that live is the designed behaviour.
- Step 7's data test proves stored == live across `all`, a `y:` and an `ns:` scope, and that
  all 180 payloads are non-NULL.
- Step 2's test proves `person_by_name` still returns NULL for a `review`-status person, a
  non-public figure, and an ambiguous name.

**On end-to-end expectations.** As in the settlement plan, the database side becomes a point
lookup and effectively free, but `/api/db/*` responses still go out uncompressed and uncached
(~344 ms connection setup, and `flow`'s `all` payload is 446 kB on the wire — the largest in
this set by far). That belongs to
[db-payload-diet-v1](docs/plans/db-payload-diet-v1.md) and is untouched here. Hold acceptance
on **DB time and the absence of the 10 s ceiling**, which is what this work controls.

---

## 7. What this plan does not fix

- **Transport.** See above; 446 kB uncompressed for the flow graph is the next bottleneck on
  that route and this plan makes it the *dominant* one.
- **Staleness.** A precompute trades a slow query for a quiet staleness risk. Here the risk
  is narrower than 123's — the only input is `contracts`, and both paths that reload it
  (`db:load:pg`, `db:load:procurement-scopes:pg`) refresh 124 — but step 7's stored-vs-live
  assertion is what actually catches it.
- **The live path during a contracts reload.** `lock_timeout: 2000` turns a mid-`REFRESH`
  read into a fast miss, but while a contracts reload holds its own `AccessExclusiveLock` the
  *live* fallback is cut off too. The route still fails then — in 2 s rather than 10.
