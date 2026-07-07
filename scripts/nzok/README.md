# НЗОК health-pack ingest

Refreshes the data behind the **health sector pack** on `/awarder/121858220`
(the National Health Insurance Fund). The pack's point: НЗОК's public-procurement
footprint (~€79M) is ~1.5% of its ~€5.5bn budget — the rest (hospital
reimbursements, drug reimbursement, GP/dental care) flows **outside** ЗОП. The
pack fuses the budget law + these non-ЗОП payment streams with the contract
ledger. Full design: `docs/plans/nzok-health-pack-v1.md`.

## Run

```bash
npm run data:nzok                 # all four
npm run data:nzok -- --hospitals  # just one (--budget/--hospitals/--drugs/--execution)
```

Then, for production: **`bucket:sync data/budget/nzok/`** — these files are
served from the GCS bucket, not the deploy.

## Files (all committed under `data/budget/nzok/`)

| File | Generator | Source (nhif.bg) | Notes |
|---|---|---|---|
| `budget.json` | `scripts/budget/nzok/__write_budget.ts` | ЗБНЗОК law (hard-keyed) | 2026 draft (EUR) + 2025 law (BGN→EUR). Reserve = residual to headline. Add a year by appending to `YEARS`. |
| `hospital_payments.json` | `write_hospital_payments.ts` | `/bg/hospitals/bmp/{year}` PDF | Latest monthly per-hospital БМП. `pdftotext -layout`, wrap-tolerant, reconciliation+count assert. ~90 KB (381 facilities). |
| `drug_reimbursement.json` | `write_drug_reimbursement.ts` | `/bg/medicine_food/quarter-payments/{year}` XLS | Annual gross reimbursement → top-25 INN + ATC groups. BGN→EUR; Cyrillic/Latin INN homoglyphs normalized. |
| `execution.json` | `write_execution.ts` | `/bg/nzok/financial_report/quarter` B1_5600 XLS | Latest monthly cash execution (revenue + expenditure YTD). EBK `Sheet1`, EUR-native from 2026. |

`parse_hospital_payments.ts` is the shared, reconciliation-asserted PDF parser.

## Gotchas

- **xlsx**: the bundled build has file access disabled — read with
  `xlsx.read(fs.readFileSync(path), { type: "buffer", codepage: 1251 })`, never
  `xlsx.readFile`.
- **B1 layout**: НЗОК's B1 (fund 5600) uses `Sheet1`/`INF`/`list` — a *different*
  template from NSSI's B1 (`OTCHET-agregirani`), so the NOI parser is **not**
  reusable; `write_execution.ts` reads the EBK section totals directly.
- Raw downloads cache under `raw_data/nzok/` (gitignored).

## Not yet built (the roadmap)

- **ИАМН рег.№→EIK crosswalk** — the linchpin that would link each of the 381
  hospitals to its own `/company` page (reimbursement-in vs procurement-out on
  one page). Needs the authoritative facility register on data.egov.bg;
  name-matching the commerce register is unreliable (payments use abbreviations
  like УМБАЛ; TR carries the full legal name) and risks wrong links.
- **PG table + `/api/db`** for the full multi-year per-hospital corpus (for
  per-hospital pages + payment momentum); the tile currently ships the latest
  snapshot as static JSON.
- **Watcher + changelog wiring** + an `update-nzok` skill so the daily watcher
  refreshes these files (currently a manual `npm run data:nzok`).
- **2017–2026 backfill** of hospital payments (behind a `--backfill` flag).
- The quarterly **"Превишение"** (overspend) signal.
