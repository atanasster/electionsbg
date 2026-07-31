# Precompute the per-settlement procurement payload (migration 123)

Stop `/api/db/procurement-settlement` from 500-ing on the largest settlements, by
serving it from a per-scope matview instead of an ~10 s live aggregate.

Status: **plan only, nothing implemented.** Every number below is measured, on local
Postgres and against production, on 2026-07-31.

---

## 1. The defect

`procurement_settlement_detail(ekatte, from, to)` runs on every settlement page load and
every My-Area tile. On the largest settlements it exceeds the **10 s `statement_timeout`**
set at `functions/index.js:427`, Postgres aborts it, and the route returns **500**.

Cloud Run logs show the ceiling exactly — two requests at `10.009960s` and `10.009310s`,
0.7 ms apart, the first a 500. That precision is a configured limit, not organic cost:

| EKATTE | First touch | Repeat |
|---|---|---|
| 68134 София | **10.009 s → HTTP 500** | 9.76 s → 0.74 s |
| 10135 Варна | 4.85 s | 0.58 s |
| 07079 Бургас | 1.57 s | — |
| 843 small settlements | 8–25 ms | — |

**It is not cold start.** The `db` service runs `minScale=1` with
`containerConcurrency=80`, so an instance is always warm and collisions are implausible.
Every other `/api/db` route in the same three-hour window stayed under 0.82 s.

The driver is Cloud SQL buffer cache on a `db-g1-small`: cost scales with the settlement's
contract count and collapses on repeat. The same call is **401 ms locally** with warm
buffers — production is ~25× slower on a cold first hit.

### Where the time goes

Measured per-part on София (327 buyers, 64,676 contracts), local warm:

| Part | Time |
|---|---|
| Base scan (contracts ⋈ awarder_seats) | 111 ms |
| **Awarders aggregate** (GROUP BY awarder, `min(name COLLATE "C")`) | **304 ms** |
| byYear aggregate | 109 ms |
| Totals | 24 ms |
| **Whole function** | **401 ms** |

The awarders aggregate dominates. It is a GROUP BY over 64k rows — no index removes it,
which is why this is a precompute problem and not an indexing one.

---

## 2. Why a precompute, and why the whole fan-out

The fan-out is far cheaper than it looks, which removes the usual reasons to hedge:

| Measured | Value |
|---|---|
| Settlements with ≥1 local-tier contract | **869** |
| …of which ≥10k contracts (the ones that 500) | **3** |
| …2k–10k | 23 |
| …under 2k (already 8–25 ms) | **843** |
| Scopes in `procurement_scopes` (118) | **30** |
| Payload, all 869 settlements, corpus scope | **1.3 MB** (avg 1.5 kB, max 59 kB) |
| Time to compute all 869 for one scope | **1.79 s** |

So a complete `(scope × settlement)` precompute is **26,070 rows**, **≤40 MB** (an upper
bound — narrower windows hold fewer buyers), and **~54 s per full refresh**. That is in
line with the two precomputes already on this path: 119 costs ~12 s and 122 ~20 s.

Since the full fan-out is this cheap, **do not special-case the three big settlements**.
Two code paths that answer the same question is the drift this codebase keeps paying for.

### Rejected alternatives

| Option | Why not |
|---|---|
| Add an index | The cost is a GROUP BY over 64k rows, not a lookup. Nothing to index. |
| Raise `statement_timeout` | Converts a 500 into a 10-second page. The reader is no better off, and it weakens a guard that protects every other route. |
| Precompute only the 3 large settlements | Saves ~37 MB and costs a second code path that only executes for the settlements nobody tests. |
| Cache in the function | Per-instance, cold on every deploy and every scale-out, and invisible when stale. |

---

## 3. Design

### 3.1 Migration `123_procurement_settlement_payloads.sql`

One matview, one row per `(scope_key, ekatte)`, carrying the payload the route already
returns:

```sql
CREATE MATERIALIZED VIEW procurement_settlement_payloads AS
SELECT s.scope_key,
       x.ekatte,
       procurement_settlement_detail(x.ekatte, s.date_from, s.date_to) AS payload
FROM procurement_scopes s
CROSS JOIN (SELECT DISTINCT ekatte FROM awarder_seats
            WHERE source = 'geo' AND is_local_hq AND ekatte IS NOT NULL) x
WITH NO DATA;

CREATE UNIQUE INDEX uq_psp ON procurement_settlement_payloads (scope_key, ekatte);
```

Three conventions inherited from 119, each for a stated reason:

- **It unnests the existing function rather than re-implementing the aggregation.** A
  change to the methodology — which buyers count as local-tier, how a tier is labelled —
  lands in `030` alone and this follows. 119's header makes this rule explicit and it is
  the reason its numbers have never drifted from the page's.
- **`WITH NO DATA`.** The file is applied in one implicit transaction, so a populating
  CREATE would hold an `AccessExclusiveLock` for the whole build *and* be recomputed by
  the loader's REFRESH straight after — paying twice, half of it under the lock that
  `CONCURRENTLY` exists to avoid.
- **`REFRESH … CONCURRENTLY`**, which the UNIQUE index above is required for. This is on
  the serving path; a plain REFRESH would stall every settlement page for ~54 s.

### 3.2 Route change — none required at the client

`procurement_scopes` stores **half-open** windows that match `useScopeWindow`'s pair
exactly. Verified:

```
all           = [null,       null)
y:2024        = [2024-01-01, 2025-01-01)
ns:2026_04_19 = [2026-04-19, null)
```

That is precisely what the hook already sends as `?from`/`?to`. So the route maps
`(from, to) → scope_key` with an equality lookup and seeks the matview — **no client
change, and every existing caller benefits**, including the AI tools (which send no
window and therefore map to `all`).

```
/api/db/procurement-settlement?ekatte=…&from=…&to=…
  → look up scope_key for (from, to)
  → HIT:  SELECT payload FROM procurement_settlement_payloads WHERE scope_key=$1 AND ekatte=$2
  → MISS: run procurement_settlement_detail(…) live, as today
```

The existing `?slim=1` / `?limit` trimming is unchanged: it operates on the returned
payload and does not care where it came from.

### 3.3 Degrading to live is CORRECT here — deliberately unlike `cpv_catalog`

CLAUDE.md says the `cpv_catalog` route must **not** degrade a missing table to an empty
array, because "an empty CPV picker served with a 200 is exactly the failure it was
created to end". That rule does not transfer, and the difference is worth stating so
nobody "fixes" it later:

- degrading `cpv_catalog` yields a **wrong** answer (an empty picker);
- degrading this one yields the **right** answer, just slowly (today's behaviour).

So the fallback is kept, and it buys something real: **the route can ship before the
loader has ever run**, on any database, with no first-deploy ordering hazard. That is the
opposite of the `cpv_catalog` / `contractor_rank` constraint.

What the fallback does **not** protect against is staleness — see §5.

---

## 4. Wiring

`load_procurement_scopes_pg.ts` already applies 119 and 122 and refreshes their four
matviews. 123 joins that list, so "the scopes changed" and "the precomputes match the
scopes" can never be two separate states.

| Trigger | Command | Why |
|---|---|---|
| Scopes change (new election, January rollover) | `db:load:procurement-scopes:pg` | A new `ns:` or `y:` window needs its rows |
| Contracts reload | `db:load:pg` | Already re-REFRESHes the other four; 123 joins that guarded block |
| `awarder_seats` reload | `db:load:awarder-seats:pg` | It decides WHICH buyers belong to a settlement — see §5 |
| Cloud | `db:load:procurement-scopes:pg:cloud` | Nothing on the cloud side is automatic |

CLAUDE.md's "the cloud side does not run this" section gains 123 alongside 119/122.

---

## 5. The failure mode this introduces

A precompute trades a slow query for a **staleness** risk, and here it is quiet: a stale
matview serves last week's totals at a 200, and the page looks perfectly healthy. Two
guards:

1. **`awarder_seats` is the sneaky trigger.** The other precomputes on this path depend on
   `contracts` and the scope table. This one also depends on `awarder_seats`, because that
   table decides which buyers are seated in a settlement. Reloading it without refreshing
   123 moves a buyer between settlements everywhere on the site *except* here. This is the
   same shape as CLAUDE.md's note that `contracts` now reads `awarder_seats` through the
   `awarder_ekatte` semi-join.
2. **A data test** — `procurement_settlement_payloads.data.test.ts`, alongside
   `contractor_rank.data.test.ts` and `cpv_catalog.data.test.ts`:
   - the matview is non-empty and carries a row for every `(scope × settlement)` pair;
   - for a sample of settlements across the size range **and all three scope kinds**, the
     stored payload equals `procurement_settlement_detail(...)` computed live — the
     staleness check that a row count cannot make;
   - the sample includes a settlement with **zero** contracts in a narrow window, which
     returns `contractCount: 0` rather than a NULL payload (verified), so the page shows
     "nothing in this period" instead of its not-found branch.

---

## 6. Steps

| # | Step | Files |
|---|---|---|
| 1 | Migration 123 — matview + unique index + the two supporting indexes | `scripts/db/schema/pg/123_procurement_settlement_payloads.sql` |
| 2 | Wire into the scopes loader (apply + REFRESH CONCURRENTLY) and into `db:load:pg`'s guarded refresh block | `scripts/db/load_procurement_scopes_pg.ts`, `scripts/db/load_pg.ts` |
| 3 | Route: map `(from,to) → scope_key`, seek the matview, fall back to live on a miss | `functions/db_routes.js` |
| 4 | Route tests: hit, miss-falls-back, matview-absent-falls-back, `?slim` unaffected | `functions/db_routes.settlement.test.js` |
| 5 | Data test (§5.2) | `scripts/db/tests/procurement_settlement_payloads.data.test.ts` |
| 6 | CLAUDE.md: add 123 to the cloud-loader list and the `awarder_seats` trigger | `CLAUDE.md` |
| 7 | Re-measure prod: София cold, and confirm no 500 at the 10 s ceiling | — |

Steps 1–2 are shippable alone (the matview is inert until the route reads it). Step 3 is
the visible change. Because of §3.3 there is **no required ordering** between the loader
and the deploy — the route is correct either way, only slower without the matview.

---

## 7. Acceptance

- `/api/db/procurement-settlement?ekatte=68134` returns **200 in well under 1 s on a cold
  production instance**, versus the current 10 s → 500.
- No `httpRequest.latency` near `10.009s` for this route in Cloud Run logs over 24 h.
- The data test proves the stored payload equals the live function across all three scope
  kinds.
- The settlement page's two halves still reconcile — the existing
  `procurement_settlement_scope.data.test.ts` keeps passing, since the contracts table is
  untouched by this work.

---

## 8. Out of scope

The **transport** costs measured alongside this and belonging to
[db-payload-diet-v1](docs/plans/db-payload-diet-v1.md) T0: `/api/db/*` responses go out
uncompressed and uncached, so a warm 24 KB settlement payload still spends ~180 ms on the
wire and ~344 ms on connection setup. Fixing the query does not touch either. Both plans
are needed for the page to feel fast; neither substitutes for the other.
