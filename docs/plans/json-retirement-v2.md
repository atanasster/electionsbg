# JSON serving-tree retirement — audited plan

Inventory measured 2026-08-21 against the live bucket (`gsutil du`, `gsutil stat`, `curl`) and
the live reader set (`dataUrl(...)` across `src/`, `ai/`, `functions/`, `scripts/prerender/`).
All query costs are `EXPLAIN (ANALYZE, BUFFERS)` against local Postgres **after `ANALYZE`**,
on the worst-case entity. Supersedes `pg-datasets-roadmap.md` (2026-07-02).

**Scope rule:** retire the JSON serving tree except (a) elections-related data, (b) rarely
updated reference datasets, (c) hub stat blobs (D1).

---

## Progress (2026-08-22)

| step | tier | commit | state |
|---|---|---|---|
| 1 | P1 compression | `ff819a17da` | ✅ 765 files, 402.9 MB → 22.7 MB |
| 2 | P2 visibility map | `8c2485dfb3` | ✅ 10 relations; person_browse_table was at 40.1% |
| 3 | T0 sync guards | `d9a30a181a` | ✅ code only — **the `gsutil rm` is still owed** |
| 4 | T4a place_tenders | `e31d949d2c` | ✅ 286 shards deleted, migration 179 |
| 5 | T1a vote_day | `86430b33a4` | ✅ migration 180, 613/613 sittings |
| 6 | T1b/c SessionScreen | `c7b201b8a4` | ✅ 5.09 MB → ~412 KB per day |
| 7 | T3a attendance+cohesion | `198b04452f` | ✅ migration 181 |
| 8 | T2 per-MP shards | `86f4523797` | ✅ migration 182, useMpShard deleted |
| 9 | T3b topic_index fallbacks | `ee9b0b112f` | ✅ src/ readers only — file stays for `ai/` |
| 10 | T3c party_pair_breaks | `b7c7979cfa` | ✅ migration 183 — **T3c closed, see D5** |
| 11 | T4b myarea alerts | `84199d8ebf` | ✅ migration 184 — storage only, see D6 |

**Still open:** T5 (budget/schools/financing — the plan's own "opportunistic" tier), and every
OPERATOR ACTION below.

### D6 (2026-08-22) — T4b moved the STORAGE, not the fold

The plan said "move the fold into SQL". `build_alerts.ts` is TEN heterogeneous builders and
each composes a BILINGUAL HEADLINE — translated user-facing prose, with pluralisation and money
formatting. That does not belong in a migration: it is the "rule copied by hand into SQL"
hazard with the failure showing up as a sentence rather than a number.

The composition stays in TypeScript; the 290 daily-rewritten files become 290 upserted rows.
That is the win the tier was actually about — ending a daily rebuild-and-re-upload of the
highest churn-per-byte tree in the repo.

⚠️ **The `ai/` blind spot fired for the THIRD time in this plan** (company-connections, then
loyalty/similarity, then this) — `ai/tools/profile.ts` was still fetching the tree. Rule 3
below is not a formality: run the sweep including `ai/` on every retirement, and note that a
`grep` for the FILENAME is not enough — the AI tools compose paths, so enumerate the
`"/…"` literals.

### D5 (2026-08-22) — T3c is CLOSED at one of four, and the other three stay JSON

`party_pair_breaks.json` (2.4 MB) migrated. The plan asserted the other three were "all
derivable from `vote_item` / `vote_cast` / `mp_seat` / `party_dim`". Read against their
builders, that is wrong for one of them and a bad trade for the other two:

| artifact | size | why it stays |
|---|---:|---|
| `embedding.json` | 212 KB | **A UMAP projection** (`umap-js`, 2D over each member's ±1 vote vector, seeded PRNG). Not an aggregation — there is no SQL for it. "Migrating" it would mean a loader that runs UMAP offline and COPYs the points into a table: a second copy of the same numbers, plus a loader to keep in step, for 212 KB. |
| `search_index.json` | 760 KB raw, **~80 KB gzipped** | Feeds the header search on EVERY page. This is D1's argument exactly — a small edge-cached artifact fetched once beats a Cloud Run round-trip on every page load, and worse on a cold `db-g1-small`. It is already a slim top-N projection built precisely to avoid the 580 KB `topic_index` fetch it replaced. |
| `important_votes/{ns}.json` | 428 KB / 9 files | A **title-pattern scorer** with same-bill de-duplication (`classifyTitle`, `normalizeTitle`) — a Cyrillic text-classification heuristic, not an aggregate. Porting it means a second hand-written copy of that scorer in SQL, which is the "rule copied by hand" hazard CLAUDE.md records; the JSON is ~40 KB per parliament. |

None of the three has an `ai/` reader, so all three could be excluded from the bucket the day
a reason to move them appears. There isn't one.

### ⚠️ Operator actions this plan has NOT performed

None of the following were run — they are permanent or outward-facing, and the code changes
above only make them correct and safe:

```bash
# 1. Compression (P1) — run AFTER a bucket:sync, per bucket_gzip.ts's ordering note
npm run bucket:sync:all

# 2. Tier 0 removals — ~1.05 GB, verified readerless
gsutil -m rm -r gs://data-electionsbg-com/prices/_cache
gsutil -m rm -r gs://data-electionsbg-com/officials/{declarations,municipal,derived}
gsutil -m rm -r gs://data-electionsbg-com/parliament/{official-connections,mp-connections,by-id}
gsutil -m rm gs://data-electionsbg-com/officials/{index,obligations,assets-rankings,assets-rankings-top}.json
gsutil -m rm gs://data-electionsbg-com/parliament/postcode_unresolved.json

# 3. The trees this plan retired — ONLY after the readers are deployed and verified on prod
gsutil -m rm -r gs://data-electionsbg-com/myarea/place_tenders
gsutil -m rm -r gs://data-electionsbg-com/parliament/votes/derived/per-mp
gsutil -m rm gs://data-electionsbg-com/parliament/votes/derived/dissents.json
gsutil -m rm -r gs://data-electionsbg-com/parliament/votes/sessions   # after T1 is verified

# 4. Cloud SQL — the five new migrations, in this order
npm run db:load:place-dim:pg:cloud        # applies 117 (seat_ekatte) + 179
npm run db:load:rollcall:pg:cloud         # applies 180, fills vote_day
npm run db:load:rollcall-derived:pg:cloud # applies 181 + 182 — budget ~15 min for mp_similarity
psql "$DATABASE_URL" -c "VACUUM (ANALYZE, PARALLEL 0) vote_item, vote_cast, mp_seat, party_dim, mp_attendance, party_cohesion, party_cohesion_summary, mp_dissent, mp_loyalty, mp_vote_norm, mp_similarity, person_browse_table;"

# 5. Deploy — routes BEFORE hosting, since new /api/db routes are involved
npm run deploy:db
npm run deploy
```

⚠️ **`db:load:place-dim:pg:cloud` reloads `place_dim`, which fires its own fingerprint-gated
refresh of three procurement matviews — minutes on a db-g1-small, with
`/procurement/by-settlement` and every settlement page blocked for the duration.** Off-peak.

⚠️ **An exclusion FREEZES, it does not retire.** Every `rm` above is owed precisely because
the sync guards shipped without it.

## Decisions

**D1 — hub stat blobs STAY as JSON.** A hub landing is the most latency-sensitive page in a
module; these are 1–43 KB, edge-cached at `max-age=300`, and two of them are already stored
gzipped. A Cloud Run round-trip to replace one edge fetch is a net loss, worse on a cold
`db-g1-small`. Covered: `procurement/derived/{hub_stats,sector_stats,mp_party}.json`,
`governance/declarations_hub_stats.json`, `culture/derived/hub_stats.json`,
`parliament/votes/derived/{hub_stats.json,hub_feed/}`.

⚠️ Consequence, stated not hidden: these are committed files derived from Postgres, so the
anti-drift machinery is now **permanent, not transitional** — the `db:gen-hub-stats` /
`db:gen-sector-stats` slot in `db:refresh` (after `db:load:ngo-funding:pg`, the earliest safe
position), `REFRESH_GENERATORS` in `refresh_coverage.test.ts`, and the `bucket:sync` that
publishes them. Anything added to D1 joins `REFRESH_GENERATORS` the same day.

**D2 — T1 gets a `vote_day` side table** for `stenogram_id`, `scraped_at`, `pdf_url`. Verified
absent from `vote_item` (cols: `item_id ns date item_no slug title topic bill_id reading
superseded_by yes no abstain absent`). Without it the "Виж в parliament.bg" source deep-link
dies on every session page. Same migration carries the `refreshed_at` stamp D3 needs.

**D3 — T3a preserves functionality; the analysis is in Tier 3a.** Two gaps must be closed in
the route (`membersTracked`, `computedAt`); the third suspected gap (party attribution) was
measured and is a **non-issue** — see below.

**D4 — T3b proceeds; the analysis is in Tier 3b.** Two fetchers, both already
Postgres-first. The degrade is local-dev-only and is stated.

---

## Audit — what the first draft got wrong

| # | finding | effect |
|---|---|---|
| **A1** | **T1 was materially wrong.** `SessionScreen` is not an agenda list — `computeSessionMetrics`, `RollcallHeatmap`, `SessionDefections`, `SessionAbsentees`, `SessionItemBreakdown` and the focused-MP highlight all iterate **every item's full `votes` array**. "Agenda + lazy per-item expand" breaks five components. | T1 respecified below |
| **A2** | The day-matrix query must use the **InitPlan-array** form. Joining `vote_cast` to `vote_item` drives a Parallel Seq Scan on `vote_item`: **2,779 buffers**. `item_id = ANY(ARRAY(SELECT …))` → **1,378**. Same rule as `tender_search_text`. | query shape pinned |
| **A3** | **Pre-existing repo defect.** `load_rollcall_pg.ts:605` runs a bare `ANALYZE`, not `vacuumAfterReload()` — the documented "disguise". None of the 8 rollcall relations are in `reload_visibility_map.data.test.ts`. Measured: `vote_item` 90.8% visible, `mp_similarity` 97.7%, and `pg_stat_user_tables` shows **no statistics at all** for `vote_item`/`vote_cast`/`mp_seat`/`party_dim`. | new **Tier P** |
| **A4** | **T3a has two real gaps** — `membersTracked` is not in `party_cohesion` (cols: `ns date party_id items cohesion`), and `computedAt` is **rendered** (`ParliamentAttendanceScreen:203`, `ParliamentCohesionScreen:186`) with no live equivalent. | closed in T3a |
| **A5** | **I nearly overstated T1 by ~30x.** I assumed the bucket served gzip. It does not: `gsutil stat` and a real `curl -H 'Accept-Encoding: gzip'` both return **5,086,380 bytes, `x-goog-stored-content-encoding: identity`**. The original 4.85 MB figure is right — but only because compression is *missing*, which is itself a finding. | new **Tier P** |
| **A6** | **`tenders.publication_date` is `text`, not `date`.** A `now() - interval` bound raises 42883. Needs `to_char(…,'YYYY-MM-DD')`; lexicographic ISO then rides `idx_tenders_buyer_date`. | T4a |
| **A7** | `place_tenders` files are keyed by **obshtina**; `readMunicipalAwardersByEkatte` selects `source='geo' AND is_local_hq AND tier='municipal'` keyed by **ekatte**. The route needs the obshtina→ekatte resolution. | T4a |

**Corrected in the safe direction (A4c).** I suspected swapping `useAttendance` to the route
would relabel the 179 seats that change party mid-term, because the JSON builder uses the
session's party-at-time map while the route joins `mp_seat`. Measured across **every** NS:

```
seats where mp_seat.party_id <> latest cast-time party  →  0 of 2,366
```

`mp_seat.party_id` **is** the latest cast-time affiliation, so the seat-join reproduces the
builder's entry-level label exactly — at 38 buffers instead of the **1,143,102 buffers /
1,255 ms** the live cast-time rule costs. Two consequences: implement it as the seat-join, and
**gate the invariant**, because it is an accident of how the loader builds `mp_seat`.
⚠️ This does **not** relax the rule for per-item grouping — 179 seats differ at cast time on
individual items, so any aggregate over votes still groups on `vote_cast.party_id`.

---

# Tier P — prerequisites · near-zero effort, immediate payoff

### P1. Compress the big artifacts (measured, verified over HTTP)

`bucket:gz` covers a bounded hot-file list that **excludes every artifact in this plan**. Live:

| object | served bytes | stored encoding |
|---|---:|---|
| `votes/derived/dissents.json` | **32,575,807** | `identity` |
| `votes/derived/topic_index.json` | **8,368,917** | `identity` |
| `votes/sessions/2025-06-19.json` | **5,086,380** | `identity` |
| `procurement/derived/hub_stats.json` | 1,156 | gzip ✅ |
| `settlements.json` | 157,734 | gzip ✅ |

Measured per artifact (`zlib` level 6, what `cp -Z` stores) — **no single ratio covers the
set**, so quote the artifact, never an average:

| artifact | raw | gzip | ratio |
|---|---:|---:|---:|
| `sessions/**` (whole tree, 613 files) | 288.4 MB | **11.9 MB** | 24.3x |
| `sessions/2025-06-19.json` | 5,086,380 | 171,182 | 29.7x |
| `derived/dissents.json` | 32,575,807 | 2,704,470 | 12.0x |
| `derived/similarity.json` | 12,275,762 | 1,545,406 | 7.9x |
| `derived/topic_index.json` | 8,368,917 | 634,191 | 13.2x |

⚠️ An earlier draft of this line said "gzips ~5.9x" and derived a 300 KB session threshold
from it. Both were wrong: 5.09 MB → 171 KB is **29.7x**, and the threshold it justified
forgoes 42.2 MB of reader download to avoid 2.9 MB of upload. The whole tree is compressed,
with no floor. Corrected 2026-08-21 — the figure had already propagated into two code
comments before it was caught.
Adding these four paths to `bucket_gzip.ts`'s list buys **~85% off the wire today**, before a
line of migration code — and it protects the users who hit the fallback arms while Tiers 1–3
are in flight.

⚠️ Ordering: `bucket:sync` re-uploads them uncompressed (the gzipped object differs from the
local file), so this must run AFTER sync — `npm run bucket:sync:all`, exactly as
`bucket_gzip.ts`'s own header says.

### P2. Fix the rollcall visibility map (A3)

Replace the bare `ANALYZE` loop at `load_rollcall_pg.ts:605` with `vacuumAfterReload()`, do the
same in `load_rollcall_derived_pg.ts:51`, and add all eight relations to `RELOADED` in
`reload_visibility_map.data.test.ts`. Then repair the existing databases:

```bash
psql "$DATABASE_URL" -c "VACUUM (ANALYZE, PARALLEL 0) vote_item, vote_cast, mp_seat, party_dim, mp_attendance, party_cohesion, mp_dissent, mp_similarity, mp_vote_norm;"
```

Every measurement below depends on statistics existing. Before `ANALYZE`, the same day-matrix
query planned worse and ran 25.0 ms instead of 19.4 ms — and **the local database had no stats
for these tables at all**, which is the `reference_local_pg_has_no_stats` trap: a local timing
taken in that state proves nothing.

**Effort:** half a day for both. **Do these first** — P1 alone is most of T1's user-visible win.

---

# Tier 0 — ~1.05 GB of zero-reader bucket objects · `gsutil rm` · no code

`gsutil rsync -x` excludes a match from **deletion** as well as upload, and `syncPaths` passes
`-x` with `-d`, so every tree below is pinned at whatever vintage it was last synced.

```bash
gsutil -m rm -r gs://data-electionsbg-com/prices/_cache                    # 514 MB
gsutil -m rm -r gs://data-electionsbg-com/officials/declarations          # 358 MB
gsutil -m rm -r gs://data-electionsbg-com/officials/municipal             #  54 MB
gsutil -m rm -r gs://data-electionsbg-com/officials/derived               #  16 MB
gsutil -m rm -r gs://data-electionsbg-com/parliament/official-connections #  35 MB
gsutil -m rm -r gs://data-electionsbg-com/parliament/mp-connections       #  12 MB
gsutil -m rm -r gs://data-electionsbg-com/parliament/by-id                # 1.2 MB
gsutil -m rm gs://data-electionsbg-com/officials/{index,obligations,assets-rankings,assets-rankings-top}.json
gsutil -m rm gs://data-electionsbg-com/parliament/{connections-search,connections-top-pairs,connections-stats,connections-party-matrix,company-connections-stats}.json
gsutil -m rm gs://data-electionsbg-com/parliament/postcode_unresolved.json
gsutil -m rm gs://data-electionsbg-com/{officials,parliament}/.DS_Store
```

Each is replaced by a shipped PG surface: `officials/municipal/` → `municipal_officials_table`
(102); `officials/assets-rankings*` → `officials_rankings_table` (100); `parliament/by-id/` →
`/api/db/mp-entry` (105); `officials/derived/company_links.json` retired 2026-08-21;
`prices/_cache/` was a local build cache uploaded before the `_cache` exclusion existed.

**Then add the sync guards** — `officials/**` and `parliament/postcode_unresolved.json` are not
in `isExcluded` today. Four edits, not one: `isExcluded`, the `CHILD_EXCLUDES` twin (the first
guards only a DIRECT argument), and the `-x` arms in both `bucket:sync` and `bucket:sync:dry`.
`bucket_sync_paths.test.ts` holds them in lockstep. Keep `officials/municipal_contacts/`
uploadable.

**Do NOT remove:** `parliament/photos/**`, `parliament/connections.json` (a published dataset
on `/data` via `CATALOG_SPECS`), `parliament/connections-rankings{,-top}.json` (live AI tools),
`officials/municipal_contacts/index.json` (live hook).

**Gate before the `rm`** — re-run including `ai/`; a `src/ scripts/ functions/` grep reported
zero readers for `company-connections/` and was wrong:

```bash
grep -rn "officials/\|parliament/by-id\|mp-connections\|official-connections" src/ ai/ functions/ scripts/prerender/ | grep -E "fetch\(|dataUrl\("
```

Expected: exactly one line, `useMunicipalContacts.tsx`. **Verified 2026-08-21.**

---

# Tier 1 — `parliament/votes/sessions/` · 290 MB, 613 files · RESPECIFIED (A1)

`/api/db/session?date=` already ships and is called by nothing. But per A1 the page needs the
**whole day's matrix**, so the design is an agenda route plus a compact full-day cast route —
*not* lazy per-item fetching.

### The payload win is real and it is about DECODE, not just wire

| form | bytes | note |
|---|---:|---|
| today's JSON | **5,086,380** | served `identity` (A5) |
| today's JSON, gzipped | 171,091 | what Tier P1 gets you for free |
| compact `mp:vote` pairs from PG | 491,520 raw | measured |
| positional (fixed MP order, 1 char/MP) | **~82,000 raw** | 293 × 240 + roster |

Post-P1 the wire win is 171 KB → ~30 KB gzipped. The **decode** win is the bigger one:
4.85 MB of JSON parsed into JS heap on a phone, versus ~82 KB. `CompactVote`
(`"y" | "n" | "a" | "x"`) already exists in `types.ts` for exactly this reason.

### Steps

1. **Migration: `vote_day`** (D2) — `(ns, date) PK, stenogram_id, scraped_at, pdf_url,
   refreshed_at`. Filled by `load_rollcall_pg.ts` from the session files it already reads.
   Add its `app_readonly` GRANT. `refreshed_at` also serves D3's `computedAt`.
2. **Extend `/api/db/session`** to join `vote_day` and return the three fields.
3. **New `/api/db/session-casts?date=`** — the full-day matrix, positional encoding, using the
   **A2 form**:
   ```sql
   SELECT c.item_id, string_agg(c.mp_id::text||':'||c.vote::text, ',' ORDER BY c.mp_id)
     FROM vote_cast c
    WHERE c.item_id = ANY(ARRAY(SELECT item_id FROM vote_item WHERE date = $1))
    GROUP BY c.item_id
   ```
   Measured **1,378 buffers / 19.4 ms** on the worst day. Emit the MP roster (id → name,
   party) once per response rather than per item — that is what `mpNames`/`mpParty` are.
4. **Rewrite `useRollcallSession`** to compose both routes into `SessionFile`. `title`, `slug`
   and `topic` are per-row on `vote_item`, so `itemTitles` / `itemSlugs` / `itemTopics`
   collapse into row fields — adapt the five consumers rather than rebuilding the maps.
5. Keep `/api/db/session-item` for the per-item hemicycle if a reader deep-links one item; it
   is 61 buffers and already ships.
6. Verify on prod → exclude (four edits) → `gsutil -m rm -r .../parliament/votes/sessions`.

### Rules

- ⚠️ **Do NOT filter `superseded_by` on either session route.** It is the day's RECORD, not a
  statistic over it — a motion put to the floor twice is a fact about the day. Every Tier 3
  aggregate does the opposite.
- `spansNs` is a real signal the route emits and no consumer handles — surface it, don't take
  `ns[0]`.
- The files **stay on disk**: loader input AND the prerender's fact source
  (`scripts/prerender/votesFacts.ts`).

**Effort:** 2–3 days (up from 1–2; A1 added a route and five consumers).

---

# Tier 2 — `derived/{per-mp, dissents, similarity}` · 86 MB

| artifact | served bytes | state |
|---|---:|---|
| `per-mp/**` (2,330 files) | 43 MB | **no route** — `useMpShard` backs dissents, similarity AND loyalty |
| `dissents.json` | **32,575,807** | route is PRIMARY; shard is arm 2, this is arm 3 |
| `similarity.json` | 12 MB | route is PRIMARY; same chain |

One new route kills all three.

1. **`/api/db/mp-rollcall?ns=&mp=`** returning the whole `MpShard`:
   - `loyalty` — `mp_vote_norm` + `vote_cast`
   - `attendance` — `mp_attendance` (already exposed)
   - `cohort` — chamber medians in the same query. Measured **32 buffers / 0.4 ms**.
   - `dissents` / `similarity` — reuse the existing bodies. Similarity topK measured
     **210 buffers / 4.5 ms**; a real peer set needs BOTH directions
     (`idx_mp_similarity_pk` + `idx_mp_similarity_b`), so budget ~420.
2. Point `useMpShard` at it, then **delete the JSON arms** from `useMpDissents`,
   `useMpSimilarity`, `useMpLoyalty` — leaving them is what keeps 43 MB alive.
3. Exclude + `rm`.

⚠️ `mp_similarity` stores `dot` + `overlap`, **not** an agreement rate — the calibrated score
is `dot / (norm_a * norm_b)` via `mp_vote_norm`. Substituting a rate relabels "voting twins"
sitewide. ⚠️ Key on `(ns, mp_id)`, never `mp_id` alone: 26 ids name two different people.
⚠️ `mp_similarity`'s refresh is **744.5 s on Cloud SQL** — budget it into any deploy that
re-runs `db:load:rollcall-derived:pg:cloud`.

**Effort:** 2–3 days.

---

# Tier 3

## 3a — attendance + cohesion · the routes ship; here is the D3 analysis

Both routes are cheap: `mp-attendance` **38 buffers / 2.7 ms**, `party-cohesion`
**42 buffers / 3.4 ms** (ns=51, the largest, 1,506 rows).

`useAttendance` fetches the whole `byNs` envelope (~43 KB gzipped) and uses **one** slice, so
the swap is mostly mechanical. What is **not** mechanical:

| `CohesionEntry` / `AttendanceFile` field | derivable from route? | action |
|---|---|---|
| `presentPct` | yes — `present / items` | compute client-side |
| `itemsCovered` | yes — `sum(items)` over the series | compute client-side |
| `meanCohesion` | yes — weighted mean over the series | compute client-side |
| `medianCohesion` | yes — median over dates | compute client-side |
| `partyShort` | **yes, exactly** — seat-join == latest cast party, 0/2,366 drift (A4c) | seat-join; **add the invariant gate** |
| **`membersTracked`** | **NO** — `party_cohesion` is `ns date party_id items cohesion` | **add to the route**: `count(DISTINCT mp_id)` per (ns, party) from `vote_cast` |
| **`computedAt`** | **NO** — rendered at `ParliamentAttendanceScreen:203` and `ParliamentCohesionScreen:186` | **use `vote_day.refreshed_at`** from D2's migration |

So T3a **depends on D2's migration** and is no longer free — but it is still small, and both
gaps are closed rather than dropped, per the preserve-functionality decision.

⚠️ The route filters `НЕЗ` / `НЕЧЛ В ПГ` — members without a group, whose "cohesion" is a
number about individuals. Charting them alongside groups made the 50th read 0.94 against a
real-group 0.973. **Do not restore them for parity with the JSON.** This is a deliberate
divergence: the route is more correct than the file it replaces, and the screens' numbers will
move. Say so in the commit.

**Effort:** 1 day (was 0.5 — `membersTracked` + `computedAt`).

## 3b — `topic_index.json` (8,368,917 bytes) · the D4 analysis

**Exactly two live fetchers remain**, both already Postgres-first with the JSON as arm 2:
`useVoteDaySummary` and `useContestedVotes`. Every other mention in `src/` is a comment
recording a migration away from it (`ContestedVotesFeed`, `SessionOutcomeBar`,
`parliamentSearch`, `useSearchItems`, `useAreaImportantVotes`).

**What breaks if the fallback goes:** only a checkout with no Postgres and no
`VITE_DATA_BASE_URL`-reachable database — i.e. local dev without `db:pg:up`. `/votes` loses its
topic chips and outcome bar there. Production is unaffected (`vote_item` is loaded on prod),
and the "first cloud deploy before the loader runs" contingency has passed.

**Recommendation: proceed**, and say in the commit that local dev now needs `npm run db:pg:up`
for `/votes` — that is already true of most of the site.

⚠️ **Deleting the fallback does NOT let you delete the TS twin.** `outcomeBucket()` /
`outcomeFor()` stay: `bill_and_topics.data.test.ts` re-derives every day's buckets from the
session files against them, and the `abstain = cast` branch rides on `outcomeFor()`'s
definition alone because no item in the corpus reaches it.

## 3c — the rest · one migration each

`party_pair_breaks` (2.4 MB), `search_index` (760 KB), `important_votes/{ns}` (428 KB),
`embedding` (212 KB), `loyalty` (416 KB — retires with T2's route). All derivable from
`vote_item` / `vote_cast` / `mp_seat` / `party_dim`.

Every aggregate needs **`WHERE superseded_by IS NULL`** (1,645 re-votes, 9.8% over-count) and
must group on **`vote_cast.party_id`** — 179 seats change party mid-term (measured), and
grouping on the seat compares those members against a group they had already left.

---

# Tier 4 — `myarea/` · 4.1 MB · highest churn-per-byte in the repo

14,746 file-touches across the last 300 commits, rebuilt and re-uploaded daily.

### 4a — `place_tenders/` (265 files, 1.1 MB)

A rolling window over `tenders` with no computation in it. `build_alerts.ts` reads it from
`data/procurement/tenders/recent_by_buyer.json` — a file, while `tenders` is a PG table.

`/api/db/myarea-place-tenders?obshtina=` — measured **212 buffers / 2.2 ms** for the busiest
municipality (Sofia, 221 tenders in a 6-month window), riding `idx_tenders_buyer_date`:

```sql
WHERE t.buyer_eik = ANY(ARRAY(
        SELECT eik FROM awarder_seats
         WHERE tier='municipal' AND source='geo' AND is_local_hq AND ekatte = $1))
  AND t.publication_date >= to_char(current_date - interval '6 months', 'YYYY-MM-DD')
```

⚠️ **A6 — `publication_date` is `text`.** `now() - interval` raises 42883. The `to_char` bound
compares lexicographically, which is correct for ISO dates and stays sargable.
⚠️ **A7 — the file is keyed by obshtina, the awarder set by ekatte.** Resolve obshtina→ekatte
(the municipality centroid) in the route, matching `readMunicipalAwardersByEkatte`'s
`source='geo' AND is_local_hq AND tier='municipal'` predicate exactly — 264 rows.
⚠️ `since` and `generatedAt` are rendered. Derive `since` from the window bound; **drop
`generatedAt`** — a live query has no generation time, and emitting `now()` as if it were a
build stamp is a false claim.

### 4b — `alerts/` (3.8 MB, 290 files)

`build_alerts.ts` already reads council, Interreg, open-calls and municipal awarders **from
Postgres**. Still on disk: chmi history and capital programmes — both small, static, committed.
Move the fold into SQL behind `/api/db/myarea-alerts?obshtina=`.

⚠️ `readMunicipalAwardersByEkatte` **throws rather than degrades**, deliberately: one transient
database condition would otherwise blank the procurement and tender alerts in all 290 files and
delete every place-tender summary, silently, exit 0, in an unattended auto-committing step. A
serving route inverts that risk — a failure becomes one empty tile on one page — but the route
**must still distinguish "no events" from "could not read"**, or the tile says "nothing is
happening here" during an outage.

### 4c — retires with Tier 3

`useMpSignals` reads `loyalty.json`; `useAreaImportantVotes` reads `important_votes/{ns}.json`.

---

# Tier 5 — stragglers · opportunistic

`budget/facts/{fy}/program.json` (1.7 MB), `budget/reconciliation/{fy}/by-*.json` (1.2 MB),
`budget/derived/admin_flow.json` (~300 KB, two consumers), `budget/izdrazhka_by_institution.json`
(18 KB), `schools/index.json` (1.28 MB — the last `dataUrl` in an otherwise fully-PG family, so
the best cost/benefit item here), `financing/reports*` (1.6 MB, annual — arguably a keep),
`procurement/projects/**` (124 KB).

⚠️ `budget/reconciliation/` and `budget/ministries/` are **gitignored** — the reason
`db:load:budget:pg` is a `REFRESH_EXCLUSIONS` member, and `sector_stats` reads eight ПРБ nodes
from `budget/ministries/`. Migrating them makes the sector generator's input a table rather
than a gitignored tree. That secondary win is worth more than the byte count.

---

# Performance checks

## Measured baselines (worst-case entity, after `ANALYZE`, local Postgres)

| tier | query | worst case | buffers | ms |
|---|---|---|---:|---:|
| T1 | `session` agenda | 2025-06-19, 293 items | **21** | 2.1 |
| T1 | `session-casts` — **A2 form** | 70,320 casts | **1,378** | 19.4 |
| T1 | `session-casts` — naive join ✗ | same | 2,779 | 25.0 |
| T1 | `session-item` | item 12696, 240 casts | **61** | 1.2 |
| T2 | cohort medians | ns=51 | **32** | 0.4 |
| T2 | similarity topK (one direction) | ns=51 | **210** | 4.5 |
| T3a | `mp-attendance` | ns=51 | **38** | 2.7 |
| T3a | `party-cohesion` | ns=51, 1,506 rows | **42** | 3.4 |
| T4a | `myarea-place-tenders` | Sofia, 221 tenders | **212** | 2.2 |
| — | live cast-time party ✗ **REJECTED** | ns=51 | **1,143,102** | 1,255 |

## Budgets — every new route must hold these

1. **≤ 2,000 shared buffers per call** at the worst-case entity (the `dashboard-hub` budget).
   Everything above passes; `session-casts` at 1,378 is the tightest, so **re-measure it before
   adding a column** — it is the one with headroom under 2x.
2. **≤ 500 ms local** at the worst-case entity. Prod is a `db-g1-small` over the proxy under a
   **10 s `statement_timeout`**; the observed local:cloud ratio on this corpus runs to **11x**
   (`mp_similarity` refresh: 70 s local, 744.5 s cloud). Treat 500 ms local as the ceiling that
   keeps you clear of it.
3. **No Seq Scan on `vote_item`, `vote_cast`, `tenders` or `contracts`** in any plan.
4. **Payload ≤ 150 KB gzipped** per route. `session-casts` positional is ~30 KB; the
   `mp:vote` pair form is ~120 KB and only just fits — prefer positional.

## Protocol — how to take a measurement that means something

- **`ANALYZE` first.** `pg_stat_user_tables` showed **no statistics** for `vote_item`,
  `vote_cast`, `mp_seat`, `party_dim` on this machine. A timing taken in that state proves
  nothing (`reference_local_pg_has_no_stats`; the 4h41m incident).
- **Worst-case entity, never a median one.** 2025-06-19 (293 items / 70,320 casts) for a day,
  ns=51 for a parliament, Sofia for a place, mp 5244 (615 dissents) for a member.
- **`EXPLAIN (ANALYZE, BUFFERS)`, and read `Buffers` not `Execution Time`** — a warm local
  cache flatters wall-clock and hides the page count that decides cloud cost.
- **`PREPARE` for anything parameterised on a short/selective value** — a psql literal
  constant-folds, the planner estimates through it, picks the good plan and hides the problem.
- **Re-measure on Cloud SQL** before declaring a route done. Nothing local is evidence about
  prod.

## Regression gates to ship with each tier

Follow `person_connections.data.test.ts`, which holds a buffer ceiling **and** proves it still
discriminates by restoring the old body in a rolled-back transaction.

- **T1** — `session-casts` ≤ 2,000 buffers on 2025-06-19; a mutation check that the naive join
  form exceeds it (otherwise the assertion passes on either implementation).
- **T3a** — the **A4c invariant**: `mp_seat.party_id` equals each MP's latest cast-time party,
  0 of 2,366. This is an accident of the loader, not a guarantee; if it ever breaks, the
  attendance/cohesion party labels silently go wrong for up to 179 seats.
- **T3c** — every new aggregate filters `superseded_by IS NULL` and groups on
  `vote_cast.party_id`; assert a mutated version (filter removed) returns a **different**
  count, so a gate cannot go vacuous.
- **T4a** — ≤ 500 buffers for the busiest municipality; and that the `text` date bound is still
  sargable (no Seq Scan on `tenders`).
- **Tier P** — extend `reload_visibility_map.data.test.ts` to the eight rollcall relations, and
  assert `relallvisible / relpages ≥ 0.95` for each.

---

## Explicitly KEEP as JSON

Every election tree (`YYYY_MM_DD/**`, `sections/*_stats.json` 561 MB,
`settlements/*_stats.json` 164 MB, `municipalities/`, `regions/`, `sections/risk_history/`,
`transitions*/`, `local_place_trends/`, `chmi_history/`, `{date}/parties/*`); the D1 hub blobs;
geo (`maps/**`, `regions_map.json`, `sofia_map.json`, `procurement/roads.json` — road linework,
a geo artifact not a stat); reference data (`settlements.json`, `municipalities.json`,
`ekatte_index.json`, `postcode_ekatte.json`, `census_2021*.json`, `canonical_parties.json`,
`grao_population.json`); the ≤1 MB periodic sector artifacts (`water/`, `social/`, `energy/`,
`air/`, `landuse/`, `culture/`, `administration/`, `tourism/`, `security/`, `environment/`,
`services/`, `local_taxes/`, `grao/`, `polls/`, `ngo/`, `macro*.json`, `regional.json`,
`cofog.json`, `indicators.json`, `fuel.json`); and `parliament/photos/**` (binaries).

---

## Sequence

| # | tier | bucket bytes | effort | note |
|---|---|---:|---|---|
| 1 | **P1** compression | — | 0.25 d | ~85% off the wire, today |
| 2 | **P2** visibility map | — | 0.25 d | every measurement depends on it |
| 3 | **T0** `rm` + sync guards | **1.05 GB** | 0.5 d | no code |
| 4 | **T4a** `place_tenders` | 1.1 MB | 0.5 d | pure PG cache; measured |
| 5 | **T1** `vote_day` + two routes | **290 MB** | 2–3 d | D2 |
| 6 | **T3a** attendance + cohesion | 1.1 MB | 1 d | needs D2's migration |
| 7 | **T2** `mp-rollcall` | **86 MB** | 2–3 d | collapses 3 fallback chains |
| 8 | **T3b/3c** topic_index + 4 migrations | 12 MB | 2–3 d | |
| 9 | **T4b** alerts | 3.8 MB | 2 d | ends a daily 290-file rebuild |
| 10 | **T5** stragglers | ~6 MB | opportunistic | `schools/index.json` first |

Items 1–4 are **~1.05 GB plus the compression win in about 1.5 days**. T1 moved after T4a
because D2's `vote_day` migration is now a shared dependency and T4a is the cheapest way to
prove the route pattern.

---

## The five rules every step must follow

1. **An exclusion FREEZES a tree; it never retires one.** `rsync -x` excludes from deletion as
   well as upload. Removing objects is always a separate operator action.
2. **Ship the reader BEFORE the `rm`, and verify on prod.** Removing
   `parliament/company-connections/` while a shipped AI tool still fetched it left that tool
   answering from a July snapshot at a 200.
3. **Sweep `ai/` when checking readers.** A `src/ scripts/ functions/` grep reported zero
   readers for `company-connections/` and was wrong.
4. **An exclusion needs FOUR edits** — `isExcluded`, the `CHILD_EXCLUDES` twin, and the `-x`
   arms in both `bucket:sync` and `bucket:sync:dry`.
5. **`bucket:gz` runs AFTER `bucket:sync`**, or rsync clobbers the gzipped objects. Use
   `npm run bucket:sync:all`.

## Deploy order

New `/api/db` route + hosting change: **`deploy:db` → `deploy`**. Hosting first points the URL
at a function that cannot serve it. When the bundle hash moves and a function-served page
family is involved, use the three-step form
(`deploy` → `deploy:db` → `SKIP_PREDEPLOY=1 deploy`). A migration always precedes its writer
and its reader.
