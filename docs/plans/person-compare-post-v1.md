# person-compare-post — a reusable two-person declaration comparison card

**Status:** planned, 2026-08-16. Decisions taken with the operator up front:
fall back to an older MATCHED year rather than refusing; build a bespoke
`renderVersusCard` for v1; scope is any two people in the identity layer, not
executive officials only.

A skill that turns "compare Иван Демерджиев and Бойко Рашков" into a Наясно card
listing both men's declared estate — bank, property, vehicles, investments,
debts, income — from the SAME year, on the SAME form, with the basis named.

It is a **gatherer**, exactly like `settlement-post`: it owns resolving the two
people and proving the comparison is legitimate, then hands composition, the
duplicate check, public-source confirmation and saving to **`naiasno-post`**.
None of `naiasno-post`'s rules are restated here.

---

## 1. The one thing to internalise

**A declaration is not a wealth statement — it is one of two different forms, and
they measure different things.** Measured over the whole corpus (61,743 filings):

| type | filings | avg real-estate rows | % carrying an income table |
|---|---:|---:|---:|
| `Annualy` | 44,615 | 1.41 | **93.3%** |
| `Entry` | 5,654 | 6.27 | **0%** |
| `Vacate` | 5,484 | 6.38 | **0%** |
| `Other` | 5,990 | 0.00 | 0% |

`Entry`/`Vacate` (встъпителна / при напускане) are a full estate INVENTORY and
carry no income table at all. `Annualy` is an income statement plus a much
thinner property table. Comparing one against the other prints two false
sentences at once — "17 имота срещу 0" and "€66 015 заплата срещу —" — and both
are artifacts of the form, not facts about the people.

So the skill matches on **(period year, form class)**, never on year alone:

```
class 'annual'    = Annualy
class 'inventory' = Entry | Vacate
                    Other is never comparable — 0 assets, 0 income, 5,990 filings
```

---

## 2. The seven ways this comparison lies

All seven are present in the Демерджиев / Рашков pair the skill was designed
against, which is why it is the fixture.

### 2.1 "Latest each" compares different years

Рашков's newest filing is 2025, Демерджиев's is 2026. A per-person `latest`
compares estates a year apart, across a period in which one of them left office.

### 2.2 Same year, different form (§1)

In 2023 both men have a filing. Рашков's is `Annualy`, Демерджиев's is `Vacate`.
Same year, incomparable forms.

### 2.3 The representative-filing artifact — the dangerous one

Рашков has **four** filings covering 2023: `Annualy`, `Other`, `Entry`, `Vacate`.
`person_wealth_year` picks the annual (correctly — see 090's header), and that
annual carries **0 real-estate rows**. His `Entry` and `Vacate` the same year each
carry **24**.

„Рашков — 0 имота" is derivable straight from the serving matview and is flatly
untrue about a named living person. A card is not a chart: it is a sentence.

### 2.4 A property count is NOT measurable on an annual filing

The generalisation of 2.3, and the finding that shapes the card's row set.
Measured over the **3,090 person-years where the same person filed BOTH an annual
and an inventory filing covering the same period**:

- annual mean **1.86** real-estate rows vs inventory mean **6.40** (3.4×)
- the inventory is higher in **1,961 / 3,090** (63.5%)
- the annual shows **zero** properties while the inventory shows some in
  **1,568 / 3,090 — 50.7%**

For half the people who filed both, "0 имота" on the annual coexists with a real
property list on the inventory. **Property count may therefore appear on an
`inventory`-class card only.** On an `annual` card it is omitted — not rendered
as 0, not footnoted.

### 2.5 The basis flip

2023: on ASSETS Демерджиев leads (€627,497 vs €571,647); on NET Рашков leads
almost 2× (€571,647 vs €295,193), because Демерджиев declared €332,304 of debt.
The winner is chosen by the basis, so the card shows assets AND debts and names
the basis, never a bare "net worth" with a single number each.

### 2.6 `credit_limit` is not a debt

Рашков's 2022 annual carries a €5,113 `credit_limit` row. Per 089's own comment,
a declared limit is what the holder COULD draw; subtracting it asserts a debt
nobody declared. The serving SQL excludes it from BOTH arms
(`category NOT IN ('debt','credit_limit')` on assets, `= 'debt'` on debts), so it
appears in neither total. A hand-written card query using `category != 'debt'`
folds it into assets silently. It must be excluded, and never labelled „задължения".

### 2.7 Latest year is not the densest year

| period year | annual filers | inventory filers |
|---:|---:|---:|
| 2024 | 7,389 | 1,220 |
| 2025 | 12,359 | 1,087 |
| 2026 | **45** | 1,877 |

The 2026 annuals land the following spring. A `max(year)` default lands where
almost no pair is comparable. Prefer the newest year that has BOTH people in the
SAME class; on a tie prefer `annual`, because it is the class that carries income.

(2020 is a separate corpus hole — 244 annuals against ~2,250 in the neighbouring
years. Not a bug in this skill, but it will surface as a missing fallback year.)

---

## 3. The gate

```
1. resolve both slugs        → person.slug, status='active', is_public_figure
2. enumerate each person's asset-bearing filings as (period_year, class)
     period_year = COALESCE(fiscal_year, declaration_year)   -- 090's axis, not declaration_year
     asset-bearing = has >=1 declaration_asset row with a non-null value_eur
3. intersect on (period_year, class)
4. pick newest; tie → prefer 'annual'
5. no intersection → REFUSE, printing each person's (year, class) list
6. chosen year is not either person's latest → the card MUST say so
```

For the fixture pair the gate lands on **2022 / annual** — not 2023, and not
either man's latest. That is the designed behaviour, and the card says
„най-скорошната година, в която и двамата подават годишна декларация".

### The gate's answer for the fixture

| | Рашков (2022, annual) | Демерджиев (2022, annual) |
|---|---:|---:|
| инвестиции | €315,054 (2) | — |
| банкови сметки | €160,060 (1) | — |
| пари в брой | — | €31,404 (1) |
| активи (общо) | **€475,114** | **€31,404** |
| задължения | €0 | €0 |
| доход (деклариран) | €77,684 | **€104,189** |
| длъжност | — | Служебен министър-председател и министър |
| *(кредитен лимит €5,113 — не е задължение, не се показва)* | | |

Note the honest story the gate produces: Демерджиев declared the HIGHER income
and a fifteenth of the wealth. That is a better post than the false one, and it
arrives with no verdict attached.

---

## 4. Sourcing rules

- **Postgres only. Never `data/officials/*.json`.** The SQL applies
  `asset_share_multiplier()` (a co-owned property is declared WHOLE, once per
  co-owner — a bare SUM counts a shared home once per owner) and
  `asset_row_ceiling_eur()`. Second reason: `ASSET_ROW_CEILING_EUR = 50_000_000`
  in `src/lib/declarations.ts:77` disagrees with `asset_row_ceiling_eur()`'s
  `100000000`, against that constant's own doc comment. **Currently latent** —
  zero corpus asset rows fall between the two — so this is a note, not a defect
  to fix here, but it is one more reason to have a single source.
- **Both sides from ONE query.** Two queries is two chances for the sides to be
  picked by different rules — which is precisely defect 2.3.
- **Reuse the serving functions where they fit** (`person_declarations(slug)`,
  `person_wealth_series(slug)`): they carry the public-figure gate
  (`status='active' AND is_public_figure`), so the privacy rule is not
  re-implemented. The per-category breakdown has no serving function yet and is
  the one arm that reads `declaration_asset` directly.
- **Every figure is traceable.** `declaration.source_url` is a direct
  `register.cacbg.bg/<year>/<guid>.xml`, so `naiasno-post`'s rule 2
  (confirm against the primary public source) is satisfied exactly rather than
  by a web search.
- **Declared, never actual.** „декларирано" on the card. No verdict verbs
  (забогатя / укри / скри). The number is the point — `naiasno-post` rule 4.

---

## 5. The card — `renderVersusCard`

New renderer in `scripts/posts/cardKit.ts`, dispatched in `post_tool.ts` by the
presence of a `versus` key, placed with the other discriminators (before the
`bars`/`series`/`rows` fallbacks, alongside `place`).

`1080×1350` portrait — Facebook's tallest uncropped feed ratio, the same reason
`PlaceCardSpec` has the `format` knob. Two columns, one per person.

```ts
export type VersusFormClass = "annual" | "inventory";
export type VersusMetricKey = keyof typeof VERSUS_METRICS;

export type VersusSide = {
  name: string;            // as the register spells it
  role?: string;           // position_title / institution at the time of filing
  formLabel: string;       // "годишна декларация" | "декларация при напускане"
  formClass: VersusFormClass;   // machine-readable; both sides must agree
  rows: { key: VersusMetricKey; value: string; note?: string; magnitude: number }[];
  total: { label: string; value: string };   // label must match on both sides
};

export type VersusCardSpec = {
  versus: { left: VersusSide; right: VersusSide };
  year: number;
  yearNote?: string;       // "най-скорошната година с еднакви декларации" (§3 step 6)
  basis: string;           // "активи = всичко без задължения и кредитни лимити"
  metrics: VersusMetricKey[];   // the row order, SHARED by both sides — see below
  source: string;          // "Източник: Сметна палата (register.cacbg.bg)"
  cta?: string;
  theme?: Theme;
};
```

Design rules the renderer enforces, each closing a defect above:

- **`metrics` is shared, and both sides must carry EXACTLY it.** A missing row
  THROWS rather than rendering as „—" or being inferred as zero. (An earlier
  draft of this plan specified the „—" legend; the implementation refuses
  instead, and the refusal is the stronger rule.) Within one form class the
  caller is the only party that knows whether a category is absent because
  nothing was declared or because its query did not ask, and those two render
  identically — so the caller passes an explicit `{ value: "0 €", magnitude: 0 }`
  and owns the claim. Per-side row arrays would reproduce 2.2 visually.
- **The row set is class-dependent, and the renderer throws on a mismatch.**
  `annual` → банки, пари в брой, инвестиции, ценни книжа, автомобили,
  задължения, доход. `inventory` → имоти (count + value), банки, автомобили,
  инвестиции, задължения; **no income row** (0% of inventory filings carry one).
  Passing `имоти` on an `annual` card is a throw, not a warning — that is 2.4,
  and it is a false sentence about a named person.
- **`magnitude` drives paired bars on a shared scale** so the ratio reads before
  the numbers; `value` stays a pre-formatted BG string, as `PlaceBenchmark`
  already does, because only the caller knows if it is € or a count.
- **Both totals carry the basis label**, so 2.5 cannot be read off a bare number.
- **The form badge sits under each name**, not in the footnote. It is the single
  most load-bearing word on the card.
- **Glyph check**: no arrows — the font has none and a missing glyph renders as a
  silent tofu box in the published PNG (`naiasno-post` step 5). Read the rendered
  PNG before showing the operator.

---

## 6. Steps

1. **`scripts/posts/cardKit.ts`** — `renderVersusCard` + `VersusCardSpec`, and
   the `"versus" in spec.card` discriminator in `post_tool.ts`.
2. **`scripts/posts/cardKit.test.ts`** — throws on: a metric absent from
   `metrics` but present on a side, `имоти` on an `annual` card, an income row on
   an `inventory` card, rows that overflow the canvas. Plus the existing
   snapshot-ish conventions in that file.
3. **`scripts/person/compare_declarations.ts`** — the gate + the one query,
   `--slug-a --slug-b [--year] [--class]`, emitting the card spec as JSON. A CLI
   so the gate is testable without rendering, and so the skill body stays prose.
4. **`scripts/db/tests/person_compare.data.test.ts`** — a PG-backed gate test:
   the fixture pair resolves to **2022 / annual** (never 2023); `credit_limit` is
   in neither total; a same-year cross-class pair is refused; the share
   multiplier is applied (a co-owned property is not double counted).
5. **`.claude/skills/person-compare-post/SKILL.md`** — resolve, gate, gather,
   compose, hand off to `naiasno-post` at the final step. §2's seven traps go in
   the skill body: they are the reason it exists.

## 7. Deliberately out of scope for v1

- **The year-over-year and cohort axes.** The gatherer generalises to "one person
  across two years" (same gate, one slug both sides) and "person vs cohort
  median" (`person_cohort_wealth`, 097). Both are a later `-v2`; building three
  axes before one is published is how the gate stops being the focus.
- **An on-site `/person/a/vs/b` page.** This is a post skill. A route means a
  sitemap entry, a prerender and an `og:image` — the `dashboard-hub` checklist —
  for a page with a combinatorial URL space.
- **Fixing the `ASSET_ROW_CEILING_EUR` drift** (§4). Latent; belongs to whoever
  next touches the ceiling, with a gate that reads both definitions.
