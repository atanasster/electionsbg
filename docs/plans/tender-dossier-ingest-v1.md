# Tender dossier ingest (документация / техническа спецификация) — v1

Ingest the per-procedure **dossier** that ЦАИС ЕОП publishes alongside every tender — the
long free-text description, the contact officer, the attached documents (документация,
техническа спецификация, методика за оценка, проект на договор), the award-stage trail
(протоколи, доклади, решения), and the full rendered обявление/решение — so `/tenders/:unp`
stops being a row of notice-header fields and starts carrying what the buyer actually asked
for and how it decided.

**Decision taken 2026-08-03: ingest everything reachable. Display is a later decision.**

**Status: audited twice (2026-08-03).** Audit 1 (§8) found the source understated. Audit 2
(§9–§11) hunted bulk routes and closed the measured unknowns; it changed the byte budget by
~1.5×, found a **bulk route that removes ~400k API calls**, found that **~50% of протоколи
are scans needing OCR**, and surfaced **an unrelated 69-day hole in the existing tenders
corpus** (§11). Every number below is post-audit-2.

## 0. Why now — the gap this closes

`00728-2026-0018` (Народно събрание, coffee & packaged food for MPs' offices, €86,051,
deadline 2026-09-04) is in the corpus and correct. But every fact a reader actually cares
about — nine coffee types, 39,000 sugar packets, 10 coffee machines with 24-hour
replacement — lives in `Приложение_1_Техническа спецификация….pdf`, which we do not have
and do not link to.

**Verified end to end during audit 2**: that PDF was fetched, and `pdftotext` yields 57 KB of
clean Bulgarian containing exactly the article's specifics — `Кафява захар пакетче,
натурална тръстикова захар Пакетче - 4 г.`, `8760 бр`, капсули, безкофеиново. The pipeline
below is known to work, not assumed to.

| | |
|---|---|
| Mean `tenders.subject` length | **138 chars** |
| Mean dossier description length | **1,633 chars** (~12×) |
| Tenders with a non-empty dossier description | **98–100%** (n=102 / n=60) |
| Tenders with ≥1 attached document | **90–97%**, mean **4.0–4.9** |
| Tenders with ≥1 award-stage announcement | **90%**, mean **2.5** |

## 1. The source — verified 2026-08-03

`app.eop.bg` is an Angular SPA over a WCF JSON service. Everything below was called
**anonymously**, no session, cookie, or token.

- **Service** — `https://service.eop.bg/NX1Service.svc/<Method>`, `POST`, JSON body with
  named parameters. Catalogue self-describes at `/NX1Service.svc/js` (812 KB WCF proxy).
- **Blobs** — `https://storage.eop.bg` (MinIO + S3v4). Objects are not publicly readable
  (bare GET → 403); a presigned URL must be minted per document, 30-min expiry.
- **robots.txt** — `app.eop.bg`: `User-agent: * / Allow: /`. Crawling permitted.

### 1.1 The anonymous surface is exactly the `Public*` / `Published*` prefix

Measured, not assumed. 16 other per-tender methods were probed and **every one is denied**
(`GetTender`, `GetIsTenderPublished`, `GetContractListItems`, `GetBoxesByTenderId`,
`GetBoxByType`, `GetLinkedTenders`, `GetMultilotTenderOverviewByMainTenderId`,
`GetPublicationAuthoritiesByTenderId`, `GetTenderPublicationsByTenderId`,
`GetComplaintTenderBasicInfo`, `GetSurveyQuestionsWithProductListByTenderId`,
`GetTenderValidityPeriod`, `GetTenderControlData`, `GetAuctionByTenderId` → 401 `ErrorCode 1`;
`GetTenderHasContracts` → 403 `ErrorCode 2`).

**The important denial: `GetEvaluatedOffersByTenderId` → 401.** Per-bidder scores and offer
values are *not* available as structured data anywhere. The only route to them is the
протокол PDF — half of which are scans (§10.3). Any design assuming structured bid data is
wrong.

**12 methods confirmed working anonymously:**

| Scope | Method | Yields |
|---|---|---|
| tender | `GetPublishedTenderDetails` | description, contact, attachment manifest, notice HTML, `OrganizationId` |
| tender | `GetPublicTenderAnnouncementsByTenderId` | award-stage trail (§1.3) |
| tender | `GetPublishedTenderExportsByTenderId` | the per-tender export ZIPs — **the bulk route** (§9.1) |
| tender | `GetPublishedContractListItems` | contracts + supplier EIKs + annexes (§1.4) |
| tender | `GetPublishedLots` / `GetPublicTenderParticipation` / `GetPublishedChildTendersPublications` | lot + round shells |
| announcement | `RetrieveTenderAnnouncementDocuments` | the протокол/доклад/решение files |
| export | `GetPublishedTenderExportDocument` | the export ZIP's document record |
| organization | `GetPublicBuyerProfileBasicInformation` / `…Documents` | buyer address + NUTS + EIK (§1.5) |
| document | `GetSignedUrlByDocumentId` | presigned URL, 30-min expiry |

A further 5 anonymous search methods exist; their request shape was **not** reverse-engineered
(three guesses → `ErrorCode 4`; the WCF proxy binds `XMLHttpRequest` before page scripts can
hook it). **This no longer matters** — the tenderId walk (§9.3) supersedes them.

### 1.2 `GetPublishedTenderDetails` — the anchor call

Mean payload **523 KB** over a random 296-tender sample. Byte weight is lopsided:
`TenderPublicationDetails` ≈ 97% (the rendered notice), then the attachment manifest, then the
description.

`TenderDescriptionDocuments[]` is a full file manifest **without the bytes** — `Id`, `Name`,
`Extension`, `MimeType`, `Size`, `MD5Hash`, `Container`, `DocumentCloudName`, `Owner`,
`CreatedDate`, `IsPreviousVersion`, `PreviousVersionId`. It alone supports "this €40M works
tender published no technical specification" with no download.

**The notice HTML is eForms BT-keyed.** After entity-decoding, `HtmlPreview` carries EU
Business Term codes inline beside their values (`Продължителност (BT-36-Lot) 24 Месец`,
`Вид(BT-539-Lot) Цена`). Parseable by key — but coverage is a date cliff (102 tenders,
stratified by year × notice type):

| Year | 2020 | 2021 | 2022 | 2023 | **2024** | **2025** | **2026** |
|---|---|---|---|---|---|---|---|
| with BT codes | 15% | 6% | 31% | 36% | **95%** | **100%** | **100%** |
| mean distinct BTs | 6 | 5 | 13 | 7 | 77 | 81 | 83 |

**2024→ is a structured ingest; 2020–2023 is a text ingest.** Two parsers, and the older tier
must be explicit that its structured fields are sparse rather than emit nulls that read as "no
award criteria". For 2020–2023, TED (§9.4) is the better structured source where available.

### 1.3 The award-stage trail — `GetPublicTenderAnnouncementsByTenderId`

**On 90% of tenders, mean 2.5.** Despite the page label ("Разяснения и съобщения") this is
not bidder Q&A — it is the evaluation and award record: Протокол № 1/2/3 от работата на
комисията, Протокол по чл. 181 ал. 4 / чл. 192 ал. 4, Доклад, Доклад по чл. 237б, Решение за
определяне на изпълнител, Решение за прекратяване, Решение за отмяна.

The payload is thin (`{Id, Title, Text, CreatedDate}`, `Text` p50 = 37 chars). **The document
is a second call** — `RetrieveTenderAnnouncementDocuments(Id)` — and lives in a *different*
container from the tender's own attachments (containers are per-uploader).

This is the only public route to how the committee scored and why bidders were disqualified.
It is also, at **668 GB / 407k files with ~50% scanned** (§10.2, §10.3), the most expensive
thing in this plan.

### 1.4 Contract lineage — `GetPublishedContractListItems`

On **62%** of sampled tenders; full records, not stubs: `Subject`, `Value`,
`CurrentContractValue`, `Currency`, start/end + current start/end, `ContractSuppliers[]` with
`RegistryNumber` (EIK), `Annexes[]`, `ExportDocumentId`.

`Value` vs `CurrentContractValue` plus `Annexes[]` is an **independent source for the
post-annex current value** the contracts corpus already models (migration 114,
`procurement_annexes`). Reconcile it (T8) — do not ship two disagreeing annex sources.

### 1.5 Buyer profile — `GetPublicBuyerProfileBasicInformation(organizationId)`

`OrganizationId` arrives free on every details response. Returns `RegistryNumber` (EIK),
`Address {City, Postcode, StreetAddress}`, `NutsCode`, `RelatedOrganizations[]`,
`BatchNumber` (АОП партида), `TotalPublishedTendersCount`.

Bears on a known repo gap: the flat ЦАИС feed carries **no buyer address**, so those awarders
never resolve to an EKATTE and are absent from the by-settlement map. Verified 1:1 for НС —
all 238 rows map to one `organizationId` (1297) with matching EIK.

`TotalPublishedTendersCount` is **not** a usable completeness canary — see §11.

## 2. Cost — measured

### 2.1 Throughput (measured, not assumed)

A sustained **300-call burst at concurrency 6** produced:

- **8.97 req/s**, 296/300 succeeded
- latency p50 **567 ms**, p90 794 ms, p99 2,222 ms
- **no throttling**: mean latency *improved* across the run (first half 717 ms → second half
  629 ms); no 429, no 503
- **4 transient `fetch failed` (1.3%)** — so **retries are mandatory**, and this is exactly
  the CR-Deeds failure mode: an unretried transient must never be persisted as "no data".

At 9 req/s, 127,199 detail calls = **3.9 hours** — not the 35 h the first draft assumed at
1 req/s.

### 2.2 Call budget (with the export-ZIP bulk route, §9.1)

| Stage | Calls |
|---|---|
| Details × 127,199 | 127,199 |
| Announcements list × 127,199 | 127,199 |
| Exports list × 127,199 | 127,199 |
| Contract items × 127,199 | 127,199 |
| Announcement-document lists (2.5/tender) | ~318,000 |
| Signed URLs — **exports** (1/tender, not 4.1) | ~127,199 |
| Signed URLs — announcement documents | ~407,000 |
| Buyer profiles | ~2,000 |
| **Total** | **~1.36M → ~42 h** at 9 req/s |

**The export ZIP removes ~394k signed-URL calls** versus fetching attachments individually
(§9.1). Signed URLs expire in 30 min, so they cannot be pre-minted in bulk.

### 2.3 Byte budget

| Corpus | Files | Bytes |
|---|---|---|
| Details JSON | 127,199 | 66 GB raw → **~5 GB gzipped** (7.9% ratio measured) |
| Export ZIPs, newest full per tender | 127,199 | **2,981 GB** |
| Announcement documents | ~407,000 | **668 GB** |
| **Total** | | **≈3.7 TB** |

*(Attachments fetched individually would be 2,733 GB — the export ZIP is 1.09× that, and
includes the notice PDFs and the whole requirements tree on top.)*

**The distribution is what makes this tractable. 20% of tenders hold 94% of the bytes**
(export ZIP p50 = 1.97 MB, p90 = 102 MB, max 313 MB, mean 24 MB, n=44):

| Per-tender cap | Corpus | Tenders fully captured | Bytes kept |
|---|---|---|---|
| 2 MB | 187 GB | 52% | 6% |
| 5 MB | 303 GB | 77% | 10% |
| **10 MB** | **441 GB** | **80%** | 15% |
| **25 MB** | **729 GB** | **86%** | 24% |
| 100 MB | 1,892 GB | 89% | 63% |
| none | 2,981 GB | 100% | 100% |

The tail is construction project documentation (drawings/CAD/scans) — the worst text yield per
byte in the corpus. **Caveat: n=44, and the top 1 file is 30% of the sampled bytes, so the
tail estimate has wide error bars.**

**A per-tender cap does NOT solve the storage problem — see §12. Nothing is stored.** The cap
survives only as a *bandwidth/time* knob.

### 2.4 Incremental cadence

~55 new tenders/day → a few hundred calls and a few GB/day at most. The one-off backfill is
the whole cost.

## 3. Scope — settled

Ingest everything reachable: all 12 anonymous methods, all export ZIPs, all announcement
documents, all buyer profiles. Extract text, decide display later.

**Revised 2026-08-03 (§12): "ingest everything" no longer means "store the bytes".** The
local disk has 25 GB free against a 3.65 TB blob corpus, so documents are streamed —
fetched, extracted, and discarded — and only text + metadata is retained. Coverage is
unchanged; retention is not. Three constraints survive because they are not display choices:

- **The raw store is gitignored and never uploaded**, like `raw_data/tr/cr_deeds.sqlite`.
- **Do not re-host file bytes to end users.** Serving is a signed-URL redirect (§4).
  Ingesting a corpus for analysis is a different act from becoming its public mirror, and
  only the first was decided. (This is also why discarding the bytes costs nothing on the
  serving side — the plan never intended to serve them.)
- **Every document keeps full re-fetch coordinates** (`document_id`, `md5`, `size`,
  `container`, `cloud_name`). Discarding bytes must never mean losing the ability to get
  them back: a signed URL is mintable at any time, so any single document is one call away.

## 4. Architecture

**One store. Documents are streamed, never stored** (§12):

```
raw_data/procurement/eop_dossier.sqlite   ~5 GB gz  per-tender details / announcements /
                                                    contracts / lots / exports + fetch state
   + extracted document TEXT               ~3 GB gz  (§12.2 — measured per-document)
                                                    Gitignored, never uploaded.
        │
        ├─ ingest_eop_dossier.ts   JSON crawl   --probe --backfill --refresh-open --apply
        ├─ enumerate_eop_ids.ts    tenderId walk (§9.3) — completeness audit + gap-fill
        └─ ingest_eop_text.ts      STREAMING doc pass: sign → fetch → extract → store text
                                    → DISCARD bytes. Peak disk = concurrency × one file.
                                    --kinds exports,announcements --max-bytes --ocr
                │
     normalize_eop_dossier.ts ─ parse_notice_bt.ts (2024+) │ parse_notice_legacy.ts (2020–23)
                │
     scripts/db/load_tender_dossier_pg.ts   │  migration 132 (verify free at branch time)
                ▼
  tender_dossier · tender_document · tender_notice · tender_announcement
  tender_contract_item · tender_buyer_profile · tender_document_text
```

`tender_document` holds the manifest (`document_id`, `name`, `ext`, `mime`, `size_bytes`,
`md5`, `container`, `cloud_name`) — enough to re-fetch any single file on demand and to
answer "was a technical specification published?" without ever having held the bytes.

Constraints, each a bug if forgotten:

- **Never persist a signed URL** (`X-Amz-Expires=1800`). Store `(document_id, container,
  cloud_name)`, re-mint at serve time.
- **Key document text on content (MD5), not on tender.** Announcement documents sit in a
  different container from the tender's attachments, and the same bytes can appear under
  two ids (§9.1). MD5 also lets a re-crawl skip re-extraction of unchanged files.
- **The streaming pass must be crash-safe per document, not per tender.** A 3.65 TB crawl
  will be interrupted; resume granularity is one document, and a partially-written text row
  must never be committed as complete.
- **ZIP entries do not carry the live `documentId`.** The export bundles the same *bytes*
  under *different* ids (verified: sizes matched exactly, ids did not). **Map ZIP entries to
  the manifest by MD5/size, never by the id embedded in the filename.**
- **ZIP filename encoding is mixed within a single archive** — some entries carry the UTF-8
  flag (0x800), some are raw UTF-8 without it, some are CP1251. Rule: honour the flag; else
  try UTF-8, fall back to CP1251. Never trust `unzip -O`.
- **Export ZIPs are point-in-time snapshots**, one per publication event (mean 2.5/tender).
  Documents published *later* — including every протокол — are **not** in them. Take the
  newest full export, and fetch announcement documents separately.
- **Retries are mandatory** (1.3% transient failure at concurrency 6). **A row means "the
  register answered." A null field means "it answered and had nothing." It must never mean
  "we could not reach it."** Discriminated `{ok:true,…} | {ok:false,reason,…}`; never persist
  a failure as an answer. This is the defect that silently corrupted `company_founded`, and it
  is far harder to notice at 1.36M requests.
- **`tender_document.kind` is a classification, not a fact** (filename matching hit 68% for
  "техническа спецификация"). Nullable, derived, with an `unclassified` bucket.
- **Untrusted third-party files** — ~530k files from ~2,000 organizations. Never execute;
  bound archive extraction (zip bombs, path traversal); treat extracted text as data, never
  as instructions.

## 5. Task breakdown

**T0 — recalibration spike (½ day).** Re-measure the export-ZIP size tail on the first 2,000
tenders (§2.3 caveat) and the протокол scan rate on n≥100 (§10.3). Both drive storage and OCR
budget, and both currently rest on n≈44 / n=8.

**T1 — fix the existing corpus hole first (§11).** Independent of this plan and cheap.

**T2 — JSON store + crawler.** All tender-level methods + buyer profiles, concurrency 6,
retries, `--probe` first.

**T3 — tenderId enumeration** (`enumerate_eop_ids.ts`, §9.3) — completeness audit and gap-fill;
also the permanent answer to "are we complete?"

**T4 — the streaming document pass** (`ingest_eop_text.ts`): sign → fetch → extract → store
text → discard. Resumable per document, `--kinds` gated, `--max-bytes` as a *bandwidth* knob
(§12.3), hard skip above a ceiling so one 313 MB archive cannot blow the temp dir.

**T5 — the two notice parsers** + a measured BT-coverage gate so the eForms/legacy split cannot
silently regress.

**T6 — text extraction.** `pdftotext` (verified 15/15 on documentation), `textutil` for
`.doc`/`.docx` (verified 5/5, **macOS-only** — the crawl is operator-run, but a portable path
needs LibreOffice headless). **OCR queue for the ~50% scanned протоколи** — see §10.3.

**T7 — migration 132 + loader**, stage-merge (every table is on a serving path).

**T8 — serving.** `/tenders/:unp`: description, attachment list, award-stage timeline.
Downloads via `/api/db/tender-document?id=…` minting the signed URL and **302-redirecting** to
`storage.eop.bg` — no bytes through our function.

**T9 — search.** Fold description + notice + document text into the tenders DbDataTable global
search; the search + `ORDER BY` + `LIMIT` seq-scan fence applies on a much larger column.

**T10 — reconciliation.** `GetPublishedContractListItems` annexes/`CurrentContractValue` vs
`procurement_annexes` (114); buyer-profile addresses vs `awarder_seats`.

**T11 — risk signals**: no technical specification published; documentation replaced late in
the offer phase; short offer window vs value; price-only criterion on complex works
(`BT-539-Lot`); brand named without "или еквивалент"; procedure cancelled after протокол 1.

**T12 — wiring.** `data.test.ts` gates; `db:load:tender-dossier:pg:cloud` into the
`update-procurement` watch skill **and** the CLAUDE.md cloud-loader list.

## 6. Remaining unknowns

Most of the original list is now measured (§10). What is left:

- **Export-ZIP tail** — n=44, top file = 30% of sampled bytes. Widest error bar in the plan.
- **Протокол scan rate** — n=8 (4 text / 4 scan). Drives the entire OCR decision.
- **OCR cost/quality for Bulgarian** at ~200k documents — not investigated at all.
- **Mutation rate** — how often a dossier changes during the offer phase, so the refresh-pass
  cost is a guess.
- **`TotalPublishedTendersCount` semantics** — unresolved (§11); the id-walk replaces it.
- **The 5 search methods' request shape** — unresolved, and now unnecessary.
- **Non-BG egress** — the service was exercised from one egress only.
- **Cloud SQL sizing** for extracted text.

## 7. Settled decisions

1. **Scope: ingest everything reachable.** (Capping the 100 MB+ tail is a *sequencing* choice
   inside that, not a scope reduction — §2.3.)
2. **PII: ingest, defer display.** Note this is larger than first assumed: протокол PDFs name
   evaluation-committee members and bidder representatives. Ingest is defensible (public
   register, robots-permitted); *display* and *person-layer resolution* remain undecided and
   are **not** authorized by this plan.
3. **Re-hosting: no.** Text + signed-URL redirect only.

## 8. Audit 1 log — what the first draft got wrong

| # | Gap | Impact |
|---|---|---|
| 1 | Claimed "4 methods matter"; the anonymous surface is **12**, and the denied set was never probed. | Understated the dataset |
| 2 | **Missed the award-stage trail** (90% of tenders) and that `RetrieveTenderAnnouncementDocuments` is anonymous. | Missed the highest-value dataset |
| 3 | **Missed the buyer profile** — address/NUTS/EIK keyed by an id we get free. | Missed a fix for a known defect |
| 4 | `GetPublishedContractListItems` never opened: suppliers, `CurrentContractValue`, `Annexes[]`. | Missed a reconciliation obligation |
| 5 | **Omitted per-document signed-URL calls** (~1.14M). | Off by ~11× on API time |
| 6 | Byte budget omitted announcement documents and export ZIPs. | Two holes |
| 7 | Proposed a **single SQLite store** for a multi-TB corpus. | Architecture non-viable |
| 8 | Never verified whether lot `tenderId`s carry a dossier. *(They do not — 1.2 KB stub, null `SpecialNumber`.)* | Assumption, now verified |
| 9 | Missed 248 rows with a synthetic `unp` of form `T<tenderId>` (API returns `SpecialNumber: ""`). | Would read as fetch failures |
| 10 | Missed that containers are **per-uploader**. | Blob-key bug |
| 11 | Missed document version history (`IsPreviousVersion`/`PreviousVersionId`). | Lost a risk signal |
| 12 | No malware / archive-bomb posture. | Safety gap |
| 13 | Did not establish that `GetEvaluatedOffersByTenderId` is 401. | Would have designed around a non-existent source |
| 14 | No completeness-audit mechanism. | Closed by §9.3 |

## 9. Audit 2 — bulk download routes

### 9.1 ✅ The export ZIP is a per-tender bundle — the one real bulk route

`GetPublishedTenderExportsByTenderId` → `GetSignedUrlByDocumentId` → one download yields a ZIP
containing **all the tender's attachments plus the обявление and решение PDFs plus the whole
requirements tree** (`1. Подаване на оферти\1. Изисквания\…` — ЕЕДОП, техническо предложение,
ценово предложение, методика). Verified on two tenders: 7 files where the manifest listed 5,
and 13 files where the manifest listed 3.

- **Replaces ~4.1 signed-URL calls + 4.1 downloads with 1 + 1** → removes ~394k calls.
- Costs 1.09× the bytes of the attachments alone, and adds material the manifest never exposes.
- **Snapshot semantics**: mean 2.5 exports per tender, one per publication event. Take the
  newest `IsFullExport`. Later-published протоколи are **not** included.
- **Ids inside the ZIP are not the live document ids** (bytes identical, ids differ). Map by
  MD5/size.

### 9.2 ❌ S3 bucket listing — works, but not for documents

`https://storage.eop.bg/open-data-<YYYY-MM-DD>/?list-type=2` **is publicly listable** and
returns exactly 4 objects per day (поръчки, договори, анекси, обявления-OCDS) — all four
already ingested. The document containers (`user-<id>`) and the bucket root return
`AccessDenied`. **No blob-level bulk route exists.**

### 9.3 ✅ The tenderId space is enumerable — this replaces the search API

Ids are dense in **[56505, 600641]** (544,137 ids; nothing published below the floor — ids
1000…56504 all return empty). A 400-id probe classifies cleanly:

| Class | Share | Signature |
|---|---|---|
| Unpublished / draft | 24% | empty body |
| Lot / child stub | 53% | `SpecialNumber` null, no publications |
| **Published procedure** | **22%** | `SpecialNumber` set + ≥1 publication |
| Transient error | 1% | retry |

A full walk costs ~544k calls ≈ **17 h at 9 req/s** and finds every published procedure —
no search API, no pagination, no date buckets. This is both the completeness audit and the
gap-fill mechanism, and it is how §11 was found.

### 9.4 ✅ TED — an open bulk alternative for the EU-threshold subset

`api.ted.europa.eu/v3/notices/search` answers anonymously and resolves our notices by number
(verified against `00728-2026-0018` → ND 511876-2026). **30.8% of the corpus (39,173 rows)
carries a `link_to_oj_eu`.** TED publishes authoritative eForms XML in bulk daily packages —
strictly better than parsing `HtmlPreview`, and **especially valuable for 2020–2023 where
`HtmlPreview` carries no BT codes** (§1.2). TED does not host the procurement documents, so it
complements rather than replaces this plan.

### 9.5 ❌ No anonymous bulk export endpoint

The `Download*FileContent` family and the 5 search methods were not usable anonymously with any
guessed request shape. Moot given §9.3.

## 10. Audit 2 — unknowns closed

### 10.1 Rate limits — resolved, and generous

9 req/s at concurrency 6, no throttling, latency *improved* over a 300-call run. 1.3% transient
`fetch failed` → retries mandatory. See §2.1.

### 10.2 Byte budget — resolved, and larger

Announcement documents measured over 60 tenders / 153 announcements / 192 documents:
mean 3.2 docs per tender, **mean 1,722 KB per document** → **668 GB / 407k files**. The first
draft's ~40 GB (one 137 KB sample) was **17× low**. Export ZIPs: §2.3.

### 10.3 ⚠️ Text-layer coverage — the finding that changes the plan

Two populations behave completely differently:

- **Tender documentation PDFs: 15/15 have a clean Cyrillic text layer.** No OCR needed.
- **Протоколи / доклади: 4 of 8 have no usable text.** Two returned literally 0 characters
  over 3 and 5 pages; two more returned 522 chars over 51 pages and 462 over 9 — a scanned
  document with a cover stamp. Measure by **chars per page**, not total chars, or these read
  as successes.

So the highest-value dataset (§1.3) — the only route to bid evaluation, since
`GetEvaluatedOffersByTenderId` is 401 — is **~50% scanned and needs OCR at ~200k documents**.
Their mean size (2.3 MB per PDF) is consistent with scans. n=8; T0 must re-measure at n≥100
before any OCR spend is committed.

`.doc` and `.docx` extract cleanly via macOS `textutil` (5/5, clean Cyrillic); portable
extraction still needs LibreOffice headless.

### 10.4 The completeness canary — resolved as unusable

`TotalPublishedTendersCount` compared against our corpus across 12 buyers says we are missing
**19.8%** (range 2%–38%). The direct tenderId walk (§9.3) says **3.4%**, which matches the
independently-measured 2.9% day-cache hole (§11) almost exactly. The two methods disagree by
6×, so the profile counter measures something broader (lots, child tenders, or non-procedure
records) and **must not be used as a canary**. Use the id walk.

## 11. ✅ FIXED 2026-08-03 — the existing tenders corpus had a 69-day hole

Not part of this plan; found while calibrating the canary, and cheap to fix.

The tenderId walk found published procedures absent from our corpus (e.g.
`05947-2023-0042`, `02830-2023-0020`, `00740-2023-0034` — all confirmed absent by УНП). Root
cause: **`raw_data/procurement/eop_tenders/` is missing 69 day-buckets, one contiguous run,
2023-10-24 → 2023-12-31.** 2,336 of 2,403 days cached; the gap is 2.9% of days and matches
the 3.4% missing-procedure rate.

**The source still serves those days** (spot-checked 2023-10-24 → 426 KB, 2023-11-06 →
373 KB, 2023-12-31 → 2 bytes, a genuine empty holiday). The fix is a bounded re-run:

```bash
npx tsx scripts/procurement/ingest_tenders.ts --backfill --from 2023-10-24 --to 2023-12-31 --apply
```

**Done (commit `023383cdc0`).** Actual outcome: **232,726 → 236,855 procedures (+4,129)**,
195,189 → 200,372 lots, cache now 2,405/2,405 days complete. All three named УНП verified
present. Full sequence run: `ingest_tenders --backfill --apply` → `db:load:tenders:pg` →
`refreshAppealDependents()` (`appealed_ocids` / `upheld_ocids` read `tenders`) →
`backfill_unp --apply`.

**It also exposed a latent `cais_id` bug, now fixed in the same commit.** `contracts.cais_id`
is derived from `(unp, ocid)`, but `load_pg.ts` derived it *before* its own
`resolve_contract_unp()` call and `load_tenders_pg.ts` never derived it at all — so any unp
the resolver newly fills leaves a `cais_id` computed from the null it replaced. Dormant for
as long as the resolver had nothing left to fill; the 4,129 recovered tenders let it resolve
182 contracts and `procurement_ingestion_regression` failed on exactly those 182. Both
loaders now re-derive after the resolver.

**Still worth doing (not done):** a guard in `ingest_tenders` that fails loudly on a
contiguous missing-day run rather than silently rebuilding from a holed cache. That absence
is why this went unnoticed for ~2.5 years, and why the *next* hole would too.

## 12. ⚠️ Storage constraint — the blob tier does not exist (2026-08-03)

### 12.1 The measurement

`/System/Volumes/Data`: **460 GB, 94% full, 25 GB free.** `raw_data/` is already 28 GB.
The plan's blob corpus is **3.65 TB** (2,981 GB export ZIPs + 668 GB announcement documents).

**Capping does not rescue it.** Announcement documents alone, per-file cap:

| skip files > | files kept | bytes kept | corpus |
|---|---|---|---|
| 1 MB | 72% | 12% | **81 GB** |
| 2 MB | 82% | 21% | 139 GB |
| 5 MB | 90% | 37% | 248 GB |
| 10 MB | 96% | 63% | 419 GB |

The gentlest useful cap is still 3× the free disk, for one of the two document tiers. There
is no cap that both fits and retains a usable corpus. **The byte-retention design is dead,
not shrinkable.**

### 12.2 What replaces it — stream, extract, discard

Documents are fetched, text-extracted, and deleted. Only text + manifest metadata persists.

Measured per document (`pdftotext` / `textutil`, gzipped):

| Tier | Docs | Mean text.gz | Corpus |
|---|---|---|---|
| Tender documentation | ~521,000 | 5.1 KB | **2.5 GB** |
| Announcement documents | ~407,000 | 1.4 KB | **0.55 GB** |
| **Total extracted text** | ~928,000 | | **≈3.1 GB** |

Plus the ~5 GB of gzipped details JSON = **≈8 GB**, which fits in 25 GB with room to work.

⚠️ **An earlier revision of this section said ~24 GB. That was wrong** — it extrapolated a
text/source *byte ratio* (0.67%) measured on small text-bearing files across a corpus whose
bytes are dominated by CAD, scans and archives that yield almost no text. The per-document
figures above are the defensible method; the ratio method over-counts by ~8×.

Peak disk during the crawl is `concurrency × largest in-flight file`, not the corpus — a few
GB with a hard skip ceiling.

### 12.3 What this costs, honestly

- **Bandwidth is now the binding constraint, and it did not shrink.** All 3.65 TB still has
  to cross the wire to be extracted; only retention changed. At a sustained 100 Mbit that is
  **~3.4 days** of continuous transfer, ~17 h at 500 Mbit. `--max-bytes` survives purely as
  a knob on *this* — skipping the 100 MB+ construction tail cuts days off the crawl for
  almost no text.
- **Re-extraction means re-crawling.** With no bytes on disk, any later improvement to the
  extractor (a better PDF backend, OCR, table parsing) costs another full pass. This is the
  real price of the design, and it is why §12.4 matters.
- **Per-document re-fetch stays cheap.** The manifest keeps `(document_id, container,
  cloud_name, md5)`, so any *individual* file is one `GetSignedUrlByDocumentId` away. It is
  only the *bulk* re-read that is expensive.

### 12.4 The OCR decision — now forced, and it was optional before

**~50% of протоколи are scans with no text layer** (§10.3, n=8). While bytes were being kept,
OCR could be deferred and run later off local files. It cannot be now: a scanned document
that is streamed, yields no text, and is discarded is **permanently absent until a re-crawl**.

Three options, in preference order:

1. **OCR inline during the streaming pass.** One crawl, complete corpus. Costs CPU/time on
   ~200k scanned PDFs (unmeasured — §6) and slows the pass, but never needs repeating.
2. **Retain scan bytes only, to GCS** (not local disk) and OCR later. The scanned subset is
   the *large* half, so expect a few hundred GB at ~$4–20/TB/month depending on storage
   class, plus egress to read it back.
3. **Skip OCR, accept the loss.** Text-bearing протоколи (~50%) are still captured; the
   scanned half yields a manifest row and no content, and the `/tenders/:unp` page links out
   to the register for those. Cheapest, and reversible only by re-crawling.

**Recommendation: (1) for announcement documents** — they are the accountability payload and
the only public route to bid evaluation (§1.1) — **and (3) for tender documentation**, where
the text-layer rate is 15/15 and OCR would be near-pure waste.

### 12.5 Decision needed

- **OCR strategy** (§12.4) — this is the one that cannot be deferred, because the streaming
  design makes it irreversible.
- **Whether to keep any bytes at all, on GCS.** Default is no.
- **`--max-bytes` for the first pass** — a bandwidth/time choice, not a storage one, and
  freely revisable later since it only changes which files get re-fetched.
