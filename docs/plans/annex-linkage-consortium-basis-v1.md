# Annex → contract linkage: the consortium basis mismatch — v1

**Status:** INVESTIGATION COMPLETE, harness landed, fix NOT implemented. No rows changed.
**Measured:** 2026-09-03 against local Postgres `postgres://postgres@127.0.0.1:5433/electionsbg`
(407,125 `tag='contract'` rows) and against the month shards (404,438 rows), over an annex cache of
1,581 published day-files / 27,382 value-records.
**Harness:** [`scripts/procurement/measure_annex_linkage.ts`](../../scripts/procurement/measure_annex_linkage.ts)
— read-only, no `--apply`, every number below is one command.
**Touches:** [`scripts/procurement/lib/annexResolve.ts`](../../scripts/procurement/lib/annexResolve.ts),
[`scripts/db/load_annexes_pg.ts`](../../scripts/db/load_annexes_pg.ts),
[`087_procurement_consortium.sql`](../../scripts/db/schema/pg/087_procurement_consortium.sql).

---

## 0. Executive summary

`lib/annexResolve.ts`'s header states that a second, divergent notion of "this contract's annexes"
would be worse than none. **That is the current state, and it is measurable.** One annex cache, one
resolver, two callers, two answers:

|                                                | annex records linked | contract source |
| ---------------------------------------------- | -------------------: | --------------- |
| `anexi_current_value.ts` — the value fold      |   **25,489** (93.1%) | month shards    |
| `load_annexes_pg.ts` (114) — the annexes table |   **24,436** (89.2%) | Postgres        |

**1,063 annex records are folded into `contracts.amount_eur` and absent from
`procurement_annexes`.** 10 go the other way.

**One root cause, two symptoms.** `perSupplier()` divides the annex's FULL published value by the
supplier count, because the SHARD convention is a per-supplier split (`normalize_eop` divides by
`validSupplierCount`). `rebuild_consortium()` (087) runs INSIDE Postgres after the load and UNDOES
that split. So `load_annexes_pg.ts` hands the resolver rows in a basis it was not written for, and
the guards refuse them:

| symptom                                               |          records | signature                                                                                                      |
| ----------------------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------- |
| **A.** continuity guard refuses the value-holding row | +133 over shards | `signed/anchor` is an exact INTEGER: 196 at ×3.00, 82 at ×4.00, 39 at ×2.00 — that integer IS the member count |
| **B.** every candidate row is a zeroed member         |              804 | 087's `obed-` carrier holds the value under a SYNTHETIC EIK the annex feed can never publish                   |
| (C.) annex carries no proper УНП                      | +115 over shards | downstream of A/B — the K1 fallback is what these rely on, and it fails for its own reasons                    |

The consortium arm of the corpus is effectively annex-blind. Measured per contract row:

| row kind                |    rows |      with annexes |
| ----------------------- | ------: | ----------------: |
| plain                   | 391,690 | 19,024 (**4.9%**) |
| consortium value-holder |   1,352 |      8 (**0.6%**) |
| `obed-` carrier         |   2,687 |      2 (**0.1%**) |
| zeroed member           |  11,396 |                 0 |

15,435 consortium rows carry **10** annex links between them. At the plain-row rate they would carry
roughly 750.

⚠️ **The residue is not the harmless tail.** 33.6% of unlinked records move the price, against 30.6%
of the cache — the unlinked population is slightly MORE price-moving than average, so "the annexes we
lose are the administrative ones" is false.

**What is NOT wrong.** The contract-number namespace divergence — the annex feed publishing an
internal ЦАИС number (`148846`) where the contract feed publishes the buyer's own registry number
(`Д-226`) — is real in our corpus and costs us nothing, because K2 (`УНП` + supplier EIK) is tried
first and never requires the two to agree. §3 of the harness keeps that measured rather than
asserted: 1,525 unlinked records have a contract number that DOES match, against 923 that do not, so
the number axis is not our bottleneck. Do not "fix" it.

---

## 1. Reproduction

```bash
npx tsx scripts/procurement/measure_annex_linkage.ts
```

Both sources plus the divergence. `--source=pg` / `--source=shards` isolate one; `--json` for
machine-readable output; `--source=shards` needs no database at all. Against Cloud SQL, still
read-only:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/procurement/measure_annex_linkage.ts --source=pg
```

**The harness drives from the ANNEX side, which neither consumer does.** Both consumers iterate
CONTRACTS and ask "does this contract have annexes?", so an annex no contract claims is not an error
anywhere — it is simply absent, with every row count reconciling. That is why this defect survived:
there is no place in the pipeline where it can be observed.

The worked example, reproducible by hand — УНП `01981-2020-0035`, contract № `23-00-96`, a
three-member consortium, annex pre-value 708,445.65 BGN = €362,222.52:

|                                   |   `signed` | anchor (`lastEurFull/n`) | guard 2                      |
| --------------------------------- | ---------: | -----------------------: | ---------------------------- |
| shard row (each of 3 members)     | 120,740.84 |               120,740.84 | ✅ passes, `amountEur` flips |
| Postgres value-holder `177443810` | 362,222.52 |               120,740.84 | ❌ −66.7%, refused           |
| Postgres members ×2               |          0 |                        — | ❌ `signed <= 0`             |

---

## 2. The mechanism — 087 has TWO carrier modes and both defeat the resolver

`rebuild_consortium()` splits joint awards into two shapes, and the resolver fails differently on
each. Measured over the 4,038 consortium contract groups:

| 087 mode                                                           | groups | member rows | who holds the value                  | how K2 fails                                                                                      |
| ------------------------------------------------------------------ | -----: | ----------: | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **named carrier** — the ДЗЗД/обединение member, lowest EIK on ties |  1,352 |       4,728 | a REAL member EIK, at the FULL value | the EIK matches, the divisor does not → symptom A                                                 |
| **synthetic carrier** — `obed-<md5(eikset)>` for unnamed consortia |  2,686 |       8,020 | a SYNTHETIC EIK                      | `obed-…` can never appear in the annex feed's supplier list → no K2 key exists at all → symptom B |

Both are correct as money: 087's transform is value-invariant (carrier-full + members-zero == the
prior split sum), and that invariance is exactly why nothing downstream reported the loss.

Everything a fix needs is already on the row — 087 declares `consortium_role`
(`'carrier' | 'member' | NULL`), `consortium_size` (N), `consortium_eik` (self on the carrier, a link
on members) and `consortium_full_eur`, plus a partial index on the member arm. **No new column and no
migration is required.**

---

## 3. What it costs a reader

`procurement_annexes` has exactly one serving consumer — `contract_annexes(key)` (114) →
`/api/db/contract-annexes` → `useContractAnnexes` → the `/contract/:key` per-annex breakdown and the
чл.116 ал.2 vs ал.3 labelling. So the damage is bounded and specific:

- On a consortium contract the page says the value moved (it reads `contracts.amount_eur`, which the
  shard-side fold got right) and then shows **no modifications that moved it**. The +50% cliff
  finding `docs/plans/procurement-risk-v2.md` §0b exists to publish — one annex at the cap, or
  several summing to it — is unanswerable there.
- **No money total is wrong.** Nothing in the risk cache, no rollup and no aggregate reads
  `procurement_annexes`; the corpus's current-value basis comes from the shard-side fold, which is on
  the correct divisor. This is a completeness defect, not a valuation one.
- `single_source_per_contract.data.test.ts` already treats an orphaned annex row as expected output,
  so the existing gates are silent on this by construction.

---

## 4. The fix

### Tier 1 — make the basis EXPLICIT (symptom A, +349 records projected)

Give `resolveAnnexKey` / `lookup` a `basis` option:

- `"split"` — the shard convention, `n = max(1, lastSupplierCount)`. **The DEFAULT.**
- `"full"` — the post-087 Postgres convention, `n = 1`.

`load_annexes_pg.ts` passes `"full"`; `anexi_current_value.ts` keeps the default and must not change
by a single byte.

Projected on the current corpus: **+349 records linked (309 of them on consortium rows, 132
price-moving)**, and the integer-ratio signature disappears from the harness's §2 continuity table.

⚠️⚠️ **THE DEFAULT MUST STAY `"split"`, AND THIS IS THE ONE STEP THAT CAN DO REAL DAMAGE.**
`anexi_current_value.ts` FLIPS `amountEur` in place across the whole corpus — the ~€2.2bn
current-basis move. A divisor change on that path silently rewrites every consortium contract's
published value by its member count, on the shards, which then load into Postgres and into every
rollup. Guard 2 would not catch it: it validates the anchor against `signingAmountEur`, and on the
shards both are already in the split basis, so a `n=1` anchor would refuse the match rather than
mis-value it — the loss would be silent and total instead of visible. The gate in §6 pins the
default.

### Tier 2 — reach the synthetic carrier through its MEMBER SET (symptom B, 804 records)

An `obed-` EIK is ours, not the register's, so no supplier-keyed index can hold it. On the `"full"`
basis only, when the contract row is `consortium_role = 'carrier'` with a synthetic EIK, resolve K2
against the carrier's MEMBERS instead of its own EIK: try `${unp}|${memberEik}` for each member of
`consortium_eik`, and **accept only when the answers agree** — one distinct accumulator, one contract
number. Members come from the sibling rows the loader already reads (`consortium_eik` +
`consortium_role = 'member'`), so this is a query widening, not a new source.

Two things must hold, and they are the reason this is a separate tier rather than part of Tier 1:

- **The member-set probe must REFUSE disagreement, not vote.** N members give N chances to find an
  accumulator; taking the first is how a member's OTHER contract under the same procedure gets
  attributed to this consortium. Same hazard the existing K2 ambiguity refusal exists for — one
  supplier holding several contracts under one procedure — with N times the surface.
- **Guard 1 must be evaluated against the MEMBER, never the carrier.** `normEik("obed-…")` is `""`,
  which makes `if (me && …)` skip the supplier check entirely — so today the carrier arm is running
  with guard 1 disabled. Widening K2 without re-arming it converts a refusal into a wrong
  attribution.

Projected yield is **not** estimated here on purpose: the 804 are refused before any guard runs, so
the harness cannot cost them without the probe existing. Measure after implementing, by re-running
the harness and reading §4 down toward zero.

### Tier 3 — the value-anchored third key: measured, and NOT recommended as it stands

A third key — the annex's pre-annex value equals a contract's signing value to the cent, uniquely
under that procedure — resolves **691 of the 2,946 unlinked records (23.5%), 218 price-moving**.

**Do not build it yet.** Only **43** of those 691 land on a real `signing_amount_eur`; the other
**648** match `amount_eur`, which on any contract the fold already flipped is the POST-annex value.
Matching a pre-annex figure against a post-annex one is a coincidence detector, not an identity, and
the contracts most likely to collide are exactly the amended ones this is meant to serve. Revisit
after Tiers 1–2, when the residue is smaller and its composition is known — `§5` of the harness
re-costs it on every run.

---

## 5. What must NOT be done

1. **Do not loosen `CONTINUITY_TOL` to admit symptom A.** The gap is 66.7% / 75% / 83.3%; a tolerance
   admitting those admits everything, and guard 2 is the only thing standing between us and a
   euro-peg currency mislabel — visible in the harness as the ×1.96 bucket (20 records), which is
   exactly the 1.95583 peg and must keep being refused.
2. **Do not relax the K2 ambiguity refusal** (885 records, the largest single cause on both sources
   and essentially identical between them, so it is NOT part of this defect). It is deliberate:
   a merged accumulator can anchor on contract A's earliest annex and serve contract B's latest value
   while passing every guard.
3. **Do not attach annexes to zeroed member rows.** They sit at €0 by 087's design; N members
   claiming one annex would multiply `procurement_annexes` by the member count and make
   `annexCount` — the "one annex at the cap vs several summing to it" figure — meaningless.
4. **Do not key on the contract number.** See §0. Our corpus has 923 records in that class and 1,525
   whose number does match; a number-keyed resolver trades a small problem for a large one.
5. **Do not resolve annexes in SQL against `contracts`.** Two notions of "this contract's annexes" is
   the defect this plan is about; a third, in a different language, cannot help.

---

## 6. Gates

| gate                                                         | what it pins                                                                                               | why a row count cannot                                                                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `annexResolve.test.ts` — new arm                             | `basis` defaults to `"split"`, and the same fixture resolves to a DIFFERENT divisor under `"full"`         | a test that only asserts the `"full"` path is satisfied by a resolver that changed both                                                                                         |
| `scripts/db/tests/annex_fold_identity.data.test.ts` — extend | the two consumers link the SAME annex records: `shards-only` and `pg-only` both at 0                       | this is the existing gate for "the two never disagree about this contract's annexes"; it currently compares contracts, not annex records, which is why the divergence passed it |
| new `annex_consortium_basis.data.test.ts`                    | consortium value-holders carry annexes at a rate within a stated factor of plain rows (today 0.6% vs 4.9%) | the absolute count is corpus-dependent; the RATIO is the invariant, and 0 annexed consortium rows is indistinguishable from a small corpus without it                           |
| mutation check on the above                                  | with the divisor change reverted, the gate goes red                                                        | an assertion satisfied by both the fixed and the broken implementation is what let this ship                                                                                    |

**The harness is not a gate and must not become one.** Its numbers move with every corpus reload;
its job is to make a claim re-derivable, and a moving assertion would be reverted rather than read.

---

## 7. Residue, after Tiers 1–2

| cause                                                   |                 records | verdict                                                                    |
| ------------------------------------------------------- | ----------------------: | -------------------------------------------------------------------------- |
| K2 ambiguity refusal                                    |                     885 | **deliberate.** Precision over recall; unchanged on both sources           |
| no contract under this УНП carries the annex's supplier |                     209 | the corpus does not hold that award — the missing-contract class, not ours |
| annex carries no proper УНП (ЦАИС internal id)          | 205 (shard-side figure) | needs a K1 that works; blocked on the number namespace                     |
| ratio cap                                               |                    ~101 | working as intended, or a collided key — sample before touching            |
| no contract row under this УНП                          |                      89 | genuinely absent from the corpus                                           |
| annex publishes no supplier EIK                         |                      24 | unresolvable from this feed                                                |

Expect the floor to be roughly **1,500 records (5.5%)** and every one of them a named, countable
class — which is the deliverable. "An honest hole, not a wrong contract" is the standing rule for
this family and it is not being changed here.
