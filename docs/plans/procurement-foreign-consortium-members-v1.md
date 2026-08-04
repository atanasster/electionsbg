# Supplier-identity defects in the contracts corpus — v1

**Status:** plan only, nothing implemented.
**Found:** 2026-08-03, while tracing the НПВУ 4th-payment projects (Alstom trains).
**Revised:** 2026-08-03, after measuring against the real `canonicalEik` semantics. The first draft
of this plan got two things wrong; §2 records what and why, because both mistakes are the kind that
recur.

## 1. What started it

A joint award is published by ЦАИС ЕОП as ONE record whose supplier fields are semicolon-joined
lists. On the biggest RRF rolling-stock contract (УНП `00042-2024-0005`, МТС, €451.5m,
`raw_data/procurement/eop/2025-05-02.json.gz`, noticeId 686114) the source says:

```
supplierRegisterNumber = 181339162; RO6640696; IT02791070044; 207661045
supplierName           = КОНСОРЦИУМ БУЛЕМУ; ALSTOM TRANSPORT SA; Alstom Ferroviaria SpA; РВП ИНВЕСТ ЕООД
supplierNutsCode       = BG411; RO321; ITC16; BG411
```

Our corpus holds two of the four. Both Alstom entities — the manufacturers — are gone, so searching
the corpus for "Alstom" returns nothing on the contract that bought Alstom trains.

Pulling that thread surfaced three distinct defects with different severities. The
foreign-member drop turned out to be the least urgent of them.

## 2. Two corrections to the first draft

**(a) Foreign numeric ids are not dropped — they are minted into Bulgarian EIK space.**
[canonicalEik](../../scripts/procurement/eik.ts) pads any 5–8 digit numeric id to nine digits
("some sources publish 9-digit EIKs with a leading zero stripped") and passes 10–12 digit ids
through unchanged. A foreign registry number therefore becomes a syntactically valid BG EIK:

| Source id       | Country                    | Becomes     | Serves as                      |
| --------------- | -------------------------- | ----------- | ------------------------------ |
| `50919679`      | NL (ХИЛ Интернешънал Н.В.) | `050919679` | a BG EIK carrying €11.7m       |
| `13092995`      | RO (ХАБАУ С.Р.Л.)          | `013092995` | a BG EIK                       |
| `0018683136487` | HR                         | `001868313` | 13-digit branch rule slices it |
| `1027809198339` | RU (OGRN)                  | `102780919` | same                           |
| `0000340505`    | PL (Kapsch)                | unchanged   | a 10-digit "BG EIK"            |

**336 rows / 176 distinct fabricated EIKs.** Only ids containing letters or punctuation
(`RO6640696`, `IT02791070044`, `FN278233T`) actually fail `isValidEik` and get dropped — that is
the Alstom class — **86 awards / €994.2m** by the faithful classifier (an earlier count of 211
over-counted by treating the padded-numeric D-3 class as dropped, which it is not). The first draft measured "foreign" with a
plain 9-or-13-digit test and so counted the padded ones as dropped. Anything reasoning about this
corpus must run ids through the real `canonicalEik`, not a lookalike.

**(b) `supplierNutsCode` cannot be used as the discriminator.** The obvious fix for (a) is "trust
the country code the feed already gives us". It does not survive contact with the data:

- 16,088 records carry **no** `supplierNutsCode` at all.
- The list is misaligned often enough to be dangerous. `111551276` / `827139847` / `831076655` all
  carry a `BE` nuts code and are all **real Bulgarian companies** (СТРОЙКО - 2002 ЕООД, ППК Труд,
  ЖИВАС ООД — confirmed present in `tr_companies`). Namespacing on the nuts code would have
  re-keyed three genuine BG firms as Belgian.

So defect (a) has **no reliable signal available offline** and is deferred (§5, T4) rather than
guessed at. That is a deliberate non-fix, not an oversight.

## 3. The three defects, by severity

### D-1 — ЕГН published as contractor identity (LIVE, personal data)

`contracts.contractor_eik` holds **98 distinct values that pass a full ЕГН validation** (YYMMDD with
the +20/+40 month conventions, plus the mod-11 weighted checksum), each attached to a natural
person's full name and a paid contract amount: 148 rows, €2.4m. Examples:
`6207316703` / Венцеслав Георгиев Делов (`00258-2022-0003`), `7102238334` / Антоанета Николаева
Генева, `8408115788` / Димитър Петков Русев.

They arrive because a 10-digit id passes `canonicalEik` untouched and `isValidEik` accepts
9–13 digits — no code anywhere asks whether an id is a _personal_ number.

**The checksum test is safe to act on: zero of the 98 matches a company in `tr_companies`**, so
there are no false positives to weigh. This is served data — the contracts DbDataTable and the
company API expose it, and it mirrors to Cloud SQL through the ordinary loaders.

Alongside them, placeholder ids **pool unrelated people into one identity**: `1234567899` is shared
by 20 different natural persons in `02023-2023-0012`, plus `1111111111`, `1111111122`,
`0000000000`.

### D-2 — foreign consortium members dropped (the Alstom class)

| Path                   | Site                                                                   | Behaviour                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ЦАИС ЕОП flat договори | [normalize_eop.ts:381](../../scripts/procurement/normalize_eop.ts:381) | Non-BG member of a **mixed** consortium dropped; foreign suppliers survive only when a contract has **no** BG supplier (`recoverForeign = bgCount === 0`). |
| АОП OCDS export        | [normalize.ts:196](../../scripts/procurement/normalize.ts:196)         | `contractorFields()` returns `null` for any id failing `isValidEik`. **No foreign path at all.**                                                           |

**They must be fixed together.** `contentKeys()` in
[content_key.ts](../../scripts/procurement/content_key.ts) embeds `contractorEik` and the rounded
`amountEur`. If one path emits 4 rows at value/4 and the other 2 rows at value/2, no content key
collides, cross-source dedup stops matching, and the same contract survives from both feeds as a
double count. Fixing one path alone is worse than fixing neither.

### D-3 — foreign numeric ids occupying BG EIK space

§2(a). Deferred for want of a signal.

## 4. Blast radius of D-2

Full scan of all 2,405 ЦАИС bundles. What happens to a mixed award depends on whether
`rebuild_consortium()`
([087_procurement_consortium.sql](../../scripts/db/schema/pg/087_procurement_consortium.sql)) finds
a named carrier, because that post-pass moves the full value onto one carrier row and zeroes the
members regardless of member count:

| Bucket                                                          | Awards | Contract value | Effect                                                                                                                                           |
| --------------------------------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SAFE** — a named ДЗЗД / Консорциум / Обединение member exists | 90     | €1,320m        | Value stays on that carrier; the fix only ADDS zero-value participation rows. **Corpus totals unchanged.** Includes the €451.5m Alstom contract. |
| **ATTRIBUTION MOVES** — no named carrier                        | 47     | €493m          | `rebuild_consortium()` mints a synthetic `obed-<md5>` entity holding the full value and zeroes the BG members that carry the money today.        |

Largest movers: `01351-2024-0020` (Булгартрансгаз, €180.6m + €67.4m, 5 BG firms), `00004-2024-0025`
(€41.6m, 1 BG firm), `00203-2025-0026` (€31.7m), `00233-2024-0091` (НКЖИ, €13.3m).

## 5. Tiers

**T0 — D-1: encode personal ids, never ship an ЕГН.**
A natural-person supplier keeps a stable identity, but the key is derived from the
**already-public contractor name**, not from the ЕГН: `np-<md5(normalised name):12>`, the same shape
as the existing `obed-<md5:12>` synthetic carriers.

Why name-derived rather than a hash of the ЕГН: an unsalted hash of a 10-digit number is
brute-forceable over a 10¹⁰ space in milliseconds, so it would still _be_ the ЕГН; and a genuinely
secret salt would make keys irreproducible across machines, breaking the determinism the content
keys and data gates depend on. The name is already published in `contractor_name`, so a
name-derived key leaks nothing new. Same-name collisions are acceptable and strictly better than
today, where `1234567899` pools 20 people.

Covers both ЕГН-shaped ids and the placeholder ids, which are equally not identities.
Ships alone, independent of D-2 — and should, since it is the only tier fixing a live exposure.
Needs a corpus scrub for existing rows plus a standing gate.

**T1 — D-2: keep letter-bearing foreign members, both paths.**
`normalize_eop.ts`: drop the `recoverForeign` gate. `normalize.ts`: give `contractorFields()` the
same resolver. Extend the ingest stats so the log distinguishes foreign-kept from
personal-id-encoded from junk, rather than one undifferentiated drop count
([ingest.ts:374](../../scripts/procurement/ingest.ts:374)).

**T2 — re-ingest and verify attribution.** Code done and VERIFIED on real data for one day
(`00042-2024-0005`): the normalizer emits 4 rows at €112,875,000 each summing to €451,500,000,
and `rebuild_consortium()` needed no change — it collapses to the named carrier at
`consortium_size = 4` with all three members at €0 and the month total byte-identical before
and after. The corpus-wide re-ingest is NOT done; it is an operator step.

Two traps found while verifying, both of which silently corrupt money:

- **The safe window is 2024-01-01…2025-12-31 ONLY — NOT 2026.** `--include-existing-buyers`
  warns it is for "windows with no OCDS (2024–2025)", and the header of
  [normalize.ts](../../scripts/procurement/normalize.ts) states АОП began publishing OCDS
  fortnight bundles in **Jan 2026**. Running the range to 2026-12-31 wrote 17,010 `eop-`
  twins alongside the authoritative OCDS rows — **+€6,298.2m of double-count**, all of it in 2026. Confirmed by the same run evicting **zero** twins in 2024 and 2025, i.e. those two
  years genuinely have no OCDS to collide with. Recovery is the pipeline's own primitive,
  `evictSupersededEopTwins(eopRows, ocdsRows)` from content_key.ts (OCDS is authoritative),
  applied to the affected month shards; it is idempotent. Everything from 2026 onward, and
  everything before 2024, must go through `ingest.ts` (the OCDS path), which performs that
  eviction itself.
- **`--cross-source-dedup` is the WRONG flag for a re-parse.** It drops a fresh row that
  content-matches one already on disk, and `contentKeys()` includes an amount-FREE key
  (`buyer:contractor:contractNo:dateSigned`). So the two BG rows matched and were dropped
  while the two Alstom rows were added at the new value/4 — €225.75m + €225.75m + €112.875m +
  €112.875m = **€677m against a €451.5m award**. Use `--include-existing-buyers` alone, whose
  `rowKey` upsert (`releaseId::contractId::contractorEik::tag`, amount excluded) overwrites the
  existing members at the new split. That flag warns it is only for windows with no OCDS
  (2024–2025); outside that window it double-counts, so the pre-2024 range needs the OCDS path
  re-run instead, not this one.
- **A re-parse REVERTS annex current values.** `amountEur` is the post-annex CURRENT value
  (`anexi_current_value.ts` flips it in place); re-parsing from raw writes the at-signing value
  back, which moved one month by −€83,583. `npx tsx scripts/procurement/anexi_current_value.ts
--apply` is idempotent and restores it exactly — the month returned to its byte-identical
  total. It MUST follow every re-ingest.

Order: `ingest_eop --backfill --include-existing-buyers --apply` (2024–2025 range) →
`anexi_current_value.ts --apply` → `rebuild_from_cache.ts` → `load_pg` →
`db:load:procurement-scopes:pg` → `contractor_search` → `contractor_rank` →
127 `company_public_money` → `db:load:graph:pg` → `db:load:person-search:pg`.

Expect the 47 no-named-carrier awards (€493m) to move onto synthetic `obed-` entities at that
point — decision D1, and the reason this is a deliberate operator run rather than a side effect.

**T3 — gates.**

- [invariants_pg.data.test.ts:141](../../scripts/db/tests/invariants_pg.data.test.ts:141) already
  asserts one carrier per group, members at €0, carrier `amount_eur == consortium_full_eur`. Must
  stay green untouched.
- Standing privacy gate: no `contracts.contractor_eik` passes ЕГН validation. Worth having
  regardless of everything else here.
- `00042-2024-0005` carries 4 members including both Alstom entities, carrier at €451.5m, members
  at €0.
- Corpus-total parity across the SAFE bucket.

**T4 — D-3, deferred.** Needs a signal we do not have offline. Options worth costing later: a TR
existence check (`tr_companies`) to distinguish a padded foreign id from a real zero-stripped BG
EIK; or using the nuts code _only_ where the lists align and length agrees. Not attempted in v1.

**T5 — cloud.** A full contracts reload is ~68 min and CPU-bound on `db-g1-small`. Sequence as in
T2. Nothing in this chain runs itself on the cloud side. **T0 needs to reach production
separately and sooner than the rest** — it is the tier that stops shipping personal data.

## 6. Reproducing the measurements

Every number above comes from scanning `raw_data/procurement/eop/*.json.gz` (58 MB, ~30 s) while
replicating `canonicalEik`/`isValidEik` exactly, plus queries against local Postgres for the served
state. Commit the scanner as a one-off under `scripts/procurement/` when T0 lands, importing the
real `eik.ts` helpers rather than reimplementing them — the first draft's error came from a
lookalike implementation, and a committed scanner that imports the real thing cannot drift.

## 7. Explicit non-goals

- **No per-member share derivation.** The source does not publish who collected what; the carrier
  collapse is the honest answer and 087 already implements it.
- **No special case for the Alstom contract.** The fix is the resolver and its two call sites.
- **No re-crawl.** Everything needed is in the raw cache — this is a re-parse.
- **No nuts-code namespacing.** Proven unreliable in §2(b).

## 8. Outcome of the OCDS re-parse (2026-08-04)

**Done.** `ingest.ts --renormalize` re-parsed all 11 cached OCDS bundles offline (the bundle
cache is keyed by `resourceUuid`, not `datasetUuid` — an earlier note here wrongly concluded
nothing was cached). Then `anexi_current_value.ts --apply` and `backfill_unp.ts --apply`
(18,750 rows), because a re-parse reverts annex current values and the OCDS export carries no
УНП. Corpus: **405,701 rows / €99,246,767,063.14**, all 535 data gates green.

What it fixed, beyond adding the foreign members:

- **The OCDS split denominator was under-counting.** It counted supplier REFS, not distinct
  resolved keys, and its self-deal predicate disagreed with its own emit loop. Rows sharing a
  contractorEik collapse at the month-shard merge, so the surplus merged away. Measured on the
  canary bundle alone: 38 contracts short, **€338,027.15 lost**. Post-fix, 1,332 of 1,334 EUR
  contracts in that bundle sum exactly to their published value; the 2 exceptions are the
  deliberate `amount_overrides`.
- `00044-2025-0148` (АПИ/Kapsch) now holds all 5 suppliers at €13,044,000 = **€65,220,000**,
  the published value, down from an inflated €78,264,000.

**The canary fixture was stale before any of this.** It predated two `amount_overrides` (÷100
publisher-error corrections, `546101::242653` and `540811::242345`, −€12.15m combined), so
regenerating it also absorbed that pre-existing drift. Worth knowing that the fixture only
guards drift _since its last reseed_, and nothing reseeds it automatically.

## 9. The "−€9.27m" was production over-stating, not local losing

Local sat €9,273,007.58 below the cloud baseline across 48 pre-2024 rows, in years never
re-ingested. The sign was the other way round: **cloud carries a cross-source double-count that
local does not.** Measured on Cloud SQL: **47 contracts, 48 rows, €9.27m.** Two examples:

- `00233-2023-0103` / 236349 — the same supplier (Вартекс ООД) at the same €903,145.98 present
  as BOTH an `eop-` and an `ocds-` row.
- `05397-2020-0009` / 80, 81, 82 — three `eop-` rows AND three `ocds-` rows, the feeds naming
  different suppliers at different amounts (eop: Сикюрити глобъл €1,400,389.58; ocds: Контракс
  €1,345,464.18), so no row-level content key could ever match.

Each feed splits a contract's value across its OWN view of the supplier set, so the two can
never be summed. This has been latent since well before this work and every existing gate stayed
green throughout.

### The durable fix is NOT in place — deliberately

A contract-level precedence rule ("once any non-EOP row exists for a contract, no EOP row for it
may survive") was implemented, committed, and **reverted** (`a4d6233043` → `b1a3fd982e`). Three
keying attempts, each wrong in a different way:

| Key                                        | Failure                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unp \|\| ocid` + contractId + tag         | The feeds mint different ocids for one contract and OCDS has no `unp` at parse time, so the same contract hashed differently per feed. Order-dependent on `backfill_unp`. |
| `awarderEik` + contractId + tag            | Far too coarse — buyers reuse trivial contract numbers. Destroyed **46 legitimate rows / €5.15m**; buyer 000133634 alone had six procedures numbered "1".                 |
| `unp` + `normContractNo(contractId)` + tag | Still evicted a contract's ONLY row (`01585-2021-0007`/26109), and its behaviour could not be reconciled with a direct group-key check.                                   |

Requirements for a correct implementation, learned the hard way:

1. Identity must be **feed-independent** and must not depend on a later backfill step.
2. It must not pool distinct procedures that share a contract number — the УНП (or an equally
   precise procedure id) is mandatory, and `normContractNo` normalisation is NOT safe here.
3. It must be validated by enumerating every row it would evict and confirming each has a
   surviving twin, on the real corpus, before being applied. A dry-run count is not enough:
   both bad versions reported plausible counts.
4. A `.data.test.ts` gate over the loaded database is the right home for the invariant, since
   the ingest cannot be trusted to achieve it in one pass.

## 10. Spec — the post-backfill reconciliation pass (and Tier A inside it)

### 10.1 Why a new pass, not another key

Four separate attempts to reconcile the two feeds inside the ingest have failed on the SAME
constraint, which is worth stating once as a law of this pipeline:

> **The УНП does not exist at parse time.** `normalize.ts` never sets `unp` — the АОП OCDS
> export carries none — and `backfill_unp.ts` writes it onto the shards afterwards, resolving
> the ocid through the tender shards.

Everything that identifies a _contract_ across the two feeds needs the УНП, because the ocid is
feed-namespaced (`eop-…` vs `ocds-e82gsb-…`) and the contract number alone is reused by buyers
across procedures. So any cross-source rule placed in the parse-time eviction is either inert or
wrong:

| Attempt                                    | Outcome                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| precedence keyed `unp \|\| ocid`           | inert — feeds mint different ocids                     |
| precedence keyed `awarderEik + contractId` | too coarse — destroyed 46 rows / €5.15m                |
| precedence keyed `unp + normContractNo`    | orphaned a contract's only row                         |
| survivor precondition keyed on `unp`       | inert — made 109,043 rows unevictable                  |
| the `p:` content net (Tier B)              | **correct, but inert at parse time** (8 evictions → 0) |

Tier B's net is right and is committed; it simply has no place to run. That place is a new pass.

### 10.2 Where it sits

```
ingest (parse, row-level eviction)      ← unchanged
  → anexi_current_value.ts --apply      ← a re-parse reverts annex current values
  → backfill_unp.ts --apply             ← УНП becomes available HERE
  → reconcile_cross_source.ts  ★ NEW    ← the pass
  → rebuild_from_cache.ts
  → db:load:pg  → scopes → persons-browse → person-search → graph
```

The two steps before it are not optional and are the reason it cannot move earlier. It must run
on the SHARDS, not in SQL: `pg_roundtrip.data.test.ts` asserts Postgres is a lossless capture of
the shards, so deleting rows in PG that exist on disk fails that gate (the same reasoning
`backfill_unp.ts` records for resolving УНП on the shards rather than at load time).

### 10.3 What the pass does — three stages

**Stage 1 — apply the identity bridge (Tier A).** Rewrite `contractorEik` from an `np-…`
name-hash to the natural person's real БУЛСТАТ, using a COMMITTED map (§10.4). Nothing is
deleted. This is what turns "the feeds name different suppliers" into "the feeds name the same
supplier", which is a precondition for stage 2 doing anything useful.

**Stage 2 — cross-source eviction.** Run `evictSupersededEopTwins` over each month shard with
the non-EOP rows as `arriving`. Post-backfill both sides carry a УНП, so the `p:` net fires and
the survivor precondition is satisfiable. Measured on the corpus in this shape: 8 evictions,
€4,033,793.05, zero orphans, every pair a named twin.

**Stage 3 — verify, and fail loudly.** Non-negotiable, because every failure in this area
reported a plausible count while corrupting data:

1. Emit every eviction as an **evicted → survivor pair**, never a bare count.
2. Assert no contract is left with zero rows.
3. Assert the corpus delta equals Σ evicted rows exactly.
4. Assert per-contract totals still reconcile to the published value where known.
5. Exit non-zero on any violation, before writing.

### 10.4 Tier A — the identity bridge

**Shape of the problem.** One feed publishes a natural person's ЕГН (encoded `np-<name-hash>`
by the privacy fix), the other their real БУЛСТАТ. Same person, keys that can never match:

```
00373-2022-0009/48251   eop  np-9ca38126f076  Здравко Георгиев Иванов
                        ocds 180055903        ЗДРАВКО ГЕОРГИЕВ ИВАНОВ
```

**Measured scope.** 104 `np-` keys; 18 have a real 9-digit EIK sharing their normalised name;
16 unambiguous, 2 ambiguous. Applying the 18 converts **11 of the 26** divergent-supplier mixed
contracts into identical-supplier ones, which stage 2 then resolves. 15 remain genuinely
divergent.

**A CURATED MAP, not a runtime heuristic.** `data/procurement/person_eik_bridge.json` —
`np-<hash>` → `{ eik, name, why }`, committed and reviewed, in the same spirit as
`amount_overrides.ts` and the officials re-slug maps. The set is 18 entries; it is enumerable,
so it should be enumerated. A wrong bridge merges two different people's public-money totals,
which is exactly the class of error that must not be produced by a threshold.

**Both ambiguities are placeholders, not real ambiguity.** `np-7f08382bd743` (Петър Атанасов
Андонов) offers `000000001` and `178957437`; `np-f1c825a0c878` offers `000000002` and
`180209155`. `000000001` carries **9 distinct contractor names across 16 rows** — a shared
placeholder — while the genuine БУЛСТАТ carries 1–2 (casing only). Note `tr_companies` is NOT a
usable filter here: none of these EIKs appear in it, because БУЛСТАТ sole-trader registrations
are absent from the commercial-register feed. So candidate rejection must key on the
many-names-one-EIK signal, and each surviving pair must be eyeballed before entering the map.

**Guard.** A `.data.test.ts` asserting no bridge target is shared by two different `np-` keys,
and no bridged EIK carries more than a casing-difference set of names.

### 10.5 Wiring

- `db:refresh` — insert between `backfill_unp` and `db:load:pg`.
- Cloud — no separate command; the pass rewrites shards, so `db:load:pg:cloud` carries it.
- Watch skills — `update-procurement` must run it after any ingest, or the corpus regains mixes.

### 10.6 Expected end state

Cross-source mixed contracts fall 27 → ~15, all `divergent-suppliers`, all genuine source
conflicts. Those 15 go into `ACCEPTED_CONFLICTS` in
`scripts/db/tests/single_source_per_contract.data.test.ts` (Tier C) with a one-line reason each,
and that gate turns green and stays green — which is the point: after this, a NEW mix is a real
regression rather than noise in a permanently-red check.

### 10.7 Explicit non-goals

- **No auto-resolution of genuine conflicts.** Two public sources naming different counterparties
  is not a scripting problem.
- **No change to `c:`/`f:`.** The `c:` net spans a contract and its amendment (pinned as a known
  hole). Tightening it reduces evictions and could increase double-counting — a separate,
  measured change.
- **No SQL-side deletion.** It breaks the lossless-capture invariant.

### 10.8 Implemented — and one larger defect the pass exposed

Built and applied: `scripts/procurement/reconcile_cross_source.ts`, the 18-entry curated bridge
`data/procurement/person_eik_bridge.json`, and two gates. Cross-source mixed contracts fell
**34 → 5**, all five genuine source conflicts, all allowlisted with a reason. Corpus 405,732 →
405,711. 4,086 unit + 542 data tests green.

Review found three criticals in the first draft, all fixed and all instructive:

- **The legacy-CSV key formula, wrong for the third time.** 4 of 45 bridged rows are
  `aop-legacy-…` yet hash under the ЦАИС 4-part form, because an earlier in-place fix already
  re-keyed them that way — so the formula cannot be inferred from `releaseId` either. `rekey()`
  now tries each candidate against the row's EXISTING key and reuses whichever reproduces it.
- **A dead assertion.** The orphan check filtered `evictions` for `survivors.length === 0`, a case
  `continue`d before the push — provably empty, so it could never fail. It now asserts over the
  WRITTEN corpus instead.
- **`db:refresh` invoked the pass without its prerequisites.** Run before `backfill_unp`, the pass
  does not fail, it destroys: 26 evictions / €184,136,811.83, all against different procedures,
  with verification green. Now guarded by a УНП-coverage preflight (71.3% actual, 40% floor) AND
  `db:refresh` runs `backfill_unp` → reconcile → `rebuild_from_cache` in order.

**The larger defect — NOT fixed, and bigger than what was.** The pass's survivor check keys on
(УНП, contract number, tag), and **the two feeds number the same contract differently**:
`00966-2020-0008` is contract "28" in ЦАИС and "231291" in OCDS, same procedure, same supplier
EIK, same €2,175,440.60 on both sides. So 13 of the 29 blocked candidates are genuine twins
(€2,503,573.48), and corpus-wide that population is **160 rows / €145,196,823.63** — invisible to
the pass AND to the Tier C detector, which shares the key.

That is an order of magnitude more than everything reconciled so far, and it is not fixable by
loosening this key: dropping the contract number gives (УНП, tag), which matches every lot of a
procedure and is exactly the over-reach that destroyed 46 rows. It needs a contract-identity
notion that survives renumbering — most likely (УНП, supplier, rounded €) — designed and measured
on its own, with the §10.3 protocol. Recorded here rather than attempted at the end of a long
session, because every failure in this area came from improvising a key.

## 11. Fresh measurement pass (2026-08-04)

Done because §10.8's headline was arrived at late and by inference. It is **wrong**, and this
section replaces it. Method: measure the same population under an identity lattice instead of
defending one key, across all four feed namespaces, then grade the result by an independent field.

All groups below are within one `tag`, require a УНП and a contractor EIK, exclude synthetic
`obed-` carriers, and count the "lesser side" — the rows and € that would go if one feed were
dropped.

### 11.1 The identity lattice

| Identity                                                       | Groups | Rows  | €            |
| -------------------------------------------------------------- | ------ | ----- | ------------ |
| **A** `unp + contract_id` — what the shipped gate and pass use | 129    | 147   | €5,994,650   |
| **B** `unp + contractor`                                       | 1,192  | 2,371 | €461,594,510 |
| **C** `unp + contractor + rounded €`                           | 225    | 249   | €147,807,238 |
| **D** `unp + contractor + date_signed`                         | 165    | 186   | €46,146,247  |

B is plainly too loose — it matches every lot of a procedure, which is the over-reach that
destroyed 46 rows when used as a deletion rule. C is the §10.8 population.

**`contract_id` differs in ~99% of C's groups** (89/89 eop+ocds, 83/83 aop+eop, 42/46 aop+rop,
7/7 aop+ocds). Identity A is therefore structurally blind to the whole class, not merely
imperfect.

### 11.2 The feed matrix — and a pair never examined

| Pair        | Groups | € (lesser)       |
| ----------- | ------ | ---------------- |
| **aop+eop** | 83     | **€123,214,481** |
| eop+ocds    | 89     | €14,755,019      |
| aop+rop     | 46     | €7,213,595       |
| aop+ocds    | 7      | €2,624,143       |

Everything in §§1–10 was about `eop` vs OCDS. **`aop+eop` — legacy CSV against the ЦАИС flat
feed — is 8× larger by money and had never been looked at.** That is the single most useful thing
this pass found, and it is a direct consequence of the two-feed model criticised in §2(b):
`NOT LIKE 'eop-%'` lumps aop, ocds and rop together, so an aop↔eop pair never even enters the
detector's HAVING clause.

### 11.3 Grading by date agreement

| Date gap   | Groups | €           | Reading                                                         |
| ---------- | ------ | ----------- | --------------------------------------------------------------- |
| same date  | 79     | €39,331,728 | duplicate — the two feeds' numbering differs, nothing else does |
| 1–7 days   | 5      | €678,245    | duplicate; publication lag                                      |
| 8–31 days  | 18     | €6,036,395  | probably duplicate                                              |
| 1–3 months | 26     | €15,979,196 | uncertain                                                       |
| >3 months  | 97     | €85,781,674 | probably DISTINCT contracts                                     |

Worked examples that make the top row concrete — same procedure, supplier, amount and date, with
only the contract number differing:

- `00087-2020-0065` — `aop:32038` vs `eop:СОА21-ДГ55-32`. ЦАИС's internal id against Sofia
  municipality's own reference. One contract, two numbering systems.
- `00752-2017-0030` — `aop:12491оп352` vs `rop:УРИ 12491оп - 352`. Literally the same number
  modulo a "УРИ" prefix and punctuation.
- `02023-2023-0001` — `aop:118779` vs `eop:118827`, same day: adjacent ЦАИС sequence ids.

### 11.4 §10.8 overstated the problem

**Claimed there: 160 rows / €145,196,824 of invisible duplicates. That was identity C in full,
ungraded.** The defensible duplicate set is same-date through 31 days: **102 groups /
€46,046,368**. The €85.8m sitting >3 months apart is most likely distinct contracts.

And frameworks do NOT explain that tail — only **22%** of those 97 groups carry any `рамк`
signal in title, method or category (against 5% in the same-date bucket). So the tail is neither
dismissible nor actionable as a class; it needs case-by-case judgement.

### 11.5 What this implies

1. **Widen the detector to the full feed matrix.** A two-feed `eop` vs everything-else model hides
   the largest exposure. This is a cheap change to
   `single_source_per_contract.data.test.ts` and is the highest-value next step.
2. **Adopt `unp + contractor + rounded € + date_signed` as the reconciliation identity** — 79
   groups, and by construction it cannot pool contracts signed on different days, which is what
   every failed key did.
3. **Do not touch the >3-month tail programmatically.** 97 groups / €85.8m, 78% unexplained.
4. Only then revisit the 1–3 month band (26 groups / €16.0m).

Numbers reproduce from local Postgres at 405,711 shard rows / €99,244,771,522.10.
