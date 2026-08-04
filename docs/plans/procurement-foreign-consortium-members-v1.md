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
the Alstom class, **311 rows / 199 distinct**. The first draft measured "foreign" with a
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
