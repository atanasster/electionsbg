# PRD (Research) — Ingesting Tenders (procedures), not just signed contracts

**Status:** Research / discovery — not yet a build plan
**Author:** drafted 2026-06-27
**Trigger:** The "мантинели за 1 милиард" fact-check (June 2026) exposed that our procurement corpus cannot represent the single most-disputed procurement of the cycle, because it has no signed contract yet.

---

## 1. One-liner

Investigate whether and how to add **tender-stage procurement records** (the procedure: estimated value, lots, status, appeal state) to the corpus, so the database covers a procurement from *announcement* through *signed contract* — not only the signed-contract tail it holds today.

## 2. Background & motivation

Our procurement corpus is a **signed-contracts feed**. [scripts/procurement/normalize.ts](../../scripts/procurement/normalize.ts) keeps a release only if it carries an `award`, `contract`, or `contractAmendment` tag (`TAG_PRIORITY` + `pickTag`); a release tagged purely `tender` / `planning` is dropped (`releasesSkippedNoTag++`). The data model says so out loud — [types.ts:11-13](../../scripts/procurement/types.ts#L11-L13): *"Pure-tender notices (no award yet) are excluded."* The parsed `tender` object captures title, method, CPV, bid count and tender period, but **not** estimated value (`tender.value`) and **not** status.

The cost of that choice became concrete in the мантинели case:

- **Disputed procurement:** АПИ's 2025 framework for road guardrails ("ограничителни системи"), prognostic value **960 млн лв без ДДС ≈ €491M**, 6 regional lots, announced 23 Sep 2025.
- It is **stuck in a КЗК appeal** (complaint by "Фосталпине Кремс Финалтехник" ГМБХ, Австрия), so executors are chosen for 5/6 lots but **no contract is signed**.
- Therefore it produces **zero rows** in our corpus. We could fact-check the *old* caretaker-era contracts (2022 Юпитер 05, 2023 Северен централен) but had **nothing to show on the actual number Radev and ИПБ are fighting about**.

This is not a pipeline bug — it is the documented scope. The question this PRD scopes: *should we widen the scope, and at what cost?*

## 3. Problem statement

Today the site/AI cannot answer questions of the form:

- "What is АПИ's biggest **open** tender right now and for how much?"
- "Which procedures are **under КЗК appeal / suspended**?"
- "How does the **estimated** value compare to what was eventually **contracted**?" (the entire мантинели dispute)
- "Show me the procedure that produced this signed contract" (no tender → award → contract lineage).
- "Which tenders were **cancelled** without a contract?" (a corruption-relevant signal that is invisible to a contracts-only corpus).

## 4. Goals / Non-goals

**Goals**
- Decide, with evidence, whether the OCDS feed we already pull can supply usable tender-stage data (value, lots, status) — or whether a new source is required.
- Define a data model that links tender → lot → award → contract under the shared `ocid`, with a status lifecycle.
- Quantify the volume, storage, and front-end performance cost of adding tenders (the FE already has a data-diet history).
- Produce a go/no-go with a phased build plan and the мантинели procurement as the acceptance test.

**Non-goals (for v1)**
- Real-time tender alerting / bid-deadline notifications (possible later; out of scope for research).
- Becoming a tender-discovery platform for bidders (TED/ЦАИС already do this).
- Re-architecting the contracts pipeline; tenders should extend the existing tree, not fork it.
- Scraping КЗК case *documents* (PDF decisions) — at most we want appeal *status*, not full-text.

## 5. Users & use cases

| User | Use case |
|---|---|
| Fact-checkers / journalists (the trigger) | Verify claims about a procurement's **size and status** before a contract exists |
| AI chat (`ai/` tool registry) | An `openTenders` / `tenderLookup` tool; today the router has no answer for "open поръчка за X" |
| Our own procurement pages | A tender → contract lineage on `/contract/:key` and `/awarder/:eik`; an "open/appealed tenders" surface |
| Budget / accountability articles | Estimated-vs-contracted gap as an analytical signal (the "поскъпна 4 пъти" framing) |

## 6. Current state (grounded references)

- **Primary ingest:** [scripts/procurement/ingest.ts](../../scripts/procurement/ingest.ts) — pulls АОП fortnight **bundles** from data.egov.bg, normalizes via [normalize.ts](../../scripts/procurement/normalize.ts), shards to `data/procurement/contracts/YYYY/YYYY-MM.json` + `by-id/` + `contractor_contracts/` + `awarder_contracts/` + derived rollups.
- **Tag filter:** `TAG_PRIORITY = ["contractAmendment","contract","award"]`; `pickTag()` returns `null` for tender-only releases → skipped.
- **Parsed-but-discarded tender fields:** `tender.{title,description,procurementMethod,procurementMethodRationale,numberOfTenderers,numberOfBids,tenderPeriod,items}`. **Absent from the type entirely:** `tender.value` (estimated value), `tender.status`, lot/lot-status structure.
- **Gap-fill:** [ingest_eop.ts](../../scripts/procurement/ingest_eop.ts) (ЦАИС ЕОП flat-договори) **only adds buyers entirely absent** from the corpus — will never backfill an existing buyer like АПИ.
- **Known constraints (from memory):** data.egov.bg is **403-blocked from non-BG egress IPs**; **2018 is missing** entirely; legacy "-x" twin dedup guard in [validate.ts](../../scripts/procurement/validate.ts).
- **FE single-record path:** [useContract.tsx](../../src/data/procurement/useContract.tsx) single-file `by-id/<key>.json` → `by-id/shard/<key[:3]>.json` fallback; route `procurement/contract/:id` in [routes.tsx](../../src/routes.tsx).

## 7. Key research questions (the core deliverable)

### A. Source capability — does the data we already pull contain tenders?
- A1. Re-scan raw cached bundles: how many releases are tagged `tender` / `planning` only (the ones we currently drop)? Sample counts per year. **(Spike: re-run normalize with `pickTag` disabled and tally.)**
- A2. For those tender releases, is **`tender.value`** (estimated value) populated? At what rate? This is the single most important field — without it, tenders add little fact-check value. (АОP's history of sparse fields — cf. [project_aop_ocds_fields](../../) memory — makes this a real risk.)
- A3. Is **lot structure** present (`tender.lots[]` / `relatedLot` on items) so we can model "5 of 6 lots awarded"?
- A4. Is **`tender.status`** present (`planned / active / cancelled / complete`) and trustworthy?
- A5. Does the **мантинели 2025 procedure specifically** appear in any bundle we can fetch, or is it genuinely absent (never published to the open feed / behind the 403)? Confirm via OCID family `ocds-e82gsb-*` for buyer EIK `000695089`.

### B. The appeal/КЗК dimension (the "спряхме я" question)
- B1. КЗК appeal status is **not in OCDS**. КЗК publishes its own register at cpc.bg/procurements (HTML, likely no structured feed). Confirm there is no JSON/CSV/open-data endpoint.
- B2. If HTML-only: is a lightweight **status enrichment** feasible (procedure → {appealed?, suspended?, decision date}) keyed on buyer + tender title/УНП? What is the join key (КЗК references the АОП procedure number)?
- B3. Scope guard: status flag only, **not** decision full-text. Decide cadence (КЗК moves in weeks, not minutes).

### C. Data model & identity
- C1. Model the lifecycle under a shared `ocid`: `tender → lot → award → contract → amendment`. Today rows are flat `Contract`. Options: (a) a parallel `Tender` record type with a `latestStatus`; (b) extend `Contract` with a `tag: "tender"` + nullable contractor. Recommend (a) — tenders have no contractor and a fundamentally different value semantics (estimated, not signed).
- C2. **Value semantics:** estimated (прогнозна) vs awarded vs contracted are three different numbers. Headline aggregates must **never** sum estimated tender values into contracted totals (would re-inflate the corpus the way the legacy "-x" twins did — see [project_procurement_legacy_dedup](../../)). Estimated value lives in a separate field and a separate aggregate.
- C3. **Lineage:** can we backfill a `tenderOcid` pointer onto existing contracts so `/contract/:key` shows "this came from procedure X"? (Same `ocid`, so likely free.)

### D. Volume, storage, FE performance
- D1. Tenders are far more numerous than signed contracts (many cancelled, many never contracted). Estimate the row-count multiplier from A1.
- D2. Storage/shard impact: a parallel `tenders/` tree mirrors `contracts/` sharding. Confirm it does **not** bloat the FE bundles the data-diet work shrank (section/candidate pages). Tenders should be lazy-loaded on dedicated surfaces only.
- D3. GCS serving: tenders tree must go through `bucket:gz` / `bucket:sync:all` like the rest (see [reference_gcs_bucket_compression](../../)).

### E. Access & freshness
- E1. The 403 IP block already constrains contract refresh; tenders share the feed and the same constraint. Document the BG-egress requirement; do not put a backfill in the watcher (cf. [feedback_one_off_backfills](../../)).
- E2. Watcher: does `eop_procurement` / the АОП watcher already see tender releases, or only contracts? Wire a `--tenders` flag, gated behind explicit invocation for the historical backfill.

### F. Trust & presentation
- F1. Estimated values are **forecasts**, not money spent — every surface must label them as such (the мантинели dispute is *caused* by conflating estimate, leva/euro, and timing). Reuse the article's authenticity rules.
- F2. Appeal status from КЗК is a secondary, lower-confidence source — footnote it and link to cpc.bg.

## 8. Proposed phases (pending the research above)

1. **Phase 0 — Spike (1 session):** re-run normalize with `pickTag` disabled over cached bundles; produce the tally for A1–A4 and the мантинели probe (A5). **This is the go/no-go gate.** If `tender.value` is unpopulated, the feature is not worth building from this source and we stop here / re-scope to a КЗК-led status feature.
2. **Phase 1 — Model & ingest:** add a `Tender` record type + `tenders/` shard tree + `--tenders` ingest flag; backfill `tenderOcid` lineage onto contracts.
3. **Phase 2 — КЗК status enrichment** (only if B2 is feasible): appeal/suspension flag keyed to procedures.
4. **Phase 3 — FE + AI:** tender → contract lineage on existing pages; an "open / appealed tenders" surface; `tenders` AI tool. Honor [feedback_no_tabs_ux] (tiles, not tabs).
5. **Phase 4 — ship:** `bucket:gz` + `bucket:sync:all`, data-map node, sitemap.

## 9. Success criteria

- **Acceptance test (the мантинели procurement):** after build, the database can show the 2025 АПИ guardrail **procedure** with its **estimated value (€491M / 960 млн лв)**, its **6-lot structure (5/6 awarded)**, and its **status = under КЗК appeal** — the exact facts the fact-check needed and could not produce.
- A user lands on a single page that lets them verify Radev's claim against structured data we hold, not just news links.
- No headline contracted-spend aggregate changes (estimated values are quarantined).
- FE bundle sizes on existing pages unchanged (tenders lazy-loaded only).

## 10. Risks & open questions

- **R1 (highest):** АОП may not populate `tender.value` in the open feed → the feature's core value evaporates. Phase 0 settles this before any build.
- **R2:** The most-wanted tenders (large, contested) are exactly the ones most likely **absent** from the open feed or **behind the 403** — i.e. we may structurally fail to capture the cases that matter most. Quantify in A5.
- **R3:** КЗК status has no structured source; HTML scraping is fragile and the join key (procedure number) may be inconsistent.
- **R4:** Estimated-value confusion is a *presentation* landmine — mislabeling a forecast as spend would damage credibility precisely on a transparency product.
- **Open:** Is the right primary source actually **ЦАИС ЕОП (app.eop.bg)** rather than the data.egov.bg АОП bundles, for tender-stage data? Phase 0 should sample both.

## 11. Appendix — worked example (the test fixture)

| Item | What our corpus holds today | What tenders would add |
|---|---|---|
| 2022 national framework (Юпитер 05, €21.6M, 1 bidder) | ✅ signed contract `1c2ece20e6e6` | originating tender + estimated value |
| 2023 Северен централен (€5.4M ×4) | ✅ amendment `165a35335b66` | the 6-region tender it belonged to |
| **2025 mega-tender (€491M, 6 lots)** | ❌ **nothing** | **the whole record: estimate, lots, status=appealed** |

Buyer: АПИ, EIK `000695089`. OCID family: `ocds-e82gsb-*`. КЗК complainant: Фосталпине Кремс Финалтехник ГМБХ (Австрия).

---

## 12. Research findings (deep dive, 2026-06-27)

**Verdict: GO.** The kill-risk (R1) is refuted with hard data, and the acceptance-test procurement was pulled live, field-for-field. The single most consequential finding is that the **primary source should be the ЦАИС ЕОП "поръчки" (tenders) open-data feed at `storage.eop.bg`, not the data.egov.bg АОП OCDS bundles** — and that feed is *already fully fetched/cached for 2020-01-01 → 2023-10-23* by an existing script, sits behind *no* 403, and carries every field this PRD needs.

### 12.1 Phase 0 spike — DONE, and it's a clear GO (answers A1–A4)

Two independent sources both carry tender-stage value/status/lots. R1 ("АОП may not populate `tender.value`") is false on both.

**Source 1 — data.egov.bg АОП OCDS bundles (the feed we already pull).** Re-ran `normalize` logic with `pickTag` conceptually disabled across all **6 cached bundles** (2026 fortnights, 25,980 releases):
- **9,561 tender-only releases are dropped today = 36.8% of all releases.**
- Of those dropped releases: `tender.value` present **99.9%**, `tender.status` present **100%** (`active` 9,519 / `planned` 42), `tender.lots[]` present **100%**.
- The fields are discarded for two reasons only: `pickTag()` drops the release, AND the `OcdsRelease` TS interface in [normalize.ts](../../scripts/procurement/normalize.ts) omits `tender.value / status / lots`. Both are trivial to change. The PRD's premise in §2 ("the parsed tender object captures … but **not** estimated value and **not** status") is true of *our type*, not of *the source data*.

**Source 2 — ЦАИС ЕОП "поръчки" feed (`storage.eop.bg`), the recommended primary.** A full-history cache already exists at `raw_data/procurement/eop_tenders/` (built by [build_tender_oblast_map.ts](../../scripts/procurement/build_tender_oblast_map.ts), which fetches+caches the whole day JSON but only extracts oblast). **1,427 cached days, 170,769 tender-notice rows, 70,486 distinct procedures (УНП):**
- `estimatedValue` populated **100.0%** (170,743 / 170,769; all parseable to a number).
- `lotsCount` on procedure rows **41.3%** (= the 70,486 parent rows); per-lot child rows (`isLot="Да"`) **58.7%** → full lot structure ("5 of 6 lots") is representable.
- `isCancelled="Да"` on **18.3%** → the "cancelled without a contract" signal the PRD wants is a first-class field.
- valid buyer EIK **99.8%**; the feed also carries `procedureType`, `awardMethod`, `legalBasis`, `submissionDeadline`, `isEuFunded`/`europeanProgram`, `executionPlaceNuts`, `isFrameworkAgreement`, `linkToOjEu`, and both identity keys (`tenderId`, `uniqueProcurementNumber`/УНП).

### 12.2 The acceptance test — PROVEN by live fetch (answers A5)

`storage.eop.bg` served the **мантинели mega-tender** on a live fetch from this (non-BG, cloud) egress — i.e. it is **not** behind the data.egov.bg 403:

```
day=2025-09-23  tenderId=518491  УНП=00044-2025-0125
estimatedValue=960 000 000,00 BGN  (= €490.8M)  lotsCount=6  isCancelled=Не
„Изграждане, ремонт и възстановяване на ограничителни системи за пътища…"
+ 6 child lot rows: 140 + 140 + 160 + 160 + 180 + 180 = 960M BGN
```

This matches the PRD's facts exactly (€491M, 6 lots). The procedure is confirmed **absent from our contracts corpus** (0 matching rows; АПИ has 794 *other* 2024-26 contract rows). So value + lot-structure are fully deliverable today; only the **КЗК appeal status** is not in this feed (see 12.4).

### 12.3 Identity & lineage — the join is free (answers C1, C3)

- **Confirmed:** OCDS `ocid = ocds-e82gsb-<tender.id>` (sample tender release: `ocid: ocds-e82gsb-567946`, `tender.id: 567946`). The EOP feed's `tenderId` equals that suffix — **867 EOP-2026 tenderIds matched OCDS ocid suffixes** despite barely-overlapping cache windows. `noticeId` does **not** match (0).
- The join is on the **parent procedure `tenderId`**, not the lot tenderIds (116 parent-vs-0 lot matches against the corpus). Lots share one **УНП** but each has its own `tenderId`.
- **Two ocid namespaces exist:** OCDS-sourced contracts use `ocds-e82gsb-<tenderId>`; the EOP-gap-fill договори ingest ([normalize_eop.ts](../../scripts/procurement/normalize_eop.ts)) synthesizes its ocid from the **УНП**. The tenders feed carries *both* keys (`tenderId` + УНП), so it is the Rosetta stone that bridges both contract namespaces. → **Model the Tender keyed on УНП (procedure) with lots as children; backfill `tenderOcid` = `ocds-e82gsb-<parentTenderId>` onto OCDS contracts and `=УНП` onto EOP contracts.** Lineage is effectively free.

### 12.4 The КЗК / appeal dimension (answers B1–B3)

- Appeal status is **not** in the tenders feed: scanning Oct–Dec 2025 + 2026 days, УНП `00044-2025-0125` never re-appears with a status change (the feed publishes a tender on its announcement day only; `changeNoticeCount>0` fires on just 0.0% of rows). Confirmed: КЗК status must come from КЗК.
- The КЗК public register (`reg.cpc.bg`, `cpc.bg/procurements`) is real, continuous, no-login — but **403s from non-BG/cloud egress** (same wall as data.egov.bg) and exposes **no JSON/CSV/open-data endpoint** (HTML only). B1 confirmed. Join key would be the **procedure number / УНП** that КЗК cites.
- Public reporting corroborates the case (complaint by the Austrian Voestalpine/Фосталпине; КЗК temporary-measure ruling ~18–20 Nov 2025 — the exact "спряна ли е" dispute). This is a fragile, weeks-cadence HTML scrape → keep it **Phase 2, optional, lower-confidence, status-flag-only** as the PRD already scoped. The high-value 80% (estimate + lots + cancelled) ships without it.

### 12.5 Volume, storage, access (answers D1–D2, E1–E2)

- **Volume is modest, not a blow-up.** ~70.5k procedures over 2020→2023 (~18k/yr) ≈ the same order as signed contracts/yr — the "tenders are far more numerous" assumption (D1) is only partly true; the row multiplier is ~2.4 (parent + lots), not 10×.
- **Storage:** the entire cached tenders feed is **27 MB gzipped**; a full 2020–2026 cache ≈ 40–45 MB. The normalized `tenders/` tree would be a fraction of the existing `contracts/` tree (already 679 MB; full `data/procurement` is 1.8 GB). FE bundle bloat (D2) is avoided the same way contracts already do it: dedicated lazy-loaded surfaces + by-id shards. Serve via `bucket:gz`/`bucket:sync:all`.
- **Access (E1) — important correction:** the tenders feed is **NOT behind the 403** (every live 2024/2025/2026 fetch in this research succeeded). The backfill is therefore straightforward from any egress; only the КЗК scrape needs a BG IP. The cache is missing **2024, 2025, and 2026-02→04** — a one-off backfill (`--backfill`, operator-run, never in the watcher per [feedback_one_off_backfills]) closes it.
- **Scaffolding already exists:** [build_tender_oblast_map.ts](../../scripts/procurement/build_tender_oblast_map.ts) (fetch+cache loop, URL pattern, day enumeration) and [ingest_eop.ts](../../scripts/procurement/ingest_eop.ts)/[normalize_eop.ts](../../scripts/procurement/normalize_eop.ts) (the договори two-mode ingest/normalize pattern to mirror). A `tenders` ingest is mostly assembly of parts that exist.

### 12.6 Trust & presentation (answers F1–F2)

- `estimatedValue` is a **прогнозна стойност / forecast** and must be quarantined: a separate field, a separate aggregate, never summed into contracted spend (the §C2 re-inflation trap — same failure mode as the legacy "-x" twins). Currency mix in the feed is BGN-dominant (157,798 BGN / 4,373 EUR / 8,559 empty) — convert at the locked peg, label natively.
- КЗК status is secondary/footnoted with a link to cpc.bg, per F2.

### 12.7 Recommended revisions to the build plan

1. **Flip the primary source** (resolves the PRD's standing Open question): ingest tenders from the **ЦАИС ЕОП поръчки feed** (`storage.eop.bg`), not the data.egov.bg OCDS bundles. The OCDS `tender{}` block is a viable secondary/cross-check (it independently confirms value/status/lots at ~85–100%), but the EOP feed is richer (УНП, isCancelled, lotsCount), unblocked, and already cached.
2. **Phase 0 is already settled by this document** — proceed to Phase 1.
3. **Phase 1 ingest** = extend the existing `eop_tenders` cache to 2024–2025 (backfill), then a `normalize_eop_tender.ts` (mirror `normalize_eop.ts`) emitting a `Tender` record keyed on **УНП** with nested lots; write a `tenders/<YYYY>/<YYYY-MM>.json` shard tree + `by-tender/<unp>.json`. Backfill `tenderOcid` lineage onto contracts (free, §12.3).
4. **Keep estimated value strictly quarantined** from every contracted-spend aggregate (§12.6).
5. **КЗК status = Phase 2, optional** — only if a BG-egress scrape of `reg.cpc.bg` keyed on УНП proves maintainable.

### 12.8 Phase 1 — BUILT (2026-06-27)

The ingest pipeline is implemented, run, and verified against the acceptance test. UNCOMMITTED beyond the small `index.json`; the shard tree needs `bucket:sync` to go live.

- **New scripts:** [scripts/procurement/eop_tender_types.ts](../../scripts/procurement/eop_tender_types.ts) (raw feed record), [scripts/procurement/normalize_eop_tender.ts](../../scripts/procurement/normalize_eop_tender.ts) (`Tender` + `TenderLot` types + `buildTenders`, one Tender per УНП with nested lots, estimated value quarantined), [scripts/procurement/ingest_tenders.ts](../../scripts/procurement/ingest_tenders.ts) (two-mode fetch/cache + month-shards + `by-tender/shard/` + `by-ocid/shard/` lineage + `index.json`).
- **Cache backfilled** to 2026-06-26 (the missing 2024/2025 + 2026-Q1/Q2 days; one minor gap remains, 2023-10-24→12-31, closeable by a small incremental). Lives in the shared `raw_data/procurement/eop_tenders/` cache.
- **Output:** `data/procurement/tenders/` — 76 month-shards (2020–2026), 256 by-tender hash shards, 256 by-ocid lineage shards, `index.json` (389 KB, committed). **125,327 procedures, 192,170 lots, 18,968 cancelled (15.1%), 99.96% with an estimate.** Forecast Σ €84.1bn — quarantined in `index.totals.estimatedValueEur` with a `valueSemantics` warning, NEVER folded into contracted spend (the contracts tree + its index.json are byte-for-byte unchanged).
- **Acceptance test PASSES** through the real normalizer: `00044-2025-0125` → ocid `ocds-e82gsb-518491`, est **€490.8M** (960M BGN), **6 lots** summing exactly to the total, `isCancelled=false`; ranks **#16** in `index.topByValue`. Contract→tender lineage resolves: `ocds-e82gsb-518491` → `00044-2025-0125`.
- **Gates:** `tsc` clean, `eslint` clean. Bulky shards gitignored (same convention as `contracts/`); `index.json` committed.
- **Remaining for ship:** `tsx scripts/procurement/ingest_tenders.ts --apply --upload` (bucket:sync the tree) and the optional Phase 2 КЗК status.

### 12.9 Phase 3 — BUILT + browser-verified (2026-06-27)

FE + AI shipped against the live local data (verified in a dev preview with the data tree symlinked into `public/`; symlink removed after).

- **AI tools** (ai/tools/fiscal.ts + registry.ts): `openTenders` (biggest/active tenders, filterable by buyer or keyword — whole-token buyer resolution so "Пътна инфраструктура" → АПИ, not НКЖИ) and `tenderLookup` (one procedure by УНП or keyword). Both read `tenders/index.json`, label estimated value as a forecast, and carry the ocid lineage. Verified via the node harness: keyword "ограничителни системи" → €490.8M мантинели; `tenderLookup 00044-2025-0125` → €490.8M / 6 lots / ocds-e82gsb-518491.
- **Contract→tender lineage tile** (`useTenderLineage` + `ContractTenderLineage` on `/procurement/contract/:id`): one hashless fetch via `by-ocid/shard/<last-2-of-ocid>.json`. Renders the originating procedure's estimated value, lots, status, УНП + TED link. Verified: a €45,826 signed contract shows its €66,468 originating procedure — the estimated-vs-contracted distinction made visible.
- **Tenders surface** (`/procurement/tenders`, `TendersScreen` + `useTendersIndex` + nav pill): dashboard tiles (no tabs) — procedures / forecast Σ / cancelled % / lots + biggest announced procedures + by-year, with the forecast caveat banner. Verified rendering live: 125,327 procedures, €84.1bn forecast, 18,968 (15%) cancelled.
- **Gates:** `tsc -b` clean, `eslint` clean, zero console errors. i18n keys added (EN + BG). Bulky shards stay gitignored; needs `bucket:sync` to go live in prod.

### 12.10 Verification deep-links — BUILT + browser-verified (2026-06-27)

Two quick-postable ways for a reader to check a procurement claim and see the full truthful details. The motivation: free-text is fragile (in 2025 "мантинели" → 0 hits, "ограничителни" → 2), so matching needs a robust layer.

- **Shared topic-alias module** [src/lib/tenderTopics.ts](../../src/lib/tenderTopics.ts) — a slug (e.g. `guardrails`) expands to a subject/CPV-description **regex + a CPV-code set** (the мантинели CPV is `45233292` = "Работи по поставяне на предпазни съоръжения"). Imported by BOTH the FE and the AI tool (in `@/lib`, not `@/data` — the latter is eslint-blocked from ai/). `detectTopic()` upgrades free text ("мантинели") to the topic automatically.
- **Per-year search shards** `tenders/by_year/<year>.json` (slim `TenderSearchRow[]`, ~3-4 MB, gitignored) — the searchable corpus, mirroring the contracts `contract_index` pattern. The top-250 index couldn't answer "*всички* … 2025".
- **Feature 1 — site search** on `/procurement/tenders?q=…|topic=…&year=…`: a shareable search box + year facet + topic chips ([useTenderSearch.tsx](../../src/data/procurement/useTenderSearch.tsx)). Every change writes the URL. Verified: `?topic=guardrails&year=2025` → "2 процедури · €491,1 млн", €490.8M АПИ procedure (6 lots) on top.
- **Feature 1b — procedure detail page** `/tenders/:unp` ([TenderDetailScreen](../../src/screens/procurement/TenderDetailScreen.tsx) + [useTender.tsx](../../src/data/procurement/useTender.tsx), one Web-Crypto-sha256 shard fetch). The "full truthful details" surface. Verified: `/tenders/00044-2025-0125` → €490,840,206 (orig. 960,000,000 лв), forecast caveat, buyer/CPV/legal-basis, and all **6 lots broken down by region** with values.
- **Feature 2 — AI deep-link** `ai.electionsbg.com/?q=<prompt>` (the `?q=` auto-ask already existed in Chat.tsx). `openTenders` upgraded to year + full-corpus + topic search (reads the by_year shards, honors topic aliases). Verified via harness: "всички търгове за пътни предпазни съоръжения през 2025" → guardrails topic, 2 matches, €491.1M total, мантинели #1. Free-text "мантинели" (was 0) now returns the €491M.
- **Postable links:** `electionsbg.com/procurement/tenders?topic=guardrails&year=2025` · `electionsbg.com/tenders/00044-2025-0125` · `ai.electionsbg.com/?q=Покажи всички търгове за пътни предпазни съоръжения през 2025`
- **Gates:** app `tsc -b` + ai `tsc` + `eslint` clean, 0 console errors. Bulky shards gitignored; needs `bucket:sync`.
