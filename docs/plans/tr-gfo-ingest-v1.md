# ГФО ingest — from "a bakeoff we ran once" to a watched, resumable pipeline (v1)

Status: **plan, nothing built.** Written 2026-11-23.

Companion to [gfo-ocr-engine-v1.md](gfo-ocr-engine-v1.md), which settles the ENGINE
(Gemini Flash, capture-everything prompt, validation, fetch rate, storage location,
first tier). This plan does not repeat it. It covers what that plan does not: **why we hold
no ГФО data today, how ГФО gets discovered from now on, and how it joins the
watcher → skill → Postgres → cloud loop that every other dataset here uses.**

Trigger: a user question about one entity (Фондация „ИНСАЙТ изследвания и образование",
ЕИК 207211849). Its 2023 ГФО was announced in the TR feed and is fetchable, but the only way
to read it was to download the scan by hand and read it page by page. Nothing in the repo
indexes it, stores it or serves it.

---

## 1. Why we have no ГФО data — five causes, measured

### 1.1 The TR ingest drops the announcement section entirely

Every TR daily file carries, per deed, a `StatementsB` block of announced acts
(`ActModeValue`, `ActModeText`, `ActYear`, `ActDate`, `ActID`, `ActWithErasedPersonalData`).
`scripts/declarations/tr/parse_daily_filing.ts` walks `SubDeed` sections by ALLOWLIST
(persons, company metadata) and has no arm for it, so nothing reaches `state.sqlite`, the
`tr_*` tables or any page. The index is free — the feed already sits on disk — and we throw it
away on every `tr:daily-refresh`.

Measured on `2026-10-09.json` alone: **14,622 distinct ГФО ActIDs** (mode 2), by legal form
EOOD 10,395 · OOD 3,785 · AD 328 · EAD 71 · K 22 · ASSOC 21. The feed re-lists a deed's whole
act history whenever the company appears, so most of these are old years (FY2025: 542).

### 1.2 ⚠️ The feed STOPPED carrying announcements on 2026-10-12

This is new and it changes the design. Counting `"ActModeValue":"2"` per daily file:

| window                    | ГФО acts per file      | `StatementsB` nodes | file size  |
| ------------------------- | ---------------------- | ------------------- | ---------- |
| 2024-08 → 2026-10-10      | ~5,000 – 32,000        | ~2,000              | 8–16 MB    |
| 2026-10-11                | 956 (transition)       |                     | 0.5 MB     |
| **2026-10-12 → 2026-11-21** | **0 – 43** (35 files) | **0**               | **~5 MB**  |

Every other act mode survives (mode 36 „Актуален дружествен договор" went UP, 1,500 → 2,100
per file). Only the `StatementsB` container — ГФО (2), доклад за дейността (60) and the
чл. 38 ал. 9 т. 2 declaration (61) — is gone. The stray 0–43 come from act types filed
outside that container.

**Probed 2026-11-23 — the cause is upstream and it has a legal trigger.** Findings:

- **Not our fetcher.** Re-downloaded 2026-10-09 and 2026-10-13 today with full TLS
  verification (`ssl_verify_result=0`, not the egov bypass): both are byte-identical to our
  files. The pre-cutover one still carries 2,150 `StatementsB` nodes, so nothing was stripped
  retroactively.
- **Not the JSON conversion.** The resources are XML uploads (`file_format: XML`, same
  uploader id 2021 before and after). The native XML of 10-13 has 0 ГФО acts too.
- **Exactly three containers vanished**: `StatementsB` (ГФО, mode 2), `StatementsBH`
  (доклад за дейността, 60), `StatementsBI` (чл. 38 декларация, 61). The announcement wrapper
  `G1_ActAnnouncement` stays (3,771 → 2,120 per file), with `StatementsAJ` (устав) and the
  ЮЛНЦ containers unchanged.
- **The legal trigger.** ДВ бр. 92 of 06.10.2026 amended the ЗТРРЮЛНЦ so ГФО and the
  no-activity declarations are processed in a **separate stream** („в самостоятелен поток,
  паралелно с останалите заявления"), outside the чл. 19 ал. 6–7 queue. The Registry Agency's
  executive director certified the technical readiness by **order of 12.10.2026** — the first
  empty feed day. The press (lex.bg 15.10.2026, teo-bg.com 14.10.2026) mentions 30 extra
  registration officers hired to clear the accumulated ГФО backlog; none mentions a new
  publication channel or open-data export.
- **The register itself shows no ГФО announced after 12.10.2026 in what we sampled.**
  45 fresh CR Deeds captures (20 companies from the 2026-11-19 feed, 25 companies that filed
  FY2024 late in Nov 2025) plus 105 earlier November captures: newest ГФО announcement
  05.10 / 08.10 / 09.10.2026, none later. Last year the same window was busy — 5,388 new
  prior-year ГФО first appeared in Oct 2025 and 4,489 in Nov 2025. So either the new stream
  has not announced anything yet, or it announces somewhere our captures do not reach. Which
  one is still open (§6).
- **No replacement dataset.** The Registry Agency (org 4) publishes six datasets on
  data.egov.bg; none is ГФО-specific.

Older zero-days (2024-12-28, 2025-09-08, 2026-01-23 → 02-24) were outages that recovered.
This one is structural, so plan as if the feed will not carry ГФО again.

Consequences:

- The archive `raw_data/tr/daily` up to **2026-10-11** is the last feed-based ГФО index we
  will have unless the section returns. It must be extracted and kept (§3.1).
- **Late FY2025 filings and all of FY2026** (statutory deadline 30 Sep 2027) are invisible
  to the feed. gfo-ocr-engine-v1 §11d's "build the target list from the archive" still works
  for the past; it cannot keep the list current.
- Nothing alerted on it. The `egov_commerce` watcher fingerprints the resource LIST (10 newest
  resource uuids), not content, so a 2/3 shrink of every file is invisible to it.

### 1.3 The documents are scans

0 of 16 bakeoff ГФО carried a usable text layer (gfo-ocr-engine-v1 §1.1); the INSAIT 2023
statement is the same (pdftotext returns 20 bytes). So every figure costs an OCR call —
$155–$300 for the top-1,000 contractor tier. That cost is why nothing runs automatically.

### 1.4 The only working path is a single-sector, opt-in script

`scripts/nzok/write_hospital_revenue.ts` (behind `pnpm run data:nzok -- --revenue`) fetches
and OCRs ГФО for private hospitals only, writes one JSON file, and `update-nzok` calls it a
periodic manual refresh. There is no general fetcher, no store, no table and no watcher
mapping: `process-watch-report` maps `egov_commerce` to `tr-daily-refresh` and
`update-persons`, never to anything financial.

### 1.5 The general plan stopped at design

gfo-ocr-engine-v1 has a bakeoff, measured fetch limits (concurrency 3, `DocumentLimit` 302),
a storage decision (`/Volumes/Storage/gfo/`) and a first tier — and its §13 next steps are all
still open. Its §11f lists the repo checklist (migration, loader, `:cloud`, REFRESH_EXCLUSIONS,
vacuum, two changelogs, data test) and none of it exists.

### 1.6 NGOs are a thin slice of the feed

ASSOC is 21 of 14,622 ГФО acts in the sampled day, foundations 0. ЮЛНЦ in public benefit file
with the ЦРЮЛНЦ / TR too, but at far lower volume than companies, and the INSAIT foundation's
FY2024 and FY2025 statements have not appeared in the feed through 2026-11-21 (possibly late,
possibly lost to §1.2). Coverage for NGOs must be measured per entity, never assumed from the
company rate.

---

## 2. What "done" looks like

1. Every announced ГФО-family act we can see is indexed in Postgres — company, year, mode,
   ActID or document token, announcement date — refreshed automatically, including after
   §1.2's cutover.
2. A watcher reports both **new announcements** and **the feed losing them** (a schema canary).
3. A resumable fetch+OCR capture runs **per tier, human-gated on cost**, never silently.
4. Extracted figures land in `gfo_*` tables on local AND Cloud SQL, with provenance per row.
5. `/company/:eik` (and `/awarder`, NGO pages) shows a "Финансови отчети" list (always) and
   the extracted figures (when captured), with the basis stated.

---

## 3. Design

### 3.1 Phase 0 — the free index (no network, no OCR)

> **As built (2026-11-23).** Two deviations from the sketch below, both deliberate:
> (1) it is a standalone loader, `scripts/db/load_tr_announced_acts_pg.ts`
> (`db:load:tr-announced-acts:pg[:cloud]`, the last link of `tr:daily-refresh`), not an arm
> of `parse_daily_filing.ts` → `state.sqlite` — the replay reconstructs company STATE and
> has no use for a document list, and keeping it out of `db:load:tr:pg` keeps that loader's
> TRUNCATE window unchanged; (2) there is no `--backfill` flag — the loader is incremental
> per (day, file size) through `tr_announced_act_feed_file`, so the first run IS the
> backfill and every later run scans only new files (`--force` rescans). It also folds in
> the CR-capture half of §3.2 (ActID decoded from the `DocumentAccess` token), since that
> needs no network either. Extractors: `scripts/declarations/tr/announced_acts.ts`.
> Migration 205. Gate: `scripts/db/tests/tr_announced_act.data.test.ts`.

**Parse `StatementsB` in the TR replay.** Add an arm to `parse_daily_filing.ts` that emits
one row per act: `act_id, uic, act_mode, act_mode_text, act_year, act_date,
erased_personal_data, first_seen_file`. Key on `act_id` (it is re-listed on every
reappearance; the first file wins `first_seen_file`, which is our only publication-date proxy
for acts whose `ActDate` is blank — measured blank on most re-listed acts).

- Keep ALL modes in the table, not only 2/60/61: the other announced acts (устав, покани,
  преобразуване) are useful on the company page and cost nothing extra.
- Write to `state.sqlite` → new migration `tr_announced_act` → loaded by `db:load:tr:pg`
  (stage-merge, upsert-only — §1.2 means the archive is irreplaceable, so the loader must
  never anti-join delete; same rule as `open_calls` and `council_resolution`).
- One-off backfill over the full archive (1,766 files, 15 GB) behind `--backfill`, per the
  repo's convention for one-off backfills; the daily refresh then parses only new files.
- `vacuumAfterReload` + `RELOADED` entry; `recent_updates` changelog row for new ГФО
  announcements (summary mode — a backfill is ~300k rows, cf. the nzok changelog trap).
- Gate `tr_announced_act.data.test.ts`: non-empty, ActID unique, mode-2 share plausible, every
  `uic` joins `tr_companies` (≥99%), and **a mutation check that the archive is not shrinking
  across loads**.

This alone answers "has this company filed a ГФО for year X, and where is it" for every
company that appeared in the feed between 2021-01-01 and 2026-10-11, at zero cost.

### 3.2 Phase 1 — discovery after the cutover

Two candidate sources, to be probed before either is built:

1. **The CR portal deed body we already capture.** `raw_data/tr/cr_deeds.sqlite` bodies carry
   a `CR_GL_ANNOUNCED_ACTS_L` group with `CR_F_1001_L` entries — label, year, „Дата на
   обявяване" and a link `DocumentAccess/<token>`. Verified on one capture (the hospital at
   ЕИК 000022044, ГФО 2007 → 2010+). Gaps to settle:
   - ✅ **Settled 2026-11-23: the ActID is IN the token.** `DocumentAccess/<token>` is
     base64url of `<UIC>&e&<32-hex ActID><8-byte signature>`; decoded on ЕИК 148032090 it
     yields exactly the ActIDs the daily feed lists for that company (`2d0ad773…`,
     `fac7f2a8…`, …). And `/CR/api/Documents/fac7f2a8…` still returns 200
     `application/pdf` (`%PDF-`, 1.3 MB) by plain curl. So the CR body is a complete
     replacement index: ActID, label, year and „Дата на обявяване" (which the feed mostly
     leaves blank), fetched through the endpoint the engine plan already measured.
   - Cost: one deed fetch per company per refresh. Fine for a tier (1,000–5,000 EIKs, plus
     named NGOs), not for the 1M-company register.
   Add a projection `project_cr_announced_acts.ts` beside `project_cr_deeds.ts` that reads the
   existing captures offline into `tr_announced_act` with `source = 'cr'`.
2. **Whether the Registry Agency moved announcements into a separate data.egov.bg dataset.**
   Search the organisation's dataset list for an "обявени актове" resource before assuming
   the section is gone for good. If it exists, it replaces source 1 for the whole register.

Until one of these is in place, the honest state is: FY2025 late filers and FY2026 are
unindexed, and the page says „последно обновено до 11.10.2026".

### 3.3 Phase 2 — the watcher

Extend `scripts/watch/sources/egov_commerce.ts` rather than adding a second TR watcher (the
skill mapping stays one row):

- **Content canary.** Alongside the resource-list fingerprint, sample the newest daily
  resource and record `statementsB_nodes` and `gfo_acts`. Report `status: "degraded"` with a
  specific reason when `StatementsB` has been absent for ≥3 consecutive resources. That
  reason would have fired on 2026-10-14.
- **New-announcement signal.** A separate source `tr_gfo_announcements` whose fingerprint is
  (count of mode-2 acts announced in the last 30 days for the tracked tier). It flips when a
  tracked company files, not every day.
- Mapping in `process-watch-report`: `tr_gfo_announcements` → new skill `update-gfo`, marked
  **PERIODIC / human-gated** in the same way `egov_commerce → update-nzok --revenue` is today.
  The watcher reports and queues; it never spends OCR money on its own.

### 3.4 Phase 3 — capture store and fetch (from gfo-ocr-engine-v1, unchanged)

`/Volumes/Storage/gfo/{gfo.sqlite, pdf/<id>.pdf}`; verify the mount, never the path;
document-level unit of work; four states (captured / not-yet / retryable incl. the
`DocumentLimit` 302 / terminal); concurrency 3; `%PDF` + OLE2 sniffing; tier stored on the
target. See engine plan §11c. Fetch with plain `curl` (node fetch is WAF-refused on this host,
see the GFO reference memory); BG egress is not required.

**Targets come from `tr_announced_act`, never from a second list.** Tier membership is a
`gfo_target` column: `top1000_contractors`, `top5000_contractors`, `sector:<id>` (hospitals
fold in here, retiring the bespoke list in `write_hospital_revenue.ts`), `ngo_named` (named
entities such as 207211849), `user_request`.

### 3.5 Phase 4 — OCR and validation (from gfo-ocr-engine-v1, unchanged)

Gemini via `GEMINI_FLASH`, capture-everything prompt, per-document `model` and
`prompt_version`, cross-field arithmetic checks into `gfo_check`, unit-scale resolution with a
refusal path, hand-check 100 per tier and publish the error rate. Commit the prompt and the
identity checks with the 16-document bakeoff sample as their fixture (engine §11f.1).

**NGO statements need their own schema arm.** The INSAIT 2023 statement is a НПО
Отчет за приходите и разходите (условно / безусловно финансиране, дарения направени,
отсрочено финансиране) — not the ОПР codes 15100 / 18000 the company prompt anchors on.
Add an `entity_kind` axis (`company | ngo`) and an NGO block, and validate it on the INSAIT
document before any NGO tier runs.

### 3.6 Phase 5 — Postgres, cloud, surfaces

Per engine §11f: migration (`gfo_document`, `gfo_line`, `gfo_check`, `gfo_financial` as the
served one-row-per-(eik, year, basis) view), `db:load:gfo:pg` + `:cloud` twin,
`REFRESH_EXCLUSIONS` entry („input is a gitignored, hand-run, rate-limited crawl on an
external drive"), vacuum, both changelogs, `gfo.data.test.ts` with a mutation check.

Surfaces, in order:

1. `/company/:eik` — „Обявени финансови отчети" list from `tr_announced_act` (Phase 0 makes
   this possible before any OCR), each linking to the register document.
2. The same tile with extracted revenue / profit / assets / equity where captured, stating
   year, basis and the OCR provenance.
3. NGO pages (`/company/:eik` for ЮЛНЦ) — income split conditional / unconditional, donations
   made.
4. Only then the procurement capacity ratios (engine §11e decisions first).

### 3.7 The skill — `update-gfo`

Steps: (1) `tr:daily-refresh` already ran → index is current; (2) re-project CR captures for
the tier (Phase 1); (3) build/extend `gfo_target`; (4) **print the cost estimate and stop**
unless `--confirm-budget <usd>` is given; (5) fetch; (6) OCR; (7) validate + report refusals;
(8) `db:load:gfo:pg`; (9) emit `db:load:gfo:pg:cloud` into `state/upload/pending.json` for
`upload-watch-changes`. Season: run monthly Jul–Nov (the filing season is Jun–Sep with a
late tail), ad hoc otherwise.

---

## 4. Order of work

| step | what | cost | unblocks |
| ---- | ---- | ---- | -------- |
| 1 | Phase 0 parser arm + `tr_announced_act` + archive backfill + gate | hours, free | the filings list on every company page |
| 2 | Watcher content canary on `egov_commerce` | small | never miss a feed cutover again |
| 3 | Probe §3.2 sources (DocumentAccess equivalence, data.egov.bg dataset search) | ~1 h | post-cutover discovery |
| 4 | `project_cr_announced_acts.ts` (or the new dataset) | small | current index for the tier |
| 5 | Filings-list tile on `/company/:eik` (+ `deploy:db` before `deploy`) | small | user-visible value with no OCR |
| 6 | Capture store + fetcher on `/Volumes/Storage/gfo` | medium | any extraction |
| 7 | NGO prompt arm, validated on INSAIT 2023 | small | NGO tier |
| 8 | Tier 1 (top-1,000 contractors, ~9,600 docs, $155–$300) — needs operator budget OK | ~9 h | engine §12 opens #3–#7, #14 |
| 9 | PG + cloud + figures tile | medium | the financial capacity view |
| 10 | Fold the hospital pipeline into the general one | small | one ГФО path in the repo |

Steps 1, 2 and 5 are cheap and land value on their own; nothing after step 5 should start
without the operator agreeing a tier and a budget.

---

## 5. Things that must not happen

- **Do not treat "no row in `tr_announced_act`" as "did not file".** For any filing after
  2026-10-11 it currently means "we cannot see it". The surface must say which.
- **Do not anti-join delete the index.** The pre-cutover archive is the only copy.
- **Do not store the capture under `raw_data/`** (boot volume, engine §11c.1).
- **Do not spend OCR money from a watcher run.** Cost is a human decision every tier.
- **Do not reuse the company ОПР prompt for NGOs** — it will return nulls or, worse, map
  „приходи от условно финансиране" onto net sales.

---

## 6. Open questions

1. ~~Upstream or ours?~~ **Upstream — §1.2.** Remaining half: has the new separate stream
   announced ANY ГФО since 12.10.2026? Cheapest test is to repeat the 25-late-filer CR probe
   monthly (two minutes at the crawler's 5 s pace); the first post-cutover „Дата на
   обявяване" on a ГФО settles it, and tells us whether announcements resumed in the CR body
   while staying out of the open-data export. If they resumed, ask the Agency to restore
   `StatementsB`/`BH`/`BI` in the export (cite ДВ 92/2026 and the 12.10 order).
2. ~~Does `DocumentAccess/<token>` serve the same document?~~ **Moot — the token embeds the
   ActID (§3.2), so we keep using `/CR/api/Documents/{ActID}`.**
3. ~~A separate dataset on data.egov.bg?~~ **None as of 2026-11-23** (org 4 lists six
   datasets). Re-check when the watcher canary fires.
4. Coverage of ЮЛНЦ ГФО in the register at all (public-benefit NGOs must file; others need
   not). Measure on a list of named NGOs before promising an NGO tier.
5. Whether to ask the Registry Agency directly (the paid full-DB request in
   `docs/tr-full-db-access-request.md` could add the question "where did обявени актове go
   after 11.10.2026").
