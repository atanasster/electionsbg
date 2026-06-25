# Consolidated КФП deficit baseline — completion runbook

## Why

The `/budget/simulator` deficit gauge is anchored on the **EC spring forecast
(−4.1 % of GDP)** — an external, optimistic projection hard-coded in
`src/lib/bgFiscalProjection.ts` (`EC_BALANCE_PCT`). The government's own draft
budget projects **−5.7 % (КФП)**. The gap is structural spending growth the EC
didn't assume, not a few discrete measures.

Our budget data is **state-budget scope** (`data/budget/kfp.json`,
`constituentBudget: "state"` — the data.egov.bg `79ce7de2…` dataset). The −5.7 %
is the **consolidated fiscal program (КФП)** — state **+ municipalities +
social-security funds (НОИ/НЗОК) + other autonomous budgets**, which we do not
hold on the expenditure side. So the consolidated deficit cannot be derived from
our current data; we need the consolidated feed.

Decision (operator): **ingest the live consolidated КФП feed**, then derive the
deficit = revenue − expenditure (nothing hard-coded). Caveat we accepted:
*execution* will not equal the government's forward **−5.7 % plan** — that figure
embeds 2026 spending *decisions* (the +5 % wage indexation, social growth), so a
projection off consolidated execution lands at our own estimate, like the EC's.

## Blocker (why this is a runbook, not a finished change)

`data.egov.bg` and `minfin.bg` return **403** to automated clients from the
current environment (confirmed: 403 even with a browser User-Agent; consistent
with the project-wide egov block). The fetch must run where the portal is
reachable. The consolidated dataset UUID is therefore **not yet known** — it has
to be discovered against a live portal.

## Done already

- `scripts/budget/kfp.ts` — `buildKfpFile(parsed, sources, constituent)` now
  takes a `ConstituentBudget` (default `"state"`, so no behavior change). Pass
  `"consolidated"` to tag a consolidated ingest. The existing egov "major budget
  indicators" table parser (`parseEgovResource`) is reused as-is; the consolidated
  table is published in the same five-section (I–V) layout, so it should parse
  without change — **verify against the real resource** (step 2).

## Steps to finish (run where data.egov.bg is reachable)

1. **Find the consolidated КФП dataset.** On the МФ organisation page
   (`org_ids:[143]` via `POST data.egov.bg/api/listDatasets`, or browse
   data.egov.bg), locate the *consolidated* fiscal-programme execution dataset
   (title contains "консолидираната фискална програма" / "КФП", **not** the
   state-budget `79ce7de2…`). Record its dataset UUID. If no consolidated dataset
   exists there, the source is the МФ monthly bulletins (tracked by
   `scripts/watch/sources/minfin_mreports.ts`, via Wayback) — that needs a
   separate bulletin parser instead of the egov path below.

2. **Wire the ingest.** In `scripts/budget/fetch_sources.ts` add the consolidated
   dataset UUID beside `EGOV_DATASET_UUID`; fetch its resource UUIDs + rows the
   same way, then `buildKfpFile(parsedConsolidated, sources, "consolidated")` and
   write `data/budget/kfp_consolidated.json`. Sanity-check: consolidated 2025
   revenue ≈ €44 B (vs €26 B state) and expenditure ≈ €48 B; balance ≈ −€4 B.

3. **Emit the baseline deficit (derived).** In
   `scripts/budget/run_policy_baseline.ts`, read `kfp_consolidated.json`, compute
   `balanceEur = revenue − expenditure` per closed year, and emit a
   `consolidatedDeficitPctGdp` (balance ÷ macro GDP) into `policy_baseline.json`.
   No deficit % is typed — it falls out of revenue − expenditure.

4. **Make the projection data-driven.** In `src/lib/bgFiscalProjection.ts`,
   replace the hard-coded `EC_BALANCE_PCT[year]` baseline with the
   `consolidatedDeficitPctGdp` from `policy_baseline.json` when present; keep the
   EC value only as a documented fallback (cite both). Thread the value in via a
   `projectFiscalPath` parameter so the lib stays pure (the simulator already
   loads `policy_baseline`).

5. **Fix the preset double-count.** With the baseline now consolidated, decide
   the "Бюджет 2026" preset's role: the consolidated execution baseline does NOT
   already contain the 2026 proposed measures, so the preset's modeled levers
   (МОД/vignette/SOE/excise) still apply cleanly on top. Verify the headline +
   deficit gauge read sensibly and update the preset tooltip.

6. **Gates.** `npm run budget:test`, `npm run ai:harness`, `npm run ai:test`,
   `npm run build`, `npx eslint . --fix`. Add a `kfp_consolidated.json` canary to
   `scripts/budget/validate.ts`. Add a watcher source for the consolidated dataset
   in `scripts/watch/sources/` so the daily watcher flags new releases.

## Note on the forward −5.7 %

If you also want the gauge to match the government's published −5.7 % *plan*
(not our execution-based estimate), that single figure only exists in the МФ
**ЗДБРБ-2026 budget proposal** (КФП framework: revenue €49.6 B, expenditure
€56.8 B for 2026). Ingesting those two consolidated aggregates and computing
rev − exp is the only way to reproduce −5.7 % exactly — a smaller,
offline-doable alternative to the live-feed path above.
