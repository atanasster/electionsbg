# Общински съвети — hub + council corpus → Postgres (v1)

Status: **plan**. Written 2026-08-16. Every figure below is measured against the working
tree at that date, not estimated.

## 0. Why this plan exists

`update-council-minutes` is a top-5 ingest by commit volume (68 commits touching
`data/council/` in 90 days, behind procurement 155, parliament 136, budget 135,
officials 77). Its output has almost no home: one tile in My-Area
(`MyAreaCouncilTile`, mounted at `MyAreaScreen.tsx:229`) plus two AI-chat readers
(`ai/tools/placeData.ts:280`, `ai/tools/profile.ts:350`). No route, no prerender entry,
no sitemap `<loc>`, no Postgres table.

The per-person surface was lost in a refactor: `CouncilActivitySection.tsx` has **zero
importers** — its host `OfficialProfileScreen` was retired to `/person` (only
`OfficialProfileRedirect.tsx` remains) and `/person` renders no council activity.

But the reason to do this work is not the missing hub. It is that **the named-vote half
of the corpus has been frozen since 2026-05-29 and is silently losing data**, and a hub
built on it today would publish a May snapshot as current.

---

## 1. Diagnosis — why the votes shards stopped refreshing

Two independent defects. They compound, and the second one makes the obvious fix for the
first one *destructive*. Read both before touching anything.

### Defect A — extraction is opt-in, and the daily path does not opt in

`--per-councillor` is a flag (`scripts/council/scrape.ts:254`), described as "Phase 2 —
extract per-councillor named-vote blocks and join to the `data/officials/municipal/`
roster. Slower; adds `tally.perCouncillor[]`." `--ocr` (`:259`) is a second opt-in, and
for Sofia it is mandatory — the full protokol PDFs carry ABBYY FineReader Cyrillic→Latin
mojibake (SKILL.md:170).

The daily ingest path is bare `npm run council:scrape` (SKILL.md:21). It passes neither.

So the May 2026 named-vote corpus was produced by explicit one-off runs — the commits are
right there: `f4cb64234a` Burgas per-councillor unlock, `10e006242e` Казанлък 3,164 vote
rows, `de6116f48b` the 4.5x V. Tarnovo backfill, all on 2026-05-29. Since then **no scrape
has produced a single `tally.perCouncillor` array**, and every durable per-councillor
shard on disk is dated `2026-05` — verified by mtime across all three affected
municipalities.

### Defect B — the votes shard is rebuilt from a set that has already been stripped

`mergeMuniResult` (`lib/index_writer.ts:198`) reads previous rows via `readIndex()`, i.e.
out of `data/council/index.json`. But `writeIndex` (`:113`) applies `stripPerCouncillor`
to everything it writes. **So `prev` can never carry `perCouncillor`.**

It then merges `prev` with the fresh scrape, caps to `PER_MUNI_LIMIT = 200`, and calls:

```js
await writeVotesShard(result.obshtinaCode, muniName, capped);   // :244
```

`writeVotesShard` **rebuilds** the shard from `capped` — it does not merge with the shard
on disk. Since the historical half of `capped` is stripped, the shard can only ever
contain what the *current scrape* returned. The code comment at `:239` states the intent
("no stale per-councillor data hanging around for rows that aged out") — the
implementation cannot honour it, because the data it would need was thrown away one
round-trip earlier.

The measured cost, durable shard tree vs served shards:

| muni | served res. | durable res. | delta | served rows | durable rows |
|---|---:|---:|---:|---:|---:|
| BGS01 | 86 | 86 | +0 | 3,966 | 3,966 |
| PER32 | 158 | 370 | **+212** | 3,004 | 7,298 |
| SOF | 75 | 75 | +0 | 2,964 | 2,964 |
| SZR12 | 150 | 255 | **+105** | 3,227 | 3,343 |
| VTR01 | 170 | 383 | **+213** | 5,139 | 11,483 |
| **total** | **639** | **1,169** | **+530** | **18,300** | **29,054** |

**530 resolutions and 10,754 named-vote rows already exist on disk and are not served.**
They were lost at write time in May, not since.

### The landmine — fixing Defect A alone triggers Defect B

```js
if (kept === 0) return 0;        // lib/index_writer.ts:143
```

This guard — "skip writing a shard for munis with zero named-vote data" — is currently
**the only thing preserving the served shards.** The freeze is the guard doing its job.

The moment one scrape yields even a single named-vote resolution, `kept` becomes 1, the
guard falls through, and the shard is overwritten with **that one resolution** — taking
~168 resolutions of served named votes for that municipality with it.

> **Sequencing is not optional: fix the merge (Tier 0) before re-enabling extraction
> (Tier 2).** Adding `--per-councillor` to the daily run as a one-line "fix" destroys the
> served corpus on its first successful run, and nothing reports it — the index row counts
> are unchanged, because the index never carried `perCouncillor` in the first place.

### What is NOT wrong

`councillor_signals.json` is **not** generated for nobody — `MyAreaCouncilTile.tsx:42`
consumes it. It is generated from a frozen input: diffing 2026-07-15 → HEAD,
`totalResolutions` is byte-identical for all five municipalities (86 / 158 / 75 / 150 /
170); only councillor counts drift (48→51, 55→58, 36→37, 32→33, 28→29) as the roster join
improves against the same May votes.

Genuinely dead and safe to delete: `CouncilActivitySection.tsx`, `useCouncillorProfile.tsx`
(imported only by that dead component), `useCouncillorConflicts.tsx` (zero importers), and
`councillor_conflicts.json` (68 bytes, empty, still emitted every run).

---

## 2. Corpus shape the hub inherits

| | |
|---|---|
| Wired municipalities | 17 in `sources.json` `munisByObshtina`, 16 with data, of 265 общински съвета — **6.4%** |
| Resolutions (served index) | 2,671 across 16 munis |
| Resolutions (durable tree) | **4,676** — the index is capped |
| Named votes | 5 munis only (BGS01, PER32, SOF, SZR12, VTR01) |
| Index truncation | 5 munis pinned at exactly `PER_MUNI_LIMIT = 200` (`index_writer.ts:42`) |
| Payload | `useCouncilMinutes` fetches all **1,542 KB** of `index.json` to render a 108 KB Sofia slice — **93% waste**, on every My-Area view |
| Storage | no PG table, no loader, no migration |

Two consequences for the hub's copy, both non-negotiable:

- It is a hub about **16 cities**, not "общински съвети". 6.4% coverage stated on the page,
  not inferred.
- **Named votes exist for 5 municipalities.** Any cross-municipal ranking of councillor
  attendance or dissent is a ranking over 5 councils and must say so, or it reads as
  national.

---

## 3. Tier 0 — stop the data loss (before anything else)

Small, self-contained, and a prerequisite for every later tier.

**T0.1 — make the votes shard additive.** `writeVotesShard` must read the existing shard
and merge by resolution id, so a scrape carrying named votes for 3 resolutions updates
those 3 rather than replacing 170. Keep the `kept === 0` early return only as a
"nothing to add" no-op, not as a corpus guard.

**T0.2 — stop routing history through the stripped index.** `mergeMuniResult` should build
`prev` from the **durable per-resolution shard tree** (`data/council/{code}/{year}/{id}.json`),
which `writeResolutionShard` writes unstripped, rather than from `index.json`. The tree is
already described in-file as "the durable source of truth" (`:41`, `:222`) and
`listDurableShardIds` already reads it for `resolutionCount` — this extends an existing
pattern rather than inventing one.

**T0.3 — a shrink guard.** Refuse to write a votes shard that would reduce a
municipality's named-vote resolution count by >5% without `--allow-shrink`, matching the
convention already used by the budget and КЗК loaders. This is the gate that would have
made both defects visible in May.

**T0.5 — retire or repoint `rebuild_shards.ts`.** `rebuildShardsFromIndex()` rebuilds every
votes shard from `index.json` — which is stripped — so under today's code it is **already a
silent no-op** (`kept === 0` for every município, so every write is skipped). It was correct
only during the one-time sharding rollout, when the index still held `perCouncillor`. Tier 0
changes the merge semantics underneath it: either delete it, or repoint it at the durable tree
so it means "rebuild the shards from source". Leaving it as-is ships a one-shot repair tool that
quietly does nothing, which is worse than not having one.

**T0.4 — regression test.** `index_writer.test.ts`: merge a scrape carrying named votes
for 1 resolution into a fixture shard holding 170, assert the result is 170 (not 1). Then
re-run with the merge stubbed out and assert it flips to 1 — otherwise the assertion is
satisfied by any implementation that happens not to write.

---

## 4. Tier 1 — migration 160, the council corpus in Postgres

> **Deviation from the brief, stated explicitly.** The ask was to migrate
> `data/council/votes/*.json`. Those files are a **lossy derivative** — 639 of 1,169
> resolutions, 18,300 of 29,054 rows. Loading them would import the defect. The loader
> reads the **durable per-resolution shard tree** instead, which is unstripped and
> uncapped, so the migration recovers the 530 lost resolutions on its first run and the
> 200-cap stops mattering for anything PG-served. `votes/*.json` becomes a build artifact
> of the old path, retired in Tier 5.

`158` and `159` are both taken (`158_company_political_links.sql`;
`159_person_crypto.sql`, which CLAUDE.md also names in prose as "migration 159"), so this
is **`160_council_corpus.sql`** and the serving layer below is **161**.

### Schema

Row shape is uniform corpus-wide — verified, all 29,054 rows are exactly
`{name, normKey, vote}` with `vote ∈ {for, against, abstain}` (24,135 / 1,792 / 3,127).

```sql
CREATE TABLE IF NOT EXISTS council_muni (
  obshtina_code    text PRIMARY KEY,        -- council pipeline key: BGS01, SOF, …
  frontend_code    text UNIQUE,             -- canonical code: BGS04, SFO_CITY, …
  name             text NOT NULL,
  ekatte           text,                    -- joins place_dim
  last_ingest      timestamptz,
  resolution_count int  NOT NULL DEFAULT 0,
  named_vote_count int  NOT NULL DEFAULT 0,
  has_named_votes  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS council_resolution (
  id              text PRIMARY KEY,
  obshtina_code   text NOT NULL REFERENCES council_muni(obshtina_code) ON DELETE CASCADE,
  decided_on      date NOT NULL,
  session         text,
  number          text,
  title           text NOT NULL,
  summary         text,
  result          text,
  tally_for       int,
  tally_against   int,
  tally_abstain   int,
  tally_method    text,
  has_named_votes boolean NOT NULL DEFAULT false,
  source_url      text,
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS council_vote (
  resolution_id  text NOT NULL REFERENCES council_resolution(id) ON DELETE CASCADE,
  norm_key       text NOT NULL,             -- parser's normKey, the join handle
  councillor     text NOT NULL,             -- registry spelling, displayed verbatim
  vote           text NOT NULL CHECK (vote IN ('for','against','abstain')),
  person_id      bigint,                    -- resolved, NULLable — see below
  party_id       text,                      -- canonical party at cast time — see below
  PRIMARY KEY (resolution_id, norm_key)
);

-- Indexes. Neither serving function is plannable without these: the muni page is a
-- range scan per council, the councillor page a point lookup per person.
CREATE INDEX IF NOT EXISTS idx_council_res_muni_date
  ON council_resolution (obshtina_code, decided_on DESC);
CREATE INDEX IF NOT EXISTS idx_council_vote_person
  ON council_vote (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_council_vote_norm_key
  ON council_vote (norm_key);
```

Seven schema decisions worth stating, each of which the repo has learned the hard way
elsewhere:

- **`council_muni.frontend_code` exists because the two code spaces genuinely differ**
  (`BGS01`↔`BGS04`, `SOF`↔`SFO_CITY`, `VTR01`↔`VTR04`). That mismatch already silently
  rendered nothing once — see the historical note in
  `src/data/council/councilObshtinaMap.ts`. The dimension carries it so no serving
  function re-derives it.
- **`person_id` is NULLable, municipality-scoped, and never guessed.** The parser gives a
  `normKey` — first+last, lowercased Cyrillic (`"александра тодорова"`) — not an identity.
  The bridge is `normKey` → `official_roster` / `person_role(source='muni')` **restricted to
  that município**, then to `person`. Scoping is not a refinement, it is the whole safety
  margin: a two-token Bulgarian name matched nationally across ~4,700 councillors would be
  materially *weaker* than the client-side join it replaces, not stronger. A name held by
  more than one person **within the same município** is refused and left NULL, matching
  `mp_tr_roles` / `place_mp_companies`. A councillor's votes attached to the wrong person is
  the one failure this corpus must not produce.
- **`has_named_votes` is stored on both grains** so a page can say "this council does not
  publish named votes" rather than rendering an empty list, which reads as "nobody voted".
- **Every column is written twice** — `CREATE TABLE IF NOT EXISTS` plus an
  `ADD COLUMN IF NOT EXISTS` reconcile block at the foot of the file. `IF NOT EXISTS` is a
  no-op on a warm database, so without the reconcile a new column reaches a fresh clone
  and nowhere else (the 003 lesson).
- **`frontend_code` is UNIQUE.** It is the reverse-lookup key every route resolves through
  (§8), so a duplicate would make one municipality's page serve another's council. The
  column is the single definition that retires four separate copies of this mapping — see
  §10.
- **The merge is upsert-only, never an anti-join DELETE.** A council resolution is a
  permanent public record; a scrape that misses a protocol, or a parser regression on one
  município, must not erase history. `last_seen_at` records absence instead, exactly as
  `open_calls` does for the same reason. This is the one place where the standard
  stage-merge shape is wrong for the corpus, and the >5% shrink guard is a second line
  rather than the first.
- **`party_id` comes from `official_candidate_link`, not from the parser.** Dissent is
  "voted against your own party's mode on that resolution", so it needs a party reference
  frame per councillor — today supplied by the candidate-link decoration
  (`build_councillor_signals.ts:18`). Independents and local-coalition councillors with no
  canonical id get `NULL` and are **excluded from dissent while keeping attendance**, which
  is the existing behaviour and must not silently become "zero dissent".

### Loader — `scripts/db/load_council_pg.ts`, `npm run db:load:council:pg`

**The input is COMMITTED.** All 4,676 durable shards are tracked in git (verified:
`git ls-files` returns 4,676 against 4,676 on disk, and nothing in `.gitignore` covers
`data/council/`). State this explicitly, because the reader's prior from `agri`,
`tender-dossier` and `budget` is the opposite. Consequences: the loader works on a fresh
clone, needs **no** skip-and-warn branch, and belongs in the `db:refresh` chain proper —
**not** in `REFRESH_EXCLUSIONS`.

- Reads the durable tree, not `index.json` and not `votes/*.json`.
- Stage-merge (`scripts/db/lib/stage_merge.ts`), never `TRUNCATE` — all three tables are on
  a serving path, and a truncate-reload would `55P03` the My-Area tile for the duration.
- Calls `vacuumAfterReload()` after COMMIT. Stage-merged is **not** exempt — `interreg_partners`
  is the counter-example, at 130 of 474 pages after an ordinary merge. Add the tables to
  `reload_visibility_map.data.test.ts`.
- Refuses a >5% shrink without `--allow-shrink`.
- Applies 160 itself, so a corpus reload always carries the DDL.
- Wires **both** changelogs. `ingest_changelog` (`scripts/db/lib/ingest_changelog.ts`) for
  the PG `recent_updates()` feed, **and** `data/data-changes.json` via
  `scripts/lib/data-changes` for `/data/updates`. These are two different artifacts serving
  two different surfaces; wiring one and assuming the other follows is a standing trap in
  this repo.

Chain placement: in `db:refresh` after **three** predecessors, all of which it reads:

| predecessor | what this loader needs from it |
|---|---|
| `db:resolve:persons` | `person_role` — the `person_id` bridge |
| `db:load:place-dim:pg` | `ekatte` on `council_muni` |
| `db:load:official-candidate-links:pg` | `official_candidate_link` — the `party_id` frame |

All three go in `refresh_coverage.ts`'s `ORDER_PAIRS`. Membership alone will not catch a
reordering — that is precisely how `db:load:tr-company-place:pg` sat twenty steps ahead of
the loader that rebuilt its money basis, publishing the previous vintage with every row
count reconciling.

**Document it in CLAUDE.md.** Every PG-served family in this repo carries a section there
naming its cloud commands, its re-run triggers and its failure mode. A family that is not
documented there is invisible to the next operator, and the cloud side of this one is
entirely manual.

Cloud side — nothing here is automatic:

```bash
npm run db:load:council:pg:cloud     # after resolve:persons + place-dim + official-candidate-links
npm run deploy:db                    # the routes
npm run deploy                       # the hub itself
```

---

## 5. Tier 2 — re-enable extraction (only after Tier 0 lands)

**T2.1** Give the daily path `--per-councillor`. The flag's cost is wall-clock, not money,
and `--budget-min` already caps each municipality.

**T2.2** Leave `--ocr` opt-in — it costs ~$1.85/session for Sofia (SKILL.md:170) and that
is a real budget decision, not a default. Document the Sofia refresh as a deliberate
periodic operator action, the way the CR-deeds crawl is.

**T2.3** Add a staleness gate. `council_muni.last_ingest` vs the newest `decided_on`
carrying named votes: a municipality whose named-vote corpus has not moved in 60 days while
its resolution corpus has is reported by the watcher. **This is the gate whose absence let
this run for two and a half months.** It matters more than either code fix — both defects
were invisible precisely because every row count reconciled.

**T2.4** Update SKILL.md's daily command and its troubleshooting table, which currently
documents neither the freeze nor the shard-overwrite hazard.

**T2.5 — wire the PG publish into the skill itself.** `update-council-minutes` must gain a
step running `db:load:council:pg` locally and naming `db:load:council:pg:cloud` as the
publish. This is the single most repeated failure mode for a JSON→PG migration in this
repo: the corpus moves, the loader exists, nothing runs it on the cloud side, and prod
serves the previous vintage at a 200 with every row count reconciling. The skill is the
only place that closes it — `db:refresh` covers local and nothing covers cloud.

Add the same hook to `process-watch-report`'s mapping so an orchestrated run reaches it.

---

## 6. Tier 3 — serving layer

`161_council_serving.sql` — "applied, never loaded", so `db:load:council:pg` applies it and
a body fix ships via `apply_functions.ts`.

- `council_overview()` — hub tiles: municipalities covered, resolutions, named-vote
  coverage, freshness per council.
- `council_muni_detail(code, limit, offset)` — one council's resolutions, paginated.
  **Replaces the 1,542 KB whole-index fetch** with a scoped call.
- `council_resolution_detail(id)` — one resolution plus its named votes.
- `council_councillor(person_id)` — one councillor's voting record: attendance, dissent,
  the actual votes. This is what `CouncilActivitySection` was supposed to be, now keyed on
  `person_id` rather than an officials slug, so it survives a re-slug.
- Routes in `functions/db_routes.js`, all degrading a missing migration to empty with a
  logged `cc:not-built` once per process — the `psp:`/`pp:` contract.

**Every function gets a measured buffer ceiling before it ships**, per the repo's standing
rule — `EXPLAIN (ANALYZE, BUFFERS)` on the **worst-case entity**, not a median one. Here
that is Столична община (200 indexed resolutions, 2,964 named-vote rows, the largest
roster). The ceiling goes into `council_corpus.data.test.ts` the way
`person_connections.data.test.ts` holds its own, including that test's trick of restoring
the slow body in a rolled-back transaction so the ceiling is proven to still discriminate.
Prod is a db-g1-small under a 10 s `statement_timeout`; a local timing on its own proves
nothing about it.

Retire `councillor_signals.json` by computing attendance and dissent in SQL. The definition
must move, not be duplicated: the current derivation (`build_councillor_signals.ts`) states
its own caveat that Bulgarian protokols list only councillors who voted, so attendance is
`appearances / resolutions-with-named-votes` and never a true absence record. That caveat
belongs in the payload, so no consumer can render it as "missed N sessions".

---

## 7. Tier 4 — the hub

`/council` (BG) + `/en/council`, following the `dashboard-hub` skill: tile registry, one
precomputed stat blob rather than per-tile fetches, prerendered page, sitemap `<loc>` in
**both** `route_defs` lists, and its own og:image.

Bands:

0. **Coverage, stated first.** 16 councils of 265; 5 publish named votes. The honest frame
   is the hub's opening claim, not a footnote.
1. **Latest resolutions**, cross-council, deep-linking to `/council/:code`.
2. **How they voted** — the named-vote band, explicitly scoped to its 5 councils.
3. **Councillor records** — attendance and dissent, reachable from a councillor's own
   `/person/:slug` and from their council's page. **Not a cross-municipal ranked
   leaderboard** — see the editorial note below.

Sub-pages: `/council/:code` (one council) and `/council/resolution/:id`.

### Editorial: why Band 3 is not a leaderboard

**Decision — reversible, but make it deliberately.** `091_accountability_gate.sql:8` and the
published methodology copy at `scripts/prerender/routes.ts:1397` state that named
behavioural metrics are computed for a senior cohort only and explicitly **not** for "the
~4,700 municipal councillors" — "defensible for the highest public offices, not for a
first-term councillor."

That policy is scoped to the *accumulation gap*, a financial-discrepancy metric with
defamation exposure. Attendance and dissent derived from a published voting record are a
different class, and the site **already publishes them** in the My-Area tile with a 10%
dissent badge threshold. So Band 3 is not blocked.

What the policy does rule out is the step-up in prominence: a **ranked, cross-municipal
league table of named first-term councillors**, sorted by dissent, is a different artifact
from "here is this councillor's record on their own page". Band 3 therefore ships as
per-councillor records reachable from a person or a council, with no cross-municipal
ranking and no sort-by-dissent. Reversing this is a one-line product decision, but it
should be taken against the policy text rather than around it.

Per §2, any figure that *is* aggregated across councils must name its denominator — it is a
statistic over 5 councils, not over Bulgaria.

### Language

**Resolution titles exist only in Bulgarian** — there is no `title_en` anywhere in the
corpus, and machine-translating a legal instrument's title is not something this plan
proposes. `/en/council` therefore follows the pattern `build_alerts.ts` already uses for its
`headline_en`: English chrome, English framing sentence, **verbatim Bulgarian title**. The
EN page must not imply the title has been translated, and the corpus must not grow a
`title_en` column that would invite one.

### Prerender volume and reachability

`/council` + `/council/:code` is 17 pages, 34 with the EN mirror — prerender them, with
sitemap `<loc>`s in **both** `route_defs` lists.

`/council/resolution/:id` is **4,676 × 2 = 9,352** pages. That clears the Firebase file-count
ceiling comfortably against today's ~248k (the known failure is at 453k), so prerendering is
viable — but it is 9,352 thin pages whose body is one title and a vote table, which is the
shape that earns a thin-content penalty rather than traffic. **Serve them from the `db`
function instead** (`functions/spa_page.js`), the `/funds/contract/**` and `/company/**`
precedent, and give them no sitemap `<loc>`. That keeps the ordering rule with them:
`deploy:db` **before** `deploy`, or every resolution URL routes to a function with no
handler.

### `llms-full.txt`

A new page family gets a corpus section, following the judiciary precedent in
`scripts/llms/buildFull.ts` — a heading, a BG and EN intro that states the coverage (16 of
265; named votes for 5) and what a dash means, and a table of councils. `buildFull.ts`
already refuses to rewrite the file when the judiciary section would vanish; add the same
guard for this one.

The My-Area / governance consumers are **not** part of this tier — they are Tier 5 and Tier 6
below, because both carry defects of their own that the hub does not.

---

## 8. Tier 5 — My-Area / governance place tiles onto PG

`/governance/:id` renders `MyAreaScreen` (`routes.tsx:4064-4067`); `/my-area/:id` 301s into it
(`:1533`). So "my area" and "governance place dashboard" are the same screen, and it hosts
both council consumers: `MyAreaCouncilTile` (`:229`) and `MyAreaAlertsTile` (`:212`).

### The defect this tier fixes is not just staleness — it is payload

`MyAreaCouncilTile` issues three fetches. Only one of them is gated:

| fetch | gated? | size |
|---|---|---:|
| `useCouncilMinutes` → `/council/index.json` | **no** | 1,542 KB |
| `useCouncillorSignals` → `councillor_signals.json` | **no** | 55 KB |
| `useCouncilVotes` → `/council/votes/<code>.json` | yes (`enabled: !!councilKey`) | 446–765 KB |

Measured totals per dashboard view: **Sofia 2,043 KB, Burgas 2,252 KB**, a wired
municipality without named votes 1,598 KB.

And the tile self-suppresses at `MyAreaCouncilTile.tsx:265`
(`if (!data || resolutions.length === 0) return null`) — *after* the download. So **all 265
place dashboards pull 1,598 KB of council data and 249 of them render nothing from it.**
That is the single largest avoidable payload on the governance dashboard, and it is paid by
the 94% of municipalities the council ingest does not cover.

### T5.1 — one scoped call

Replace all three fetches with `/api/db/council-muni?code=<frontend_code>` (§6's
`council_muni_detail`), returning the council's recent resolutions, its named votes and the
per-councillor attendance/dissent in one payload. A municipality that is not wired answers
with a small "not covered" body, so the 249 uncovered dashboards drop from 1,598 KB to
approximately nothing.

The route takes the **frontend** code and resolves it server-side through
`council_muni.frontend_code` (§4). That column exists precisely so the two code spaces are
reconciled once, in the dimension.

### T5.2 — delete the client-side roster join

`MyAreaCouncilTile.tsx:145-147` states outright that its `firstLastKey` matching is "identical
heuristic to the per-município join in `scripts/council/lib/roster_join.ts`". It is a
name-matching rule maintained in two places, and a third copy of the obshtina code map lives in
`build_alerts.ts` (§9). With `council_vote.person_id` resolved at load time, the route returns
person slugs directly and the client-side heuristic is deleted rather than re-synced.

This is also a correctness upgrade, not only a cleanup: the tile currently attributes votes by
first+last name with no protection against two councillors sharing one, whereas the loader
**refuses** a shared name (§4). The tile stops making a claim the corpus cannot support.

### T5.3 — retire `useCouncilMinutes` / `useCouncilVotes` / `useCouncillorSignals`

All three become dead once T5.1 lands. `councilObshtinaMap.ts` stays — `src/lib/obshtinaPlace.ts`
imports it independently.

### T5.4 — the tile must distinguish three states, not two

Today it renders or it vanishes. With named votes served for 5 of 16 councils it needs:
"this council is not covered" (249 munis), "covered, but publishes no named votes" (11), and
"covered with named votes" (5). Collapsing the middle case into the first tells a reader in
Пловдив that nothing is known about their council, when in fact 151 of its resolutions are
indexed.

---

## 9. Tier 6 — the alerts feed onto PG

`scripts/myarea/build_alerts.ts` is a **build-time generator** writing 290 per-município files
to `data/myarea/alerts/<obshtina>.json`, consumed by `useMyAreaAlerts` → `MyAreaAlertsTile`.
Council resolutions are source 1 of its seven: top 3 in a 60-day window, ranked by
`councilRank` to prefer tagged and tally-bearing rows.

It reads `data/council/index.json` once at `:916` and feeds all 265 município iterations from
that single read.

**The precedent already exists in this file.** Source 5b (open calls) reads Postgres directly —
migration 142 — with the reason stated in the header: "'open' is derived at query time from
`closes_at` and does not exist in the committed snapshot". The council source has the same
shape of problem and should take the same route.

### T6.1 — swap the council source to PG

`buildCouncilResolutionEvents` reads `council_resolution` instead of the JSON index. Keep the
builder as a build-time artifact — converting all seven sources to live routes is a different
project, and the other six are out of scope here.

### T6.2 — retire `COUNCIL_KEY_MAP`

`build_alerts.ts:263` carries a hard-coded obshtina→council code map whose own comment says it
"Mirrors `STATIC_MAP` + `councilKeyForObshtina()` in `src/data/council/councilObshtinaMap.ts`".
That is the **third** copy of this mapping (with `councilObshtinaMap.ts` and the tile's usage).
`council_muni.frontend_code` becomes the single definition and the copy is deleted. A mapping
maintained in three places is how a município silently renders nothing — which is exactly the
historical failure `councilObshtinaMap.ts` was created to fix.

### T6.3 — named-vote alerts, newly possible

Today a council alert can only ever be "the council voted on X", because the index it reads is
stripped of `perCouncillor` (§1, Defect B). Reading `council_vote` makes "your councillor voted
against X" expressible for the 5 covered councils — the most valuable event type the feed could
carry, and the one the current architecture forbids outright.

Gate it on `council_muni.has_named_votes` so the other 260 never emit a half-claim.

### T6.4 — coupling, not staleness

The artifacts are currently **fresh** — 289 of 290 rebuilt 2026-08-15, a day after the council
index — so there is no live drift to report. The risk is structural: the feed is a separate
build step over a corpus that moves weekly, with nothing asserting the two agree. Add a gate
that every `council_resolution` event in a committed alerts file resolves to a live row in
`council_resolution`, so a council reload that outruns the alerts build is visible instead of
inferred.

---

## 10. Tier 7 — the AI chat tools and the data map

Two consumers outside the React app read `data/council/index.json` directly. Neither can be
left behind: if Tier 8 retires the index they break, and if it does not, the corpus has two
sources of truth that will disagree the first time a scrape lands between two builds.

### T7.1 — `councilResolutions` and the place profile

`ai/tools/placeData.ts:280` (the `councilResolutions` tool) and `ai/tools/profile.ts:350`
each fetch the whole 1,542 KB index to answer a question about one município. Repoint both
at `/api/db/council-muni`.

`placeData.ts:281-292` also carries the **fourth** copy of the obshtina→council code
mapping, and by far the least safe one — a fuzzy substring match on normalised names:

> "The council ingest keys some oblast centres with a different obshtina code than
> municipalities.json (e.g. Русе = RSE01 vs RSE27). Try the code first, then fall back to
> matching the council entry's name."

A name-substring fallback across 265 municipalities is a wrong-place answer waiting to
happen in a surface that speaks in sentences. `council_muni.frontend_code` (§4) resolves it
server-side and this block is deleted. Counting the copies retired across the plan: this
one, `COUNCIL_KEY_MAP` in `build_alerts.ts:263` (§9), the tile's usage (§8), leaving
`councilObshtinaMap.ts` as the only client-side survivor — kept because
`src/lib/obshtinaPlace.ts` imports it independently of council data.

### T7.2 — the data map

`scripts/data_map/model.ts:124` matches `/^\/(air|municipal_transparency|local_taxes|council)\//`
as a **bucket-served** artifact, and `:578` lists `council_minutes` as a member of the
municipal-scrape node. After the migration that description is wrong: `/data` would tell a
reader the corpus is a set of JSON files on a bucket when it is a Postgres family. Update
the node's storage class and its prose in the same change that flips the serving path — the
data map is the page whose whole job is being accurate about this.

---

## 11. Tier 8 — cleanup

Delete `src/screens/components/CouncilActivitySection.tsx`,
`src/data/council/useCouncillorProfile.tsx`, `src/data/council/useCouncillorConflicts.tsx`;
stop emitting `councillor_conflicts.json`; drop `build_councillor_conflicts.ts` or fold its
conflict-detection into SQL against `council_vote` ⨝ `person_role`, where it has a real
join to work with.

### Retiring the bucket copy — four edits, not one

**`data/council/` is currently excluded from nothing.** The whole tree ships to the bucket
today: `index.json`, `votes/*.json` and all 4,676 durable shards. Once PG serves the corpus
and Tiers 5–7 have moved every reader, none of it is fetched — but nothing stops it being
uploaded, and this repo has pushed ~16.8k orphan shards to a bucket nobody read before.

The `budget/municipal_fiscal` precedent is the one to copy, and its lesson is that there are
**three independent upload paths**, so an exclusion on any one leaves the other two shipping
the corpus:

1. the `bucket:sync` `gsutil rsync -x` regex in `package.json`;
2. the `bucket:sync:dry` regex — the same string, separately maintained, and a dry run that
   disagrees with the real one is worse than no dry run;
3. `isExcluded` in `scripts/bucket_sync_paths.ts`, **plus** its `CHILD_EXCLUDES` twin —
   `isExcluded` guards only the top-level argument, so without the twin
   `bucket:sync:paths -- council` walks straight into the subtree.

Keep the **durable shard tree on disk and in git**: it is the loader's input (§4).

⚠️ **An exclusion FREEZES the bucket copy, it does not remove it.** `gsutil rsync -x`
excludes a match from deletion as well as from upload, and `syncPaths` passes `-x` together
with `-d`. So after these four edits the objects stay, served and stale, for ever. Removal
is a separate, explicit operator action:

```bash
gsutil -m rm -r gs://data-electionsbg-com/council
```

Do that only after Tier 7 lands — the AI tools fetch from the bucket, and removing the
objects while `councilResolutions` still reads them 404s a shipped feature with no undo.
This is the same ordering that left `parliament/company-connections/` answering from a July
snapshot at a 200.

---

## 12. Gates

- `council_corpus.data.test.ts` — PG row counts reconcile against the durable tree; every
  `council_vote.person_id` resolves to exactly one active person or is NULL; no municipality
  has `has_named_votes` true with zero votes.
- `index_writer.test.ts` — T0.4's mutation-checked merge test.
- `reload_visibility_map.data.test.ts` — the three tables listed.
- `refresh_coverage.test.ts` — chain membership + both `ORDER_PAIRS`.
- `families.data.test.ts` — every `/council` `<loc>` has real `dist/` HTML (run **after**
  `npm run build`).
- `myarea_council_tile.test.tsx` — the tile renders all three coverage states of T5.4, and
  issues no fetch for an uncovered municipality.
- `myarea_alerts.data.test.ts` — every `council_resolution` event in a committed alerts file
  resolves to a live `council_resolution` row (T6.4); no named-vote event for a municipality
  with `has_named_votes = false`.
- `council_corpus.data.test.ts` also holds the **buffer ceiling** for every serving function
  at the worst-case entity (Столична община), and proves the ceiling still discriminates by
  restoring the slow body in a rolled-back transaction.
- A gate asserting no `person_id` is attached to a `norm_key` that matches more than one
  person **within the same município** — the refusal in §4 is the corpus's central safety
  property and must be asserted, not assumed.
- A gate asserting `council_vote.party_id IS NULL` never renders as zero dissent: a
  councillor with no party reference frame reports attendance and *no* dissent figure.
- `bucket_sync_paths.test.ts` — all four council exclusions present and in lockstep, the
  test that already exists for the `municipal_fiscal` set.
- A gate asserting no committed source still fetches `/council/index.json` once Tier 7 lands
  (`ai/`, `src/`, `scripts/` — the data map's own pattern excepted).
- A gate asserting the hub's coverage line is derived from `council_muni`, never
  hard-coded — the `/funds/calls` "2 от 6" lesson, where a committed fraction went stale in
  both directions.

## 13. Sequencing

**Tier 0 → Tier 1 → Tier 2 → Tier 3 → {Tier 4, Tier 5, Tier 6, Tier 7} → Tier 8.**

Three hard constraints; everything else is free ordering:

1. **Tier 0 before Tier 2.** Re-enabling extraction against the current merge destroys the
   served corpus on its first success (§1).
2. **Tier 8 last, and its `gsutil rm` after Tier 7.** Cleanup deletes hooks Tier 5 is still
   replacing, and removing the bucket objects while the AI tools still read them 404s a
   shipped feature.
3. **`deploy:db` before `deploy`,** every time — `/council/resolution/**` is function-served
   (§7).

Tiers 4–7 all depend on Tier 3's serving functions but **not on each other**, and can land in
any order or in parallel.

Two items are worth landing on their own merit, regardless of whether the hub is ever built:

- **Tier 0** stops an active, silent data-loss path.
- **Tier 5** is the highest value-per-effort item in the plan — it removes 1,598 KB from all
  265 governance dashboards, 249 of which render nothing from it today.


