# НЗОК health pack — v1

## Status (2026-07-07)

- **Phase 1 — SHIPPED** (commit `7914e520d`), verified in dev. Pack renders on
  `/awarder/121858220`: budget-bridge hero with 2026-draft/2025-law year toggle
  (€5.5bn ↔ €4.8bn), honest "под 0,5% минава през поръчки" sentence, ЗОП lens
  (Информационно обслужване 23% + statutory chip), "Какво купува по функция"
  category tile (54%-single-bid IT), nav pill "Здравна каса (НЗОК)".
- **Phase 2 — parser + hospital tile DONE + verified** (commits `bd1fe0ee6`,
  `9a1f35564`). `scripts/nzok/parse_hospital_payments.ts` parses the monthly
  per-hospital БМП PDFs (reconciliation+count assert; May-2026 = 381 facilities,
  Σ €942,127,529 vs header €942,127,532). `write_hospital_payments.ts` →
  `data/budget/nzok/hospital_payments.json`; `NzokHospitalPaymentsTile` renders
  the top-paid ranking + Болници/По РЗОК toggle on the pack. REMAINING:
  2017-2026 backfill, PG table + `/api/db` (for per-hospital pages), ИАМН
  рег.№→EIK crosswalk, watcher+changelog, `update-nzok` skill.
- **Phase 3 — drug tile + execution gauge DONE + verified** (commits
  `5b7d863bf`, `efaf1251d`). `write_drug_reimbursement.ts` →
  `drug_reimbursement.json`; `NzokDrugReimbursementTile` (Молекула/Област). 2025
  = €1.62bn, top PEMBROLIZUMAB €189.8M, oncology 62%. `write_execution.ts` reads
  the monthly B1_5600 ЕБК template (own parser — different sheets from NSSI's B1)
  → `execution.json`; the budget-bridge tile shows a "spent €X of €Y (Z%)" gauge
  (April 2026 = €1.72bn of €5.54bn, 31.1%). REMAINING: the quarterly "Превишение"
  overspend signal (nice-to-have).
- **Phase 4 — not started** (crosswalk lights up hospital pages + prerender +
  launch post).

---


Goal: give the National Health Insurance Fund (НЗОК, EIK `121858220`) a
domain-specific **sector pack** on `/awarder/121858220`, the same seam the roads
pack uses (`getSectorPack(eik)` in `src/screens/components/procurement/sectorPacks.tsx`).

Unlike АПИ, НЗОК's story is **not in the contracts table**. Its public-procurement
footprint is €79.8M / 1,354 contracts / 351 suppliers (2011-2026, measured in local
PG) — **~1.5% of a single year's budget** (ЗБНЗОК 2026 ≈ €5.54bn). The other ~98.5%
flows outside ЗОП, exempt under чл.45 ал.6 ЗЗО: hospital reimbursements (БМП
€2.36bn/y), drug reimbursement (€1.33bn/y), GP/dental/specialist care. So the pack's
job is to **bridge out of procurement** — the domain geometry is non-ЗОП money, not
a contract classifier. This is a new *kind* of pack (finance joined to procurement),
which the roads precedent does not cover.

Research + a serve-path/coverage audit are captured in memory
(`project_nzok_health_pack.md`). Everything below was verified against the repo and
local PG on 2026-07-07.

## Decisions (agreed — "proceed all")

1. **Serve-path split by dataset size.** Tiny annual data (budget waterfall, B1
   execution) ships as **static JSON on GCS** (the NOI `funds.json` pattern — no new
   endpoint). Large row-level data (per-hospital monthly payments) gets a **PG table +
   `/api/db` function** with the index/`EXPLAIN ANALYZE` discipline. Do not force both
   through one path.
2. **Hospital рег.№→EIK crosswalk is a tracked prerequisite, not inline scope.** The
   per-hospital ranking ships **name-keyed in v1** (no EIK link); the ИАМН crosswalk is
   its own work item that, when done, lights up the reimbursement tile on the 381
   hospital `/company/:eik` pages (v2). This de-risks the flagship from the longest pole.

## Corrected assumptions (from the audit — do not repeat the earlier plan's errors)

- **Scope pill does NOT apply to this pack.** `pscope=ns` yields a parliament window
  (e.g. `[2026-04-19, 2027-04-20)`) that straddles two calendar years; budget/hospital
  data is fiscal-year. The pack **ignores** the inherited `{from,to}` and carries its
  own year selector (shared Radix `Select`, never native — `feedback_no_native_select`).
  This is a deliberate break from the roads "inherit the window" behavior; call it out
  in the pack so the next maintainer doesn't "fix" it.
- **File ceiling is a non-issue.** dist is ~87.6k HTML files vs a 453k Firebase limit;
  prerendering the НЗОК page + 381 hospital pages is ~0.1% of the budget.
- **But `/company/:eik` and `/awarder/:eik` are client-only today** (not in
  `scripts/prerender/dynamicRoutes.ts`). The НЗОК page and every hospital page get ~0
  Google visibility until a prerender route is added. Cheap, but net-new — it is a line
  item here, not a free byproduct.
- **Young-company winner share is blocked.** `tr_companies` has `last_updated`
  (record-change), **no incorporation date**. Deferred until the TR ingest is confirmed
  to expose a founding date. Not in v1.
- **EUR normalization at the BGN/EUR boundary.** ЗБНЗОК 2025 is thousand-BGN, 2026 is
  EUR. Convert at ingest at 1 EUR = 1.95583 BGN (`feedback_bg_uses_eur`), or any
  multi-year trend shows a fake 2025→2026 cliff. Display `${num} €` (BG) / `€${num}` (EN).
- **Bid coverage is fine.** Measured 54.0% of all contracts / 51.0% of НЗОК's carry
  `number_of_tenderers` — above the tile hide-floor. "Bids vs sector average" is viable.
- **"Какво купува" honesty caveat.** НЗОК's largest spend bucket by value is
  **null-CPV legacy** (€32.6M / 557 rows), then IT (CPV 72, €26.6M), professional
  services (79, €6.1M), fuels (09, €5.4M), health/vaccines (85, €1.66M). The breakdown
  tile must surface the unclassified slice, not silently drop it.

## Data sources (verified — nhif.bg is plain-curl, NO Cloudflare; WebFetch proxy 403s)

| Dataset | Grain | Format | URL | Feasibility |
|---|---|---|---|---|
| ЗБНЗОК budget law lines | budget line × year | PDF text-extractable | nhif.bg/upload/… + czpz.org | Manual JSON, 1/yr |
| Per-hospital БМП payments (+ drugs-in-hospital, devices — 3 files) | hospital × month, ~381 | PDF, Excel-exported → `pdftotext -layout` | nhif.bg/bg/hospitals/bmp/{year}, 2017→ | Parser; YTD vs in-month cols |
| Drug reimbursement by ATC/INN | drug × quarter, ~2,868 rows | XLSX | nhif.bg/bg/medicine_food/quarter-payments/{year} | Machine-readable |
| B1 cash execution (fund 5600) | budget line × month | XLS (CP1251/BIFF8) | nhif.bg/bg/nzok/financial_report/quarter | **Reuse NOI B1 parser** |
| ИАМН facility register (crosswalk) | ЛЗ рег.№ → EIK | — | data.egov.bg | Build from scratch (v2 prereq) |

## Phasing

### Phase 1 — pack skeleton + budget bridge (frontend + one static JSON)

- Register `HealthPack` in `sectorPacks.tsx` keyed to `121858220`; lazy-loaded like
  `RoadsPack`. Own year selector; does not read `pscope`.
- **Hero — "Къде отиват €5,5 млрд."**: budget waterfall from the ЗБНЗОК law lines
  (болнична €2.36bn → лекарства €1.33bn → СИМП/ПИМП ~€350M ea → дентална €234M → …
  → администрация), with the ЗОП slice (~€10-20M/yr) highlighted as a sliver. Kills the
  "НЗОК only spends €78M" confusion. Data: hand-authored `data/budget/nzok/budget.json`
  (EUR-normalized), one entry per fiscal year.
- **ЗОП lens card**: reframe the generic numbers — НЗОК's procurement is an IT-and-
  security budget with one dominant in-house vendor (the €18.3M чл.7с ЗЕУ award to
  Информационно обслужване was 88% of 2025 ЗОП spend). Flag in-house-exception awards.
- Generic tiles (CPV breakdown, benchmarks, sankey, appeals) stay as-is above/below the
  pack — no change.
- **Add `/awarder/121858220` to the procurement nav** secondary row in
  `ProcurementNav.tsx` (label "Здравна каса"), next to "Пътна инфраструктура";
  `useProcurementHref` carries scope automatically. When a 3rd pack lands, collapse the
  secondary row into a "Сектори" group (defer).

### Watcher + skill — SHIPPED (commit `9bf44ee4f`)

Three watch sources (`scripts/watch/sources/nzok_{hospital_bmp,drug_quarterly,
execution_b1}.ts`) fingerprint the newest nhif.bg file per listing page; an
`update-nzok` skill (auto-fetch via `npm run data:nzok`) is mapped in
`process-watch-report`. The daily watcher now flags a new month/quarter and the
orchestrator re-runs the matching ingest step. Budget law stays manual (no source).

### Phase 2 — per-hospital payments (the moat: PG table + parser + watcher + skill)

New ingest, so follow every convention:
- `scripts/nzok/parse_hospital_payments.ts` — `pdftotext -layout` → rows. **Guard
  against YTD-vs-in-month double-count** (files carry both). Validate per-year (column
  offsets shift across cycles; BGN→EUR break at 2026 — normalize at ingest).
- Historical 2017-2025 load behind `--backfill` (`feedback_one_off_backfills`); only the
  latest month runs in the watcher.
- New PG table `nzok_hospital_payments` + `/api/db` function; **`EXPLAIN ANALYZE` on the
  worst-case hospital, add the index if it seq-scans** (`feedback_db_query_perf`).
- Wire into `recent_updates` via `recordIngestBatch` (in-txn, stable natural key,
  `feedback_pg_changelog_required`); add a `state/watch` source for the monthly nhif
  files; a canary/parity assertion on the header total.
- New `update-nzok-payments` skill, sibling to `update-noi`.
- Tiles: top-paid hospitals ranking + YoY momentum; per-РЗОК choropleth per insured
  person (reuse `ProcurementOblastMap`); onco-drugs-in-hospital concentration. **v1
  name-keyed** — no EIK link yet.

### Phase 3 — drug INN + budget execution (mostly reuse)

- Drug reimbursement quarterly XLSX → top-reimbursed-by-INN tile (top-20, YoY growth,
  price-per-pack trend). Match drugs across quarters by НЗОК-код with care (PLS churns
  2×/month). Plus the quarterly "Превишение" overspend docs as an official-admission
  signal (надлимитна дейност — КС struck hospital caps 04.2024; >€35M unpaid H1 2026).
- Budget-execution gauge: **reuse `scripts/budget/noi/parse_b1_xls.ts`** for fund 5600
  (NOI uses 5500/5591/5592); plan vs monthly cash by line. Output `data/budget/nzok/`,
  static JSON. The cleanest tile in the plan — mostly parser reuse.

### Phase 4 — crosswalk + SEO (the multiplier)

- Build ИАМН рег.№→EIK crosswalk (`data/health/hospitals.json`) from data.egov.bg;
  handle many-to-many (one EIK → several facility numbers).
- Light up an "НЗОК плащания" tile on hospital `/company/:eik` pages (reimbursement-in
  vs procurement-out on one page — no EU portal shows this join).
- Add `/company/:eik` (hospital subset) to `scripts/prerender/dynamicRoutes.ts` for real
  Google indexability (381 pages, ~0.1% of the file budget).
- Feature launch post via `naiasno-post` (FEATURE kind, pinned).

## Generic upgrades (parallel — lift all ~4,000 awarder pages, not just НЗОК)

Tracked here because the research surfaced them, but independent of the health pack:
- **Bids vs sector average** ("this contract got 2 bids; CPV-division average is 5.3") —
  54% coverage confirmed viable. Highest legibility/value ratio.
- **Buyer grade / rating-as-page** (zIndex model) — one headline grade, N peer-benchmarked
  dials, each drilling to the offending contracts; reuse `computeProcurementRisk`.
  **Caveat: НЗОК has no peer** (sui generis, like НОИ/ministries) — the grade works for
  ordinary awarders but cannot peer-benchmark the one page that triggered this. Ship it
  for the ~4,000, not for НЗОК.
- **Threshold-clustering histogram** (contract-splitting detector), **expiring-contracts
  pipeline** (Tussell's most-used widget — needs end-date coverage check), **local-winner
  share** (needs supplier seats joined — same TR join young-company needs).

## Sequencing

Phase 1 is a few days (frontend + one JSON). Phase 2 is the real investment (ingest +
schema + watcher + skill + parser hardening). Phases 3-4 are mostly reuse + the crosswalk
long pole. The generic upgrades can run independently at any time.
