# Same-feed duplication in the contracts corpus — v1

**Status:** INVESTIGATION COMPLETE. No rows changed. Nothing deleted.
**Measured:** 2026-08-04 against local Postgres `postgres://postgres:postgres@localhost:5433/electionsbg`
(corpus 408,377 rows / €99,257,662,518.47) and against the shards.
**Companion to:** [procurement-cross-source-dedup-v2.md](procurement-cross-source-dedup-v2.md), which
closed the CROSS-source class. This plan covers what that pass structurally cannot see.

---

## 0. Executive summary

The reported €594m same-feed duplication **is not duplication**. 99.5% of it (€591.1m, the whole
`ocds` arm) is a population of genuinely distinct amendment events that already carries **zero money
weight** in every rollup and every serving query. The remaining `aop` arm is real, is a different
defect from the one described, and is **4× larger than reported** once the measurement key stops
requiring a УНП that 42% of legacy rows do not have.

| Arm | Reported | Verdict | Real exposure |
| --- | ---: | --- | ---: |
| `ocds` — 238 groups | €591,109,510.10 | **Not duplicates.** All distinct annexes; already excluded from every sum | **€0** |
| `aop` A1 — stale key | (part of €2.9m) | **Genuine defect, ours.** Pre-`disambiguateContractKeys` orphans | **€2,068,182.74** |
| `aop` A2 — two document ids | (part of €2.9m) | **Triaged (§3.3): 56 of 101 groups are NOT duplicates.** Blocked on an ingest change | €1,951,479.39 |
| `eop`, `rop` | not examined | **Clean.** Zero content duplicates | €0 |

Five things this measurement changed relative to the brief:

1. **The `ocds` arm is 100% `tag = 'contractAmendment'`; the `aop` arm is 100% `tag = 'contract'`.**
   These are not one phenomenon in two feeds. They share no mechanism, no remedy and no risk profile.
2. **All 238 `ocds` groups carry all-distinct annex notice numbers** — zero republications — verified
   against `procurement_annexes`, an *independent* source (the ЦАИС ЕОП annex cache, not the OCDS feed).
3. **The €591m has no money weight anywhere.** `rollups.ts` excludes amendments from every money and
   count rollup by design, and every SQL money path filters `tag = 'contract'`. Deleting these rows
   would remove the amendment timeline and change no total.
4. **The brief's worked example is not a member of the measured population.** `00536-2023-0049/246043`
   is a `contract` / `contractAmendment` pair — different `tag`, so the group key separates them.
5. **The `aop` arm is €11.77m, not €2.94m.** The brief's key requires a non-empty `unp`; 103,492 of
   244,971 legacy rows (42.2%) have none, so 115 duplicate rows were invisible to it.

---

## 1. Reproduction (do this before trusting anything below)

The brief's table reproduces **exactly**, to the cent:

```sql
WITH r AS (
  SELECT CASE WHEN release_id LIKE 'aop-legacy-%' THEN 'aop'
              WHEN release_id LIKE 'eop-%'        THEN 'eop'
              WHEN release_id LIKE 'rop-%'        THEN 'rop'
              ELSE 'ocds' END AS feed, *
  FROM contracts
  WHERE contractor_eik NOT LIKE 'obed-%' AND coalesce(unp,'') <> ''
    AND contractor_eik <> '' AND amount_eur IS NOT NULL AND coalesce(date_signed,'') <> ''
), g AS (
  SELECT feed, tag, unp, contract_id, contractor_eik,
         round(amount_eur::numeric,0) amt, left(date_signed,10) dsig,
         count(*) n, sum(amount_eur) eur
  FROM r GROUP BY 1,2,3,4,5,6,7 HAVING count(*) > 1
)
SELECT feed, tag, count(*) groups, sum(n-1) surplus_rows,
       round(sum(eur - eur/n)::numeric,2) surplus_eur
FROM g GROUP BY 1,2 ORDER BY 5 DESC;
```

| feed | tag | groups | surplus rows | surplus € |
| --- | --- | ---: | ---: | ---: |
| ocds | **contractAmendment** | 238 | 306 | 591,109,510.10 |
| aop | **contract** | 79 | 90 | 2,937,279.61 |

Adding `tag` to the SELECT is the whole investigation. The brief grouped BY `tag` but never
reported it, and the two arms are disjoint on it.

---

## 2. The `ocds` arm — 238 groups, €591.1m — is not duplication

### 2.1 The rows are distinct real amendments

`normalize.ts` emits `contractAmendment` rows deliberately: *"One row per amendment so the SPA can
show the timeline."* The question is whether the AOP OCDS export publishes one release per real
amendment, or re-publishes the release history on each fetch.

It publishes one release per real amendment. Worked case — `01467-2022-0071` / contract 73914 /
eik 121265113, the brief's "7 copies at €5,423,784.28 each":

| release_id | notice # | in `procurement_annexes`? |
| --- | ---: | --- |
| `ocds-e82gsb-244887-801207/2026-01-26-contractamendment` | 801207 | ✔ 2026-01-26T05:20:33 |
| `…-801338/2026-01-26-contractamendment` | 801338 | ✔ 05:20:45 |
| `…-801372/2026-01-26-contractamendment` | 801372 | ✔ 05:21:03 |
| `…-801418/2026-01-26-contractamendment` | 801418 | ✔ 05:21:16 |
| `…-801446/2026-01-26-contractamendment` | 801446 | ✔ 05:21:25 |
| `…-801503/2026-01-26-contractamendment` | 801503 | ✔ 05:21:53 |
| `…-858356/2026-05-26-contractamendment` | 858356 | ✔ 2026-05-26T05:19:37 |

Seven releases, seven annex notices, **1:1**. `procurement_annexes` is fed by the ЦАИС ЕОП annex
crawl (`ingest_anexi`), not by the OCDS export — so this is independent corroboration, not the same
feed agreeing with itself. All seven carry `value_diff_eur = 0` and the reason *"Промени,
предвидени в договора чрез клауза за преглед"*: seven review-clause changes that did not move the
value, which is exactly why all seven rows show the same amount and read as copies.

Generalised over the whole population:

| | |
| --- | ---: |
| Groups where every member has a distinct notice number | **238 of 238** |
| Groups containing any repeated notice number (true republication) | **0** |
| Rows in those groups | 544 |
| Rows whose notice number is a confirmed `procurement_annexes` record | 413 |

The 131 unconfirmed rows are outside the annex cache's coverage, not contradicted by it.

> **There is nothing to evict.** A pass keying on `(unp, contractor, amount, date_signed, tag)`
> cannot distinguish "one contract published seven times" from "seven amendments that each left the
> value unchanged", because the two are identical in all five fields. The notice number — which the
> key does not carry — is the discriminator, and it says the second reading is correct.

### 2.2 …and it carries no money anywhere

Even granting the opposite conclusion, the €591m is not in any total. Three independent confirmations:

- **`rollups.ts:213-218`** excludes amendments from every money and count rollup, and records the
  incident that prompted it: *"Amendments re-state an existing contract's value (audit: ~97% are
  exact duplicates by contractor+amount), so summing them as new spend double-counts — e.g. it
  inflated АПИ from ~€5.6bn to €7.5bn."* Amendment-only entities are still *registered* (name/region,
  no money) so the per-EIK file-count invariant holds.
- **Every SQL money path filters `tag = 'contract'`** — verified across all 130 migrations. The one
  deliberate exception (`033_procurement_risk_indexes.sql:291`) carries a comment explaining that an
  EXISTS probe must *not* filter tag; it moves no money.
- **`functions/db_routes.js`** uses `SUM(amount_eur) FILTER (WHERE tag = 'contract')` at every
  aggregate site.

`contractAmendment` rows total €5,948,073,392 across the corpus and contribute €0 to every served
figure. They exist to render `/contract/:key`'s amendment timeline and to resolve annexes.

### 2.3 Recommendation: no action, and record why

Deleting these rows would remove a product feature and correct no number. The only defensible change
is documentation, so this is not rediscovered as a €591m finding a third time. The near-miss is real:
the brief's own worked example (`00536-2023-0049/246043`, keys `de31feb18e2f` / `20be7df52d6b`) is a
`contract`+`contractAmendment` pair — two rows that a tag-blind eviction would have collapsed,
destroying a base contract.

---

## 3. The `aop` arm — real, and larger than reported

### 3.1 The brief's key cannot see 42% of the feed

| | rows | share |
| --- | ---: | ---: |
| `aop-legacy-` rows total | 244,971 | |
| …with no `unp` | 103,492 | **42.2%** |
| …with no `date_signed` | 0 | 0% |

Identity E requires a УНП. On the legacy annual CSVs the УНП column is blank for two rows in five, so
the measured 79 groups are a subset. Re-measuring on **full content identity** — `(contract_id,
contractor_eik, amount, currency, title, cpv, awarder_eik, date_signed)`, no УНП requirement — gives:

| Class | Groups | Surplus rows | Surplus € | Rows without УНП |
| --- | ---: | ---: | ---: | ---: |
| **A1** same `ocid` | 32 | 32 | 2,176,167.28 | 0 |
| **A2** multiple `ocid` | 101 | 103 | 9,593,387.26 | 115 |
| **total** | **133** | **135** | **11,769,554.54** | 115 |

### 3.2 A1 — stale keys from a superseded keying scheme (**our defect**)

`legacy_csv.ts` mints `key = hashKey("legacy::${datasetUuid}::${documentId}::${contractorEik}")`.
Lots sharing a document number collided, so `disambiguateContractKeys` was added to re-key colliding
rows to `hashKey("${baseKey}::${contractId}::${amount}")`.

The month-shard merge (`ingest.ts:146-148`) is a **union keyed on `Contract.key`**. When the key
formula changed, re-ingested rows arrived under NEW keys; the rows carrying the OLD bare key matched
nothing and were never evicted. They are still there.

Worked case — `aop-legacy-2020-65860`, МЗ vaccine framework. The raw CSV (`raw_data/procurement/legacy/2020.csv.gz`,
rows 1444/1445) has **two** lots for contract `Договор №РД-11-485`:

| CSV row | Предмет на договора | Стойност |
| ---: | --- | ---: |
| 1444 | Ваксина срещу бяс | 1,371,600 |
| 1445 | Ваксина срещу дифтерия, тетанус, коклюш, полиомиелит | 3,492,000 |

The corpus holds **three**. Recomputing the hashes settles it:

```
base = hashKey("legacy::c5404069-…::65860::203283623")           = ead302ce1ecd  ← STALE, in corpus
hashKey(base + "::Договор №РД-11-485::3492000")                  = 3c5d7dffb956  ← current, in corpus
hashKey(base + "::Договор №РД-11-485::1371600")                  = cb415fc29f5b  ← current, in corpus
```

`ead302ce1ecd` is the **bare base key** — a row minted before disambiguation shipped — sitting
alongside its own re-keyed self. Confirmed on the shard (`data/procurement/contracts/2020/2020-10.json`),
not only in Postgres.

Across the 32 A1 groups:

| Key shape | Groups |
| --- | ---: |
| `BARE + DISAMB` — provable stale orphan | **30** |
| `DISAMB + OTHER` — key from a third, unidentified scheme | 2 |

**30 provable orphans, €2,068,182.74.** The 2 `OTHER` groups must be enumerated before anything
touches them.

> A corpus-wide hash re-derivation was attempted to size this beyond the content-identical set. It
> reproduced only 59% of legacy keys (`bundleUuid` and `contractId`/`amount` have been rewritten in
> place by later passes — `__encode_personal_ids_inplace.ts` rewrites `contractorEik`, which is why
> the mint-time EIK must be read off `releaseId`, not the row). **Its 5,954-row / €629m output is not
> trustworthy and is deliberately not carried into this plan.** The 30/€2.07m figure is grounded in
> content identity plus an exact hash match on both members, and is a floor.

### 3.3 A2 — the same contract under two document ids (**candidate, not established**)

101 groups where content is identical but the `ocid` differs, i.e. АОП issued two document numbers.
Worked case — `raw_data/procurement/legacy/2022-RL.csv.gz`, document ids 1031860 and 1031861:

```
1031860 | 21/03/2022 | поръчка 343779 | 02724-2017-0021 | ПО-03-17 | 29/10/2021 | 177220661 | 446462.58 BGN
1031861 | 21/03/2022 | поръчка 343779 | 02724-2017-0021 | ПО-03-17 | 29/10/2021 | 177220661 | 446462.58 BGN
```

Byte-identical in every business field, consecutive document ids, same publication day. The register
published the same *"Информация за сключен договор"* twice; our pipeline faithfully mints two rows.

**TRIAGED 2026-08-05 — and the majority are NOT duplicates.** Re-derive with
`npx tsx scripts/procurement/triage_legacy_twins.ts` (read-only, no `--apply`, all 101 groups
resolved against the raw dumps, 0 unmatched):

| procurement id | publication date | Groups | Surplus € |
| --- | --- | ---: | ---: |
| **DIFFERENT** | different | **51** | 7,459,935.51 |
| same | different | 27 | 1,254,703.38 |
| same | same | 18 | 696,776.01 |
| **DIFFERENT** | same | **5** | 181,972.36 |

**56 of 101 groups — €7,641,907.87, 79.7% of the A2 money — are two DIFFERENT procurements** that
happen to share a contract number, value, signing date, subject, buyer and supplier. They are not
duplicates at all, and they are precisely the shape whose eviction destroyed 46 legitimate rows /
€5.15m in an earlier attempt.

The remaining 45 groups (€1,951,479.39) share a procurement and are genuine duplicate candidates:
18 published twice on the same day, 27 re-published later (a correction or re-filing, where the
later document should win).

Two things this measurement got wrong on the first pass, both worth recording because both made
the population look *safer to evict* than it is:

- **The procurement id is published under two different column names**, and an exact-match header
  lookup found only one of them. `ID на поръчката` exists on 2011-2015 / 2016 / 2017 / 2019 / 2021
  / 2022-RL; the CE dumps from 2020 on carry `Уникален номер на поръчката` and no
  `ID на поръчката` at all. The first draft defaulted the missing column to `""`, so every row in
  those dumps agreed with every other and **11 groups were filed under "same поръчка" on no
  evidence** — one of them provably two different procurements (`aop-legacy-2020-65483` vs
  `-72710`, УНП `00166-2020-0011` vs `00166-2020-0013`). The script now resolves headers by the
  same regexes `legacy_csv.ts` binds, including `UNP_HEADER_PATTERNS`, and an absent column is a
  distinct `UNKNOWN` bucket rather than agreement.
- **`ТИП ДОКУМЕНТ` is published by exactly ONE of the nine dumps** (2011-2015), so it cannot
  discriminate and has been dropped from the classification entirely. A first draft's
  "DIFFERENT тип · 3 groups" row was pure artifact — `["3", <column absent>]`.

> **What actually blocks a rule.** `legacy_csv.ts` *does* read `ID на поръчката` — it binds it to
> `tenderId` (line 187) and then deliberately drops it — and it *does* emit the CE dumps'
> `Уникален номер на поръчката` as `unp`. So the blocker is narrower than "the ingest discards the
> discriminator": **24 of the 101 groups already carry a differing `unp` on the shards today**, and
> §3.1's identity key simply excludes `unp` (it must, or the 2011-2015 population — where `unp` is
> blank — would be invisible). Only the **58 groups touching the 2011-2015 bulk file** are
> genuinely blind, and for those the fix is to carry `tenderId` onto the row rather than dropping
> it. Nothing here is unblocked enough to justify a rule yet, but the work is smaller than a
> re-ingest.

One parsing trap is worth recording, because it silently swallowed the largest sub-population:
`2011-2015.csv.gz` is **not a CSV** despite the name — it is a JSON array-of-arrays. Parsed as CSV
its header reads as a single 2,607,413-field row and every document lookup misses, reporting all 58
of its groups as "unmatched in the raw CSV" rather than as an error. `triage_legacy_twins.ts` sniffs
the first byte for this reason.

### 3.4 `eop` and `rop` are clean

Zero content-identical same-feed groups in either. The problem is bounded to the two feeds measured.

---

## 4. Why every existing net misses A1

| Mechanism | Why it cannot see A1 |
| --- | --- |
| `evictSupersededEopTwins` (`content_key.ts`) | Only ever removes `eop-` rows, and only when a non-`eop` row supersedes them. A1 is `aop`↔`aop`. |
| `reconcile_cross_source.ts` (identity E) | Requires `count(DISTINCT feed) > 1` by construction. |
| `single_source_per_contract.data.test.ts` | Same cross-feed requirement. |
| `dropSyntheticLegacyTwins` (`validate.ts`) | Keyed on `isSyntheticXTwin` — the `…-x` blank-document-id ocid only. A1 rows have real document ids. |
| **`dedup_contract_keys.ts`** | **This is the defect.** |

`rekeyShards()` groups rows by their **stored** `key` and re-keys any group with ≥2 distinct
discriminators. It re-keys in place, asserts uniqueness, and is correctly idempotent — but a row
already carrying a *stale* key no longer shares a stored key with its twin, so it forms a **singleton
group and is skipped**. The pass is structurally blind to precisely the rows a previous key change
left behind, and re-running it can never help.

This mechanism is already documented in this repo, for a different key change —
`dedup_legacy_twins.ts`'s own header:

> *"an earlier legacy-CSV ingest emitted blank-document-id rows that got the `…-x` ocid fallback. A
> later run re-ingested the same contracts correctly with their real document number. Because the
> shard merge keys on `key`, the two never collapsed — leaving ~34k duplicate pairs that
> double-count ~€11bn."*

A1 is the same failure, one key-formula change later, at 1/5000th the size. **The general defect is
that a key-formula change has no orphan sweep** — each occurrence has needed its own bespoke one-shot.

---

## 5. Recommended next steps (none taken)

Ordered by confidence. Nothing below has been executed.

1. **`ocds` arm — document, change no data.** Add the tag split to
   `single_source_per_contract.data.test.ts`'s comments and to `measure_cross_source.ts`'s output so
   the next audit sees `tag` immediately.
2. **A1 — a one-shot sweep, 30 rows, €2,068,182.74.** Evict a legacy row iff its key equals
   `hashKey(base)` AND a sibling exists whose key equals `hashKey(base::contractId::amount)` AND the
   two are content-identical. Per v2 §"Hard constraints": emit evicted→survivor PAIRS, assert each
   survivor present BY KEY, assert no procedure loses its last row, assert corpus delta equals the
   evicted sum exactly, exit non-zero before writing, back up the 981 MB shard tree first. Enumerate
   the 2 `OTHER` groups by hand before including them — they are not covered by this rule.
3. **Close the general defect.** A permanent gate asserting no legacy row's key is a bare base key
   whose base also has a disambiguated member. This turns the next key-formula change from a silent
   corpus leak into a red test.
4. **A2 — TRIAGED (§3.3), and the conclusion is "do not write a rule yet".** 56 of the 101 groups
   (€7.64m, 79.7% of the class) are two different procurements, not duplicates. The 45 that are
   genuine candidates (€1.95m) are told apart by the procurement id, which the shards already carry
   as `unp` for 24 of them — but not for the 58 groups from the 2011-2015 bulk file, where `unp` is
   blank and `legacy_csv.ts` binds the procurement id to `tenderId` only to drop it. So the
   prerequisite is a small **ingest change** (persist `tenderId`), after which the rule is
   "same procurement, later publication wins". Writing it in the other order means guessing on a
   population that has already destroyed real data once.

Corpus impact of steps 1–3 combined: **−30 rows, −€2,068,182.74 of €99.26bn (0.002%).** Worth doing
for corpus integrity and to close the recurring mechanism, not for the money.

## 6. Constraints inherited from v2, restated

- Never auto-delete on an unvalidated key. Two earlier attempts destroyed real data and both reported
  plausible counts while doing it.
- No SQL-side deletion — `pg_roundtrip.data.test.ts` asserts Postgres is a lossless capture of the
  shards. Rows come off the shards.
- `data/procurement/contracts/**` is gitignored and NOT recoverable from git. Back it up before `--apply`.
- Reuse `cross_source.ts` / `measure_cross_source.ts`; do not re-implement a lookalike.
- Typecheck with `npx tsc -b`. Data gates: `npx vitest run scripts/db/tests/`.
- Production (Cloud SQL) carries A1 too; see v2 §T6 for the loader chain and ordering.
