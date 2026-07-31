# Precompute the per-settlement procurement payload (migration 123)

Stop `/api/db/procurement-settlement` from 500-ing on the largest settlements, by
serving it from a per-scope matview instead of an ~10 s live aggregate.

Status: **plan only, nothing implemented.** Every number below is measured, on local
Postgres and against production, on 2026-07-31. The §2 fan-out figures and the §3.2
scope-lookup were re-measured in an audit the same day; where the audit and the first
pass disagree, the audit's number is the one written here.

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
| Payload, all 869 settlements, corpus scope | **1.3 MB** (1,303 kB; avg 1.5 kB, max 59 kB) |
| Time to compute all 869 for the *corpus* scope | **2.5 s** |
| **Build of the whole matview, all 30 scopes** | **9.3 s** |
| **`REFRESH … CONCURRENTLY` of the same** | **9.9 s** |
| **On-disk, `pg_total_relation_size`** | **22 MB** |

So a complete `(scope × settlement)` precompute is **26,070 rows**, **22 MB** and **~10 s
per refresh** — *cheaper* than the two precomputes already on this path (119 ~12 s, 122
~20 s), not merely in line with them.

The per-scope figure does not extrapolate and should not be used to: 2.5 s is the
**corpus** scope, the widest one there is. The other 29 windows hold fewer contracts and
cost proportionally less, which is why the whole 30-scope build is 9.3 s rather than the
~75 s a multiplication would predict. (An earlier draft of this plan quoted ~54 s from
exactly that multiplication. The build was then measured end-to-end; 9.3 s is the
measurement.)

Since the full fan-out is this cheap, **do not special-case the three big settlements**.
Two code paths that answer the same question is the drift this codebase keeps paying for.

### Rejected alternatives

| Option | Why not |
|---|---|
| Add an index | The cost is a GROUP BY over 64k rows, not a lookup. Nothing to index. |
| Raise `statement_timeout` | Converts a 500 into a 10-second page. The reader is no better off, and it weakens a guard that protects every other route. |
| Precompute only the 3 large settlements | Saves ~22 MB and costs a second code path that only executes for the settlements nobody tests. |
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

CREATE UNIQUE INDEX idx_psp_scope_ekatte
  ON procurement_settlement_payloads (scope_key, ekatte);

GRANT SELECT ON procurement_settlement_payloads TO app_readonly;
```

(Illustrative — the shipped file also carries the `DROP … IF EXISTS` preamble. The index
name follows 119's `idx_<abbrev>_<cols>`, not a `uq_` prefix.)

That is the WHOLE index list. Unlike 119 — which carries a sort index per column the
table orders by and a trigram index for its search — this matview is only ever read by
one query shape, a `(scope_key, ekatte)` point lookup, so the unique key the
`CONCURRENTLY` refresh already requires is also the only index there is anything to add.

Four conventions inherited from 119, each for a stated reason:

- **It unnests the existing function rather than re-implementing the aggregation.** A
  change to the methodology — which buyers count as local-tier, how a tier is labelled —
  lands in `030` alone and this follows. 119's header makes this rule explicit and it is
  the reason its numbers have never drifted from the page's.
- **`WITH NO DATA`.** The file is applied in one implicit transaction, so a populating
  CREATE would hold an `AccessExclusiveLock` for the whole build *and* be recomputed by
  the loader's REFRESH straight after — paying twice, half of it under the lock that
  `CONCURRENTLY` exists to avoid.
- **`REFRESH … CONCURRENTLY`**, which the UNIQUE index above is required for. This is on
  the serving path; a plain REFRESH would stall every settlement page for the whole ~10 s
  rebuild. The loader's `refreshScopedSettlement()` already catches `0A000` and falls back
  to the plain form for the first refresh after a `WITH NO DATA` create, so 123 needs no
  new handling — only its name in the list.
- **The explicit `GRANT`.** `roles_readonly.sql`'s `ALTER DEFAULT PRIVILEGES` does in fact
  cover matviews (verified: a matview created without a grant is readable by
  `app_readonly`), so this line is belt-and-braces — but it is belt-and-braces 119, 121
  and 122 all wear, and for a reason §3.3 makes sharper here than anywhere else: the route
  catches its own errors, so a database where the default privileges were never applied
  would not fail loudly. It would serve the live path forever, correctly, at today's
  speed.

### 3.2 Route change — none required at the client

`procurement_scopes` stores **half-open** windows that match `useScopeWindow`'s pair
exactly. Verified:

```
all           = [null,       null)
y:2024        = [2024-01-01, 2025-01-01)
ns:2026_04_19 = [2026-04-19, null)
```

That is precisely what the hook already sends as `?from`/`?to`. So the route maps
`(from, to) → scope_key` and seeks the matview — **no client change, and every existing
caller benefits**, including the AI tools (which send no window and therefore map to
`all`).

```
/api/db/procurement-settlement?ekatte=…&from=…&to=…
  → look up scope_key for (from, to)     -- NULL-SAFE; see below
  → HIT:  SELECT payload FROM procurement_settlement_payloads WHERE scope_key=$1 AND ekatte=$2
  → MISS: run procurement_settlement_detail(…) live, as today
```

**Bound how long any read may wait for a lock.** The scopes loader re-applies 123's DDL
before refreshing, so its refresh always meets an unpopulated matview and takes the PLAIN
form — an `AccessExclusiveLock` for the whole ~10 s rebuild (this is inherited from 119 and
122, not new here). A settlement page landing in that window would queue on the lock,
spend the entire 10 s `statement_timeout` waiting, and reach the fallback with no budget
left — a 500, from the one code path added to prevent 500s. `lock_timeout=2s` on the
`/api/db` pool turns that wait into a fast miss, which the fallback already handles.

Pool-wide rather than per-probe, for two reasons: a pooled query cannot `SET LOCAL` without
a transaction, and no read-only endpoint should ever spend its whole statement budget
queued behind a writer — the ~40 other routes gain the same protection. Be honest about
what it does not fix: while a contracts reload holds its own exclusive lock the *live*
fallback is cut off too, so the route still fails, just in 2 s rather than 10.

#### The lookup MUST be NULL-safe, or it fixes nothing

`=` is the wrong operator here and would produce a working, tested, deployed change that
never once serves a precomputed row on the pages that 500. Two of the thirty scopes carry
a NULL bound, and they are the two that matter:

```
all            date_from NULL, date_to NULL
ns:2026_04_19  date_from 2026-04-19, date_to NULL   ← the newest parliament = the page DEFAULT
```

The client omits the parameter entirely when the bound is null
(`useSettlementProcurement.tsx` — `if (win.from) params.set(...)`), and the AI tools send
neither bound at all (`ai/tools/profile.ts`). Both arrive at the route as `null`, and
`date_from = $1` is NULL for a NULL argument, never true. So:

- **the default settlement page** (newest parliament, open-ended window) misses on every
  request — София keeps timing out at 10.009 s, which is the entire defect this plan exists
  to fix;
- **every AI tool call** maps to `all`, the widest and most expensive window, and misses;
- the other 28 scopes — all 16 `y:` windows and the 12 *closed* `ns:` windows — hit
  perfectly, so a spot check of "does the matview work" passes.

Use `IS NOT DISTINCT FROM` on both bounds, or resolve the mapping in JS against a
`procurement_scopes` snapshot where `null === null` behaves. Whichever, §6 Step 4 carries a
route test for the no-window request specifically — see the note there on why the other
four tests cannot catch this.

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

#### But name what it costs, because it is not free

A fallback that returns the right answer is also a fallback that hides every reason the
fast path was not taken. Each of these is a permanent, silent no-op — 200s, correct
numbers, today's latency, nothing red anywhere:

- the NULL-unsafe lookup of §3.2 (misses on the default scope, forever);
- a database whose `app_readonly` cannot read the matview (§3.1's `GRANT`);
- a loader that was never run on the cloud side (§4);
- a matview whose refresh has been failing since some earlier deploy.

So the miss path is not silent: **it logs, at most once per process per scope_key**, that
it fell through to the live computation and why (`no scope for (from,to)` /
`matview read failed: <sqlstate>`). One line in Cloud Run logging is the difference
between "the precompute is not being read" being observable and being invisible, and it
costs nothing on the hit path. §7's acceptance leans on it.

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
| `awarder_seats` reload | `db:load:awarder-seats:pg` | It decides WHICH buyers belong to a settlement — see §5.1 |
| `place_dim` reload | `db:load:place-dim:pg` | The payload's whole place hero comes from it — see §5.2 |
| Cloud | `db:load:procurement-scopes:pg:cloud` | Nothing on the cloud side is automatic |

CLAUDE.md's "the cloud side does not run this" section gains 123 alongside 119/122.

**Rows 3 and 4 need code, not just a line in this table.** As it stands
`load_awarder_seats_pg.ts` contains no REFRESH at all, so running it refreshes nothing —
and `db:load:place-dim:pg` likewise has nothing of its own to refresh. Today both are
covered only by the operator remembering to run the scopes loader afterwards, which is the
arrangement CLAUDE.md already documents for 119's English names.

Both loaders now call the shared `refreshScopedPrecomputes()`
(`scripts/db/lib/scopedMatviews.ts`), which closes the same latent staleness for **119** —
`procurement_by_settlement` reads `awarder_seats` too, so a standalone seats reload has
always been able to move a buyer between settlements everywhere except the by-settlement
precomputes. **Not 122**: the contractor leaderboard has no settlement dimension and
neither input can move it, so each caller names the input it changed and gets only the
matviews built from it.

In `db:refresh` the order is already correct — `db:load:awarder-seats:pg` and
`db:load:place-dim:pg` both run before `db:load:procurement-scopes:pg`. It is the
standalone reload, which is how both are usually run, that is exposed.

---

## 5. The failure mode this introduces

A precompute trades a slow query for a **staleness** risk, and here it is quiet: a stale
matview serves last week's totals at a 200, and the page looks perfectly healthy. Two
inputs make it stale that the other precomputes on this path do not share, and one test
catches all of it.

### 5.1 `awarder_seats` is the sneaky trigger

The other precomputes on this path depend on `contracts` and the scope table. This one
also depends on `awarder_seats`, because that table decides which buyers are seated in a
settlement. Reloading it without refreshing 123 moves a buyer between settlements
everywhere on the site *except* here. This is the same shape as CLAUDE.md's note that
`contracts` now reads `awarder_seats` through the `awarder_ekatte` semi-join.

### 5.2 `place_dim` is the second one, and it fails worse

`procurement_settlement_detail` LEFT JOINs `place_dim` (117) for `nameEn`,
`settlementType`, `loc`, `obshtinaCode`, `oblastCode` and the localized obshtina/oblast
names — the entire PlaceHeaderView hero, the breadcrumb's drill-up links and the view
switcher. So the place dimension is an input to this payload, not just to 119's English
column.

The ordering hazard is the one worth stating: those JOINs are LEFT and degrade to the
Bulgarian `awarder_seats` strings, which is correct behaviour live — but a 123 refresh
that runs while `place_dim` is empty or mid-reload **bakes the degraded hero into 26,070
stored rows**, where it stays until the next refresh. The page then renders a settlement
with no English name, no map centroid and a breadcrumb that cannot link up, on a 200,
against a place dimension that is sitting there fully loaded. `db:refresh` orders
place-dim first; a standalone reload is where this bites.

### 5.3 The guard: a data test

`procurement_settlement_payloads.data.test.ts`, alongside
`contractor_rank.data.test.ts` and `cpv_catalog.data.test.ts`:

- the matview is non-empty and carries a row for every `(scope × settlement)` pair —
  26,070 of them, and **no NULL payloads**: measured across all thirty scopes, every pair
  yields a real object, because the function only returns NULL when the settlement has no
  seated buyer at all, which is a property of `awarder_seats` and not of the window;
- for a sample of settlements across the size range **and all three scope kinds**, the
  stored payload equals `procurement_settlement_detail(...)` computed live — the
  staleness check that a row count cannot make;
- the sample includes a settlement with **zero** contracts in a narrow window, which
  returns `contractCount: 0` rather than a NULL payload (verified above), so the page shows
  "nothing in this period" instead of its not-found branch;
- a placed settlement's stored `nameEn` / `loc` / `obshtinaCode` are non-null — the
  §5.2 check, which the payload-equality assertion above cannot make (a matview built
  against an empty `place_dim` still equals a live call made against the same empty
  `place_dim` only until the dimension is loaded, and the test would then be comparing two
  freshly-degraded values on the day it matters least).

**Why exact jsonb equality is safe.** `contracts.amount_eur` is `double precision`, so a
parallel `SUM` is order-dependent and two runs can differ in the last bits. Every money
field in this payload is `ROUND`ed to whole euro before it is emitted, and every array is
ordered by the ROUNDED key with an `eik`/`year` tiebreak — the determinism convention
119 and the risk indexes already follow. At ~1e9-scale totals against float64's ~1e-6
resolution, the rounded value is stable. This is why the assertion can be `=` and not a
tolerance; it is worth knowing rather than assuming, because the day it starts flaking the
cause will not be this test.

---

## 6. Steps

| # | Step | Files |
|---|---|---|
| 1 | Migration 123 — matview + the one unique index + `GRANT SELECT` (§3.1) | `scripts/db/schema/pg/123_procurement_settlement_payloads.sql` |
| 2 | Wire into the scopes loader (apply + REFRESH CONCURRENTLY) and into `db:load:pg`'s guarded refresh block | `scripts/db/load_procurement_scopes_pg.ts`, `scripts/db/load_pg.ts` |
| 2b | Call `refreshScopedSettlement()` from the `awarder_seats` and `place_dim` loaders (§4) — fixes 119/122 staleness too | `scripts/db/load_awarder_seats_pg.ts`, `scripts/db/load_place_dim_pg.ts` |
| 3 | Route: map `(from,to) → scope_key` **NULL-safely** (§3.2), seek the matview, fall back to live on a miss + log it once per scope (§3.3) | `functions/db_routes.js` |
| 4 | Route tests: **no-window request HITS**, hit, miss-falls-back, matview-absent-falls-back, `?slim` unaffected | `functions/db_routes.settlement.test.js` |
| 5 | Data test (§5.3) | `scripts/db/tests/procurement_settlement_payloads.data.test.ts` |
| 6 | CLAUDE.md: add 123 to the cloud-loader list and the `awarder_seats` + `place_dim` triggers | `CLAUDE.md` |
| 7 | Re-measure prod: София cold, and confirm no 500 at the 10 s ceiling | — |

**Step 4's first test is the one that earns its place.** A request carrying neither
`?from` nor `?to` is what the AI tools send and what `all` resolves to, and — with the
newest parliament's window open-ended — it is the same NULL that the default settlement
page hits from the other direction. The other four tests all pass against a NULL-unsafe
lookup: a `y:` scope hits, a bogus window misses and falls back as designed, an absent
matview falls back, and `?slim` trims whatever it was handed. Only an assertion that the
**no-window request reads the matview** distinguishes "the fallback is working" from "the
fallback is all that is working". §5's data test cannot cover it either — it tests the
matview's contents, not the route's mapping into it.

Steps 1–2b are shippable alone (the matview is inert until the route reads it). Step 3 is
the visible change. Because of §3.3 there is **no required ordering** between the loader
and the deploy — the route is correct either way, only slower without the matview.

---

## 7. Acceptance

- `/api/db/procurement-settlement?ekatte=68134` returns **200**, versus the current
  10 s → 500, on a cold production instance and **on the default (open-ended `ns:`) window
  as well as with no window at all** — not only on a `y:` scope, which would pass while
  §3.2's hazard is live.
- No `httpRequest.latency` near `10.009s` for this route in Cloud Run logs over 24 h.
- **No `psp:not-built` or `psp:read-failed` log lines** (§3.3) for this route after the
  loader has run. This is the criterion that fails loudly if the lookup, the GRANT or the
  cloud-side loader is wrong; the latency criteria above can all be met by a fallback doing
  the work. `psp:no-scope` is exempt — a caller may legitimately ask for a window that is
  not one of the thirty, and serving that live is the designed behaviour, not a defect.
- End-to-end, expect **~0.5 s**, not "well under 1 s": the database side becomes a point
  lookup of a ≤60 kB row and effectively free, but §8's ~344 ms of connection setup and
  ~180 ms/24 kB of uncompressed transport are untouched by this plan and now dominate. Hold
  the acceptance on **DB time and the absence of the 10 s ceiling**, which is what this work
  controls.
- The data test proves the stored payload equals the live function across all three scope
  kinds.
- The settlement page's two halves still reconcile — the existing
  `procurement_settlement_scope.data.test.ts` keeps passing, since the contracts table is
  untouched by this work.

### 7.1 Measured after implementation (local, 2026-07-31)

**Both halves measured on the same database on the same day**, median of five warm calls
through the route handler. This is the only honest comparison available locally, and it is
NOT the §1 table: those "before" figures are production, cold, on a `db-g1-small`, and the
401 ms local figure in §1 predates `94e2a0dce7`, which removed the `topc` CTE from 030 and
made the live path roughly twice as fast. Quoting it as the baseline would have overstated
this work by about 2×.

| Request | Live path, today | Precomputed | Ratio |
|---|---|---|---|
| София 68134, no window (`all`) | 207.9 ms | **1.1 ms** | 182× |
| София 68134, newest `ns:` (open-ended) | 77.3 ms | **1.5 ms** | 51× |
| Варна 10135, no window | 39.0 ms | **0.8 ms** | 50× |
| Бургас 07079, no window | 25.1 ms | **0.8 ms** | 30× |

The number that actually matters is not in this table. Local warm buffers were never the
problem — §1's whole point is that the same София call costs 401 ms local and had not
finished at the 10 s `statement_timeout` on a cold Cloud SQL buffer cache. What the
precompute removes is the *aggregate*, so the remaining work is one index seek on a
26,070-row relation whose cost does not scale with the settlement. The prod figure is still
unmeasured (below).

Counts reconcile with §1 exactly: 64,676 contracts / 327 buyers for София.

Two claims this plan makes were exercised rather than argued:

- **Orderless deploy (§3.3).** With the matview renamed out of existence, the route returned
  the correct 64,676 via the live path (222 ms) and logged `psp:read-failed:42P01`. So the
  route is safe to ship to a database the loader has never touched — the property that makes
  this migration unlike `cpv_catalog`.
- **The staleness gate (§5.3) fails when it should.** Deleting one София contract inside a
  rolled-back transaction moved live to 64,675 against a stored 64,676, and the gate
  reported the mismatch.

Of §7's criteria, everything testable locally is met: the data gate passes (20/20 data
tests, including the payload equality across all three scope kinds), the route tests pass
(138/138), and `procurement_settlement_scope.data.test.ts` is still green — the contracts
table is untouched by this work.

### 7.2 Production, measured after deploy (2026-07-31)

Deployed: migration 123 applied to Cloud SQL via `apply_functions.ts`, populated with a
plain `REFRESH` (**75 s**, 26,070 rows, 0 NULLs, 51 MB), then `npm run deploy:db`.

Cloud Run `httpRequest.latency` for `/api/db/procurement-settlement`, server-side:

| | Before | After |
|---|---|---|
| София 68134 | **10.009 s → HTTP 500** | **0.012 s → 200** |
| Варна 10135 | 10.009 s → HTTP 500 (cold) | 0.009 s → 200 |
| София `?slim=1` | 10.011 s → HTTP 500 | 0.013 s → 200 |

Every settlement request since the deploy is a 200 in 0.009–0.06 s. End-to-end wall clock
from a browser is 0.7–1.4 s, and **all of the remainder is §8's transport cost** — TLS setup
plus 69 kB of uncompressed JSON — which this plan does not touch.

Acceptance met: no `psp:not-built` and no `psp:read-failed` in the logs, so the route is
genuinely reading the precompute rather than falling back; and the payloads verified against
Cloud SQL before the deploy (26,070 rows, stored == live across all three scope kinds on the
three heavy settlements, no blank place heroes, `app_readonly` can read it).

**The migration was applied on its own, NOT via `db:load:procurement-scopes:pg:cloud`.** That
loader DROPs and recreates 119's and 122's matviews before refreshing them, and the routes
reading those do not degrade — it would have meant a multi-minute 500 window on
`/procurement/by-settlement` and `/procurement/contractors` to rebuild data already correct
on cloud. 123 was new and unread, so applying and refreshing it alone was zero-impact. Use
the loader when the SCOPES change, which is what it is for; use `apply_functions.ts` plus a
single `REFRESH` to introduce one new per-scope matview to a live database.

```bash
npm run db:load:place-dim:pg:cloud            # PRECONDITION, see below
npm run db:load:procurement-scopes:pg:cloud   # applies 119+122+123, refreshes all five
npm run deploy:db
```

Deploy order does not matter (§3.3) — the route is correct without the matview, only slower.
**`place_dim` is a different matter and is a genuine precondition.** Nothing runs it on the
cloud side, and per §5.2 a 123 refresh against a stale or empty dimension does not fail: it
bakes a degraded place hero into all 26,070 stored rows, where it stays until the next
refresh, served at a 200. Verify it before refreshing, not after.

---

## 8. Out of scope

The **transport** costs measured alongside this and belonging to
[db-payload-diet-v1](docs/plans/db-payload-diet-v1.md) T0: `/api/db/*` responses go out
uncompressed and uncached, so a warm 24 KB settlement payload still spends ~180 ms on the
wire and ~344 ms on connection setup. Fixing the query does not touch either. Both plans
are needed for the page to feel fast; neither substitutes for the other.
