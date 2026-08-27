# procurement hub stats — freshness, and the function that looks served and is not

**Status:** proposed, 2026-08-27
**Trigger:** a code review flagged `procurement_hub_counts()` as "3,206 buffers warm /
3,760 cold, over the ~2,000 ceiling, with no buffer gate at all".

## 0. The reported problem is not a problem, and saying so is half the value

`procurement_hub_counts()` **is not served**. Measured 2026-08-27:

- Zero references in `functions/` and zero in `ai/`. Its only caller anywhere is
  `scripts/db/gen_procurement/hub_stats.ts`, an **offline generator**.
- Both headers say so already. 062: "APPLIED BY … hub_stats.ts, which is the ONLY caller".
  The generator: the heavy counts are "computed offline where their cost doesn't matter".

So the `~2,000`-buffer figure is the dashboard-hub ceiling for **live-served** calls, and
applying it here is a category error. The real cost:

| call                                                  | buffers                 | time        |
| ----------------------------------------------------- | ----------------------- | ----------- |
| `procurement_hub_counts(NULL,NULL)` — the `all` scope | 3,206 warm / 3,760 cold | 24–67 ms    |
| a windowed scope (`y:2024`)                           | 941                     | 6.7 ms      |
| **all 30 scopes, i.e. one whole generator run**       | **~30,500**             | **~200 ms** |

Once per `db:refresh`, a chain that runs for hours. There is nothing to optimise, and the
arm that dominates is already optimal: 3,098 of the 3,206 is the `tenders` count, a
Parallel Index Only Scan on `idx_tenders_order` with `Heap Fetches: 0`, reading 237,942
index entries because that is what counting 237,942 rows costs. No index makes an exact
`count(*)` cheaper.

⚠️ **Do not "fix" this by precomputing it.** A matview keyed by scope would add a refresh
dependency on five tables to save 200 ms of offline time, which is machinery for nothing.

## 1. But the investigation found a live defect: the artifact is stale right now

`data/procurement/derived/hub_stats.json` is committed, bucket-synced and read by every
visitor to `/procurement`. Measured against the live corpus, 2026-08-27:

| scope    | field     | committed | live      |
| -------- | --------- | --------- | --------- |
| `all`    | `appeals` | **7,998** | **8,007** |
| `y:2026` | `appeals` | **884**   | **893**   |

Every other field in every other scope matches (checked `all` + all 16 `y:` scopes on
`tenders`/`appeals`/`ngos`, and `all` on `contracts`/`contractors`/`awarderCount`). The 9
missing rows are the КЗК appeals `ingest_first_seen` dates 2026-08-22..24.

This is exactly the failure class CLAUDE.md already records for this file — "committed and
bucket-synced, but derived from Postgres … they go stale in the repo whenever the corpus
reloads" — surviving in the **incremental-ingest** case after the `db:refresh` case was
closed on 2026-08-04.

> **CORRECTION, added 2026-08-27 on executing Tier 0.** The table above and the sentence
> "every other field in every other scope matches" are WRONG, and the way they are wrong is
> the argument for Tier 1. The regeneration moved **18 fields across 17 scopes, not 2**:
> `appeals` in 3 scopes (`all`, `ns:2026_04_19`, `y:2026`), and **`connected`** in 15
> (`all` 898 → 901, plus 6 `ns:` and 8 `y:`) — the latter from `procurement_overview`'s
> `mpCount + officialCount`, drifted because `db:load:tr:pg` rebuilt `company_politicians`.
> The union is 17 because `y:2026` appears only in the `appeals` set.
>
> The pre-execution measurement checked `tenders`/`appeals`/`ngos` for `all` + the 16 `y:`
> scopes, and `contracts`/`contractors`/`awarderCount` for `all` only. `connected` was in
> neither set and no `ns:` scope was checked at all. So a hand-picked subset of fields
> missed real drift **in the same session that was arguing a hand-picked subset would be
> sufficient** — which is why **Tier 1 below should be a FULL compare** (all scopes × all
> fields), superseding the subset design its own §"Coverage" paragraph specifies. The
> generator's own runtime is **17.6 s measured** (the "~22 s" quoted from the
> `update-procurement` skill elsewhere in this doc is an older figure), so the full compare
> costs about that — the same range as existing `test:data` gates.
>
> **Two further corrections to §1 and §2 above**, both found by review of this document:
> the 9 appeals are the **2026-08-24** batch alone, not "2026-08-22..24" — 60 more landed on
> 08-22 and the blob already had those; and the blob carries **10 scalar fields plus
> `topAwarders`**, not "nine fields", so every "9 fields" in this doc undercounts what a
> full compare must cover.

## 2. Root cause: five upstream tables, two regeneration paths, no gate

The blob's inputs are `contracts`, `awarder_seats`, `tenders`, `kzk_appeals`,
`ngo_funding` (the generator's own `RELATIONS` list). Only two things regenerate it:
`db:refresh` and the `update-procurement` skill.

Audited every skill that moves one of those tables:

| skill                  | moves an upstream table                                                        | runs `db:gen-hub-stats` |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| `update-procurement`   | yes                                                                            | ✅ yes                  |
| `update-kzk-appeals`   | `kzk:rejoin`, `db:load:kzk-decisions:pg`                                       | ❌ **no** (0 mentions)  |
| `process-watch-report` | `db:load:pg:cloud`, `db:load:awarder-seats:pg:cloud`, `db:load:ngo-funding:pg` | ❌ **no** (0 mentions)  |

`update-kzk-appeals` is the one that produced the measured drift. `process-watch-report` is
the more serious of the two: it is the daily orchestrator and it moves three of the five.

**And nothing would have caught it.** `hub_stats_pg.data.test.ts` gates the _parliament_
blob (`data/parliament/votes/derived/hub_stats.json`), a different artifact.
No `.data.test.ts` compares `data/procurement/derived/hub_stats.json` to the corpus.
`refresh_coverage.ts` holds chain MEMBERSHIP — that the generator is _in_ `db:refresh` —
which is satisfied while the committed artifact is stale.

## Tier 0 — close the live drift (minutes)

```bash
npm run db:gen-hub-stats
```

**Safe to run, and that was checked rather than assumed.** The generator writes from LOCAL
Postgres, so a local corpus BEHIND the blob would silently regress a good artifact — its
only preflight is `isEmpty("contracts")`, which does not see staleness. Verified
2026-08-27: local leads the blob on `appeals` (+9) and on `connected` (+3 on `all`, 15
scopes — see the CORRECTION in §1) and is behind on nothing.

⚠️ **CHECK THAT NOTHING IS WRITING FIRST, and re-check after.** This was learned the
expensive way: the first Tier 0 run produced a blob that was exact on all 300 scalar fields
when it landed and **stale ten minutes later** — a concurrent procurement chain committed
+199 contracts and moved 18 fields across 7 scopes, `all.totalEur` by **€96.3m**, with a
`COPY tenders(…)` still in flight. Committing there would have published a bucket-synced
artifact under-reporting the corpus by €96m on the day it landed. The plan's own thesis
reproduced itself inside the session that was writing the plan.

```bash
# 1. nothing may be writing
psql -h localhost -p 5433 -U postgres -d electionsbg -tAc \
  "SELECT pid, state, left(regexp_replace(query,'\s+',' ','g'),60) FROM pg_stat_activity
    WHERE datname='electionsbg' AND pid<>pg_backend_pid() AND state<>'idle';"

# 2. regenerate against the settled corpus
npm run db:gen-hub-stats

# 3. re-verify — ALL scopes x ALL fields, never a hand-picked subset (that is what
#    missed `connected`), then the byte budget and the downstream consumer
npx vitest run src/screens/procurement/procurementHubBands.test.ts
```

The blob is **16,638 B measured 2026-08-27** against a 24,000 B gate, and `topAwarders` is
what fills it. (`hub_stats.ts`'s own header says 18,583 B; that figure is stale and this doc
repeated it uncritically at first.)

⚠️ **`data/governance/hub_stats.json` is DOWNSTREAM of this file** —
`scripts/db/gen_governance/hub_stats.ts` reads the procurement blob as a FILE. Re-check it
after regenerating, and regenerate it too if it has moved.

### Known divergence Tier 0 cannot close: `connected` vs the SERVING database

The blob is generated from LOCAL Postgres and shipped to production by `bucket:sync`, so it
is only as true as local's agreement with the serving database. Measured 2026-08-27, five of
the six upstream tables are the same vintage on both (`contracts`, `tenders`, `kzk_appeals`,
`ngo_funding`, `awarder_seats`) and one is not: **`company_politicians` is 985 local against
976 on cloud**, because its only loader `db:load:tr:pg` is a `REFRESH_EXCLUSIONS` member that
has run more recently here than there.

That is exactly the field `connected` is built from, so the blob publishes `all.connected` =
**901** while the tile's own destination — `/procurement/mps`, rendered from `/api/db/…`,
i.e. the serving corpus — is built from **893**. Every other `all` field matches cloud
exactly.

**Not fixable from this plan**: the repair is `npm run db:load:tr:pg:cloud`, a ~35-minute
production load with its own ordering requirements, and it belongs to whoever next publishes
the TR corpus. Recorded here because a regeneration WIDENS the gap (898 → 901 against a
static 893) rather than causing it, and because "the tile disagrees with the page it links
to" is the kind of thing that reads as a bug in the tile.

## Tier 1 — the gate, so it cannot recur silently

New `scripts/db/tests/procurement_hub_stats.data.test.ts`, modelled on the parliament
sibling: re-derive from Postgres and compare to the committed blob.

**Coverage: FULL — all 30 scopes × all 10 scalar fields.** ⚠️ This supersedes the subset
design originally proposed here (three cheap fields for every scope, the three heavy
functions for `all` only). The subset was chosen to avoid a ~22 s gate; two things retired
it:

- the generator's real runtime is **17.6 s**, in the same range as gates already in
  `test:data` (`agri_hub_stats` is ~20 s), so the saving was smaller than believed;
- and the subset's own blind spot **fired during this plan's execution**. The
  pre-execution check WAS a hand-picked subset, and it missed `connected` drifting across
  15 scopes — see the CORRECTION in §1. A design whose stated weakness lands on its first
  outing is not a design to ship.

`topAwarders` is compared on `eik` and `eur` only, NOT on `name`: the generator rewrites
names afterwards via `commonestNames()`, so a name comparison would re-implement that pass
and drift from it. Say so in the gate rather than silently omitting the field.

Requirements the gate must meet, from this file's neighbours:

- `assertCommitted` on the blob (it is committed, so absence is a broken checkout, not a
  supported state) and `reportSkip` with a DISTINCT reason for an absent/empty corpus.
- **Non-vacuous**: assert the scope set is non-empty and that the blob's keys and the
  derived keys are the same set — a gate that compares zero scopes passes.
- The failure message must name the fix (`npm run db:gen-hub-stats`) and say that the blob
  is committed, so the repair is a regeneration + commit, not a loader run.

## Tier 2 — wire regeneration into the two ingest paths that move the inputs

Add to `update-kzk-appeals` (after `kzk:rejoin --apply`) and to `process-watch-report`:

```bash
npm run db:gen-hub-stats
```

⚠️ **THERE ARE FIVE OF THESE, NOT TWO, AND ONE IS DOWNSTREAM OF THIS ONE.** CLAUDE.md pairs
`db:gen-hub-stats` with `db:gen-sector-stats` as "the two committed artifacts db:refresh
regenerates", and that pairing is now out of date — `package.json` carries
`db:gen-culture-hub-stats`, `db:gen-declarations-hub-stats` and `db:gen-governance-hub-stats`
as well, each writing its own committed artifact from Postgres, each with the same staleness
exposure. **`gen_governance/hub_stats.ts` reads `data/procurement/derived/hub_stats.json`
as a FILE**, so it is downstream: regenerating this blob can stale that one.

Auditing the other four is out of scope here, but do not wire one and leave the rest, and
do not repeat CLAUDE.md's "two" — it undercounts by three.

**There is no `:cloud` half and there must not be one.** These are committed FILES shipped
via `bucket:sync`, not tables — a cloud reload does not touch them, and a local
regeneration + commit is what makes them current.

## Tier 3 — 062 hygiene, so this analysis is not repeated

The review that started this was careful, had database access, measured correctly, and
still reached the wrong conclusion — because every signal on this function says "served":
it lives in `schema/pg/`, it is `LANGUAGE sql STABLE` returning `jsonb`, it is named like
`agri_hub_stats` / `funds_hub_stats` / `budget_hub_stats` (all of which ARE served), and:

- **it `GRANT EXECUTE … TO app_readonly`** — the SERVING role, on a function no route calls.
  Dead privilege, and the single strongest false signal. Either drop it, or keep it and say
  in the header why an offline function grants the serving role.
- **its header never says "offline only"**, only "the ONLY caller" buried at the bottom.
  Add a banner at the top: not served, never called by `functions/`, cost is offline, so a
  live-serving buffer ceiling does not apply here.

Note `api_readonly_grants.data.test.ts` checks the FORWARD direction only (every relation
the API reads must be grantable), so a stray grant on an unserved function is not currently
caught by anything.

**Latent, not live — decide and record rather than fix blind.** The predicates are
`publication_date >= COALESCE(p_from,'')` on a **text** column, so a NULL date is excluded
from EVERY scope including `all`, silently under-counting the tile. Today there are
**0 NULL and 0 empty** `publication_date` in 237,942 tenders and 0 NULL `complaint_date` in
8,007 appeals, so nothing is wrong now — but nothing enforces it either. Cheapest option is
one line in the Tier 1 gate asserting the count is zero, which turns an unstated premise
into a checked one at no cost.

## What is deliberately NOT in this plan

**Moving `/procurement`'s hub off the committed blob onto a live PG function**, the way
`/subsidies` (162) and `/funds` (145) did. It is the durable fix for the whole class and it
is a much larger change — and two of the nine fields (`flags`, `places`) are documented as
too heavy to query live, which is the reason the blob exists at all. Tier 1's gate is what
makes the blob safe to keep; retiring it is a separate decision.
