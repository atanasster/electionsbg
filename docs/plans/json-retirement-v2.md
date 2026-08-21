# JSON serving-tree retirement — the next candidates, by priority

Measured 2026-08-21 against the live bucket (`gsutil du`) and the live reader set
(`dataUrl(...)` call sites across `src/`, `ai/`, `functions/`, `scripts/prerender/`).
Supersedes the landscape table in `pg-datasets-roadmap.md`, which is from 2026-07-02 and
predates the tenders / funds / prices / council migrations.

**Scope rule (from the request):** retire the JSON serving tree except (a) elections-related
data and (b) rarely-updated reference datasets. Everything below respects that.

---

## 0. What is actually still on the bucket

| prefix | bucket bytes | live readers |
|---|---:|---|
| `prices/` | **514 MB** | **none** — `_cache/` only; prices are PG-served |
| `officials/` | **510 MB** | **one file** (`municipal_contacts/index.json`, 226 KB) |
| `parliament/` | **487 MB** | `votes/` (401 MB) + `photos/` (12 MB); the rest is retired |
| `budget/` | 38 MB | 4 hooks, ~3.3 MB of it |
| `procurement/` | 0.86 MB | hub_stats, sector_stats, mp_party, projects/, roads.json |
| `myarea/` | 4.1 MB | alerts + place_tenders, **rebuilt daily** |

Everything else on the bucket is an election cycle (`YYYY_MM_DD/`, `sections/`,
`settlements/`, `municipalities/`, `regions/`, `transitions*/`, `local_place_trends/`) or a
small reference artifact. Those stay.

---

## Tier 0 — ~1.05 GB of bucket objects with ZERO readers (a `gsutil rm`, not a migration)

Do this first. It is not a migration, it costs nothing to verify, and it removes the exact
failure this repo has already shipped twice: an excluded-but-not-removed tree that answers
from a frozen snapshot at a 200. `gsutil rsync -x` excludes a match from **deletion** as well
as upload, so every one of these is pinned at whatever vintage it was last synced.

| what | bucket bytes | why it is safe |
|---|---:|---|
| `prices/_cache/**` | **514 MB** | a local build cache uploaded before the `_cache` exclusion existed. Nothing has ever read it. |
| `officials/declarations/**` | 358 MB | loader source for `declaration` (089). Only reader is the PG loader, on disk. |
| `officials/municipal/**` | 54 MB | replaced by `municipal_officials_table` (102) + `/api/db/municipal-officials-*`. Every remaining mention in `src/` is a comment saying so. |
| `officials/derived/**` | 15.7 MB | `company_links.json` retired 2026-08-21 (company-page-consolidation-v1 Tier 6). |
| `parliament/official-connections/**` | 34.7 MB | already in the `isExcluded` retired-artifact list. |
| `parliament/mp-connections/**` | 12.3 MB | same. |
| `parliament/by-id/**` | 1.2 MB | PG-served via `/api/db/mp-entry` (105). |
| `officials/{index,obligations,assets-rankings,assets-rankings-top}.json` | small | replaced by `officials_rankings_table` (100) + the `officials_rankings` registry resource. |
| `parliament/{connections-search,connections-top-pairs,connections-stats,connections-party-matrix,company-connections-stats}.json` | small | already in the retired-artifact exclusion list. |

**Keep** on the bucket: `parliament/photos/**` (12 MB of `.webp` — Decision 3),
`parliament/connections.json` (a published dataset on `/data`),
`parliament/connections-rankings{,-top}.json` (live AI tools),
`officials/municipal_contacts/index.json` (live hook).

Verification already done: `dataUrl()` enumeration over `src/ ai/ functions/ scripts/prerender/`
returns exactly one `officials/` path and no `parliament/{by-id,mp-connections,official-connections}`
path. `ai/` was included deliberately — it is the tree a `src/ scripts/ functions/` grep misses,
and it is where `company-connections` turned out to be live.

---

## Tier 1 — `parliament/votes/sessions/` · **290 MB, 613 files** · the route is ALREADY SHIPPED

**The single biggest win in the repo, and most of the work is done.**

`/api/db/session?date=` (`db_routes.js:5001`) and `/api/db/session-item?item=` both exist,
are deployed, and read `vote_item` / `vote_cast` (migration 134). Nothing calls them.
`SessionScreen.tsx:133` still fetches `dataUrl('/parliament/votes/sessions/${date}.json')`
through `useRollcallSession` — **482 KB on an average day, 4.97 MB on 2025-06-19**, because
that file carries every MP's vote on every item.

The day route is the agenda + tallies (14 buffers); the item route is one item's per-MP votes
(~64 buffers), fetched only when a reader expands a row.

**Work:** rewrite `useRollcallSession` onto `/api/db/session`, add a `useSessionItem` hook for
the expand, adapt `SessionScreen`'s `mpNames` / `mpParty` / per-item `votes` reads.
Then the exclusion (both halves) + the `-x` regex in `bucket:sync` / `bucket:sync:dry`, then
`gsutil -m rm -r`.

**Do NOT filter `superseded_by` on the day route** — it is the day's RECORD, not a statistic
over it. The route already gets this right; the client must not add a filter.

The files stay on disk: they are the loader's input AND the prerender's fact source
(`scripts/prerender/votesFacts.ts`).

---

## Tier 2 — `parliament/votes/derived/` big three · **86 MB** · PG tables exist, hooks half-wired

| artifact | size | PG status |
|---|---:|---|
| `per-mp/**` (2,330 files) | **43 MB** | **no route.** Read by `useMpShard`, which backs `useMpDissents`, `useMpSimilarity`, `useMpLoyalty`. |
| `dissents.json` | **31 MB** | `/api/db/mp-dissents` is PRIMARY; JSON is a fallback and the per-MP shard sits between them. |
| `similarity.json` | **12 MB** | `/api/db/mp-similarity` is PRIMARY; same fallback chain. |

`useMpDissents` / `useMpSimilarity` already prefer Postgres — but `useMpShard` is still the
second arm, so the shard tree cannot be removed and the 31 MB aggregate is still reachable as
arm three. Retiring `per-mp/` collapses all three hooks to PG-or-nothing and drops both
aggregates with it.

**Work:** one new route (or extend `mp-dissents`/`mp-similarity` to return the loyalty slice
too) so `useMpShard` has a PG source; then delete the fallback arms. `mp_vote_norm` (135)
already stores what the loyalty computation needs.

⚠ `mp_similarity` stores `dot` + `overlap`, **not** an agreement rate — the score consumers are
calibrated for is `dot / (norm_a * norm_b)` via `mp_vote_norm`. Substituting a rate relabels
"voting twins" sitewide.

---

## Tier 3 — the rest of `parliament/votes/derived/` · **~12 MB** · two routes already unused

| artifact | size | PG status |
|---|---:|---|
| `topic_index.json` | 8.0 MB | `/api/db/vote-day-summary` + `/api/db/contested-votes` are PRIMARY; JSON kept as fallback |
| `party_pair_breaks.json` | 2.4 MB | no route |
| `search_index.json` | 760 KB | no route (`/api/db/vote-item-search` is adjacent but different) |
| `cohesion.json` | 640 KB | **`/api/db/party-cohesion` exists and NOTHING calls it** |
| `attendance.json` | 504 KB | **`/api/db/mp-attendance` exists and NOTHING calls it** |
| `loyalty.json` | 416 KB | no route; `mp_vote_norm` has the inputs |
| `embedding.json` | 212 KB | no route |
| `important_votes/{ns}.json` | 428 KB | no route |
| `hub_feed/`, `hub_stats.json` | 96 KB | no route |

`attendance` and `cohesion` are free: switch `useAttendance` and `useFactionCohesion` onto the
routes that already ship. The rest need one migration each over `vote_item`/`vote_cast`.

After Tier 1–3, `parliament/votes/` (401 MB on the bucket) goes to zero, and the exclusion +
`rm` for the whole subtree lands in one step.

---

## Tier 4 — `myarea/` · **4.1 MB but REBUILT DAILY, and every input is already in PG**

Small bytes, high churn: 14,746 file-touches across the last 300 commits — the highest churn
rate per byte in the repo.

* `myarea/place_tenders/{obshtina}.json` (265 files, 1.1 MB) — a rolling 6-month window over
  `tenders`, regenerated every day (`generatedAt` today). It is a cache of a PG table with no
  computation in it. **This one is a function + route, nothing more.**
* `myarea/alerts/{obshtina}.json` (3.8 MB) — `build_alerts.ts` already reads council,
  Interreg, open-calls and municipal awarders **from Postgres** (`scripts/db/lib/*_alerts.ts`).
  It folds in the chmi history and capital programmes from disk. Moving the fold into SQL and
  serving `/api/db/myarea-alerts?obshtina=` removes a daily 265-file rebuild + upload.

Also in this tier: `useMpSignals` and `useAreaImportantVotes` read
`votes/derived/{loyalty,important_votes}.json` — they retire with Tier 3.

---

## Tier 5 — the PG-derived stat blobs · **tiny, but this is the documented staleness trap**

These are **committed files derived from Postgres and bucket-synced**, so a corpus reload moves
the numbers underneath a file that keeps serving the old ones at a 200. CLAUDE.md documents the
whole `db:refresh` wiring that exists only to stop them drifting.

| artifact | size | route to build |
|---|---:|---|
| `procurement/derived/hub_stats.json` | 5 KB | `procurement_hub_counts()` (062) already exists — needs a route |
| `procurement/derived/sector_stats.json` | 43 KB | `sector_stats.ts` reads PG + gitignored `budget/ministries/` |
| `procurement/derived/mp_party.json` | 33 KB | `company_politicians` + `party_dim` |
| `governance/declarations_hub_stats.json` | 1 KB | `person_wealth_year` (090) |
| `culture/derived/hub_stats.json` | 1 KB | culture corpus |
| `parliament/votes/derived/hub_stats.json` | 8 KB | `vote_item` + `bill` (136) |

Serving these from a scope-keyed cache matview (the `funds_hub_stats_cache` / 145 pattern)
deletes both the drift AND the `db:gen-*` steps + `REFRESH_GENERATORS` gate that guard it.
**Highest correctness-per-byte item on the list.**

---

## Tier 6 — remaining mid-size stragglers

| artifact | size | note |
|---|---:|---|
| `budget/facts/{fy}/program.json` | 1.7 MB | `budget_program_fact` (153) holds it; `useBudget` already makes 30 `/api/db` calls and 4 `dataUrl` ones |
| `budget/reconciliation/{fy}/by-*.json` | 1.2 MB | `budget_admin_node` / `budget_program_fact` |
| `budget/izdrazhka_by_institution.json` | 18 KB | |
| `budget/derived/admin_flow.json` | ~300 KB | also read by `useSearchItems` |
| `schools/index.json` | 1.28 MB | partial PG already (`school-by-eik`, `education-muni-scores`) |
| `financing/reports.json` + `reports/**` | 1.6 MB, 239 files | annual cadence — low priority |
| `procurement/projects/**` | 124 KB | 13 curated dossiers; low churn |
| `procurement/roads.json` | 710 KB | derived from `contracts`; explicitly whitelisted today |

---

## Explicitly KEEP as JSON

* **Every election tree** — `YYYY_MM_DD/**`, `sections/*_stats.json` (561 MB),
  `settlements/*_stats.json` (164 MB), `municipalities/`, `regions/`, `sections/risk_history/`,
  `transitions*/`, `local_place_trends/`, `local_chmi_history.json`, `chmi_history/`.
  Static once written; the bulk of the bucket and correctly so.
* **Geo** — `maps/**`, `regions_map.json`, `sofia_map.json`, `continents_map.json` (2.8 MB).
* **Reference / near-static** — `settlements.json`, `municipalities.json`, `ekatte_index.json`,
  `postcode_ekatte.json`, `census_2021*.json`, `canonical_parties.json`, `grao_population.json`.
* **Small periodic indicator artifacts** — `macro.json`, `macro_peers.json`, `regional.json`,
  `cofog.json`, `indicators.json`, `fuel.json`, and the ≤1 MB single-file sector artifacts
  (`water/`, `social/`, `energy/`, `air/`, `landuse/`, `culture/`, `administration/`,
  `tourism/`, `security/`, `environment/`, `services/`, `local_taxes/`, `grao/`, `polls/`, `ngo/`).
  Small, cheap, updated monthly-to-annually — migrating them is machinery for nothing.
* **`parliament/photos/**`** — binaries, not JSON.

---

## Recommended order

1. **Tier 0** — `gsutil rm`, ~1.05 GB, zero code. Half a day.
2. **Tier 1** — `SessionScreen` onto the shipped route, 290 MB. One or two days.
3. **Tier 5** — the six hub-stat blobs; deletes a documented drift class, not just bytes.
4. **Tier 4** — `place_tenders` (trivial), then `alerts`.
5. **Tier 2** — `useMpShard` → PG; drops 86 MB and collapses three fallback chains.
6. **Tier 3** — `attendance` + `cohesion` free today; the rest one migration each.
7. **Tier 6** — opportunistic.

**Total retirable: ~1.45 GB of bucket objects**, of which ~1.05 GB needs no code at all.

---

## The three rules every step here must follow

1. **An exclusion FREEZES a tree; it never retires one.** `gsutil rsync -x` excludes a match
   from deletion as well as upload, and `syncPaths` passes `-x` with `-d`. Removing objects is
   always a separate operator action.
2. **Ship the reader BEFORE the `rm`.** Removing `parliament/company-connections/` while a
   shipped AI tool still fetched it is what left that tool answering from a July snapshot at a
   200. Deploy → verify on prod → then remove.
3. **Sweep `ai/` when checking for readers.** A `src/ scripts/ functions/` grep reported zero
   readers for `company-connections/` and was wrong.
