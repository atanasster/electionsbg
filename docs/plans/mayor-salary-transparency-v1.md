# Mayor pay vs population — closing the gaps found auditing the gospodari.com salary article — v1

**Status:** T1 and T2's serving/UI layer are SHIPPED (`186_mayor_pay.sql`,
`mayor_pay_ranking()`/`mayor_pay_by_obshtina()`, wired into `functions/db_routes.js` as
`mayor-pay-ranking`/`mayor-pay`, a ranked page at `/governance/mayor-pay`, and the
per-municipality/My Area tile). **T1 was NOT built as specified below — it was bypassed.** See
the note at the top of §T1: the shipped code joins through
`municipal_officials_table.obshtina`, which the person-identity layer had already resolved,
rather than building the name-fold resolver this section describes. The remaining UI work is
discoverability, the dashboard rework, and contextual placement on person/local pages.
**Triggered by:** fact-checking gospodari.com's 2026-08-24 piece ("Кметове на малки населени места
декларират петцифрени заплати") against our own `declaration`/`declaration_income` corpus. Every
figure in the article checked out (see the audit in this conversation), but the audit surfaced
three data gaps and one clean feature opportunity: nobody can currently see this comparison on our
own site, even though we hold the numbers.
**Evidence re-derived:** 2026-08-25 against local Postgres (`electionsbg`, docker, port 5433) and
`HEAD`.

## Operational audit — 2026-08-28

- The Court of Audit municipal-register watcher last checked the 2026 list on **2026-08-27
  21:05Z**. Its fingerprint and 6,499-record count are unchanged since the successful municipal
  ingest on **2026-08-15**, so the committed/local corpus is current to the latest observed
  source listing.
- `npm run test:unit -- scripts/db/tests/mayor_pay.data.test.ts` passed **8/8** against local
  Postgres. The gate re-checks a broad national coverage floor, the single labor-income category, the
  multi-income Несебър counterexample, rank derivation, ambiguity refusal, the arithmetic,
  Sofia's code bridge, and an unknown municipality.
- This is a freshness and transformation audit, not an assertion that every sitting mayor has
  filed. Missing/unreadable filings and genuinely ambiguous concurrent mayors remain explicitly
  represented as absence, never as zero.

---

## 0. Verdict up front

- **The underlying data is sound.** All 10 spot-checked income/asset figures (Balchik, Samokov,
  Nesebar, Anton, Nedelino, Varna, Burgas, Stara Zagora, Sofia, and ex-Plovdiv deputy mayor
  Temelkov) matched the article to within BGN-rounding after peg conversion. This plan is about
  **surfacing and completing** what we hold, not fixing wrong numbers.
- **`declaration_income` is genuinely unused for any ranking or aggregation today** — confirmed by
  code search, not inferred. It renders in exactly one place
  ([`CandidateAssetsScreen.tsx:343`](../../src/screens/CandidateAssetsScreen.tsx:343)'s
  `IncomeTable`, one declaration at a time. `officials_rankings_table`
  ([`100_officials_rankings.sql:74`](../../scripts/db/schema/pg/100_officials_rankings.sql:74))
  ranks net worth only. So a "mayor pay vs population" view is **net-new aggregation**, not a
  wiring fix.
- **The blocking dependency is identity, not aggregation.** `declaration.institution` (muni tier)
  is free text with no join to `place_dim`/`obshtina_population` anywhere in the schema. Naive
  string matching already produced real casualties in my own audit (`"Бобовдол"` vs `"Бобов
  дол"`, `"Минерални Бани"` vs `"Минерални бани"`), and this repo has **already been burned by the
  exact collision class** at the source-parsing layer —
  [`village-mayor-attribution-v1.md`](village-mayor-attribution-v1.md) §T0 documents `"Бяла"`
  resolving to the wrong of two municipalities (Варна vs Русе) and flags `"Искър"` / `"Средец"`
  as the same latent collision between a real município and a Sofia district. **Tier 1 below must
  not repeat that mistake** — a bare name-fold is not enough; disambiguation needs to consult more
  than the string alone, and ambiguous cases must refuse rather than guess (the
  `aop_expert_person_links()` / `tr_owner_share` pattern this repo already uses elsewhere for the
  same reason).
- **Recommended shape:** a small, hand-written serving function + route in the style of
  `municipal_fiscal_by_obshtina()` / `budget_muni_list()` — **not** a `db_table.js` registry
  resource, **not** a new matview family — because the corpus is bounded at ~265 rows and this
  repo has an explicit, already-written rationale for why that scale doesn't want the generic
  engine (`useMunicipalFiscalRanking.tsx`'s header comment).

---

## 1. Findings, mapped to tiers

| # | Finding | Severity | Tier |
|---|---|---|---|
| F1 | **~17–19 of 265 municipalities have no FY2025 "Кмет" (non-deputy) filing**, while deputies/councillors from the *same* municipality filed for 2025 — looks like genuine late/missing mayor filings rather than a crawl gap (one case, Разлог, has an FY2024 mayor filing and 2025 filings for everyone else in the same município). | Coverage gap; understates the comparison | **T0** |
| F2 | **No code-based join exists from `declaration.institution` to a municipality.** Exact-string and even case/whitespace-normalized matching both produced false negatives in my own audit query. This repo has already documented the same collision class one layer over (`village-mayor-attribution-v1.md` §T0: `"Бяла"`, `"Искър"`, `"Средец"`). | Blocks any per-capita comparison; silent misattribution risk if built carelessly | **T1** |
| F3 | **No serving aggregate exists for mayor income vs population.** `declaration_income` is read in exactly one frontend component, one declaration at a time; nothing ranks or joins it to `obshtina_population`. | The actual UI/feature gap this plan exists to close | **T2** |
| F4 | **No reference dataset for the statutory kmet-pay methodology** (the population-tiered min/max bands set by CM decree, with the exact figure voted by each общински съвет). We can show what was declared, not whether it sits inside its legal band. | Limits editorial framing ("is this legal") but doesn't block the core comparison | **T2b (optional)** |
| F5 | **`place_dim.kind='obshtina'` conflates three unrelated things** distinguished only by code *shape*: 264 real EKATTE-coded municipalities, Sofia's 24 city-districts (`S25xx`), and continent-level placeholders (`AS`/`AF`/`EU`/…, presumably used elsewhere for donor/company origin). A naive `count(*) WHERE kind='obshtina'` returns 295, not ~265. | Dimension-table hygiene; a landmine for the next person who queries this table naively (I fell into it myself) | **T3 (separate, small)** |

---

## T0 — Coverage: chase the ~17-19 missing FY2025 mayor filings

Cheap, no code. Two steps:

1. Re-run `update-officials` — the last successful ingest (`state/ingest/cacbg_officials.json`,
   `lastSuccessfulIngest: 2026-08-22T18:22:42Z`) reported "298 mayors" captured corpus-wide across
   all fiscal years, and Сметна палата's register updates on a rolling basis as late filers catch
   up. A fresh crawl may close some of the gap on its own.
2. For whatever remains after that, this is very likely **genuine**, not a bug: declarations for
   FY2025 income are due mid-2026, and late filing is common. Document the residue as a fact
   ("N mayors had not filed their 2025 declaration as of &lt;date&gt;") rather than treating it as
   something to chase further — this repo's convention elsewhere (`aop_expert_coverage`,
   `isun_clean_delivery_coverage`) is to publish the coverage caveat alongside the figure, not to
   hide the gap.

**Do not treat F1 and F2 as the same problem.** F1 is "the filing doesn't exist yet"; F2 (T1
below) is "the filing exists but our string match can't find it." Fix T1 first — some of what
looks like F1 today is actually F2 in disguise (as it was for `"Бобовдол"` and `"Минерални
Бани"` in my own pass).

---

## T1 — `declaration.institution` → obshtina code resolver (blocks T2)

**⚠️ BYPASSED, NOT BUILT — this whole section is superseded.** Implementation found that
`municipal_officials_table.obshtina` (migration 102) is `person_role.place_code`, already
resolved offline by `scripts/officials/municipality_join.ts` with four fallback strategies and
Sofia's 24 districts handled — and verified (2026-08-25) against `place_dim` with zero
mismatches across 261 city-wide sitting mayors. `186_mayor_pay.sql` joins `declaration` to that
existing roster via `subject_ref = official_slug` instead of parsing `declaration.institution`
at all, which is what the whole section below proposes building from scratch. See
`186_mayor_pay.sql`'s header for the shipped approach. Kept below for its still-relevant
warning (the `"Бяла"`/`"Искър"`/`"Средец"` collision class) in case a future consumer of
`declaration.institution` has no equivalent existing resolver to reuse.

**Original goal (not pursued):** for every muni-tier `declaration` row, a reliable `obshtina_code` (the `place_dim.code`
used elsewhere, e.g. by `budget_muni_list()`'s `place_dim.governance_code` join in
[`155_budget_serving.sql:668`](../../scripts/db/schema/pg/155_budget_serving.sql:668)), with
ambiguous cases **refused and named**, not guessed.

**Do not build this as a bare name-fold.** The village-mayor plan's F0 is the cautionary tale:
`resolveByName` matched on município name alone and silently merged two different municipalities
that share a name (`"Бяла"` → Варна *or* Русе), discarding one bundle's mayor entirely. The same
ambiguity exists in `declaration.institution` strings — nothing here yet proves it's inert for
this table, and it should be checked, not assumed away.

Proposed approach, cheapest-safe-first:

1. **Fold, don't string-match.** Normalize `declaration.institution` the same way the rest of the
   person layer folds names (case, whitespace, separator-only — the `isSpouseHolder`/
   `foldJudicialName` pattern this repo already uses for exactly this class of typo) before
   comparing to `place_dim.name_bg`.
2. **Where the fold is still ambiguous** (matches >1 `obshtina_code` — e.g. a future "Бяла" or
   "Средец" collision reappearing here), **refuse rather than guess**, and log the ambiguous
   institution strings by name so they can be resolved by hand. This mirrors
   `aop_expert_person_links()`'s discipline (25 of 88 resolved automatically, 33 refused and
   reported, never silently graded).
3. **For the residue that still doesn't resolve** (spelling variants like `"Бобовдол"`), a small
   committed override list is fine at this scale — ~265 municipalities, a handful of variants —
   rather than a general fuzzy-match algorithm. Follow the `person_slug_retired` /
   `retired_eik_of` precedent: a short, explicit, auditable table beats an automated near-match
   that can silently misfire on the *next* new spelling variant.
4. **Gate it.** A data test asserting: every muni-tier `institution` value with `position_title`
   in (`Кмет`, `Заместник кмет`, …) resolves to **exactly one** `obshtina_code` or is in a named
   refusal list — same shape as `declaration_filed_position.data.test.ts`'s exhaustiveness sweep.

This resolver is useful independent of T2 — anything that ever wants to place a municipal
declaration on a map or join it to `obshtina_population`/`municipal_fiscal` benefits from it, so
it's worth landing as its own small piece rather than inlining ad hoc into T2's function.

---

## T2 — Serving aggregate + UI: mayor pay vs population

**Shape:** one hand-written PG function, e.g. `mayor_pay_by_obshtina()`, following
[`municipal_fiscal_by_obshtina()`](../../scripts/db/schema/pg/149_municipal_fiscal.sql:327) /
[`budget_muni_list()`](../../scripts/db/schema/pg/155_budget_serving.sql:654):

- Per municipality (resolved via T1): the **sitting mayor's** latest-fiscal-year declared labor
  income (`declaration_income.category = 'Годишна данъчна основа от трудови доходи'`,
  `eur_declarant` only — never sum declarant + spouse, per the existing `incomeTotals` rule at
  [`CandidateAssetsScreen.tsx:342`](../../src/screens/CandidateAssetsScreen.tsx:342)), the fiscal
  year it covers, `obshtina_population.population`, and a computed
  `income_per_1000_residents_eur` (the useful direction here is **inverted** from the usual
  per-capita pattern: a small município's mayor costing *more* per resident is the story, not
  less — make sure the sort/labeling doesn't quietly borrow "lower is better" framing from the
  budget per-capita pages, where it's the opposite intent).
- One route in `functions/db_routes.js` (`"mayor-pay-by-obshtina"` or similar), following the
  existing `"municipal-fiscal-ranking"` route's shape.
- One hand-written screen + hook (**not** a `db_table.js` registry resource — the existing
  `useMunicipalFiscalRanking.tsx` header comment states the reasoning explicitly: 265 rows fits in
  one request, and registering it would add "a view, a column registry and a search fold to serve
  a set small enough to hold in memory").

**Where it lives** — two placements, not mutually exclusive:

- **A new stat card on the existing per-municipality page**, `/governance/:id` (`MyAreaScreen`),
  alongside `MyAreaMunicipalFiscalTile` (which already renders `population` +
  `commitments_per_capita_eur` on that same page) — the natural "your mayor's declared pay in
  context" tile.
- **A dedicated ranked view** for the cross-municipality comparison (see §2, UI brainstorm) —
  either its own small screen, or a new stacked section on `GovernanceMunicipalFinanceScreen` (no
  tabs, per this repo's UX convention — a new section, not a second tab).

**Non-goal, stated explicitly:** this plan does **not** propose extending `officials_rankings_table`
to carry income for all ~25,000 declarants. That's a much bigger lift (income has no single
"headline" figure the way net worth does — see the multi-category `declaration_income` rows for
Nesebar's mayor in the audit, rent + company profit alongside salary) and isn't needed to answer
the article's specific question, which is about ~265 mayors specifically. If a general "who earns
the most" feature is wanted later, scope it separately.

---

## T2b — Statutory pay-band reference data (optional, lower priority)

A small, hand-curated, committed dataset (`data/officials/kmet_pay_bands.json`, in the spirit of
`data/procurement/aop_experts.json`) transcribing the CM decree's population-tiered min/max kmet
compensation bands for the relevant year(s). Lets a served figure carry a
`withinBand`/`atCeiling`/`noReferenceData` badge instead of a bare number.

This is genuinely optional — it answers "is this legal", which the article itself only gestures at
("на хартия всичко може да е напълно законно"), and it requires manually transcribing a legal
document rather than deriving from data we already ingest. Worth doing if this ships as a
standalone feature people will scrutinize; skippable if it's just one more tile.

---

## T3 — `place_dim.kind='obshtina'` hygiene (DONE, and smaller than planned)

**⚠️ Re-scoped on implementation: half of the conflation this section flags was already
documented, just not by me.** `117_place_dim.sql`'s own header (lines 24-29) explains in
detail why the 6 continent placeholders share `kind='obshtina'` with real municipalities —
deliberate, so `person_role`'s labels stay byte-identical to the source file. It does NOT
give the same explicit rationale for Sofia's 24 within-city district codes; those are only
exemplified once, in passing, at line 15 ("the app's obshtina code (BLG11, S2309)"), which
is a much thinner form of documentation than the continents get. My first (wrong) count of
295 was still mostly a symptom of not having read the file yet, not of a genuine
undocumented gap — but "already documented" overstates it for the district half. A
`kind`-value split was never warranted and was not attempted — it would touch a shared
dimension table with consumers this plan never audited (`budget_muni_list()`,
`municipal_officials_table`, the council corpus, …), for a real-vs-not distinction the header
already explains for one of its two components.

**What shipped instead**: one paragraph added to `117_place_dim.sql`'s header giving the
actual gap — not "why does the mixing exist" (already answered, at least for the continents)
but "how do I filter to real EKATTE municipalities only", since nothing stated the
shape-based recipe (`code ~ '^[A-Z]{3}[0-9]{2}$' OR code = 'SFO_CITY'`) before
`186_mayor_pay.sql` had to work it
out independently. The new paragraph names `186_mayor_pay.sql` as a worked example; the
reverse link does not exist — `186_mayor_pay.sql` itself was not touched in this step, so
the cross-reference runs one direction only. No schema or data change; no
`kind`-value split.

---

## 2. UI visualization brainstorm

None of these are decided — options to react to. All follow this repo's existing visual
conventions: no sparklines (axed chart / numeric columns / dumbbell row instead — see the
`feedback_no_sparklines` convention), no tabs (stacked sections), one shared tooltip, MpAvatar on
any person-identified row, and charts must live in a measured-width container (no fallback width).

### A. Scatter: population (log-x) vs declared pay (y)

One dot per municipality. This is the most literal rendering of the article's own question — "does
pay track responsibility/scale" — and a log-x axis is necessary since population spans ~1,500
(Anton) to well over a million (Sofia). Optionally color/highlight the article's 5 small-town
mayors and 3 oblast-city mayors so a reader can find the exact story that prompted the page.
- **+** Directly shows the (near-)inverse relationship the article claims exists.
- **+** If T2b ships, a shaded statutory-band ribbon turns "does the pattern hold" into "who sits
  outside their own legal band" — the sharper, harder-to-dispute version of the question.
- **−** A scatter of 265 points needs care to stay legible (labels can't all show at once); needs
  hover/tooltip-driven identification rather than static labels, and a mobile fallback.
- Natural home: a dedicated exploratory section, since it doesn't fit as one stat-card tile.

### B. Ranked bar chart, sorted by pay-per-1,000-residents

The single "efficiency" number that best captures the article's own framing, sorted descending —
small-population outliers (Anton, Nedelino) will visibly dominate the top. This *is* the
inverted-per-capita metric T2 computes.
- **+** One clear sort answers "who costs the most per resident they represent," no chart-reading
  skill required.
- **+** Mirrors the existing `/governance/municipal-finance` convention of defaulting to a
  per-resident sort *because* absolute ranking is "a trap" (Sofia tops everything) — same
  rationale, same fix, already precedented in this codebase.
- **−** A 265-bar chart is really a sorted table with a bar affordance past the top ~20-30; decide
  up front whether this is a "top 20" headline chart with the full list as a table underneath, or
  the table's own sort column.

### C. Dumbbell rows for a curated top-N

Per this repo's explicit sparkline-replacement convention: one row per municipality, two dots on a
shared axis (declared mayor pay vs. either the national median mayor pay, or — if T2b ships — the
municipality's own statutory band ceiling), connected by a line. Directly shows over/under at a
glance for a short curated list (e.g. the 10-15 largest gaps either direction).
- **+** Exactly the pattern this repo already prefers over a sparkline for "compare two numbers
  per row."
- **+** Reads well as a compact list; no log-scale headache like the scatter.
- **−** Needs a defensible "N" to curate to (top gaps by ratio? by absolute BGN? both, as two
  lists?).

### D. Per-municipality stat card on the existing `/governance/:id` page

A compact two-line tile next to the existing `MyAreaMunicipalFiscalTile`: mayor's declared pay for
the year, the municipality's population, and one derived sentence ("N-ти по големина от 265 общини
по население, M-ти по заплата на кмета" or similar rank-contrast framing). No chart — just two
numbers and their tension, following the existing tile's own shape.
- **+** Cheapest to build; reuses an existing page and an existing tile's layout.
- **+** Answers the question a reader most plausibly has ("what about *my* town") rather than the
  cross-municipality story.
- **−** Doesn't by itself deliver the "look at this whole pattern" story the article and options
  A-C are for; more a complement to those than a substitute.

### E. Oblast-grouped strip plot (small multiples)

One row per oblast (28), dots for each of its municipalities' mayor pay. Tests whether the
pattern clusters regionally — e.g. do coastal/tourist municipalities (Nesebar, Balchik) pay
systematically more, which would be a legitimate, article-omitted explanation (seasonal service
load the population figure alone doesn't capture) rather than pure anomaly.
- **+** The one option that could surface a *counter-argument* to the article's framing, which is
  worth knowing before publishing anything ourselves — editorially honest either way it comes out.
- **−** More exploratory/analytical than reader-facing; probably a research step before deciding
  what to publish, rather than a shipped visualization itself.

### F. Sortable/searchable table of all resolved municipalities (the likely backbone)

Mayor (with `MpAvatar`), municipality, population, declared pay, pay-per-1,000-residents, fiscal
year, and (if T2b ships) a within/at-ceiling badge. Default sort: pay-per-1,000-residents
descending, matching the municipal-finance per-capita convention. This is the "let a reader look
up their own town or verify a claim" utility layer, and probably the piece that has to exist
regardless of which chart(s) sit above it — a small municipality-count table like this fits the
`useMunicipalFiscalRanking` "not a DbDataTable, one request" pattern from T2.

**Suggested framing if this ships as a real page** (not required for the brainstorm, but worth
naming): a hub-shaped head — headline KPI (e.g. "median pay-per-1,000-residents: small
municipalities vs oblast cities"), option A or B as the visual centerpiece, table F underneath —
is the shape this repo's `dashboard-hub` skill exists to structure; worth invoking it if/when this
moves from brainstorm to build.

---

## 3. Ordering

1. **T0** — re-run `update-officials`, document residual non-filers as a coverage caveat.
2. **T1** — the resolver, gated. Blocks T2 and de-risks the "22 missing" number (some of it is T1,
   not T0).
3. **T2** — the serving function + route + minimal UI (start with **D**, the stat card, as the
   cheapest end-to-end slice; then **F**, the table; then pick one of **A/B/C** as the headline
   visual once the data's shape is visible in practice).
4. **T2b** — optional, revisit after T2 ships if the "is this legal" framing is wanted.
5. **T3** — small, independent, land whenever convenient.
