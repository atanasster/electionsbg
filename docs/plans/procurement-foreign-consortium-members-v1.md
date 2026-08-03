# Foreign consortium members are dropped from the contracts corpus — v1

**Status:** plan only, nothing implemented.
**Found:** 2026-08-03, while tracing the НПВУ 4th-payment projects (Alstom trains).

## 1. The defect

A joint award (обединение / ДЗЗД / консорциум) is published by ЦАИС ЕОП as ONE record whose
supplier fields are semicolon-joined lists. On the biggest RRF rolling-stock contract
(УНП `00042-2024-0005`, МТС, €451.5m, `raw_data/procurement/eop/2025-05-02.json.gz`,
noticeId 686114) the source says:

```
supplierRegisterNumber = 181339162; RO6640696; IT02791070044; 207661045
supplierName           = КОНСОРЦИУМ БУЛЕМУ; ALSTOM TRANSPORT SA; Alstom Ferroviaria SpA; РВП ИНВЕСТ ЕООД
supplierNutsCode       = BG411; RO321; ITC16; BG411
```

Our corpus holds **two** of those four. Both Alstom entities — the actual manufacturers — are
gone. Searching the corpus for "Alstom" returns nothing on the contract that bought Alstom
trains.

Two independent code sites cause it:

| Path | Site | Behaviour |
|---|---|---|
| ЦАИС ЕОП flat договори | [normalize_eop.ts:381](../../scripts/procurement/normalize_eop.ts:381) | Non-BG member of a **mixed** consortium is dropped. Foreign suppliers survive only when a contract has **no** BG supplier at all (`recoverForeign = bgCount === 0`). |
| АОП OCDS export | [normalize.ts:196](../../scripts/procurement/normalize.ts:196) | `contractorFields()` returns `null` for any id failing `isValidEik`. **No foreign path at all** — strictly worse than the flat feed. |

The flat-feed behaviour is deliberate and documented ("historical behaviour: dropped"); the OCDS
path simply never got the foreign-vendor recovery that `resolveSupplierEik` added to the flat one.

**They must be fixed together.** `contentKeys()` in
[content_key.ts](../../scripts/procurement/content_key.ts) embeds `contractorEik` and the rounded
`amountEur`. If one path emits 4 rows at value/4 and the other 2 rows at value/2, no content key
collides, cross-source dedup stops matching, and the same logical contract survives from both
feeds — a double count. Fixing one path alone is worse than fixing neither.

## 2. Measured blast radius

Full scan of all 2,405 ЦАИС bundles (script in §6):

- 4,647 multi-supplier awards in the corpus.
- **211** have at least one genuinely foreign member currently dropped, after excluding
  anonymised natural persons (`не се публикува` and friends, which are already handled as
  identity-less by `UNPUBLISHED_SUPPLIER`).

What happens to each depends on whether `rebuild_consortium()`
([087_procurement_consortium.sql](../../scripts/db/schema/pg/087_procurement_consortium.sql))
finds a named carrier, because that post-pass moves the full value onto one carrier row and zeroes
the members regardless of how many members there are:

| Bucket | Awards | Contract value | Effect of the fix |
|---|---|---|---|
| **SAFE** — a named ДЗЗД / Консорциум / Обединение member exists (`is_consortium_name`) | 90 | €1,320m | Value stays on that carrier. The fix only ADDS zero-value participation rows. **Corpus totals unchanged.** Includes the €451.5m Alstom contract. |
| **ATTRIBUTION MOVES** — no named carrier | 47 | €493m | `rebuild_consortium()` mints a synthetic `obed-<md5>` entity holding the full value and zeroes the BG members that carry the money **today**. |

The second bucket is the whole risk. Largest cases:

| УНП | Value | BG firms credited today | Foreign member added |
|---|---|---|---|
| `01351-2024-0020` (Булгартрансгаз) | €180.6m + €67.4m | 5 | ХИЛ Интернешънал Н.В. |
| `01351-2024-0020` | €51.1m | 2 | ХАБАУ С.Р.Л. (RO), ДИВИКОМ ИНК. (US) |
| `00004-2024-0025` (ВиК) | €41.6m | 1 | ОРИОН КЪНСТРАКШЪН с.р.о. |
| `00203-2025-0026` | €19.9m + €11.8m | 2 | Хайгър Бус Кампъни |
| `00233-2024-0091` (НКЖИ) | €13.3m | 1 | Hitachi Rail GTS Austria |
| `00044-2023-0030` (АПИ) | €17.9m | 2 | two HU entities |

Moving that money is *more correct* — we genuinely do not know each member's share, which is
exactly the reasoning in 087's header comment — but it silently rewrites 47 companies'
public-money totals and cascades into `/company/:eik`, `contractor_rank` (122),
`company_public_money` (127), the connections graph, `person_search`, and every person-linked
money figure. That has to be a decision, not a side effect.

## 3. Three guards the classifier does not have yet

All three are present in the real data and would ship bad keys the moment foreign members are kept.

**G1 — personal identity numbers.** `00258-2022-0003` lists
`Венцеслав Георгиев Делов [6207316703]` — a 10-digit personal number in the supplier-id field, not
a company id. Keeping it writes an ЕГН into a served table and into a public URL
`/company/6207316703`. This is the one guard that is not merely a data-quality issue.
`resolveSupplierEik` currently has no notion of a personal id: a 10-digit token fails the 9/13
length test, falls through to the "genuine foreign vendor" branch, and becomes a contractor key.

**G2 — junk ids.** `Лантания АД [0000]` and `сдружение "ВОДОПРОВОДНА МРЕЖА…" [0]` normalize to
keys `0000` and `0`, pooling unrelated firms into one phantom entity. Needs a minimum-entropy
rule (reject all-zero / <4 significant characters).

**G3 — foreign 9-digit ids masquerading as BG EIKs.** Already live and already wrong:
Шкода Вагонка а.с. is keyed `025870637` and Шкода Транспортейшън а.с. `062623753` — Czech
registry numbers that pass `isValidEik` (9 digits) and are now indistinguishable from Bulgarian
EIKs. Neither is in `tr_companies`. A Bulgarian company on a colliding EIK would merge with
Škoda. `supplierNutsCode` (`BG411; RO321; ITC16; BG411`) is the discriminator the feed already
gives us and the normalizer ignores.

G3 has a cost the other two don't: re-keying Škoda and Stadler changes `contractor_eik` values
that are live in URLs, so it needs either a retirement map or a conscious decision to break them.

## 4. Decisions needed before coding

- **D1 — the 47 attribution-moving awards.** Accept the move to synthetic `obed-` entities in
  v1 (correct, but rewrites €493m of company-level attribution), or restrict v1 to the SAFE
  bucket and handle no-named-carrier groups separately? *Recommendation: accept it.* Splitting
  the fix leaves the corpus in two different attribution regimes depending on whether a
  consortium bothered to register a name, which is harder to explain than either end state.
- **D2 — country namespacing (G3).** Namespace all foreign keys as `<CC>-<id>` from
  `supplierNutsCode`, re-keying the existing Škoda/Stadler/Leonardo rows? Or namespace only
  newly-kept members and leave the live keys alone? *Recommendation: namespace everything*, since
  leaving them creates a permanent silent-collision class, and these pages have negligible
  inbound traffic compared with the risk.
- **D3 — do foreign members get a `/company/:eik` page?** They have no TR record, no ГФО, no
  founding date. Checked: [011_company_api.sql:60](../../scripts/db/schema/pg/011_company_api.sql:60)
  already sums `consortium_full_eur` for `consortium_role = 'member'` into `consortium_eur`, so
  participation-only companies are an existing, handled shape. Leaning: yes, no new UI work,
  but confirm the page reads sensibly with every enrichment table empty.

## 5. Tiers

**T1 — classifier, pure function, no corpus change.**
Extend `resolveSupplierEik` to return a `kind: 'bg' | 'foreign' | 'person' | 'anonymous' | 'junk'`
alongside `{eik, foreign}`, add the G1/G2/G3 rules, and thread `supplierNutsCode` in for the
country prefix. Unit tests in
[normalize_eop.test.ts](../../scripts/procurement/normalize_eop.test.ts) seeded from the real
records above: Alstom `RO6640696` / `IT02791070044`, Hitachi `FN278233T`, Higer
`91320594714112290N`, HABAU `13092995`, the ЕГН row, both `[0]` rows, and Škoda `025870637`
(which must now classify as foreign despite passing `isValidEik`). This tier is fully testable
with no reload.

**T2 — wire both normalizers.**
`normalize_eop.ts`: delete the `recoverForeign` gate; keep every non-person, non-junk supplier and
split across the surviving keys. `normalize.ts`: give `contractorFields()` the same resolver.
Extend the ingest stats to `rowsForeignKept` / `rowsDroppedPersonalId` / `rowsDroppedJunkId` so the
log line at [ingest.ts:374](../../scripts/procurement/ingest.ts:374) shows what the classifier
actually did rather than one undifferentiated drop count.

**T3 — re-ingest and verify attribution.**
`rebuild_consortium()` should need **no change** for the SAFE bucket — the equal-split signature
(`count(DISTINCT round(amount_eur::numeric,2)) = 1`) still holds at value/4, and the named carrier
still absorbs the total. Verify that on a real local reload rather than assuming it. Whatever D1
decides applies here. Then, in order: `load_pg` (calls `rebuild_consortium()` after the MERGE) →
the six scoped matviews via `db:load:procurement-scopes:pg` → `contractor_search` →
`contractor_rank` → 127 `company_public_money` → `db:load:graph:pg` → `db:load:person-search:pg`.

**T4 — gates.**
- [invariants_pg.data.test.ts:141](../../scripts/db/tests/invariants_pg.data.test.ts:141) already
  asserts exactly one carrier per group, all members at €0, and carrier `amount_eur ==
  consortium_full_eur`. It must stay green untouched — that is the primary safety net.
- New `.data.test.ts`: `00042-2024-0005` carries 4 member EIKs including both Alstom entities,
  the carrier holds €451.5m, every member row is €0.
- New standing privacy gate: **no** `contracts.contractor_eik` matches the ЕГН shape. This one is
  worth having regardless of the rest of the plan.
- Corpus-total parity: `SUM(amount_eur)` over the SAFE bucket must be byte-identical before and
  after. For the 47 moving awards, assert the *group* total is preserved even though the per-firm
  split changes.

**T5 — cloud.**
A full contracts reload is ~68 min and CPU-bound on `db-g1-small`
([reference](../../CLAUDE.md)). Sequence it as in T3; nothing in this chain runs itself on the
cloud side.

## 6. Reproducing the measurement

The numbers in §2 come from a full scan of `raw_data/procurement/eop/*.json.gz` classifying each
multi-supplier award's ids into BG-recoverable / foreign / anonymised and bucketing by whether any
supplier name matches `is_consortium_name`'s regex. It runs in about 30 s over the 58 MB of
bundles. Worth committing as a one-off under `scripts/procurement/` behind a flag when T1 lands,
so the before/after counts are checkable rather than quoted from this document.

## 7. Explicit non-goals

- **No per-member share derivation.** The source does not publish who collected what; the carrier
  collapse is the honest answer and 087 already implements it.
- **No special case for this contract.** The fix is the classifier and the two call sites.
- **No re-crawl.** Everything needed is already in the raw cache — this is a re-parse, which is
  why the measurement above could be taken at all.
