# Ingest the promulgated 2026 budget package (ЗБДОО + ЗБНЗОК) — v1

**Status:** design, audited against the codebase 2026-07-28. Goal: everything the two
promulgated fund-budget laws publish that we currently guess, show as a draft, or don't hold
at all becomes sourced data — and the one figure we are currently overstating on a live page
gets corrected.

**Audit outcome — read before implementing.** Every file/line anchor below was verified.
Four things were not implementable as first drafted and are now folded in:

| # | finding | lands in |
|---|---|---|
| 1 | §0a's ЗБНЗОК line list leaves **€146.1M unaccounted** — it drops чл. 1 ал. 2 т. 1.6, the line the generator carries as `devices_hospital`. T1 would have silently swept it into the reserve residual. **✅ RESOLVED 2026-07-28** — re-read confirms it was two errors (missing 1.1.3.6 = 111,338.2k + БМП keyed at 1.1.3.7.1 instead of the parent = 34,767.8k; together exactly 146,106.0k). Full table in **§0a′**, corrected line values in **T1.1** | §0a′, T1.0, **T1.1** |
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
| 8 | **The annual aggregates should month-weight the cap, not scalar it.** A whole-year 2300 overstates the contribution base by €261M / revenue by €72.7M, and the simulator's МОД lever by €51.5M — while `budget2026_package.ts` already prorates the same measure via `effMonths: 5` | **T2.6** |

**Scope decision, 2026-07-28 (operator): `/budget/simulator` becomes a FY2026 simulator.**
This adds **T8** and changes what the plan is for — it is no longer only an ingest. The
ЗДБРБ-2026 is still unpromulgated, so FY2026 has no single legal frame; T8 treats that as a
design requirement (a mixed-provenance baseline with a per-line `basis`) rather than a reason
to wait. **T2.6 becomes a precondition** for it: once 2026 is the baseline year, the baseline
year is itself the split-year, and a whole-year cap bakes the €72.7M error into the baseline
instead of a lever. Two simulator levers (`ssp`, pension floor) are also **wrong today**,
independent of the re-base — see T8.3.

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

> **RESOLVED 2026-07-28 — re-read from idMat 244981. The headline list above is superseded by
> §0a′ below; T1.0 is no longer blocking.** The €146,106.0k gap was **two** errors, not one:
>
> 1. **A missing line** — 1.1.3.6 „Медицински изделия, прилагани в болничната медицинска
>    помощ" = **111,338.2k**, the generator's `devices_hospital`, exactly as predicted.
> 2. **БМП keyed at the wrong level** — the 2,307,171.5 above is sub-line **1.1.3.7.1**
>    („Дейности болнична помощ"). The parent **1.1.3.7 = 2,341,939.3k**; the difference of
>    34,767.8k is two „медицински персонал в лечебните заведения" sub-lines (types а and б)
>    of 17,383.9k each.
>
> `111,338.2 + 34,767.8 = 146,106.0` — the gap, to the last decimal.

### 0a′. чл. 1 ал. 2 as promulgated (thousand EUR)

Read from idMat 244981 on 2026-07-28. Balanced budget: I. ПРИХОДИ И ТРАНСФЕРИ = II. РАЗХОДИ И
ТРАНСФЕРИ = **5,256,677.2**. чл. 2 fixes the health contribution at **8%**.

| code | line | k€ |
|---|---|---|
| 1.1.1 | Разходи за персонал | 48,157.8 |
| 1.1.2 | Издръжка на административните дейности | 17,709.1 |
| 1.1.3 | **Здравноосигурителни плащания** | **4,933,102.8** |
| 1.1.3.1 | Първична извънболнична медицинска помощ | 345,609.8 |
| 1.1.3.2 | Специализирана извънболнична медицинска помощ | 351,246.0 |
| 1.1.3.3 | Дентална помощ | 231,049.4 |
| 1.1.3.4 | Медико-диагностична дейност | 168,254.3 |
| 1.1.3.5 | Лекарствени продукти, мед. изделия и диетични храни за домашно лечение | 1,334,348.5 |
| 1.1.3.5.4 | — от които ПЛС | 1,264,322.9 |
| 1.1.3.5.4.1 | — — референтни и специални | 1,136,682.8 |
| 1.1.3.5.4.2 | — — генерични | 127,640.1 |
| 1.1.3.6 | **Медицински изделия в болничната медицинска помощ** | **111,338.2** |
| 1.1.3.7 | **Болнична медицинска помощ** | **2,341,939.3** |
| 1.1.3.7.1 | — дейности | 2,307,171.5 |
| 1.1.3.7.2/3 | — медицински персонал (тип а / тип б) | 17,383.9 + 17,383.9 |
| 1.1.3.8 | Други здравноосигурителни плащания | 49,317.3 |
| 1.1.4 | Плащания от трансфери от МЗ | 101,490.7 |
| 1.2 | Придобиване на нефинансови активи | 2,068.7 |
| 1.3 | Резерв за непредвидени и неотложни разходи | 154,148.1 |

**Every level reconciles exactly** — 1.1.3 sums to 4,933,102.8; 1.1 (48,157.8 + 17,709.1 +
4,933,102.8 + 101,490.7) to 5,100,460.4; the total to 5,256,677.2. The ПЛС sub-lines sum to
1,264,322.9 and the five МЗ-transfer sub-lines to 101,490.7. That internal consistency is the
evidence the read is faithful rather than partial — the property §0a's first pass lacked.

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
   at `/awarder/121858220`. Per-line (final, from §0a′): БМП **−17.9M**, ПИМП −3.7M, dental
   −2.5M, СИМП −1.2M, `devices_hospital` −3.2M, personnel −3.5M, издръжка −0.3M, drugs
   (1.1.3.5) +2.3M, diagnostics +0.8M, други плащания +6.5M. Deltas sum to −281,319.7k ✓.

   **The earlier "БМП −52.7M" was wrong** — it differenced the draft's parent against the
   law's *child* (1.1.3.7.1), the same level-mismatch that hid €34.8M in §0a. One assumption
   to record in the generator comment: `hospital` is matched **parent-to-parent**, consistent
   with it always having been the headline БМП line, but the draft's own basis cannot be
   verified from the promulgated text.

   **The reserve line does not move −362.0M.** That figure differences the draft *residual*
   (5,537,996.9 − 5,021,850.2 = 516,146.7k) against the law's *named* reserve (154,148.1k) —
   but the tile renders the residual, which T1.2 keeps. The bar actually moves 516,146.7 →
   **257,707.5 (−258.4M)** — confirmed against §0a′. Do not publish −362.0M in the T1.5
   changelog entry.
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

**Highest value. Do this first and alone. T1.0 is DONE — T1 is unblocked.**

**T1.0 — ✅ RESOLVED 2026-07-28.** чл. 1 ал. 2 re-read from idMat 244981; the full structure is
in **§0a′** and the €146,106.0k gap is fully explained (missing 1.1.3.6 = 111,338.2k + БМП
level-mismatch = 34,767.8k). Key T1.1 from §0a′, not from the §0a headline list.

**T1.1** — `scripts/budget/nzok/__write_budget.ts`: rewrite `YEARS[0]` (FY2026).
`basis: "draft"` → `"law"`, `totalK: 5_537_996.9` → `5_256_677.2`, and the ten `k` values
below. Update the file header comment: source becomes "ЗБНЗОК 2026 (обн. ДВ бр. 68 от
28.07.2026, idMat 244981)" replacing "проект, приет от Надзорния съвет 29.10.2025 /
nhif.bg/upload/29401".

| `id` | law code | `k` | vs draft |
|---|---|---|---|
| `gp` | 1.1.3.1 | `345_609.8` | −3.7M |
| `specialist` | 1.1.3.2 | `351_246.0` | −1.2M |
| `dental` | 1.1.3.3 | `231_049.4` | −2.5M |
| `diagnostics` | 1.1.3.4 | `168_254.3` | +0.8M |
| `drugs` | 1.1.3.5 | `1_334_348.5` | +2.3M |
| `devices_hospital` | **1.1.3.6** | `111_338.2` | −3.2M |
| `hospital` | **1.1.3.7** (parent) | `2_341_939.3` | **−17.9M** |
| `other_care` | 1.1.3.8 | `49_317.3` | +6.5M |
| `personnel` | 1.1.1 | `48_157.8` | −3.5M |
| `operations` | 1.1.2 | `17_709.1` | −0.3M |
| `reserve` | *(residual)* | 257,707.5 | −258.4M |

Named lines sum to **4,998,969.7k**, so the residual lands on 257,707.5k exactly. Take
`hospital` from the **parent** 1.1.3.7, not 1.1.3.7.1 — that mismatch is what hid €34.8M in
the first pass, and it is worth a comment in the generator so the next reader does not
"correct" it back.

**T1.1a — record the sub-lines, but do NOT restructure the tile.** The law publishes far more
detail than we hold: ПЛС splits **референтни €1,136.7M vs генерични €127.6M** — a 90/10 split
that is the most interesting number in the law and has nowhere to go today — plus a
biomarker-diagnostics line and a five-way МЗ-transfer breakdown. Capture them in the
generator (as a commented sub-line block or an optional `children` field), but keep the ten
flat lines: the tile is a composition bar and T1's acceptance criterion is explicitly "no
component edited". Surfacing the drug split is a T7-class follow-up.

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
simulator's `currentCap` reflects the in-force value; `MOD_BY_YEAR` matches the expected diff
(one key: `2026: 2112 → 2300`, per the Addendum decision — the original "byte-identical"
criterion is void, see A2.1); `__smoke_mod_identity.ts`, `__smoke_earnings.ts` and
`__smoke_behavioral.ts` re-run green.

---

## T2.6 — Month-weight the annual aggregates (analysis, 2026-07-28)

**This is not an enhancement. It is the correct model, and the scalar is the approximation.**
МОД is a *monthly* cap applied per month under КСО, so the true annual insurable base is

```
B_year = Σ_months Σ_workers min(wage, cap_month)
```

`scalar × 12` is only right when the cap held all year. It didn't in 2022, doesn't in 2025,
and doesn't in 2026 — three of the last five years, so the mid-year step is the rule rather
than the exception, and the `MOD_BY_YEAR` doc comment naming only "(2022, 2025)" is already
stale.

### T2.6a. The seam — three sites, one of which hardcodes the assumption

| site | the hardcoded bit |
|---|---|
| [`scoreModCapBands`](../../src/lib/bgTaxPolicy.ts) (`:351`) | `deltaBaseEur *= 12` |
| [`pitRevenueOnBands`](../../src/lib/bgTaxPolicy.ts) (`:275`) | `return total * 12` |
| [`scoreModCap`](../../src/lib/bgTaxPolicy.ts) (`:427`) | `identity.aboveCapMassEur` is an annual mass |

Proposed shape — sums over segments instead of multiplying by 12:

```ts
export interface CapMonths { capEur: number; months: number }
export const capMonths = (year: number): CapMonths[] => … // derived from MOD_SCHEDULE (T2.1)
```

Scalar callers pass `[{ capEur, months: 12 }]` and get today's answer byte-for-byte — which
doubles as the regression check that finding #6 says T2 currently lacks.

**The vocabulary already exists in this repo.**
[`budget2026_package.ts:8`](../../scripts/budget/budget2026_package.ts) documents `effMonths`
("months the measure is live in 2026 (01.08 → 5, 01.09 → 4)") and prints full-year beside
prorated "to compare like-for-like". The package scorecard month-weights; the shared engine
the simulator and the baseline both use does not. That is an internal inconsistency, not a
missing capability.

### T2.6b. Magnitudes — measured on the baked 120-band grid (2.63M workers, α = 2.273)

| basis | annual base | SSC revenue |
|---|---|---|
| scalar 2112 all year (today) | €31.215bn | €8,677.7M |
| scalar 2300 all year (the Addendum decision) | €31.663bn | €8,802.3M |
| **month-weighted 7×2112 + 5×2300** | **€31.401bn** | **€8,729.6M** |

Shipping 2300 as a whole-year scalar **overstates the contribution base by €261M and revenue
by €72.7M**. Today's 2112 understates by €187M / €51.9M. The weighted figure sits between, as
it must.

On the simulator's headline Pareto lever the gap is starker: raising 2112 → 2300 scores
**€88.3M/yr full-year**, but 2026 only collects **€36.8M** (5/12) — the scalar overstates the
actual 2026 yield by **€51.5M**.

That number is the argument. It is almost exactly the **€50.9M** the government's own package
attributes to the 01.08 threshold measure in `budget2026_package.ts` — an entry that *already*
carries `effMonths: 5`. Two parts of our own system price the same legislated change ~2.4×
apart purely because one prorates and the other does not.

### T2.6c. Weight the outputs, never the cap

The tempting shortcut is a blended cap, 7/12·2112 + 5/12·2300 = €2,190.33. It is wrong:
`min(w, cap)` is **concave** in cap, as the grid shows directly —

```
dB/dcap  @1900: 284,866   @2112: 223,888   @2190: 193,399   @2300: 178,537   @3000: 99,273
                                                              EUR/mo of base per EUR of cap
```

so by Jensen `B(blended) ≥ Σ w_m·B(cap_m)` and a blended cap **overstates**: +€13.4M base /
+€3.7M revenue here. Small at a €188 step, but it grows with the square of the step and costs
nothing to avoid.

### T2.6d. What is clean, and what this does not fix on its own

- **Clean — the Pareto anchor.** `modIdentity` anchors on **2024** (cap €1,917), which the
  `MOD_BY_YEAR` comment does *not* list as a mid-year mover. The fit is uncontaminated, so
  month-weighting can be layered on **without refitting α**. This is what makes T2.6 cheap.
- **Not clean — the calibration year.** `baselineYear` is 2025, which *is* on that list, and
  `MOD_BY_YEAR[2025] = 2112` is the "longer part of the year" value by the comment's own
  admission. κ is therefore calibrated against a year the model already misstates for part
  of. **Fixing 2026 without fixing 2025 relocates the error rather than removing it.**

  *(2025 split RESOLVED 2026-07-28 — see T2.6g. It is **1 April 2025**, costing €40.7M.)*

### T2.6g. The 2025 split, and the rule that generates the whole schedule

From [ЗБДОО-2025, ДВ бр. 25 от 25.03.2025](https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=233617),
чл. 9 — in force retroactively from 1 Jan 2025 per § 7:

| period | МОД | min self-insured |
|---|---|---|
| 1 Jan – 31 Mar 2025 | 3,750 лв = **€1,917.34** | 933 лв = €477.03 |
| 1 Apr – 31 Dec 2025 | 4,130 лв = **€2,111.64** | 1,077 лв = **€550.66** |

So 2025 is **3 + 9 months**, and `MOD_BY_YEAR[2025] = 2112` is the nine-month value —
consistent with the "longer part of the year" comment.

**Cost of not weighting it:** on the same band grid, scalar-2112 overstates the 2025 base by
**€146.5M and revenue by €40.7M** (0.47%). Smaller than 2026's €72.7M — the step is smaller
and lands earlier — but it sits in the *current* calibration year, so T2.6 must back-fill
2025 in the same change or κ keeps €40.7M of the defect.

**The structural finding matters more than the date.** Both steps are late-budget artifacts
and follow one rule:

| year | promulgated | step | first-period value |
|---|---|---|---|
| 2025 | ДВ бр. 25, **25 Mar** | **1 Apr** | €1,917.34 = `MOD_BY_YEAR[2024]` |
| 2026 | ДВ бр. 68, **28 Jul** | **1 Aug** | €2,111.64 = `MOD_BY_YEAR[2025]` |

The step takes effect **the first of the month after promulgation**, and **the first period of
year N is year N−1's cap, carried by the extension law until the late budget passes.**

Two consequences:

1. `MOD_SCHEDULE` is mechanically back-fillable — the first segment is never a new number,
   only the carried previous cap. 2022 still needs checking, but it should follow the pattern.
2. **The split-year is the normal case, not a 2026 quirk.** Three consecutive late budgets
   means the scalar-per-year model has been wrong more often than right. `MOD_SCHEDULE` is
   permanent infrastructure, which retires the "is this worth the complexity" question.

**Provenance corrections that fall out:** `MIN_SELF_INSURED_INCOME = 550.66` is commented
"(2026)" in [bgTax.ts:59](../../src/lib/bgTax.ts) but has been in force since **1 April
2025** — it is a 2025 value the 2026 law carried, not a 2026 one. And the `MOD_BY_YEAR`
comment naming "(2022, 2025)" must add 2026.

### T2.6e. Where month-weighting would be WRONG

Only the annual-aggregate consumers weight. The point-in-time ones must not:

- `computeLabourTax` and the tax calculator compute a **payslip**. Nobody's August payslip
  uses a blended cap — there the answer is `asOf` (T2.2): pick the month, don't average it.
- A `resolveMod(year)` **label** must name the period in force, not blend two values into a
  number that was never law.

This is the split T2 was already reaching for: dated resolution for point-in-time surfaces,
month-weighted aggregation for annual revenue. Applying the wrong one to either class is a
new defect, not a partial fix.

### T2.6f. Caveats to state rather than paper over

The band grid is a static monthly wage distribution, so this captures neither within-year wage
growth nor lumpy December bonuses — and those land inside the 2300 window, meaning
month-weighting probably still *slightly* understates. Second-order against a €72.7M scalar
error, but do not present the result as precise.

**Sequencing:** T2.6 depends on `MOD_SCHEDULE`, so it rides T2.1 rather than preceding it. It
is also the strongest argument for A2.6's "do not ship the scalar bump without the schedule" —
with the schedule, the 2300 decision is recoverable; without it, the €72.7M overstatement is
simply baked in.

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

> **Correction (T3.4 as built).** The replacement-rate curve does **not** move. An earlier
> note here claimed the de-hardcoding shifted it (high 25.9% → 31.1%); that was computed
> against an invented €2,000 wage anchor. Against the shipped НОИ vintage (`latestYear: 2024`,
> avg wage €1,188) the published rates are **54.0 / 54.0 / 43.6 %** before and after, because
> the old hardcodes *were* the 2024 statutory values.
>
> The load-bearing rule the build established: **resolve the statutory bounds at the wage
> anchor's year, not at today's.** A replacement rate is a pension over a wage, so 2026 bounds
> over a 2024 wage is a units error dressed as a policy result — it moved the rates up to
> +8.7pp and squeezed the high earner to 1.7pp below the median, erasing the "high earners are
> capped" shape the chart exists to show. `scheduledValueAt(schedule, year)` exists for that
> pairing, and `pensionFormula.test.ts` pins the published curve.

**T7.6 — a "2 of 3" completeness meter on `BudgetJourneyTile`.** FY2026's journey is
genuinely unusual: bridging law (Dec 2025) → ЗИД (Mar 2026) → two fund laws (Jul 2026) →
ЗДБРБ still absent. The data is already in `documents.json`; the meter is a rendering change
that directly serves §0's warning never to say "the 2026 budget".

---

## T8 — Re-base the policy simulator on FY2026

**DECIDED 2026-07-28 (operator): `/budget/simulator` is a 2026 simulator from now on.**

The concern was raised that the ЗДБРБ-2026 is unpromulgated and reaffirmed; this section
implements the decision. The constraint does not go away, it becomes a design requirement:
**FY2026 has no single legal frame, so the 2026 baseline is a mixed-provenance object and
every line has to say which kind of number it is.**

Today the simulator is a *2025* model: `policy_baseline.json` carries `baselineYear: 2025`,
revenue €26.31bn and balance −€3.11bn straight off the 2025 КФП December snapshot, with 2026
policy offered as levers on top.

### T8.1. The four bases

Tag every baseline line with one, in the `basis: "law" | "draft"` idiom `NzokBudgetYear`
already uses. This is what makes T7.1's provenance chip reusable here rather than a
second mechanism.

| basis | source | applies to |
|---|---|---|
| `law` | ЗБДОО + ЗБНЗОК, ДВ бр. 68 | statutory parameters, the NHIF envelope, the ДОО fund plan — **exact** |
| `interim` | ЗСПИР-2026 (idMat `240166`) + its ЗИД (`242170`) | the legal frame the state side actually ran on. FY2026 is not lawless; it is on a bridging law, and `INTERIM_BUDGET_LAWS` already catalogues both |
| `execution` | 2026 КФП YTD, seasonally annualised (T8.2) | state revenue and expenditure |
| `carried` | 2025 (or older) actuals, grown | everything with no 2026 source — see the vintage table in T8.6 |

**The UI must render the mix, not hide it.** A "2026" headline over a number that is 40%
`carried` is exactly the claim §0 forbids.

### T8.2. Revenue and expenditure — annualise the YTD, and do it per series

`kfp.json` carries **monthly** `observations` for 2021–2026 (`series`: revenue, expenditure,
balance, financing, euContribution), with 2026 populated **through May**. The share of
full-year execution landed by May is stable enough to annualise on:

| series | 2022 | 2023 | 2024 | 2025 | mean | σ |
|---|---|---|---|---|---|---|
| revenue | 0.375 | 0.350 | 0.372 | 0.369 | **0.3666** | 0.0114 |
| expenditure | 0.348 | 0.362 | 0.364 | 0.387 | **0.3652** | 0.0161 |
| balance | 0.190 | 0.461 | 0.313 | 0.539 | — | — |

Applying it to the 2026 YTD (revenue €9.905bn, expenditure €11.895bn to 2026-05-31):

| | 2026 annualised | band (min/max historical share) | 2025 actual |
|---|---|---|---|
| revenue | **€27.01bn** | €26.38 – 28.30bn | €26.31bn |
| expenditure | **€32.57bn** | €30.76 – 34.22bn | €28.38bn |
| balance | **−€5.56bn** (≈ −4.5% of the €123.9bn 2026 GDP) | — | −€3.11bn |

**Three hard rules:**

1. **Never annualise the balance directly.** Its share-by-May ranges 0.190–0.539 across four
   years — it is a small difference of two large numbers and the seasonality does not survive
   the subtraction. Annualise revenue and expenditure separately and *derive* the balance.
2. **Publish the band, not just the point.** ±1.1–1.6pp on the share is ±€0.8–1.7bn on the
   annualised figure; a simulator whose levers move tens of millions must not present a
   baseline with a billion-euro band as a hard number.
3. **Re-annualise as months land.** The band narrows monotonically through the year; by the
   December snapshot the estimate becomes an actual and `basis` flips `execution` → `carried`.

**There is no 2026 `planned` line and there will not be one until the ЗДБРБ.** Confirmed
against the feed: every 2026 observation has `planned: null`, where 2025 carries a full plan
(revenue €28.21bn, expenditure €30.82bn, balance −€3.65bn). So the simulator cannot show
plan-vs-actual for 2026, and any UI affordance that assumes a plan must degrade, not blank.

### T8.3. Enacted policy moves from lever to baseline

This is the substance of the re-base, and two levers are **wrong today** regardless of it —
in a 2025-based model they were future policy; in a 2026-based model they are current law and
belong in the baseline, with only the residual left as a lever.

**T8.3a — the `ssp` lever is now partly enacted.**
[`scoreSscSelfPaid`](../../src/lib/bgTaxPolicy.ts) offers moving ~132,862 budget-paid people
onto their own 13.78%. § 6 ЗБДОО enacted exactly that for part of them, and
[`BUDGET_PAID_SSC_GROUPS`](../../scripts/budget/run_policy_baseline.ts) splits along the
statutory line almost exactly:

| group | КСО чл. 4 ал. 1 | § 6 outcome | lever value |
|---|---|---|---|
| 64,178 — админ + съдии/прокурори/следователи + ЧИК | т. 2, 3, 10 | **enacted from 1 Aug 2026** | €126.1M/yr |
| 68,684 — отбрана и сигурност | **т. 4** | explicitly retained | €127.5M/yr |

§ 6 narrows чл. 6 ал. 5 *"from т. 2, 3, 4 и 10 to т. 4"*, so row 1 is law and row 2 is the
only remaining what-if. Leaving the lever whole lets a user book €126.1M the budget has
already taken.

Two things to encode rather than rediscover:

- The law is a **phased employer/employee split** (11.8/3.0 from 1 Aug 2026, 8.22/6.58 from
  1 Jan 2027), not the full 13.78% shift the lever models — so the enacted 2026 slice is a
  fraction of €126.1M and the lever's own arithmetic overstates what the law achieves.
- The employer absorbs it through December so net pay is protected — **which is precisely the
  lever's `grossUp` branch, the one that returns €0.** For Aug–Dec 2026 the law *is* the
  fiscally-neutral variant; the money starts in January.

**T8.3b — the pension floor is stale.** `expenditure.pensionFloor.minimumEur = 322.37`
(`asOf: "2026-03-31"`); чл. 10 ЗБДОО set €347.51 from **1 July 2026**. Scored on the baked
band grid: **€245.4M/yr full-year, €122.7M for Jul–Dec 2026, lifting 813,567 pensioners
(39.3% of 2.07M)**. Same defect class — move it into the baseline and re-anchor the lever's
"current minimum" to €347.51.

### T8.4. Consequences of flipping `baselineYear` to 2026

The flip is one field, and it detonates three things the plan has already documented as
latent:

1. **A2.2's latent coupling becomes immediate.** `capBaselineEur = MOD_BY_YEAR[baselineYear]`
   — with `baselineYear: 2026` and the Addendum's 2300 decision, κ recalibrates *in this
   change* rather than silently when the FY2026 КФП completes. Do it deliberately, with the
   drift gate ([`:887`](../../scripts/budget/run_policy_baseline.ts)) checked in the same run.
2. **T2.6 stops being an improvement and becomes a precondition.** The baseline year is now
   itself the split-year: a 2026 baseline priced at a whole-year cap carries the full €72.7M
   error *in the baseline*, not just in a lever. **T2.6 must land before or with T8.**
3. **κ's wage bridge lengthens.** `earnings.wageGrowthToBaseline` is 1.160 for 2024→2025; it
   becomes a 2024→2026 bridge. The NAP identity year stays 2024 (`napYear` is the last PIT
   breakdown available, and `revenue_breakdown/pit/` holds only `2024.json`), so the Pareto
   anchor is undisturbed — but the extrapolation is a year longer and should be captioned.

### T8.5. Presets and copy

`PRESETS` contains `{ id: "budget2026", apply: { mod: 2300, vign: 30, soe: 90, cigarettes: 120 } }`,
commented *"one click loads the government's budget"*. On a 2026 baseline that preset
**double-counts by construction** — it applies 2026 policy on top of a 2026 baseline. Worse,
its МОД component is already self-cancelling: once `currentCap` is 2300, `scoreModCap(identity,
2300, 2300)` scores **exactly €0** while the chip still claims to model the raise.

Re-purpose it as "what the 2026 package changed **vs 2025**" (a comparison, not an overlay),
or retire it. Also correct the comment: €2,300 is чл. 9 **ЗБДОО**, not ЗДБРБ-2026 — the preset
currently mixes instruments in exactly the way §0 warns against.

### T8.6. What stays stale — publish the vintages

A "2026 simulator" still rests on components anchored years back. Surface this table rather
than let the 2026 label imply otherwise:

| component | vintage |
|---|---|
| `earnings.sesWave` | 2022 |
| `vat.structureYear` | 2022 |
| `incomeTiers.taxYear` | 2023 (НАП) |
| `expenditure.pensions.year`, `administration.payrollYear`, `socialBenefits.cofogYear`, `teachers.wageYear` | 2024 |
| `modIdentity.year` | 2024 |
| state revenue / expenditure | 2026 YTD → annualised |
| statutory parameters, NHIF envelope, ДОО plan | **2026 law** |

`expenditure.pensions` (2024, €11.13bn) is the worst offender and the one the ЗБДОО can
improve — subject to §0c's caveat that the per-fund figures are gross "revenue + transfers"
and are **not** a drop-in replacement for an expenditure mass.

### T8.7. Acceptance

- `policy_baseline.json` carries `baselineYear: 2026`, a per-line `basis`, and an explicit
  annualisation band for the two `execution` lines.
- The balance is derived, never annualised (assert it in the generator).
- `ssp` and `pensionFloor` reflect enacted law; their levers price only the residual.
- The `budget2026` preset no longer contributes €0 while claiming otherwise.
- T2.6 has landed — a 2026 baseline on a whole-year cap is not acceptable.
- The UI states the mix and never labels a `carried` line "2026".

**Non-goal:** waiting for the ЗДБРБ. This section is explicitly the answer to "what does a
2026 simulator look like without one." When it lands, `interim`/`execution` lines get a `law`
basis and the annualisation band collapses — the structure does not change.

---

## Sequencing

```
T1 ──► T1.4a         T1.0 DONE (§0a′) — T1 is ready to implement; bucket:sync or it lands nowhere
T2.1 ──► T2.6 ──► T8   schedule → month-weighting → the 2026 re-base (T2.6 is a PRECONDITION:
                       a 2026 baseline priced at a whole-year cap bakes the error in)
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
| The line-by-line ЗБНЗОК figures are hand-keyed from a 45k-char HTML render | **This already bit once — §0a dropped 1.1.3.6 and mis-levelled БМП, losing €146.1M.** Both are fixed in §0a′. T1.2's hard residual assertion + the T1 smoke's line-id-superset check are the standing mitigations; the generator's overshoot throw is NOT one, since it only catches over-keying |
| A figure is keyed from a sub-line instead of its parent | The §0a БМП error was invisible because 2,307,171.5 is a real number in the law — just at the wrong level. §0a′ records the code for every line; T1.1 says parent-to-parent explicitly. Prefer sourcing by **code** (1.1.3.7) over by label |
| A missing line silently inflates the reserve residual instead of failing | T1.2 asserts the residual equals 257,707.5k, so an under-keyed table throws rather than absorbing the shortfall into a bar labelled "Резерв, трансфери и капиталови разходи" |
| Prил. 1/1А parse silently drops or mis-columns rows | Fixed 9-column check + an expected row count — **after** resolving the 744 rows-vs-cells ambiguity (§0d). The floor check is a counter, not an assertion (T5.1) |
| Two fund laws overwrite each other in the HTML cache | T5.0: `fetchLawHtml`'s key is `law-${fiscalYear}`, so both idMats collide today. Re-key before T5.1 |
| A `MOD_BY_YEAR` derivation silently reprices the fiscal baseline | T2.1 derives from the *first* step of the year, making the map byte-identical. The `__smoke_*` gates that would catch a regression are tsx scripts outside `test:unit` — re-run them by hand (T2.5) |
| A shared `/budget/simulator` permalink changes meaning on 1 Aug | T2.2: no wall-clock default for `asOf`; the no-`asOf` path stays year-scalar and time-independent. Note A2.5: with the 2300 decision the shift happens once, at deploy, instead |
| The annual revenue model prices a split-year cap as if it held all 12 months | T2.6 month-weights `scoreModCapBands` / `pitRevenueOnBands` / `scoreModCap`. Measured cost of not doing it: €72.7M on the contribution side, €51.5M on the simulator's МОД lever. **After T8 this moves from a lever error to a baseline error** — the baseline year becomes the split-year one |
| The 2026 simulator is read as "the 2026 budget" when a third of the package does not exist | T8.1's per-line `basis` + T8.6's vintage table. The ЗДБРБ absence is a design input, not a caveat to bury: no 2026 `planned` line exists in the КФП feed at all |
| A user books a saving the law has already taken (`ssp` €126.1M, pension floor €245.4M) | T8.3 migrates enacted policy into the baseline and leaves only the residual as a lever. This is wrong **today**, independent of T8 |
| The annualised 2026 baseline is presented as precise | T8.2 rule 2: the ±1.1–1.6pp seasonality σ is ±€0.8–1.7bn. Publish the band; re-annualise monthly |
| Someone implements T2.6 as a blended (weighted-average) cap | T2.6c: `min(w, cap)` is concave, so a blended cap overstates by construction (+€3.7M here). Weight the outputs, never the cap |
| 2025's own mid-year step keeps contaminating κ after 2026 is fixed | **Date resolved (T2.6g): 1 Apr 2025, worth €40.7M.** Back-fill 2025 into `MOD_SCHEDULE` in the same change, or T2.6 relocates the error instead of removing it. 2022 still unchecked |
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

   *(Quantified 2026-07-28 — see **T2.6**. On the baked band grid the whole-year 2300 scalar
   overstates the contribution base by €261M and SSC revenue by €72.7M against the correct
   7×2112 + 5×2300 weighting, and overstates the simulator's МОД lever by €51.5M. "Do not
   ship the scalar bump without the schedule" is therefore a hard requirement, not a
   preference: the schedule is what T2.6 derives the month weights from.)*

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
