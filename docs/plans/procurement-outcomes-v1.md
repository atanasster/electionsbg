# "Плащане за резултат" — the grounded subset — v1

Date: 2026-07-25. Status: **DRAFT — audited 2026-08-17 (§10); §6 open questions
RESOLVED**. Owner: TBD.

> **Precedence: §10 > §9 > §8 > §7 > §6 > everything above.** §6 changed W1's denominator
> (§6a), downgraded W2 (§6b) and settled W3's route (§6c); the headline figures
> in §1a are restated on the corrected basis in §6a — **use those, not §1a's**.
> §7 then established that W2's data source is reachable after all, so §6b's
> "blocked" status is withdrawn while its methodological guards stand. §8 covers
> filling `nzok_activities` and documents a **correctness bug in the currently
> shipped annual matrix** (renamed hospitals double-counted) — read §8d before
> touching anything that aggregates activity by facility. §10 is the
> 2026-08-17 audit: it records that **§7 shipped** (tariffs loaded, 95.9%
> coverage, JSON now committed) and **§8d's bug is fixed**, corrects §6a's
> shared-helper instruction, and names the page-artifact gap. Read §10d first
> for current status.

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

## 2. W2 — €/случай за болница (NZOK cost-per-case, case-mix aware) — **see §6b, §7, §10a**

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

> **STATUS 2026-08-17: SHIPPED.** 410 codes loaded, 95.9% weighted case coverage,
> reconciliation 0.978, JSON committed. §7c/§7d are now historical; the one live
> item is that the **cloud publish step is still unnamed**. See §10a-1 / §10c-3.

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

> **STATUS 2026-08-17:** §8d's rename double-count is **FIXED** (0 EIKs with >1
> name; facilities 479→404). The **monthly ingest in §8e is still open** — still
> 1 period. See §10a-2.

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

---

## 9. Кайзен (continuous improvement) as an analytical lens — feasibility

Investigated 2026-07-25. **Verdict: measurable on exactly one dataset, and the
answer it returns is negative — which is the finding worth publishing.**

First, a disambiguation that matters: Кайзен is not an entity in our data. The
Commerce Registry holds a handful of small firms by that name (a karate club, a
marketing shop, a consultancy); **none appears in the procurement corpus**, and
there is no Kaizen reference anywhere in the codebase or docs. This section is
about the method as a lens, not a company.

### 9a. The lens, stated as a testable claim

Kaizen means small, continuous, *sustained* improvement in repeated standardized
work. As a data claim on public spending: **for a public body that procures or
performs the same thing repeatedly, does its performance improve incrementally
and persistently, net of what everyone else is doing?**

Three preconditions, tested in order:

1. **Repetition** — the same body doing the same thing many times.
2. **A comparable unit** — so round N is measurable against round N−1.
3. **A metric that can improve, with a stable key over enough periods.**

The word that does the work is **persistently**. One-off gains are noise; Kaizen
predicts a *ratchet*. That distinction is what §9d tests.

### 9b. Precondition 1 — repetition: MET, abundantly

Grouping contracts (2015+) by `(awarder_eik, CPV4)`:

| threshold | groups | share of contracted € |
|---|---|---|
| ≥3 contracts | 18,897 | — |
| ≥5 contracts over ≥3 years | 9,567 | **77.9%** |
| ≥10 contracts over ≥5 years | 3,958 | 65.8% |

Repeated procurement is the norm, not the exception. The structural precondition
is comfortably satisfied.

### 9c. Precondition 2 — a comparable unit: MOSTLY ABSENT

This is where the lens fails for procurement. **`contracts` carries an amount but
no quantity**, so "cheaper per unit" is uncomputable across the corpus. Checking
every candidate that might supply a denominator:

- `nzok_drug_quarterly` — `(inn, quarter, eur)` only. Spend per INN per quarter
  with **no pack/unit count**, so a falling number cannot be separated from
  simply buying less. Unusable as a price series.
- `nzok_drug_overpay` — **100 rows, `period` entirely NULL**. A top-N snapshot,
  not a time series.
- Roads €/km — ~7% of road rows survive the workType + segment-parse guards
  (`project_api_road_effectiveness`). Too thin for per-buyer trends.
- НЗОК €/case — blocked twice over: tariffs (§7) and the rename bug (§8d).
- `price_*` (КЗП) — genuine repeated unit prices over time, but **retail**, not
  public spending. Wrong domain.

### 9d. Precondition 3 — the two metrics we can actually test

**Test A — competition (`number_of_tenderers`): no signal.**

First, the field cannot carry a long series at all. Coverage by year swings
violently — 6.3% (2015), 91.8% (2016), 8.3% (2018), 100% (2020–23), **42.8%
(2024)**, 99.6% (2025). The apparent national collapse in average bidders
(8.52 in 2016 → 2.73 in 2025) is therefore substantially a **coverage artifact**,
not a market fact, and must not be published as a trend.

Restricting to the clean window (2021–23 + 2025; 2024 is a 43%-coverage hole,
2020 a corpus gap) and comparing each buyer×CPV4 group's early vs late mean
bidders **net of that CPV4's own national move** — a difference-in-differences:

| | |
|---|---|
| qualifying groups | 2,785 |
| raw delta | −0.355 bidders |
| **net delta (CPV trend removed)** | **+0.013** |
| net standard deviation | 2.355 |
| improved / worsened | 1,516 / 1,258 (54.5% / 45.5%) |

The net effect is **zero to three decimal places**, with dispersion 180× the
mean, and the improved/worsened split is a coin flip. There is no per-buyer
learning signal in competition. Any "buyer improvement score" built on this
would be noise with a number attached.

**Test B — court productivity (`court_load`): the one real panel, and it
mean-reverts.**

`court_load` is the only substrate that satisfies all three preconditions:
**178–180 courts × 8 consecutive years (2018–2025)**, a stable name key (180→178,
negligible churn), and `resolved_per_month` — which is already normalized per
judge (`corr(judges, resolved_per_month) = −0.191` in 2025, i.e. it is
натовареност, not a court total, so it is not confounded by court size).

National average dips for COVID and recovers: 28.53 (2018) → 25.40 (2020) →
29.36 (2025). The Kaizen question is whether *individual* courts ratchet. Taking
each court's year-over-year change net of the national change:

| | |
|---|---|
| observations | 1,016 |
| **autocorrelation of net YoY change** | **−0.215** |
| mean net change | −0.041 |
| sd | 6.278 |

**The autocorrelation is negative.** A court that improves one year tends to give
it back the next — the statistical signature of noise with mean reversion, and
the precise opposite of a ratchet.

The persistence distribution confirms it. Of 150 courts with all 7 transitions,
counting how many years each beat the national move:

| years improved (of 7) | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| courts | 2 | 26 | 50 | 51 | 18 | 3 | **0** |

**No court improved in all 7 years, and only 3 managed 6.** The distribution is
*more* clustered at 3–4 than a fair coin would produce (binomial(7, ½) over 150
courts expects ~8 at six-of-seven and ~1 at seven) — exactly what mean reversion
looks like. There is no tail of persistent improvers to find, because there are
no persistent improvers.

### 9e. Verdict

**Feasible to compute on `court_load`; not feasible anywhere else; and the
computation returns "no continuous improvement exists."**

That is not a dead end — it is the most publishable thing in this section, and it
sits naturally beside the §4a article. The OBC piece argues Bulgaria buys social
outcomes on lowest price; this adds that where we *can* watch the same public
body do the same work for eight years, it does not get better — it oscillates.
Both are findings about the absence of an improvement mechanism, which is a
stronger joint claim than either alone.

What to do:

1. **Do not build a per-buyer or per-court "improvement score."** Tests A and B
   both say it would be noise. This is the same trap as the §6b €/case ranking.
2. **Do publish the negative result**, as a section of the §4a article or its own
   short piece: 8 years, 178 courts, autocorrelation −0.215, zero persistent
   improvers. State the method (net of national trend) so it is checkable.
3. **Publish the bidder-coverage artifact as a data-quality note**, not a market
   trend. "Average bidders fell from 8.5 to 2.7" is currently a wrong claim that
   our own corpus would support if nobody checked coverage — worth pre-empting.
4. **Revisit only if a unit denominator lands.** The tariff ingest (§7) plus the
   monthly EIK-keyed activity panel (§8e) would create the first genuine
   repeated-unit-cost series in the health data — 30 monthly periods per hospital.
   That is the one place a Kaizen test could later become meaningful, and it
   should be run then, not now.

---

## 10. Audit — 2026-08-17

Re-verified every measured fact in §6–§9 against the live corpus and the repo.
**Three things moved, one recommendation was wrong, and the plan has a
page-artifact gap it never named.** Where §10 conflicts with anything above,
§10 wins.

### 10a. Status changes since §6–§9 were written

**1. §7 (pathway tariffs) is DONE — and beat its own spec.**
`data/budget/nzok/pathway_tariffs.json` now exists (410 codes, `nrdYear` 2025,
EUR, source recorded as „цените по чл. 368/369/370 … от тялото на договора и
изменения") and `nzok_pathway_tariffs` holds 410 rows, €26–€19,672.

| | prototype (§7c) | shipped |
|---|---|---|
| КП case coverage | 90.2% | **93.7%** |
| АПр | 98.2% | 98.2% |
| КПр | 3.3% | **100.0%** |
| **weighted** | **86.2%** | **95.9%** |

The КПр parser gap §7d called out is closed. Expected spend is now €2,142M on
95.9% coverage (≈€2,234M grossed) against €2,284M actual — **ratio 0.978**,
tighter than the prototype's 0.91 and well inside what the vintage and
outside-the-pathway payments explain.

**RESOLVED 2026-08-17 — `pathway_tariffs.json` is now committed** (`42d2e5c9aa`).
It had been swept into the `.gitignore` block for "regenerable loader input",
where it was the odd one out on every criterion that block states: 9 KB against
the 9.9 MB / 1.4 MB described, no `npm run data:nzok --` regeneration command
(the block lists one for each of the other three), and its own sibling from the
same НРД family — `procedures.json` — already committed. Rebuilding it means
re-parsing the НРД contract PDF off nhif.bg, an external source that moves. The
ignore rule was removed with it.

**2. §8d (the rename double-count) is FIXED.**
`nzok_activities` now reports **0 EIKs carrying more than one facility name**
(was 51 EIKs / 130 rows), and facilities fell **479 → 404** — the ~75 duplicate
name variants folded away. Unmapped is essentially unchanged: 156 facilities,
464,783 cases = **10.5%** (was 154 / 11.0%).

**What is NOT done: the monthly ingest.** `nzok_activities` still holds
**1 period** and `nzok_activity_monthly` still 12 rows spanning 2025 only. So
§8a/§8b/§8e stand in full — 2024 and 2026-H1 are still unfetched, the corpus is
still a single annual cross-section, and the payments join is still
period-inexact. §8d's *analysis* is now historical; §8e's *recommendations* are
live.

**3. The contracts corpus reloaded.** `tag='contract'` 403,153 → **405,812**;
§9b's repeat-procurement groups 9,567 → **9,622**. Both §9 conclusions are
unaffected (the §9d tests are ratios and autocorrelations, not counts), and
§6a's `award_method` domain is still **exactly 7 values** — the §6e re-check
passes.

### 10b. Correction — §6a's shared-helper recommendation is WRONG

§6a said the W1 denominator should exclude "the *same* no-call family
`procurement_benchmarks` (037) already applies", via one shared `IMMUTABLE`
helper. Both halves are wrong.

**The sets are not the same.** 037's `no_call` is a four-item list —
`'Пряко договаряне', 'Договаряне без предварително обявление',
'Покана до определени лица', 'direct'`. Against §6a's measured blank rates:

- it **includes `Покана до определени лица`**, which is **0.0% blank** across
  2,164 tenders — a procedure that always carries a criterion. Excluding it
  would drop 2,164 criterion-bearing tenders from the denominator.
- it **omits four genuinely criterion-less types** — `Договаряне без
  предварителна покана за участие` (74.7% blank), `Договаряне без публикуване
  на обявление за поръчка` (81.3%), `Ограничена процедура по ДСП` (43.6%),
  `Договаряне с предварителна покана за участие по КС` (46.4%).

**And they cannot share a column.** 037/011/023 read
`contracts.procurement_method`; W1 reads `tenders.procedure_type`. The two
vocabularies intersect on 17 values but diverge: contracts also carries the OCDS
codes `open` / `limited` / `selective` / `direct` and
`Вътрешен конкурентен избор по РС` (9,893 rows), and **45% of contracts rows
have no method at all** (183,804 NULL/empty).

**Revised instruction:** define W1's criterion-less predicate **independently,
on `tenders.procedure_type`**, derived from measured blank rates rather than
inherited from a contracts-side bucket built for a different question. Do not
refactor 037 to share it. Note separately that the existing `no_call` list is
already restated in **three** files (011 ×3, 023 ×3, 037 ×1) — worth a
consolidation of its own, but that is a different task from W1 and must not be
bundled into it.

### 10c. Gaps the plan never named

**1. The new-page artifact set (affects W3, and any coverage page).** §6c
specifies a route and a screen and stops there. The `/subsidies` workstream that
landed alongside this plan shows what a page actually ships — from
`5efcf16ce8` alone: `public/og/<slug>.png`, a `<loc>` in
`public/sitemap_static_2.xml`, entries in **both** `scripts/prerender/routes.ts`
and `scripts/sitemap/route_defs.ts`, a `scripts/og/capture-screens.ts` case, the
`src/routes.tsx` wiring, **both** locale files, and a `.data.test.ts` gate.
W3 must budget for all of it; a route-plus-screen estimate is roughly half the
work.

**2. There is a precedent for the coverage surfaces, and the plan reinvents it.**
§7d item 6 and §8e item 4 both say "publish coverage as data". `SubsidiesCoverageScreen`
and `SubsidiesUntraceableScreen` are exactly that genre, already shipped, with
og:images and prerender entries. Follow them rather than inventing a shape.
`AgriScopeGate.tsx` is likewise the existing answer to the scope-resolution rule
CLAUDE.md states for any page narrower than its corpus.

**3. The tariff publish path exists but is inert — and §7 never names it.**
Verified: `db:load:nzok-tariffs:pg` is in the `db:refresh` chain and
`db:load:nzok-tariffs:pg:cloud` exists (`package.json:172`). So the plumbing is
fine. The hazard was the interaction with §10a-1: the loader is deliberately
absent-safe — it applies 059 and exits 0 when the JSON is missing — so while the
input was untracked, `:cloud` run from any other machine would have **silently
published nothing**, leaving Cloud SQL with an empty table, a green exit and no
warning. Committing the JSON (§10a-1) disarms that. **What remains open: §7
still never names the publish step.** It must, because nothing runs
`db:load:nzok-tariffs:pg:cloud` automatically and the absent-safe exit means a
skipped publish is invisible on both sides.

**4. No `recent_updates` / changelog wiring is specified** for either the tariff
load or the widened activity ingest, though the repo requires it for anything
that changes a served corpus.

**5. Ownership and gates are still blank.** The header says `Owner: TBD`; W1's
test is referenced as "the §1c test" but never specified; and §6e's
"re-run `SELECT DISTINCT award_method` after each ingest" is written as a habit
rather than as the assertion it asks to become.

**6. English locale is unaddressed** across W1, W3 and the coverage surfaces,
although the artifact set above makes both locale files mandatory.

### 10d. Revised status

| item | status |
|---|---|
| W1 award-criterion lens | ready; denominator per §10b, **not** §6a |
| §4a article | ready; spine is §6a's CPV-85 9.9% |
| W3 methodology page | ready; scope per §10c-1, genre per §10c-2 |
| §7 tariffs | **DONE**, 95.9% coverage, JSON committed; cloud publish still unnamed |
| §8 activity panel | rename bug fixed; **monthly ingest still open** (§8e) |
| W2 per-hospital €/case | now blocked only on §8e, not on tariffs |
| §9 Kaizen | closed — negative result, publish don't build |

The one change of sequencing this implies: **W2 moved up.** With tariffs at
95.9% and the rename bug gone, the only thing between us and the case-mix
expected-vs-actual metric is the monthly EIK-keyed ingest in §8e — which is also
what makes the payments join period-exact. It is now the highest-leverage
remaining data task in this plan.
