# Ingest the promulgated 2026 budget package (ЗБДОО + ЗБНЗОК) — v1

**Status:** design, audited against the codebase 2026-07-28. Goal: everything the two
promulgated fund-budget laws publish that we currently guess, show as a draft, or don't hold
at all becomes sourced data — and the one figure we are currently overstating on a live page
gets corrected.

**Audit outcome — read before implementing.** Every file/line anchor below was verified.
Four things were not implementable as first drafted and are now folded in:

| # | finding | lands in |
|---|---|---|
| 1 | §0a's ЗБНЗОК line list leaves **€146.1M unaccounted** — it drops чл. 1 ал. 2 т. 1.6, the line the generator carries as `devices_hospital`. T1 would have silently swept it into the reserve residual | §0a box, **T1.0**, T1.2 |
| 2 | §0f.1's "reserve −362.0M" contradicts T1.2's own residual design — that number can never appear on the tile | §0f.1 |
| 3 | T5's "the DV HTML we already fetch and cache" is false; nothing fetches the fund laws, and `fetchLawHtml`'s cache key is the **fiscal year**, so the two idMats would overwrite each other | **T5.0** |
| 4 | T2.5 listed 2 call sites; there are **8**, four in `scripts/` — including the generator that bakes `policy_baseline.json`. The `__smoke_*` gates that would catch a regression are outside `test:unit` | T2.1, T2.5 |

Smaller corrections carried below: "744 cells" is not divisible by 9 (§0d); T5.1's floor
assertion would throw on valid data (T5.1); §0c's parts sum *exactly*, so the ДОО total is
gross, not consolidated (§0c, T4); `/pensions` holds a second, 2024-BGN copy of the very
constants T3 sources (**T3.4**); and the three new artifacts need `/data`-map entries.

**Second audit pass, 2026-07-28 (post-addendum).** The Addendum records the operator's
`MOD_BY_YEAR[2026] = 2300` decision but was not itself an ingest — no data or code changed.
Three further findings, all folded in:

| # | finding | lands in |
|---|---|---|
| 5 | **T1 ships nothing without a `bucket:sync`.** `data/budget` is bucket-served in production via `dataUrl()`; A3 said "committed JSON only", which is true for T2/T3 and false for T1 | **T1.4a**, **A4** |
| 6 | **Nothing detects the 2112 → 2300 repricing.** `__smoke_mod_identity.ts` reads `YEAR = 2024` and never touches the 2026 key; the Vitest `resolveMod` cases are written relative to the map, so they follow the change instead of catching it | A2.3, A2.4 |
| 7 | **`capBaselineEur` is a latent coupling, not an absent one.** `baselineYear` is `revenueYears[last]`, so it is 2025 today and becomes 2026 when the FY2026 КФП completes — repricing the incidence model months later, disconnected from this change | A2.2 |

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
лекарства/изделия/храни (т. 1.5) 1,334,348.5k (of which ПЛС 1,264,322.9k) · БМП
2,307,171.5k · други плащания 49,317.3k · персонал 48,157.8k · издръжка 17,709.1k ·
нефинансови активи 2,068.7k · резерв 154,148.1k · МЗ трансфери 101,490.7k. чл. 2 fixes the
health contribution at **8%**.

> **⚠ This transcription is INCOMPLETE and T1 is blocked on completing it.** The lines above
> sum to 4,852,863.7k (care + admin); add the three residual components (154,148.1 + 2,068.7
> + 101,490.7 = **257,707.5k**) and the total is 5,110,571.2k against a 5,256,677.2k
> headline — **146,106.0k unaccounted**.
>
> The cause is a missing line, not a mis-key: чл. 1 ал. 2 **т. 1.6 „медицински изделия,
> прилагани в болничната медицинска помощ"** is a line of its own, distinct from т. 1.5
> above. The generator already carries it as `devices_hospital`
> ([__write_budget.ts:114](../../scripts/budget/nzok/__write_budget.ts)), 114,587.8k in the
> draft. There may be a second small line in the same position.
>
> **Before T1.1, re-read чл. 1 ал. 2 from idMat 244981 and key every т. 1.x explicitly.**
> Implementing T1.1 against the list as it stands would drop a visible bar from the bridge
> tile and sweep €146.1M into the reserve residual without tripping the generator's overshoot
> throw (which only fires when named lines *exceed* the total).

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

**The parts sum to 15,265,782.4 exactly — and that is the finding, not a validation.** A
genuinely *consolidated* total eliminates inter-fund transfers, so parts would exceed it. An
exact sum means the 15,265,782.4 line is a gross arithmetic total. Two constraints on T4
follow: do not label it „консолидиран бюджет на ДОО", and do not put it in variance against
the B1 **actual**, which *is* consolidated — the variance would be structurally wrong, not
just imprecise. Separately, the €6,610,463.3 „НОИ" line is 43% of the total and is not a peer
of „Пенсии"; it must not render as an equal bar beside the funds.

### 0d. ЗБДОО appendices — two tables we do not hold in any form

Measured from the promulgated text:

| appendix | shape | finding |
|---|---|---|
| Прил. 1 (1 Jan – 31 Jul) | КИД-2025 activity × 9 qualification groups, 744 МОД cells | only **2.2% above** the €550.66 floor, max €901.41 — the frozen carryover |
| Прил. 1А (1 Aug – 31 Dec) | same shape, 744 cells | **66.9% above** the €620.20 floor, max €1,532.00 — a genuinely renegotiated schedule |
| Прил. 2 / 2А | 87 economic-activity groups | ТЗПБ contribution rate ∈ {0.4, 0.5, 0.7, 0.9, 1.1}% |

> **⚠ "744 cells" cannot be right as stated:** 744 ÷ 9 = 82.67. Either 744 is the *row*
> (activity) count — in which case the cell count is 6,696 — or the 9-column claim is wrong.
> T5.1 and the Risks table below turn this into a hard assertion, so **resolve which it is
> against the promulgated text before writing the parser**, and record both numbers (rows and
> rows × 9) so the assertion has two independent handles.

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
   at `/awarder/121858220`. Per-line: БМП −52.7M, ПИМП −3.7M, dental −2.5M, СИМП −1.2M,
   personnel −3.5M, издръжка −0.3M, drugs (т. 1.5) +2.3M, diagnostics +0.8M, други плащания
   +6.5M, `devices_hospital` **unknown until §0a is completed**.

   **The reserve line does not move −362.0M.** That figure differences the draft *residual*
   (5,537,996.9 − 5,021,850.2 = 516,146.7k) against the law's *named* reserve (154,148.1k) —
   but the tile renders the residual, which T1.2 keeps. The bar actually moves 516,146.7 →
   257,707.5 (**−258.4M**) once §0a is complete, or → 403,813.5 (−112.3M) if it is
   implemented as currently transcribed. Do not publish −362.0M in the T1.5 changelog entry.
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

**Highest value. Do this first and alone — but it is NOT zero-risk: it is blocked on T1.0.**

**T1.0 (blocking)** — complete the §0a transcription. Re-read чл. 1 ал. 2 from idMat 244981
and key **every** т. 1.x sub-line, including т. 1.6 „медицински изделия, прилагани в
болничната медицинска помощ". As transcribed, §0a leaves 146,106.0k unexplained; T1.1 must
not be started until the named lines plus the three residual components reconcile to
5,256,677.2k. See the warning box in §0a.

**T1.1** — `scripts/budget/nzok/__write_budget.ts`: rewrite `YEARS[0]` (FY2026) from the
promulgated чл. 1 ал. 2 table. `basis: "draft"` → `"law"`, `totalK: 5_537_996.9` →
`5_256_677.2`, and every `k` from §0a. Update the file header comment: source becomes
"ЗБНЗОК 2026 (обн. ДВ бр. 68 от 28.07.2026, idMat 244981)" replacing "проект, приет от
Надзорния съвет 29.10.2025 / nhif.bg/upload/29401".

**T1.2** — Decide the `reserve` residual. The law names резерв (154,148.1k), нефинансови
активи (2,068.7k) and МЗ трансфери (101,490.7k) separately; our `reserve` line is a computed
residual labelled "Резерв, трансфери и капиталови разходи", which is exactly those three.
Keep the residual mechanism (it guarantees reconciliation) and verify it lands at
**257,707.5k** (154,148.1 + 2,068.7 + 101,490.7) ± rounding.

Make this a **hard assertion, not a soft log.** The generator's existing throw only fires
when the named lines *exceed* the total, so an under-keyed table — exactly the §0a defect —
passes silently and inflates the reserve bar by the shortfall. A residual that misses
257,707.5k by more than a rounding euro means a line is missing or mis-keyed; throw with the
drift in the message. This assertion is the only thing standing between a dropped sub-line
and a silently absorbed nine-figure error on a live page.

**T1.3** — Update `source.description` in the generator's output header: FY2026 is no longer
"проект … суми в евро" but "обн. закон". The tile's `basisLabel` already switches on
`year.basis`, so the visible "(проект)" → "(закон)" follows with no component change.

**T1.4** — `npx tsx scripts/budget/nzok/__write_budget.ts`, confirm the reconciliation echo
prints drift €0 for both years.

**T1.4a** — `npm run bucket:sync:paths -- budget`. **Without this T1 corrects the number only
on localhost** — `data/budget` is bucket-served in production. See A4 for why; do not treat it
as optional or as a follow-up.

**Acceptance:** `/awarder/121858220` shows €5.26bn labelled "закон", composition sums to the
headline, no component edited — verified **on the deployed site**, not just in `npm run dev`,
since that is the only way to tell T1.4a actually ran.

**Tests:** extend the generator's existing reconciliation echo into a real assertion, or add
`scripts/budget/nzok/__smoke_budget.ts` in the `__smoke_*` convention asserting (a) FY2026
total = 5_256_677_200, (b) Σ lines = total for every year, (c) FY2026 `basis === "law"`,
(d) the FY2026 residual = 257,707,500 ± rounding, and (e) the FY2026 line-id set is a
superset of FY2025's — the check that would have caught `devices_hospital` disappearing.

**T1.5** — `npx tsx scripts/append-data-change.ts` (skill `update-nzok`) noting the 2026
NHIF budget moved from draft to promulgated law and the €281.3M correction. This is a
user-visible number changing on a live page; it belongs in the changelog. Use the corrected
per-line deltas from §0f.1 — **not** the −362.0M reserve figure.

**T1.6** — amend [`update-nzok/SKILL.md:29`](../../.claude/skills/update-nzok/SKILL.md). It
says `budget.json` is re-run "only when a new fiscal year's law is added" — a draft→law flip
for an existing year is exactly what T1 does and the skill text does not cover it. Add the
case, and name the `dv_laws` watcher's `ЗБНЗОК` describe-line as its trigger.

---

## T2 — The split-year problem: give the statutory constants a schedule

> **DECIDED 2026-07-28 (operator): `MOD_BY_YEAR[2026] = 2300`** — the latest official value,
> keyed to 2026 rather than deferred to a 2027 row. This **overrides T2.1's "derive from the
> FIRST step of the year" back-compatibility rule**, which would have kept 2026 at 2112. The
> dated `MOD_SCHEDULE` below is unaffected and still wanted; what changes is which step the
> back-compat scalar reads. See the Addendum for the consequences an implementer must absorb —
> in particular, the scalar map is **no longer byte-identical**, so the four `scripts/` call
> sites in T2.5 reprice and the "silently reprices the fiscal baseline" risk row is now live
> rather than mitigated.

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
`MOD_BY_YEAR` from it for back-compatibility, or delete it and migrate the call sites (see
T2.5 — there are eight, not two).

**Derive from the FIRST step of the year, not the last.** "Last step" flips
`MOD_BY_YEAR[2026]` from 2112 to 2300 for every existing consumer at once; "first step"
reproduces today's exact values for every year in the table, making the derivation a true
no-op and confining the behaviour change to the call sites that opt into `asOf`. The
back-compat map must be back-compatible or it is not worth having.

**T2.2** — extend `resolveMod` with `asOf` + `steps`; keep the year-snapping behaviour and
the `exact` flag exactly as documented (the doc comment about never claiming a year whose
cap it isn't showing is a real invariant — preserve it and extend it to dates).

**Do not default `asOf` to `new Date()`.** The plan's original recommendation ("default
`asOf` = today") has three costs that outweigh the convenience:

- `src/lib/bgTax.test.ts` becomes time-dependent — the suite's result changes on 1 Aug 2026
  with no code change.
- [`BudgetPolicySimulator.tsx:1232-1234`](../../src/screens/components/budget/BudgetPolicySimulator.tsx)
  derives `modMin`/`modMax` from `currentCap`; `:1323` clamps `?mod` into that window and
  `:1627` writes `?mod` only when it differs from `currentCap`. A today-defaulted cap shifts
  the slider window €188 overnight, so a **shared scenario permalink changes meaning across
  the date boundary** — links near the old floor clamp silently, and `?mod=2112` starts
  serialising as an explicit param.
- The scripts in T2.5 bake values into artifacts; a wall-clock default makes those artifacts
  non-reproducible.

Instead: `resolveMod(year, asOf?)` where **omitting `asOf` preserves today's year-scalar
semantics** (first step of the year). Callers that want in-force-now pass an explicit date.
Every `scripts/` call site passes an explicit `asOf` or stays on the scalar.

*Non-issue, stated so an implementer does not "fix" it:* the МОД lever's neutrality is safe
regardless of `currentCap`, because
[`BudgetPolicySimulator.tsx:461`](../../src/screens/components/budget/BudgetPolicySimulator.tsx)
passes `s.currentCap` as `scoreModCap`'s `fromCapEur`, so `mod === currentCap` scores zero by
construction. The baked baseline's own `earnings.capEur` (2112, `baselineYear: 2025`) is a
separate anchor and is not disturbed.

**T2.3** — same treatment for `MIN_PENSION` and `MIN_SELF_INSURED_INCOME`. `MAX_PENSION`
needs **no schedule**: § 4 ал. 2 sets €1,738.40 for the whole of 2026, matching what we
already hold. Do not restructure it — instead attach the ДВ citation so the next reader knows
it is sourced, not inherited.
**T2.4** — `src/lib/bgTax.test.ts` currently asserts `resolveMod(2025) = {mod: 2112}` and
`resolveMod(2030) → MOD_BY_YEAR[2026]`. Both need updating; add cases for the Aug-2026 step
in both directions and for an `asOf` inside each half-year. Add an explicit test that the
**no-`asOf` path is time-independent** (it must return 2112 for 2026 whenever it runs).

**T2.5** — call sites. There are **eight**, and four are in `scripts/`:

| file | usage | note |
|---|---|---|
| [BudgetTaxCalculator.tsx:351](../../src/screens/components/budget/BudgetTaxCalculator.tsx) | `resolveMod(fiscalYear)` | the one surface that should show the step |
| [BudgetPolicySimulator.tsx:735,1232](../../src/screens/components/budget/BudgetPolicySimulator.tsx) | `resolveMod(null)` | see the URL-contract note in T2.2 |
| [run_policy_baseline.ts:791,836](../../scripts/budget/run_policy_baseline.ts) | `MOD_BY_YEAR[napYear]`, `MOD_BY_YEAR[baselineYear]` | **bakes `capBaselineEur` into `policy_baseline.json`** |
| [nap_income_tiers.ts:176](../../scripts/budget/nap_income_tiers.ts) | `MOD_BY_YEAR[NAP_TABLE_YEAR]` | NAP tier calibration |
| [__smoke_mod_identity.ts:76,92](../../scripts/budget/__smoke_mod_identity.ts) | `MOD_BY_YEAR[YEAR]`, `[2024]`, `[2025]` | the МОД identity gate itself |
| [__smoke_earnings.ts:88](../../scripts/budget/__smoke_earnings.ts) | `MOD_BY_YEAR[2025]` | |
| [__smoke_behavioral.ts:99](../../scripts/budget/__smoke_behavioral.ts) | `resolveMod(null)` | |
| [budget2026_package.ts](../../scripts/budget/budget2026_package.ts) | see T5.5 | |

**The `__smoke_*` gates are tsx scripts, not Vitest** — they do not run in
`npm run test:unit`, so CI catches nothing here. Re-run them by hand as part of T2 and say so
in the acceptance criteria. `MAX_MOD = 4000` already accommodates 2,300, so the slider needs
no range change.

**Acceptance:** the calculator's МОД label names the period in force, not just the year; the
simulator's `currentCap` reflects the in-force value; `MOD_BY_YEAR` is byte-identical to its
pre-change values for every year; `__smoke_mod_identity.ts`, `__smoke_earnings.ts` and
`__smoke_behavioral.ts` re-run green.

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

**T3.4 — consolidate the second, stale copy of these constants.** `bgTax.ts` has exactly two
importers, both under `src/screens/components/budget/` (the calculator and the simulator).
`/pensions` does **not** use it:
[`PensionReplacementTile.tsx:42-48`](../../src/screens/pensions/PensionReplacementTile.tsx)
hardcodes its own **2024 BGN** statutory values — min wage 933 лв, МОД 3750 лв (€1,917),
таван на пенсиите 3400 лв (€1,738.40) — and re-implements the КСО formula that
`computePension` already encodes.

So the min/max pension this task is sourcing already has a live home, two years stale and
denominated in a currency the site retired on 2026-01-01. Point that tile at the schedule
rather than adding a third copy. **Without T3.4 the plan makes the divergence worse**: T3.1
would put a correct, sourced `MIN_PENSION` schedule in a library that `/pensions` cannot see,
while `/pensions` keeps rendering 580 лв.

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

**T4.4** — register `data/budget/noi/fund_plan.json` in
[`scripts/data_map/model.ts`](../../scripts/data_map/model.ts). `data/budget/noi/pensions.json`
is there; a new sibling artifact that is not is invisible on the site's own `/data` map.

**Caveat to respect:** `funds.json` FY2023 has zero revenue (a parse gap, `complete: false`).
Only render plan-vs-actual for years where the actual side is complete; do not compute a
variance against a zero.

**Second caveat — the basis mismatch (see §0c).** The чл. 1 total is a gross arithmetic sum;
the B1 actual is consolidated. Putting them on one axis without stating that is a
structurally wrong variance, not a rounding one. Either restrict plan-vs-actual to the
per-fund pairs (where both sides are gross) and omit the consolidated row, or label the
headline explicitly as „сбор на фондовете", never „консолидиран". And do not render the
€6.61bn „НОИ" line as a bar beside „Пенсии" — it is 43% of the total and not the same kind
of thing.

**Non-goal:** back-keying the plan for 2018–2025. One year proves the shape; earlier years
are a separate, larger transcription job and should not gate this.

---

## T5 — Приложение 1А + 2/2А as ingested datasets

The two appendix tables are the genuinely new data. They live in the DV HTML for the two
idMats — which, contrary to this plan's first draft, **we do not currently fetch or cache**.

**T5.0 (blocking, and invisible in the original plan)** — make the fund-law HTML fetchable
and cacheable.

Nothing calls [`fetchLawHtml`](../../scripts/budget/fetch_sources.ts) with a
`FUND_BUDGET_LAWS` idMat; that catalogue holds URLs only
([`buildFundLawDocuments`](../../scripts/budget/documents.ts) emits `sources` and no facts),
and `raw_data/budget/` has no cache entry for 244981, 244982, or 2026 at all.

Worse, the cache key is **`law-${fiscalYear}.html.gz` — keyed by fiscal year, not idMat**. As
written, `fetchLawHtml(2026, "244982")` and `fetchLawHtml(2026, "244981")` overwrite each
other, and both would later collide with the ЗДБРБ-2026 when it lands. Re-key to
`law-${idMat}.html.gz` (with a migration for the existing `law-YYYY.html.gz` files) or add a
separate `fetchFundLawHtml`. Decide which before T5.1 — a silent cache collision between two
laws would be very hard to spot downstream.

**T5.1** — parser `scripts/budget/noi/parse_mod_schedule.ts`: extract Прил. 1 and 1А into
`{ periodFrom, kidCode, kidSection, activityName, byQualificationGroup: number[9] }`.
**Throw** on the structural checks — exactly 9 value columns per row, and the expected row
count (resolve the 744 rows-vs-cells ambiguity flagged in §0d first).

**Do not throw on the floor check.** §0d's own finding is that only 2.2% of Прил. 1 sits
*above* €550.66, i.e. 97.8% is at or below it; the МОД annex has historically lagged the МРЗ
for some activity/qualification cells. A `value < floor` row is a legitimate data point that
matters editorially — count and log it, and surface the count in the output so the "is the
floor binding?" question stays answerable from the data.

**T5.2** — parser for Прил. 2/2А: 87 activity groups → ТЗПБ rate. Assert the rate set is a
subset of {0.4, 0.5, 0.7, 0.9, 1.1}.
**T5.3** — `data/budget/noi/mod_schedule.json` + `tzpb_rates.json`. Register both in
[`scripts/data_map/model.ts`](../../scripts/data_map/model.ts).

**T5.3a** — revise the two places that assert we parse nothing from fund-law HTML, because
after T5.1 that is false: the comment block above `FUND_BUDGET_LAWS`
([`fetch_sources.ts:149`](../../scripts/budget/fetch_sources.ts)) and the `notes` string in
[`buildFundLawDocuments`](../../scripts/budget/documents.ts) ("no per-spending-unit tables
are parsed; catalogued for provenance"). The *per-spending-unit* half stays true — the
appendices are not appropriations — so narrow the wording rather than deleting it.
**T5.4** — **only then** consider a UI. The obvious one is a per-sector employer-cost
lookup in the tax calculator ("your industry's legal minimum insurable wage and ТЗПБ rate")
replacing the 0.5% placeholder documented at `bgTax.ts:26-29`. Treat that as a separate
design pass — T5.1–T5.3 stand on their own as sourced data. See T7.3 for the fuller shape
and for the one join that is **not** currently possible.

**T5.5** — correct `scripts/budget/budget2026_package.ts:147` and `:363`. The "BOTTOM-UP
BLOCKED AT SOURCE" note must be narrowed: the МОД schedule is published, the
affected-worker distribution is not, so the €50.9M figure stays a НОИ microsim we cannot
reproduce — but for a different and smaller reason than the note currently gives.

---

## T6 — The public-sector contribution shift

**Revised: a taxpayer profile first, the article second.**

The original framing was an article/tile. But `TaxpayerProfile` is already
`"employee" | "self" | "company"`, and the calculator already renders exactly this shape — a
payslip with an employee/employer split. Adding a fourth profile, `"civil-servant"`, with the
§ 6 pension phasing (11.8/3.0 from 1 Aug 2026, 8.22/6.58 from 1 Jan 2027), the § 20 health
80:20 and the § 5 universal-pension 4/1 for Aug–Dec, answers "what changes on my payslip in
August, and again in January" for the several hundred thousand people it actually affects.

That is strictly better than prose, and it also **enforces the scope caveat structurally**:
the default `"employee"` profile is untouched by construction, which is a far stronger
guarantee than the plan's current strategy of repeating a warning in three places. The
article then links to the calculator rather than carrying the burden alone.

**Hard requirement (unchanged):** frame it as a public-sector change. `SSC_EMPLOYEE_RATE` is
unchanged for чл. 4 ал. 1 т. 1 employees, and any copy implying a general contribution hike is
factually wrong. See §0e.

**What is actually blocked:** only the *article*, and only if it wants to describe the whole
package — worth holding until the ЗДБРБ-2026 lands. `dv_laws` will flag it. The profile is
not blocked: both laws that set these rates are promulgated.

---

## T7 — Surfaces (folded in from the UI/UX pass)

T1–T5 produce sourced numbers; without T7 most of them land in a library nobody renders.
None of these is required to ship T1.

**T7.1 — `<StatutoryValue>` chip.** Every value in this package is a dated statutory fact
with a ДВ citation, and nothing on the site renders that. One shared chip —
`€620.20 · от 01.08.2026 · ДВ бр. 68/2026`, linking the idMat — used wherever a constant
appears. minfin and НОИ publish numbers; per-value provenance is the differentiator, and it
is a small component.

**T7.2 — a stepped rail, not a scalar.** The whole package is date-stepped and the site has
no way to say "this changed on 1 Aug". A horizontal year rail with step markers (before /
after / % change, citation on hover), reused by the calculator's МОД label, `/pensions`, and
`BudgetJourneyTile`. This is T2's schema earning its keep visually.

**T7.3 — `/budget/mod`, the browser for Прил. 1А.** The single highest-value payload in the
package and the one with no home: КИД-2025 activity × 9 qualification groups answers "what is
the legal minimum insurable wage for *my* job", and the schedule genuinely renegotiated
(2.2% → 66.9% of cells above the floor). Pick industry → pick qualification group → floor
Jan–Jul vs Aug–Dec, plus the ТЗПБ rate from Прил. 2, which is what replaces the 0.5%
placeholder in T5.4. Deep-link `?kid=…&q=…`.

> **The obvious follow-on is blocked.** "This company's own floor and ТЗПБ rate on
> `/company/:eik`" needs an EIK→КИД mapping, and
> [`tr_companies`](../../scripts/db/schema/pg/003_tr_search.sql) has no NACE/КИД column —
> nor does anything else in the corpus. Scope that as its own ingest; do not assume it.

**T7.4 — keep the draft, don't overwrite it.** We hold both sides of the ЗБНЗОК: the Надзор
asked for a €516M reserve and Parliament left €154M. `basis: "draft" | "law"` is already in
the type, so the bridge tile can render проект→закон as a diff wherever both exist. T1 as
written deletes the more interesting half of the story; consider keeping the draft as a
sibling year-entry instead of replacing it.

**T7.5 — the five numbers people search for, on `/pensions`.** Rides T3.4: min pension
322.37 → 347.51 (1 Jul), max 1,738.40 (unchanged, now sourced), unemployment €9.21–54.78/day,
child-rearing €398.81, death grant €276.10 — in EUR with citations, replacing the stale 2024
BGN hardcodes. A strip, not a project.

**T7.6 — a "2 of 3" completeness meter on `BudgetJourneyTile`.** FY2026's journey is
genuinely unusual: bridging law (Dec 2025) → ЗИД (Mar 2026) → two fund laws (Jul 2026) →
ЗДБРБ still absent. The data is already in `documents.json`; the meter is a rendering change
that directly serves §0's warning never to say "the 2026 budget".

---

## Sequencing

```
T1.0 ──► T1          T1.0 is a re-read of чл. 1 ал. 2; T1 cannot ship without it
T2  ──►  T3 ──► T3.4 schema, then constants, then the /pensions consolidation
T4  (independent)
T5.0 ──► T5.1-5.3 ──► T5.4   cache key, then parsers, then UI
T6  profile now; article after ЗДБРБ-2026
T7  any time after the task it renders
```

T1 is independently shippable — **but only after T1.0**. It should not wait for T2. T2 must
land before T3 or the new constants inherit the scalar-per-year defect they were added to
avoid; T3.4 must land with T3 or `/pensions` keeps rendering 2024 лв beside a correct library.

## Non-goals

- Re-parsing the ЗБНЗОК/ЗБДОО for per-spending-unit appropriations. They appropriate their
  own funds, not first-level spending units — that is why `buildFundLawDocuments` in
  `scripts/budget/documents.ts` catalogues them as provenance with `sources` and no facts.
  (T5 does parse the *appendices* from that HTML, which is why T5.3a narrows the wording;
  the per-spending-unit non-goal is unaffected.)
- Anything on `LAW_DV_MATERIALS`. That is the ЗДБРБ catalogue and 2026 is still correctly
  absent — the two 2026 rows in `fetch_sources.ts` are `INTERIM_BUDGET_LAWS` (the bridging
  law and its ЗИД), not ЗДБРБ entries.
- Touching the `budget_law` watcher. `dv_laws` supersedes it as the promulgation signal;
  retiring it is a separate call.
- An EIK→КИД ingest. See the blocked note in T7.3 — it is a real gap, but its own project.

## Risks

| risk | mitigation |
|---|---|
| The line-by-line ЗБНЗОК figures are hand-keyed from a 45k-char HTML render | **This already bit once — §0a dropped т. 1.6 and lost €146.1M.** T1.2's hard residual assertion + the T1 smoke's line-id-superset check are the mitigations; the generator's overshoot throw is NOT one, since it only catches over-keying. The balanced-budget identity (revenue = expenditure = 5,256,677.2) is an independent check |
| A missing line silently inflates the reserve residual instead of failing | T1.2 asserts the residual equals 257,707.5k, so an under-keyed table throws rather than absorbing the shortfall into a bar labelled "Резерв, трансфери и капиталови разходи" |
| Prил. 1/1А parse silently drops or mis-columns rows | Fixed 9-column check + an expected row count — **after** resolving the 744 rows-vs-cells ambiguity (§0d). The floor check is a counter, not an assertion (T5.1) |
| Two fund laws overwrite each other in the HTML cache | T5.0: `fetchLawHtml`'s key is `law-${fiscalYear}`, so both idMats collide today. Re-key before T5.1 |
| A `MOD_BY_YEAR` derivation silently reprices the fiscal baseline | T2.1 derives from the *first* step of the year, making the map byte-identical. The `__smoke_*` gates that would catch a regression are tsx scripts outside `test:unit` — re-run them by hand (T2.5) |
| A shared `/budget/simulator` permalink changes meaning on 1 Aug | T2.2: no wall-clock default for `asOf`; the no-`asOf` path stays year-scalar and time-independent |
| Someone reads §0e as a general SSC change | The scope caveat is repeated in §0e, T5.4 and T6, and stated in code comments — but the real mitigation is T6's separate `"civil-servant"` profile, which leaves the default employee path untouched by construction |
| ЗДБРБ-2026 lands mid-implementation and moves these numbers | It cannot — the fund budgets are their own laws. A ЗИД to either would, and `dv_laws` reports ЗИД forms under the same `kind` |

---

## Addendum — 2026-07-28 orchestrator run (`/process-watch-report`)

The `dv_laws` watcher flipped at `2026-07-28T18:45Z` (`бр. 68 · 12 акта в официалния раздел ·
нови: ЗБДОО, ЗБНЗОК`), which is what queued `update-budget` and produced this addendum. The
ingest side of that queue entry was **not** run — no data was written, no marker stamped, so
`dv_laws` re-surfaces on the next orchestrator run until this plan lands.

### A1. §0b independently corroborated

§0b was keyed from the promulgated ДВ text. Every parameter was re-checked against sources
that do not share that reading; all nine agree, and the ДВ RSS confirms брой 68 carries
exactly the two fund laws and **no ЗДБРБ** (so the `LAW_DV_MATERIALS` non-goal holds).

| parameter | §0b | corroboration | verdict |
|---|---|---|---|
| МОД cap → €2,300 from 1 Aug | ✔ | kik-info, 24 часа, 3e-news | confirmed, incl. the 1 **Aug** date (not 1 Jul, as some coverage has it) |
| min insurable, self-insured → €620.20 from 1 Aug | ✔ | kik-info, 3e-news | confirmed |
| min pension ОСВ → €347.51 from 1 Jul | ✔ | МТСП (ministry statement), banker.bg, forbes.bg | confirmed. **The €346.87 figure in circulation is the draft**; the adopted value is €347.51 |
| max pension €1,738.40 whole year | ✔ | kik-info | confirmed — validates the carried-over constant |
| child-rearing to age 2 €398.81, no increase | ✔ | kik-info | confirmed |
| ordinary-employee SSC rates unchanged | ✔ | kik-info ("без промяна"), 24 часа | confirmed — **the previously-drafted +2pp pension contribution was dropped**, which is why §0e's scope caveat is load-bearing rather than defensive |

### A2. The `MOD_BY_YEAR[2026] = 2300` decision — what it costs

The operator chose the latest official value over T2.1's byte-identical derivation. That is a
legitimate call (the scalar is read as "the cap now" far more often than "the cap averaged
over the fiscal year"), but it is **not free**, and T2's acceptance criteria were written
assuming the opposite. An implementer must handle all of this in the same change:

1. **The acceptance line "`MOD_BY_YEAR` is byte-identical to its pre-change values for every
   year" is void.** Replace it with an explicit expected-diff: exactly one key moves,
   `2026: 2112 → 2300`.
2. **[`run_policy_baseline.ts:791,836`](../../scripts/budget/run_policy_baseline.ts) bakes
   `capBaselineEur` into `policy_baseline.json`.** *(Resolved 2026-07-28 — the answer is
   "both, in sequence".)* Today it does **not** reprice:
   [`policy_baseline.json`](../../data/budget/derived/policy_baseline.json) carries
   `baselineYear: 2025` and `earnings.capEur: 2112`.

   But [`:737`](../../scripts/budget/run_policy_baseline.ts) is
   `const baseline = revenueYears[revenueYears.length - 1]` — the latest *complete* КФП year,
   resolved at runtime and not pinned. When FY2026 completes and `budget:ingest` runs,
   `baselineYear` becomes 2026, `capBaselineEur` silently becomes 2300, and the incidence
   model reprices **months after this change ships, with nothing in the history connecting
   the two**. A latent coupling, not an absent one. Pin `capBaselineEur` explicitly, or add
   it to the generator's self-validating drift gate ([`:887`](../../scripts/budget/run_policy_baseline.ts),
   the >12% VAT-calibration spread — that gate does exist and is the right place).
3. **Nothing currently fails — that is the problem.** *(Corrected 2026-07-28; the list below
   replaces the earlier claim that `__smoke_mod_identity.ts` would catch this.)* The `__smoke_*`
   gates are tsx scripts outside `test:unit`, so CI sees none of them — and of the three, two
   never read the 2026 key at all:

   | gate | reads | affected? |
   |---|---|---|
   | [`__smoke_mod_identity.ts`](../../scripts/budget/__smoke_mod_identity.ts) | `const YEAR = 2024` (`:35`), plus `MOD_BY_YEAR[2024]`/`[2025]` (`:92-93`) | **no** — it never touches 2026 |
   | [`__smoke_earnings.ts:88`](../../scripts/budget/__smoke_earnings.ts) | `MOD_BY_YEAR[2025]` | **no** |
   | [`__smoke_behavioral.ts:99`](../../scripts/budget/__smoke_behavioral.ts) | `resolveMod(null)` → 2300 | **yes** — the only affected script gate |

4. **The Vitest suite keeps passing too.** All four `resolveMod` cases in `bgTax.test.ts` are
   written *relative to the map* — `MOD_BY_YEAR[latest]` (`:38`), `MOD_BY_YEAR[2026]` (`:62`)
   — so they follow the change by construction rather than detecting it. The only literal
   assertions are `:50-52` (2025 / 2018 / 2022), all untouched.

   **So the 2112 → 2300 repricing is invisible to every gate, in CI and out.** A2 is a list of
   consequences with no detector in it. Add one in the same change: a literal pin
   `expect(MOD_BY_YEAR[2026]).toBe(2300)` **and** an assertion on `resolveMod(null).mod`,
   since that is the exact value both production call sites read.
5. **The T2.2 permalink hazard becomes immediate rather than dated.** The plan's mitigation
   was "no wall-clock default, so the slider window does not shift on 1 Aug". With the scalar
   itself at 2300, `currentCap` moves €188 **on deploy** — so `modMin`/`modMax`
   ([BudgetPolicySimulator.tsx:1232](../../src/screens/components/budget/BudgetPolicySimulator.tsx))
   shift once, at release, and existing `?mod=` permalinks near the old floor clamp then. This
   is a one-off rather than a recurring boundary problem, but it should be a deliberate
   release note, not a surprise.
6. **Jan–Jul 2026 is now the period the scalar misstates.** That is the cost the plan named
   when it rejected this option ("silently misstates seven months of 2026 for anyone
   modelling the year retrospectively"). The dated `MOD_SCHEDULE` (T2.1) is what makes it
   recoverable — so the schedule is now **more** load-bearing, not less. Do not ship the
   scalar bump without it.

### A3. Not required by this flip (checked, so nobody re-derives it)

- **No `run_policy_baseline.ts` re-run is triggered by the promulgation itself.** The
  generator reads the КФП/НАП/Eurostat inputs, none of which moved; it consumes `MOD_BY_YEAR`
  but does not track ЗБДОО. It only needs re-running if A2.2 shows the baked
  `capBaselineEur` actually moves.
- **No `fetch_sources.ts` catalogue edit.** Confirmed against the ДВ RSS: брой 68 has no
  ЗДБРБ, so the `LAW_DV_MATERIALS` non-goal is intact and the two 2026 rows remain
  `INTERIM_BUDGET_LAWS`.
- ~~**No `bucket:sync` / Cloud SQL step.** T1–T3 are code and committed JSON only.~~
  **WRONG — corrected 2026-07-28. See A4.**

### A4. T1 needs a `bucket:sync` or it ships nothing

A3's original third bullet said T1–T3 are "code and committed JSON only". That is true for
T2/T3 — `bgTax.ts` is bundled into the app — and **false for T1**.

`data/budget` is a bucket-synced subtree: it is the worked example in the header of
[`bucket_sync_paths.ts`](../../scripts/bucket_sync_paths.ts) (`npm run bucket:sync:paths --
prices myarea budget`), measured there at 63 s. And
[`useBudget.tsx:92`](../../src/data/budget/useBudget.tsx) fetches through `dataUrl()`, which
in production resolves against `VITE_DATA_BASE_URL` — the CDN-fronted GCS bucket, **not** the
Firebase deploy. `data/` is mounted at the dev root by Vite's `serve-data-dir` plugin, which
is why the generator's header comment describes the dev path and says nothing about prod.

So committing the corrected `budget.json` changes nothing a visitor sees. Add to T1, after
T1.4 and before T1.5:

```bash
npm run bucket:sync:paths -- budget
```

**This is the whole point of T1.** The task exists to correct a live €281.3M overstatement;
without the sync it corrects it only on localhost. Treat the sync as part of the acceptance
criterion, not as a follow-up — and note that a 63 s sync of the whole `budget` subtree also
republishes anything else uncommitted-but-generated under `data/budget/`, so run it from a
clean tree.
