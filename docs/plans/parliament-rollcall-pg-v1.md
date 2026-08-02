# Roll-call votes → Postgres, v1

Status: **analysis / proposal.** Drafted 2026-08-02. Companion to
[parliament-hub-v1.md](parliament-hub-v1.md) (which ships on the current JSON layer and is
designed so this migration replaces its generator, not its components).

Every number below is **measured**, not estimated: the corpus was loaded into a throwaway
`rc_proto` schema on local Postgres, indexed, `EXPLAIN (ANALYZE, BUFFERS)`-ed on the worst-case
parliament, and dropped. Where a figure is an extrapolation to Cloud SQL it says so.

---

## 1. Verdict

**Migrate the facts; keep the analytics offline.** The roll-call corpus is a textbook Postgres
case — a 4M-row fact table with two dimensions, currently shipped as **390 MB of committed JSON**
including a **31 MB** and an **11.7 MB** artifact that individual page loads download whole. But
the expensive derivations (all-pairs similarity, UMAP embedding) are not request-shaped and
must not become live queries.

The recommendation in one line: **`vote_item` + `vote_cast` as loaded tables; four precomputes
as matviews; two of the eight current artifacts stay in TypeScript; `embedding.json` never moves.**

The strongest single argument is not performance. It is that **loading the corpus into a table
with a primary key immediately surfaced two latent defects the JSON pipeline has been absorbing
silently for months** (§3.1, §3.2). Constraints catch what a JSON writer cannot.

---

## 2. What the corpus actually is — measured

| | |
|---|---|
| session files | **616**, `data/parliament/votes/sessions/*.json`, **290 MB** |
| derived artifacts | **99 MB**, of which `per-mp/` is **43 MB** across **2,330 shards** |
| **total committed JSON** | **~390 MB** |
| vote items | **16,741** (raw; `dedupeRevotes` collapses re-votes for the derived metrics) |
| vote casts | **4,017,603** |
| distinct `(ns, mp_id)` seats | **2,366** |
| distinct `mp_id` | **1,370** — ids are **recycled across parliaments** (§3.2) |
| parliaments | 9 (NS 44–52); worst is NS 51 — 4,687 items, **1,124,892 casts**, 309 MPs |
| vote values | `yes` 1,691,839 · `absent` 1,257,396 · `no` 714,406 · `abstain` 353,962 |

Per-artifact sizes (bytes on disk; the bucket serves identity encoding, so these are wire sizes):

| Artifact | Size | Fetched by |
|---|---|---|
| `dissents.json` | **31 MB** | `useMpDissents` → every candidate page **whose per-MP shard is missing** |
| `similarity.json` | **11.7 MB** | `useMpSimilarity` → same, plus `/parliament/similarity/:mpId` |
| `topic_index.json` | **8 MB** | `useTopicIndex` → `/votes`, `ContestedVotesFeed` |
| `party_pair_breaks.json` | 2.6 MB | `/votes/between/:pair` |
| `search_index.json` | 758 KB | offline harness only |
| `cohesion.json` | 639 KB | `/parliament/cohesion` + 2 tiles |
| `attendance.json` | 500 KB | `/parliament/attendance` + 2 tiles |
| `loyalty.json` | 413 KB | 5 consumers |
| `embedding.json` | 211 KB | `/parliament/embedding` + 3 tiles |
| `important_votes/<ns>.json` | 47 KB × 9 | — |
| `similarity_headline.json` | 4.3 KB | the hub tile |

---

## 3. Why migrate — four concrete defects, in order of severity

### 3.1 The 31 MB fallback fires in production today

`useMpShard` fetches `per-mp/<ns>/<csvId>.json` and returns `null` on 404; the consumers
(`useMpDissents`, `useMpSimilarity`, `useMpLoyalty`) then **fall back to the NS aggregate**. The
comment calls this graceful. It is not — the fallback path is a **31 MB** download.

Shards exist only for MPs the loyalty pass considers rostered
(`per_mp_shards.ts:109` — *"Loyalty is the authoritative roster — no loyalty, no shard"*).
Measured coverage:

| NS | MPs who cast a vote | shards written | **falling back** |
|---|---|---|---|
| 44 | 245 | 243 | 2 |
| 47 | 268 | 264 | 4 |
| 49 | 264 | 263 | 1 |
| **50** | **289** | **265** | **24** |
| 51 | 309 | 307 | 2 |
| 52 | 270 | 268 | 2 |
| | 2,366 | 2,330 | **36** |

Thirty-six candidate pages — 24 of them in the 50th NS — download 31 MB + 11.7 MB to render a
dissents tile. Nothing reports this; the fallback is silent by design.

In Postgres the same page is a point lookup. Measured, NS 52, one MP's 50 most recent votes:

```
Execution Time: 1.146 ms          Buffers: shared hit=688 read=5
```

### 3.2 `mp_id` is not unique, and 26 ids belong to two different people

`useMpShard` already warns that *"parliament.bg recycles ids across NSes"*, but nothing enforces
it. Measured across the corpus: **1,370 distinct `mp_id` for 2,366 seats**, and after normalising
whitespace and punctuation, **26 ids carry two genuinely different names**:

```
3103 → ДИМИТЪР БОЙЧЕВ ПЕТРОВ  ||  ДЕНИЦА ДИМИТРОВА СИМЕОНОВА
3113 → ВЛАДИМИР СЛАВЧЕВ ВЪЛЕВ ||  ДИМИТЪР АНГЕЛОВ ИВАНОВ
3123 → ВЕСЕЛА НИКОЛАЕВА ЛЕЧЕВА||  ДРАГОМИР ВЕЛКОВ СТОЙНЕВ
… 26 in total
```

This is **load-bearing for the person layer**, not a curiosity. `person_role` for `source='mp'`
stores `ref = mp_id::text` with **no NS column** (`104_mp_roster.sql`), so for these 26 ids the
bridge from a person to their votes is already ambiguous. A migration that made `vote_cast.mp_id`
a plain FK to `mp_profile.mp_id` would silently merge two people's voting records.

**The natural key is `(ns, mp_id)`. Never `mp_id`.** §4 makes it the FK, and §9 gates it.

### 3.3 84 duplicate casts that the JSON layer counts twice

`ALTER TABLE vote_cast ADD PRIMARY KEY (item_id, mp_id)` failed on first attempt:

```
ERROR: could not create unique index "vote_cast_pkey"
DETAIL: Key (item_id, mp_id)=(1051, 3537) is duplicated.
```

**84 duplicate pairs, 168 rows** — the same MP listed twice in one item's roll, always with an
identical `absent`, always on the opening sitting of a parliament (NS 45 2021-04-21, NS 52
2026-04-30). It is 0.004% of the corpus and harmless to any conclusion, but the JSON `votes`
object is keyed by **position**, not by MP, so nothing dedupes it: every attendance denominator
currently counts those MPs twice. A PK is the only thing that has ever noticed.

### 3.4 "What is a law" needs a dimension, not a regex

[parliament-hub-v1.md §3.2](parliament-hub-v1.md) had to cut the pass/fail law count from v1
because the corpus has no bill record: 7,782 second-reading items are per-article votes, and the
only way to group them is a title-string split. In SQL that becomes a real `bill` dimension —
resolved once by the loader, indexed, and joinable — instead of a regex re-run in the browser on
every render. This is the migration's biggest *product* win, distinct from its performance win.

---

## 4. Schema — migrations 132–134

Next free number is **132** (131 is `kzk_appeal_provenance`).

### `132_rollcall.sql` — the two loaded tables

```sql
CREATE TABLE vote_item (
  item_id   integer PRIMARY KEY,      -- synthetic, assigned in (date, item_no) order
  ns        smallint NOT NULL,
  date      date     NOT NULL,
  item_no   smallint NOT NULL,
  slug      text,                     -- the /votes/:date/:slug segment
  title     text,
  topic     text NOT NULL,            -- the 8-value VoteTopic taxonomy
  bill_id   integer REFERENCES bill(bill_id),   -- 134; NULL for non-bill items
  reading   smallint,                 -- 1 | 2 | NULL, from the title (134)
  yes smallint, no smallint, abstain smallint, absent smallint,
  UNIQUE (ns, date, item_no)
);
CREATE INDEX ON vote_item (ns, date);
CREATE INDEX ON vote_item (date);            -- the /votes/:date path, §5
CREATE INDEX ON vote_item (bill_id) WHERE bill_id IS NOT NULL;

CREATE TABLE mp_seat (                 -- the (ns, mp_id) dimension §3.2 forces
  ns smallint, mp_id integer, name text NOT NULL, party_id smallint REFERENCES party_dim,
  PRIMARY KEY (ns, mp_id)
);

CREATE TABLE vote_cast (
  item_id  integer  NOT NULL REFERENCES vote_item,
  mp_id    integer  NOT NULL,
  ns       smallint NOT NULL,          -- DENORMALISED — see the measurement below
  vote     "char"   NOT NULL,          -- 'y' | 'n' | 'a' | 'x'
  party_id smallint REFERENCES party_dim,
  PRIMARY KEY (item_id, mp_id),
  FOREIGN KEY (ns, mp_id) REFERENCES mp_seat (ns, mp_id)
);
CREATE INDEX ON vote_cast (ns, mp_id) INCLUDE (vote, party_id);
CREATE INDEX ON vote_cast (mp_id, item_id) INCLUDE (vote);
```

**Three decisions worth defending:**

- **`vote "char"`, not an enum or text.** 1 byte, no TOAST, no enum-ordering trap. `party_id` is
  a `smallint` into a **71-row** `party_dim(ns, short)` rather than the party short-name repeated
  4M times.
- **`ns` denormalised onto `vote_cast`.** Measured: without it, the per-NS attendance aggregate
  hash-joins through `vote_item` and **seq-scans the fact table** — 183 ms / **25,769 buffers**.
  With it, 77 ms / **3,124 buffers**. The column costs nothing (it packs into existing alignment
  padding beside `vote`) and it is immutable per item, so it cannot drift.
- **The `(ns, mp_id)` composite FK**, per §3.2. This is the constraint that makes the 26 recycled
  ids safe.

Measured size of the loaded pair, clean build with both indexes:

```
vote_item     6.3 MB   (5.7 MB heap + 0.5 MB index)
vote_cast   498   MB   (170  MB heap + 328  MB index)
party_dim    71 rows
```

~505 MB against a **15 GB** current database — about **3%**. COPY of all 4,017,519 rows takes
**2.9 s** locally.

### `133_rollcall_derived.sql` — the four matviews

Names, inputs and the not-populated fallback join `SCOPED_MATVIEWS`-style declaration in a
`scripts/db/lib/` list, per the CLAUDE.md convention that "the data changed" and "the precompute
matches" cannot be two states.

| Matview | Grain | Rows | Build (local, measured) | Replaces |
|---|---|---|---|---|
| `mp_dissent` | (ns, mp_id, item_id) where the MP voted against their group's plurality | **105,571** | **1.56 s** | `dissents.json` **31 MB** |
| `mp_similarity` | (ns, a_mp, b_mp) with `shared` + `agree` | **297,495** | **37.5 s** | `similarity.json` **11.7 MB** |
| `mp_attendance` | (ns, mp_id) | 2,366 | < 1 s | `attendance.json` |
| `party_cohesion` | (ns, party_id, date) | ~10k | < 1 s | `cohesion.json` |

`mp_similarity` dominates the refresh at 37.5 s — comparable to `db:load:procurement-scopes:pg`
(46 s locally) and acceptable for a nightly. It is the **only** object here whose cost scales
quadratically, and it is a matview precisely because of that.

### `134_bill.sql` — the bill dimension (§3.4)

```sql
CREATE TABLE bill (
  bill_id  integer PRIMARY KEY, ns smallint NOT NULL,
  stem     text NOT NULL,                -- title before " - второ гласуване"
  first_reading_item integer REFERENCES vote_item,
  final_item         integer REFERENCES vote_item,
  UNIQUE (ns, stem)
);
```

The stem split is a **TypeScript** concern owned by the loader, not a SQL regex — same reasoning
`104_mp_roster.sql` gives for keeping `BRAND_ALIASES` out of SQL: one definition of the
vocabulary, tested once. Measured on NS 52 the split collapses 754 second-reading items to
**33 bills**.

`final_item` is deliberately **nullable and initially NULL**. Populating it needs a whole-bill
adoption marker that does not exist yet (parliament-hub-v1 §3.2) — the column is the place it
will live, not a claim that it is solved.

---

## 5. Live query vs precompute — the measured line

This is the section that decides the design, and it does not split the way the intuition
"per-MP is cheap, aggregate is expensive" suggests.

All timings local (Apple silicon, `shared_buffers = 160 MB`, warm), worst-case parliament where
noted:

| Query | Time | Buffers | Verdict |
|---|---|---|---|
| One MP's votes, one NS, 50 rows | **1.1 ms** | 693 | **live** |
| Topic filter over a whole NS | **20 ms** | 249 | **live** |
| One session day, all items × party split — *index plan* | **15 ms** | 1,023 | **live**, but see the trap below |
| One session day — *planner's default plan* | 169 ms | **21,904** | — |
| Attendance, one NS (52) | 77 ms | 3,124 | borderline → precompute |
| Party cohesion, one NS (52) | 79 ms | 2,802 | borderline → precompute |
| Attendance, worst NS (51) | **180 ms** | **21,774** | **precompute** |
| One MP's **dissents**, worst NS | **163 ms** | **27,762** | **precompute** |
| One MP vs all peers (**similarity**), worst NS | **164 ms** | **35,851** | **precompute** |
| All-pairs similarity, all NS | 37.5 s | — | **matview only** |

**The line is not "per-MP vs aggregate". It is "does the query need the MP's peers on the same
items".** Reading stored facts about one MP is a 693-buffer point lookup. The moment the answer
depends on how *everyone else* voted on those same 3,817 items — dissents, similarity — it fans
out to 28–36k buffers, i.e. more work than the whole-NS attendance aggregate. Both go to
matviews; both then become sub-millisecond reads.

### The planner trap on `/votes/:date`

The session-day query is the one serving the **613 prerendered pages**, and the planner gets it
wrong at the default `random_page_cost = 4`:

```
default plan   169 ms   21,904 buffers   (Parallel Seq Scan on vote_cast)
enable_seqscan=off
               15 ms     1,023 buffers   (Nested Loop, vote_cast_pkey per item)
```

**21× slower and 21× the I/O for choosing a seq scan over a 161-item nested loop.** Two things
follow, and the second matters more:

1. drive the query from an explicit item-id set (`WHERE item_id = ANY($1)` off a cheap
   `vote_item` scan) so the shape is a semi-join the planner cannot flatten into a hash join;
2. **check `random_page_cost` on Cloud SQL.** The instance is SSD-backed, so the correct value is
   ~1.1; if it is still 4, this plan flip is latent on *every* index-vs-seq decision in the
   database, not just this one. That is a five-minute check with repo-wide consequences and it
   should happen before, not after, this migration.

### Cloud SQL extrapolation — the part that is not measured

Prod is **db-g1-small** (1 shared vCPU, 1.7 GB), the pool is `max: 4` with a **10 s
`statement_timeout`**, and CLAUDE.md's calibration point is a contracts reload at **~68 minutes,
CPU-bound**. Against local's 160 MB `shared_buffers` and warm NVMe, a **21,774-buffer (170 MB)**
scan there is not "180 ms plus a bit" — it is plausibly **2–10 s on a cold cache**, i.e. at or
over the timeout, under exactly the saturation that produced the 500s migration 124 was built for.

**So the rule for this migration is stricter than the local numbers suggest: nothing above
~2,000 buffers is served live.** By that rule the table above resolves to — live: per-MP record,
topic filter, session day (index plan). Precompute: everything else. That is how the matview list
in §4 was chosen; it is not a performance-hedge, it is the timeout budget.

Every route reading a matview follows the **123/124 degrade contract** verbatim: degrade on
`42P01 · 55000 · 42501 · 55P03`, **never on `57014`** (that is the pool's own timeout — the probe
has already burned the budget and the live fallback cannot finish either), log
`rc:not-built:<matview>` once per process.

---

## 6. What does NOT migrate

Stated explicitly, because "move the whole directory" is the tempting version of this plan.

| Artifact | Stays | Why |
|---|---|---|
| `embedding.json` (211 KB) | **TypeScript, forever** | UMAP is a stochastic iterative projection. It is not a SQL workload, it is 211 KB, and reimplementing it in PL/pgSQL would be a second definition of the map with nothing testing that the two agree. |
| `important_votes/<ns>.json` (47 KB × 9) | **TypeScript** | The `score` is an editorial weighting, exactly the `BRAND_ALIASES` argument in `104_mp_roster.sql` — the TS builder stays the single definition, and the loader can store its output in `vote_item.score` if a query ever needs it. |
| `search_index.json` | as-is | Offline harness only; no page reads it. |
| `per-mp/` shards (43 MB, 2,330 files) | **DELETED** | They exist solely to avoid the 31 MB fallback (§3.1). Postgres removes the reason they exist. This is 43 MB and 2,330 files off the bucket. |
| `similarity_headline.json` (4.3 KB) | **kept** | Feeds the hub tile and the band-4 seed. Cheaper than a round trip; regenerate it from `mp_similarity` once that exists. |

`party_pair_breaks.json` (2.6 MB) and `loyalty.json` (413 KB) are judgement calls: both are
derivable from `vote_cast` and both are small enough that migrating them buys little. Recommend
**deferring** — a v1 that moves six artifacts and leaves two is a cleaner test than one that
moves everything.

---

## 7. Loaders and the refresh contract

```
npm run db:load:rollcall:pg[:cloud]     # 132 + 134: vote_item, mp_seat, vote_cast, party_dim, bill
npm run db:load:rollcall-derived:pg[:cloud]   # 133: REFRESH the four matviews, in order
```

Following the repo's own scar tissue:

- **Stage-merge, not TRUNCATE+COPY.** `vote_cast` will be on a serving path, and
  `reference_stage_merge_reload` / `reference_contracts_reload_lock` both document that a
  `TRUNCATE`-and-rebuild on a served table holds an `AccessExclusiveLock` and 500s the routes at
  the pool's `lock_timeout` (2.0 s). Use `scripts/db/lib/stage_merge.ts`. The corpus is
  **append-only per day**, so the merge is genuinely incremental — one plenary day is ~250 items
  × 240 MPs = **~60,000 rows**, not 4M.
- **The derived loader must run after the fact loader**, and `mp_similarity` after
  `mp_attendance` is irrelevant (they are independent) but `bill` must be resolved **before**
  `vote_item.bill_id` is set. Declare the order in the `SCOPED_MATVIEWS`-style list, not in prose.
- **No `recent_updates` row for the matviews** — they are a derived serving layer, like
  `person_search` / `contractor_search`. The *fact* loader takes one.
- **Wire both into `update-rollcall`**, per `reference_migrated_family_watch_reload`: a JSON→PG
  migration that does not add the `:cloud` loader to the regenerating watch skill leaves prod
  stale with nothing red. This is the single most-repeated failure in CLAUDE.md and it applies
  here verbatim.

---

## 8. Phasing

| Phase | Scope | Ships |
|---|---|---|
| **0** | `132_rollcall.sql` + `db:load:rollcall:pg`. **No route reads it.** Run the dedupe (§3.3) and the `(ns, mp_id)` audit (§3.2) as loader preflights that report rather than throw. | a table, and the two defects quantified against every NS |
| **1** | `133` + the four matviews + `db:load:rollcall-derived:pg`. Point `useMpDissents` / `useMpSimilarity` at `/api/db` routes. **Delete `per-mp/`, `dissents.json`, `similarity.json`.** | **−43 MB of shards, −31 MB, −11.7 MB**; the §3.1 fallback stops existing |
| **2** | `attendance` / `cohesion` routes; retire those two artifacts. Regenerate `similarity_headline.json` from `mp_similarity`. | −1.1 MB, and the hub's stats generator can read PG |
| **3** | `134_bill.sql` + the bill resolver. Unlocks parliament-hub-v1 §3.2's cut law count and a `/parliament/bill/:slug` record page. | the product win |
| **4** | `topic_index.json` (8 MB) → a `vote_item (ns, topic)` index. | −8 MB; `/votes` stops downloading 8 MB to draw chips |

Phase 1 is the whole performance case. Phases 0 and 1 are worth doing even if 2–4 never happen.

**Cloud ordering, stated because nothing infers it:** `db:load:rollcall:pg:cloud` before
`db:load:rollcall-derived:pg:cloud`, and both before the `deploy:db` that ships the routes —
except that the routes degrade (§5), so a wrong order is slow, not broken. The one hard
ordering is that Phase 1 must not **delete** the JSON artifacts until the cloud loaders have run
there, or prod loses the data with no fallback.

---

## 9. Gates

`scripts/db/tests/rollcall.data.test.ts` (Postgres gate, auto-skips when PG is down):

| Gate | Asserts |
|---|---|
| **row reconciliation** | `count(vote_cast)` matches the session files ± the known 84 dupes; per-NS item counts match `index.json` |
| **id recycling** | every `(ns, mp_id)` resolves to exactly one `mp_seat.name`; the **26 recycled ids** are enumerated in the test as data, so a 27th fails |
| **no orphan casts** | `vote_cast` has no `item_id` absent from `vote_item` and no `(ns, mp_id)` absent from `mp_seat` |
| **matview freshness** | each of the four matviews' max `date` matches `vote_item`'s |
| **matview agreement** | `mp_attendance` and `party_cohesion` reproduce the current JSON artifacts within a stated tolerance — **the migration's correctness proof**, and it must run while both layers exist |
| **buffer ceiling** | each live-served query stays under 2,000 buffers on the worst NS, per §5's Cloud SQL rule. Same shape as `person_connections.data.test.ts`, which holds a ceiling and proves it still discriminates by restoring the old body in a rolled-back transaction |
| **plan shape** | the `/votes/:date` query uses a nested loop, not a seq scan (§5's 21× trap) |
| **upload/watch wiring** | both `:cloud` loaders appear in the `update-rollcall` skill |

---

## 10. Risks

1. **`mp_similarity` at 37.5 s locally is unmeasured on db-g1-small.** The contracts calibration
   suggests minutes, not seconds. If it exceeds a maintenance window, the fallback is to keep
   similarity per-NS and refresh only the current parliament nightly — the other eight are frozen
   history and never change.
2. **The `(ns, mp_id)` FK will reject rows on first load** if `mp_seat` is built from
   `mp_profile` rather than from the session files themselves. Build it from the corpus; reconcile
   against `mp_profile` in the gate, not in the constraint.
3. **`person_role.ref = mp_id` has no NS** (§3.2), so the person→votes bridge stays ambiguous for
   26 ids *after* this migration. Fixing that is a person-layer change, out of scope here, but it
   should be written down rather than assumed resolved by the FK.
4. **Deleting `per-mp/` is irreversible on the bucket** — `bucket:sync` has never passed `-d`, so
   the shards will linger and be served until someone runs a scoped `--delete`. Sequence: routes
   live → verify → `bucket:sync:paths -- parliament/votes/derived --delete --dry-run` → apply.

---

## 11. What this does not solve

The corpus is what it is. Postgres does not create a bills feed (parliament-hub-v1 §9), does not
supply the whole-bill adoption marker §4's `final_item` waits for, and does not extend coverage
back past NS 44 or fill the partial 44th. It makes the existing facts cheap to ask questions of
— which is the prerequisite for all three, not a substitute.
