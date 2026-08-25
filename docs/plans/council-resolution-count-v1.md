# `meta.resolutionCount` drift in `data/council/index.json` — v1

**Status:** plan only. Nothing here has been applied.
**Found:** 2026-08-24, during a `/process-watch-report` run that queued `update-council-minutes`.
The scrape itself succeeded and 0 new protocols were genuinely available — nothing failed. The
drift was caught only by diffing the committed artifact.
**Evidence re-derived:** 2026-08-25 against `HEAD` = `1b56d00d59`.

---

## 0. Verdict up front

- **NOT user-visible.** `CouncilScreen` reads Postgres, never `index.json`, and the PG count is
  computed from the durable shard tree. §3 proves this; it is the fact the severity turns on.
- **The count is not "unstable"** in the sense of being nondeterministic. It is **two different
  quantities written into one field by two different writers**, alternating.
- **There is a real corpus defect underneath it**, and it is the more interesting half: **84
  resolutions that `cbbcd220e4` purged as phantoms on 2026-08-22 are still sitting in
  `resolutionsByObshtina`.** The commit message says "with the shards and index rebuilt to
  match"; the shards were, the index _window_ was not. The count drift is the symptom that
  made them visible.
- The recommended fix is **one definition, in the durable tree, for both writers — plus a prune
  of the index window**, gated by a test that fails on either half.

---

## 1. Evidence (re-derived, not taken on trust)

### 1.1 The three municipalities that disagree

`meta.<code>.resolutionCount` vs `find data/council/<CODE> -name '*.json' | wc -l`, at `HEAD`:

| obshtina       | `meta.resolutionCount` | shard files | index-window rows | index-only ids | Postgres `council_resolution` |
| -------------- | ---------------------: | ----------: | ----------------: | -------------: | ----------------------------: |
| RSE01          |                **507** |         426 |               200 |         **81** |                           426 |
| PVN01          |                **137** |         135 |               137 |          **2** |                           135 |
| VAR01          |                 **81** |          80 |                81 |          **1** |                            80 |
| _the other 13_ |               = shards |           — |             ≤ 200 |          **0** |                      = shards |

The three deltas are **exactly** `|index-window ids \ durable shard ids|`. Corpus-wide that set
is **84 ids**, and it lives in exactly those three municipalities. Postgres matches the shard
tree for all sixteen and holds **zero** of the 84.

### 1.2 The 84 are the phantom resolutions of `cbbcd220e4`

`git show --name-status cbbcd220e4 -- data/council | grep '^D'` deletes **exactly 84 shards**:
81 RSE01, 2 PVN01, 1 VAR01 — the same three municipalities, and (spot-checked) the same ids:
`RSE01-2026-prot34-r1`, `PVN01-2026-prot47-r1/r2`, `VAR01-2026-prot37-r01`. That commit is
_council: "Точка N" becomes an opt-in marker, and 84 phantom resolutions go_, whose body reads:

> Purged, after confirming each against evidence rather than the band alone:
> RSE01 81 rows — numbers 1..32 against survivors at 917..1048, no overlap …
> Corpus 4,601 -> 4,517, local and Cloud SQL, with the shards and index rebuilt to match.

The two id cohorts are visibly the two parsers, on the same protocol, the same date and the
same `sourceUrl`:

```
index row : {"id":"RSE01-2026-prot34-r1",   "number":"1",   "date":"2026-05-28", … }   ← agenda position
shard     : {"id":"RSE01-2026-prot34-r978", "number":"978", "date":"2026-05-28", … }   ← the council's Решение №
```

So the surviving index rows are not "extra history the tree missed". They are the _withdrawn_
readings of resolutions the tree already holds correctly — a **double count of the same
sitting**, under an id scheme the project has ruled false.

### 1.3 The oscillation, explained exactly

Tracing `meta.RSE01.resolutionCount` and the committed shard set at each commit:

| date  | commit       | writer that wrote the field    |   value | what it equals                                                                             |
| ----- | ------------ | ------------------------------ | ------: | ------------------------------------------------------------------------------------------ |
| 08-21 | `211a6b7d2b` | `mergeMuniResult`              |     211 | index ∪ durable — and index ⊆ durable, so = durable                                        |
| 08-22 | `cbbcd220e4` | `rebuildShardsFromDurable`     |     130 | `durable.ids.size` (211 − 81 purged)                                                       |
| 08-22 | `f654cdd23a` | `rebuildShardsFromDurable`     |     130 | `durable.ids.size`                                                                         |
| 08-22 | `b4c463f6bd` | `rebuildShardsFromDurable`     |     130 | `durable.ids.size`                                                                         |
| 08-22 | `82431d35f2` | `rebuildShardsFromDurable`     |     426 | `durable.ids.size` (working tree already at 426; only 130 committed until the next commit) |
| 08-25 | `1b56d00d59` | `mergeMuniResult` (the scrape) | **507** | index(200, incl. 81 phantoms) ∪ durable(426)                                               |

PVN01 over the same window: 137 → 135 → 135 → 135 → 135 → 137 — i.e. `135 + 2` whenever the
scrape writer ran, `135` whenever the rebuild writer ran. Identical shape.

**The field is not oscillating over time. It is alternating between two writers.** Both were
introduced in the _same commit_, `9f1c388285` (2026-08-16, "the votes shard merges instead of
replacing, and the durable tree is the merge basis") — six days before the purge that made them
disagree. Until the purge the two definitions were numerically equal on every município, which
is why the split shipped unnoticed.

### 1.4 Why a run that writes zero shards still moves the field

`scrape.ts:499` calls `mergeMuniResult(result, recipe.name)` **unconditionally** for every
município that was reachable — there is no zero-resolution short-circuit (the two `continue`s
above it cover `--dry` and `unverified` only). So on the 2026-08-24 run all sixteen
municipalities re-ran the merge with `result.resolutions = []`, and

```ts
// index_writer.ts:481-487
const byId = new Map<string, CouncilResolution>();
for (const r of indexRows)     byId.set(r.id, r);   // ← the 200-row capped window, phantoms included
for (const r of durable.rows)  byId.set(r.id, r);
…
const resolutionCount = byId.size;
```

recomputed `byId.size` from state alone. Zero new records, zero shard writes, and the field
still moved by +84 — because the _input_ to the union changed under it on 08-22 while the field
had last been written by the other definition.

Corroborated by the rest of `meta`: all sixteen `lastIngest` stamps moved to 2026-08-24T21:5x
(a no-op run restamping a frozen corpus — precisely the antipattern `writeVotesShard`'s own
equality short-circuit exists to prevent, quoted at `index_writer.ts:373-378`), while only
PDV01's `protocolsIngested` moved (+1, the single protocol actually touched), and only the three
phantom-carrying municipalities' counts moved.

---

## 2. Root cause

**One field, two definitions, alternating writers, and a stale input neither of them prunes.**

| writer                                           | line                  | definition                                             | includes phantoms? |
| ------------------------------------------------ | --------------------- | ------------------------------------------------------ | ------------------ |
| `mergeMuniResult` (every scrape)                 | `index_writer.ts:487` | `byId.size` = \|index-window ∪ durable ∪ this scrape\| | **yes**            |
| `rebuildShardsFromDurable` (`rebuild_shards.ts`) | `index_writer.ts:588` | `durable.ids.size`                                     | no                 |

The union definition is justified in the code by a comment at `:481-486`:

> Counting `byId` also includes index-only rows that never got a durable shard — which a walk of
> the shard tree misses, and which the merge above exists to preserve.

**That justification is dead.** The only way to create an index row without a durable shard is
`MergeOptions.skipShards`, and:

- `grep -rn "skipShards\|skip-shards" scripts/` returns **no call site** outside
  `index_writer.ts` and its own test file;
- `scrape.ts:499` passes **no options at all**, so `skipShards` is always `false`;
- `git log -S"skipShards: true" -- scripts` returns **nothing** — it has never been passed.

So no live path can mint a shard-less index row. The 84 that exist were created the other way
round: by **deleting shards** for rows the index window already held. The union definition does
not "preserve legacy rows"; on this corpus it does exactly one thing — **it resurrects purged
ones**.

The feedback loop is self-perpetuating: `byId` is seeded from `indexRows`, `capped` is written
back to `indexRows`, so every phantom re-enters the window on every run. RSE01's phantoms are
dated 2026-05-28…2026-07-16 — among the **newest** rows in a 200-row date-desc window whose tail
is 2026-03-26 — so they will not age out for a long time. PVN01 (137 rows) and VAR01 (81 rows)
are under the cap entirely and **can never** age out.

---

## 3. Is it user-visible? — **No.** (Established before anything else.)

The prompt is right that this is the fact severity turns on. Chased end to end:

1. **`CouncilScreen.tsx:23`** imports `useCouncilMuni` from `src/data/council/useCouncilHub.tsx`.
2. **`useCouncilHub.tsx:129`** fetches `/api/db/council-muni?code=…` — Postgres. Its header line
   3 says so explicitly: _"Replaces the bucket-served `data/council/index.json` for these
   screens"_.
3. **`161_council_serving.sql:175`** — `'resolutionCount', (SELECT resolution_count FROM muni)`,
   i.e. `council_muni.resolution_count`.
4. **`scripts/db/load_council_pg.ts:452`** — `resolution_count: rows.length`, where `rows` is the
   **durable shard-tree walk**. The loader's own `IndexMeta` type (`:75-78`) is declared as
   `{ name?: string; lastIngest?: string }` — it reads `index.json` for the display **name** and
   **lastIngest** and _structurally cannot_ read `resolutionCount` from it.
5. **`scripts/bucket_sync_paths.ts:169`** refuses `council/` from bucket sync outright
   (_"council/ is a PG load source, served from Cloud SQL"_), so `index.json` is not even
   published. `scripts/bucket_sync_paths.test.ts:90` holds that.
6. A repo-wide grep for `council/index.json` / `resolutionsByObshtina` / `resolutionCount` across
   `src/ scripts/ functions/ ai/` (the `ai/` arm included deliberately — CLAUDE.md records that
   omitting it once hid a live reader of a "readerless" tree) finds **no runtime consumer** of
   the field. `MyAreaCouncilTile.tsx:8` mentions the file only in a comment recording the fetch
   it _replaced_.

Verified against the live database: `council_resolution` matches the shard tree for all sixteen
municipalities, and holds **0** of the 84 phantom ids.

**So the two `CouncilScreen` uses the prompt flags — the `unknown / resolutionCount` percentage
denominator and the displayed total — are both served the correct, tree-derived number.** This
is a metadata defect in a committed-but-unserved artifact, not a wrong figure rendered next to a
municipality's name.

### 3.1 It is not _inert_, though — three real consequences

1. **The operator's own verification step reads it.** `update-council-minutes/SKILL.md` Step 4
   prints `v.resolutionCount` per município as the post-scrape sanity check. The number an
   operator uses to confirm an ingest is the one that over-reports.
2. **It is persisted into the orchestrator's ledger.** `merge.total` is written verbatim into
   `state/ingest/council_<CODE>.json` (`scrape.ts:537`), which is git-tracked. RSE01 currently
   reads `"summary": "0 prot(s) → 0+/0=/507 total"` — a stamp asserting 507 for a município with
   426 resolutions.
3. **The 84 purged records are still published inside the artifact.** `resolutionsByObshtina`
   still carries them. Nothing reads it today, but it is a committed corpus file that contradicts
   a decision the project made and documented, and it is the merge basis for every future run.

### 3.2 What is _not_ affected

- The capped display list is byte-identical per município across the run (2,735 rows) — the
  prompt's observation holds. The write is a no-op re-emission of the same set.
- The votes shards are clean: **0 orphan `votesById` entries** across all five
  (`SZR12/SOF/BGS01/PER32/VTR01`), and **0** of the 84 phantoms carries a `perCouncillor` block
  in the index. The exposure here is _latent_, not live: `writeVotesShard` is additive and keyed
  by id with no prune, so the next purge that removes a shard for a resolution that **did** carry
  named votes will strand its entry in the served shard permanently.
- Postgres, `/api/db/council-*`, the My-Area tile, the alerts feed and the AI `councilResolutions`
  tool all read the tree and are correct.

---

## 4. Options

### A. Resync from the durable tree in **both** writers, and stop there

`resolutionCount = durable.ids.size` in `mergeMuniResult` too (unioned with this run's `toPersist`
ids, which are written to the tree in the same call).

- **+** One definition. Removes the alternation. Two-line change.
- **+** Aligns the field with what `load_council_pg.ts` and `council_corpus.data.test.ts` already
  treat as the reference.
- **−** Leaves all 84 phantom rows in `resolutionsByObshtina` — the _corpus_ defect survives, and
  the artifact still contradicts `cbbcd220e4`.
- **−** Leaves the self-feeding loop intact: the index keeps re-seeding itself from stale rows,
  so the next id-scheme change reproduces the condition. It would just no longer be _countable_,
  which is worse — the count is currently the only thing that made it visible.

### B. Resync from the tree **and** prune index rows with no durable shard _(recommended)_

Same as A, plus: in `mergeMuniResult`, drop from `byId` any id that is neither in the durable
tree nor in this run's `result.resolutions`.

- **+** Fixes both halves. The index window becomes a strict subset of the tree by construction,
  which is the invariant the whole design already assumes everywhere else.
- **+** Makes the invariant _statable_ — `meta.resolutionCount == durable count` and
  `index ids ⊆ durable ids` — and therefore gate-able (§6).
- **+** Removes the `--skip-shards` special case, which measurement shows is unreachable and
  which is the entire justification for the union.
- **−** Deletes rows from a committed artifact. Safe only if no legitimate shard-less row exists
  — **measured: the shard-less set is exactly the 84, in exactly the three municipalities the
  purge touched, corpus-wide.** Nothing else is at risk.
- **−** `MergeOptions.skipShards` must go, or be documented as incompatible with the prune. It has
  no call sites; delete it and its test rather than keep a flag whose only effect would now be to
  reintroduce the defect.

### C. Keep both definitions but rename the field

e.g. `resolutionCount` (tree) + `knownIdCount` (union).

- **+** Honest about there being two quantities.
- **−** There is no consumer for the second quantity, and no question it answers. The union is not
  "history the tree missed" — measured, it is purged records. Naming a defect does not fix it.
- **Rejected.**

### D. Delete `meta.resolutionCount` entirely

- **+** Cannot drift.
- **−** The skill's Step 4 verification and the ingest stamp read it; both would need rewriting
  against Postgres, which couples the scrape's verification to a database it does not otherwise
  need. And `merge.total` is genuinely useful in the console line. **Rejected**, but see §5:
  making the _stamp_ honest is worth doing regardless.

---

## 5. Recommendation

**Option B**, in four parts, smallest-blast-radius first.

**B1 — one definition.** In `mergeMuniResult`, compute `resolutionCount` from the durable tree
plus this run's persisted ids, not from `byId`. Replace the `:481-486` comment with the measured
finding (that `skipShards` has no call site, and that the shard-less set is a purge residue).

**B2 — prune the window.** Seed `byId` only with index rows whose id is in `durable.ids`. Log a
one-line warning naming the dropped count per município, so a prune is never silent — a prune
that fires unexpectedly is a signal that a purge or an id-scheme change has just happened.

**B3 — delete `MergeOptions.skipShards`** and the test that exercises it. It is unreachable, and
under B2 it becomes actively unsafe: a `skipShards` run would write index rows the next run then
prunes, i.e. it would silently lose data. Keeping a dead flag whose semantics now invert is worse
than removing it.

**B4 — make the ingest stamp honest.** `scrape.ts:537` writes `merge.total` into
`state/ingest/council_<CODE>.json`. After B1 that value is the tree count, so the stamps
self-correct on the next run — but the currently-committed RSE01/PVN01/VAR01 stamps assert
507/137/81 and will keep asserting it until each município is next scraped. Note this in the
skill; do not hand-edit the stamps (they are the scraper's own ledger).

**Non-goals, stated explicitly:**

- **Do not point `load_council_pg.ts` at `index.json`.** It reads the durable tree on purpose;
  CLAUDE.md records that the capped index once left 530 resolutions and 10,754 named-vote rows on
  disk and unserved. The loader is the one component in this chain that is already correct.
- **Do not raise `PER_MUNI_LIMIT`.** The cap is not the bug; six municipalities legitimately
  exceed it, and a wider cap would only mean more phantoms retained per run.
- **Do not make the count monotonic** (`max(existing, …)`). `:77-79` already records why: a
  legitimate removal must be able to shrink it. The 2026-08-22 purge is exactly that case.

---

## 6. The gate

Three assertions. The first two are the invariant; the third is what stops the gate going vacuous.

### 6.1 Unit — `scripts/council/lib/index_writer.test.ts`

The existing `meta.resolutionCount → "does not collapse to the index cap"` test (`:358-374`)
**cannot fail on this defect**: `seedHistory(n)` puts every row in _both_ the durable tree and the
index slot, so `byId.size == durable.ids.size == 21` and the assertion passes under either
definition. That is the gate gap.

Add a fixture the two definitions **disagree** on — an index row with no durable shard, i.e. the
exact post-purge shape:

```
it("counts the durable tree, not the stale index window", …)
  seedHistory(10)                                   // 10 rows, tree + index
  putIndexOnly(`${CODE}-2026-p9-r1`)                // a purged row: index slot only, NO shard
  mergeMuniResult(scrape([]), MUNI)                 // a zero-resolution run — the 2026-08-24 shape
  → out.total === 10                                // NOT 11
  → idx.meta[CODE].resolutionCount === 10
  → idx.resolutionsByObshtina[CODE].every(r => durableIds.has(r.id))   // the prune (B2)
```

Plus a same-fixture assertion that `rebuildShardsFromDurable()` **agrees**, run immediately after
— that is the alternation itself, asserted as an equality rather than inferred.

**Mutation check** (this repo's convention, and load-bearing here): with B1 reverted to
`byId.size` the first arm must fail, and with B2's prune deleted the third must fail. State that
in the test's header, because the pre-existing test is a worked example of an assertion that
passes against both implementations.

### 6.2 Corpus — `scripts/db/tests/council_corpus.data.test.ts`

That file already declares _"index.json cannot be the reference — it is capped at 200 rows per
município"_ and compares Postgres to the tree, so it never looks at `index.json` at all. Add one
test there — it is the only gate that walks the real committed corpus:

> **`index.json` is a strict, correctly-counted subset of the durable tree.**
> For every município: (a) `meta[code].resolutionCount === |durable shard ids|`, and
> (b) `resolutionsByObshtina[code]` contains no id absent from the tree — failing with the
> offending ids named, not just a count.

Needs no Postgres, so put it behind the same file's existing structure but do not let it inherit
the DB skip: a checkout with the database down must still fail on a dirty index. (If that is
awkward inside the `.data.test.ts` skip guard, it belongs in
`scripts/council/lib/index_corpus.test.ts` as a plain Vitest file over `data/council/` instead —
prefer that.)

### 6.3 Anti-vacuity

Assert the shard-less set is checked against a **non-empty** tree, and skip with a _distinct_
reason if `data/council/` is absent — "the corpus is not present" must never read as "the
invariant holds". Same rule the declarations gates follow.

---

## 7. Does the committed `index.json` need a one-off correction? — **Yes.**

The code fix is **not retroactive on its own**. B1 alone corrects `meta.resolutionCount` at the
next scrape of each of the three municipalities; B2's prune likewise only fires when that
município is next merged. Until then the committed artifact keeps 84 phantom rows and three wrong
counts, and §6.2's gate would fail on `main` from the moment it lands.

**`rebuild_shards.ts` is not sufficient either.** It resyncs `meta.resolutionCount` from the tree
(`:583-588`) — which is half the correction — but it **never touches `resolutionsByObshtina`**.
That is precisely why the purge commit's claim that it "rebuilt the index to match" was only half
true: it ran that tool, which fixed the counts, and the counts were then un-fixed by the next
scrape while the rows were never fixed at all.

**Recommended one-off**, after B1+B2 land:

```bash
npx tsx scripts/council/rebuild_shards.ts
```

extended (as part of B2) to also prune `resolutionsByObshtina` to `durable.ids`, so the repair
tool and the merge writer share one prune. Expected diff, exactly:

```
meta.RSE01.resolutionCount  507 → 426     resolutionsByObshtina.RSE01  200 → 119 rows
meta.PVN01.resolutionCount  137 → 135     resolutionsByObshtina.PVN01  137 → 135 rows
meta.VAR01.resolutionCount   81 →  80     resolutionsByObshtina.VAR01   81 →  80 rows
```

(RSE01 loses 81 of its 200-row window and is _not_ refilled to 200 by the prune — the window is
whatever survives; the next scrape's merge re-fills it from the tree. If refilling matters for the
artifact's tidiness, seed `byId` from `durable.rows` first and re-cap, which `mergeMuniResult`
already does.)

The other thirteen municipalities must show **no diff**. If any of them moves, the prune is wrong
and should be stopped — that would mean a legitimate shard-less row exists that this analysis did
not find.

**Verify after, with the same commands used to find it:**

```bash
node -e "const d=require('./data/council/index.json');for(const[k,v]of Object.entries(d.meta))console.log(k,v.resolutionCount)"
for c in RSE01 PVN01 VAR01; do echo -n "$c "; find data/council/$c -name '*.json' | wc -l; done
```

`state/ingest/council_{RSE01,PVN01,VAR01}.json` will still read the old totals in their `summary`
strings until each município is next scraped; that is the scraper's ledger and self-corrects
(§B4). Postgres needs **nothing** — it already holds 426/135/80 and none of the 84.

---

## 8. Ordering

1. §6.1 unit test + fixture, **failing** against `HEAD` (proves the gate discriminates).
2. B1 + B2 + B3 in `index_writer.ts`; unit test goes green; mutation-check both arms.
3. Extend `rebuildShardsFromDurable` with the same prune.
4. Run the one-off (§7); confirm the diff is exactly the three municipalities.
5. §6.2 corpus gate — added **last**, so it lands green rather than red on `main`.
6. Note in `update-council-minutes/SKILL.md`: Step 4's `resolutionCount` line is now the tree
   count; add `npx tsx scripts/council/rebuild_shards.ts` as the documented repair. Worth flagging
   that there is **no `npm run` alias** for that script — `package.json` has `council:discover`
   and `council:scrape` only — which is part of why the repair path is easy to miss. Adding
   `"council:rebuild-shards"` would cost nothing.

---

## 9. Implementation record (2026-08-25)

Shipped in five commits. Recorded here because three things went differently from §8,
and because two of the five commits exist only because review caught something.

| §         | commit          | what                                                     |
| --------- | --------------- | -------------------------------------------------------- |
| 8.1 + 8.2 | `7a4fa48f99`    | B1 + B2 + B3 in `index_writer.ts`, plus the §6.1 gate    |
| 8.3       | `17c6f6bf74`    | `rebuildShardsFromDurable` prunes, via the shared helper |
| 8.4       | `21679d34c2`    | the one-off correction to `data/council/index.json`      |
| 8.5       | `373a73c727`    | the corpus gate, `index_corpus.test.ts`                  |
| 8.6       | _(this commit)_ | `council:rebuild-shards` alias, SKILL.md, CLAUDE.md      |

**Departures from the plan, and why:**

- **§8.1 and §8.2 landed as ONE commit.** §8.1 asks for the gate to be committed _failing_
  against `HEAD`, which would leave the tree red — forbidden. The "proves it discriminates"
  purpose was preserved instead by running the gate before implementing: 2 failures, both
  reproducing the drift (the inflated count, and the two writers disagreeing).
- **`pruneToDurable` was extracted in §8.1, not §8.3.** Review was explicit that the helper
  must exist _before_ the second call site rather than after — adding a hand-written copy of
  the prune would have reproduced the two-writers-two-definitions shape one field over, which
  is the defect the plan exists to fix.
- **§7's optional refill was declined.** The pruned window is not topped back up to
  `PER_MUNI_LIMIT`, because `writeIndex` strips `perCouncillor` while `durable.rows` carry it —
  seeding the slot from the tree would make `JSON.stringify(idx) !== before` true on every run
  even where the written file is byte-identical, defeating the no-op guard. RSE01 therefore
  sits at 119 of 426 until its next scrape, which is inert: `mergeMuniResult` unions the window
  with `durable.rows`, so once the window is a subset of the tree it contributes nothing.

**The correction matched §7's prediction exactly** — 84 rows, RSE01 81 / PVN01 2 / VAR01 1,
counts 507→426, 137→135, 81→80, and the other thirteen municipalities unmoved. Verified by set
comparison rather than by reading the patch: **84 removed, 0 added, 0 surviving row changed**,
and the removed set has an **empty symmetric difference** with `cbbcd220e4`'s 84 deleted shards.
Postgres needed nothing (unchanged at 4,813) and the corrected counts now agree with
`council_muni.resolution_count` for all 16 — before, three of the sixteen (RSE01, PVN01, VAR01)
disagreed with the database that serves them; the other thirteen always matched.

**What review added that the plan did not anticipate** — each verified by mutation, not argument:

- A **ceiling on the prune** (`shouldRefusePrune`). Measured: with the shard tree absent, the
  prune deleted 300 of 300 rows, published `resolutionCount: 0` and exited 0. The plan gave the
  prune no bound at all. `allowPrune` takes a **Set of codes** so an operator can unblock the
  municipalities they inspected without disarming the guard for the broken one.
- **`writeResolutionShard` refuses a malformed date.** A date that collapses the year segment
  lands a shard at the município root, where the tree walk cannot see it — and the new prune
  then deletes its index row. The prune turned a latent inconsistency into silent data loss.
- **The gate must drive from the UNION**, not from the index. The first cut iterated
  `Object.keys(resolutionsByObshtina)`, so a município dropped from the index emitted no test
  and passed — while `load_council_pg.ts`, which enumerates directories, would still serve it.
  `rebuildShardsFromDurable` rejects that exact reasoning twenty lines away.
- **Two comments asserted things that were not true**, which is this plan's own subject. One
  cited `index_corpus.test.ts` before it existed; one said the 2026-08-24 ingest ended the
  window-tripwire signal, when the decay was in two steps and the ingest was the second —
  `82431d35f2` (2026-08-22, hours after the purge) resynced RSE01's count 130 → 426 while all 81
  orphan rows stayed, taking 81 of the 84 out of the tripwire's view two days early; the ingest
  then cleared PVN01 and VAR01.

**Corrected while here**, after review found the first pass had swept only two of five copies —
a partial sweep of a stale figure being the defect rather than the fix. "Six of sixteen"
municipalities exceed the 200-row cap in `council_corpus.data.test.ts`, `load_council_pg.ts`,
`council_alerts.ts`, `index_writer.ts` and CLAUDE.md; measured 2026-08-25 it is **eleven**. Also
re-measured rather than copied: the tree holds **4,813** shards (CLAUDE.md said 4,676, and
9,626 rather than 9,352 with the EN mirror); **1,980 of 4,813** resolutions belong to councils
whose key is not a frontend code (it said 1,768 of 4,727); and vote attribution is **93.8%**,
43,261 of 46,121 (docs said 94.1% of 28,214 — the corpus grew 63%, the rate did not move
materially, and the gate's floor is a flat 90% rather than a ratchet on either figure).

**The ledger residue §7 predicted is still there, as designed.**
`state/ingest/council_{RSE01,PVN01,VAR01}.json` still read
`"0 prot(s) → 0+/0=/507 total"` (and 137 / 81). Those are the scraper's own stamps, written from
`merge.total`; they self-correct on each município's next scrape now that the writer counts the
tree, and hand-editing them would falsify a ledger. Verified still present 2026-08-25.

**Not done, and deliberately:** the top-level `tags` dictionary in `index.json` is dead — six
labels for a per-row field 0 of 2,651 rows carry — but retiring it needs `writeIndex` and
`types.ts`, and "retired" versus "dormant by design" was not ours to assume. The `note` now
records its status instead.
