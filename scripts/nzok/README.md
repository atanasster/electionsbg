# НЗОК health-pack ingest

Refreshes the data behind the **health sector pack** on `/awarder/121858220`
(the National Health Insurance Fund). The pack's point: НЗОК's public-procurement
footprint (~€79M) is ~1.5% of its ~€5.5bn budget — the rest (hospital
reimbursements, drug reimbursement, GP/dental care) flows **outside** ЗОП. The
pack fuses the budget law + these non-ЗОП payment streams with the contract
ledger. Full design: `docs/plans/nzok-health-pack-v1.md`.

## Run

```bash
npm run data:nzok                 # the default four (no Postgres needed)
npm run data:nzok -- --hospitals  # just one (--budget/--hospitals/--drugs/--execution)
npm run data:nzok -- --crosswalk  # opt-in: rebuild Рег.№→EIK map (needs local PG)
```

Then, for production: **`bucket:sync data/budget/nzok/`** — these files are
served from the GCS bucket, not the deploy.

## Files (all committed under `data/budget/nzok/`)

| File | Generator | Source (nhif.bg) | Notes |
|---|---|---|---|
| `budget.json` | `scripts/budget/nzok/__write_budget.ts` | ЗБНЗОК law (hard-keyed) | 2026 draft (EUR) + 2025 law (BGN→EUR). Reserve = residual to headline. Add a year by appending to `YEARS`. |
| `hospital_payments.json` | `write_hospital_payments.ts` | `/bg/hospitals/bmp/{year}` PDF | Latest monthly per-hospital БМП. `pdftotext -layout`, wrap-tolerant, reconciliation+count assert. Each row now carries `eik` from the crosswalk. ~90 KB (381 facilities). |
| `drug_reimbursement.json` | `write_drug_reimbursement.ts` | `/bg/medicine_food/quarter-payments/{year}` XLS | Annual gross reimbursement → top-25 INN + ATC groups. BGN→EUR; Cyrillic/Latin INN homoglyphs normalized. |
| `execution.json` | `write_execution.ts` | `/bg/nzok/financial_report/quarter` B1_5600 XLS | Latest monthly cash execution (revenue + expenditure YTD). EBK `Sheet1`, EUR-native from 2026. |
| `hospital_eik.json` | `write_hospital_eik.ts` (`--crosswalk`) | НЗОК договорни партньори + Търговски регистър (PG) | The **Рег.№ ЛЗ → EIK crosswalk**. One entry per facility with `eik` (null when unmatched) + match `method`. 265/381 matched = **93% of YTD €** (verified: 0 false positives). Needs local PG. |
| `hospital_reimbursement_by_eik.json` | `write_hospital_payments.ts` | (derived) | Reverse index keyed by EIK (~256 companies) summing each company's ЛЗ facilities. Feeds the reimbursement tile on `/company/:eik`. |

`parse_hospital_payments.ts` is the shared, reconciliation-asserted PDF parser.

### The Рег.№→EIK crosswalk (`--crosswalk`)

No public register carries BOTH the 10-digit НЗОК Рег.№ ЛЗ **and** the EIK (the
Рег.№ is a НЗОК-internal code; НЗОК's договорни-партньори register publishes it
with the manager + seat but not the EIK, while ИАМН/МЗ/ТР carry the EIK but not
the Рег.№). So the crosswalk is a **high-precision verified match**, not a lookup:

1. `fetch_partners.ts` scrapes НЗОК's contracted-partners app
   (`reports.nhif.bg/nhif_reports/nhif_partners`, one card per Рег.№ with name +
   **управител** + settlement) — the anchor for the join.
2. `write_hospital_eik.ts` matches each partner to `tr_companies`/`tr_officers`
   by brand tokens (facility-type acronym stripped) + type marker
   (БОЛНИЦА/ЦЕНТЪР) + legal form + **manager verification**, with a
   distinctive-shared-token safety gate. A hand-verified `MANUAL_OVERRIDES` table
   resolves the famous high-€ hospitals the guards can't (city-named, corporate
   groups like Сърце и Мозък, and state entities absent from TR such as ВМА / МИ
   МВР). Anything not confidently matched stays `eik: null` (honest).

## Gotchas

- **xlsx**: the bundled build has file access disabled — read with
  `xlsx.read(fs.readFileSync(path), { type: "buffer", codepage: 1251 })`, never
  `xlsx.readFile`.
- **B1 layout**: НЗОК's B1 (fund 5600) uses `Sheet1`/`INF`/`list` — a *different*
  template from NSSI's B1 (`OTCHET-agregirani`), so the NOI parser is **not**
  reusable; `write_execution.ts` reads the EBK section totals directly.
- Raw downloads cache under `raw_data/nzok/` (gitignored).

## Not yet built (the roadmap)

- **Crosswalk tail** — 111 small facilities (6.9% of YTD €) stay `eik: null`;
  extend `MANUAL_OVERRIDES` or the matcher to chip away at them. Re-run
  `--crosswalk` and re-audit (0 false positives is the bar) before shipping.
- **PG table + `/api/db`** for the full multi-year per-hospital corpus (for
  per-hospital pages + payment momentum); the tile currently ships the latest
  snapshot as static JSON.
- **Watcher + changelog wiring** + an `update-nzok` skill so the daily watcher
  refreshes these files (currently a manual `npm run data:nzok`).
- **2017–2026 backfill** of hospital payments (behind a `--backfill` flag).
- The quarterly **"Превишение"** (overspend) signal.
