---
name: update-nzok
description: Refresh the НЗОК (National Health Insurance Fund) health-pack data (data/budget/nzok/) — the per-hospital БМП payments, gross drug-reimbursement by INN, and monthly B1 cash-execution that feed the health sector pack on /awarder/121858220. Each generator fetches the latest file from nhif.bg directly (no manual download). Use when the daily watch report flags `nzok_hospital_bmp`, `nzok_drug_quarterly`, or `nzok_execution_b1` as changed, when the user asks to refresh НЗОК / NHIF / health-fund data, or after a fresh git clone if data/budget/nzok/*.json is missing.
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
   Each generator fetches from nhif.bg, parses (reconciliation-asserted for hospital payments), and rewrites the matching `data/budget/nzok/*.json`.
2. **Reload the hospital-payments Postgres table** — the pack's hospital tile and the `/company/:eik` reimbursement tile are DB-served from `nzok_hospital_payments`, NOT the static JSON, so on a new monthly БМП file this is what actually updates the live tiles:
   ```bash
   npm run db:load:nzok-hospital:pg          # local — verify row/month counts
   npm run db:load:nzok-hospital:pg:cloud    # Cloud SQL via the proxy on :5434
   npm run db:push:cloud                     # refresh the GCS snapshot
   ```
   The loader is idempotent (TRUNCATE+reload in one txn, changelog-deduped). Skip when only `--drugs`/`--execution` changed (those stay static-JSON-served).
3. Sanity-check the console output: hospital payments print the facility count + national total that must reconcile to the file's own "Общо РЗОК" grand total; drugs print the €total + top INN + oncology group L; execution prints revenue + expenditure YTD.
4. Commit the changed `data/budget/nzok/*.json` (+ `data/db/procurement.lock.json` if you pushed).
5. **`bucket:sync data/budget/nzok/`** — the budget/drug/execution JSONs are served from the GCS bucket; without the sync those tiles aren't live.
6. Stamp `state/ingest/update-nzok.json` with `lastSuccessfulIngest` (current UTC ISO) + a one-line `summary` so `process-watch-report` won't re-trigger.

## Notes

- **xlsx**: the bundled build has file access disabled — the generators read via `xlsx.read(fs.readFileSync(path), { type: "buffer", codepage: 1251 })`.
- Raw downloads cache under `raw_data/nzok/` (gitignored) — safe to delete.
- The ИАМН рег.№→EIK crosswalk is **built** (opt-in via `npm run data:nzok -- --crosswalk`, needs local PG; 265/381 facilities matched = 93% of YTD €). It is near-static — re-run + re-audit (0 false positives is the bar) only when extending `MANUAL_OVERRIDES` in `scripts/nzok/write_hospital_eik.ts`. See `scripts/nzok/README.md`.
