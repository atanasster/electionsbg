# JSON serving-tree retirement — inventory and execution plan

Measured 2026-08-21 against the live bucket (`gsutil du`) and the live reader set
(`dataUrl(...)` call sites across `src/`, `ai/`, `functions/`, `scripts/prerender/`).
Supersedes the landscape table in `pg-datasets-roadmap.md`, which is from 2026-07-02 and
predates the tenders / funds / prices / council migrations.

**Scope rule:** retire the JSON serving tree except (a) elections-related data, (b) rarely
updated reference datasets, and (c) **hub stat blobs — see Decision 1**.

---

## Decision 1 (2026-08-21) — hub stat blobs STAY as JSON

A hub landing is the most latency-sensitive page in a module, and these blobs are 1–43 KB
served from the CDN edge at `max-age=300`. A Cloud Run round-trip to replace a single
edge-cached fetch is a net loss there, and a cold `db-g1-small` makes it a worse one. The
`dashboard-hub` pattern of ONE small precomputed blob per hub is deliberate; this decision
keeps it.

**Covered by this decision — do not migrate:**

| artifact | size | serves |
|---|---:|---|
| `procurement/derived/hub_stats.json` | 5 KB | `/procurement` stat tiles |
| `procurement/derived/sector_stats.json` | 43 KB | `/governance/sectors` headlines |
| `procurement/derived/mp_party.json` | 33 KB | party chips on two `/procurement` tiles |
| `governance/declarations_hub_stats.json` | 1 KB | `/governance/declarations` |
| `culture/derived/hub_stats.json` | 1 KB | `/culture` |
| `parliament/votes/derived/hub_stats.json` | 8 KB | `/parliament` |
| `parliament/votes/derived/hub_feed/{ns}.json` | 88 KB total | `ParliamentSessionStrip` on `/parliament` |

⚠️ **The consequence, stated rather than hidden.** These are committed files derived from
Postgres, so a corpus reload moves the numbers underneath a file that keeps serving the old
ones at a 200. The machinery that stops that drift is now permanently load-bearing rather
than transitional: the `db:gen-hub-stats` / `db:gen-sector-stats` slot in `db:refresh` (after
`db:load:ngo-funding:pg` — the earliest safe position), `REFRESH_GENERATORS` in
`refresh_coverage.test.ts`, and the `bucket:sync` that publishes them. Keeping the blobs means
keeping all three. Anything ADDED to this list must join `REFRESH_GENERATORS` on the same day.

---

## The remaining inventory

| prefix | bucket bytes | live readers |
|---|---:|---|
| `prices/` | **514 MB** | **none** — `_cache/` only; prices are PG-served |
| `officials/` | **510 MB** | **one file** (`municipal_contacts/index.json`, 226 KB) |
| `parliament/` | **487 MB** | `votes/` (401 MB) + `photos/` (12 MB); the rest is retired |
| `budget/` | 38 MB | 4 hooks, ~3.3 MB of it |
| `myarea/` | 4.1 MB | alerts + place_tenders, **rebuilt daily** |
| `procurement/` | 0.86 MB | hub blobs (Decision 1) + `roads.json` + `projects/` |

**Retirable after Decision 1: ~1.44 GB**, of which ~1.05 GB needs no code at all.

---

# Tier 0 — ~1.05 GB of zero-reader bucket objects · `gsutil rm` · no code

Do this first. It removes the exact failure this repo has shipped twice: an
excluded-but-never-removed tree answering from a frozen snapshot at a 200. `gsutil rsync -x`
excludes a match from **deletion** as well as upload, and `syncPaths` passes `-x` with `-d`,
so every tree below is pinned at whatever vintage it was last synced.

### 0a. Remove

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
gsutil -m rm gs://data-electionsbg-com/{officials,parliament}/.DS_Store
gsutil -m rm gs://data-electionsbg-com/parliament/postcode_unresolved.json
```

Each is replaced by a shipped PG surface: `officials/municipal/` → `municipal_officials_table`
(102) + `/api/db/municipal-officials-*`; `officials/assets-rankings*` →
`officials_rankings_table` (100); `parliament/by-id/` → `/api/db/mp-entry` (105);
`officials/derived/company_links.json` retired 2026-08-21 (company-page-consolidation-v1 Tier 6);
`prices/_cache/` was never anything but a local build cache uploaded before the `_cache`
exclusion existed.

### 0b. Add the missing sync guards

`prices/_cache` is covered by the generic `_cache` rule. `officials/**` and
`parliament/postcode_unresolved.json` are **not** in `isExcluded` today — add them, plus the
`CHILD_EXCLUDES` twin (`isExcluded` guards only a DIRECT argument, so
`bucket:sync:paths -- officials` would walk straight back in), plus the `-x` arms in
`bucket:sync` and `bucket:sync:dry` in `package.json`. `bucket_sync_paths.test.ts` holds all
three in lockstep. Keep `officials/municipal_contacts/` uploadable.

### 0c. Do NOT remove

`parliament/photos/**` (12 MB of `.webp`, Decision 3), `parliament/connections.json` (a
published dataset offered for download on `/data` via `CATALOG_SPECS`),
`parliament/connections-rankings{,-top}.json` (live AI tools),
`officials/municipal_contacts/index.json` (live hook).

### 0d. Gate

Re-run the reader sweep including `ai/` immediately before the `rm` — a
`src/ scripts/ functions/` grep reported zero readers for `company-connections/` and was wrong:

```bash
grep -rn "officials/\|parliament/by-id\|mp-connections\|official-connections" src/ ai/ functions/ scripts/prerender/ | grep -E "fetch\(|dataUrl\("
```

Expected output: exactly one line, `useMunicipalContacts.tsx`.

**Effort:** half a day. **Risk:** low, and bounded — every removed object is reconstructible
from a local build.

---

# Tier 1 — `parliament/votes/sessions/` · 290 MB, 613 files · the route is ALREADY SHIPPED

The biggest single win in the repo, and the server half is done and deployed.

**Today:** `SessionScreen.tsx:133` → `useRollcallSession` → `dataUrl('/parliament/votes/sessions/${date}.json')`.
482 KB on an average day, **4.97 MB on 2025-06-19**, because the file carries every MP's vote
on every item — downloaded whole to render an agenda.

**Available and called by nothing:** `/api/db/session?date=` (`db_routes.js:5001`, 14 buffers)
returns the agenda + tallies; `/api/db/session-item?item=` (~64 buffers) returns one item's
per-MP votes.

### Steps

1. Rewrite `useRollcallSession` onto `/api/db/session`. The route returns
   `{ date, ns, spansNs?, items[] }`; `SessionFile` wants `{ ns, date, stenogramId, scrapedAt,
   mpNames, mpParty, itemTitles, itemSlugs, itemTopics, pdfUrl, sessions[] }`. `title`, `slug`
   and `topic` are already per-row on `vote_item`, so the four lookup maps collapse into row
   fields — adapt the consumer rather than reconstructing the maps.
2. Add `useSessionItem(itemId)` on `/api/db/session-item`, fetched lazily when a reader
   expands a row. This is the whole point: the per-MP matrix stops being part of page load.
3. `stenogramId` / `scrapedAt` / `pdfUrl` are not on `vote_item`. Either add them to the route
   (a `vote_day` side table or columns on the items) or drop the "Виж в parliament.bg"
   deep-link. **Decide before starting** — silently dropping the link loses the source
   attribution on every session page.
4. Verify on prod, then exclude (`isExcluded` + `CHILD_EXCLUDES` + both `-x` arms), then
   `gsutil -m rm -r gs://data-electionsbg-com/parliament/votes/sessions`.

### Rules

- ⚠️ **Do NOT filter `superseded_by` on the day route.** It is the day's RECORD, not a
  statistic over it — a motion put to the floor twice is a fact about the day. The route
  already gets this right; the client must not add a filter. (Every matview arm in Tier 3
  does the opposite: `WHERE superseded_by IS NULL`, or it over-counts by 9.8%.)
- The files **stay on disk**: they are `db:load:rollcall:pg`'s input AND the prerender's fact
  source (`scripts/prerender/votesFacts.ts`).
- `spansNs` is a real signal the route emits and no consumer handles yet — surface it rather
  than taking `ns[0]`.

**Effort:** 1–2 days. **Risk:** medium — `SessionScreen` is a real page rewrite.

---

# Tier 2 — `derived/{per-mp, dissents, similarity}` · 86 MB · collapses three fallback chains

| artifact | size | state |
|---|---:|---|
| `per-mp/**` (2,330 files) | **43 MB** | **no route** — `useMpShard` backs dissents, similarity AND loyalty |
| `dissents.json` | **31 MB** | `/api/db/mp-dissents` is PRIMARY; shard is arm 2, this is arm 3 |
| `similarity.json` | **12 MB** | `/api/db/mp-similarity` is PRIMARY; same chain |

`useMpDissents` and `useMpSimilarity` already prefer Postgres — but `useMpShard` sits between
them and the aggregates, so neither the shard tree nor the 31 MB file can be removed. One new
route kills all three.

### Steps

1. Add `/api/db/mp-rollcall?ns=&mp=` returning the whole `MpShard` shape:
   - `loyalty` — from `mp_vote_norm` + `vote_cast` (135)
   - `attendance` — `mp_attendance` (135), already exposed by `/api/db/mp-attendance`
   - `cohort` — chamber medians for `votesCast`, `loyaltyPct`, `presentPct`, computed in the
     same query so the candidate page keeps its "vs median" context without a second call
   - `dissents` / `similarity` — reuse the `mp-dissents` / `mp-similarity` bodies
2. Point `useMpShard` at it. Then **delete the JSON arms** from `useMpDissents`,
   `useMpSimilarity`, `useMpLoyalty` — leaving them is what keeps 43 MB alive.
3. Exclude + `rm` `per-mp/`, `dissents.json`, `similarity.json`.

### Rules

- ⚠️ **`mp_similarity` stores `dot` + `overlap`, NOT an agreement rate.** The score consumers
  are calibrated for is the cosine, `dot / (norm_a * norm_b)` via `mp_vote_norm`. Substituting
  a rate relabels "voting twins" sitewide.
- Key on **`(ns, mp_id)`, never `mp_id` alone** — parliament.bg recycles ids and 26 of them
  name two genuinely different people.
- `mp_similarity` is the quadratic matview: **744.5 s on Cloud SQL** for a refresh. The route
  reads it, so this changes nothing at request time — but budget it into any deploy that
  re-runs `db:load:rollcall-derived:pg:cloud`.

**Effort:** 2–3 days. **Risk:** medium — one route, three consumers, and a real shape.

---

# Tier 3 — the rest of `derived/` · ~12 MB · two routes are free today

| artifact | size | PG status |
|---|---:|---|
| `attendance.json` | 504 KB | **`/api/db/mp-attendance` ships; nothing calls it** |
| `cohesion.json` | 640 KB | **`/api/db/party-cohesion` ships; nothing calls it** |
| `topic_index.json` | 8.0 MB | `/api/db/vote-day-summary` + `/api/db/contested-votes` are PRIMARY; JSON is fallback |
| `party_pair_breaks.json` | 2.4 MB | no route |
| `search_index.json` | 760 KB | no route |
| `loyalty.json` | 416 KB | no route — retires with Tier 2's `mp-rollcall` |
| `important_votes/{ns}.json` | 428 KB | no route |
| `embedding.json` | 212 KB | no route |

### 3a — free today (half a day)

Point `useAttendance` and `useFactionCohesion` at the shipped routes. **Not a drop-in**: the
JSON files are `byNs` maps computed once (`AttendanceFile` / `CohesionFile`), the routes are
per-NS row lists. And `party-cohesion` returns the per-date SERIES only — `CohesionSlice.entries`
(the per-party aggregate: `itemsCovered`, `meanCohesion`, `medianCohesion`, `membersTracked`)
has to be added to the route or derived client-side from the series.

⚠️ The route filters `НЕЗ` / `НЕЧЛ В ПГ` — members without a group, whose "cohesion" is a
number about individuals. Charting them alongside groups made the 50th read 0.94 against a
real-group 0.973. Do not "restore" them for parity with the JSON.

### 3b — drop `topic_index.json` (8 MB)

Both consumers already prefer Postgres; the file is kept as a fallback for a checkout without
a database and for a first cloud deploy before the loader runs. That contingency has passed —
`vote_item` is loaded on prod. Delete the fallback arms and remove the file from
`rebuildDerived`'s `--upload` list.

⚠️ The outcome bucketing exists **twice** — SQL in the route, `outcomeBucket()` / `outcomeFor()`
in TypeScript for the fallback — because a route cannot import TS. Deleting the fallback does
**not** let you delete the TS copy: `bill_and_topics.data.test.ts` re-derives every day's
buckets from the session files against it, and the `abstain = cast` branch rides on
`outcomeFor()`'s definition alone since no item in the corpus reaches it.

### 3c — one migration each (2–3 days total)

`party_pair_breaks`, `search_index`, `important_votes/{ns}`, `embedding` — all derivable from
`vote_item` / `vote_cast` / `mp_seat` / `party_dim` (134). `important_votes` is a curated
pre-scored list, so the scoring rule moves into SQL or a matview; keep the rule in ONE place.

Every aggregate needs **`WHERE superseded_by IS NULL`** (the 1,645 re-votes `dedupeRevotes`
collapses) and must group on **`vote_cast.party_id`** — the affiliation at cast time — never
`mp_seat.party_id`: 179 of 2,366 seats change party mid-term, and grouping on the seat
compares those members against a group they had already left.

After 3a–3c plus Tiers 1–2, `parliament/votes/` drops from 401 MB to the hub blobs of
Decision 1 (~96 KB).

---

# Tier 4 — `myarea/` · 4.1 MB · highest churn-per-byte in the repo

14,746 file-touches across the last 300 commits. Small bytes, rebuilt and re-uploaded every
single day by the orchestrator.

### 4a — `place_tenders/` (265 files, 1.1 MB) — the easy one

A rolling 6-month window over `tenders` with no computation in it: count, cancelled count,
`totalEstimatedEur`, top-by-value. `build_alerts.ts` reads it out of
`data/procurement/tenders/recent_by_buyer.json` — a file, while `tenders` is a PG table.

Add `/api/db/myarea-place-tenders?obshtina=`: municipal-tier buyers seated in the obshtina
(`awarder_seats`, exactly as `readMunicipalAwardersByEkatte` already does) joined to `tenders`
on `publication_date >= now() - interval '6 months'`. Point `useMyAreaPlaceTenders` at it and
delete the writer.

⚠️ `since` and `generatedAt` are in the payload and rendered. Derive `since` from the window
bound and drop `generatedAt` (a live query has no generation time) — do not emit `now()` as if
it were a build stamp.

### 4b — `alerts/` (3.8 MB) — mostly already PG

`build_alerts.ts` already reads council, Interreg, open-calls and municipal awarders **from
Postgres** (`scripts/db/lib/{council,interreg,opencalls,muni}_alerts.ts`). What is still on
disk: the chmi history (`data/chmi_history/<obshtina>.json`) and the capital programmes.
Both are small, static and already committed.

Move the fold into SQL behind `/api/db/myarea-alerts?obshtina=`, keeping the chmi + capital
arms as small PG tables or as a lateral join against a committed seed.

⚠️ `readMunicipalAwardersByEkatte` **throws rather than degrades**, on purpose: one transient
database condition would otherwise blank the procurement and tender alerts in all ~265 files
and delete every place-tender summary, silently, exit 0, in an unattended auto-committing
step. A serving route inverts that risk — a failure becomes one empty tile on one page instead
of a corpus-wide wipe — but the route must still distinguish "no events" from "could not
read", or the tile says "nothing happening here" during an outage.

### 4c — retires with Tier 3

`useMpSignals` reads `loyalty.json`; `useAreaImportantVotes` reads `important_votes/{ns}.json`.
Both are My-Area consumers of Tier 3 artifacts and switch with them.

**Effort:** 4a half a day, 4b 2 days.

---

# Tier 5 — mid-size stragglers · opportunistic

| artifact | size | note |
|---|---:|---|
| `budget/facts/{fy}/program.json` | 1.7 MB | `budget_program_fact` (153) already holds it; `useBudget` makes 30 `/api/db` calls and 2 `dataUrl` ones |
| `budget/reconciliation/{fy}/by-*.json` | 1.2 MB | `budget_admin_node` + `budget_program_fact` |
| `budget/derived/admin_flow.json` | ~300 KB | also read by `useSearchItems` — two consumers |
| `budget/izdrazhka_by_institution.json` | 18 KB | one hook |
| `schools/index.json` | 1.28 MB | last `dataUrl` in a family that is otherwise fully PG (`education-payload`, `school-by-eik`) — likely a one-hook fix |
| `financing/reports.json` + `reports/**` | 1.6 MB, 239 files | **annual cadence — lowest priority**, arguably a "rarely updated" keep |
| `procurement/projects/**` | 124 KB | 13 curated dossiers, low churn |

⚠️ `budget/reconciliation/` and `budget/ministries/` are **gitignored**. They are the reason
`db:load:budget:pg` is a `REFRESH_EXCLUSIONS` member, and `sector_stats` reads eight ПРБ nodes
out of `budget/ministries/`. Migrating the reconciliation shards to PG makes the sector
generator's input a table rather than a gitignored tree — a real secondary win, and the reason
this tier is worth more than its byte count.

`schools/index.json` is the best cost/benefit item here: one hook, 1.28 MB, and the rest of the
family already speaks PG.

---

## Explicitly KEEP as JSON

* **Every election tree** — `YYYY_MM_DD/**`, `sections/*_stats.json` (561 MB),
  `settlements/*_stats.json` (164 MB), `municipalities/`, `regions/`, `sections/risk_history/`,
  `transitions*/`, `local_place_trends/`, `local_chmi_history.json`, `chmi_history/`,
  `{date}/parties/{financing,donors,agencies_summary}.json`. Static once written.
* **Hub stat blobs** — Decision 1.
* **Geo** — `maps/**`, `regions_map.json`, `sofia_map.json`, `continents_map.json`,
  `procurement/roads.json` (710 KB of road linework, a geo artifact not a stat).
* **Reference / near-static** — `settlements.json`, `municipalities.json`, `ekatte_index.json`,
  `postcode_ekatte.json`, `census_2021*.json`, `canonical_parties.json`, `grao_population.json`.
* **Small periodic indicator artifacts** — `macro.json`, `macro_peers.json`, `regional.json`,
  `cofog.json`, `indicators.json`, `fuel.json`, and the ≤1 MB single-file sector artifacts
  (`water/`, `social/`, `energy/`, `air/`, `landuse/`, `culture/`, `administration/`,
  `tourism/`, `security/`, `environment/`, `services/`, `local_taxes/`, `grao/`, `polls/`,
  `ngo/`). Updated monthly-to-annually — migrating them is machinery for nothing.
* **`parliament/photos/**`** — binaries, not JSON.

---

## Sequence and payoff

| # | tier | bucket bytes | effort | note |
|---|---|---:|---|---|
| 1 | **Tier 0** — `rm` + sync guards | **1.05 GB** | 0.5 d | no code |
| 2 | **Tier 1** — `SessionScreen` → shipped route | **290 MB** | 1–2 d | server half done |
| 3 | **Tier 3a** — attendance + cohesion | 1.1 MB | 0.5 d | routes already ship |
| 4 | **Tier 4a** — `place_tenders` | 1.1 MB | 0.5 d | pure PG cache today |
| 5 | **Tier 2** — `mp-rollcall` route | **86 MB** | 2–3 d | collapses 3 fallback chains |
| 6 | **Tier 3b/3c** — topic_index + 4 migrations | 12 MB | 2–3 d | |
| 7 | **Tier 4b** — alerts | 3.8 MB | 2 d | ends a daily 265-file rebuild |
| 8 | **Tier 5** — stragglers | ~6 MB | opportunistic | `schools/index.json` first |

Items 1–4 are **~1.34 GB in about two days** and carry the least risk. Items 5–7 are the real
engineering.

---

## The four rules every step here must follow

1. **An exclusion FREEZES a tree; it never retires one.** `gsutil rsync -x` excludes a match
   from deletion as well as upload, and `syncPaths` passes `-x` with `-d`. Removing objects is
   always a separate operator action.
2. **Ship the reader BEFORE the `rm`, and verify on prod.** Removing
   `parliament/company-connections/` while a shipped AI tool still fetched it is what left that
   tool answering from a July snapshot at a 200.
3. **Sweep `ai/` when checking for readers.** A `src/ scripts/ functions/` grep reported zero
   readers for `company-connections/` and was wrong.
4. **An exclusion needs FOUR edits, not one** — `isExcluded`, the `CHILD_EXCLUDES` twin (the
   first guards only a DIRECT argument), and the `-x` arms in both `bucket:sync` and
   `bucket:sync:dry`. `bucket_sync_paths.test.ts` holds them in lockstep.

## Deploy order, every tier

New `/api/db` route + a hosting change is always: **`deploy:db` → `deploy`**. Hosting first
points the URL at a function that cannot serve it. If the bundle hash moves and any
function-served page family is involved, it is the three-step form
(`deploy` → `deploy:db` → `SKIP_PREDEPLOY=1 deploy`) — see CLAUDE.md.
