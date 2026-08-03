# Tender dossier ingest (документация / техническа спецификация) — v1

Ingest the per-procedure **dossier** that ЦАИС ЕОП publishes alongside every tender — the
long free-text description, the contact officer, the attached documents (документация,
техническа спецификация, методика за оценка, проект на договор), the award-stage trail
(протоколи, доклади, решения), and the full rendered обявление/решение — so `/tenders/:unp`
stops being a row of notice-header fields and starts carrying what the buyer actually asked
for and how it decided.

**Decision taken 2026-08-03: ingest everything reachable. Display is a later decision.**
§3 and §7 of the first draft (which proposed a staged Tier-0-first scope and deferred the
PII question) are settled and folded in below.

**Status: audited 2026-08-03.** The audit (§8) found the first draft understated the source
by roughly 3× in call volume and added three datasets it had missed entirely. Numbers below
are post-audit.

## 0. Why now — the gap this closes

`00728-2026-0018` (Народно събрание, coffee & packaged food for MPs' offices, €86,051,
deadline 2026-09-04) is in the corpus and correct. But every fact a reader actually cares
about — nine coffee types, 39,000 sugar packets, 10 coffee machines with 24-hour
replacement — lives in `Приложение_1_Техническа спецификация….pdf`, which we do not have
and do not link to. We can tell you a tender exists. We cannot tell you what it buys, and we
cannot tell you why a particular bidder won.

| | |
|---|---|
| Mean `tenders.subject` length | **138 chars** |
| Mean dossier description length | **1,633 chars** (~12×) |
| Tenders whose `subject` is explicitly truncated at source | **180** |
| Tenders with `length(subject) >= 240` (truncation-prone) | **7,487** |
| Tenders with a non-empty dossier description | **98–100%** (two samples, n=102 / n=60) |
| Tenders with ≥1 attached document | **90–97%**, mean **4.0–4.9** docs |
| Tenders with ≥1 award-stage announcement | **90%**, mean **2.5** |

This is the tender-side twin of the known contract-title truncation problem, and the same
fix applies: go to the record the truncation was truncated *from*.

## 1. The source — discovered and verified 2026-08-03

`app.eop.bg` is an Angular SPA over a WCF JSON service. Everything below was called
**anonymously**, from an ordinary egress, with no session, cookie, or token.

- **Service host** — `https://service.eop.bg/NX1Service.svc/<Method>`, `POST`,
  `Content-Type: application/json`, named-parameter JSON body. The full method catalogue is
  self-describing at `https://service.eop.bg/NX1Service.svc/js` (812 KB WCF proxy; every
  signature is `Method:function(arg1,arg2,…,succeededCallback,…)`).
- **Blob host** — `https://storage.eop.bg` (MinIO behind an S3v4 signer). Objects are **not**
  publicly readable (bare GET → `403`); a presigned URL is required, minted per document.
- **robots.txt** — `app.eop.bg` serves `User-agent: * / Allow: /`. Crawling is permitted.
  `service.eop.bg` / `storage.eop.bg` serve none (404 / 403).

### 1.1 The anonymous surface is exactly the `Public*` / `Published*` prefix

This was measured, not assumed. 16 other per-tender methods were probed and **every one is
denied**: `GetTender`, `GetIsTenderPublished`, `GetContractListItems`, `GetBoxesByTenderId`,
`GetBoxByType`, `GetLinkedTenders`, `GetMultilotTenderOverviewByMainTenderId`,
`GetPublicationAuthoritiesByTenderId`, `GetTenderPublicationsByTenderId`,
`GetComplaintTenderBasicInfo`, `GetSurveyQuestionsWithProductListByTenderId`,
`GetTenderValidityPeriod`, `GetTenderControlData`, `GetAuctionByTenderId` → HTTP 401
`ErrorCode 1`; `GetTenderHasContracts` → 403 `ErrorCode 2`.

**The one that matters most among the denied: `GetEvaluatedOffersByTenderId` → 401.**
Per-bidder scores and offer values are *not* available as structured data. The only route to
them is the протокол PDF (§1.3). Any plan that assumes structured bid data is wrong.

**12 methods confirmed working anonymously:**

| Scope | Method | Body | Yields |
|---|---|---|---|
| tender | `GetPublishedTenderDetails` | `{tenderId, ianaTimeZone}` | description, contact, **attachment manifest**, **full notice HTML**, `OrganizationId` |
| tender | `GetPublicTenderAnnouncementsByTenderId` | `{tenderId, ianaTimeZone}` | **award-stage trail** (§1.3) |
| tender | `GetPublishedTenderExportsByTenderId` | `{tenderId, ianaTimeZone}` | the per-lot "Експорт" ZIPs |
| tender | `GetPublishedContractListItems` | `{tenderId, ianaTimeZone}` | **contracts + suppliers + annexes** (§1.4) |
| tender | `GetPublishedLots` | `{tenderId, ianaTimeZone}` | lot names + status |
| tender | `GetPublicTenderParticipation` | `{tenderId, cultureId, ianaTimeZone}` | lots/rounds/auction shell |
| tender | `GetPublishedChildTendersPublications` | `{tenderId}` | child (mini-competition) publications |
| announcement | `RetrieveTenderAnnouncementDocuments` | `{tenderAnnouncementId}` | **the протокол/доклад/решение files** |
| export | `GetPublishedTenderExportDocument` | `{publishedTenderExportId}` | the export ZIP's document |
| organization | `GetPublicBuyerProfileBasicInformation` | `{organizationId}` | **buyer address + NUTS + EIK** (§1.5) |
| organization | `GetPublicBuyerProfileDocuments` | `{organizationId}` | buyer-profile documents |
| document | `GetSignedUrlByDocumentId` | `{documentId}` | presigned URL, **30-min expiry** |

A further 5 anonymous search methods exist (`GetPublishedTendersSearchResult`,
`…AdvancedSearchResult`, `GetPublishedTendersBySpecified`, `GetPublishedContracts`,
`GetPublicBuyerProfileTendersBySpecified`). Their request shape was **not** reverse-engineered
— three guessed shapes returned `ErrorCode 4`, and the SPA's WCF proxy binds `XMLHttpRequest`
before page scripts can hook it. See §6.

Everything is keyed by `tenderId`, which we **already hold** for every ЦАИС-era row as
`tenders.tender_id` (it is also the `ocid` suffix). No discovery crawl, no pagination, no id
guessing.

### 1.2 `GetPublishedTenderDetails` — the anchor call

For `tenderId=587133` the response is 466 KB, wildly lopsided:

```
454,467  TenderPublicationDetails    <- 97.4%; array of {DocumentId, HtmlPreview, …}
  4,295  TenderDescriptionDocuments  <- attachment inventory (5 files)
  1,411  TenderDescription           <- the long "Кратко описание / документация"
  1,233  PublicationAuthorities
    ...  ContactPerson{DisplayName,Email,Phone}, OfferPhase{Start,End}Date,
         OpeningOfOffersDate, SpecialNumber (=УНП), TenderGuid, OrganizationId
```

`TenderDescriptionDocuments[]` is a complete manifest **without the bytes** — `Id`, `Name`,
`Extension`, `MimeType`, `Size`, `MD5Hash`, `Container`, `DocumentCloudName`, `Owner`,
`CreatedDate`, plus `IsPreviousVersion` / `PreviousVersionId`. That manifest alone supports
"this €40M works tender published no technical specification" without downloading anything.

**The notice HTML is eForms BT-keyed.** `TenderPublicationDetails[].HtmlPreview` is the
rendered обявление, numeric-entity-encoded (`&#1044;…`); after decoding and tag-stripping it
carries EU eForms Business Term codes inline next to their values:

```
Продължителност (BT-36-Lot) 24 Месец
Критерии за възлагане … Вид(BT-539-Lot) Цена  Наименование(BT-734-Lot) Цена
Критерии за подбор (BT-809-Lot) Регистрация в съответен професионален регистър
```

Parseable by key, not by fragile Bulgarian label regex — but coverage is a hard date cliff,
measured over 102 tenders stratified by (year × notice type):

| Year | 2020 | 2021 | 2022 | 2023 | **2024** | **2025** | **2026** |
|---|---|---|---|---|---|---|---|
| n | 13 | 16 | 13 | 14 | 19 | 15 | 12 |
| with BT codes | 15% | 6% | 31% | 36% | **95%** | **100%** | **100%** |
| mean distinct BTs | 6 | 5 | 13 | 7 | 77 | 81 | 83 |

**2024→ is a structured-data ingest; 2020–2023 is a text ingest.** The parser must be
two-family, and the older tier must be explicit that its structured fields are sparse rather
than emit nulls that read as "no award criteria". Do not build one parser and assume it
degrades gracefully.

### 1.3 The award-stage trail — `GetPublicTenderAnnouncementsByTenderId`

**Present on 90% of tenders, mean 2.5 per tender.** Despite the page label
("Разяснения и съобщения"), this is *not* a bidder-Q&A feed. It is the evaluation and award
record. Observed titles across a 30-announcement sample:

> Протокол № 1 / № 2 / № 3 от работата на комисията · Протокол по чл. 181, ал. 4 от ЗОП ·
> Протокол по чл. 192, ал. 4 ЗОП · Доклад · Доклад по чл. 237б · Решение за определяне на
> изпълнител · Решение по чл. 22, ал. 1, т. 6 · Решение за прекратяване на обществена
> поръчка · Решение за предварителен подбор · Решение за отмяна на влязло в сила решение

The payload itself is thin — `{Id, Title, Text, CreatedDate, ReceiptDocumentHash}`, `Text`
p50 = 37 chars, max 576, `ReceiptDocumentHash` null in 30/30. **The document is a second
call**: `RetrieveTenderAnnouncementDocuments(Id)` → e.g. `Протокол 1.pdf`, 137 KB, with its
own `Container` / `DocumentCloudName` (note: a *different* container from the tender's own
attachments — containers are per-uploader, so never assume one container per tender).

This is the single highest-value dataset the first draft missed. It is the only public route
to how the committee scored, why bidders were disqualified, and when a procedure was
cancelled — because `GetEvaluatedOffersByTenderId` is 401.

### 1.4 Contract lineage — `GetPublishedContractListItems`

Present on **62%** of sampled tenders. Returns full contract records, not stubs:

```json
{ "Id": 205197, "MainTenderId": 479847,
  "Subject": "„Периодични доставки на строителни материали …”",
  "Value": 139744, "CurrentContractValue": 139744, "Currency": 3,
  "StartDate": "/Date(…)/", "EndDate": "/Date(…)/",
  "CurrentStartDate": "/Date(…)/", "CurrentEndDate": "/Date(…)/",
  "ContractSuppliers": [{ "OrganizationName": "ГЕОТОН БЕТОНОВИ ИЗДЕЛИЯ ООД",
                          "RegistryNumber": "102893989" }],
  "Annexes": [], "ExportDocumentId": 46156027 }
```

`Value` vs `CurrentContractValue` and the `Annexes[]` array are an **independent source for
the post-annex current value** the contracts corpus already models (migration 114,
`procurement_annexes`). Treat it as a cross-check, not a replacement — but it must be
reconciled, because two disagreeing annex sources shipping side by side is worse than one.

### 1.5 Buyer profile — `GetPublicBuyerProfileBasicInformation(organizationId)`

`OrganizationId` comes free on every `GetPublishedTenderDetails` response. The profile
returns `RegistryNumber` (EIK), `Address {City, Postcode, StreetAddress}`, `NutsCode`,
`OrganizationStructure.RelatedOrganizations[]`, `BatchNumber` (the АОП партида), and
`TotalPublishedTendersCount`.

This bears directly on a known repo gap: the flat ЦАИС feed carries **no buyer address**, so
those awarders never resolve to an EKATTE and are absent from the by-settlement map
(`update-procurement` Step 1c). This is an address source keyed by an id we will already have
for all 127,199 tenders.

`TotalPublishedTendersCount` is a candidate per-buyer completeness canary but **needs
calibration before being trusted**: org 1297 (НС) reports 254 while our corpus holds 516 rows
for EIK 000695018 across two `buyer_name` spellings. Either it counts something narrower, or
one EIK spans several `organizationId`s. Unresolved — see §6.

## 2. Cost — measured, and ~3× the first draft

222 anonymous calls were made during this analysis with **zero** failures and no throttling
observed. Latency over the 102-tender stratified sample: **p50 647 ms, p90 1,486 ms, max
3,421 ms**.

**Addressable set: 127,199 tenders** — every `ocid LIKE 'ocds-e82gsb-%'` row, all of which
carry a `tender_id`. The other 105,527 rows are the pre-2020 РОП backfill, which this API
does not serve at all (no ЦАИС `tenderId`); their dossier equivalent is the existing
`ingest_rop_dossier.ts` aop.bg path, out of scope here.

| Year | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (7mo) |
|---|---|---|---|---|---|---|---|
| Tenders | 8,288 | 19,300 | 21,897 | 19,105 | 22,764 | 24,017 | 11,828 |

### 2.1 API call budget

| Stage | Calls | Basis |
|---|---|---|
| Tender-level (7 methods × 127,199) | ~890,000 | measured method set |
| Announcement documents (0.9 × 2.5 × 127,199) | ~286,000 | 90% × mean 2.5 |
| Buyer profiles | ~2,000 | distinct organizationId, est. |
| **Signed-URL minting — one call per document** | **~1,140,000** | 521k attachments + 286k announcement docs + 331k export ZIPs |
| **Total** | **~2.3M** | |

At p50 0.65 s and concurrency 4 that is **~104 hours** of API time — before any file
transfer. **The first draft costed 127,199 calls / ~9 h; it omitted the per-document signing
round-trip entirely, which is by itself half the budget.** Signed URLs expire in 30 minutes,
so they cannot be pre-minted in bulk and cached ahead of the download.

### 2.2 Byte budget

Details JSON: **44.2 GB raw → 3.5 GB gzipped** (measured 7.9% ratio; mean 365 KB/tender).

Attachments, measured over 246 files across 60 random 2024+ tenders (mean **4.1**/tender):

| Ext | Files | Bytes |
|---|---|---|
| .pdf | 99 | 115.5 MB |
| .docx | 73 | 12.7 MB |
| .doc | 37 | 6.3 MB |
| .xlsx / .xls | 19 | 0.5 MB |
| **.zip / .rar / .7z** | **16** | **1,025.2 MB** |
| .xml / .odt | 2 | 0.1 MB |

**The archives are 6.5% of the files and 88% of the bytes** — construction project
documentation, drawings, CAD, scans. **MD5 dedup does not help: 246/246 distinct.**

| Corpus | Files | Bytes |
|---|---|---|
| Tender attachments | ~521,000 | **2,402 GB** |
| Announcement documents | ~286,000 | **~40 GB** (one 137 KB sample — weak) |
| Export ZIPs | ~331,000 | **UNMEASURED** — see §6 |
| Details JSON (gzipped) | — | 3.5 GB |

**≈2.5 TB before the export ZIPs are measured, and the ZIPs plausibly rival the attachments
because they are a repackaging of them.** At a sustained 100 Mbit that is ~2.5 days of pure
transfer.

### 2.3 Incremental cadence

~1,700 new tenders/month ≈ **55/day** → roughly 400 API calls and a few hundred MB per day.
Trivial. The one-off backfill is the whole cost.

## 3. Scope — settled

**Ingest everything reachable**: all 12 anonymous methods, all attachments including
archives, all announcement documents, all export ZIPs, all buyer profiles. Store the bytes;
extract text where a toolchain exists; decide display later.

Two constraints that survive the "ingest everything" decision because they are not display
choices:

- **The raw store is gitignored and never uploaded**, exactly like `raw_data/tr/cr_deeds.sqlite`.
- **Do not re-host file bytes to end users from our own infrastructure.** Serving is a
  signed-URL redirect to `storage.eop.bg` (§4). Ingesting a 2.5 TB corpus for analysis is a
  different act from becoming its public mirror, and only the first was decided.

## 4. Architecture

Two stores, because one does not fit both shapes. **The first draft's single-SQLite design is
wrong at 2.5 TB** and is replaced:

```
raw_data/procurement/eop_dossier.sqlite      JSON store (~4 GB): per-tender gzipped
                                             details/announcements/contracts/lots/exports
                                             + fetch state. Gitignored. Never uploaded.
raw_data/procurement/eop_blobs/<md5[0:2]>/<md5>   content-addressed blob store (~2.5 TB)
                                             + a `blob(md5, size, ext, mime, sha256)` table
                                             in the SQLite. Separate disk/volume.
        │
        ├─ scripts/procurement/ingest_eop_dossier.ts     JSON crawl (operator-run)
        │     --probe | --backfill --from-year | --apply | --refresh-open
        ├─ scripts/procurement/ingest_eop_blobs.ts       blob crawl (separate, resumable)
        │     --kinds attachments,announcements,exports --max-bytes …
        └─ scripts/procurement/extract_eop_text.ts       offline text extraction, no re-fetch
                │
     normalize_eop_dossier.ts  ─ parse_notice_bt.ts     eForms BT parser (2024+)
                               └ parse_notice_legacy.ts label parser (2020–2023)
                │
     scripts/db/load_tender_dossier_pg.ts   │  migration 132 (verify free at branch time)
                ▼
  tender_dossier        unp PK, tender_id, organization_id, description_text/html,
                        contact_name/email/phone, offer_phase_start/end, opening_of_offers,
                        tender_guid, fetched_at, source_url
  tender_document       document_id PK, unp, tender_id, source ('attachment'|'announcement'
                        |'export'|'buyer_profile'), name, ext, mime, size_bytes, md5,
                        container, cloud_name, kind, is_previous_version, previous_version_id
  tender_notice         unp, publication_id, form_type, notice_no, is_eforms, text, bt jsonb
  tender_announcement   announcement_id PK, unp, title, text, created_at
  tender_contract_item  contract_id PK, unp, subject, value, current_value, currency,
                        start/end, current_start/end, suppliers jsonb, annexes jsonb
  tender_buyer_profile  organization_id PK, eik, name, city, postcode, street, nuts_id,
                        batch_number, total_published_tenders, related_orgs jsonb
  tender_document_text  document_id PK, text, chars, extractor, ok
```

Constraints, each of which is a bug if forgotten:

- **Never persist a signed URL** (`X-Amz-Expires=1800`). Store `(document_id, container,
  cloud_name)` and re-mint at serve time.
- **Key blobs on `(container, cloud_name)`, not on tender.** Announcement documents live in a
  different container from the tender's own attachments.
- **`tender_document.kind` is a classification, not a fact.** Filename matching hit 68% for
  "техническа спецификация". Nullable, clearly derived, with an `unclassified` bucket.
- **The dossier mutates.** Rows whose `offer_phase_end` is in the future need a refresh pass;
  rows past it are immutable and must never be re-fetched. Documents carry
  `IsPreviousVersion`/`PreviousVersionId` — version history is itself a risk signal (a spec
  replaced two days before the deadline).
- **A row means "the register answered." A null field means "it answered and had nothing." It
  must never mean "we could not reach it."** Carry the CR-Deeds invariant verbatim: a
  discriminated `{ok:true,…} | {ok:false,reason,…}` result, and never persist a failure as an
  answer. This is the defect that silently corrupted `company_founded`, and it is far harder
  to notice at 2.3M requests.
- **Untrusted third-party files.** ~1.1M files uploaded by ~2,000 organizations. Never
  execute; bound archive extraction (zip bombs, path traversal in `.rar`/`.7z`); treat all
  extracted text as data, never as instructions.
- **`tender_dossier` is a derived serving layer** and takes a `recent_updates` row; the
  projections below it do not each get one.

## 5. Task breakdown

**T0 — spike (½–1 day, do this first).** Four measurements the plan is currently guessing at,
each of which changes a later task:
(a) **PDF text-layer coverage** — what fraction of tech-spec PDFs are scans with no
extractable text (the Sofia council protokol PDFs had no `ToUnicode`); decides whether text
extraction needs OCR, which would move it from "large" to "very large".
(b) **Export ZIP size and content** — 331k files of unmeasured size; if they merely repackage
the attachments, skipping them halves the byte budget.
(c) **Sustained crawl behaviour** — 2,000+ calls at the intended concurrency; 222 calls says
nothing about 2.3M, and the budget is now ~104 h of API time.
(d) **`TotalPublishedTendersCount` calibration** — settle the 254-vs-516 discrepancy so we
either have a completeness canary or knowingly do not.

**T1 — JSON store + crawler.** `eop_dossier_store.ts` + `ingest_eop_dossier.ts`, all 7
tender-level methods + buyer profiles. `--probe` first, as with `tr:cr-deeds`.

**T2 — blob store + crawler.** `ingest_eop_blobs.ts`, content-addressed, resumable,
rate-limited, `--kinds` gated so archives/exports can be deferred or capped without a code
change. Runs off the manifests T1 already captured — never re-fetches JSON.

**T3 — the two notice parsers** + unit tests, with a **measured** BT-coverage gate so the
eForms/legacy split cannot silently regress.

**T4 — text extraction.** `.pdf`, `.docx`, `.doc` (needs `antiword`/LibreOffice — not a
current repo dependency), `.xlsx`; archives expanded one level, bounded. OCR only if T0(a)
says so.

**T5 — migration 132 + `load_tender_dossier_pg.ts`**, stage-merge (every table is on a
serving path; `TRUNCATE`+rebuild would 500 the routes at `lock_timeout` — see
`scripts/db/lib/stage_merge.ts`).

**T6 — serving.** Extend `/tenders/:unp` (`src/screens/procurement/TenderDetailScreen.tsx`):
full description, attachment list, award-stage timeline. Per-file download via a new
`/api/db/tender-document?id=<documentId>` route that mints the signed URL and
**302-redirects** to `storage.eop.bg` — no bytes through our function.

**T7 — search.** Fold `description_text` + `notice.text` + extracted document text into the
tenders DbDataTable global search. The search + `ORDER BY` + `LIMIT` seq-scan fence
(`reference_dbtable_search_orderby_fence`) applies here on a much larger text column.

**T8 — reconciliation.** Cross-check `GetPublishedContractListItems` annexes and
`CurrentContractValue` against `procurement_annexes` (114); cross-check buyer-profile
addresses against `awarder_seats`. Both must be reconciled, not shipped alongside — two
disagreeing sources for the same figure is worse than one.

**T9 — risk signals** (feeds `procurement-risk-v2`): no technical specification published;
documentation replaced late in the offer phase; offer window short relative to value;
price-only award criterion on complex works (`BT-539-Lot`); brand named without "или
еквивалент"; procedure cancelled after protocol 1; unusual gap between протокол and решение.

**T10 — wiring.** New `data.test.ts` gates; `db:load:tender-dossier:pg:cloud` added to the
`update-procurement` watch skill **and** to the CLAUDE.md cloud-loader list — per
`reference_migrated_family_watch_reload`, a family with no cloud reload in the regenerating
skill goes stale on prod with nothing failing.

## 6. What is NOT measured — stated so nobody reads this plan as more certain than it is

- **PDF text-layer coverage.** No attachment was downloaded during this analysis.
- **Export ZIP size** — 331k files, zero measured. The largest single hole in the byte budget.
- **Announcement document size** — one 137 KB sample extrapolated to ~286k files.
- **`.doc` (binary Word) extraction** — 15% of sampled files; needs a toolchain the repo lacks.
- **Sustained rate limits.** 222 calls at ~1 req/s is not evidence about 2.3M.
- **Mutation rate** — how often a dossier changes during the offer phase, so the refresh-pass
  cost is a guess.
- **The 5 search methods' request shape** — three guesses returned `ErrorCode 4`; the SPA's
  WCF proxy binds `XMLHttpRequest` before page scripts can hook it, so capture needs devtools
  or a proxy. Blocks a whole-corpus completeness audit (as does the unresolved canary below).
- **`TotalPublishedTendersCount` semantics** — 254 (org 1297) vs 516 corpus rows for the same
  EIK, unexplained.
- **Attachment mix is measured on 2024+ only** (60 tenders); pre-2024 shape may differ.
- **Non-BG egress** — the service host was exercised from one egress only.
- **Cloud SQL sizing** for the extracted text is not estimated.

## 7. Settled decisions

1. **Scope — settled: ingest everything reachable.** Archives in, exports in, announcements
   in, full history.
2. **PII — settled: ingest, defer display.** Note this is a materially larger surface than
   the first draft assumed: beyond the contact officer's work email/phone, the протокол PDFs
   name evaluation-committee members and bidder representatives. Ingest is defensible (public
   register, robots-permitted); *display* and especially *person-layer resolution* remain
   undecided and should not be treated as authorized by this plan.
3. **Re-hosting — settled: no.** Text + signed-URL redirect only.

## 8. Audit log — what the first draft got wrong (2026-08-03)

Recorded so the same gaps are not re-derived.

| # | Gap | Impact |
|---|---|---|
| 1 | Claimed "4 methods matter". The anonymous surface is **12**, and the denied set was never probed. | Understated the dataset |
| 2 | **Missed the award-stage trail entirely** (90% of tenders) and that `RetrieveTenderAnnouncementDocuments` is anonymous — the протокол/доклад/решение PDFs. | Missed the highest-value dataset |
| 3 | **Missed the buyer profile** — address/NUTS/EIK keyed by an id we get free. Bears on the known awarder-EKATTE gap. | Missed a fix for an existing defect |
| 4 | `GetPublishedContractListItems` listed but never opened: it carries suppliers, `CurrentContractValue` and `Annexes[]`, overlapping migration 114. | Missed a reconciliation obligation |
| 5 | **Omitted per-document signed-URL calls** — ~1.14M, half the total call budget. Costed 127,199 calls / ~9 h against an actual ~2.3M / ~104 h. | Off by ~11× on API time |
| 6 | Byte budget omitted announcement documents (~40 GB) and export ZIPs (unmeasured, ~331k files). | 2.4 TB → ≥2.5 TB, one hole open |
| 7 | Proposed a **single SQLite raw store** for a 2.5 TB corpus. | Architecture non-viable as drafted |
| 8 | Never verified whether lot `tenderId`s carry their own dossier. *(Audited: they do not — lots return a 1.2 KB stub with null `SpecialNumber`, no docs, no publications. The 127,199 figure survives.)* | Assumption, now verified |
| 9 | Missed that **248 rows carry a synthetic `unp` of form `T<tenderId>`** and the API returns `SpecialNumber: ""` for them. | Would read as fetch failures |
| 10 | Missed that containers are **per-uploader**, not per-tender. | Blob-key bug |
| 11 | Missed document **version history** (`IsPreviousVersion` / `PreviousVersionId`). | Lost a risk signal |
| 12 | No malware / archive-bomb / untrusted-input posture for ~1.1M third-party files. | Safety gap |
| 13 | Did not establish that **`GetEvaluatedOffersByTenderId` is 401** — per-bidder scores are not structured data anywhere. | Would have been designed around a non-existent source |
| 14 | No completeness-audit mechanism. *(Still open — see §6.)* | Unresolved |
