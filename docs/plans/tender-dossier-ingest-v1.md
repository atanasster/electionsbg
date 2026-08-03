# Tender dossier ingest (документация / техническа спецификация) — v1

Ingest the per-procedure **dossier** that ЦАИС ЕОП publishes alongside every tender — the
long free-text description, the contact officer, the attached documents (документация,
техническа спецификация, методика за оценка, проект на договор), and the full rendered
обявление/решение — so `/tenders/:unp` stops being a row of notice-header fields and starts
carrying what the buyer actually asked for.

## 0. Why now — the gap this closes

`00728-2026-0018` (Народно събрание, coffee & packaged food for MPs' offices, €86,051,
deadline 2026-09-04) is in the corpus and correct. But every fact a reader actually cares
about — nine coffee types, 39,000 sugar packets, 10 coffee machines with 24-hour
replacement — lives in `Приложение_1_Техническа спецификация….pdf`, which we do not have
and do not link to. We can tell you a tender exists. We cannot tell you what it buys.

The size of that gap, measured on the corpus:

| | |
|---|---|
| Mean `tenders.subject` length | **138 chars** |
| Mean dossier description length | **1,633 chars** (~12×) |
| Tenders whose `subject` is explicitly truncated at source (`… продълж. в поле Описание`) | **180** |
| Tenders with `length(subject) >= 240` (truncation-prone) | **7,487** |
| Tenders with a non-empty dossier description | **102/102 sampled (100%)** |
| Tenders with ≥1 attached document | **92/102 sampled (90%)**, mean **4.0** docs |

This is the tender-side twin of the known contract-title truncation problem
(`docs/plans/…contract_title_truncation`), and the same fix applies: go to the record the
truncation was truncated *from*.

## 1. The source — discovered and verified 2026-08-03

`app.eop.bg` is an Angular SPA over a WCF JSON service. Everything below was called
**anonymously**, from an ordinary egress, with no session, cookie, or token.

- **Service host** — `https://service.eop.bg/NX1Service.svc/<Method>`, `POST`,
  `Content-Type: application/json`, named-parameter JSON body.
  The full method catalogue is self-describing at `https://service.eop.bg/NX1Service.svc/js`
  (812 KB WCF proxy; every signature is `Method:function(arg1,arg2,…,succeededCallback,…)`).
- **Blob host** — `https://storage.eop.bg` (MinIO behind an S3v4 signer). Objects are
  **not** publicly readable (bare GET → `403`); a presigned URL is required.
- **robots.txt** — `app.eop.bg` serves `User-agent: * / Allow: /`. Crawling is permitted.
  `service.eop.bg` and `storage.eop.bg` serve no robots.txt (404 / 403).

### 1.1 The four calls that matter

All keyed by `tenderId` — which we **already hold** for every ЦАИС-era row as
`tenders.tender_id`, and which is also the `ocid` suffix (`ocds-e82gsb-<tenderId>`). No
discovery crawl, no search-page pagination, no id guessing.

| Method | Body | Returns |
|---|---|---|
| `GetPublishedTenderDetails` | `{tenderId, ianaTimeZone:"Europe/Sofia"}` | description HTML, contact person, **attachment metadata**, **full notice HTML** |
| `GetSignedUrlByDocumentId` | `{documentId}` | ready-made presigned `Url` (**30-min expiry**) |
| `GetPublishedTenderExportsByTenderId` | `{tenderId, ianaTimeZone}` | the per-procedure "Експорт" ZIPs (one per lot) |
| `GetPublishedContractListItems` | `{tenderId, ianaTimeZone}` | contract items — a second lineage path to signed contracts |

### 1.2 `GetPublishedTenderDetails` — what one call yields

For `tenderId=587133` the response is 466 KB. Byte weight is wildly lopsided, which drives
the whole storage design:

```
454,467  TenderPublicationDetails    <- 97.4%; array of {DocumentId, HtmlPreview, …}
  4,295  TenderDescriptionDocuments  <- attachment inventory (5 files)
  1,411  TenderDescription           <- the long "Кратко описание / документация"
  1,233  PublicationAuthorities
    ...  ContactPerson{DisplayName,Email,Phone}, OfferPhase{Start,End}Date,
         OpeningOfOffersDate, SpecialNumber (=УНП), TenderGuid, OrganizationId
```

`TenderDescriptionDocuments[]` is a complete file manifest **without the bytes** —
`Id`, `Name`, `Extension`, `MimeType`, `Size`, `MD5Hash`, `Container`, `DocumentCloudName`,
`Owner`, `CreatedDate`. That manifest alone supports "this €40M works tender published no
technical specification" without downloading anything.

### 1.3 The notice HTML is eForms **BT-keyed** — the find that changes the plan

`TenderPublicationDetails[].HtmlPreview` is the rendered обявление. It is
numeric-entity-encoded (`&#1044;…`); after decoding and tag-stripping it carries the EU
eForms **Business Term codes inline**, next to their values:

```
Продължителност (BT-36-Lot) 24 Месец
Критерии за възлагане … Вид(BT-539-Lot) Цена  Наименование(BT-734-Lot) Цена
Критерии за подбор (BT-809-Lot) Регистрация в съответен професионален регистър
Правна категория на купувача(BT-11-Procedure-Buyer) Орган на централната власт
```

That means the notice is **deterministically parseable by key**, not by fragile Bulgarian
label regexes. But coverage is a hard date cliff, measured over a 102-tender sample
stratified by (year × notice type):

| Year | n | with BT codes | mean distinct BTs | mean notice text |
|---|---|---|---|---|
| 2020 | 13 | 2 (15%) | 6 | 40 KB |
| 2021 | 16 | 1 (6%) | 5 | 30 KB |
| 2022 | 13 | 4 (31%) | 13 | 39 KB |
| 2023 | 14 | 5 (36%) | 7 | 36 KB |
| **2024** | 19 | **18 (95%)** | 77 | 69 KB |
| **2025** | 15 | **15 (100%)** | 81 | 74 KB |
| **2026** | 12 | **12 (100%)** | 83 | 92 KB |

So: **2024→ is a structured-data ingest; 2020–2023 is a text ingest.** The parser must be
two-family (BT-keyed + legacy-label), and the 2020–2023 tier must be honest that its
structured fields are sparse rather than silently emitting nulls that read as "no award
criteria". Do not build one parser and assume it degrades gracefully.

## 2. Cost — measured, not estimated

162 anonymous calls were made during this analysis with **zero** failures and no throttling
observed. Latency over the 102-tender stratified sample: **p50 647 ms, p90 1,486 ms, max
3,421 ms**.

**Addressable set: 127,199 tenders** — every `ocid LIKE 'ocds-e82gsb-%'` row, all of which
carry a `tender_id`. The other 105,527 rows are the pre-2020 РОП backfill, which this API
does not serve at all (they have no ЦАИС `tenderId`; their dossier equivalent is the
existing `ingest_rop_dossier.ts` aop.bg path).

| Year | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (7mo) |
|---|---|---|---|---|---|---|---|
| Tenders | 8,288 | 19,300 | 21,897 | 19,105 | 22,764 | 24,017 | 11,828 |

### 2.1 Tier 0 — details only, no file bytes

- **127,199 calls.** At 1 req/s ≈ **35 h**; at concurrency 4 ≈ **9 h**. One-off, resumable.
- **Storage: 44.2 GB raw → 3.5 GB gzipped** (measured 7.9% gzip ratio; mean 365 KB/tender,
  29 KB gzipped). Almost all of it is `HtmlPreview`.
- **Incremental cadence is trivial**: ~1,700 new tenders/month ≈ **55/day** ≈ 1 minute.

### 2.2 Tier 1 — downloading the attachments

Measured over 246 attachments across 60 random 2024+ tenders (mean **4.1** files/tender):

| Ext | Files | Bytes |
|---|---|---|
| .pdf | 99 | 115.5 MB |
| .docx | 73 | 12.7 MB |
| .doc | 37 | 6.3 MB |
| .xlsx / .xls | 19 | 0.5 MB |
| **.zip / .rar / .7z** | **16** | **1,025.2 MB** |
| .xml / .odt | 2 | 0.1 MB |

**The archives are 6.5% of the files and 88% of the bytes.** They are construction project
documentation — drawings, CAD, scans — with poor text yield per byte.

| Scope | Projected corpus |
|---|---|
| Everything | **2,402 GB** |
| Excluding archives | **~285 GB** |
| Filename-matched "техническа спецификация" only (68% of tenders) | **~57 GB** |

**MD5 dedup does not help**: 246/246 distinct. Buyers re-upload boilerplate rather than
share it, so there is no cross-tender file reuse to exploit.

## 3. Scoping decision — the one thing to settle before coding

Tier 0 delivers the description, the contact, the attachment inventory and the full notice
text for **3.5 GB and ~9 hours**. Tier 1 delivers the actual spec bytes for **57–285 GB**
and a much longer crawl, and its text-extraction yield is **unmeasured** (see §6).

**Recommendation: build Tier 0 completely, ship it, then decide Tier 1 on evidence.**
Tier 0 is ~1.4% of the storage of the no-archives Tier 1 and already answers most of what
the 24chasa article's reader wants — with the honest caveat that the coffee-type detail
itself lives in the PDF, so Tier 1 is where "what does it actually buy" is finally answered.
Tier 0 also makes Tier 1 *targetable*: you cannot decide which files are worth fetching
until you have the manifest, and the manifest is Tier 0.

Three sub-questions inside Tier 1 that need answers, not guesses:

1. **Archives — in or out?** Recommend out for v1 (88% of bytes, worst text yield).
2. **How far back?** 2024+ is 58,609 tenders and the eForms-structured era. Full history is
   127,199.
3. **Store bytes, or store extracted text and re-link?** Recommend **text only** — keep the
   raw store as the cache, publish text + a signed-URL redirect, never re-host the file.
   This avoids becoming a mirror of a register that already hosts its own files, and keeps
   Cloud SQL out of the blob business.

## 4. Architecture

Follows the established raw-store → projection → PG shape used by `cr_deeds_store.ts` and
`kzk_decisions_store.ts`.

```
scripts/procurement/eop_dossier_store.ts     raw SQLite, gitignored, NEVER uploaded
  raw_data/procurement/eop_dossier.sqlite    (tenderId -> gzipped details JSON + fetch state)
        │
        ├─ scripts/procurement/ingest_eop_dossier.ts    the rate-limited crawl (operator-run)
        │     --probe | --backfill --from-year | --apply | --refresh-open
        │
        └─ scripts/procurement/normalize_eop_dossier.ts offline projection, no re-fetch
              ├─ parse_notice_bt.ts     eForms BT-keyed parser (2024+)
              └─ parse_notice_legacy.ts label parser (2020–2023)
                      │
        scripts/db/load_tender_dossier_pg.ts │  migration 132
                      ▼
   tender_dossier        (unp PK, tender_id, description_text, description_html,
                          contact_name/email/phone, offer_phase_start/end,
                          opening_of_offers, org_id, tender_guid, fetched_at, source_url)
   tender_document       (document_id PK, unp, tender_id, name, ext, mime, size_bytes,
                          md5, container, cloud_name, kind, created_at)  -- inventory
   tender_notice         (unp, publication_id, form_type, notice_no, is_eforms,
                          text, bt jsonb)                                -- parsed notice
   tender_document_text  (document_id PK, text, chars, extractor, ok)    -- Tier 1 only
```

Key constraints, each of which is a bug if forgotten:

- **Never persist a signed URL.** `X-Amz-Expires=1800`. Store
  `(document_id, container, cloud_name)` and re-mint at serve time.
- **`tender_document.kind` is a classification, not a fact.** Filename matching hit 68% for
  "техническа спецификация" on the sample. It must be a nullable, clearly-derived column
  with an `unclassified` bucket — not a guess dressed as source data.
- **The dossier mutates.** `tenders.change_notice_count` is non-zero on real rows and
  buyers re-upload documents during the offer phase. Rows whose `offer_phase_end` is in the
  future need a refresh pass; rows past it are immutable and must never be re-fetched.
- **`tender_dossier` is a DERIVED serving layer.** Per the repo convention it takes a
  `recent_updates` row (it is a new dataset with its own cadence), but the projections
  below it do not each get one.

## 5. Task breakdown

**T0 — spike (½ day, do this first).** Measure the two things §2/§6 could not:
(a) PDF text-layer coverage — what fraction of tech-spec PDFs are scans with no extractable
text (memory: the Sofia council protokol PDFs had no `ToUnicode`); (b) sustained crawl
behaviour — 2,000 calls at the intended rate, watching for throttling that 162 calls cannot
reveal. **Both outcomes change the plan**; (a) decides whether Tier 1 needs OCR (which would
move it from "large" to "very large"), (b) decides the crawl's concurrency.

**T1 — raw store + crawler.** `eop_dossier_store.ts` + `ingest_eop_dossier.ts`.
Carry the CR-Deeds invariant verbatim: **a row means "the register answered"; a null field
means "it answered and had nothing"; it must never mean "we could not reach it."** Use a
discriminated `{ok:true,…} | {ok:false,reason,…}` result and never persist a failure as an
answer. `--probe` first, as with `tr:cr-deeds`.

**T2 — the two notice parsers** + their unit tests, with a **measured** BT-coverage gate so
the eForms/legacy split can't silently regress.

**T3 — migration 132 + `load_tender_dossier_pg.ts`**, stage-merge (all four tables are on a
serving path — `TRUNCATE`+rebuild would 500 the routes at `lock_timeout`; see
`scripts/db/lib/stage_merge.ts`).

**T4 — serving.** Extend `/tenders/:unp` (`src/screens/procurement/TenderDetailScreen.tsx`)
with a Документация tile: full description, attachment list with size/type, per-file
download via a new `/api/db/tender-document?id=<documentId>` route that mints the signed URL
and **302-redirects** to `storage.eop.bg` (no bytes through our function). Surface the
contact officer only after the §7 decision.

**T5 — search.** Fold `description_text` + `notice.text` into the tenders DbDataTable global
search. Note the search+`ORDER BY`+`LIMIT` seq-scan fence
(`reference_dbtable_search_orderby_fence`) applies here, on a much bigger text column.

**T6 — risk signals** (feeds `procurement-risk-v2`): no technical specification published;
offer window short relative to value; price-only award criterion on complex works
(`BT-539-Lot`); brand named without "или еквивалент"; documentation replaced late in the
offer phase.

**T7 — wiring.** New `data.test.ts` gates; `db:load:tender-dossier:pg:cloud` added to the
`update-procurement` watch skill **and** to the CLAUDE.md cloud-loader list — per
`reference_migrated_family_watch_reload`, a family that has no cloud reload in the
regenerating skill goes stale on prod with nothing failing.

Tier 1 (T8+) is deliberately not broken down until T0 reports.

## 6. What is NOT measured — stated so nobody reads this plan as more certain than it is

- **PDF text-layer coverage.** No attachment was downloaded during this analysis. If a large
  share of specs are scans, Tier 1 needs OCR and its cost estimate is wrong.
- **`.doc` (binary Word) extraction** — 15% of sampled files. Needs `antiword`/LibreOffice;
  not currently a repo dependency.
- **Sustained rate limits.** 162 calls at ~1 req/s is not evidence about 127,199.
- **Mutation rate.** How often a dossier actually changes during the offer phase is unknown,
  so the refresh-pass cost in §4 is a guess.
- **Non-BG egress.** The sibling `storage.eop.bg` open-data feed is *not* IP-gated, but this
  service host was only exercised from one egress.
- The document-kind mix (§2.2) is measured on **2024+ only** — 60 tenders. Pre-2024
  attachment shape may differ.

## 7. Decisions needed

1. **Tier 1 scope** — build it at all in v1? If so: archives in/out, year floor, bytes vs
   text-only. (Recommendation in §3: Tier 0 first, then decide.)
2. **Contact officer PII.** `ContactPersonEmail` / `ContactPersonPhone` are the named
   procurement officer's work contacts, published by the register. Ingesting them is
   defensible; **displaying** them, and especially resolving them into the person-identity
   layer, is a separate call. Recommendation: ingest, do not display, do not resolve, in v1.
3. **Do we re-host any file bytes?** Recommendation: no — text + redirect only.
