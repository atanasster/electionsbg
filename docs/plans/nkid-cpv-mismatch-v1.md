# NKID-vs-CPV mismatch flag — v1 (plan §8 B1)

A procurement risk signal: **does the winner do this for a living?** A contractor
whose only *declared* activity (НКИД / КИД-2008 = NACE) is unrelated to the
contract's CPV sector is a soft red flag (the plan's "retail firm winning a €4M road
contract"). Data source: the CR Deeds `CR_F_6a_L` field captured by
cr-deeds-capture-v1, present for **46.9%** of companies (the rest → *not checkable*).

Decision (2026-08-07, operator): surface it in **BOTH** places — a company-level
signal chip AND a per-contract risk-index flag. The per-contract claim is the
reputationally-sensitive one, so the crosswalk is deliberately **conservative**.

## Design principles (this is a claim about real companies)

1. **Conservative crosswalk.** The flag fires only when the contract's CPV division
   is *clearly disjoint* from the contractor's declared NACE division — never on a
   plausible or adjacent match. When in doubt, DO NOT fire.
2. **Answered-vs-unknown, like `newFirmWinner`.** No NKID on file (53%) ⇒ the check
   is **unavailable**, NOT clean. It never counts against the denominator, never
   renders as "OK". A firm we can't check is shown as such.
3. **Declared ≠ exhaustive.** A company lawfully does things outside its registered
   NKID. The UI copy says "declared activity", never "not allowed to". The signal is
   "worth a look", not "improper".
4. **One source of truth for the crosswalk.** The NACE→CPV allow-map is a PG DATA
   table (`nace_cpv_allow`), joined by the SQL cache AND serialized into the client
   payload — so the TS scorer and SQL 112 read the SAME map (no duplicated logic to
   drift under the parity gate).

## Data model

- **`company_nkid`** (PG, migration 1XX) — `eik text pk, nace_code text, nace_div
  text, label text, source text`. Loaded by `db:load:cr-nkid:pg` from the CR store
  (parse `CR_F_6a_L`), same shape as `db:load:cr-founding:pg`. Absent-safe, mtime-gated.
  `parse_cr_deeds.ts` gains a parsed `naceCode`/`naceDivision` (today it keeps the raw
  `nkid` string only).
- **`nace_cpv_allow`** (PG, same migration) — `nace_div text, cpv_div text`, the
  curated conservative crosswalk (a NACE division → the CPV divisions it plausibly
  covers). Seeded from a committed TS artifact `src/lib/naceCpv.ts` so the map is
  reviewable in code and shipped to the client verbatim.
- **`033` payload** gains `nkidByEik` (eik→nace_div) + `naceCpvAllow` (the map), so
  `computeProcurementRisk.ts` can evaluate the flag client-side identically.

## The flag — `nkidMismatch`

Per contract, given contractor `nace_div` (from `nkidByEik`) and contract `cpv_div`
(`cpv[:2]`):
- **unavailable** when the contractor has no `nace_div`, or the contract has no CPV.
- **fired** when `nace_div` is present, `cpv_div` is present, and
  `(nace_div, cpv_div) ∉ nace_cpv_allow` **and** `nace_div` has ≥1 allow row (i.e. we
  have an opinion about that NACE division — an unmapped NACE division is *unavailable*,
  not a mismatch, so a gap in the crosswalk never manufactures a flag).
- otherwise **available, not fired**.

Added to `RiskComponentKey` in `computeProcurementRisk.ts` AND the SQL flag set in
`112_contract_risk_cache.sql`, with `risk_parity.harness.ts` proving they agree.

**Company chip** (`CompanyRiskChips`): aggregate over the company's contracts —
"обявена дейност: <label>; N от M договора в несвързан CPV" — shown only when the
company has an NKID and ≥1 mismatch. Descriptive, not grade-affecting on its own.

## Step sequence (each: implement → review → repair → commit)

1. **Parser:** extract `naceCode`/`naceDivision` from `CR_F_6a_L` in
   `parse_cr_deeds.ts` (+ fixtures/tests). Pure, low-risk.
2. **Crosswalk artifact:** `src/lib/naceCpv.ts` — the conservative NACE-div→CPV-div
   allow-map + `naceCpvMismatch()` helper, with unit tests over real sector pairs
   (construction, retail, health, IT, transport). This is the judgment-heavy core;
   review it hardest.
3. **Persistence:** migration `1XX` (`company_nkid` + `nace_cpv_allow`) +
   `db:load:cr-nkid:pg` loader (mtime-gated, absent-safe) + wire into `tr:daily-refresh`
   and `db:refresh`; extend the `033` payload with `nkidByEik` + `naceCpvAllow`.
4. **Scorer (TS):** add `nkidMismatch` to `computeProcurementRisk.ts` + the client
   payload hook (`useCompanyFoundedByEik` sibling). Harness cases incl. the
   unavailable/unmapped-NACE branches.
5. **Scorer (SQL) + parity:** add the same flag to `112_contract_risk_cache.sql`
   reading `company_nkid`⋈`nace_cpv_allow`; extend `risk_parity.harness.ts` so TS≡SQL.
6. **UI:** `RiskBadges.tsx` (per-contract badge, careful copy) + `CompanyRiskChips.tsx`
   (company aggregate). Both carry the "declared activity" framing + a not-checkable
   state.
7. **Regression + changelog + docs:** PG-backed gate (a known disjoint pair fires, a
   matching pair doesn't, no-NKID is unavailable); changelog; mark §8 B1 done.

## Cloud

`company_nkid` + `nace_cpv_allow` follow the `company_founded` shape: LOCAL-authored
from the CR store, shipped via a `:cloud` loader; the migration applied to Cloud SQL
first; `procurement_risk_indexes_cache` refreshed after. No auto path — operator step,
documented in CLAUDE.md alongside the CR Deeds note.
