# Annex → contract linkage: the consortium basis mismatch — v1

**Status:** ✅ **TIERS 1–2 SHIPPED** (`3d6844f9ed`, `50a945c2ab`, `3a490ab44f`), local corpus
reloaded. Tier 3 remains open and is still NOT recommended — see §4. Cloud is unchanged and needs
one command (§8).
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
would be worse than none. **That was the state this plan was written against, and it is now
closed.** One annex cache, one resolver, two callers:

|                                                           | annex records linked | before Tiers 1–2 |
| --------------------------------------------------------- | -------------------: | ---------------: |
| `anexi_current_value.ts` — the value fold (month shards)  |   **25,521** (93.1%) |   25,489 (93.1%) |
| `load_annexes_pg.ts` (114) — the annexes table (Postgres) |   **25,622** (93.5%) |   24,436 (89.2%) |
| records reached by one consumer only                      |       **109** (0.4%) |        **1,073** |

The annexes table now links MORE than the fold, which is correct rather than surprising: Postgres
holds the 2,687 synthetic `obed-` carrier rows, which have no shard row at all.

**One root cause, two symptoms.** `perSupplier()` divides the annex's FULL published value by the
supplier count, because the SHARD convention is a per-supplier split (`normalize_eop` divides by
`validSupplierCount`). `rebuild_consortium()` (087) runs INSIDE Postgres after the load and UNDOES
that split. So `load_annexes_pg.ts` handed the resolver rows in a basis it was not written for, and
the guards refused them:

| symptom                                               |          records | signature                                                                                                      |
| ----------------------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------- |
| **A.** continuity guard refuses the value-holding row | +133 over shards | `signed/anchor` is an exact INTEGER: 196 at ×3.00, 82 at ×4.00, 39 at ×2.00 — that integer IS the member count |
| **B.** every candidate row is a zeroed member         |              804 | 087's `obed-` carrier holds the value under a SYNTHETIC EIK the annex feed can never publish                   |
| (C.) annex carries no proper УНП                      | +115 over shards | downstream of A/B — the K1 fallback is what these rely on, and it fails for its own reasons                    |

The consortium arm of the corpus was effectively annex-blind. Measured per contract row, before and
after (`db:load:annexes:pg`, 2026-09-04):

| row kind        |    rows | with annexes — before |                                                 after |
| --------------- | ------: | --------------------: | ----------------------------------------------------: |
| plain           | 391,281 |       19,024 (4.9%) † |                                    19,028 (**4.86%**) |
| `obed-` carrier |   2,687 |              2 (0.1%) |                                      516 (**19.20%**) |
| named carrier   |   1,353 |              8 (0.6%) |                                      309 (**22.84%**) |
| framework       |     524 |              9 (1.7%) | 9 (**1.72%**) — deliberately unchanged, see §4 Tier 1 |
| zeroed member   |  11,398 |                     0 |                           0 — correct, they sit at €0 |

† The before column was measured under a coarser four-way classification that folded `framework`
into `plain`, so it sums to 19,043 against a pre-fix total of 19,028 and is **not** column-summable.
The two carrier rows — the finding — are exact on both sides.

15,438 consortium rows carried **10** annex links between them; they now carry **825**. The table
went from 24,708 rows over 19,028 contracts to **25,891 over 19,862**. Carriers link at ~4× the
plain rate, which is what a larger, more-amended award should look like.

⚠️ **The residue is not the harmless tail.** 34.0% of the still-unlinked records move the price, against 30.6%
of the cache — the unlinked population is slightly MORE price-moving than average, so "the annexes we
lose are the administrative ones" is false.

**What is NOT wrong.** The contract-number namespace divergence — the annex feed publishing an
internal ЦАИС number (`148846`) where the contract feed publishes the buyer's own registry number
(`Д-226`) — is real in our corpus and costs us nothing, because K2 (`УНП` + supplier EIK) is tried
first and never requires the two to agree. §3 of the harness keeps that measured rather than
asserted.

⚠️ **Its two rows INVERTED across this work, and that is the fix succeeding rather than the key
order failing.** Before: 1,525 unlinked records had a contract number that DID match against 923
that did not. After: **531 match against 894 that do not**. The matching-number records were
disproportionately the consortium ones this plan fixed, so they left the unlinked population and
the ratio flipped with them. The number-namespace class barely moved (923 → 894, 3.3% of the
cache), which is the figure that actually answers "would keying on the number help" — and it says
no. Do not "fix" it.

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

The worked example, as it stood BEFORE the fix — УНП `01981-2020-0035`, contract № `23-00-96`, a
three-member consortium, annex pre-value 708,445.65 BGN = €362,222.52. The Postgres value-holder now
resolves on the `"full"` basis (anchor 362,222.52 == signing) and carries its annexes:

|                                   |   `signed` | anchor (`lastEurFull/n`) | guard 2                      |
| --------------------------------- | ---------: | -----------------------: | ---------------------------- |
| shard row (each of 3 members)     | 120,740.84 |               120,740.84 | ✅ passes, `amountEur` flips |
| Postgres value-holder `177443810` | 362,222.52 |               120,740.84 | ❌ −66.7%, refused           |
| Postgres members ×2               |          0 |                        — | ❌ `signed <= 0`             |

---

## 2. The mechanism — 087 has TWO carrier modes, and both defeated the resolver

`rebuild_consortium()` splits joint awards into two shapes, and before Tiers 1–2 the resolver failed
differently on each. Measured over the 4,038 consortium contract groups (2026-09-03; the current
snapshot holds 4,040 carrier rows — the two are a day apart):

| 087 mode                                                           | groups | member rows | who holds the value                  | how K2 fails                                                                                                         |
| ------------------------------------------------------------------ | -----: | ----------: | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **named carrier** — the ДЗЗД/обединение member, lowest EIK on ties |  1,352 |       4,728 | a REAL member EIK, at the FULL value | the EIK matches, the divisor does not → symptom A                                                                    |
| **synthetic carrier** — `obed-<md5(eikset)>` for unnamed consortia |  2,686 |       8,020 | a SYNTHETIC EIK                      | `obed-…` can never appear in the annex feed's supplier list → no K2 key existed at all → symptom B, closed by Tier 2 |

Both are correct as money: 087's transform is value-invariant (carrier-full + members-zero == the
prior split sum), and that invariance is exactly why nothing downstream reported the loss.

Everything a fix needs is already on the row — 087 declares `consortium_role`
(`'carrier' | 'member' | NULL`), `consortium_size` (N), `consortium_eik` (self on the carrier, a link
on members) and `consortium_full_eur`, plus a partial index on the member arm. **No new column and no
migration is required.**

---

## 3. What it cost a reader

`procurement_annexes` has exactly one serving consumer — `contract_annexes(key)` (114) →
`/api/db/contract-annexes` → `useContractAnnexes` → the `/contract/:key` per-annex breakdown and the
чл.116 ал.2 vs ал.3 labelling. So the damage was bounded and specific — and it is what
`annex_fold_identity.data.test.ts`'s per-class arm now counts directly, at 288 contracts before the
fix and 0 after:

- On a consortium contract the page said the value moved (it reads `contracts.amount_eur`, which the
  shard-side fold got right) and then showed **no modifications that moved it**. The +50% cliff
  finding `docs/plans/procurement-risk-v2.md` §0b exists to publish — one annex at the cap, or
  several summing to it — is unanswerable there.
- **No money total is wrong.** Nothing in the risk cache, no rollup and no aggregate reads
  `procurement_annexes`; the corpus's current-value basis comes from the shard-side fold, which is on
  the correct divisor. This was a completeness defect, not a valuation one.
- `single_source_per_contract.data.test.ts` treats an orphaned annex row as expected output, so the
  pre-existing gates were silent on this by construction — which is why §6 adds arms rather than
  tightening one.

---

## 4. The fix

### Tier 1 — make the basis EXPLICIT ✅ SHIPPED `3d6844f9ed`

Give `resolveAnnexKey` / `lookup` a `basis` option:

- `"split"` — the shard convention, `n = max(1, lastSupplierCount)`. **The DEFAULT.**
- `"full"` — the post-087 Postgres convention, `n = 1`.

`load_annexes_pg.ts` passes `"full"`; `anexi_current_value.ts` keeps the default and must not change
by a single byte.

**Shipped, and the projection was low.** Measured: unlinked records on the pg source **2,946 →
1,816**, the zeroed-member refusal **804 → 69**, and the 087 integer-ratio signature gone from the
harness's §2 continuity table — the 196 refusals at ×3.00 and 82 at ×4.00 are absent. ⚠️ 7 at ×3.00
and 2 at ×4.00 remain, and they are NOT residue of this defect: they appear identically on the shard
source, so they are genuine value disagreements that happen to land on a whole number.

⚠️ **The basis is per ROW, not per source, and the first draft of this tier got that wrong.**
"Reads Postgres" is NOT "reads un-split rows": 087 promotes CONSORTIA only, so `joint_kind =
'framework'` keeps the equal split by design (its step 2 — independent parallel winners, not one
joint award) and so does every multi-supplier award its `HAVING` did not group. An unconditional
`basis: "full"` would have dropped **23 contracts** that link on `"split"` and are refused on
`"full"` — 9 `framework` and 14 ungrouped multi-supplier — while gaining 794 carriers: one silent
loss traded for another. The loader therefore reads 087's `consortium_role` and chooses per row.

⚠️ **That 23 is the resolver's own verdict, and it is the number to quote.** An earlier draft said
83, from a SQL proxy over annex ROWS whose stored `last_value_eur / signed` is a whole number ≥ 2.
The proxy over-counts twice over — it counts rows rather than contracts, and its integer ratios
include rows the guards refuse anyway — and the only measurement that answers the question is
running `resolveAnnexKey` twice per row and diffing. `annex_consortium_basis.data.test.ts` does
exactly that, in both directions. The framework line in §0's coverage table is the standing check:
those 9 links are unchanged.

⚠️⚠️ **THE DEFAULT MUST STAY `"split"`, AND THIS IS THE ONE STEP THAT CAN DO REAL DAMAGE.**
`anexi_current_value.ts` FLIPS `amountEur` in place across the whole corpus — the ~€2.2bn
current-basis move. A divisor change on that path silently rewrites every consortium contract's
published value by its member count, on the shards, which then load into Postgres and into every
rollup. Guard 2 would not catch it: it validates the anchor against `signingAmountEur`, and on the
shards both are already in the split basis, so a `n=1` anchor would refuse the match rather than
mis-value it — the loss would be silent and total instead of visible. The gate in §6 pins the
default.

### Tier 2 — reach the synthetic carrier through its MEMBER SET ✅ SHIPPED `50a945c2ab`

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

**Shipped.** Measured: unlinked **1,816 → 1,792**, the zeroed-member refusal **69 → 23**, and
**336 synthetic carriers now resolve via the УНП key against 0 before** — `obed-` coverage 0.1% →
19.2%. The disagreement refusal fires on **151 of 506** probe-eligible carriers, so it discriminates
rather than passing everything through.

Two corrections came out of review and are worth keeping, because both are invisible in a row count:

- **The member set is keyed on 087's GROUP identity `(ocid, contract_id)`, never on
  `consortium_eik`.** A named carrier's `consortium_eik` is a real ДЗЗД company that recurs across
  awards — 42 of them span groups with DIFFERENT member sets, 323 groups — so keying on it hands
  288 carrier rows another award's members. Latent (the agreement rule refused every one) but it is
  the cross-award attribution this probe exists to refuse, arriving through the candidate set
  rather than through the refusal.
- **The winning member is chosen by a total order, not by `find` over Postgres row order.** Two
  eligible members can hold DIFFERENT record lists under an identical accumulator shape — measured,
  27 carriers — so an unordered pick varied the rows written to `procurement_annexes` between
  reloads, and with them `annexCount`, the "one annex at the cap vs several summing to it" figure
  the table exists for.

### Tier 3 — the value-anchored third key: measured, and NOT recommended as it stands

A third key — the annex's pre-annex value equals a contract's signing value to the cent, uniquely
under that procedure — resolves **600 of the 1,792 still-unlinked records (33.0%), 192
price-moving** (it was 691 of 2,946 before Tiers 1–2; the harness re-costs it on every run).

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
4. **Do not key on the contract number.** See §0. Our corpus has 894 records in that class against
   531 whose number does match — and the second figure has fallen by two thirds since Tiers 1–2
   precisely because those records got linked, which is the point. A number-keyed resolver trades a
   small problem for a large one.
5. **Do not resolve annexes in SQL against `contracts`.** Two notions of "this contract's annexes" is
   the defect this plan is about; a third, in a different language, cannot help.

---

## 6. Gates ✅ SHIPPED

| gate                                                         | what it pins                                                                                                                                                                   | proved by                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `annexResolve.test.ts` — `contract basis` (5 arms)           | the default is `"split"`, and all four cells of the split/full matrix, including the framework case that regresses live rows                                                   | reverting the divisor reddens 3 arms; flipping the default reddens the default-pin                               |
| `annexResolve.test.ts` — `synthetic carrier` (8 arms)        | the member probe resolves, refuses both kinds of disagreement, evaluates guard 1 against the MEMBER, is placed after the own key and before K1, and does not fire on `"split"` | deleting the own-key precondition reddens the precondition arm                                                   |
| `annexResolve.test.ts` — `membersByConsortiumGroup` (4 arms) | two awards sharing a named carrier EIK are not merged; 087's `COALESCE(contract_id,'')` grouping                                                                               | no database needed — the map construction is where the group-key defect lives, and no call-site regex can see it |
| `annex_consortium_basis.data.test.ts` (8 arms)               | the carrier coverage ratio, both mutation directions on the basis, the agreement rule's discrimination, and static pins on the loader's call site                              | the mutation arms count rows linked under one basis and refused under the other                                  |
| `annex_fold_identity.data.test.ts` — the divergence arm      | the two consumers reach the same annex RECORDS within 3%                                                                                                                       | forcing the pre-Tier-1 basis reproduces 1,063 fold-only / 10 pg-only exactly                                     |
| `annex_fold_identity.data.test.ts` — per-class + proof       | a flipped contract can show a modification, asserted per `consortium_role`; a rolled-back strip of 50 carriers is caught                                                       | in aggregate a TOTAL carrier regression is only 4.53%, inside any tolerable ceiling; per class it is 100%        |

Three things the gates had to be taught, each of which had already produced a green-but-empty
assertion during this work:

- ⚠️ **Count PER ROW, never a net.** Over the 391,805 non-carrier rows, `linked(split)` is 19,037
  against `linked(full)` 19,052 — the WRONG SIGN — while 83 rows are in fact dropped. What
  discriminates is the count of rows linked under one basis and refused under the other.
- ⚠️ **Compare annex RECORDS, never index keys.** One record is indexed under every supplier it
  lists, so on the shards each of a consortium's N members claims its own key while in Postgres
  only the carrier claims one: comparing keys reported 1,121 fold-only against a true 13.
- ⚠️ **A default parameter fires on an explicit `undefined`.** A "without the member set"
  comparison silently passed the real member set and measured the same thing twice, twice.

**The harness is not a gate and must not become one.** Its numbers move with every corpus reload;
its job is to make a claim re-derivable, and a moving assertion would be reverted rather than read.

---

## 7. Residue, after Tiers 1–2 — MEASURED

1,792 of 27,414 annex records (6.5%) remain unlinked on the pg source, and every one is now a
named, countable class. That is the deliverable; "an honest hole, not a wrong contract" is the
standing rule for this family and it is not being changed here.

| cause                                                   | records | verdict                                                                                          |
| ------------------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------ |
| K2 ambiguity refusal                                    |     565 | **deliberate.** Precision over recall; essentially unchanged on both sources                     |
| guard 2: continuity (±12%)                              |     352 | the real residue — value disagreements, and the ×1.96 euro-peg mislabels guard 2 exists to catch |
| no contract under this УНП carries the annex's supplier |     209 | the corpus does not hold that award — the missing-contract class, not ours                       |
| annex carries no proper УНП (ЦАИС internal id)          |     190 | needs a K1 that works; blocked on the number namespace                                           |
| unattributed                                            |     161 | the replay reached no accumulator under either key                                               |
| guard 3: ratio cap                                      |     135 | working as intended, or a collided key — sample before touching                                  |
| no contract row under this УНП                          |      89 | genuinely absent from the corpus                                                                 |
| annex publishes no supplier EIK                         |      24 | unresolvable from this feed                                                                      |
| contract row has no usable value (zeroed member)        |      23 | correct: those rows sit at €0 and the carrier now takes the annex                                |
| guard 1: supplier absent from the latest annex          |      17 | refusal doing its job                                                                            |
| K1 ambiguity refusal (>1 УНП under buyer + contract №)  |      10 | a buyer reusing a contract number across procedures                                              |
| carrier member-set probe: members disagree              |       9 | Tier 2's refusal, doing its job                                                                  |
| guard 2: no usable anchor                               |       8 | the feed published no pre-annex value                                                            |

Those thirteen sum to **1,792** — the table is the whole residue, not a selection.

The `zeroed consortium member` cause went **804 → 23** across the two tiers and the continuity
refusals **511 → 352**; the 087 integer-ratio signature (196 at ×3.00, 82 at ×4.00) is gone, with 7
and 2 left that appear identically on the shard source and are therefore ordinary value
disagreements rather than residue of this defect.

---

## 8. Publishing — the one command nothing runs automatically

The local corpus is reloaded. **Cloud SQL still carries the pre-fix linkage** and will until:

```bash
npm run db:load:annexes:pg:cloud
```

Three things about that publish:

- **It is safe in any order relative to a deploy.** The route degrades a missing/short table to an
  empty annex list, so the only symptom of not running it is the one this plan is about — a
  `/contract/:key` that says the value moved and lists nothing that moved it, on prod, while local
  is correct.
- **No migration is needed.** 114 is unchanged; the fix is entirely in the resolver and the loader,
  and `consortium_role` / `consortium_eik` / `ocid` all ship with 087 via `db:load:pg`.
- **Expect roughly +830 contracts and +1,180 rows**, matching the local reload (19,028 → 19,862
  contracts, 24,708 → 25,891 rows). A materially different delta means the cloud contracts corpus
  is a different vintage, not that the fix behaved differently.

Re-run `npx tsx scripts/procurement/measure_annex_linkage.ts --source=pg` against the proxy
afterwards to confirm; it is read-only and takes no flags that write.
