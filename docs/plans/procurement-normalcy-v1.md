# "How normal is this procurement?" — v1

Date: 2026-07-13. Status: **SHIPPED**. The ex-post, public-facing complement to
the ex-ante control tool proposed in Стефан Люцканов's "Концепция за система за
предварителен контрол" (София 2026). Where that concept inspects a procurement's
DRAFT documents before award (regulator-facing, non-public inputs), this reads
the PUBLISHED contract corpus and positions one signed contract in the
distribution of similar ones — citizen-facing, descriptive, no draft documents
required.

## What it is (and isn't)

A per-contract panel on `/procurement/contract/:key` that answers "how does this
compare to similar procurements?" across four metrics. It is **descriptive, not a
verdict**. It never emits a single guilt score; each metric is positioned in its
cohort and a risk direction is a hint, not a finding. The per-contract JUDGMENT
stays in `computeProcurementRisk` (the CRI + flags); this panel supplies the
CONTEXT that makes a flag legible — e.g. single-bidder only matters where the CPV
market is normally competitive, which the bidders block quantifies. Framing in
copy: "отклонение", never "нарушение".

This maps onto the two-module split in the concept deck: the deterministic PG
function is Module 1 (rules + statistics); the AI narration tool is Module 2.

## Cohort methodology (the concept's "~120 similar procurements")

- **Adaptive CPV prefix.** Start at the finest CPV prefix (8→5→4→3→2) whose
  cohort still has ≥30 rows; a wider prefix never has fewer, so "finest with
  n≥30" is well-defined. The header names the prefix + n used.
- **Era-matched window.** Target date ±30 months. Sargable on the text `date`
  via `idx_contracts_cpvdiv_date = (tag, left(cpv,2), date) INCLUDE amount_eur`,
  which also bounds the heap fetch for the non-indexed metric columns.
- `tag='contract'` only; the target is excluded from its own cohort.
- **Percentile** = share of the cohort strictly below the target value.
- **Sample floor.** `NORMALCY_MIN_N = 20` per metric to read a verdict / count a
  deviation; below that the strip renders but says "малка извадка". The cohort
  `sufficient` flag is false when even the 2-digit division can't clear 30.

## Metrics shipped (only where the corpus carries the data)

| Metric | Column | Peer set | Risk dir |
|---|---|---|---|
| value | `amount_eur` | CPV cohort | neutral |
| bidders | `number_of_tenderers` (54% coverage) | CPV cohort | low = weaker competition |
| procedure | `procurement_method` bucket | CPV cohort | non-open in a mostly-open cohort |
| concentration | supplier's share of THIS buyer's spend | the buyer's other suppliers | high = single-supplier reliance |

**Deliberately omitted** (data reality, not laziness):
- срок за оферти — `tender_period_*` is 0% populated in the contracts corpus.
- estimated-vs-contracted — the tender estimate covers the whole procedure, so
  the ratio is meaningless for multi-lot awards; would need per-lot logic.

## Presentation

A percentile ruler per metric: fixed bands (IQR 0.25–0.75, whiskers 0.10–0.90,
median 0.5) with the contract's dot at its true percentile — a ruler, not a value
axis, so a heavy-tailed distribution never squishes the bands (absolute value +
median shown in text). Risk-tail shaded on the relevant side. CSS-positioned (not
SVG) so the marker stays a true circle at any width. Soft summary: "N of M
indicators deviate", never a score.

## Files

- `scripts/db/schema/pg/063_procurement_normalcy.sql` — `procurement_normalcy(key)`
  + `procurement_procedure_bucket(text)` (SQL port of `cpvSectors.procedureBucket`).
  Registered in `load_pg.ts`. Worst-case ~90–300ms; CDN + React Query cached.
- `functions/db_routes.js` — route `procurement-normalcy`.
- `src/data/procurement/useContractNormalcy.ts` — hook + payload types.
- `src/lib/normalcy.ts` — verdict logic (shared by panel + AI tool).
- `src/screens/components/procurement/ContractNormalcyPanel.tsx` — the panel.
- `ai/` — `procurementNormalcy` tool (narrates the same payload).

Side fix: `cpvSectors.procedureBucket` matched `състезат` (missed "публично
състезание" → read as "Друга"); widened to `състеза`. Kept in sync in the SQL
bucketer.

## Deploy notes

Apply `063_procurement_normalcy.sql` to Cloud SQL via `apply_functions.ts`
against the proxy (NOT `db:dump`, which only dumps outward to GCS), then redeploy
`functions:db`. No data reload needed — the function reads the existing
`contracts` table.

## Backlog

- Cohort-granularity toggle (CPV-8 / CPV-4 / division) as a transparency control.
- Bidders/procedure can starve at a fine CPV prefix (chosen on the value cohort);
  consider a per-metric cohort widen when the fine one is < floor.
- A Наясно post once live on cloud ("вижте колко типична е всяка поръчка").
