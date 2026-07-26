# "Плащане за резултат" — the grounded subset — v1

Date: 2026-07-25. Status: **DRAFT — §6 open questions RESOLVED against the data
2026-07-25**. Owner: TBD.

> **Precedence: §8 > §7 > §6 > everything above.** §6 changed W1's denominator
> (§6a), downgraded W2 (§6b) and settled W3's route (§6c); the headline figures
> in §1a are restated on the corrected basis in §6a — **use those, not §1a's**.
> §7 then established that W2's data source is reachable after all, so §6b's
> "blocked" status is withdrawn while its methodological guards stand. §8 covers
> filling `nzok_activities` and documents a **correctness bug in the currently
> shipped annual matrix** (renamed hospitals double-counted) — read §8d before
> touching anything that aggregates activity by facility.

Origin: an analysis of the GO Lab (Blavatnik School, Oxford) primer on
**outcomes-based contracting** (OBC) — payment contingent on measured change in
service users' lives rather than on inputs or activities — read against our own
procurement corpus.

**The conclusion that scopes this plan: OBC does not exist in the Bulgarian
procurement data, and no field could record one.** So this plan does NOT build an
OBC layer. It builds the three things the corpus *does* support, each of which is
adjacent to the outcomes question, and it writes down explicitly what we are
refusing to build and why (§4). Everything below was measured against the live
corpus on 2026-07-25, not assumed.

---

## 0. The measurements that justify the scope

403,153 contracts (€92.7bn), 232,260 tenders in Postgres.

### 0a. There is no payment-for-outcome instrument in the corpus

Neither `contracts` (001) nor `tenders` (009) carries a performance indicator, a
payment trigger, a penalty (неустойка), a delivery date, or any post-delivery
field. The corpus records **award**, not **execution**. Annexes (`tag =
'contractAmendment'`, 3,487 rows) record value movement, not outcome.

`tenders.award_method` is sometimes mistaken for the outcomes signal. It is not:
it is the ЗОП чл. 70 **bid-evaluation rule applied at award time**, before any
delivery. MEAT ≠ outcomes-based. The plan must never conflate them, and §1's copy
is written to prevent exactly that.

### 0b. The OBC policy domain is nearly absent from procurement

| CPV | Contracts | Value |
|---|---|---|
| 853x социални услуги | 238 | €70M |
| 85xx health & social (all) | 1,528 | €143M |
| 80xx образование | 1,334 | €98M |

0.15% of the corpus. The structural reason is not under-publication: Bulgarian
social services are funded as **делегирани държавни дейности** — budget transfers
to municipalities and licensed providers — so the money OBC would target never
becomes a procurement contract. It sits in `data/budget/` (incl.
`municipal_transfers/`), where there is no counterparty and no outcome field
either. **No ingest fixes this.** It is a finding, publishable as such (§4).

### 0c. What the corpus DOES support

Three things, each measured and confirmed below: the award-criterion mix (§1),
one more leg of the unit-cost family (§2), and the consolidation of that family
into a single honest concept (§3).

---

## 1. W1 — Критерий за възлагане (award-criterion lens)

**New. Cheap. Nothing on the site aggregates this today.** `award_method` is read
in exactly three places (`TenderDetailScreen.tsx`, `lib/tenderTypes.ts`,
`lib/tenderTransparency.ts`) and rendered only on the individual tender page.
There is no corpus-wide view.

### 1a. The measured finding

| ЗОП чл. 70 criterion | Tenders | Est. value |
|---|---|---|
| Най-ниска цена | 80,769 | €39.0bn |
| Оптимално съотношение качество/цена (MEAT) | 30,712 | €37.7bn |
| Ниво на разходите (life-cycle cost) | 680 | €143M |
| combined (two criteria named) | 638 | €525M |
| **blank** | **119,461** | **€62.1bn** |

Three things fall out, all defensible:

1. **MEAT share is flat-to-declining.** Of criterion-bearing tenders: 27.6% in
   2020 (2,058/7,451) → 26.2% in 2025 (5,643/21,570). Not a rising quality
   orientation.
2. **It is used in the wrong category.** MEAT share by `contract_type`: works
   **52.4%**, services **24.2%**, goods **17.6%**. Quality-weighted evaluation is
   concentrated in construction and is *least* used in services — the inverse of
   where outcome thinking belongs.
3. **Life-cycle costing — the criterion closest to value-over-time — is 0.6%**
   (680 tenders, €143M).

### 1b. HARD constraint — the field starts in 2020

`award_method` is a ЦАИС ЕОП-era field. Population by year:

| Year | with criterion | blank |
|---|---|---|
| 2018 | 0 | 11,850 |
| 2019 | 0 | 12,135 |
| 2020 | 7,451 | 840 |
| 2025 | 21,570 | 2,451 |

**Any trend line MUST start at 2020 and MUST show the blank count.** A 2018–2026
series would render a data-availability cliff as a policy change — the single
worst failure mode available here. The tile carries the coverage counter in the
same payload, the way `procurement_benchmarks` (037) already does for
`number_of_tenderers`.

Residual blanks 2020+ (~10–11%/yr) stay visible as "не е посочен", never dropped
silently and never redistributed pro-rata.

### 1c. Build

- **SQL: `procurement_award_criteria(p_from text, p_to text) → jsonb`**, new file
  `scripts/db/schema/pg/101_procurement_award_criteria.sql`. Modelled directly on
  `procurement_benchmarks` (037): scope-windowed, `STABLE`, jsonb out, coverage
  counters riding along in the same payload.
  - Buckets: `price` / `meat` / `lcc` / `combined` / `unknown`. Bucketing is by
    `LIKE` on the Bulgarian criterion strings (the seven observed values are
    listed in §1a) with an explicit `combined` bucket for the semicolon-joined
    ones — never a naive `LIKE '%качество%'` that would swallow the combined rows
    into MEAT and overstate it by 600 tenders.
  - Emits per-year rows AND a by-`contract_type` cross-section (the §1a finding 2
    is the interesting half; a bare national share is not).
  - Value sums come from `estimated_value_eur` and are therefore **forecasts**.
    The 009 quarantine comment is law: these are labelled прогнозна стойност in
    the payload key name (`estimatedEur`, not `eur`) so no consumer can mistake
    them for spend. The tile leads with counts; value is secondary.
- **Route**: register in the existing `/api/db` fn registry alongside
  `procurement_benchmarks`.
- **Tile**: `src/screens/components/procurement/AwardCriteriaTile.tsx`, placed in
  the existing "Конкуренция и риск" `DashboardSection` of
  `ProcurementOverviewScreen.tsx`, next to `ProcurementBenchmarksTile` — it is the
  same class of indicator (how we buy), served the same way.
  - Render: 100% stacked bars per year (2020+) with the blank band drawn in a
    neutral grey and labelled, plus a three-row by-type strip. Per
    `feedback_no_sparklines`, no sparkline; per `reference_measured_width_no_fallback`,
    no fallback width.
  - Copy discipline: "критерий за оценка на офертите", never "плащане за
    резултат". A one-line footnote states the field starts in 2020.
- **i18n**: BG + EN strings; BG natural, not word-for-word (`feedback_bg_language`).
- **Tests**: `scripts/db/tests/award_criteria.data.test.ts` (PG gate, auto-skips
  when Postgres is down, per `docs/testing-standards.md`) asserting (a) buckets
  partition the corpus — Σ buckets == total tenders in window, (b) the combined
  rows land in `combined` and not in `meat`, (c) 2018/2019 return `unknown` only.
  Component test for the tile's blank-band rendering.

### 1d. Effort

Small. One SQL file, one tile, one test file. No ingest, no new source, no crawl.

---

## 2. W2 — €/случай за болница (NZOK cost-per-case, case-mix aware) — **see §6b + §7**

> Investigated 2026-07-25: `nzok_pathway_tariffs` is empty and `proc_type` alone
> explains only ~9% of the €/case variance, so the raw per-hospital tile stays
> unbuildable (§6b). But the tariff source **is** reachable — §7 locates the price
> tables inside the main НРД PDF and validates a prototype at 86% case coverage.
> W2 is an ingest task, not a blocker.


The unit-cost family already has two shipped legs; this is the third, and the data
is already loaded.

| Leg | Status | Where |
|---|---|---|
| €/свършено дело (courts) | **SHIPPED** | `src/screens/judiciary/CostPerCaseTile.tsx` + `src/data/judiciary/costPerCase.ts` |
| €/km (roads, АПИ) | **SHIPPED** | `RoadCostPerKmTile` / `RoadCostBenchmarkTile`, engine `src/lib/roadAttributes.ts` |
| €/случай (hospitals, НЗОК) | **not built** | data present — this workstream |

### 2a. Feasibility — measured, the join works

`nzok_hospital_payments` (045) × `nzok_activities` (053) on `(eik, year)`:

- 258 payment EIKs, 246 activity EIKs, **237 in both** — a 92%/96% match, good.
- 2025: €2,162M over 3,740,394 cases → **€578 per case** nationally.

### 2b. HARD constraints

1. **`nzok_activities` holds ONE period (2025-01-01).** This is a **cross-section,
   not a trend.** The judiciary tile's whole finding is its 2.6× climb; this tile
   cannot make a time claim at all and must not borrow that shape. Render it as a
   per-hospital distribution/ranking for one year, with the year in the title.
2. **Case-mix is the confound, and it is the entire point.** Per
   `project_diagnoza_competitive_audit`, an unadjusted €/case ranking reproduces
   exactly the error we criticised: a cardiac-surgery hospital and a rehab
   hospital are not comparable. The tile therefore reports €/case **within
   comparable case-mix groups**, using the `procedure` / `proc_type` grain already
   in `nzok_activities`, and states in copy that the raw national €578 is a
   denominator, not a verdict.
3. **The annual denominator is `max(cumulative_eur)` within the year** (the field
   is YTD). 2024 and 2025 each carry 11 distinct monthly periods, not 12 — fine
   for an annual figure taken at the December row, wrong for a monthly series.
   Guard: only use a year whose December period exists.
4. Unmatched EIKs (21 payment-side, 9 activity-side) are excluded and **counted in
   the footnote**, per `no silent caps`.

### 2c. Build

- **SQL**: `scripts/db/schema/pg/102_nzok_cost_per_case.sql` — a `STABLE` fn
  returning per-EIK `{eur, cases, eurPerCase, topProcedures[]}` for a given year,
  plus the national figure and the coverage counters. `EXPLAIN ANALYZE` on the
  worst-case hospital before merge (`feedback_db_query_perf`).
- **Tile**: in the НЗОК pack on `/awarder/121858220`, alongside the existing
  case-mix work (`project_nzok_dashboard_v2` Tier 1).
- **Tests**: PG gate asserting the join coverage counters, the December-period
  guard, and that no hospital appears with cases = 0.

### 2d. Effort

Medium. No ingest — but the case-mix grouping is a real design decision and should
not be rushed into a naive ranking.

---

## 3. W3 — name the family: "Цена за единица резултат"

Today the three legs are three unrelated sector tiles. Nobody can find them, and
each re-states its methodology caveat in its own words.

### 3a. What ships

1. **One shared methodology page** — `/data/methodology/unit-cost` (an
   `ArticleLayout` doc page per `project_article_layout`), stating once:
   - the metric is **cost per unit of delivered service**, not an outcome;
   - what it cannot tell you (attribution — the GO Lab critique, stated plainly:
     a falling €/case does not mean better courts, and a rising one does not mean
     waste);
   - the scope-matching rule the judiciary tile already follows (courts'
     appropriation over courts' cases — never total judiciary budget over court
     cases), generalised as the family's first law;
   - the case-mix rule (W2) as its second.
2. **A cross-sector index tile** on the sectors hub linking the three legs, each
   with its headline figure, its year, and its coverage.
3. **Backlink**: each of the three tiles footnotes to the methodology page instead
   of re-explaining itself.

### 3b. Explicitly NOT a score

No composite "efficiency index" across sectors. €/case, €/km and €/case-in-health
are not commensurable, and averaging them would manufacture a number with no
referent. The family is a **shared method**, not a shared scale. This mirrors the
normalcy panel's rule (`procurement-normalcy-v1`): position, never verdict.

### 3c. Effort

Small-to-medium, and it is what makes W2 worth building — the third leg is what
turns three tiles into a concept.

---

## 4. Explicitly NOT doing — and why

Each of these was considered and rejected on evidence, not appetite.

| Rejected | Reason |
|---|---|
| An OBC / payment-by-results scoring layer | §0a — no field records a payment trigger, a performance indicator or a penalty. Any score would be invented. |
| Ingesting Bulgarian social impact bonds / SIBs | The instrument does not exist in ЗОП. Nothing to ingest. |
| Reading `award_method` as an outcomes signal | §0a — it is bid evaluation at award time, not payment on delivery. The two must stay separate in copy and in code. |
| Any `award_method` trend before 2020 | §1b — the field is unpopulated (24k tenders, 2018–19). A pre-2020 line renders a schema cliff as a policy shift. |
| The framework-agreement share | Only 0.5% of tenders carry `is_framework_agreement = true` (1,073 / 232,260). Implausibly low for this market; reads as a coverage defect in the flag, not a fact. **Do not publish until the ЦАИС field population is checked.** |
| €/ученик (cost per pupil) as a fourth leg | `schools` (055) carries НЕИСПУО id, scores and exam-cohort `n` — **no enrolment and no per-school budget**. `latest_n` is exam takers, not pupils; using it as a denominator would be wrong. Feasible only after a единен разходен стандарт ingest — a separate plan, not this one. |
| An NZOK €/case time series | §2b(1) — `nzok_activities` has one period. Cross-section only until more years land. |
| A "social services" dashboard | §0b — €70M across 238 contracts. Too thin to carry a view. |

### 4a. The one thing that IS publishable without building anything

§0b is an article, not a pipeline: **"Защо в България не се плаща за резултат"** —
the CPV-853x emptiness (238 contracts, €70M) plus the делегирани дейности
explanation plus — the strongest leg, found in §6a — **CPV 85 having the lowest
MEAT share of any major division at 9.9%**, and the ЗОП social-services regime
running 140 lowest-price awards against 58 MEAT. Grounded entirely in figures
already measured here. Route it through `naiasno-post` / `ArticleLayout` when W1 ships, so
the article can link the award-criterion tile as its evidence.

---

## 5. Sequencing

1. **W1** first — smallest, fully self-contained, and it produces the evidence
   surface the §4a article needs.
2. **§4a article** — once W1 is live and linkable.
3. **W2** — the case-mix design decision gets its own review before code.
4. **W3** — last; it is the consolidation, and it needs all three legs to exist.

W1 and W2 touch disjoint files and can run in parallel if desired. W3 must not
start before W2 merges (it would ship a two-legged "family").

## 6. Open questions — RESOLVED (investigated 2026-07-25)

All three were settled by querying the corpus. Two of the three answers changed
the plan materially.

### 6a. W1 bucketing + denominator — RESOLVED, and the denominator was WRONG

**The bucket set is closed and clean.** `SELECT DISTINCT award_method` returns
**exactly 7 values**, zero untrimmed variants, zero empty strings (the blank is
`NULL`, 119,461 rows — a clean `IS NULL` test, no `NULLIF(TRIM(...))` dance
needed). The three composite values are semicolon-joined and appear in one
canonical order only (`Оптимално…; Най-ниска цена`, never the reverse), so the
`combined` bucket is a small exact-match set, not a parsing problem.

**`lots` carries no per-lot criterion.** The jsonb has exactly 8 keys — `lotId`,
`name`, `cpv`, `nuts`, `tenderId`, `currency`, `estimatedValueNative`,
`estimatedValueEur`. The criterion is procedure-level only, so a lot-weighted
analysis is impossible and must not be attempted. Unit of analysis = the tender.

**Each row is one procedure, not one publication.** 126,733 rows 2020+ →
126,733 distinct `ocid` and 126,733 distinct `tender_id`; zero ocids appear
twice. No double-counting risk.

**The finding that changes the design: the residual blank is not missing data —
it is the no-call procedure family.** Of 13,934 blanks 2020+, **13,835 (99.3%)
are `notice_type = 'Решение по чл. 22, ал. 1 от ЗОП'`** — decision notices for
procedures opened without a call. Blank rate by `procedure_type`:

| procedure_type | rows 2020+ | blank |
|---|---|---|
| Открита процедура | 37,542 | **0.2%** |
| Публично състезание | 35,110 | **0.0%** |
| Събиране на оферти с обява | 33,504 | **0.0%** |
| Покана до определени лица | 2,164 | **0.0%** |
| Договаряне без предварително обявление | 8,060 | 86.0% |
| Пряко договаряне | 6,902 | 82.9% |
| Договаряне без предварителна покана | 932 | 74.7% |
| Договаряне без публикуване на обявление | 80 | 81.3% |

A procedure with no call has no competitive evaluation, so it has no criterion.
**The blank is a category, not a gap.**

**Consequences for §1c — supersedes it:**

1. **The denominator is competitive procedures**, excluding the no-call family —
   the *same* exclusion `procurement_benchmarks` (037) already applies for its
   `singleBidder` indicator. Extract that predicate into one shared `IMMUTABLE`
   SQL helper and have both 037 and the new fn call it, following the
   `awarder_risk_grade_frac` precedent in `procurement-risk-v2` §0a. Two
   definitions of "no-call" drifting apart is a real failure mode here.
2. On that denominator, **coverage is effectively complete**: blank falls to 0.24%
   (2020) → 0.02% (2025) → 0.00% (2026). The §1b coverage-counter caveat stays in
   the payload but stops being the tile's headline caveat.
3. **The no-call family is reported as its own band** — "без критерий: няма
   конкурентна оценка" — which is a finding, not a footnote.

**Restated headline figures (competitive denominator, 2020+) — use these:**

| Year | competitive tenders | MEAT | LCC | blank |
|---|---|---|---|---|
| 2020 | 7,147 | 28.5% | 0.67% | 0.24% |
| 2021 | 16,718 | **30.2%** | 0.63% | 0.17% |
| 2022 | 19,068 | 28.7% | 0.78% | 0.14% |
| 2023 | 16,720 | 29.3% | 0.65% | 0.14% |
| 2024 | 19,701 | 28.7% | 0.51% | 0.08% |
| 2025 | 20,936 | 26.8% | 0.65% | 0.02% |
| 2026 (part) | 9,552 | 25.0% | 0.55% | 0.00% |

The trend is **sharper than §1a's**: MEAT peaked at 30.2% in 2021 and has fallen
every year since to 26.8% (2025). By type: works **52.7%**, services **24.8%**,
goods **18.0%** — §1a's finding 2 survives unchanged.

**New finding, and it is the one that ties W1 to the OBC theme.** MEAT share by
CPV division on the competitive denominator:

| CPV | tenders | MEAT |
|---|---|---|
| 45 строителство | 26,424 | 52.2% |
| 79 бизнес услуги | 3,704 | 25.2% |
| 80 образование | 276 | 23.2% |
| **85 здравеопазване и социални** | **870** | **9.9%** |

And in the ЗОП lighter regime for social services ("Социални и други специфични
услуги", 267 notices): 140 lowest-price vs 58 MEAT. **The domain where outcomes
matter most is the domain bought most purely on price.** This belongs in the tile
and is the empirical spine of the §4a article.

### 6b. W2 case-mix grouping — RESOLVED: BLOCKED, and §2 is downgraded

The right design was already architected and is unbuildable today.

**`nzok_pathway_tariffs` (059) is EMPTY — 0 rows, 0 НРД years.** The table, the
`nzok_pathway_tariff_latest` view and `load_nzok_tariffs_pg.ts` all exist and are
explicitly built for "the case-mix expected-vs-actual signal", but
`data/budget/nzok/pathway_tariffs.json` was never produced: **nhif.bg is IP-gated
and the fetch has never run from Bulgarian egress.** Tariff coverage of the
activity corpus is 0 of 571 procedure codes, 0 of 4.43M cases.

So the tariff-weighted expected cost — `expected = Σ cases_p × tariff_p`, ratio
actual/expected — is the correct metric and needs one fetch, not new modelling.

**`proc_type` alone is NOT an adequate substitute.** Measured on 197 hospitals
with ≥1,000 cases (2025): `corr(АПр share, €/case) = -0.300`, i.e. the 3-way
КП/АПр/КПр mix explains **~9%** of the variance in €/case. The spread it leaves
unexplained is absurd — **€1 to €2,238 per case, median €559**. Shipping a
per-hospital ranking on a 9%-adjusted metric would be precisely the Диагноза
България error we criticised, with our name on it.

The implausible tail is small and diagnosable — 4 hospitals under €100/case, and
the €1.1/case outlier has only **4 monthly payment rows in 2025** against a
full-year case count. That is a period-mismatch artifact, so any future build
needs a hard guard: **require 11–12 payment periods in the year**, and count the
excluded.

**W2 is therefore restated:**

- **Blocked** on the `--pathway-tariffs` fetch from Bulgarian egress. Not on
  design, not on schema, not on the loader.
- **The one publishable figure today is the national denominator**: €2,162M over
  3,740,394 cases = **€578 per case (2025)**, 237 of 258 payment EIKs matched.
  That is a context number for the НЗОК pack, not a ranking and not a trend
  (`nzok_activities` still holds a single period — §2b(1) stands).
- **Do not build the per-hospital tile until tariffs land.** When they do, it is
  a straight expected-vs-actual build on existing infrastructure.

Sequencing consequence: **W2 moves out of the critical path.** W3 must not wait
for it (§6c).

### 6c. W3 placement — RESOLVED: follow the existing convention

There is already a `<area>/methodology` route convention — five of them
(`budget/methodology`, `benford/methodology`, `risk-analysis/methodology`, plus
the risk-score and vote-flow screens). No need to invent `/data/methodology/…`.

The unit-cost family spans judiciary, roads and health, so it is not a
*procurement* methodology page: its home is the sectors hub (`governance/sectors`,
routes.tsx:1478). **Route: `governance/sectors/methodology`**, screen
`src/screens/sector/UnitCostMethodologyScreen.tsx`, with the cross-sector index
tile on the hub linking to it. `/data` gets a pointer, not a copy.

### 6d. Revised sequencing (supersedes §5)

1. **W1** — unblocked, and the §6a investigation has already specified it fully.
2. **§4a article** — the §6a CPV-85 finding (9.9% MEAT) is now its spine.
3. **W3** — proceed with **two** shipped legs (courts €/case, roads €/km) plus the
   national €578 context figure. The methodology page is *more* useful with W2
   blocked, not less: it is where the tariff gap gets stated publicly.
4. **W2** — deferred until `pathway_tariffs.json` exists. Track it as a data
   blocker, not an engineering task.

### 6e. Still open

- `award_method`'s 7 values are closed **as of this corpus**. Re-run
  `SELECT DISTINCT award_method` after each procurement ingest; if an 8th value
  appears it must land in an explicit bucket, never silently in `unknown`. Make
  that an assertion in the §1c test, not a manual habit.

---

## 7. Producing `pathway_tariffs.json` — W2 is NOT blocked (investigated 2026-07-25)

**§6b is superseded on the blocker, not on the method.** The tariff-weighted
expected-vs-actual design stands; the claim that it needs Bulgarian egress does
not. A prototype end-to-end run from this machine produced tariffs covering
**86% of the case corpus** and reconciling to within ~10% of actual НЗОК
payments. What follows is what the investigation established.

### 7a. Three false premises in the script headers

Both `write_pathway_tariffs.ts` and `write_procedure_names.ts` carry the comment
*"nhif.bg is Cloudflare/IP-gated (403 elsewhere). RUN FROM BG."* All three of the
assumptions behind it are wrong:

1. **nhif.bg is not gated.** `https://nhif.bg/` returns **200** from this
   machine; every annex PDF downloads fine (1.1MB main НРД, 3.3MB amendment, both
   200). No Cloudflare challenge, no 403 — at any point in the investigation.
2. **The 404 was a wrong URL, not a block.** The scripts' documented
   `--page https://nhif.bg/bg/nrd/2025/medical` 404s because the НРД is a
   **multi-year** contract: the real path is **`/bg/nrd/2023-2025/medical`**
   (site index confirms the pattern — `2011/medical` … `2018/medical`,
   then `2020-2022/*`, `2023-2025/*`). A 404 was almost certainly read as "gated"
   and written into both headers, and the tariff work stopped there.
3. **The tariffs are not in an annex at all.** The НРД 2023-2025 medical page
   publishes Приложения 1–21, and none is a price annex. Приложения 17/18/19 are
   the *spec* annexes the names script already parsed — the 18MB local dump
   (`raw_data/nzok/procedure_names_raw/`) contains only boilerplate about devices
   paid *извън цената на КП*, and **no per-pathway price table**. Searching for a
   price annex will never succeed.

### 7b. Where the prices actually are

**Inside the main НРД contract text**, as three tables under consecutive
articles, in `Национален рамков договор № РД-НС-01-2 от 1 септември 2023 г.`
(`/upload/21017/…pdf`, 1.1MB):

| Article | Table | Rows extracted |
|---|---|---|
| **Чл. 368** | КП (клинични пътеки) | 348 |
| **Чл. 369** | КПр (клинични процедури) | 3 |
| **Чл. 370** | АПр (амбулаторни процедури) | 49 |

`pdftotext -layout` renders them as clean fixed-width columns —
**`code | name | обем (planned case volume) | цена`**:

```
 253       Палиативни грижи за болни с онкологични заболявания        5 972      162,00
 260.1     Физикална терапия ... детска церебрална парализа          11 140      108,00
 999       Наблюдение до 48 часа ... след амбулаторна процедура          574      217,81
```

Two bonuses that were not in the original design: the tables carry the **planned
volume** per procedure (a contracted-vs-delivered signal we do not hold anywhere
else), and `pdftotext -layout` sidesteps the glyph-level letter-spacing problem
the script header warns about — that afflicts the *spec* annexes, not this table.

### 7c. Prototype result — the approach validates

A ~20-line throwaway parser (line-start code + a `…  <volume>  <price>` tail
regex, associating continuation lines with the last code seen) over the three
article ranges yielded **400 priced codes**, joined against `nzok_activities`:

| type | codes | matched | cases | **case coverage** |
|---|---|---|---|---|
| КП | 518 | 337 | 2,418,256 | **90.2%** |
| АПр | 46 | 42 | 1,651,463 | **98.2%** |
| КПр | 7 | 3 | 357,319 | 3.3% |
| | | | 4,427,038 | **86.2% weighted** |

**Reconciliation — the real test.** Expected spend on covered cases
(`Σ cases × price ÷ 1.95583`) = **€1,797M**; grossed to full coverage ≈ €2,085M,
against **€2,284M** actual 2025 hospital payments — **ratio ≈ 0.91**. The
residual is explainable and in the right direction: prices used are the
Sept–Dec 2023 table (later amendments raised them), and НЗОК pays devices and
expensive drugs *outside* the pathway price. A first-pass parser landing within
10% is strong evidence the join key, the units and the method are all correct.

Artifacts from the run (throwaway, not repo state):
`…/scratchpad/{nrd_main.pdf, nrd_main.txt, tariffs_proto.json}`.

### 7d. What the real implementation has to get right

The existing `write_pathway_tariffs.ts` scaffolding is reusable — `--dump` /
`--from-dump`, the `P###`/`A##`/`K##` padding map, the `--bgn` conversion, the
idempotent loader. The changes:

- **Fix the source model.** Point at the main НРД PDF, not a page-scraped annex.
  Section by article (368/369/370) rather than scanning the whole document —
  an unbounded scan picks up drug and other tables (674 rows vs 400 when scoped).
- **Fix the two stale headers.** Remove the IP-gate claim from *both* scripts and
  correct the `--page` example to `/bg/nrd/2023-2025/medical`. Leaving it invites
  the next person to re-abandon the same work.
- **КПр needs its own parser.** 3 of 7 codes and 3.3% case coverage: the Чл. 369
  table uses a different row scheme (it carries labels such as `BONK03`). Small
  table, worth hand-checking all 7.
- **Walk the amendment chain, latest-wins.** Prices are revised by
  `Договор № РД-НС-01-2-1 от 20.02.2024` and successors; the amendment PDF has
  280 priced rows in a different layout. `nrd_year` is already the PK's second
  column, so multiple vintages load cleanly — but **the reconciliation above will
  drift until the latest vintage is used**, and a 2023 table against 2025 activity
  is exactly the kind of silent basis error we flag elsewhere.
- **Money basis.** 2023–2025 tables are BGN → `--bgn` at 1.95583. Any 2026+ НРД is
  EUR-native. Never mix vintages in one `nrd_year`.
- **Coverage is a payload field, not a footnote.** Ship `casesCovered /
  casesTotal` per hospital and suppress the ratio below a floor — a hospital whose
  mix is concentrated in uncovered codes must not read as cheap.

### 7e. Revised status

**W2 moves from "blocked on a data fetch" to "a normal ingest task, ~a day."**
It stays behind W1 and the article on sequencing grounds, but §6d's framing of it
as an unschedulable data blocker is withdrawn. The §6b guards survive unchanged
and still bind the eventual tile: the 11–12-payment-period guard, coverage
suppression, and no per-hospital ranking until expected-vs-actual replaces raw
€/case.

One genuinely open item: `nzok_activities` still holds a **single period**
(`2025-01-01`), so this yields one cross-section, not a trend — §2b(1) stands.
**§8 investigates filling it, and found a shipped correctness bug on the way.**

---

## 8. Filling `nzok_activities` (investigated 2026-07-25)

### 8a. What exists vs what we hold

`nhif.bg/bg/hospitalcare-report/activities/{year}` serves **30 monthly XLSX
files**: 2024 (12), 2025 (12), 2026 (6, through June). **2023 and earlier 404 —
that is a hard corpus floor**, so no trend can reach further back than Jan 2024
regardless of effort.

We hold **2025 only**. `period = 2025-01-01` is not January — it is the *annual*
label: `write_activities.ts` deliberately sums the 12 monthly files into one
annual `(facility × procedure)` matrix (20,433 rows) "small enough to commit".
The monthly dimension already survives separately, but only nationally —
`nzok_activity_monthly` (12 rows, `period/cases/zol`), which reconciles exactly
to the annual total (4,427,038).

All 12 monthly 2025 files are already in `raw_data/nzok/activities/` (43MB), and
nhif.bg serves the rest fine (§7a — not gated).

### 8b. Cost of going monthly is negligible

Measured by running the existing `parseActivities` over the local files: the
fold to `(facility, procedure)` yields **~12,626 rows/month** (12,401 / 12,865 /
12,612 for Jan / Jun / Dec). Thirty months ≈ **379k rows** — smaller than
`contracts` (403k). Annual grain for the same span would be ~61k. The 6× is
worth it because monthly is the grain that **aligns with
`nzok_hospital_payments`** (monthly cumulative), which is what removes the
period-mismatch artifact §6b flagged (the €1.1/case hospital: 4 payment months
against a full-year case count).

### 8c. The facility name is not a stable key — and the source is mid-migration

Case-weighted continuity of the folded facility name across year boundaries:

| boundary | facilities | cases carried |
|---|---|---|
| 2024_06 → 2025_06 | 91.1% | **94.95%** |
| 2025_06 → 2026_01 | 87.9% | **88.41%** |

The largest single dropped facility carries **10,267 cases/month** — this is not
small-facility churn. `fold()` and `strongFold()` perform identically (both lift
raw 81.9% → 87.9% at the 2026 boundary); a better string fold will not fix it.

The cause is a **source-side naming convention migration**, from mixed-case trade
names to ALL-CAPS full legal names, rolling gradually rather than breaking cleanly:

| file | facilities | ALL-CAPS | avg name length |
|---|---|---|---|
| 2024_06 | 383 | 45.4% | 25.7 |
| 2025_06 | 387 | 47.8% | 27.9 |
| 2025_12 | 380 | 54.5% | 30.8 |
| 2026_01 | 381 | 54.9% | 30.8 |

(I also tried to split the churn into "name drift" vs "genuine exit" with a token
Jaccard matcher; it produced obvious false pairs — `КОЦ Бургас` → `НЕФРОЦЕНТЪР
БУРГАС` at 0.50, city tokens dominating — so **no drift/exit split is reported
here**. It needs the EIK crosswalk, not string similarity.)

### 8d. Consequence: a correctness bug in the CURRENT shipped annual matrix

The migration happened *during* 2025 (47.8% caps in June → 54.5% in December), so
the annual fold is summing across two naming conventions **inside the year we
already ship**:

- per-month facility count: **378–407**
- union across the 12 months: **487**
- present in **all 12** months: **283**
- in Jan but not Dec: **92**; in Dec but not Jan: **92**

The DB annual matrix reports **479 facilities** — roughly 100 more than exist in
any single month. **A hospital that was renamed mid-2025 appears as two
facilities with its cases split between them.**

How far the damage reaches:

- Aggregating **by EIK is largely safe**: 51 EIKs carry more than one facility
  name (130 facility rows), and the crosswalk re-unites them.
- Aggregating **by facility splits renamed hospitals** — and that is exactly what
  a per-hospital tile would do.
- **154 of 479 facilities (32%) are unmapped (`eik IS NULL`), carrying 487,877
  cases = 11.0% of all cases.** Those cannot be re-united at all.

This compounds §6b: a per-hospital €/case built on the facility key would divide
a renamed hospital's payments by half its cases. Combined with the 11% unmapped,
it is a second independent reason the raw ranking was never publishable.

### 8e. Recommended shape

1. **Ingest all 30 months at monthly grain** (`period` = the real month). Cheap
   (§8b), and it makes the payments join period-exact.
2. **Key every aggregate on EIK, never on facility.** Facility name becomes a
   display label for the latest period only. This is the single change that
   defuses §8c/§8d.
3. **Re-run the crosswalk per period**, not once — new-convention legal names
   should actually match the Commerce Registry *better* than the old trade names,
   so mapped coverage may rise above today's 89% as the migration completes.
4. **Publish coverage as data**: unmapped cases per period. A tile that silently
   drops 11% of national activity is the same failure class as §7d's tariff
   coverage.
5. **Add a rename-detection assert to the loader**: flag any EIK whose facility
   name changes between consecutive periods, and any period where the union of
   facility names exceeds the per-month count by more than a few percent. That
   assert would have caught this before it shipped.
6. **Keep 2024 in scope** — with 2024+2025 full and 2026 half, the case-mix
   metric gets two clean annual comparatives, which is the minimum for saying
   anything about direction.

**Corpus floor to state publicly:** activity data begins Jan 2024. Any "trend"
claim beyond that has no source.
