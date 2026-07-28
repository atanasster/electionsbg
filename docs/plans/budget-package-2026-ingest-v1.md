# Ingest the promulgated 2026 budget package (ЗБДОО + ЗБНЗОК) — v1

**Status:** design (2026-07-28). Goal: everything the two promulgated fund-budget laws
publish that we currently guess, show as a draft, or don't hold at all becomes sourced data
— and the one figure we are currently overstating on a live page gets corrected.

Builds on / does not duplicate:

- The `dv_laws` watcher + `FUND_BUDGET_LAWS` catalogue landed in `db3541f3f9` — this plan
  consumes what that commit catalogued; it does not re-derive the promulgation signal.
- `scripts/budget/nzok/__write_budget.ts` — the hand-keyed ЗБНЗОК generator already exists.
  T1 edits its `YEARS` table; it does not introduce a new generator.
- `scripts/budget/noi/__write_funds.ts` — the B1 cash-execution artifact. T4 adds a *plan*
  side beside it; the execution side is untouched.
- `src/lib/bgTax.ts` / `bgTaxPolicy.ts` — the simulator constants. T2/T3 change values and
  one type; the tax math itself is not rewritten.

## 0. What the two laws actually contain (read from ДВ, 2026-07-28)

ДВ бр. 68 от 28.07.2026, adopted by the 52nd НС on 22.07.2026, both in force retroactively
from 1 Jan 2026 except the paragraphs listed as 1 Aug 2026 / promulgation day:

| law | idMat |
|---|---|
| Закон за бюджета на държавното обществено осигуряване за 2026 г. (ЗБДОО) | `244982` |
| Закон за бюджета на Националната здравноосигурителна каса за 2026 г. (ЗБНЗОК) | `244981` |

**The ЗДБРБ-2026 itself is NOT in this issue and remains unpromulgated.** Two thirds of the
package have landed. Every framing decision below assumes that and must not say "the 2026
budget".

### 0a. ЗБНЗОК — a line-item allocation table (чл. 1 ал. 2)

Balanced budget, revenue = expenditure = **€5,256,677.2 thousand**. Headline lines:
ПИМП 345,609.8k · СИМП 351,246.0k · дентална 231,049.4k · медико-диагностична 168,254.3k ·
лекарства/изделия/храни 1,334,348.5k (of which ПЛС 1,264,322.9k) · БМП 2,307,171.5k ·
други плащания 49,317.3k · персонал 48,157.8k · издръжка 17,709.1k · нефинансови активи
2,068.7k · резерв 154,148.1k · МЗ трансфери 101,490.7k. чл. 2 fixes the health contribution
at **8%**.

### 0b. ЗБДОО — statutory parameters, all of them split-year (чл. 9–15)

| parameter | 1 Jan – | steps to |
|---|---|---|
| МОД cap (чл. 9) | €2,111.64 | **€2,300.00 from 1 Aug** |
| min insurable income, self-insured (чл. 9) | €550.66 | **€620.20 from 1 Aug** |
| min pension ОСВ (чл. 10) | €322.37 | **€347.51 from 1 Jul** |
| unemployment benefit, daily (чл. 11) | €9.21 min / €54.78 max | — |
| child-rearing benefit to age 2 (чл. 12) | €398.81 | — |
| death grant (чл. 13) | €276.10 | — |
| guaranteed-claims cap (чл. 15 ал. 2) | €1,550.50 | — |
| ГВРС contributions (чл. 15 ал. 1) | **none due in 2026** | — |
| max pension, one or more, ex-supplements (§ 4 ал. 2) | €1,738.40 whole year | — |

The max-pension figure **confirms** the carried-over `MAX_PENSION = 1738.4` rather than
moving it — the one constant this law validates instead of invalidating. § 4 ал. 3 adds that
the чл. 84 КСО supplement is computed off the capped amount, and § 4 ал. 1 disapplies the
КСО § 6 ПЗР limitation for 2026.

### 0c. ЗБДОО — per-fund plan (чл. 1–8), revenue + transfers, thousand EUR

Consolidated ДОО 15,265,782.4 · Пенсии 5,572,766.5 · Пенсии по чл. 69 931,980.9 · Пенсии
несвързани с трудова дейност 264,736.3 · ТЗПБ 239,126.2 · ОЗМ 1,291,204.5 · Безработица
355,504.7 · НОИ 6,610,463.3. Приложение 3 = ГВРС budget, 4 = Учителски пенсионен фонд,
5 = consolidated all-funds.

### 0d. ЗБДОО appendices — two tables we do not hold in any form

Measured from the promulgated text:

| appendix | shape | finding |
|---|---|---|
| Прил. 1 (1 Jan – 31 Jul) | КИД-2025 activity × 9 qualification groups, 744 МОД cells | only **2.2% above** the €550.66 floor, max €901.41 — the frozen carryover |
| Прил. 1А (1 Aug – 31 Dec) | same shape, 744 cells | **66.9% above** the €620.20 floor, max €1,532.00 — a genuinely renegotiated schedule |
| Прил. 2 / 2А | 87 economic-activity groups | ТЗПБ contribution rate ∈ {0.4, 0.5, 0.7, 0.9, 1.1}% |

### 0e. The policy change (§ 6 ЗБДОО, § 5 ЗБДОО, § 20 ЗБНЗОК)

§ 6 narrows КСО чл. 6 ал. 5 from "чл. 4, ал. 1, т. 2, 3, 4 и 10" to "т. 4" and creates
ал. 5а: **state civil servants (т. 2), the judiciary (т. 3) and т. 10 move off
100%-state-paid social contributions onto an employer/employee split** — phased, pension for
post-1959: 11.8/3.0 from 1 Aug 2026, then 8.22/6.58 from 1 Jan 2027. § 20 ЗБНЗОК does the
same for health at 80:20 from 1 Aug 2026. § 5 puts the universal pension fund at 4/1
(instead of 2.8/2.2) for Aug–Dec 2026.

**Scope caveat that governs every UI decision in T5:** this does **not** touch ordinary
employees under чл. 4 ал. 1 т. 1. `SSC_EMPLOYEE_RATE = 0.1378` stays correct for the default
simulator profile. Any surface that implies a general contribution change is wrong.

## 0f. What this makes wrong on the site today

1. **`data/budget/nzok/budget.json` FY2026 is `basis: "draft"`** — the Надзор proposal of
   2025-10-29, total €5,537,996,900. The adopted law is €5,256,677,200: **we overstate the
   2026 NHIF budget by €281.3M (5.1%)** on the health pack bridge tile
   ([NzokBudgetBridgeTile.tsx](../../src/screens/components/procurement/nzok/NzokBudgetBridgeTile.tsx))
   at `/awarder/121858220`. Per-line: hospital −52.7M, ПИМП −3.7M, dental −2.5M, personnel
   −3.5M, reserve −362.0M, drugs +2.3M, diagnostics +0.8M.
2. **`MIN_PENSION = 322.37`** ([bgTax.ts:55](../../src/lib/bgTax.ts)) has been superseded
   **since 1 July 2026** — it is stale as of today, not as of August.
3. **`MOD_BY_YEAR[2026] = 2112`** and **`MIN_SELF_INSURED_INCOME = 550.66`** go stale on
   **1 August 2026** (four days out).
4. **`scripts/budget/budget2026_package.ts:147` asserts something that stopped being true
   today** — "the 2026 МОД-floor schedule IS the unadopted ЗБДОО-2026 proposal … the
   affected-worker distribution is non-public". The schedule is now published (Прил. 1А);
   only the worker distribution remains non-public.

---

## T1 — ЗБНЗОК: replace the draft with the promulgated law

**Highest value, lowest risk. Do this first and alone.**

**T1.1** — `scripts/budget/nzok/__write_budget.ts`: rewrite `YEARS[0]` (FY2026) from the
promulgated чл. 1 ал. 2 table. `basis: "draft"` → `"law"`, `totalK: 5_537_996.9` →
`5_256_677.2`, and every `k` from §0a. Update the file header comment: source becomes
"ЗБНЗОК 2026 (обн. ДВ бр. 68 от 28.07.2026, idMat 244981)" replacing "проект, приет от
Надзорния съвет 29.10.2025 / nhif.bg/upload/29401".

**T1.2** — Decide the `reserve` residual. The law names реserve (154,148.1k), нефинансови
активи (2,068.7k) and МЗ трансфери (101,490.7k) separately; our `reserve` line is a computed
residual labelled "Резерв, трансфери и капиталови разходи", which is exactly those three.
Keep the residual mechanism (it guarantees reconciliation) and verify it lands at
257,707.6k ± rounding. If it does not, the named lines were mis-keyed — the generator
already throws on overshoot; add a soft check that logs the residual against the law's
154,148.1 + 2,068.7 + 101,490.7.

**T1.3** — Update `source.description` in the generator's output header: FY2026 is no longer
"проект … суми в евро" but "обн. закон". The tile's `basisLabel` already switches on
`year.basis`, so the visible "(проект)" → "(закон)" follows with no component change.

**T1.4** — `npx tsx scripts/budget/nzok/__write_budget.ts`, confirm the reconciliation echo
prints drift €0 for both years.

**Acceptance:** `/awarder/121858220` shows €5.26bn labelled "закон", composition sums to the
headline, no component edited.

**Tests:** extend the generator's existing reconciliation echo into a real assertion, or add
`scripts/budget/nzok/__smoke_budget.ts` in the `__smoke_*` convention asserting (a) FY2026
total = 5_256_677_200, (b) Σ lines = total for every year, (c) FY2026 `basis === "law"`.

**T1.5** — `npx tsx scripts/append-data-change.ts` (skill `update-nzok`) noting the 2026
NHIF budget moved from draft to promulgated law and the €281.3M correction. This is a
user-visible number changing on a live page; it belongs in the changelog.

---

## T2 — The split-year problem: give the statutory constants a schedule

**This is the one real design decision in the plan.** All three ЗБДОО parameters step
mid-year. `MOD_BY_YEAR` is `Record<number, number>` with a comment conceding it uses "the
value in force for the longer part of the year" — a heuristic that picks Jan–Jul for 2026
and is therefore wrong from August onward, i.e. wrong for every forward-looking use.

**Recommended:** replace the scalar map with a dated schedule and keep `resolveMod`'s
existing contract.

```ts
// Each entry: the value in force FROM this date until the next entry.
export interface StatutoryStep { from: string; value: number } // "2026-08-01"
export const MOD_SCHEDULE: Record<number, StatutoryStep[]> = { … };
```

`resolveMod(year)` keeps returning `{ mod, year, exact }` but gains an optional `asOf` and a
new `steps?: StatutoryStep[]` so a caller can say "€2,112 → €2,300 from 1 Aug". Default
`asOf` = today, so the calculator shows the value actually in force rather than a
whole-year average that matches no month.

*Alternative considered and rejected:* keep the scalar and encode the later step (2,300),
losing Jan–Jul. That silently misstates seven months of 2026 for anyone modelling the year
retrospectively, and the same problem recurs every year the МОД moves mid-year (2022, 2025
already did).

**T2.1** — `src/lib/bgTax.ts`: introduce `StatutoryStep`, `MOD_SCHEDULE`; derive
`MOD_BY_YEAR` from it for back-compatibility (last step of the year) or delete it and
migrate the two call sites.
**T2.2** — extend `resolveMod` with `asOf` + `steps`; keep the year-snapping behaviour and
the `exact` flag exactly as documented (the doc comment about never claiming a year whose
cap it isn't showing is a real invariant — preserve it and extend it to dates).
**T2.3** — same treatment for `MIN_PENSION` and `MIN_SELF_INSURED_INCOME`. `MAX_PENSION`
needs **no schedule**: § 4 ал. 2 sets €1,738.40 for the whole of 2026, matching what we
already hold. Do not restructure it — instead attach the ДВ citation so the next reader knows
it is sourced, not inherited.
**T2.4** — `src/lib/bgTax.test.ts` currently asserts `resolveMod(2025) = {mod: 2112}` and
`resolveMod(2030) → MOD_BY_YEAR[2026]`. Both need updating; add cases for the Aug-2026 step
in both directions and for an `asOf` inside each half-year.
**T2.5** — call sites: `BudgetTaxCalculator.tsx:351`, `BudgetPolicySimulator.tsx:735,1232`.
`MAX_MOD = 4000` already accommodates 2,300, so the slider needs no range change.

**Acceptance:** the calculator's МОД label names the period in force, not just the year; the
simulator's `currentCap` reflects the in-force value.

---

## T3 — Encode the parameters we simply don't have

**T3.1** — `src/lib/bgTax.ts`: add `MIN_PENSION` schedule (T2), plus new constants for the
чл. 11–13 benefits (unemployment daily min/max, child-rearing to age 2, death grant) and the
чл. 15 guaranteed-claims cap. Each with the ДВ citation in a comment, following the existing
provenance-comment convention at the top of the file.
**T3.2** — the ГВРС contribution holiday (чл. 15 ал. 1: no contributions due in 2026) is a
real employer-cost fact. `SSC_EMPLOYER_RATE = 0.1902` does not include ГВРС, so **no rate
change follows** — encode it as a documented note, not a number, and resist the temptation
to adjust the rate.
**T3.3** — update the provenance block at the head of `bgTax.ts`. It currently says "As of
2026-06 there is NO adopted 2026 budget … these values are the in-force law" and points at
the `budget_law` watcher. Both halves are now wrong: the ЗБДОО is adopted, and the
authoritative watcher is `dv_laws`.

---

## T4 — ЗБДОО per-fund plan beside the B1 actual

`data/budget/noi/funds.json` holds cash execution only. The law publishes the plan (§0c),
which gives the NOI funds the same plan-vs-actual axis the state-budget pages already have.

**T4.1** — new generator `scripts/budget/noi/__write_fund_plan.ts` in the hand-keyed
`__write_*.ts` convention (same shape as `nzok/__write_budget.ts`): the чл. 1–8 revenue and
expenditure totals per fund for FY2026, sourced to idMat 244982. Output
`data/budget/noi/fund_plan.json`.
**T4.2** — types in `scripts/budget/types.ts` + `src/data/budget/types.ts` (they are
maintained in parallel — see the `BudgetDocKind` pair).
**T4.3** — hook into `src/data/budget/useBudget.tsx` and surface on
`BudgetSocialFundsTile.tsx` / `BudgetFlowSocialFundsDrilldown.tsx` as a plan marker on the
existing actual bars.

**Caveat to respect:** `funds.json` FY2023 has zero revenue (a parse gap, `complete: false`).
Only render plan-vs-actual for years where the actual side is complete; do not compute a
variance against a zero.

**Non-goal:** back-keying the plan for 2018–2025. One year proves the shape; earlier years
are a separate, larger transcription job and should not gate this.

---

## T5 — Приложение 1А + 2/2А as ingested datasets

The two appendix tables are the genuinely new data. Both are inside the DV HTML we already
fetch and cache for the law text.

**T5.1** — parser `scripts/budget/noi/parse_mod_schedule.ts`: extract Прил. 1 and 1А into
`{ periodFrom, kidCode, kidSection, activityName, byQualificationGroup: number[9] }`.
744 cells per appendix; assert exactly 9 value columns per row and that every value ≥ the
period's floor (550.66 / 620.20) — a row failing either is a parse error, not a data point.
**T5.2** — parser for Прил. 2/2А: 87 activity groups → ТЗПБ rate. Assert the rate set is a
subset of {0.4, 0.5, 0.7, 0.9, 1.1}.
**T5.3** — `data/budget/noi/mod_schedule.json` + `tzpb_rates.json`.
**T5.4** — **only then** consider a UI. The obvious one is a per-sector employer-cost
lookup in the tax calculator ("your industry's legal minimum insurable wage and ТЗПБ rate")
replacing the 0.5% placeholder documented at `bgTax.ts:26-29`. Treat that as a separate
design pass — T5.1–T5.3 stand on their own as sourced data.

**T5.5** — correct `scripts/budget/budget2026_package.ts:147` and `:363`. The "BOTTOM-UP
BLOCKED AT SOURCE" note must be narrowed: the МОД schedule is published, the
affected-worker distribution is not, so the €50.9M figure stays a НОИ microsim we cannot
reproduce — but for a different and smaller reason than the note currently gives.

---

## T6 — The public-sector contribution shift, editorially

Not a constant. An article / tile: civil servants, judges and prosecutors start paying their
own social and health contributions, phased over Aug-2026 → Jan-2027, with the employer
absorbing the shift for five months (§ 5 + § 6 + § 20) so net pay is protected until January.

**Hard requirement:** frame it as a public-sector change. `SSC_EMPLOYEE_RATE` is unchanged
for чл. 4 ал. 1 т. 1 employees, and any copy implying a general contribution hike is factually
wrong. See §0e.

**Blocked-ish:** worth holding until the ЗДБРБ-2026 lands so the piece can describe the whole
package rather than two thirds of it. `dv_laws` will flag it.

---

## Sequencing

```
T1  ──────────────►  ship alone, it is a live correction
T2  ──►  T3         schema first, then the new constants ride it
T4  (independent)
T5.1-5.3 ──► T5.4   data first, UI as a separate design pass
T6  after ЗДБРБ-2026
```

T1 is independently shippable and should not wait for T2. T2 must land before T3 or the new
constants inherit the scalar-per-year defect they were added to avoid.

## Non-goals

- Re-parsing the ЗБНЗОК/ЗБДОО for per-spending-unit appropriations. They appropriate their
  own funds, not first-level spending units — that is why `buildFundLawDocuments` in
  `scripts/budget/documents.ts` catalogues them as provenance with `sources` and no facts.
- Anything on `LAW_DV_MATERIALS`. That is the ЗДБРБ catalogue and 2026 is still correctly
  absent.
- Touching the `budget_law` watcher. `dv_laws` supersedes it as the promulgation signal;
  retiring it is a separate call.

## Risks

| risk | mitigation |
|---|---|
| The line-by-line ЗБНЗОК figures are hand-keyed from a 45k-char HTML render | T1 reconciliation assertion + the generator's existing overshoot throw; the balanced-budget identity (revenue = expenditure = 5,256,677.2) is an independent check |
| Prил. 1/1А parse silently drops or mis-columns rows | T5.1's floor assertion + fixed 9-column check; 744 cells is a hard expected count |
| Someone reads §0e as a general SSC change | The scope caveat is repeated in §0e, T5.4 and T6; state it in code comments too |
| ЗДБРБ-2026 lands mid-implementation and moves these numbers | It cannot — the fund budgets are their own laws. A ЗИД to either would, and `dv_laws` reports ЗИД forms under the same `kind` |
