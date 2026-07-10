---
name: update-nzok
description: Refresh the НЗОК (National Health Insurance Fund) health-pack data (data/budget/nzok/) — the per-hospital БМП payments, gross drug-reimbursement by INN, and monthly B1 cash-execution that feed the health sector pack on /awarder/121858220. Each generator fetches the latest file from nhif.bg directly (no manual download). Also covers the per-hospital drug UNIT prices (НЗОК Справка 5 / ПЛС2) and the МЗ quarterly hospital financial indicators (ЕЕОФ). Use when the daily watch report flags `nzok_hospital_bmp`, `nzok_drug_quarterly`, `nzok_drug_unit_prices`, `nzok_execution_b1`, or `mh_eeof_quarterly` as changed, when the user asks to refresh НЗОК / NHIF / health-fund / hospital-financials data, or after a fresh git clone if data/budget/nzok/*.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update НЗОК skill

Refreshes `data/budget/nzok/` — the data behind the **health sector pack** on `/awarder/121858220`. НЗОК's public-procurement footprint (~€79M) is ~1.5% of its ~€5.5bn budget; the pack fuses the budget law + the non-ЗОП payment streams (hospital reimbursements, drug reimbursement, cash execution) with the contract ledger. Design: `docs/plans/nzok-health-pack-v1.md`; ingest details: `scripts/nzok/README.md`; memory `[[project_nzok_health_pack]]`.

**Source:** `nhif.bg` — fetched directly over plain HTTPS (no Cloudflare, unlike the NSSI B1 flow which needs a manual download). All four generators auto-discover and download the newest file.

## When to run

| Trigger | Action |
|---|---|
| Watcher flags `nzok_hospital_bmp` changed (new monthly hospital-payments PDF) | `npm run data:nzok -- --hospitals` |
| Watcher flags `nzok_drug_quarterly` changed (new quarter / annual drug XLS) | `npm run data:nzok -- --drugs` |
| Watcher flags `nzok_execution_b1` changed (new monthly B1 execution XLS) | `npm run data:nzok -- --execution` |
| Two or three flagged together | `npm run data:nzok` (runs all steps) |
| User asks "refresh НЗОК / health-fund data" | `npm run data:nzok` |
| Fresh clone, `data/budget/nzok/*.json` missing | `npm run data:nzok` |

The budget law (`--budget`, `budget.json`) is **hard-keyed** from the annual ЗБНЗОК — it has no watcher source and is only re-run when a new fiscal year's law is added to `scripts/budget/nzok/__write_budget.ts`.

## Procedure

1. Run the ingest for the flagged subset (or all):
   ```bash
   npm run data:nzok -- --hospitals --drugs --execution
   ```
   Each generator fetches from nhif.bg, parses (reconciliation-asserted for hospital payments), and rewrites the matching `data/budget/nzok/*.json`. Note: `--execution` also writes `execution_history.json` (every B1 month on the page, for the plan-vs-actual pace chart), and `--drugs` also computes the full-year-vs-full-year `growth` block (fastest-rising / falling / newly-reimbursed molecules from the two latest annual files) inside `drug_reimbursement.json`.
2. **Reload the hospital-payments Postgres table** — the pack's hospital tile and the `/company/:eik` reimbursement tile are DB-served from `nzok_hospital_payments`, NOT the static JSON, so on a new monthly БМП file this is what actually updates the live tiles:
   ```bash
   npm run db:load:nzok-hospital:pg          # local — verify row/month counts
   npm run db:load:nzok-hospital:pg:cloud    # Cloud SQL via the proxy on :5434
   npm run db:dump:cloud                     # refresh the GCS snapshot
   ```
   The loader is idempotent (TRUNCATE+reload in one txn, changelog-deduped) and applies **both** migration 045 (the table) and 047 (the `nzok_hospital_payments_trends` / `nzok_hospital_momentum_by_eik` functions that serve the momentum tile + the `/company/:eik` spend-growth percentile), so the trend endpoints refresh with the table. Skip when only `--drugs`/`--execution` changed (those stay static-JSON-served).
3. Sanity-check the console output: hospital payments print the facility count + national total that must reconcile to the file's own "Общо РЗОК" grand total; drugs print the €total + top INN + oncology group L; execution prints revenue + expenditure YTD.
4. Commit the changed `data/budget/nzok/*.json` (+ `data/db/procurement.lock.json` if you pushed).
5. **`bucket:sync data/budget/nzok/`** — the budget/drug/execution JSONs are served from the GCS bucket; without the sync those tiles aren't live.
6. Stamp `state/ingest/update-nzok.json` with `lastSuccessfulIngest` (current UTC ISO) + a one-line `summary` so `process-watch-report` won't re-trigger.

## Notes

- **xlsx**: the bundled build has file access disabled — the generators read via `xlsx.read(fs.readFileSync(path), { type: "buffer", codepage: 1251 })`.
- Raw downloads cache under `raw_data/nzok/` (gitignored) — safe to delete.
- The ИАМН рег.№→EIK crosswalk is **built** (opt-in via `npm run data:nzok -- --crosswalk`, needs local PG; 265/381 facilities matched = 93% of YTD €). It is near-static — re-run + re-audit (0 false positives is the bar) only when extending `MANUAL_OVERRIDES` in `scripts/nzok/write_hospital_eik.ts`. See `scripts/nzok/README.md`.


## Payment streams (migration 050)

НЗОК pays a hospital through THREE monthly reports, all listed on the same
`nhif.bg/bg/hospitals/bmp/{year}` page. A facility's НЗОК income is their sum:

| stream | report | FY2025 | facilities |
|---|---|---|---|
| `bmp` | Заплатени здравноосигурителни плащания за БМП | €2.271bn | 388 |
| `drugs` | Заплатени средства за ЛП в условията на БМП | €0.799bn | 48 |
| `devices` | Заплатени средства за МИ, прилагани в БМП | €0.059bn | 107 |

Before 050 only `bmp` was ingested and every per-hospital figure understated the
facility. `scripts/nzok/parse_hospital_payments.ts` takes a `stream` argument;
`bmp` keeps a strict reading while `drugs`/`devices` allow single-amount rows and
negative amounts (clawbacks), which they legitimately contain.

The `nzok_hospital_bmp` watcher fingerprints **all three** links. The trend and
momentum functions stay pinned to `stream = 'bmp'` — the drugs/devices series is
shorter, so folding them into a 2023→ time series would print a step change that
is an artefact of ingest coverage.

**After ANY parser change, check the latest-period TOTAL per stream, not just the
facility count.** A misparse once shipped inside the 0.5% reconciliation tolerance.

## New datasets

### Per-hospital drug unit prices — `npm run data:nzok -- --drug-prices`
Source: `nhif.bg/bg/nzok/medicine/5` → `Справка 5_ПЛС2_MM.YYYY.xls` (monthly).
Carries `Опаковки`, `Брой в опаковка`, `Реимбурсна сума` and the `МКБ` code, so a
unit price is derivable — the annual "Брутни разходи по INN" file has no quantity
column, which is why this was long recorded as blocked.

Writes `data/budget/nzok/drug_unit_prices.json` (gitignored, regenerable), then
`npm run db:load:nzok-drug-prices:pg` loads migration 052.

Compare at **pack identity** (`Национален №`), never at INN: PEMETREXED alone
spans five packs whose per-unit medians run €17–€66. A **5-pack volume floor**
applies. Dispersion is not wrongdoing — volume, delivery period and contract terms
all move a unit price. The defensible claim is *persistent* dispersion.

### Quarterly hospital financials (ЕЕОФ) — `npm run data:nzok -- --eeof`
Source: МЗ, "Финансови показатели на лечебни заведения за болнична помощ", one
XLSX per quarter under Наредба № 5 от 2019, **2019-Q2 →** (26 quarters).
Revenue, expense, total and overdue liabilities, beds, occupancy, length of stay,
cost per patient. Money columns are published in **хил. лева**.

Writes `data/budget/nzok/hospital_financials.json` (gitignored, regenerable), then
`npm run db:load:nzok-financials:pg` loads migration 051.

The workbook's third sheet (`НЗОК`) is keyed by `Рег.№ ЛЗ` and carries БМП +
devices + drugs per quarter — an **independent parity reference** for the three
payment streams, loaded into `nzok_eeof_nzok_parity`.

Per-patient indicators are emitted raw and are **never ranked**: a specialised
centre spends multiples of a general hospital's per-patient figure because of its
case mix. Ranking without a case-mix denominator (the clinical-pathway corpus,
not yet ingested) would rank specialties, not stewardship.

Known gap: 8 municipal blocks (2019-Q4 → 2021-Q3) are skipped on load — a parser
artefact collapses hospital identity to bare oblast labels in those quarters, so
their rows can neither be keyed nor matched to an EIK. They are listed on every
load. The remaining 43 blocks (3,635 rows) load cleanly.
