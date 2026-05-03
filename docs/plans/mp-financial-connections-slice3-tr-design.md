# Slice 3 design — Commerce Registry (TR) state reconstruction

_Outcome of the Slice 3 investigation. The user chose Option C (full TR index from data.egov.bg). This document captures the schema findings and the engineering plan; subsequent commits implement the phases below._

## Problem

Slice 0 established that MP property/interest declarations cover only **passive ownership**. Active management roles (managers, board members, procurators) appear nowhere in declarations because ЗПК Art. 35 forbids sitting MPs from holding them. To surface those roles — and to enable any reverse lookup like "all companies where person X had a role" — we need the Commerce Registry's officer data.

## Why this is multi-session work

- **No public officer-by-name API.** `portal.registryagency.bg` is a JS-rendered SPA with no documented public endpoints. `data.egov.bg`'s CKAN-style API only exposes resource metadata, not search.
- **The free open-data dump is event-sourced, not a snapshot.** Each daily resource is ~8 MB of *filings made that day* — Add/Erase change events keyed by (UIC, FieldIdent, GroupID). To produce a "current state" for any company we have to replay all daily files in chronological order.
- **Volume.** ~1,600 daily files × ~8 MB ≈ 12 GB of source data. Bulk download is hours of bandwidth; full replay is hours of CPU.
- **EGN policy: never extracted, never persisted, never displayed.** The TR dump's `Indent` element is a `hash+salt` of the EGN with the salt undisclosed. EGN is sensitive personal data under Bulgarian PDPA, and a hash derived from it is treated identically. The pipeline does **not** read this element from the source XML/JSON, does not write it to the SQLite, and does not surface it in any `/public/` output. **All person-level joins go through the plain-text `Name` element**, which is collision-prone for common Bulgarian names — we model that uncertainty explicitly via the confidence field.

## Source data shape

Endpoint:

```
https://data.egov.bg/resource/download/{resourceId}/json
```

Each daily file is structured as:

```json
{ "Message": [{
  "Header": [{ "MessageDetails": [{ "CreateDate": [{"_": "2026-04-30T..."}] }] }],
  "Body":   [{ "Deeds":   [{ "Deed": [
    { "$": { "DeedStatus": "N|C|L|E", "CompanyName": "...", "GUID": "...",
             "UIC": "204556605", "LegalForm": "EOOD" },
      "SubDeed": [
        { "$": { "SubUIC": "0015", "SubUICType": "MainCircumstances", "SubDeedStatus": "A" },
          "Partners": [...], "BoardOfDirectors": [...], "Managers": [...], ...
        },
        { "$": { "SubUICType": "B7_ActualOwner", ... }, "ActualOwners": [...] }
      ] } ] } ] } ] }
```

### SubUICType inventory (one daily file, n=2,406 SubDeeds)

| SubUICType | Count | Meaning |
|---|---:|---|
| G1_ActAnnouncement | 1,526 | Filings announcing acts (annual reports, etc.). Mostly noise for our purpose — meta about *what was filed*, not officer state. |
| MainCircumstances | 784 | The big one — owners, managers, board, capital, seat, name. |
| B5_Distraint_DD | 42 | Distraints/seizures. |
| B6_Liquidation | 19 | Liquidator + terms of liquidation. |
| B7_ActualOwner | 15 | Beneficial owners (UBO declarations). |
| Bankruptcy | 7 | Bankruptcy events. |
| B1_Procura | 5 | Procurators (proxies). |
| V1_Transfer / V2_Conversion | 2 / 2 | Enterprise transfers/conversions. |
| B2_Branch | 1 | Branch + branch managers. |
| B3_Pledge_DD / B4_Pledge_TP | 2 / 1 | Pledges over shares/assets. |

### FieldIdent catalog (118 distinct, full table reproduced from sample)

For our use case, the load-bearing fields:

**Officers (active control):**
- `00070 Managers` — OOD/EOOD/AD managers (most common)
- `00100 Representatives` (+ `00101..00103` variants)
- `00110 WayOfRepresentation`
- `00120 BoardOfDirectors`
- `00130 BoardOfManagers`
- `00150 ControllingBoard`
- `00410 Procurators` (B1_Procura SubDeed)
- `00530 BranchManagers` (B2_Branch SubDeed)
- `05020 Liquidators` (B6_Liquidation SubDeed)

**Owners (passive equity):**
- `00190 Partners` — OOD/EOOD partners with shares
- `00230 SoleCapitalOwner` — single owner of EOOD
- `00220 ForeignTraders`
- `05500 ActualOwners` — beneficial owners (B7_ActualOwner)

**Company state:**
- `00010 UIC` (EIK)
- `00020 Company` (name)
- `00030 LegalForm`
- `00050 Seat`
- `00310 Funds` / `00320 DepositedFunds`
- `00260 CessationOfTrade`, `00270 AddemptionOfTrader`

**Each field carries:**

```json
{ "$": {
    "FieldOperation": "Add" | "Erase",
    "FieldIdent": "00190",
    "RecordIncomingNumber": "20260423203328",
    "FieldEntryNumber": "20260429073718",
    "FieldActionDate": "2026-04-29T07:37:18",
    "FieldEntryDate": "2026-04-29T07:37:18",
    "RecordID": "203485645",
    "GroupID": "49425345"
  } }
```

### Person record shape (Partners, Managers, BoardOfDirectors, …)

```json
"Subject": [{
  "$": { "Position": "", "LegalForm": "", "CountryCode": "", "IsForeignTraderText": "0" },
  "Indent": [{ "_": "236b5c760fd9...c0c" }],   /* hashed EGN — NOT the EGN itself */
  "Name":   [{ "_": "ИВАН АНГЕЛОВ АНГЕЛОВ" }], /* plain text — used for joins */
  "IndentType": [{ "_": "EGN" }],
  "CountryID": [{ "_": "1" }],
  "CountryName": [{ "_": "БЪЛГАРИЯ" }]
}]
```

`Indent` is the hash. `Name` is plain Cyrillic. **All MP↔company joins must be by normalized name.**

## Engineering plan

### Phase 1 — schema discovery ✓
- Confirmed schema; documented above. Field catalog stable across the sample.
- Identified Add/Erase as the only mutation operations.
- Confirmed EGNs are hashed; names are plain.

### Phase 2 — parser (in this slice)

Build [scripts/declarations/tr/](../../scripts/declarations/tr/):

```
tr/
  parse_daily_filing.ts      # one daily JSON → typed ChangeEvent[]
  state_replay.ts            # ChangeEvent[] → CompanyState{} (in-memory)
  types.ts                   # TR types
```

`ChangeEvent` shape:

```ts
type ChangeEvent =
  | { kind: "person_added";     uic: string; companyName: string;
      role: "manager" | "representative" | "director" | "board_of_managers"
            | "controlling_board" | "procurator" | "liquidator"
            | "partner" | "sole_owner" | "actual_owner" | "branch_manager";
      personName: string; personHash: string;
      sharePercent?: number; positionLabel?: string;
      filingDate: string; recordId: string; groupId: string;
      fieldIdent: string }
  | { kind: "person_erased";    uic: string; recordId: string; fieldIdent: string }
  | { kind: "company_meta";     uic: string; field: "name" | "legal_form" | "seat" | "funds" | "status";
      value: string; filingDate: string; recordId: string; }
  | { kind: "company_meta_erased"; ... }
```

State replay is straightforward: keep a `Map<uic, CompanyState>` where `CompanyState` has sets of currently-active `recordId`s grouped by role. An Erase event removes a record by `recordId`. The latest unerased Adds are the current state.

### Phase 3 — bulk download

**Discovery during implementation:** `data.egov.bg` exposes an undocumented but functional **bulk-zip endpoint** for any dataset. Hitting

```
GET /dataset/{datasetId}/resources/download/json
```

returns `{ uri, format, delete_only_zip }` and the actual archive is then streamed from

```
GET /dataset/resources/download/zip/{format}/{uri}/{delete_only_zip}
```

For the TR dataset that's a single ~540 MB download containing every daily JSON ever published. This collapses the original "~1,600 polite per-day fetches over hours" plan to one streaming download.

**Implemented modules** in [scripts/declarations/tr/](../../scripts/declarations/tr/):

- `fetch_bulk_zip.ts` — streaming download to `raw_data/tr/all-resources.zip` with `Range: bytes=N-` resume, progress reporting every ~10 MB, and a final size-vs-Content-Length check. **Primary path for the initial snapshot.**
- `fetch_dataset_index.ts` — paginated HTML scrape of `?rpage=1..N` to enumerate per-day resource UUIDs (~1,680 entries, dated). Cached to `raw_data/tr/dataset-index.json`. Used after the bulk snapshot to detect newly-published days.
- `fetch_daily.ts` — single-resource downloader (`/resource/download/{uuid}/json` → `raw_data/tr/daily/yyyy-mm-dd.json`), with skip-if-exists and 1 req/sec rate limit. Path for **incremental updates** after the bulk snapshot.
- `cli.ts` — thin runner for the three modules so the long-running fetches can be backgrounded outside of `scripts/main.ts`.

`raw_data/tr/` is gitignored.

### Phase 4 — full state reconstruction

Stream every daily file in chronological order through `state_replay.ts`, then persist the resulting `Map<uic, TrCompanyState>` to SQLite via Node 22's built-in `node:sqlite`. Schema matches the design above (companies + company_persons + name_norm/uic indexes).

**Implemented modules:**

- `sqlite_writer.ts` — opens `raw_data/tr/state.sqlite`, applies the schema, writes companies + person rows in one transaction, plus a `meta` table (`generated_at`, `source_label`, counts) for traceability.
- `reconstruct_state.ts` — auto-selects source: zip mode streams entries directly out of `all-resources.json.zip` via `unzipper.Open.file()` (no extraction); folder mode falls back to `daily/*.json`. Sorts entries by ISO date parsed from filename, parses + replays each, accumulates state in memory, writes SQLite.
- `state_replay.ts` updated: erase events stamp `erasedAt` instead of deleting records, so historical "ever held this role" reverse lookups work. New `currentPersons(c)` helper filters to `erasedAt === null`.
- `cli.ts --reconstruct` — runner for the above. `--limit N` caps day count for smoke tests.

**Gotchas worth recording:**

- Memory: state is held in-memory during the full replay (active + erased records). For Bulgaria's ~1.5 M-company history, expect 1–2 GB peak. Run with `node --max-old-space-size=4096` if needed.
- `node:sqlite` is "experimental" in Node 22 (warning on stderr) but stable for our single-writer batch import. We open the DB, run one big WAL transaction, checkpoint, close.
- The bulk-zip's internal entry naming uses `yyyy-mm-dd` somewhere in each filename — the reconstructor's `ISO_DATE_FROM_FILENAME` regex picks it up regardless of prefix/suffix.

`name_norm` = uppercase + collapsed-whitespace + trim (same normalization as Phase 0/1 declarations matching). Reverse lookup "all companies for person X" is a single indexed query against `idx_persons_name_norm`.

SQLite is gitignored too; it's regenerated from the source dumps. The pipeline only writes the small **derived** outputs to `public/` (Phase 5).

### Phase 5 — integration

Implemented as `scripts/declarations/tr/integrate.ts`, called automatically at the tail of `parseFinancialDeclarations` whenever `raw_data/tr/state.sqlite` exists (and silently no-op'd otherwise — `npm run prod` works without TR).

**Design change from the original spec.** The original called for per-company `public/parliament/companies/{slug}.json` files. The frontend currently fetches a single `companies-index.json` keyed by slug, so we **augment that file in place** with an optional `tr` field per entry instead of fanning out to per-slug files. Less I/O, no new fetch path, same data. (If/when the slug-per-file shape becomes useful — e.g. for code-splitting per company — the augmented index can be split mechanically.)

**Per-MP management roles.** Per the original design: written to `public/parliament/mp-management/{mpId}.json`. Files are only emitted when an MP's normalized name matches ≥1 row in `company_persons` (avoids hundreds of empty files in git).

**Confidence model** (codified in `MpManagementRole.confidence`):

| Confidence | Rule |
|---|---|
| **high**   | Full normalized-name match AND (TR seat contains MP's `currentRegion` OR another MP from the same `currentPartyGroup` has already declared a stake in this UIC). |
| **medium** | Full normalized-name match only. |
| **low**    | (Surname-only.) **Suppressed entirely** — Bulgarian common-name collisions (Иван Иванов, Мария Петрова) are too noisy to surface, even with a "?" badge. Better to silently miss than to lie with confidence. |

**Match key** for the company-enrichment side: `uppercase(strip-quotes(strip-whitespace(name + ' ' + legal_form)))`. The same fingerprint is computed against the declaration's `displayName`, so the join is a string equality lookup in a `Map<fingerprint, CompanyRow>`.

**Smoke coverage** (in `tr/smoke_test.ts`): reuses the Phase 4 SQLite, copies the real `index.json` + `companies-index.json` into a temp public dir so we don't mutate committed files, runs `integrateTr`, then verifies the augmented index still parses, that every `tr` field carries a UIC, that the mp-management directory was created, and that all emitted roles have `confidence ∈ {high, medium}`.

### Phase 6 — UI

Company page extends with:
- EIK + status badge ("активно", "в ликвидация", "заличено")
- Two new tables: current officers (with MP-flag highlighting) and current owners
- A "Why this company shows here" tooltip linking to either the MP's declaration source or the TR record

MP candidate dashboard adds a sibling to the existing "Бизнес интереси" tile: "Управленски роли" (management roles) — sourced from TR. Confidence-low matches show with a "?" badge and a "verify on TR" link.

`/connections` (Slice 4) becomes the headline once both tiles exist.

## Risks tracked

| Risk | Mitigation |
|---|---|
| Bulk-zip download interrupted mid-stream | HTTP `Range: bytes=N-` resume from the byte offset already on disk |
| Bulk-zip endpoint disappears or changes | per-day fallback (`fetch_dataset_index.ts` + `fetch_daily.ts`) is fully implemented and can drive a complete fresh snapshot |
| Source schema changes mid-history | parser tags each ChangeEvent with `schemaSeenAt`; unparseable events go to a quarantine file with the source path for inspection |
| Common-name collisions (Иван Иванов) | confidence model + UI signaling; never silently link |
| Name reordering ("Петров, Иван" vs "Иван Петров") | parser stores sorted-token form alongside literal name |
| Bulk SQLite size | manageable — at most O(companies × roles), comparable in size to the source dump after compression |
| Source dataset disappears | one-time bulk download is the snapshot; future updates are deltas |

## What lands in this commit (Slice 3 partial)

- This document.
- The parser module (Phase 2).
- A unit test of the parser against the sample we already have on disk.
- **Not** the bulk download or the SQLite. Those need their own session.

## What requires a separate session

- Bulk download (~6–12 hours of polite scraping)
- Full state reconstruction (depends on download)
- Integration + UI updates (small once SQLite exists)
