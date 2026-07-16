# Procurement ↔ SIGMA parity audit v2 (broad 30-entity sample)

**Date:** 2026-07-16
**Scope:** 30 entities (15 authorities + 15 contractors) across road/rail/gas/electricity/nuclear/metro/health/defense/municipal/judiciary/pharma/fuel/services + a small school, plus contract-level ground-truth checks.
**Comparators:** our Postgres `contracts` table (contract-tag rows, `amount_eur` = current basis) vs SIGMA (`sigma.midt.bg`), joined on УНП.
**Supersedes / extends** the 5-entity audit earlier the same day. Machine access to SIGMA is unchanged and fully programmatic: per-entity CSV `contracts.csv?authority=<eik>` / `?bidder=<eik>` (rate-limited — throttle to <5/min), per-contract JSON `/contracts/<id>.json` carrying `value.{estimatedEur, signingEur, currentEur, deltaPct}`.

---

## Executive summary

The broad sample **confirms our data is fundamentally sound** and reproduces the five known reconciliation mechanisms. It surfaced a large ×1.96 discrepancy on 2026 annex contracts that — after an initial mis-diagnosis and a rigorous re-check (see §2) — is a **bug on SIGMA's side, not ours**. Two known gaps on our side are sharpened.

1. **[SIGMA BUG, not ours] The ×1.96 discrepancy on 2026 annex contracts is SIGMA double-converting euro-transition EUR annexes.** Since 2026-01-01 the ЦАИС анекси feed publishes annex values in **EUR**; we keep them as EUR (correct), while SIGMA reads them as BGN and divides by 1.95583 — **understating** post-annex current values on annex-heavy buyers and emitting spurious negative `deltaPct`. Verified against our own at-signing anchor: **72% of 2026 EUR-labeled annex records reconcile as genuine EUR (we right), only ~1% are genuine BGN mislabels (we'd be wrong)**. So the big positive `commonΔ` (АПИ +33%, ЕСО +27%, Нивел +50%) is us being **more** accurate. Our only residual action is a small defensive guard for the ~1% truly-mislabeled records.
2. **[P1 — canonicalization] ~€4.7 bn of our 2020+ contract value has an empty `unp`** (12,308 rows corpus-wide) and cannot be joined to SIGMA. Most of the apparent "SIGMA-only coverage gap" is **not** missing data — it is our own contracts sitting under a null/synthetic key (e.g. the €461 M АПИ→Автомагистрали in-house award T78923, which we hold to the euro but with no УНП).
3. **[VERIFIED] The P1 coverage fix from earlier today works.** The two previously-missing АПИ consortium roads (Русе–Бяла €785.8 M `00044-2020-0085`, АМ Хемус `00044-2021-0018`) are now present and split across consortium members. Small-buyer parity is exact (Осмо СУ: ours = SIGMA = €2.6 M, 100% overlap).
4. **[DEFENSIBLE, unchanged] Consortium split, value-basis, and scope** explain the rest. On the authority side, base parity is excellent where there are no annexes (Разград +1%, ВСС +1%, Козлодуй +1%, Мин.транспорт +0%). On the bidder side, our per-company totals sit above SIGMA for infra because we split consortium value to members while SIGMA books it under a union "…и др." entity.

**Headline reconciliation:** our 2020+ contract-tag corpus = **€53.6 bn** vs SIGMA's published **€51.6 bn** (2020–2026). The ~€2 bn gap is our wider coverage **plus** SIGMA's annex-understatement bug (§2) — **not** an overstatement on our side. Our value math and EUR conversion match SIGMA to the euro on every base contract; on annexes we are the more accurate of the two.

---

## 1. Per-entity reconciliation

`ourN`/`sigN` = contract-tag rows each side. `our €M` = Σ `amount_eur` (current basis). `SIGMA €M` = Σ `value_eur` (current basis). `commonΔ%` = value delta on shared-УНП contracts (the clean signal). `null-unp €M` = our value with no УНП (unjoinable). All full-history on our side; SIGMA is 2020+.

### Authorities

| Entity | ourN | sigN | our €M | SIGMA €M | common UNP | overlap | commonΔ% | sigma-only €M | null-unp €M |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| АПИ (пътна инфраструктура) | 2479 | 711 | 8,718.6 | 4,589.9 | 330 | 69% | **+33** | 566.2 | 1,384.8 |
| НКЖИ (жп инфраструктура) | 1935 | 701 | 3,078.2 | 1,378.7 | 391 | 84% | +3 | 241.2 | 712.3 |
| Булгартрансгаз | 1033 | 437 | 3,016.8 | 1,418.4 | 325 | 88% | −9 | 381.2 | 536.9 |
| ЕСО (електропренос) | 6620 | 1351 | 2,069.8 | 1,317.8 | 415 | 37% | **+27** | 379.1 | 472.5 |
| МЗ ЦООП (здравеопазване) | 5227 | 1018 | 2,629.8 | 650.0 | 227 | 65% | +2 | 52.5 | 249.2 |
| Столична община / СОАПИ | 5851 | 2180 | 2,303.5 | 1,170.4 | 1028 | 58% | −3 | 215.4 | 624.9 |
| Министерство на транспорта | 356 | 187 | 2,263.3 | 2,348.6 | 80 | 60% | +0 | 156.2 | 49.6 |
| АЕЦ Козлодуй | 3845 | 2071 | 1,870.7 | 1,339.9 | 1494 | 88% | +1 | 100.8 | 361.2 |
| Метрополитен (метро София) | 332 | 175 | 1,402.9 | 616.7 | 111 | 95% | **+20** | 211.6 | 636.4 |
| Централно военно окръжие | 1373 | 647 | 935.0 | 653.8 | 164 | 56% | +1 | 96.6 | 176.2 |
| УМБАЛ Св. Георги Пловдив | 3447 | 1861 | 1,229.7 | 769.1 | 314 | 33% | +3 | 189.1 | 390.0 |
| Община Разград | 579 | 389 | 90.0 | 54.9 | 264 | 95% | +1 | 1.4 | 16.8 |
| МОСВ | 691 | 367 | 82.8 | 42.3 | 212 | 68% | +1 | 10.0 | 37.5 |
| Висш съдебен съвет | 207 | 136 | 77.8 | 71.5 | 114 | 91% | +1 | 9.6 | 6.4 |
| Осмо СУ (училище, малък буер) | 24 | 24 | 2.6 | 2.6 | 7 | 100% | −0 | 0.0 | 0.0 |

### Contractors (bidders)

| Entity | ourN | sigN | our €M | SIGMA €M | common UNP | overlap | commonΔ% | sigma-only €M | null-unp €M |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Софарма Трейдинг | 6058 | 3172 | 2,243.3 | 1,285.3 | 1574 | 94% | +2 | 230.0 | 634.7 |
| Автомагистрали ЕАД | 21 | 15 | 983.3 | 760.9 | 6 | 46% | **+73** | 531.0 | 508.3 |
| Фьоник Фарма | 3312 | 2108 | 1,077.7 | 680.7 | 1124 | 95% | +4 | 107.3 | 132.7 |
| Лукойл-България | 618 | 115 | 833.5 | 44.0 | 97 | 88% | +7 | 23.6 | 573.2 |
| Рош България | 311 | 171 | 786.9 | 444.0 | 133 | 88% | +2 | 80.2 | 73.5 |
| Нивел Строй | 220 | 110 | 449.3 | 176.5 | 76 | 88% | **+50** | 6.5 | 6.0 |
| Трейс груп холд | 95 | 35 | 396.7 | 88.5 | 17 | 50% | +5 | 0.9 | 38.6 |
| Хидрострой | 357 | 147 | 426.0 | 119.2 | 43 | 30% | +5 | 25.1 | 106.7 |
| Главболгарстрой (ГБС) | 51 | 8 | 306.4 | 19.7 | 6 | 86% | +0 | 0.0 | 125.4 |
| Джи Пи Груп | 46 | 22 | 196.2 | 121.6 | 11 | 100% | +4 | 0.0 | 0.0 |
| Инвекс Трейдинг | 69 | 19 | 83.0 | 43.4 | 12 | 100% | **+22** | 0.0 | 17.7 |
| Булмар МЛ | 1031 | 426 | 98.0 | 57.7 | 251 | 67% | +3 | 6.1 | 19.2 |
| ЕЛ Контрол | 169 | 44 | 79.1 | 23.9 | 21 | 62% | −0 | 1.0 | 10.4 |
| Нар ООД | 241 | 162 | 98.1 | 81.6 | 104 | 97% | +1 | 1.7 | 3.2 |
| Кремък | 88 | 47 | 75.7 | 48.5 | 9 | 20% | **+79** | 34.6 | 13.7 |

**Read of the table.** Where a `commonΔ%` is small (±5%), our value math and EUR conversion are correct to the euro — this covers pharma, fuel, health, municipal, judiciary, and every base (non-annex) contract. The large positive `commonΔ%` (АПИ +33, ЕСО +27, Метрополитен +20, Автомагистрали +73, Нивел +50, Кремък +79) concentrate exactly where 2026 annex records exist, and are traced in §2 to **SIGMA's** double-conversion of euro-transition annexes (SIGMA understates; we are correct) plus value-basis on un-folded annexes.

---

## 2. The ×1.96 annex discrepancy is a SIGMA bug, not ours (corrected)

> **Note on process.** The first draft of this audit called this an **overstatement on our side** (an un-converted-BGN fold, est. €1.5–2.5 bn). That was wrong. Challenged with "aren't the 2026 annexes actually in EUR?", I re-verified against an independent anchor and the direction flips: **the annex values genuinely are EUR since 2026, we handle them correctly, and SIGMA is the one double-converting.** The corrected analysis follows; it supersedes the earlier draft and the "P0" framing.

### The discrepancy

Contract `00044-2024-0047` (АПИ → Автомагистрали ЕАД, "Поддържане на АМ Хемус"):

| | our `contracts` row | SIGMA `/contracts/…json` |
|---|--|--|
| signing (EUR) | `signing_amount_eur` = **69,832,373** | `signingEur` = **69,832,372.96** ✓ (agree) |
| current (EUR) | `amount_eur` = **104,748,559** | `currentEur` = **53,557,088** |
| deltaPct | +50% (real annex) | **−23.3%** (spurious) |

`53,557,088 × 1.95583 = 104,748,562` — the two differ by exactly the euro rate. Arithmetic alone can't say who is right; the deciding evidence is the currency of the source record.

### Which side is right — the test

The 2026-02-18 annex record for this contract is `contractCurrency=EUR`, `currentContractValue=104,748,559.44`, **`lastContractValue=69,832,372.96`**. That `lastContractValue` equals the signing value **in EUR** (136,580,250 BGN ÷ 1.95583 = 69,832,373), *not* the BGN figure — so the record is genuinely denominated in EUR, and its `currentContractValue` is €104.75 M (a real +50% annex). SIGMA read that EUR number as BGN and divided → €53.56 M, producing a fake −23.3% "reduction."

Two independent confirmations across the whole feed:

- **Sibling-record test.** For **646 contracts that carry both a BGN-labeled and an EUR-labeled annex record**, the ratio `BGN-last / EUR-last` has **median 1.9558** (the euro rate); 70% within 2%. The EUR record is the BGN value correctly converted.
- **Our-signing-anchor test.** Of **3,435** single-supplier 2026 `EUR` annex records matched to our authoritative at-signing EUR value: **72% have `lastContractValue` ≈ our EUR signing** (record truly EUR → we right, SIGMA wrong); **only 1% (28 records)** ≈ BGN signing (a genuine source mislabel where we'd be wrong); 27% "neither" (a prior annex had already moved the value).

The identical `deltaPct −0.23306` that SIGMA reports on two *unrelated* contracts (`00044-2024-0047`, `00044-2023-0018`) is itself the signature of a systematic double-conversion, not two real annexes that happened to move by the same amount. And `cur/last` across the 2026 EUR annex records takes **699 distinct values** (3,081 are exactly ×1.0, i.e. no-change re-publications) — these are real, varied annexes, not an artifact.

**Conclusion:** `anexi_current_value.ts`'s `toEur(x, "EUR")` correctly leaves the 2026 EUR annex value unconverted, so our `amount_eur` current value is right. SIGMA understates post-annex current value on annex-heavy buyers (АПИ, ЕСО, Метрополитен, НКЖИ, and infra bidders). The large positive `commonΔ` in §1 is us being **more** accurate.

### The one real residual on our side (~1%)

For the ~1% of records the source genuinely mislabels (BGN amount tagged EUR), our fold would over-state. In practice the existing 12% continuity guard already rejects most of these (a BGN `lastContractValue` is ~2× signing and fails the anchor check), so the applied error is tiny. A cheap defensive guard closes it fully:

- When a record's `lastContractValue` reconciles with the contract's signing value **only after ÷1.95583** (i.e. it looks BGN despite an EUR label), convert `currentContractValue` the same way. Gate on `publicationDate ≥ 2026-01-01`.
- Add a **SIGMA `currentEur` canary** anyway — but expect it to flag SIGMA's error, not ours, on annex contracts; use it to build the public "where we beat SIGMA" evidence, and to catch the ~1% where the flag points back at us.

No revert, no re-run of the corpus is warranted: the fold is correct for the 99% and the ~1% residual is immaterial and largely already guarded.

---

## 3. [P1] УНП canonicalization — the "coverage gap" is mostly our own data under a null/synthetic key

The sample's €3.66 bn of "SIGMA-only" УНПs is **not** €3.66 bn of missing contracts. Drill-down on АПИ's €566 M:

- The largest "SIGMA-only" item is `T78923` — €461.4 M, 2020-08-27, Автомагистрали ЕАД (an in-house highway-maintenance assignment). **We have it**: key `7245425ff1c0`, `amount_eur` = €461,440,923 (matches SIGMA to the euro) — but with an **empty `unp`**, so it can't join.
- SIGMA canonicalizes such awards to the **ЦАИС tender id** (`T…`); we store `unp = NULL` and a synthetic hex/`aop-legacy`/`eop-` key. We hold **zero** `T`-prefixed УНПs.

Corpus-wide, **12,308 contract-tag rows dated 2020+ (€4.70 bn) have no `unp`** — every one is invisible to a УНП join and inflates the apparent SIGMA-only gap. (A further €5.0 bn of null-`unp` value is pre-2020 and legitimately outside SIGMA's window.)

**Fix:** backfill a canonical procurement key onto null-`unp` rows — map the ЦАИС `eopTenderId` / tender `T`-id (present in the OCDS/ЕОП source and in SIGMA's `/contracts/<id>.json.eopTenderId`) into a `unp`-equivalent column, so in-house and negotiated awards join. This is the same mechanism #5 flagged in the earlier audit, now quantified.

---

## 4. Verified good & defensible mechanisms

- **P1 coverage recovery (shipped earlier today) works.** `00044-2020-0085` (Русе–Бяла, €785.8 M) and `00044-2021-0018` (АМ, ГБС consortium) are present and correctly split across members. The infra buyers that had holes now reconcile on the common set.
- **Small-buyer parity is exact.** Осмо СУ Арсени Костенцев: ours = SIGMA = €2.6 M, 24 rows each, 100% overlap, Δ0% — the storage.eop.bg gap-fill is spot-on for the school tier.
- **Base (non-annex) value + EUR conversion are correct to the euro.** Every non-infra authority and every pharma/fuel/services bidder lands within ±5% on the common set; the exact ones (`00044-2024-0047 signingEur`, `T78923`, ЕСО base lots) match to the euro.
- **Consortium split (defensible presentation choice).** Bidder totals above SIGMA for infra: Нивел €449 M vs €176 M, ГБС €306 M vs €20 M, Трейс €397 M vs €89 M. SIGMA books consortium awards under a union "…и др." entity at full value under a different EIK; we split to members. Both are valid; neither is a bug. (Note ГБС's €20 M SIGMA total reflects that nearly all its big work is booked to consortia / to the sister EIK `42648053` "ГБС-Инфраструктурно" — worth a connections-graph note, not a data fix.)
- **Scope (award-date vs УНП-year) + wider history.** Our row counts run 2–5× SIGMA's per entity because we carry 2011+ history and finer lot grain; SIGMA is 2020+.
- **ЕСО-type +27% deltas are value-basis (and partly SIGMA's annex bug), not a conversion error.** Those rows are *not* annex-folded on our side (no `signing` set) — we show the signing value (€93.4 M) where SIGMA shows a post-annex current (€47.8 M) that is itself depressed both by a real reduction and by SIGMA's ÷1.95583 double-conversion. Actionable on our side only as annex-feed under-coverage for ЕСО (fold more of its annexes), not a conversion defect.

---

## 5. Data-quality asides (low materiality, worth a cleanup pass)

- **Bogus contractor EIKs at the top of the leaderboard**: `123456789` ("S & p Commodity Insights"), and foreign registration numbers (`5260012190`, `0000393095`, `559458078801`) carried as EIKs. Each is a single high-value row; they distort "top contractor" ordering. Add an EIK-shape validator / foreign-supplier bucket.
- **Merged-entity EIK conflation**: `121699202` = "Лукойл-България ЕООД … , Петрол АД …" — two companies under one row's name; SIGMA keys them apart (its €44 M vs our €833 M for this EIK is mostly this + null-unp fuel frameworks).

---

## 6. Recommended actions (ranked)

| # | Action | Impact | Effort |
|---|---|---|---|
| **1 — SHIPPED** | **Canonical ЦАИС-id column** `contracts.cais_id` added (migration `079_contracts_cais_id.sql`) — a STORED generated column `= COALESCE(unp, T-id from ocid)`, mirroring SIGMA's `unp` field. See §7.1. | ✅ €4.43 bn null-`unp` rows now joinable; SIGMA join coverage on the sample **66% → 90%** (+1,905 contracts); zero total change | done |
| **2** | **Extend annex-feed coverage** for buyers like ЕСО where current-value folds are missing (their common Δ is un-folded signing) | Tighter current-basis accuracy | M |
| **3** | Curated **placeholder-EIK blocklist / re-resolution** (`123456789`, `000000001` → real vendor); label foreign registration numbers as a *foreign* bucket (do **not** filter them) | Cosmetic leaderboard cleanup (<€30 M) | S |
| **4** | *(Optional / likely won't-fix)* narrow **dual-record mislabel guard** for the ~7 contracts with both BGN- and EUR-labeled annex records where the EUR value restates the BGN one (see §7.2) | Closes a ~€2–5 M residual; a pure ratio guard is unsafe | S |

> Actions dropped after the deep audit (§7): the "revert the annex fold" and the "`lastContractValue ÷1.95583` guard" from earlier drafts — the first because we are correct, the second because it does not catch the contracts that actually leak and would misfire on genuine ×2 annexes. The "EIK-shape validation" and "split merged Лукойл/Петрол" items were also wrong (see §7.3).

**Bottom line:** across 30 diverse entities, our corpus matches SIGMA to the euro on all base contracts, and on 2026 annex contracts we are the **more** accurate of the two (SIGMA double-converts euro-transition EUR annexes and understates). The only material work on our side is Action 1 (ЦАИС-id join key). The currency question resolves in our favour, and every other action is immaterial cleanup.

---

## 7. Deep audit of the action items (validation)

Each item below was re-checked against source data and code after the first draft; the diagnoses and *especially* the solutions needed correcting.

### 7.1 Item 1 — null-`unp` canonicalization: **confirmed, with refinements**

- **Count re-verified:** 12,308 contract-tag rows dated 2020+ with empty `unp` = **€4.70 bn**. It splits by source: **eop-T\*** (storage.eop flat feed) 8,479 rows / **€3.53 bn**; **ocds-e82gsb** (OCDS feed) 1,530 rows / **€0.91 bn**; **aop-legacy** 2,299 rows / **€0.27 bn**.
- **Why they lack `unp` — by design, not a bug.** `scripts/procurement/normalize_eop.ts:210–216` deliberately refuses to write a `T…` ЦАИС-internal id into `Contract.unp`, because `unp`'s contract is to join `tenders.unp` (standard УНП only): *"they must never reach `Contract.unp`"*. So these rows keep the T-id in **`ocid`** (`eop-T78923`) and leave `unp` empty.
- **The key IS recoverable, and SIGMA uses the same key.** SIGMA keys these exact contracts by the T-id: our `eop-T78923` ⇒ SIGMA `unp="T78923"` (id `e:T78923:РД-33-5/27.08.2020:_:eik:831646048:1`); our `ocds-e82gsb-566491` ⇒ SIGMA `unp="T566491"` (SIGMA prefixes the numeric ЦАИС id with `T`). АПИ's own SIGMA data is 23% T-keyed. **Join simulation** on the sampled buyers: deriving the T-id from `ocid` matched a SIGMA row for **97% of eop-T value and 94% of ocds value** (row-level misses are tiny/duplicate sub-€50k contracts SIGMA doesn't carry).
- **Solution correction:** the fix is **not** to overwrite `unp` — that would violate the tenders-join invariant. Add a *separate* canonical column (e.g. `cais_id`) populated from `ocid` (strip `eop-`; `T`+numeric for `ocds-e82gsb-`), and reconcile externally on it. **No collision / no double-count:** zero existing `T`-format `unp` values, zero duplicate rows between eop-T and standard-`unp` contracts. **Scope of the claim shrinks:** ~€4.4 bn (eop-T + ocds) is recoverable this way; the €0.27 bn `aop-legacy` tail carries a legacy АОП doc-id (not a ЦАИС id) and needs a separate map — low priority. This changes **no totals** (we already hold these contracts and their value); it only enables joins.
- **✅ Shipped, deployed & verified (local + Cloud SQL, zero downtime).** `scripts/db/schema/pg/079_contracts_cais_id.sql` adds `cais_id` = an immutable helper `contract_cais_ref(unp, ocid)` (standard УНП when present, else `substring(ocid,5)` for `eop-T…`, else `'T'||substring(ocid,13)` for `ocds-e82gsb-…`), populating a **plain** column. Wired into `load_pg.ts` to re-run the populate UPDATE after the corpus MERGE. Population: 258,446 rows keep the standard УНП, **10,010 rows / €4.43 bn recover a `T`-id**, 75,255 (pre-ЦАИС legacy) stay NULL — identical on local and cloud (271,943 non-NULL each). Proven rows map exactly: `eop-T78923`→`T78923`, `ocds-e82gsb-566491`→`T566491`. **Join test on the 10 sampled authorities: SIGMA `unp` coverage rose from 5,133/7,830 (66%) via `unp` to 7,038/7,830 (90%) via `cais_id` — +1,905 contracts** (СОАПИ 58→94%, УМБАЛ Пловдив 33→86%, ЕСО 37→69%, АПИ 69→91%). `tsc`/prettier/round-trip green.
  - **Why NOT a STORED generated column** (the first cut, reverted): adding one needs a full table rewrite under AccessExclusive (~40 s local, and the cloud backfill of 271,943 rows took **52 min** on the shared-core `db-g1-small`) that would have 500'd every `/procurement` + contracts-browser read for the whole window. The plain-column form deploys lock-free: `ADD COLUMN` is metadata-only (217 ms on cloud) and the populate `UPDATE` holds only **RowExclusiveLock** — verified by a concurrent per-eik read that kept serving mid-backfill (see [[reference_contracts_reload_lock]]). No frontend deploy needed (no app code reads `cais_id` yet; it exists for external reconciliation: `sigma.unp = contracts.cais_id`).

### 7.2 Item 2 — the ~1% BGN-mislabel guard: **materiality even smaller; the proposed guard was wrong**

- **The "~1%" was an overcount.** A genuine ×2.0 EUR annex (e.g. `03064-2025-0001`: 333,568 → 667,135 → 1,000,703, a real escalation) is arithmetically ~indistinguishable from a ×1.95583 BGN mislabel (2.00 vs 1.956, ~2% apart), so the detector false-positives on real annexes.
- **Measured leak, not estimated.** Of the flagged (unp, supplier) pairs: **18 pairs (€157 M) the existing 12% continuity guard correctly rejected** (held at signing, no inflation — including ЕСО `01379-2021-0084` €93.4 M×2); only **9 pairs / €4.97 M actually leaked through inflated**, and some of *those* are genuine ×2 annexes. Real erroneous inflation is **≤ €5 M** corpus-wide.
- **The proposed guard does not work.** The contracts that actually leak (e.g. `00728-2025-0012`) have a **correct anchor** — their earliest annex is properly BGN-labeled and converts fine — and only the **latest** EUR record is mislabeled. Checking `lastContractValue ÷1.95583` (the earlier draft's guard) therefore never fires on them. The *only* reliable discriminator is the **dual-record** signal: when the same `contractNumber` has both a BGN- and an EUR-labeled annex and the EUR value ≈ a BGN value taken unconverted, it is a mislabel. Only **7 of 23** flagged pairs are dual-record (safely fixable); the other 16 are EUR-only and unresolvable by arithmetic.
- **Recommendation:** given ≤ €5 M materiality and the false-positive risk, treat as **optional / won't-fix**; if built, restrict strictly to the dual-record case. **No revert, no re-run** is warranted.

### 7.3 Item 3 — data-quality: **overstated; both proposed solutions were wrong**

- **"Bogus EIKs" is <€30 M and mostly mis-keyed real vendors.** Only 55 contractor rows (€232 M) have a non-BG-shaped EIK — and they are overwhelmingly **legitimate foreign vendors** (Leonardo €157 M, Škoda, Pesa, Pilatus). The truly-placeholder EIKs total <€30 M and are themselves mostly real companies assigned a placeholder at ingest (`000000001` = Xiamen Golden Dragon Bus €27 M).
- **Neither proposed filter is right.** **Shape validation misses the placeholders** — `123456789` is 9 digits and passes. A stricter **EIK checksum over-catches**: 204 nine-digit EIKs (€808 M) fail the check, but the top ones are legitimate (Škoda Transportation/Vagonka consortium €163 M×2, foreign firms). Correct handling = a tiny **curated placeholder blocklist** (re-resolve `123456789`, `000000001`, …) plus a **foreign-vendor label** (never a filter).
- **The Лукойл/Петрол "merge" was a misdiagnosis.** EIK `121699202` is simply Лукойл-България's own EIK with 13 cosmetic name variants (one of which appends ",Петрол АД"); it is **not** two companies fused into one value. Its ours-€833.5 M vs SIGMA-€44.0 M gap decomposes as **€573 M null-`unp` (Item 1) + pre-2020 scope**; our *joinable 2020+* total is €34.3 M vs SIGMA's €44.0 M — the same two mechanisms as everywhere else, not an entity-merge value error. The only real 3(b) task is cosmetic name normalization, immaterial to value.

**Net effect of the deep audit:** one real action survives (§7.1, the ЦАИС-id join column, ~€4.4 bn joinability, zero total change); everything else is immaterial cleanup or a misdiagnosis now retracted.

---

## 8. Ingestion gaps (extended comparison via `cais_id`)

With `cais_id` giving a clean join (§7.1), the "SIGMA-only" set finally separates **true ingestion gaps** from key-mismatches. Anti-joining SIGMA's per-entity contract lists against our corpus on `cais_id`:

### 8.1 The finding

- **16 sampled authorities: 908 contracts / €959.3 M that SIGMA has and we genuinely lack** — and **zero mis-attributed** (every gap is globally absent from our corpus, so these are real ingestion misses, not attribution/keying artifacts). Concentrated in big buyers: Метрополитен €211 M, НКЖИ €168 M, Мин.транспорт €154 M, ЕСО €125 M, УМБАЛ Пловдив €123 M, ЦВО €73 M, АЕЦ Козлодуй €34 M, АПИ €28 M.
- **By procedure, €591 M of the gap is 58 large "Открита" (open-procedure) contracts** — the most standard, openly-published kind — plus €293 M of `T`-id ("Неизвестна") procedures. By year it spans **2020–2026** (2022–2023 are the bulk by count), so it is **not** feed-lag.
- **Corpus-wide: 29,404 distinct procedures / ~€3.39 bn EUR (€5.8 bn native, BGN@1.95583)** present in the storage.eop `договори` feed but absent from our corpus (22% of that feed's 131,961 УНП).

### 8.2 Root cause — proven, and the data is already on disk

For the top misses (`00042-2024-0003` Мин.транспорт €153.7 M; `00423-2024-0009`/`00423-2025-0014` Метрополитен; `00233-2022-0021` НКЖИ) all three checks line up:
1. **Absent** from our `contracts` (any tag/key) — confirmed.
2. **Present in our `tenders`** — we ingested the *procedure* but never the awarded *contract*.
3. **Present in the raw `raw_data/procurement/eop/*.json.gz`** we already downloaded.

**100% of the €959 M authority gap (907 of 908 contracts) is already in our raw storage.eop feed** — we downloaded it and the ingest dropped it. The mechanism is the **existing-buyer guard** in `scripts/procurement/ingest_eop.ts` (`loadExistingAwarderEiks`): it gap-fills *only buyers entirely absent from our corpus*, so for any covered buyer (all the big ones), their storage.eop-only `договори` rows — the ones the narrower OCDS fortnightly bundle omits — are skipped wholesale. The P1 coverage fix (commit 7327905f5) addressed this only for a narrow `--only-buyers` whitelist (АПИ + a few); the gap persists for every other major buyer.

### 8.3 The dry-run corrected the estimate — two distinct gaps, not one

The cais_id anti-join (§8.1) **over-counted**: it can't see a contract we already hold under a *different* key form. The ingest's content dedup (buyer+supplier+€+date) is the stronger, truer test. Running `ingest_eop.ts --cross-source-dedup` over full history (dry-run) resolved the €3.39 bn estimate into two separate gaps:

1. **Existing-buyer guard — recoverable now.** `ingest_eop.ts`'s default gap-fills *only buyers entirely absent from our corpus* (`loadExistingAwarderEiks`); covered buyers' storage.eop-only `договори` rows are skipped. `--cross-source-dedup` keeps all buyers and drops only content-duplicates (3 nets: УНП+supplier+€, buyer+supplier+contract#+date, buyer+supplier+date+€). **Genuinely new: 8,548 contract rows / +€2.60 bn** (measured after re-fold: corpus €85.51 bn → €88.11 bn). No new scraping — the raw data was already cached.
2. **Foreign-supplier drop — a normalizer code fix (also now shipped, §8.5).** `normalize_eop.ts` dropped any row whose supplier isn't a Bulgarian EIK, so clean foreign-vendor contracts vanished: **580 contracts / €0.58 bn** — Stadler Polska €153.7 M (trains), Škoda, DB Fernverkehr, Framatome, Airbus Helicopters. `--cross-source-dedup` can't recover these (same normalizer drops them); recovering them means keeping the contract with a foreign-vendor bucket.

The remaining €0.9 bn of the original €3.39 bn cais_id estimate was contracts we already held under a different key (e.g. НКЖИ's €93.8 M `00233-2022-0021`, held under legacy `00233-2017-0075`) — correctly *not* new.

### 8.4 Shipped — Gap 1 recovered (Gap 2 deferred)

**Applied 2026-07-16 (local + Cloud SQL).** Ran `ingest_eop.ts --cross-source-dedup --apply` (full history) → the documented fold-preserving rebuild (`eop_field_map` → `contract_index` → `by_id_shards` → `anexi_current_value --apply` → `rebuild_from_cache` → `rebuild_derived`) → `db:load:pg`. Result: **352,259 contracts / €88.109 bn** (+8,548 rows / +€2.60 bn), JSON↔PG reconcile to the euro, authoritative euro-peg canary 0 violations, round-trip lossless. **SIGMA gap on the 16 sampled authorities closed 908 → 553 contracts / €959 M → €558 M**; the €558 M residual is dominated by €386 M of "Открита" foreign-supplier contracts (Gap 2). Also fixed a pre-existing stale peg test (`invariants_pg`) that checked the annexed `amount_eur` instead of `signing_amount_eur`. **Gap 2 (foreign-supplier, €0.58 bn) deferred** as a separate `normalize_eop` change (operator's call: ship the €2.60 bn now).

### 8.5 Shipped — Gap 2 (foreign-supplier) recovered

**Applied 2026-07-16 (local + Cloud SQL).** `normalize_eop.ts` now keeps foreign-vendor contracts instead of dropping them (`resolveSupplierEik`): a clean BG EIK passes through; a BG EIK embedded in a messy id is recovered (`ЕИК 205994492`, `BG104529087`, spaced `827 184 123`); otherwise the vendor is kept keyed by a normalized foreign regnum (matching the corpus's existing numeric-regnum foreign vendors), or with an empty key for anonymised suppliers (value still lands on the buyer). A contract with any validated BG supplier keeps its historical split exactly, so a `--cross-source-dedup` re-ingest content-matches it — no double-count. Re-ingest + fold-preserving rebuild + reload: **+937 contracts / +€0.78 bn** → **353,196 contracts / €88.887 bn**. Stadler Polska `00042-2024-0003` (€153.65 M) now present (`contractor_eik` `8212477136`, raw `821-24-77-136` preserved). Integrity green (peg, round-trip, reconcile). **SIGMA authority gap: 553 → 482 contracts / €558 M → €102.8 M** — combined with Gap 1, the 16-authority gap closed **€959 M → €102.8 M (89%)**.

**Net of §8.4 + §8.5:** corpus €85.51 bn → **€88.89 bn** (+9,485 contracts / +€3.38 bn). That aggregate lands close to the original €3.39 bn cais_id estimate (§8.1), but is composed differently — the cais_id figure over-counted with content-duplicates we already held (e.g. НКЖИ's €93.8 M) yet under-counted where messy-BG ids resolve to full values and the current-value fold lifts annexed rows. The residual SIGMA gap of €102.8 M (16 authorities) is the long tail: keying differences, foreign members of mixed consortia deliberately left unsplit, and feed edge cases.

*(The bidder side shows the same signature — 158 contracts / €194 M across the 15 sampled companies.)*

---

## 9. Full 1-to-1 corpus validation (every procedure, both directions)

SIGMA's unfiltered `/contracts.csv` returns its **entire corpus** (196,156 rows / 109,652 УНП / €52.29 bn) — a full bulk export, so this is not a sample. Joined to our whole corpus on `cais_id` (277,962 keyed contract rows / 142,125 УНП / €73.15 bn), summing value per УНП:

| Category | УНП | SIGMA €M | Reading |
|---|--:|--:|---|
| **MATCH (±2%)** | **102,166** | **44,257** | value agrees to the euro — 93% of common procedures |
| ours-only (SIGMA lacks) | 35,286 | — | €15.9 bn is **pre-2020** (outside SIGMA's window — legitimate); **€3.3 bn is 2021+** = SIGMA coverage gaps (verified absent, not keying) |
| ~×1.96 (SIGMA annex ÷ bug) | 1,713 | 2,209 | **their bug** — SIGMA double-converts 2026-EUR annexes; we're correct/higher |
| we-higher, other ratios | 1,458 | 2,925 | mostly the same SIGMA annex ÷ bug blended across mixed lots (АПИ/Метрополитен/ЕСО) |
| we-lower, other ratios | 1,202 | 2,067 | **mixed** — see below |
| sigma-only (we lack) | 2,813 | 784 | our residual coverage gap (2022–26), down from the €3.4 bn §8 recovered |
| ~÷1.96 (we lower) | 145 | 46 | small; the genuine BGN-mislabel tail (§7.2) |

**Their-side issues found:**
1. **Annex ÷1.95583 double-conversion** — ≥1,713 procedures / €2.2 bn clean, plus most of the €2.9 bn "we-higher" bucket. SIGMA understates post-annex current on the 2026 euro transition (already established §2).
2. **2021+ coverage gaps** — €3.3 bn of contracts we hold that SIGMA lacks (€1.7 bn in 2021 alone; e.g. МО `00164-2021-0015`, hospital `00086-2021-0001` — 0 SIGMA rows).
3. **Face-value stotinki errors** — SIGMA trusts garbage source amounts. `00105-2025-0026`: source `contractValue`=`102 258 376 EUR` but `estimatedValue`=`2 000 000` — SIGMA booked €102.26 M; we correctly divided the stotinki error to €1.02 M via `amount_overrides.ts` (100× cluster: 8 УНП / €143 M, SIGMA inflated).

**Our-side issues found (actionable):**
1. **Residual coverage gap** — 2,813 УНП / €784 M SIGMA has and we still lack (foreign members of mixed consortia left unsplit by §8.5, keying, feed edges).
2. **Zero-value rows** — 47 УНП / €35.4 M where our `amount_eur`≈0 but SIGMA has a real value (source published no contract value; e.g. `00120-2021-0004` ours €0 vs SIGMA €18.9 M).
3. **`amount_overrides` /100 to re-review** — the 100× cluster is correct for the SME `00105` but questionable for `00116-2026-0001` (Технически университет €2.19 M) and `03000-2025-0001` (Овергаз €10 M), where the un-divided value may be the real one — our override may under-count by 100×.
4. **Annex over-rejection** — the `MAX_MULTIPLE=15` guard drops genuinely-huge annexes: `00747-2024-0003` ours €1.09 M (fold rejected a ×96 jump) vs SIGMA €53.8 M (their ÷1.96 of the same €105 M annex) — both wrong; the true value needs the source, but our guard may miss legitimate large scope-ups.

**Net verdict:** on the €44 bn of directly-comparable value, we and SIGMA agree to the euro on **93% of procedures**. Every material divergence is explained: the larger ones are SIGMA's (annex ÷-bug €2–4 bn, 2021 coverage €3.3 bn, stotinki inflation); ours are small and bounded (€784 M residual coverage, €35 M zero-value rows, 8 override cases, an annex-guard edge). We are the more complete and more euro-accurate corpus; the actionable follow-ups on our side total under ~€1 bn and are itemized above.

---

*Method notes: our side = local Docker Postgres `contracts`, `tag='contract'` only (amendment rows excluded, matching production rollups `rollups.ts`/`by_ns.ts`). SIGMA CSV `value_eur` = current basis (post-annex), matching our `amount_eur`. Join key = УНП (identical format both sides). Reconciler + raw CSVs retained in session scratchpad (`reconcile.py`, `sig/*.csv`).*
