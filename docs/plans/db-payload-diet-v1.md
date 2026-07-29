# `/api/db` payload diet + client-scorer retirement (v1)

Three defects share one symptom — DB-backed procurement / tender / funds pages
are slow and occasionally wrong — but they have three different causes and three
different fixes. They are tiered so the cheapest one (which helps every page on
the site) lands first.

Status: **plan only, nothing implemented.** Audited 2026-07-29; §1.E records what
the audit changed.

All numbers below were measured against **prod (`electionsbg.com`) and the local
Postgres on 2026-07-29**, not estimated.

---

## 1. Baseline

### 1.A Transport — every `/api/db` response is uncompressed AND uncacheable

`curl -H 'Accept-Encoding: gzip, br'` against prod returns no `content-encoding`
and a `content-length` equal to the raw byte count, with
`cache-control: no-cache, max-age=0, must-revalidate` and `x-cache: MISS`.

| route | bytes | gzip -9 | ratio | cold time |
|---|---|---|---|---|
| `procurement-risk-indexes` | 1,292,033 | 256,959 | 5.0× | 2.0 s (3.7 s reported) |
| `municipal-officials-name-index` | 1,057,146 | 188,102 | 5.6× | 1.9 s |
| `municipal-officials-search-index` | 913,128 | 167,087 | 5.5× | 2.4 s |
| `mp-roster` | 889,967 | 140,640 | 6.3× | 1.7 s |
| `procurement-concentration` | 855,649 | 155,800 | 5.5× | 5.4 s |
| `procurement-rankings` | 435,146 | 84,975 | 5.1× | 1.7 s |
| `procurement-flow` | 383,753 | 68,066 | 5.6× | 4.3 s |
| `dual-corpus-rankings` | 252,348 | 42,361 | 6.0× | 1.5 s |
| `procurement-scanner` | 101,118 | 18,213 | 5.6× | 2.5 s |
| **total** | **5.28 MB** | **0.94 MB** | | |

Two independent causes:

1. **Nothing compresses.** `functions/` has no `express` and no `compression`
   middleware — the routes are raw `onRequest` handlers ending in `res.json(body)`
   ([index.js:585](functions/index.js:585)). Firebase Hosting compresses static
   assets, not function-rewrite responses.
2. **`firebase.json`'s `**` header rule** forces
   `no-cache, max-age=0, must-revalidate` over the
   `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` the code
   sets at [index.js:580](functions/index.js:580) — so that block is dead. Already
   known in-tree:
   [officials_redirect.js:89](functions/officials_redirect.js:89) documents the
   identical override, and `/officials/**` got its own header rule to escape it.
   `/api/db/**` never did.

**The escape mechanism is now pinned down** (this changes what T0 must do).
`/officials/*` rewrites to the *same* `db` function and serves
`public, max-age=300, s-maxage=3600` — which is
[officials_redirect.js:92](functions/officials_redirect.js:92)'s value, **not**
the `/officials/**` rule's value (that one carries
`stale-while-revalidate=86400`, absent from the response). So a path-specific
`headers` entry does not *supply* the header; it stops the `**` rule from
clobbering, and the **function's own `Cache-Control` is what lands**. T0 must
therefore treat [index.js:583](functions/index.js:583) as the real value and the
firebase.json entry as an unblocker that has to be kept in sync or it misleads
the next reader.

**Blanket caching `/api/db/**` is safe.** The `db` function is GET-only read
routes; every POST path in `functions/` belongs to the separate `scenarios` and
AI-proxy exports. No mutation, no personalization, no per-user response.

The funds pages are the clearest victim of (2): `/funds` is architecturally
healthy — every payload is precomputed and sharded (`fund-payload` singletons
measure 4 B – 77 KB, `by-eik-index` is a 2.8 KB manifest over per-EIK shards) —
but it fires ~10 of them at 0.65–1.5 s each, none edge-cached, on every visit.

### 1.B Redundant compute — the contracts risk scorer

Every row `/api/db/table` returns for `contracts` already carries the
server-computed risk result. Verified live:

```
riskCri  riskGrade  riskFired  riskAvailable  riskFiredMask  riskAvailableMask
```

Sample from prod (`?risk_grade=D,E,F`, sorted by `risk_fired`):

```
F  fired 6/11  firedMask 1582  availMask 2015   → mpConnected, pepConnected,
                                                   awarderConcentration, annexGrowth,
                                                   weakCompetition, directAward
```

These come from `contract_risk_cache`
([112_contract_risk_cache.sql](scripts/db/schema/pg/112_contract_risk_cache.sql)),
whose header declares SQL the source of truth. They are in the registry
projection at [db_table.js:183](functions/db_table.js:183). The cache is
populated and correct on Cloud SQL — confirmed, not assumed.

The contracts pages nevertheless download 1.29 MB to re-derive the same twelve
booleans in the browser, *while already filtering on `risk_grade` server-side*
([CompanyContractsDbScreen.tsx:141](src/screens/dev/CompanyContractsDbScreen.tsx:141)).
The screen header comment ("risk isn't a Postgres column") stopped being true at
migration 112.

Payload composition, measured on `procurement_risk_indexes_cache`:

| slice | bytes | entries | needed for chips? |
|---|---|---|---|
| `concentration` | 693 kB | 2,745 | tooltip detail only |
| `foundedByEik` | 417 kB | 15,809 | tooltip detail only |
| `splitPurchase` | 52 kB | 215 | tooltip detail only |
| `ngoForeignFunded` | 6.3 kB | 35 | **yes** — not in the mask (unscored) |
| `cpvCompetition` | 4.9 kB | 2 | no |
| `mpConnected` | 4.1 kB | 57 | tooltip detail only |
| `pepConnectedEiks` | 4.0 kB | 304 | no |
| `cpvBidderMedians` | 2.4 kB | 198 | no |
| `debarred` | 467 B | 1 | tooltip detail only |

94% is two slices, and both are there for tooltip text, not for the flag
booleans. `concentration` is ~253 B/entry because each carries `awarderName`,
`contractorName` and three money fields; the scorer needs only the pair key and
`sharePct`.

**Cost profile — precise.** `queryClient` sets `staleTime: Infinity` *and*
`gcTime: Infinity`, so the payload is fetched once per **document load** and
never evicted; SPA navigation between contracts pages reuses it. The 2–4 s is a
first-load cost, not a per-navigation one. That is still the common case for the
organic traffic these pages are meant to attract (see
`project_seo_discovery_gap`), and it is the render-blocking path for the risk
column on that first load.

**Why the payload got this big — and why tier order is a hard dependency.**
[033:280](scripts/db/schema/pg/033_procurement_risk_indexes.sql:280) documents
dropping `foundedByEik`'s old `founded_date >= 2018` cap because the cap broke
parity. The harness header records the damage precisely: availability is decided
per-**contractor**, so the bound moved the CRI **denominator** for **30.2% of the
corpus**, and inspection had already passed it. Any attempt to slim an
availability-affecting slice repeats that bug. Once availability comes from
`available_mask`, detail slices can be trimmed freely — so **T2/T4 slimming must
not precede T1**, and this is a correctness constraint, not a preference.

Per-entity slices are tiny: concentration pairs per contractor are **p50 1,
p95 6, max 115** — under 2 KB against the current 693 kB.

### 1.C Silent degradation — wrong output, not just slow

`useContractRiskScorer` returns `isLoading`; four of five call sites discard it:

| call site | handles `isLoading`? |
|---|---|
| [CompanyContractsDbScreen.tsx:55](src/screens/dev/CompanyContractsDbScreen.tsx:55) | no |
| [ContractsBrowserDbScreen.tsx:54](src/screens/dev/ContractsBrowserDbScreen.tsx:54) | no |
| [ProjectFileScreen.tsx:620](src/screens/procurement/ProjectFileScreen.tsx:620) | no |
| [ContractDetailScreen.tsx:63](src/screens/ContractDetailScreen.tsx:63) | no |
| [TenderDetailScreen.tsx:374](src/screens/procurement/TenderDetailScreen.tsx:374) | **yes** |

While the payload is in flight every flag is false, so `hasFlag` is false, and
[RiskBadges.tsx:255](src/screens/components/procurement/RiskBadges.tsx:255)
renders `—` — byte-identical to a genuinely clean contract. For 2–4 s a debarred
or MP-connected contract reads as clean, next to a grade filter that says
otherwise. `ContractDetailScreen` is the worst case: `variant="full"` is exempt
from that early return, so it renders the meter affirmatively as
*"no red flags · N checks passed"* on a single-contract page that downloaded
1.29 MB to say it.

`/company/:eik/annexes` shares the screen (`tag="contractAmendment"`) and
`/awarder/:eik/contracts` shares it via `side="awarder"` — same fetch, same bug.

**`cpv-catalog` is broken.** A `DISTINCT ON (cpv) … FROM tenders` full scan
([db_routes.js:660](functions/db_routes.js:660)) — 130 ms locally (parallel seq
scan + external merge sort, 41k buffers), but **17.7 s and 20.8 s on two prod
calls, one returning HTTP 500**. Both the contracts browser
([ContractsBrowserDbScreen.tsx:151](src/screens/dev/ContractsBrowserDbScreen.tsx:151))
and the tenders browser
([TendersBrowserDbScreen.tsx:145](src/screens/dev/TendersBrowserDbScreen.tsx:145))
fetch it on mount, uncached, and
[useCpvCatalog.ts](src/data/procurement/useCpvCatalog.ts) swallows the failure
(`if (!r.ok) return []`) — the searchable CPV filter silently comes up empty with
no error shown.

### 1.D What is already correct — do not touch

- **Tender risk chips.** `computeTenderRisk(tender, awards)` is pure and
  row-local; `TenderRiskChips` needs no corpus payload
  ([TenderRiskPanel.tsx:191](src/screens/components/procurement/TenderRiskPanel.tsx:191)).
  This is the shape the contracts side should converge on.
- **Funds sharding.** `fetchFundPayload(kind, key)` + `by-eik-index` manifest +
  per-EIK shards is the right architecture; funds needs only T0.
- **`usePepConnectedByEik`** already reads the per-EIK
  `/api/db/company-politicians` route rather than the corpus blob — the model for
  T2.
- **Prerendering is unaffected.** `scripts/prerender/index.ts` is template-string
  substitution — no headless browser, no data fetching. Nothing here costs build
  time, and no chip state can be baked into the prerendered HTML.

### 1.E Audit findings — what changed in this revision

**The parity gate was a no-op. It has now been run — and parity HOLDS.**
`risk_parity.harness.ts` — the gate migration 112's header names as the thing
holding TS to SQL — exited 0 with
`· parity harness skipped (relation "risk_upheld_ocid" does not exist)` on a
**fully loaded** local database (`contract_risk_cache` = 407,693 rows,
`contracts_list` carrying all 6 risk columns). After recreating the missing view
it runs, and over the **entire corpus** (407,693 contracts, seed 42, 2.6 s):

```
✓ debarred/mpConnected/pepConnected/awarderConcentration/amendment/annexGrowth/
  newFirmWinner/splitPurchase/appealUpheld/weakCompetition/directAward/
  shortTenderPeriod   — 0 mismatches each
✓ cri differs on 0 · score differs on 0
```

**T1 is therefore unblocked and is a relocation, not a behaviour change**: the
mask decodes to exactly the flags the chips render today, on every contract in
the corpus.

**Why the gate was dark is structural, not a one-off.**
`042_kzk_appeals.sql:152` runs
`DROP MATERIALIZED VIEW IF EXISTS upheld_ocids CASCADE`, and the cascade takes
`risk_upheld_ocid` with it — verified in a rolled-back transaction, where the
`DETAIL` names both `contracts_list` and `risk_upheld_ocid`. 042 rebuilds
`contracts_list` ([042:166](scripts/db/schema/pg/042_kzk_appeals.sql:166)) but
nothing rebuilds `risk_upheld_ocid` except `rebuild_contract_risk_cache()`. So
**every КЗК appeals ingest re-breaks the gate**, and it stays broken until the
next contracts reload — an operation rare and expensive enough (~68 min CPU on
Cloud SQL) that "dark" is the steady state, not the exception. The skip predicate
`/ECONNREFUSED|does not exist|role .* does not exist/i`
([harness:265](scripts/procurement/risk_parity.harness.ts:265)), written for
"no DB", then reports it as green.

**And it never runs in CI.** `.github/workflows/test.yml` runs `lint`,
`test:unit`, `functions:test`, `build` and Playwright — not `ai:test:all`, the
only script that references the harness. So the gate depends on someone running
it locally, on a database where it silently skips.

**Correction to an earlier draft of this section — the failure mode is NULL, not
absent.** `rebuild_contracts_list()`
([000_search_fns.sql:124](scripts/db/schema/pg/000_search_fns.sql:124)) guards
the risk join on `to_regclass('public.contract_risk_cache')` and emits
`NULL::int` columns when it is absent, so the six `risk_*` columns can never
disappear from the view. What degrades is their **value**: the join is a LEFT
JOIN, so any contract without a cache row serves `risk_fired_mask = NULL` (0 such
rows today, but it is the state between a contracts load and the risk rebuild at
[load_pg.ts:514](scripts/db/load_pg.ts:514)).

That makes a specific requirement on T1, not a general one: **the decoder must
treat a NULL mask as *unknown* and must not decode it to 0.** The SQL author
already reasoned this exact point at
[000_search_fns.sql:147](scripts/db/schema/pg/000_search_fns.sql:147) — *"NULL
(not 0) … an unscored contract is unknown, not clean, and 0 would rank it as the
safest row in the corpus."* Decoding null→0 would reproduce the §1.C bug the tier
exists to fix, just with a different trigger.

**`mergeContractRisk` loses one magnitude under T1 alone.** The dossier merge
deliberately keeps the most concerning magnitude across a group — lowest
`bidCount`, largest `annexGrowthPct`, youngest `newFirmMonths`
([computeProcurementRisk.ts:500](src/data/procurement/computeProcurementRisk.ts:500)).
`bidCount` and `annexGrowthPct` are row-derivable; `newFirmMonths` needs
`foundedByEik`. So `ProjectFileScreen` must take T1+T2 together, or have
`newFirmMonths` served from the T2 detail route.

**T3 is cheaper than first written.** `db:load:tenders:pg` and
`db:load:tenders:pg:cloud` already exist and tenders is an already-migrated
family, so folding the CPV catalogue into `load_tenders_pg.ts` inherits the
existing cloud and watch-skill wiring — no new npm script, no new watch entry
(cf. `reference_migrated_family_watch_reload`).

---

## 2. Plan

### T-1 — make the parity gate actually run (prerequisite for T1 and T5)

**Step 3 is done and it came back clean (§1.E): full corpus, zero mismatches.**
T1 may proceed. Steps 1, 2 and 4 remain, and they are what keeps that result
true rather than momentary.

1. Have the harness resolve upheld appeals without depending on a view that only
   a rebuild creates: read `upheld_ocids` directly, guarded on `to_regclass`,
   treating absence as "appealUpheld unavailable" exactly as the SQL does. This
   is the fix for the КЗК-ingest cycle, not just for today's missing view —
   without it the gate goes dark again on the next appeals refresh.
2. Narrow the skip predicate to connection failures and a genuinely empty
   `contract_risk_cache`. A missing relation on a loaded database must **fail**,
   not skip.
3. ~~Re-run and record the real drift.~~ **Done** — 407,693 contracts, 0
   mismatches on all 12 checks, `cri`/`score` identical. Re-run after (1) and (2)
   to confirm the gate still passes for the right reason.
4. Put the harness where it will actually run. CI does not invoke `ai:test:all`
   (§1.E); either add it to `.github/workflows/test.yml` behind the same
   auto-skip-without-Postgres convention the `scripts/db/tests/*.data.test.ts`
   gates use, or fold the comparison into those gates, which CI already runs.

Local note: `risk_upheld_ocid` was recreated on the dev database with the exact
statement `rebuild_contract_risk_cache()` uses, so the local harness works today.
That is a restored state, not a fix — step 1 is the fix.

### T0 — transport (helps all ~110 `/api/db` routes; no page changes)

1. Add a `sendJson(req, res, body)` helper in `functions/` that gzips when the
   request advertises `gzip`/`br` and the serialized body exceeds ~1 KB, sets
   `Content-Encoding` + `Vary: Accept-Encoding`, and falls through to `res.json`
   otherwise. Node 22 `zlib` — no new dependency, no express. Route the `db` and
   `sql` handlers through it.
2. Add an `/api/db/**` entry to `firebase.json` `headers`. Per §1.A its value is
   an unblocker, not the served value — set it to match
   [index.js:583](functions/index.js:583) and comment that the function owns the
   real value.
3. Update the stale note at [officials_redirect.js:89](functions/officials_redirect.js:89)
   with the mechanism established in §1.A.

Verify by curl after deploy: `content-encoding: gzip`, a `public` cache-control
carrying `stale-while-revalidate`, and `x-cache: HIT` on a second call. Expected:
5.28 MB → 0.94 MB on the nine routes above, and repeat visits drop to a
conditional request.

### T1 — render contract chips from the mask (zero additional bytes)

1. Add `src/lib/contractRiskMask.ts`: the bit order from
   [112:90](scripts/db/schema/pg/112_contract_risk_cache.sql:90) —
   `0 debarred, 1 mpConnected, 2 pepConnected, 3 awarderConcentration,
   4 amendment, 5 annexGrowth, 6 newFirmWinner, 7 splitPurchase, 8 appealUpheld,
   9 weakCompetition, 10 directAward, 11 shortTenderPeriod` — plus
   `contractRiskFromMasks(firedMask, availableMask, row)` returning a
   `ContractRiskResult`. **A NULL mask means unknown, never 0** (§1.E) — return
   `null` and let the caller render an explicit unknown state, not `—`. The two
   masks fully determine `components`,
   `firedCount`, `availableCount`, `cri` and `hasFlag`; `annexGrowthPct`,
   `bidCount` and `tenderPeriodDays` are derivable from fields already on the row
   (`amountEur`/`signingAmountEur`, `numberOfTenderers`, the tender-period dates).
   Remaining per-flag detail is `null` until T2.
2. Switch the four call sites in §1.C to it. Chips become synchronous and correct
   on first paint, and agree with the adjacent `risk_grade` filter by
   construction. Hold `ProjectFileScreen` until T2 per §1.E.
3. Keep a small fetch for `ngoForeignFunded` — the one input the mask does not
   carry, a neutral disclosure that deliberately does not bump `firedCount`
   (6.3 kB, 35 entries), not a reason to keep the 1.29 MB.
4. **Guard the view dependency — assert values, not columns.** The six `risk_*`
   columns always exist (§1.E), so their presence proves nothing. The
   `scripts/db/tests/*.data.test.ts` case must assert `contract_risk_cache` is
   non-empty *and* that `contracts_list.risk_fired_mask` is non-NULL across a
   sample, which is what actually catches a contracts reload that never ran the
   risk rebuild.
5. Fix the screen header comments that assert risk is not a DB column.

### T2 — per-flag tooltip detail, lazily

Add `/api/db/contract-risk-detail?key=<contract key>` returning only the
supporting detail for the flags that actually fired on that contract (debarment
dates + URL, the MP/official and their role, the concentration pair share and
totals, the split group, the founding date and month gap). Fetch on tooltip open,
so a page render costs nothing and a hover costs a few hundred bytes.

Batch variant if hover latency measures poorly: accept the page's ≤100 contract
keys and return the same detail keyed by contract — still low kilobytes, since
63.5% of the corpus fires zero checks and 30.0% fires exactly one
([112:57](scripts/db/schema/pg/112_contract_risk_cache.sql:57)).

`newFirmMonths` must be in this route's response for `mergeContractRisk` (§1.E).

After T1+T2 the only remaining reader of `procurement-risk-indexes` is
`ProcurementFlagsScreen`'s `useDebarred` (a 467-byte slice), so the route can be
narrowed to that or retired.

### T3 — fix `cpv-catalog`

Materialise it into a small table (~3.6k rows) built by `load_tenders_pg.ts`, so
it changes only on a tenders ingest and inherits the existing
`db:load:tenders:pg:cloud` + watch wiring (§1.E). Then make `useCpvCatalog`
surface failure instead of returning `[]`, so an empty CPV picker can never again
look like a legitimately empty catalogue.

### T4 — audit the remaining oversized singletons

`procurement-concentration` (855 kB), `procurement-rankings` (435 kB),
`procurement-flow` (383 kB), `mp-roster` (890 kB) and the two
`municipal-officials-*-index` blobs (913 kB / 1.06 MB) have not been checked for
dead fields. Apply the method from
[procurement-settlement-browser-v1.md](docs/plans/procurement-settlement-browser-v1.md)
§1.2, which found 34–50% of that page's payload was fetched and never drawn: diff
payload keys against what the screen reads, drop the rest, paginate anything
rendered unpaginated. Sizing only — no design change. Per §1.B, nothing here may
trim a slice that feeds an availability decision until T1 has landed.

### T5 — guards

- A Vitest case asserting `contractRiskFromMasks` agrees with
  `computeProcurementRisk` on fixture rows.
- Extend the (now actually running) `risk_parity.harness.ts` to cover the
  decoder, so the bit order 112 calls "a contract with every reader" fails loudly
  when it drifts.
- A Playwright assertion that the risk cell on `/company/:eik/contracts` is
  populated on first paint — no `—`-then-chips flip.
- A size ceiling over the parameterless `/api/db` routes, so the next corpus-wide
  payload is caught before it ships.

---

## 3. Deploy order

T0 spans hosting and the `db` function, so per `CLAUDE.md`: `npm run deploy:db`
first, then `npm run deploy`. T-1, T1, T2 and T5 need no migration and no loader
re-run — T1/T2 read columns already live on Cloud SQL. T3 adds a table, so its
migration must be applied to Cloud SQL before the function that reads it, and
`db:load:tenders:pg:cloud` re-run.

## 4. Out of scope

Redesigning the risk model, the grade bands, or the CRI. This plan changes where
the existing checks are evaluated and how the bytes reach the browser — the
scores it renders are the ones `contract_risk_cache` already publishes — now
measured rather than assumed: T-1 found zero TS↔SQL drift across all 407,693
contracts, so no rendered number changes. The one visible difference will be
contracts whose masks are NULL, which today render as `—` (clean) and after T1
must render as unknown.
