# Cross-source duplication in the contracts corpus — v2

**Status:** **COMPLETE.** Every tier is implemented, committed and verified — T0, T1, T2+T3, T4,
T5, T6, T7 and T8. The corpus is reconciled locally and on production, and every gate is green.
**Supersedes:** the reconciliation half of
[procurement-foreign-consortium-members-v1.md](procurement-foreign-consortium-members-v1.md) §9–§11.
v1's supplier-identity tiers (T0 ЕГН encoding, T1/T2 foreign consortium members) are **shipped and
out of scope here**. What is in scope is §11.5's four open items.
**Measured:** 2026-08-04 against local Postgres. Every number below was re-derived for this plan,
not copied. Where a re-derivation contradicts v1, the contradiction is stated and the older number
is marked wrong.

---

## 0. Executive summary

| | |
| --- | --- |
| Duplicates the corpus safely resolves today | **73 side-pairs / 74 rows** (€36.34m on the shards, €35.83m as served — §5.3) |
| Duplicates found but NOT acted on (ambiguous / blocked) | **7 groups + 5 side-pairs**, all enumerated (§5.3b, §5.4) |
| Duplicates the shipped pass removes today | **0** (29 candidates found, 29 blocked) |
| Duplicates the shipped detector can see today | **6 of 130** groups on its own key |
| Feed pairs the shipped machinery structurally cannot touch | **aop↔rop, aop↔ocds** (neither side is `eop-`) |
| Side-pairs needing human triage after the fix | **5**, enumerated in §5.4 |
| Rows this plan proposes to touch outside that set | **0** |

Five things this measurement pass changed relative to §11:

1. **Identity E measures 86 groups / €40.81m, not 79.** §11.5's "79" was identity C's *same-date
   bucket*, which is a different population — C grades a whole group by `max(date) − min(date)`, so
   a group holding a genuine same-date twin **plus** a third row on another date is filed under a
   gap bucket and its twin is lost. Measuring identity E directly recovers 8 groups / ~€1.5m.
2. **The detector's blind spot is `aop+rop`, not `aop+eop`** — on the detector's *own* key. §11.2's
   `aop+eop` headline is measured under identity C. On identity A (what the gate actually runs),
   `aop+eop` is 5 groups and `aop+rop` is **124 / €20.2m**. Both statements are true about
   different keys, and the plan has to widen **both** the feed model and the key or it fixes neither.
3. **120 of those 124 `aop+rop` groups are not duplicates.** They are contract-number reuse inside
   frameworks. Widening the feed matrix *without* moving to identity E turns a designed-to-be-green
   gate permanently red with ~124 non-duplicates — the exact failure §10.6 set out to avoid.
4. **75 of 78 twin-linked contract-sides are supplier-set identical**, which contradicts §9's
   "0 supersets in either direction". §9 measured a `contract_id`-keyed population; on the identity-E
   population, side-level eviction is well-supported and the 3 exceptions are enumerable.
5. **The precedence `eop > aop` is wrong**, though corpus-wide field averages suggest it. On the
   46 affected pairs `aop` is the richer side (annex links 2–0, `eu_funded` 13–0, longer title
   22–9). Correct order: **ocds > aop > eop > rop**.

And the flaky-test brief needed re-triage — **all four items are now closed** (§8). Of the two
files named, one never reproduced across four full runs; two *other* files also failed, and both
turned out to be serving-path defects rather than test flakiness. The full node
suite now runs clean in 67.4 s, down from 179.7 s with 3 failures.

---

## 1. Baseline (reproduce before changing anything)

Local Postgres `postgres://postgres:postgres@localhost:5433/electionsbg`, 2026-08-04:

```
shards      405,711 rows
Postgres    408,357 rows / €99,244,771,522.10
difference    2,646 = the synthetic obed- consortium carriers 087 mints inside PG (reconciles exactly)
```

| Feed | `release_id` prefix | Rows | € | with УНП |
| --- | --- | ---: | ---: | ---: |
| aop | `aop-legacy-` | 244,977 | 46,836,133,519.85 | 141,485 |
| eop | `eop-` | 122,318 | 36,935,205,288.61 | 111,064 |
| ocds | `ocds-e…` | 20,859 | 12,281,651,674.27 | 19,018 |
| rop | `rop-` | 20,203 | 3,191,781,039.38 | 20,203 |

The population every measurement below runs on: `contractor_eik NOT LIKE 'obed-%'`, non-empty `unp`,
non-empty `contractor_eik`, grouped within one `tag`. "Lesser side" = rows and € beyond the
largest single feed's contribution to a group — what would go if the group collapsed to one feed.

### 1.1 The identity lattice — reproduces v1 §11.1 exactly

| Identity | Groups | Lesser rows | Lesser € |
| --- | ---: | ---: | ---: |
| **A** `unp + contract_id` — the shipped gate and pass | 129 | 147 | 5,994,650 |
| **B** `unp + contractor` | 1,192 | 2,371 | 461,594,510 |
| **C** `unp + contractor + rounded €` | 224 | 248 | 147,807,238 |
| **D** `unp + contractor + date_signed` | 165 | 186 | 46,146,247 |
| **E** `unp + contractor + rounded € + date_signed` | **86** | **87** | **40,811,477.07** |

A, B and D match v1 §11.1 to the euro. **E is new** and is the correction in §0.1.

C and E each read **one group lower than the ad-hoc SQL** that produced the first draft of this
table (225 and 87). The SQL was wrong, in a way worth recording because it recurs: Postgres
`GROUP BY` treats NULLs as equal, so two rows with **no** amount — or **no** signing date —
grouped together and were counted as an amount/date match. `identityE()` returns `null` for a row
missing any component, so such a row is never grouped at all. The harness is the correct one, and
in the safe direction: rows are not matched on fields neither of them has.

Two structural properties of E worth stating, because they are what make it safe where the five
failed keys were not:

- It **cannot pool contracts signed on different days.** Every failed design could.
- **No** group spans three feeds, and 79 of the 86 have exactly one row per feed — an unambiguous
  1:1 twin. The other 7 are the ambiguous population of §5.3b and are never acted on.

### 1.2 Reproduction

`scripts/procurement/measure_cross_source.ts` (T0 below) must emit §1.1, §2.1, §3.1 and §5.3 in one
run. Until it exists, the SQL is in this plan's git history; every table here was produced by it.

---

## 2. Defect 1 — the detector and the pass model two feeds

`single_source_per_contract.data.test.ts` classifies rows as `release_id LIKE 'eop-%'` vs
`NOT LIKE 'eop-%'`, and `evictSupersededEopTwins` enforces "only `eop-` rows are ever removed".
Both lump aop, ocds and rop into one bucket.

### 2.1 What that hides — measured on the detector's own key `(unp, contract_id, tag)`

| Pair | Groups the full matrix sees | Groups the current detector sees | € |
| --- | ---: | ---: | ---: |
| **aop+rop** | **124** | **0** | 20,226,613 |
| aop+eop | 5 | 5 | 4,732,535 |
| **total** | **129** | **5** | |

One further `ocds`+`eop` group (`05962-2026-0001/240319`, €42,150) sits outside this table because
the harness's population requires a contractor EIK and the ЦАИС side of that contract has none —
it is already an `ACCEPTED_CONFLICTS` entry for exactly that reason, since no content net can pair
an identity-less row. Counting it, the full matrix is 130 groups against the detector's 6.

So the gate is blind to 124 of 129 groups on its own key — and the blind pair is `aop+rop`, because
aop and rop are the one pair that *shares* contract numbering (7 of 8 identity-E `aop+rop` groups
agree on `contract_id`; `aop:12491оп352` vs `rop:УРИ 12491оп - 352` is the same number modulo a
prefix).

### 2.2 …and why widening the feed matrix ALONE would be a regression

Those 124 groups are overwhelmingly **not duplicates**:

| Supplier-set relation | Groups | Same total € | Single signing date | Lesser € |
| --- | ---: | ---: | ---: | ---: |
| identical suppliers | 56 | 4 | 4 | 1,970,481 |
| aop-superset | 4 | 0 | 0 | 129,905 |
| divergent | 64 | 0 | 0 | 1,614,076 |

**4 of 124** have both the same total and one signing date. The rest are one buyer reusing a
contract number across many call-offs, with the two feeds capturing different call-offs — the feeds
have overlapping but different coverage windows (rop 2011-10-28…2018-12-31, aop 2000-04-06…2025-11-28).
Worked example, `02724-2017-0021 / ПО-03-4`: aop 7 rows / €4,149,034 against rop 5 rows / €103,571,
spread over 12 distinct signing dates. Nothing about that is a duplicate.

> **The conclusion that follows.** Widening the feed model on the current key produces ~124 new
> red entries that are not duplicates, forcing either a 124-line allowlist (destroying the
> "exhaustive AND minimal" property the gate is built on) or a permanently-red gate. **The feed
> matrix and the key must move together, in one change.** This is the single most important
> sequencing constraint in this plan.

---

## 3. Defect 2 — the reconciliation identity is structurally blind

### 3.1 Proof, not inference: the shipped pass evicts nothing

```
$ npx tsx scripts/procurement/reconcile_cross_source.ts
preflight — УНП coverage 71.3% (289459/405711)
stage 2 — 29 candidate(s) BLOCKED: matched a row from another contract
stage 1 — bridged 0 row(s) via 18 entries
stage 2 — evicted 0 row(s), €0.00
stage 3 — rows 405711 → 405711; € 99244771522.10 → 99244771522.10
✓ verification passed
```

29 candidates found, **29 blocked, 0 evicted, verification green**. The pass reports success while
doing nothing. The cause is `contractOf()` in `reconcile_cross_source.ts:70` —
`unp::contract_id::tag` — and `contract_id` differs across feeds in ~99% of real twins (0/46 agree
on `aop+eop`, 0/26 on `eop+ocds`, 0/6 on `aop+ocds`; only `aop+rop` agrees, 7/8).

Measured directly: of the rows sitting in identity-E groups, the share whose own
`(unp, contract_id, tag)` has **no** row from any other feed — i.e. the share the survivor check
blocks — is **81/81 eop, 32/32 ocds, 54/61 aop, 1/8 rop.**

Two side-effects worth recording:

- **Stage 1 bridges 0 rows.** The 18-entry `person_eik_bridge.json` already landed, so
  `bridge.get(r.contractorEik)` now misses on every row. The bridge is a no-op until the next
  re-ingest, which means a regression in it is currently invisible to the pass. (Its own gate,
  `person_eik_bridge.data.test.ts`, still covers the map's internal consistency.)
- **`✓ verification passed` on a zero-eviction run is the failure mode v1 §9 warned about**, in the
  opposite direction: the checks cannot distinguish "nothing to do" from "everything blocked".

### 3.2 The correct identity, and what it links

Adopt **E = `(unp, contractor_eik, round(amount_eur), date_signed, tag)`** as the *matching* key
(v1 §11.5.2, with the corrected population). It links 86 groups, of which **79 are unambiguous**
(exactly one row per feed — see §5.3b for the 7 that are not). Lifted to contract-sides — a side
being the whole `(unp, contract_id, tag, feed)` bucket — those 79 groups link **78 side-pairs**:

| Relation of the two linked sides' full supplier sets | Side-pairs |
| --- | ---: |
| **identical** | **75** |
| eop-superset | 1 |
| aop-superset | 2 |

**This contradicts v1 §9**, which reported "0 supersets in either direction" and used it to argue
deletion always loses counterparties. §9 measured a `contract_id`-keyed population; on the
identity-E population the two feeds agree on the supplier set 97% of the time. That is what makes
side-level eviction defensible here and was not defensible there.

---

## 4. Defect 3 — grade before acting; do not touch the tail

Identity C graded by `max(date_signed) − min(date_signed)`:

| Date gap | Groups | Lesser € | `рамк` signal | Reading |
| --- | ---: | ---: | ---: | --- |
| same date | 78 | 39,331,728 | 5% | duplicate |
| 1–7 days | 5 | 678,245 | 0% | duplicate, publication lag |
| 8–31 days | 18 | 6,036,395 | 17% | probably duplicate |
| 1–3 months | 26 | 15,979,196 | 8% | uncertain |
| **>3 months** | **97** | **85,781,674** | **22%** | **probably distinct contracts** |

Reproduces v1 §11.3/§11.4. Frameworks explain 22% of the tail, so the tail is neither dismissible
nor actionable as a class. Its shape, measured for this plan:

| Pair | Groups | Lesser € | Framework | Same `contract_id` | Mean gap (d) | Max gap (d) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| aop+eop | 26 | 75,497,960 | 3 | 0 | 356 | 783 |
| eop+ocds | 34 | 6,463,474 | 12 | 0 | 387 | 962 |
| aop+rop | 36 | 2,339,240 | 5 | 1 | 570 | 1,694 |
| aop+ocds | 1 | 1,481,000 | 1 | 0 | 1,282 | 1,282 |

**€75.5m of the €85.8m sits in 26 `aop+eop` groups, and €67.0m of that in just two**
(`00044-2023-0015`, €58.5m, 124-day gap; `00044-2023-0029`, €8.5m, 268-day gap — both АПИ, both
carrying two distinct `contract_id`s, neither flagged framework). The tail is not a population, it
is a handful of large cases plus noise.

**Rule for this plan: identity E excludes the whole tail by construction** (it requires an equal
`date_signed`), so no code here touches it. The tail becomes a documented, dated backlog item —
§7.3 — starting with those two АПИ procedures, examined by hand.

Same for the 1–3 month band (26 groups / €16.0m, 8% framework): out of scope, revisit only after
E has shipped and settled.

---

## 5. The design

### 5.1 Feed precedence — settled on the affected population, not on averages

Corpus-wide field completeness says `eop` is the richer feed (`procurement_method` 100% vs aop's
54%; mean title 170 vs 125 chars; `lot_name` 40% vs 17%). **On the 46 affected `aop`↔`eop` twin
pairs the opposite is true** (one pair per identity-E group — an earlier draft said 56, which was
a side-pair join counting a pair twice whenever one side linked to two):

| Signal | aop-only | eop-only |
| --- | ---: | ---: |
| a linked `procurement_annexes` row | **2** | **0** |
| `eu_funded` populated | **13** | **0** |
| `lot_name` populated | 11 | 1 |
| longer `title` | 22 | 9 |
| `procurement_method` / `cpv` populated | 0 | 0 (tie — both on all 46) |

Evicting the aop side would break 2 annex links and drop EU-funding attribution on 13 contracts.
Evicting the eop side breaks none of either. `lot_name` is Postgres-only (050's
`enrich_contract_lot_names()` derives it after load), so that row reads 0/0 on `--source=shards`.

> This is the plan's own worked example of "measure before deciding": the corpus-wide average and
> the population disagree, and only the population is the thing being changed.

**Precedence: `ocds > aop > eop > rop`.** It preserves the shipped convention that `eop` rows are
the ones removed in an `aop`↔`eop` pair, and only *adds* the `ocds > aop` and `aop > rop`
directions the current code cannot express. (No `eop`↔`rop` pair exists in the population, so that
ordering is unconstrained by evidence and is set by the coverage windows.)

### 5.2 Eviction unit — the contract-side, with a completeness precondition

Row-level eviction of only the matched row leaves the *rest* of the losing side in place, which is
still a cross-source mix and still over-states. Side-level eviction is only safe when the two sides
are fully equivalent. So:

**Evict the whole losing side iff all three hold:**

1. the two sides' full supplier sets are **identical**;
2. **every** row on the losing side is matched at identity E to a row on the winning side
   (`matched == losing_rows`);
3. the winning side is likewise fully matched (`matched == winning_rows`) — no unmatched winner row
   that the losing side might be the only record of.

**Otherwise BLOCK the side-pair, name it, and evict nothing from it.**

These three are necessary but **not sufficient** — they are all side-local, so they cannot see an
ambiguous *group*. §5.3b adds the precondition that closes that, and it is applied first.

### 5.3 What this does, exactly

| Direction | Side-pairs | Eligible | Blocked | Rows evicted | € evicted (shards) |
| --- | ---: | ---: | ---: | ---: | ---: |
| aop > eop | 42 | 40 | 2 | 40 | 27,255,574.09 |
| aop > rop | 8 | 5 | 3 | 5 | 3,214,441.39 |
| ocds > aop | 6 | 6 | 0 | 6 | 1,143,142.76 |
| ocds > eop | 22 | 22 | 0 | 23 | 4,728,941.48 |
| **total** | **78** | **73** | **5** | **74** | **36,342,099.72** |

**11 of the 73 (`ocds > aop` and `aop > rop`) are pairs the shipped `evictSupersededEopTwins`
structurally cannot touch**, because neither side is `eop-`.

Row counts are identical whether measured on the shards or on Postgres. **The euro totals are
not, and both are right** — the per-direction table above is the SHARD figure, which is what the
pass removes. Measured with the same harness on both sources:

| | Rows evicted | € evicted | Corpus |
| --- | ---: | ---: | --- |
| `--source=shards` (what the pass removes) | 74 | **36,342,099.72** | 405,711 → **405,637** |
| `--source=pg` (what the served corpus carries) | 74 | **35,830,807.84** | 408,357 → 408,283 |

The €511,291.88 difference is entirely in the `ocds > eop` direction and is
`rebuild_consortium()` (087), which runs **inside** Postgres after the load: it moves a joint
award's value onto one carrier row and zeroes the members. 6 `eop` and 4 `ocds` rows inside
identity-E groups are members sitting at €0.00 in Postgres while the shards carry their real
split; two of them are evicted, and their shard value is exactly the gap.

Two consequences the implementation must respect:

- **The pass's own delta check runs on the shards**, so its expected figure is €36,342,099.72.
  Asserting the Postgres number there would fail on a correct run.
- **Do not predict the post-reload Postgres total.** 087 re-runs over the new member sets and
  redistributes, so the served total after `db:load:pg` is *verified* at T5, not derived here.
  Evicting a member row is safe — the §5.2 identical-supplier-set precondition guarantees the
  winning side carries the same EIKs, so 087 rebuilds the same consortium from one feed instead
  of two — and `invariants_pg.data.test.ts` already gates the carrier/member invariant.

### 5.3b The ambiguity rule — 7 groups the design refuses to resolve

**A precondition the first draft of this plan missed**, found by review and confirmed on the
corpus. An identity-E group can hold **more than one row from the same feed**: that feed published
two different contracts with the same procedure, supplier, amount and signing date. Four call-offs
of a framework signed the same day at the same price is the real shape —
`01071-2020-0009` has ЦАИС "Договор № 878/879/880/881" against two aop rows.

Nothing in the data says which aop contract corresponds to which eop contract, and when the counts
differ, some correspond to nothing at all. **The three §5.2 preconditions cannot see this**: each
such contract is its own side, each side holds one row, and each singleton supplier set matches —
so an N:M fan passes all three and silently collapses N rows onto M survivors. That is the same
class of error as the key that destroyed 46 legitimate rows.

So the rule is: **a group is actionable only when every feed contributes exactly one row.**
Anything else is reported and left alone.

| УНП | Shape | Supplier | € | Signed |
| --- | --- | --- | ---: | --- |
| `05568-2021-0001` | eop×2 aop×1 | 107544354 | 5,363.86 | 2021-02-25 |
| `01071-2020-0009` | eop×4 aop×2 | 177441542 | 311,253.91 | 2021-04-20 |
| `00589-2022-0052` | aop×1 eop×2 | 103318710 | 4,090.34 | 2022-11-01 |
| `02378-2023-0001` | aop×1 eop×2 | 203540174 | 664.68 | 2023-06-02 |
| `00339-2025-0039` | eop×2 ocds×1 | 128591001 | 9,493.74 | 2025-11-05 |
| `00053-2026-0001` | ocds×1 eop×2 | 204293638 | 541,537.00 | 2026-05-07 |
| `00053-2026-0001` | ocds×1 eop×2 | 181527965 | 541,537.00 | 2026-05-07 |

**7 groups / 24 rows / €5,175,583.32 (shards) left in place.** Note the last two are consortium
members, which is why Postgres reports €0.00 for them and a €1,926,361.32 ambiguous total — the
same 087 effect as §5.3.

Before this rule the analysis reported **91 side-pairs / 94 eviction entries / €41,037,504.24**.
Three separate errors, all in the over-stating direction, all now closed:

1. the N:M fan above (16 losing-side rows that no longer move);
2. `evictions` listing a row **once per side-pair** rather than once — 94 entries for 90 distinct
   rows, a €1.24m over-statement *inside the verification meant to make eviction trustworthy*;
3. §5.5's annex figure counting eviction entries rather than annex rows.

### 5.4 The 5 blocked side-pairs — the whole list

Every one is small, and each is a `ACCEPTED_CONFLICTS`-style entry needing one line of human
judgement, not a rule:

| УНП | Winner | Loser | Matched | Why blocked |
| --- | --- | --- | ---: | --- |
| `02023-2023-0001` | aop:118779 (1 row, €4,136,628) | eop:118827 (2 rows, €6,050,568) | 1 | supplier sets differ; the eop side carries an extra row. This is the pair the `f:` net orphaned once (see `content_key.ts:108`) |
| `00303-2020-0018` | aop:317 (2 rows, €105,839) | eop:127135 (1 row, €105,837) | 1 | same supplier set, but only 1 of the winner's 2 rows is matched — fails (3) |
| `00994-2016-0001` | aop:2 (2 rows, €127,823) | rop:2 (1 row, €63,911) | 1 | same set, row counts differ; aop holds two call-offs |
| `00994-2016-0001` | aop:3 (3 rows, €68,172) | rop:3 (1 row, €25,565) | 1 | supplier sets differ |
| `00640-2015-0014` | aop:80-09-73 (2 rows, €7,136) | rop:80-09-73 (1 row, €6,607) | 1 | supplier sets differ |

Winner/loser follow §5.1 precedence (`aop` outranks both `eop` and `rop`), so in every one of the
five the **aop side is the survivor** and nothing is removed. Note `00303-2020-0018`: the two sides
agree on the supplier set *and* on the total to within €2, and it is still blocked — because only
one of aop:317's two rows has a twin, and evicting a side on a partial match is the shape that
orphaned rows in v1.

### 5.5 Consequence the design must carry: 16 orphaned annex rows

`procurement_annexes.contract_key` references `contracts.key`. The 74 evicted rows carry **16**
`procurement_annexes` rows across 9 contract keys between them. `db:load:annexes:pg` re-resolves against `contracts`, so
re-running it after the pass repairs the link set — **but it must be run, and nothing runs it
automatically on the cloud side** (CLAUDE.md already records this for `procurement_annexes`).

This is a hard ordering constraint, not a nicety: a skipped annexes reload leaves 16 annexes
pointing at rows that no longer exist, which silently drops them from the per-annex breakdown and
the чл.116 ал.2/ал.3 labelling on those contract pages.

---

## 6. Tiers

### T0 — the committed measurement harness (do this first, it is the deliverable everything else is checked against)

`scripts/procurement/measure_cross_source.ts`, read-only, no `--apply` path. Emits §1.1 (lattice),
§2.1 (detector gap on identity A), §2.2 (aop+rop relation breakdown), §3.1 (survivor-block rate),
§4 (date grading), §5.1 (precedence evidence), §5.3 (eligibility) and §5.5 (annex impact).

Why it is T0 and not documentation: v1 §6 already records that the first draft's numbers were wrong
because a *lookalike* implementation of `canonicalEik` was used instead of the real one. The same
applies here — this harness must import `content_key.ts`'s real helpers and read the real shards,
so the plan's numbers cannot drift from the code's behaviour. It also gives §7's production step a
way to measure Cloud SQL with the same code that measured local.

Gate: `measure_cross_source.test.ts` asserts the harness's identity-E group count equals what the
reconciliation pass proposes, so the two can never disagree silently.

### T1 — widen the identity in `content_key.ts`

Add a feed-rank function. Pure addition:

- `feedOf(r): 'ocds' | 'aop' | 'eop' | 'rop'` and `feedRank()`, replacing `isEopSourced` at its call
  sites. `isEopSourced` stays exported (other callers) but stops being the precedence primitive.
- `evictSupersededEopTwins` is **not** modified and **not** widened. It runs at parse time, where the
  УНП does not exist (v1 §10.1 — the law of this pipeline). It keeps doing its narrower parse-time
  job. The generalisation lives in the pass.

**The `e:` content net this tier originally specified is NOT added — it would be dead code.**
`contentKeys()` already emits `u:` = `(unp, contractor, rounded €)`, which is identity **C**.
Identity E is that plus a signing date, i.e. strictly *narrower*, and the nets are a union ("the
same contract when ANY key collides") — so two rows agreeing on E necessarily already collide on
`u:`, and an `e:` net can never add a match. Rather than write the net and rely on the reasoning,
`content_key.test.ts` asserts the containment as a property, so tightening `u:` fails loudly
instead of silently making the "no `e:` net" comment false.

The two identities live at different layers on purpose: `contentKeys()` is the permissive
**parse-time** matcher (where the OCDS export has no УНП at all), identity E is the strict
**post-backfill** one used to decide deletions. Permissive matching and safe removal are different
jobs — which is exactly why the parse-time eviction carries a separate survivor precondition.

Unit tests: six pairs × {should match, should not match}, plus the negative cases that killed
earlier designs — two contracts of one procedure to one supplier at the same amount on *different*
days must not match; two lots at the same amount on the same day to *different* suppliers must not
match.

### T2 — rewrite the pass's stage 2 on identity E and side-pairs

In `reconcile_cross_source.ts`:

- Replace the `eop` / `auth` split with a full feed partition and §5.1 precedence.
- Build twin pairs at identity E, lift them to side-pairs, apply the three §5.2 preconditions.
- **Replace `contractOf()` as the survivor check.** It is the defect (§3.1) and keeping it blocks
  everything. The survivor of an evicted row is, by construction, its identity-E twin on the winning
  side — assert *that*, by name, per row.
- Keep the УНП-coverage preflight unchanged; it is what stops the pass running before
  `backfill_unp.ts` and it is orthogonal to this change.
- Blocked side-pairs are printed in full, always, with the reason (§5.4's five today) — never
  summarised to a count.

Stage 1 (the identity bridge) and stage 3's structure are unchanged.

### T3 — the validation protocol (mandatory; the pass may not write without it)

Extends v1 §10.3 with the checks that would have caught this plan's own defects:

1. **Pairs, never counts.** Every eviction printed as `evicted → survivor`, both fully identified
   (`unp`, `contract_id`, `contractor_eik`, `amount_eur`, `date_signed`, `release_id`).
2. **Every evicted row has a named identity-E twin that survives.** Assert over the *written*
   corpus, not over the candidate list — v1 §10.8 shipped a dead assertion that filtered a list
   provably emptied earlier, and it could never fail.
3. **No procedure loses its last row.** `(unp, tag)` — **not** `(unp, contract_id, tag)`. The whole
   point of identity E is that the losing `contract_id` legitimately disappears; asserting on it
   re-creates the §3.1 blindness as a false alarm.
4. **Corpus delta equals Σ evicted, to the cent.**
5. **Row-count delta equals the eviction count.**
6. **Per-contract totals still reconcile to the published value where known.**
7. **NEW — a non-zero-work assertion.** The pass must fail when it finds candidates and evicts none
   of them, unless every block is on the allowlist. This is what would have surfaced §3.1 the day it
   started happening instead of leaving a green "✓ verification passed" over a no-op.
8. **NEW — annex accounting.** Report how many `procurement_annexes` ROWS the eviction set orphans
   (16 today, across 9 contract keys — count the annex rows, not the evictions) and print the
   follow-up command. Not a failure — a required, visible consequence.
9. Exit non-zero **before** writing on any violation.

`--dry-run` is the default and must stay so.

### T4 — move the gate to the full matrix and identity E, in one commit

`single_source_per_contract.data.test.ts`:

- Feed classification becomes the four-way `feedOf`, and the `HAVING` becomes "≥2 distinct feeds",
  covering all six pairs.
- **The group key becomes identity E**, for the reason in §2.2. Keeping identity A and widening only
  the feed model adds ~124 non-duplicate entries.
- **Retain identity A as a second, separate test** reporting `aop+rop` contract-number collisions as
  *informational* with a documented expected count (124 today), so the population stays visible and
  a genuine change in it is noticed. It must not gate on zero.
- The `ACCEPTED_CONFLICTS` allowlist keeps its exhaustive-AND-minimal property. After T2 it holds
  the existing 6 plus §5.4's 5, each with a one-line reason.
- Per-pair tests: one fixture per pair, six pairs, each asserting the detector fires. `aop+ocds` and
  `aop+rop` fixtures are the important ones — they are what the two-feed model could never see.

### T5 — run it, locally

```bash
npx tsx scripts/procurement/measure_cross_source.ts            # baseline, keep the output
npx tsx scripts/procurement/reconcile_cross_source.ts          # dry run — expect 73 pairs / 74 rows / €36,342,099.72
npx tsx scripts/procurement/reconcile_cross_source.ts --apply
npm run proc:rebuild-derived                                   # = rebuild_from_cache.ts
npm run db:load:pg
npm run db:load:annexes:pg                                     # §5.5 — repairs the 41 orphaned links
npm run db:load:procurement-scopes:pg
npm run db:load:persons-browse:pg && npm run db:load:person-search:pg && npm run db:load:graph:pg
npx vitest run scripts/db/tests/
npx tsc -b
```

`db:refresh` already sequences `proc:backfill-unp:apply → proc:reconcile:apply →
proc:rebuild-derived → db:load:pg → db:load:annexes:pg`, so the wiring needs no change — verify
that, do not assume it.

Expected: 405,711 → 405,637 rows; €99,244,771,522.10 → €99,208,429,422.38.

**Do not proceed to T6 if any per-contract total stops reconciling.**

### T5 — DONE (2026-08-04)

Applied. 74 rows evicted from 188 shards, €36,342,099.72, verification green.

| | before | after |
| --- | ---: | ---: |
| shard rows | 405,711 | **405,637** |
| Postgres rows | 408,357 | **408,282** |
| Postgres € | 99,244,771,522.10 | **99,208,429,422.38** |
| `index.json` `totals.totalEur` | 93,296,698,129.89 | **93,260,356,030.17** |

The committed `index.json` headline fell by **exactly €36,342,099.72** — the eviction total to the
cent, which is the reconciliation the plan asked for. Postgres dropped **75** rows, not 74: the
74 evicted plus one synthetic `obed-` carrier (2,646 → 2,645), because 087 rebuilt a consortium
whose member set changed. That is the predicted 087 interaction, not a discrepancy.

Chain run: `proc:rebuild-derived` (405,637 contracts) → `db:load:pg` (419 s) →
`db:load:annexes:pg` (18,785 contracts matched, 31,743 annex rows — the 16 orphaned links
re-resolved) → `db:load:procurement-scopes:pg` (6/6 matviews) → `persons-browse` → `person-search`
→ `graph`.

**Steady state confirmed on the served corpus**: re-measuring finds **0 eligible evictions**, with
only the 5 permanently-blocked side-pairs and 7 ambiguous groups outstanding — so the pass is
idempotent against its own output, as `cross_source.test.ts` requires.

Verification: **550 data gates pass** (8 skipped), 3,009 unit tests pass, `tsc -b` clean.
`pg_roundtrip.data.test.ts` (the lossless-capture invariant) and `invariants_pg.data.test.ts` (the
consortium carrier/member invariant) both green.

**Three committed artifacts the rebuild chain did not cover**, found by review, all corpus-derived
and all invisible to those 550 gates:

- `derived/cpv_competition.json` was written only by `ingest.ts` and the two dedup passes — never
  by `rebuild_from_cache.ts`. So any pass that changes the shards without re-ingesting left it
  stale; after the eviction it was off by 64 contracts across 17 CPV divisions. **Fixed
  structurally**: `rebuild_from_cache.ts` now builds it, so "rebuild the derived tree" means all
  of it.
- `derived/hub_stats.json` and `derived/sector_stats.json` are Postgres-derived and
  bucket-deployed, and have **no generator in this chain or in `db:refresh`**. Regenerated by hand
  here (`db:gen-hub-stats` / `db:gen-sector-stats`), so the committed artifacts are current.

  **They were NOT wired into `db:refresh`, and that is deliberate — the obvious wiring is unsafe.**
  T7 tried it and review caught two blockers, both verified:

  1. **Placement.** They read `tenders`, `awarder_seats`, `agri_payloads` and `ngo_funding`, which
     `db:refresh` loads at steps 9, 14, 13 and 21. Inserted after the annexes load (step 7) they
     would regenerate 5 of `hub_stats`' 9 fields, plus the agri payout, from the PREVIOUS vintage
     and commit it — reproducing the drift the wiring was meant to end. The earliest safe position
     is after `db:load:ngo-funding:pg`.
  2. **`062_procurement_hub_counts.sql` has no applier anywhere in the repo.** `hub_stats.ts` calls
     `procurement_hub_counts()` and exits 1 on error, so on a fresh clone `db:refresh` would die at
     that step instead of skipping-and-warning — breaking the fresh-clone contract CLAUDE.md
     states for every gitignored-input loader.

  Wiring them needs (1) the later position, (2) an applier for 062, and (3) skip-and-warn on a
  missing dependency. That is its own change, not a line in this one.

  **DONE (2026-08-04), as that separate change.** Both are now in `db:refresh`, inserted directly
  after `db:load:ngo-funding:pg` — the earliest safe slot per (1). Re-running each against the
  post-reconcile database reproduces the hand-generated artifacts **byte-for-byte**, so the wiring
  is behaviour-preserving and the two files are now maintained by the chain rather than by memory.

  On (2): `062_procurement_hub_counts.sql` is applied by `hub_stats.ts` itself, which is its only
  caller. Its `GRANT … TO app_readonly` had to be **role-guarded** first (the 117/130 shape) —
  `roles_readonly.sql` is a one-time manual step no loader runs, so on a cold bootstrap the
  unguarded GRANT raises 42704, and since `exec()` sends a migration as ONE implicit transaction
  that rolls the whole file back, leaving no function at all. An unguarded applier would have
  *introduced* the fresh-clone abort it was added to prevent.

  On (3), a **third blocker** surfaced that the T7 review had not found, and it was the worst-shaped
  of the three: `sector_stats.ts` reads eight ПРБ node files from `data/budget/ministries/`, which
  is **gitignored** (`.gitignore:263`) — and it read them at MODULE level, so on a fresh clone the
  ENOENT fired at IMPORT time, before `main()` could preflight anything. No amount of in-`main`
  skip-and-warn would have caught it. Those reads are now behind a skip-shaped guard.

  Both generators now preflight relations, functions and row-population, and **return before
  writing** rather than degrading the payload — a partial artifact (all-zero counts from an empty
  corpus, or a `sector_stats.json` missing its eight budget-basis sectors) would overwrite a good
  served file with a worse one and reconcile against nothing. Verified against a scratch database
  across five states: no relations, TR-tables-only missing, present-but-empty `contracts`, absent
  ministries tree, and fully loaded. Every skip exits **0** and leaves the committed file untouched.

  **The gate question, answered.** `db:gen-*` targets were NOT in `refresh_coverage.test.ts`'s
  scope, and widening its regex to the whole prefix would be the wrong fix: seven of the nine
  `gen_procurement/` entries are sql-migration-v1 **parity verifiers** that write nothing unless
  `--write` is passed, and they are correctly outside the chain. The honest axis is "writes a
  committed artifact from Postgres", now `REFRESH_GENERATORS` in `scripts/db/refresh_coverage.ts`.
  Three new assertions: every registered generator is in `db:refresh`; its declared artifact is
  git-tracked and referenced by its source; and — the hole-closer — **every** `db:gen-*` script is
  either registered or carries the verifiers' exact `process.argv.includes("--write")` gate, so a
  new generator cannot quietly land outside the chain the way these two did. Both new invariants
  were confirmed to go red when violated.

**One behavioural note worth recording.** The month rollups key on the release `date`, while
identity E keys on `date_signed`. The two differ for retro-published contracts, so evicting a row
can move money between rollup YEARS even though the corpus total falls by exactly the eviction sum.
That is correct — the surviving row's own dates are authoritative — but it means a year-over-year
rollup comparison across this change will not net to zero per year, only overall.

### T6 — production

Production still carries its own cross-source duplication, and the `db:load:pg:cloud` that would
have carried a fix was **deliberately aborted mid-flight** when it was found to be about to delete
38 legitimate rows. Nothing was lost; nothing has been fixed there either.

**Measure Cloud SQL before writing to it.** Prod's corpus vintage differs from local's, so §5.3's
**73 side-pairs / 74 rows / €36,342,099.72 (shards) — €35,830,807.84 as served** is a LOCAL number
and must not be assumed to transfer:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/procurement/measure_cross_source.ts --read-only
```

The pass itself rewrites **shards**, not SQL (`pg_roundtrip.data.test.ts` asserts Postgres is a
lossless capture of the shards), so there is no `reconcile:cloud`. Production receives the fix
through the ordinary contracts reload, which is **~68 min and CPU-bound on `db-g1-small`**:

```bash
npm run db:load:pg:cloud                        # ~68 min
npm run db:load:annexes:pg:cloud                # §5.5 — MUST follow; nothing runs it automatically
npm run db:load:procurement-scopes:pg:cloud     # 119+122+123+124 read contracts; minutes, not the local 46 s
npm run db:load:persons-browse:pg:cloud         # public_money_eur is computed from contracts
npm run db:load:person-search:pg:cloud          # its money arm
npm run db:load:graph:pg:cloud                  # 127's money basis
```

Then re-run the data gates against the cloud target and confirm the same corpus delta.

Ordering notes that are load-bearing, from CLAUDE.md:

- `db:load:annexes:pg:cloud` must run **after** the contracts corpus is loaded. Skipping it leaves
  prod's per-annex breakdown stale while local is current — the classic "green locally, stale on
  prod" class.
- `db:load:procurement-scopes:pg:cloud` refreshes 119/122/123/124. `procurement_settlement_payloads`
  (123) and `procurement_payloads` (124) degrade to the live aggregate when unbuilt, so they will
  serve *correct but slow* answers in the window between the reload and the refresh; 122
  (`contractor_rank`) does **not** degrade, so `/procurement/contractors` is the page to watch.
- `db:load:graph:pg:cloud` must follow `db:load:persons-browse:pg:cloud`.

**Abort criterion, stated in advance.** If the cloud measurement proposes evictions materially
beyond what the shard state predicts, stop and re-measure — that is exactly the signal that saved
38 rows last time.

### T6 — DONE (2026-08-04)

Read-only measurement first, as specified. Prod carried **77 eligible side-pairs / 78 rows /
€36,160,319.62** — close to local's 73/74/€36.34m and well inside the abort criterion. Its
ambiguous set held one group local did not: `00233-2023-0103` (€903,145.98), the exact contract v1
§9 named as a prod-only double-count.

| | before | after |
| --- | ---: | ---: |
| prod rows | 408,227 | **408,282** |
| prod € | 99,239,146,255.71 | **99,208,429,422.38** |

Matching the local corpus of the same vintage to the cent. Post-load verification: **0 eligible
evictions**, **0 orphaned annex rows**, and the same 7 ambiguous + 5 blocked as local.

**The first attempt failed and it is worth recording why it was a non-event.** After ~18 minutes
the connection dropped mid-merge (`Connection terminated unexpectedly`). Prod was untouched —
`contracts_stage` held all 405,637 rows, the merge transaction rolled back, and the served corpus
stayed at 408,227. Diagnosis before retrying rather than a blind retry: the Cloud SQL proxy had
been up 6 days, the instance 4 days, and `statement_timeout` /
`idle_in_transaction_session_timeout` / `tcp_keepalives_idle` were all `0` — so no server-side
timeout could have caused it and it was not deterministic. The retry succeeded in 5,380 s (~90 min).

The staging design is what made a mid-flight drop survivable: the COPY lands in an UNLOGGED stage
table that nothing serves, and only the final merge is transactional against `contracts`. A
TRUNCATE-and-reload would have left prod empty for those 18 minutes and broken there.

Chain run after the load: `db:load:annexes:pg:cloud` (18,580 contracts / 24,106 annex rows —
0 orphans left), `persons-browse` (118,668), `person-search` (531,340), `graph` (162,567 edges).
The two T8a serving-path fixes were applied separately and are live: `recent_updates(1, 200)` is
**0.59 s warm** on prod (a first call right after the reload reads 9.3 s on a cold buffer cache),
and `idx_person_role_ref` is present.

**Prod is now one vintage behind local, and deliberately not chased.** While T6 ran, a separate
change landed two annex-fold divisor fixes (`8bcb6fa112`, `dc8fcb678d`) that repaired `amountEur`
on the shards and moved local to 405,720 shard rows — retiring 4 of the 12 accepted conflicts,
because corrected values let the reconcile pair three of them. Prod carries the pre-fix vintage:
coherent, strictly better than what it had, and ~3 duplicate rows behind local. Publishing that is
another ~90-minute reload and a separate decision, not a silent follow-on.

### T7 — wiring

- `db:refresh` — already correct; verify.
- `update-procurement` watch skill — must run the pass after any ingest, or the corpus regains
  mixes. Already recorded in v1 §10.5; confirm it survived.
- CLAUDE.md — add the annexes-after-reconcile ordering (§5.5) to the `procurement_annexes` section.

---

## 7. Non-goals and deferred work

### 7.1 Non-goals

- **No auto-resolution of genuine conflicts.** Two public sources naming different counterparties is
  not a scripting problem. The 5 blocked side-pairs go to the allowlist with a reason each.
- **No SQL-side deletion.** Breaks `pg_roundtrip.data.test.ts`'s lossless-capture invariant.
- **No change to the `c:` / `f:` / `p:` nets.** They serve the parse-time eviction, which this plan
  does not touch. Tightening `c:` reduces evictions and could *increase* double-counting — a
  separate, measured change.
- **No re-crawl.** Everything needed is on the shards.
- **No widening of `evictSupersededEopTwins`.** It runs where the УНП does not exist.

### 7.2 Explicitly not attempted

- **The >3-month tail (97 groups / €85.8m).** §4. Identity E excludes it by construction.
- **The 1–3 month band (26 groups / €16.0m).** Revisit only after E has settled.
- **The 1–7 day (5 groups / €0.68m) and 8–31 day (18 groups / €6.04m) bands.** Identity E excludes
  both — they are defensible duplicates by v1 §11.5's reading, but reaching them needs a
  date-tolerance parameter, which is a new degree of freedom and therefore a separate, measured
  change. Recording the omission rather than smuggling it in: this plan leaves **23 groups /
  €6.71m** of probable duplicates on the table, deliberately.

### 7.3 Backlog, dated

- **2026-08-04 — the two АПИ tail cases.** `00044-2023-0015` (€58.5m, 124-day gap) and
  `00044-2023-0029` (€8.5m, 268-day gap) are €67.0m of the €85.8m tail between them. Examine by
  hand against the published notices before any rule is contemplated.
- **The bridge is a no-op** until the next re-ingest (§3.1). Worth a note in
  `person_eik_bridge.json` so a future reader does not read "bridged 0 rows" as a failure.

---

## 8. Defect 4 — the flaky data tests — CLOSED

The brief names `company_public_money.data.test.ts` and `person_connections.data.test.ts` and
suspects parallel-Postgres races. **Four full `npx vitest run --project node` runs and several
isolation runs say the picture is different**, and the difference changed the fix in every case.

**Outcome: not one of the four was a race.** Two were production defects on serving paths, one was
a broken measuring instrument, and one never reproduced. The suite now runs clean in 67.4 s with
zero lock waiters.

| Item | Verdict |
| --- | --- |
| `search.data.test.ts` | `recent_updates()` over the 10 s prod timeout at default params — fixed (§8.2a) |
| `officials_redirect.data.test.ts` | missing `person_role(ref)` index, 74 s anti-join — fixed (§8.2a) |
| `person_connections.data.test.ts` | buffer parser scored cache hits only — fixed (§8.2b) |
| `company_public_money.data.test.ts` | did not reproduce in 4 runs — no change (§8.2c) |
| lock contention (12 waiters) | 0 after the above, but cause NOT established — deferred (§8.3) |

### 8.1 What actually happened

| Run | Failures |
| --- | --- |
| Full run 1 | `officials_redirect` (timeout, file 148,322 ms) · `search` (timeout, file 178,903 ms) · `person_connections` (assertion) |
| Full run 2 | `search` (timeout, file 170,043 ms) |
| 8-file targeted concurrent run | none |

`company_public_money.data.test.ts` **passed in 2 of 2 full runs** and in isolation. It did not
reproduce.

Isolation timings, against a **120,000 ms per-test timeout**:

| File | Isolation duration | Tests |
| --- | ---: | ---: |
| `search.data.test.ts` | **134,880 ms** | 8 |
| `officials_redirect.data.test.ts` | **88,620 ms** | 7 |
| `person_connections.data.test.ts` | 2,557 ms | 9 |
| `company_public_money.data.test.ts` | fast | 3 |

Resource measurements during a full run (2 s sampling of `pg_stat_activity`):

- **Peak connections 19**, against `max_connections = 100`. Connection exhaustion is **refuted** —
  which matters, because 95 data-test files each opening a `Pool({max: 8})` under 11 vitest workers
  makes exhaustion the obvious first hypothesis, and it is wrong.
- **Peak 12 concurrent sessions blocked on a `Lock`**, sustained across many samples.

### 8.2 Triage — three different defects, not one race

**(a) `search` and `officials_redirect` were a duration-budget problem, not a race — and both
turned out to be real query defects.** They consumed 112% and 74% of the per-test timeout *with the
machine otherwise idle*, so any contention pushed them over. **FIXED at source; no timeout was
raised.**

| | before | after |
| --- | ---: | ---: |
| `search.data.test.ts` | 134.9 s | **16.0 s** |
| `officials_redirect.data.test.ts` | 88.6 s | **1.1 s** |

Two defects, both on live serving paths:

1. **`recent_updates()` (007) took 13–14.7 s** — over Cloud Run's 10 s `statement_timeout`, on a
   function served by `functions/db_routes.js`. Two causes, found by `EXPLAIN (ANALYZE, BUFFERS)`:
   its five UNION branches had no per-branch limit, so 1,688,150 rows were materialised to
   top-N-sort 5,000; and the `ingest_first_seen` branch joined `changelog_days` on
   `first_seen_at::date`, an expression no index serves, so the planner drove *from*
   `changelog_days` and probed once per day (212 loops × ~60 ms, 16.8M buffers). Pushing
   `ORDER BY … LIMIT lim` into each branch and turning the changelog join into an `EXISTS` (it
   contributes no output column) gives **13.61 s → 0.15 s at the route's default (days=1,
   limit=200)** and **14.05 s → 1.34 s at its ceiling (3650, 1000)** — `db_routes.js` clamps
   `limit` to 1–1000, so those are the shapes that actually matter. Row counts identical.
2. **`person_role` had no index on `ref` alone** — only `(source, ref)`, which cannot serve
   `WHERE ref = $1`. `officials_person_slug()`'s retired-slug anti-join therefore scanned the whole
   index per probe: 23,916 probes × 3.1 ms = **74 s and 62.1M buffers**. `idx_person_role_ref`
   takes the same query to **104 ms** — a 725× improvement, and the plain "index both sides of the
   join key" rule.

**Reaching production, corrected.** An earlier draft of this line said "nothing ships to Cloud SQL
automatically"; that is wrong in both halves. `007_query_builders.sql` **does** ride
`db:load:tr:pg:cloud` (`load_tr_pg.ts` applies it), so the `recent_updates` fix reaches prod on the
next TR load. `081_person_identity.sql` is applied by `db:resolve:persons:cloud`, a multi-hour
rebuild. Neither should be waited on — both files are idempotent (`CREATE OR REPLACE` /
`CREATE INDEX IF NOT EXISTS`, no destructive DDL), so ship them directly:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 007_query_builders.sql 081_person_identity.sql
```

Until that runs, prod keeps serving the 13.6 s `recent_updates` body at its default parameters.

**(b) `person_connections` — SOLVED, and it was not a race.** The control body's collapse to 29
buffers had one cause: the buffer parser. `EXPLAIN` prints the pool keyword once per group —
`Buffers: shared hit=3684 read=7545` — and the regex was `/shared (?:hit|read)=(\d+)/`, which
matches `shared hit=` but not the bare `read=` that follows. So it scored only what was **already
cached**, which is exactly why it was load-dependent: the same body read 3,684 on a warm cache and
a handful once other tests had churned `shared_buffers`, passing alone and failing in a full run.
Two further traps in the same parser: zero-valued counters are omitted entirely (a fully-cached
plan prints no `read=`, a cold one no `hit=`), and planning buffers are not execution.

Fixed by extracting `sumExecutionBuffers` into `scripts/db/lib/explain_buffers.ts` with its own
test, shared by both buffer-ceiling gates that had carried the same copy-pasted defect. The
assertion that fired was correct and doing its job — it caught a broken measuring instrument, which
is what a discriminator check is for.

**(c) `company_public_money` — did not reproduce, no change made.** Four full runs, zero failures.
The concurrent-`REFRESH` story was a hypothesis, never evidence, and a fix for a defect that cannot
be reproduced is a change with no test.

### 8.3 The lock contention no longer reproduces — DEFERRED, not explained

The measured symptom was **12 concurrent sessions blocked on a Lock** at only 19 connections, and
§8.3 originally proposed serialising the two tests that hold `CREATE OR REPLACE FUNCTION` inside an
open transaction. Re-measured after T8a:

| | before | after |
| --- | ---: | ---: |
| peak lock waiters | 12 | **0** |
| peak connections | 19 | **9** |
| full `--project node` run | 179.7 s | **67.4 s** |
| failures across runs | 3, then 1 | **0, twice** |

**No change was made, and the cause is NOT established.** A first draft of this section claimed the
cause was run duration — that `search` and `officials_redirect` held the run open for ~3 minutes and
a long run is a long window for two files to overlap — and concluded the DDL pattern was therefore
never the cause. That argument does not hold, and it is worth recording why, because it is the same
mistake this whole plan is about:

- **It confuses necessary with sufficient.** Contention needs a held lock *and* a concurrent waiter.
  "The DDL pattern is unchanged, so it was never the cause" proves only that the pattern is not
  sufficient alone — exactly as true of duration.
- **The magnitude is unexplained.** A 2.7× shorter run does not predict 12 → 0 on any
  overlap-probability model. If the real mechanism was a lock convoy, the DDL pattern *is* causally
  essential and the remedy will be needed again the next time anything is slow.
- **§8.1 never recorded WHICH object the 12 were waiting on.** The two DDL-holding tests replace
  *different* functions, so they cannot block each other — meaning the DDL pattern may not have been
  the source at all. The other candidate, recorded in §8.1 and worth keeping: four more files hold
  rolled-back `UPDATE person` row locks.
- And §8.2c, fifteen lines up, refuses the concurrent-`REFRESH` hypothesis as "a story, not
  evidence". Accepting a duration story on one post-hoc negative applies a weaker standard to the
  conclusion that suits.

So the honest state is: **it no longer reproduces, and nothing was changed to make that true.**
Deferred with a named revisit trigger — **if any data test creeps back over ~30 s, re-measure lock
waiters AND capture the blocked object (`pg_locks.locktype`, `relation`, `objid`) before drawing a
conclusion.** That is the datum §8.1 lacked, and without it neither hypothesis can be settled.

--- | ---: | ---: |
| peak lock waiters | 12 | **0** (79 samples, none non-zero) |
| peak connections | 19 | **9** |
| full `--project node` run | 179.7 s | **67.4 s** |
| failures across runs | 3, then 1 | **0, twice** |

The DDL-in-an-open-transaction pattern is unchanged — so it was never the cause on its own. The
cause was **duration**: `search` and `officials_redirect` held the run open for ~3 minutes, and a
long run is a long window for two unrelated files to overlap on the same function. Cutting them to
16.0 s and 1.1 s collapsed the window, and with it the contention.

Worth stating plainly because the instinct was to serialise the tests: the fix for lock contention
here was to make the *unrelated* queries fast, not to add coordination. Serialising would have hidden
the two production defects that were actually generating the load.

---

## 9. Order of work

| Tier | Depends on | Ships |
| --- | --- | --- |
| **T0** measurement harness | — | read-only; safe to land alone |
| **T1** identity in `content_key.ts` | T0 | pure addition, inert until T2 |
| **T2** pass stage 2 on identity E | T1 | dry-run only until T5 |
| **T3** validation protocol | T2 | same commit as T2 |
| **T8a** the two slow tests | — | independent; lands before T5 |
| **T5** local run | T2, T3 | writes shards |
| **T4** gate: full matrix + identity E | T5 | **must be one commit** (§2.2) |
| **T7** wiring / CLAUDE.md | T5 | docs |
| **T6** production | T4 green | ~68 min + dependents |
| **T8b/c** remaining flaky work (§8) | — | independent |

**T4 runs AFTER T5, not before.** The widened gate asserts the post-reconcile state, so it is red
until T5 applies the pass. Applying first and then widening keeps every commit green and loses
nothing: the gate's job is to lock the achieved state and catch regressions, which it does either
way. (An earlier draft of this note also claimed T5 would break the existing gate's
minimal-allowlist assertion by resolving some of its 6 entries. It did not — all 6 are still live
against the post-T5 database and that gate passes untouched. The reordering stands on the first
reason alone.)

§8 is deliberately independent: it gates nothing here, and blocking a €38m correctness fix behind a
test-infrastructure investigation would be the wrong trade. But T5's `npx vitest run
scripts/db/tests/` needs a suite whose failures are trustworthy, so **§8(a) should land before T5**
— the two timeout-prone files are the ones most likely to fire spuriously during verification and
send someone hunting a reconciliation bug that is not there.
