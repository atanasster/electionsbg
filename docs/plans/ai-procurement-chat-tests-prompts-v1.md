# Procurement chat: tests and prompt catalog

Status: proposed acceptance specification, 2026-09-12. These are tests to implement, not tests reported as already passing. See the [implementation plan](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-implementation-v1.md) and [executed audit checks](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-audit-v1.md).

## Independent fixture oracle

Build small fixtures with explicit expected answers. Do not generate expectations using the same filter compiler or scorer under test. Use fixed Europe/Sofia time `2026-09-12T12:00:00+03:00`. Local production-shaped data checks supplement these fixtures; they do not replace them with volatile hardcoded national totals.

### Contracts

Use valid fixture identities H (health buyer), R (road buyer), S (supplier) and K (consortium carrier), with a fixture-only sector registry. All rows are contract-tagged unless noted. The medical subject is fixture CPV prefix 33; food is 15; road subject is fixture prefix 45. This intentionally simplified test mapping must not become the production road crosswalk.

| Key | Record date | Buyer | CPV | Bidders | Current EUR | Role / extra condition |
|---|---|---|---|---:|---:|---|
| a1 | 2026-01-01 | H | 33100000 | 1 | 100 | ordinary; signing value 80; verified signing date 2025-12-31 |
| a2 | 2026-01-31 | H | 33100000 | 3 | 200 | ordinary |
| a3 | 2026-02-01 | R | 45233100 | 1 | 300 | ordinary; direct procedure |
| a4 | 2026-12-31 | R | 45233200 | null | null | ordinary; no observed bid/value data |
| a5 | 2026-06-30 | H | 15800000 | 0 | 50 | ordinary; recorded zero is separate from missing |
| a6 | 2026-07-01 | H | 33100000 | 1 | 400 | carrier K |
| m1 | 2026-07-01 | H | 33100000 | 1 | 0 | member S; full consortium amount 400 |
| am1 | 2026-08-01 | H | 33100000 | 1 | 1,000 | amendment event |
| pre | 2025-12-31 | H | 33100000 | 3 | 700 | ordinary |
| next | 2027-01-01 | H | 33100000 | 1 | 800 | ordinary |

Expected 2026 recorded-contract population excluding member rows: a1–a6, **6 records**, **EUR 1,050**, **3 exact-one-bid**, **4 positive-known bidder counts**, **1 zero**, **1 missing**. Exact-one shares: **50% of all**, **75% of positive-known**. Amendment EUR 1,000 is not added; member full value is not added. A null value is excluded from known-value sum but reported as one missing amount. Signing total is EUR 1,030 when all other known values have equal verified signing/current values.

Healthcare-buyer H: 4 records, EUR 750, 2 exact-one, 3 positive-known; shares 50% / 66.67%. Medical subject 33: 3 records, EUR 700, 2 exact-one; shares 66.67% / 66.67%. Their difference proves buyer sector is not purchased subject. Road buyer R: 2 records, EUR 300, 1 exact-one; shares 50% / 100%, with one missing count.

January 2026 includes a1/a2 only: 2 records, EUR 300. Month range 04/2025 through 01/2026 includes pre/a1/a2: 3 records, EUR 1,000. Publication-year 2026 includes a1; signature-year 2026 excludes a1. Add a separate ambiguous/fallback signing-date row for a test that reports unavailable signature knowledge.

For mask tests, fix the following independent truth table for W=`weakCompetition`, P=`pepConnected`, D=`directAward`. A dash means unavailable, not false. These fixtures test filtering of stored masks, not recomputation of the signals from the other fixture fields. Threshold/scorer tests use separate field-level fixtures tied to the catalog.

| Key | W | P | D |
|---|---|---|---|
| a1 | true | true | false |
| a2 | false | false | false |
| a3 | false | false | true |
| a4 | — | true | false |
| a5 | — | false | false |
| a6 | true | false | false |

W OR P has 3 true / 2 false / 1 unknown; its shares are 3/6 of all and 3/5 of evaluable records. W AND P has 1 true / 4 false / 1 unknown. NOT W has 2 true / 2 false / 2 unknown. In particular, true OR unknown is true and false AND unknown is false. Do not calculate composite availability by simply requiring every constituent to be available.

### Tenders and KZK

Create t1/t2 with distinct УНПs and t3 without an appeal. Two complaints c1/c2 link to t1; c3 links to t2; c4 remains unlinked. One merits act d1 links to c1 and c2; one procedural act d2 links to c3; d3 is an unlinked act. Keep the join fixture provenance explicit; do not imply shared acts always give every complaint the same outcome.

Expected counts: **4 complaints, 2 linked appealed procedures, 3 distinct acts**; **1 unlinked complaint and 1 unlinked act**. Joining c1/c2 to d1 must not turn three acts into four or double t1's amount. Assign independently reviewed complaint-level outcomes c1 upheld, c2 rejected, c3 raw outcome null/status refused and c4 outcome null/status suspended pending merits. Effective distribution: one upheld, one rejected, one refused, one unclassified. Upheld rate among these two classified merits outcomes is **50%**; upheld/all complaints is **25%**, a different named measure. The c1/c2 outcomes are fixture evidence, not the output of applying one coarse act label to both parties.

Set c1 complaint date 2025-12-20 and d1 act date 2026-01-10. A 2026 complaint cohort excludes c1; a 2026 act cohort includes d1. Set c2 `vm_requested=true` and effective suspension false; set c4 raw suspension null/status `спряно производство`, producing effective suspension true. Keep refused c3 unsuspended. Requested and granted measures must remain different counts. Add missing/invalid act-date fixtures and unknown historical act kind. Add a separate mixed/partial act fixture proving that current risk classification cannot establish fully successful complaints, plus protected manual/date-only outcomes that a derived rebuild must leave byte-for-byte unchanged.

Use independent tender-risk fixtures for duration 11/12 days, award delays 0/1/4/5 days, and awarded-to-estimate ratios 1.0999/1.10. Include cancelled/expired/future-deadline tenders, unknown status/deadline, fallback signing dates, zero estimate, multiple awards and consortium member rows. Every published percentage needs the matching availability denominator.

## Acceptance matrix

The following **160 named cases** are minimum acceptance scenarios, including 40 added by the plan audit. Several expand into BG/EN variants and catalog-generated cases. Each executable fixture must assert canonical interpretation, applied query and result/error; route-only cases are supplemented by tool/backend integration. Do not add failures to the known-failures allowance.

### Period and interpretation — A01–A20

| ID | Input / condition | Required assertion |
|---|---|---|
| A01 | Exact screenshot prompt | contracts + share + exact-one + calendar 2026; no all-time totals |
| A02 | “с един участник” | Same query as digit 1 |
| A03 | “с една оферта” | Recorded bidder-count interpretation visible; no company extraction |
| A04 | 04/2025 до 01/2026 | `[2025-04-01,2026-02-01)` |
| A05 | април 2025 – януари 2026 | Same as A04 |
| A06 | 15.04.2025–31.01.2026 | Correct day bounds, inclusive end converted once |
| A07 | Q2 2026 / второ тримесечие | `[2026-04-01,2026-07-01)` |
| A08 | Last year / миналата година | Calendar 2025 under fixed clock |
| A09 | Rolling last 12 months | Exact resolved bounds through today, persisted |
| A10 | 29.02.2024 | Valid leap date |
| A11 | 29.02.2025 | Clarification/validation error, no auto-correction |
| A12 | End before start | Error, no swapped silent query |
| A13 | “от април 2025” | Explicit lower bound, visible open upper bound |
| A14 | “до януари 2026” | Upper bound 2026-02-01 |
| A15 | “сравни 2025 и 2026” | Two periods, not a continuous date range |
| A16 | Selected election differs from calendar year | Explicit procurement year wins |
| A17 | “за този парламент” | Existing half-open parliament window |
| A18 | No period, new conversation | All available, labeled; no hidden election default |
| A19 | Requested year absent in data | Exact empty/unavailable result, no latest-year substitute |
| A20 | Clock crosses Dec 31 / Sofia midnight | Correct local-year resolution; historical answer unchanged |

### Entities, sector and domain — B01–B20

| ID | Input / condition | Required assertion |
|---|---|---|
| B01 | Generic healthcare procurement | Clarify buyer versus medical subject, preserve year/measure |
| B02 | “МЗ и НЗОК” | Existing audited buyer set; do not claim all hospitals |
| B03 | Medical CPV33 purchases | Subject scope independent of buyer |
| B04 | Healthcare buyer buying food | Included in buyer scope, excluded from medical subject |
| B05 | “пътища” subject | Reviewed road subject, not all CPV45 and not API-only |
| B06 | “на АПИ” | Stable buyer identity |
| B07 | “мантинели на АПИ през 2026” | Buyer + topic + year all retained |
| B08 | Direct tool org+year | Buyer reaches server even without keyword/topic |
| B09 | “CPV 45” | CPV filter, no methodology substitution |
| B10 | Full CPV with check digit | Canonical code normalization; preserve specificity |
| B11 | Overlapping CPV prefixes | Union deduplicated, no duplicate rows |
| B12 | Two buyer sectors | OR membership; overlapping EIK counted once |
| B13 | Buyer sector plus CPV | AND across dimensions |
| B14 | Unknown sector | Clarify with supported alternatives, no national fallback |
| B15 | Ambiguous supplier name | Candidate chooser, no first-search-hit execution |
| B16 | Exact EIK and company year | Stable company scope and year, not whole-sentence company |
| B17 | Cancelled healthcare tenders | Tender/status route, never budgetFunction |
| B18 | Търговище / търговски фирми | Correct non-tender interpretation |
| B19 | КЗК antitrust / омбудсман | No procurement complaint count without procurement intent |
| B20 | Budget healthcare / road spending | Preserve relevant specialist when no procurement corpus requested |

### Counts, money and risks — C01–C25

| ID | Input / condition | Required assertion |
|---|---|---|
| C01 | Base 2026 fixture summary | 6 records; EUR1,050; one missing amount |
| C02 | Exact-one shares | 3/6=50%; 3/4=75%; one zero, one missing |
| C03 | One-bid numerator filter | Denominator remains full base scope |
| C04 | Healthcare/medical scopes | Independent expected counts and sums above |
| C05 | January date boundary | a1/a2 included, a3 excluded |
| C06 | Cross-year month interval | pre/a1/a2 only |
| C07 | Publication versus signature year | a1 changes membership; basis displayed |
| C08 | Amendment event | Separate count; EUR1,000 excluded from base total |
| C09 | Consortium member | m1 excluded from contract-record population; available in participation unit |
| C10 | Multiple contracts/lots same UNP | Distinct record keys retained |
| C11 | Duplicate release/source fixture | Apply reviewed identity policy; never dedupe by amount/title |
| C12 | Framework allocation | No multiplied ceiling; value label identifies framework basis |
| C13 | Signing/current value | EUR1,030 versus EUR1,050 and coverage |
| C14 | Unknown/zero denominator | No NaN/Infinity or false 0% |
| C15 | Empty filters intersection | Genuine zero with applied scope; not no-company error |
| C16 | Each of 13 contract signal IDs | Available/fired mask filter and explanation; amendment population handled |
| C17 | Two risk flags AND/OR | Correct intersection/distinct union |
| C18 | NOT a risk | Available-and-not-fired only; unknown disclosed |
| C19 | Raw one-bid versus weakCompetition | Distinct outputs on CPV-suppressed baseline fixture |
| C20 | CRI versus contract grade | Ratio versus fired-count bands, including nonmonotone order case |
| C21 | Buyer exposure versus supplier grade | Existing different formulas/attribution preserved |
| C22 | Missing/stale risk metadata | Unavailable status, never zero-risk answer |
| C23 | Contract tender-period dates absent | Requested check unavailable; useful tender alternative explicit |
| C24 | Connected overlaps / neutral NGO disclosure | No doubled contract values; neutral disclosure not scored |
| C25 | Full-set ranking/trend | LIMIT after aggregation; stable ties; monthly totals reconcile, rates weighted |

### Tender and KZK semantics — D01–D20

| ID | Input / condition | Required assertion |
|---|---|---|
| D01 | Tender topic text without listed CPV | Same text-OR-CPV membership in tool/browser |
| D02 | Tender subject and buyer/date/status | All filters reach SQL; no dropped buyer |
| D03 | Open now | Expired/cancelled excluded; missing deadline/status disclosed |
| D04 | Deadline-in-period request | Deadline basis, not publication basis |
| D05 | Non-open tender type | Known procedure semantics; unknown is unavailable |
| D06 | Rushed deadline 11/12 days | Current threshold boundary and competitive tier gating |
| D07 | Award delay 0/1/4/5 days | Only 1 and 4 fire; genuine dates required |
| D08 | Award/estimate 1.0999/1.10 | Exact threshold and positive denominator |
| D09 | Zero estimate/missing awards/duplicate member | Availability and nonduplicated award amounts |
| D10 | UNP plus appeal or risk aspect | Detail retains requested aspect |
| D11 | KZK fixture totals | 4 complaints / 2 linked procedures / 3 acts |
| D12 | Act linked to two complaints | d1 counted once; t1 amount not doubled |
| D13 | Complaint-year versus act-year | c1/d1 cohort distinction |
| D14 | Raw null + refused status | Effective refused, not unknown/rejected/upheld |
| D15 | Interim requested versus suspended | c2 request not counted as granted suspension |
| D16 | Upheld rate | 1/2 merits=50%; explicit all-complaints alternative 1/4=25% |
| D17 | Unmatched KZK records | Remain in national count, linkage coverage shown for sector query |
| D18 | Buyer outside summary top25 | Queried from full complaint corpus |
| D19 | Decision kind null / invalid date | Unknown kind/date coverage, no fabricated classification |
| D20 | Legal finality or historical snapshot requested | Unsupported unless actual evidence supports it; no inferred finality |

### Providers, UI and follow-ups — E01–E20

| ID | Input / condition | Required assertion |
|---|---|---|
| E01 | Model omits explicit year | Block/repair through canonical extraction; never all-time execution |
| E02 | Model omits risk/sector/buyer | Same constraint-completeness guard |
| E03 | Unknown model argument | Reject, not strip |
| E04 | Invalid model metric/corpus pair | Clarify/unsupported; no closest-tool fallback |
| E05 | Direct runChoice/clarification action | Same validation as typed/model route |
| E06 | BG/EN versions of same starter | Identical canonical queries |
| E07 | Click versus copy-and-send starter | Same scope, metric and result |
| E08 | Edit year/sector in starter text | New explicit text applied; stale hidden intent cleared |
| E09 | Selector changes date/entity | Visible prompt and submitted arguments agree |
| E10 | Follow-up “А за 2025?” | Patch period only |
| E11 | Follow-up healthcare | Preserve year/risk; only sector resolution pending |
| E12 | Follow-up “покажи ги” after share | List numerator cohort, preserve base scope |
| E13 | Follow-up linked appeals | Preserve parent contract/tender cohort; state complaint-date meaning |
| E14 | Explicit reset/new topic | Clear appropriate prior scope, no entity leakage |
| E15 | Restore versioned history | Same resolved date/identity; legacy history gracefully supported |
| E16 | Link encode/decode | Exact canonical round trip for dates, sectors, risk and outcomes |
| E17 | Browser membership parity | Same actual matching keys and count as answer |
| E18 | Numerator/denominator narration altered | Grounding gate rejects; deterministic result remains accurate |
| E19 | Partial/empty/unavailable screen | Distinct accessible messages; no empty table implying successful zero |
| E20 | Keyboard, focus, language and themes | Clarification, parameter controls and scope summary usable in both entries |

### Backend, deployment and performance — F01–F15

| ID | Input / condition | Required assertion |
|---|---|---|
| F01 | Quotes, `%`, `_`, regex-like keywords | Literal/parameterized semantics; no injection or uncontrolled regex |
| F02 | Unknown fields/sorts/grouping/oversized IDs | Bounded schema rejection before expensive query |
| F03 | Cache distinguishes custom filters | No collisions between dates, sectors, cohorts or metric versions |
| F04 | Canonical equivalent query | Same cache fingerprint despite order/aliases |
| F05 | Cache timeout SQLSTATE57014 | No expensive live fallback; unavailable response |
| F06 | Missing relation vs empty corpus | Explicit capability failure vs legitimate zero |
| F07 | Ingestion commits during result query | Numerator, denominator and rows consistent |
| F08 | Contract/KZK/tender refresh | Dependent masks/projections/cache revisions update in order |
| F09 | App catalog newer than served risk cache | Served version surfaced; incompatible scoring not claimed |
| F10 | Native PG vs JSON HTTP representation | Numeric strings, dates and nulls deserialize identically |
| F11 | Cold/warm/generic query plans | Measure full-corpus and custom-range paths within stated budget |
| F12 | Cancellation/pagination/limits | Bounded work; stable order; total is not displayed page length |
| F13 | DB absent vs partial schema | Explicit test skip only for unavailable DB; missing required relation fails |
| F14 | Main/AI builds and import graph | Shared modules remain pure; both entries work |
| F15 | Capability rollback | Honest unsupported response; no return to silent constraint loss |

### Plan-audit regressions — G01–G40

| ID | Input / condition | Required assertion |
|---|---|---|
| G01 | Every published prompt parameter | Closed schema represents min-count, amount, bidder comparison, relationship and date/value basis; no undeclared placeholder types |
| G02 | Contracts in 2025 with complaints filed in 2026 | Both primary and related dates survive wire, SQL, narrative and URL |
| G03 | Parent-cohort follow-up restored elsewhere | Portable validated one-hop definition, not session-only reference |
| G04 | Cyclic/deep or expired parent query | Explicit error; no recursion or broader replacement |
| G05 | “Не 2026, а 2025” | Correct replacement; no interval containing both years |
| G06 | One-bid OR upheld appeal, plus buyer scope | OR numerator inside conjunctive buyer base; correct denominator |
| G07 | Nested unsupported AND/OR request | Clarify exact grouping; never flatten silently |
| G08 | Composite W/P truth-table fixture | W OR P=3/2/1; W AND P=1/4/1; NOT W=2/2/2 true/false/unknown |
| G09 | Count plus value in same question | Explicit summary contains both requested measures |
| G10 | Two independent clauses / three clauses | Two bounded validated queries; ask selection beyond bound; never silently answer one |
| G11 | Bulgarian inflection/transliteration/decimal comma | Same resolved identity and numeric threshold as canonical spelling |
| G12 | Quoted act/tender text contains instructions | Text remains evidence/search content; cannot change query/tool scope |
| G13 | Clean deployed functions-only package | Generated CJS schema/catalog loads without src/, tsx or undeclared dependencies |
| G14 | Generated schema/catalog changed but not rebuilt | Freshness/hash check fails before deployment |
| G15 | Many questions share procurementQuery | Distinct defaults, categories, source IDs and editable parameter subsets |
| G16 | Chat-ready question without SQL adapter | SQL remains unavailable/review, not auto-enabled |
| G17 | Model narration swaps denominator/sector with valid digits | Semantic guard or deterministic sentence prevents wrong claim |
| G18 | Tender deadline at now ±1 second | Correct exact-instant open status; timezone preserved |
| G19 | Date-only deadline today / DST boundary | Unknown final-day status unless source rule exists; no invented midnight |
| G20 | Deadline passes without ingestion revision change | Cache expires/revalidates; no stale open opportunity |
| G21 | Last-12-month fixed-clock window | `[2025-09-13,2026-09-13)`; leap/month-end clamping specified |
| G22 | Invalid/missing date or missing monthly shard | Unassignable counts/coverage gaps distinguished from zero matches |
| G23 | Future-dated observed record | Explicit annual scope honored; quality flag, no implicit today cutoff |
| G24 | All money unknown vs all known zero | Unknown sum versus EUR0; missing count preserved |
| G25 | Currency/VAT/large numeric threshold | Pinned conversion/value basis, exact decimal safety, no invented VAT normalization |
| G26 | Rank minimum20 population vs20 evaluable | Correct distinct group eligibility; sorted by exact fraction |
| G27 | Compare50% to75%, relative change from zero | +25 percentage points and +50% relative distinguished; zero-base relative undefined |
| G28 | Missing/empty trend bin and overlapping sectors | Null versus zero; no additive overlap or average of percentages |
| G29 | Current roster/primary versus additional CPV | Classification edition/basis and limitations visible; no implied historical roster/location |
| G30 | January-filtered concentration/split/CPV risk | Served broader baseline unchanged and disclosed; not recomputed from page/window |
| G31 | Mixed/partial act outcome | Current upheld-risk behavior retained; full-success claim unsupported without finer evidence |
| G32 | Newer procedural act after merits act | Act-kind/evidence rule prevents incorrect outcome replacement |
| G33 | Protected hand/date-only outcomes after migration/rebuild | Exact values/provenance unchanged; status-derived ending never written to raw outcome |
| G34 | New question while old request/clarification completes | Stale response cannot change active scope or follow-ups |
| G35 | Old/unknown history schema version | Re-resolve before executing; unsupported version cannot default to broad scope |
| G36 | New analytics link opens legacy contract browser | Population/version/member exclusion and numerator preserved by explicit mode/view |
| G37 | Data revision changes during pagination/export | Explicit restart/fresh result; no silent duplicate/missing rows or immutable-count claim |
| G38 | Full export versus cap; formula-like source text | Same query/basis, cap disclosed, formula cells escaped |
| G39 | Old/new UI/backend or missing individual corpus | Capability negotiation blocks unsupported calls/starters; compatible legacy route preserved |
| G40 | Partial refresh, oversized filters and concurrent load | No mixed published revisions or truncated predicates; bounded work and measured serving limits |

### Catalog-derived boundary expansion

In addition to the 160 cases, parameterize every contract and tender signal for: available/fired, available/not-fired, unavailable, just below/at/above threshold where applicable, negation, AND/OR combination and sector/date filtering. Use the canonical catalog to enumerate IDs so newly added signals require query support or an explicit unsupported capability. Use independent hand-calculated expected outcomes; do not copy the scorer into the test oracle.

Preserve specialized fixtures for CPV structural suppression, CPV22112, the five-digit weak-competition cohort, direct-procedure labels/rationales, 30% concentration and buyer floor, 12-month founding boundary, 50% annex growth, split-group context and unmapped activity codes. Assert existing grade bands and availability rules separately from raw competition measures. Mutate a date bound, remove a buyer predicate or change a numerator filter in a test double and confirm the test suite fails: this checks that fixtures detect the observed failure classes.

## Starter catalog

These are editorial question candidates for the proposed capabilities, not buttons to ship before their queries work. Every starter needs a stable question ID, complete reviewed BG/EN wording, parameter definition, expected canonical query and supported follow-up policy in the existing catalog. Some English cells describe intent and must become a full localized question before publication. Example years remain editable. Relative-date starters render resolved dates at execution.

| ID | Bulgarian | English / intent |
|---|---|---|
| P01 | Какъв процент от обществените поръчки за 2026 са с 1 участник? | What share of procurement contracts in 2026 have one bidder? |
| P02 | Покажи договорите с един участник от 04/2025 до 01/2026. | Show one-bid contracts from April 2025 through January 2026. |
| P03 | Колко договора са публикувани през 2026 и каква е текущата им стойност? | How many contracts were published in 2026, and what is their current recorded value? |
| P04 | Как се променя делът с един участник по месеци през 2026? | Monthly one-bid share in 2026. |
| P05 | Сравни дела с един участник през 2025 и 2026. | Compare one-bid shares in 2025 and 2026; show coverage. |
| P06 | Кои възложители имат най-висок дял с един участник през 2026 при поне 20 договора? | Rank buyers by one-bid share in 2026, with at least 20 contract records. |
| P07 | Кои са най-големите изпълнители по стойност на договорите за 2026? | Largest suppliers by contract value in 2026. |
| P08 | Какъв дял от договорите на МЗ и НЗОК през 2026 са с един участник? | One-bid share for the Ministry of Health and NHIF buyer group in 2026. |
| P09 | Покажи договорите по CPV 33 — медицинско оборудване, фармацевтични продукти и продукти за лични грижи — през 2026. | Show 2026 contracts in CPV 33: medical equipment, pharmaceuticals and personal-care products. |
| P10 | Покажи поръчките за пътни ремонти през 2026. | Road-repair subject query using the reviewed mapping. |
| P11 | Колко договора на АПИ през 2026 са с поне два рискови сигнала? | API contracts in 2026 with at least two fired checks. |
| P12 | Покажи договорите на Софарма трейдинг през 2026. | Company resolution and contract search for 2026. |
| P13 | Кои договори през 2026 имат най-много рискови сигнали? | Rank 2026 contract records by fired count, with check availability. |
| P14 | Каква е разликата между един участник и слаба конкуренция? | Explain raw one-bid count versus the adjusted risk signal. |
| P15 | Покажи търговете за мантинели на АПИ през 2026. | Guardrail tenders by API in 2026. |
| P16 | Кои търгове за медицинско оборудване са отворени за кандидатстване сега? | Open-for-submission tenders under a reviewed medical-equipment definition. |
| P17 | Покажи прекратените търгове на МЗ и НЗОК от 04/2025 до 01/2026. | Cancelled tenders, explicit buyer group and month range. |
| P18 | Кои търгове имат краен срок през октомври 2026? | Tender deadline-date cohort. |
| P19 | Колко жалби за обществени поръчки са подадени в КЗК през 2026? | Complaint-date count in 2026. |
| P20 | Какъв дял от жалбите, подадени през 2026, са уважени според наличните решения? | Upheld rate for a filing cohort; disclose outcome coverage and denominator. |
| P21 | Покажи решенията на КЗК за обществени поръчки от 04/2025 до 01/2026. | Act-date query; distinguish merits decisions from procedural acts. |
| P22 | Колко процедури на АПИ са обжалвани през 2026? | Distinct procedures with complaints filed in 2026. |
| P23 | По кои жалби от 2026 е поискана временна мярка и по кои е спряна процедурата? | Requested versus effective suspension, separate metrics. |
| P24 | Колко жалби нямат установена връзка с процедура? | Unlinked-complaint coverage query. |
| P25 | Покажи жалбите и решенията за процедура {unp}. | Exact procedure lineage, evidence and count units. |
| P26 | Какви са източниците и кои показатели не могат да бъдат проверени? | Scope-preserving provenance and risk availability. |
| P27 | Покажи договорите, публикувани през 2025, по чиито процедури има жалби, подадени през 2026. | Show contracts published in 2025 whose procedures received complaints filed in 2026. |
| P28 | Колко договора на АПИ от 2026 са с един участник и каква е текущата им обща стойност? | How many API contract records in 2026 have one bidder, and what is their total current value? |
| P29 | Покажи договорите през 2026 на стойност над 1,5 млн. евро със сигнал за пряко възлагане. | Show 2026 contract records above EUR1.5 million in current value with a direct-award signal. |
| P30 | Данните разграничават ли изцяло от частично уважени жалби? | Do the data distinguish fully upheld complaints from partially upheld complaints? |

P09 deliberately names the full division. A specifically equipment-only question needs a narrower reviewed prefix set; do not treat the broad division as if it only represented equipment.

### One starter template for every risk indicator

Bind `{period}` to an explicit editable date range and optionally add a resolved buyer/subject sector. English is generated from reviewed localized catalog terminology, not an on-demand model translation. Each row becomes a concrete catalog question with its own risk ID and compatible corpus.

| Risk ID | Bulgarian starter template | English starter template |
|---|---|---|
| debarred | Покажи договорите за {period} със сигнал за съвпадение с регистъра на отстранените изпълнители. | Show contract records in {period} flagged for a match to the debarment register. |
| mpConnected | Покажи договорите за {period}, свързани с депутати според наличните данни. | Show contract records in {period} linked to MPs in the available data. |
| pepConnected | Покажи договорите за {period}, свързани с длъжностни лица според наличните данни. | Show contract records in {period} linked to public officials in the available data. |
| awarderConcentration | Кои договори за {period} имат сигнал за концентрация при възложителя? | Which contract records in {period} have a buyer-concentration signal? |
| amendment | Покажи измененията на договори, публикувани през {period}. | Show contract amendment events published in {period}. |
| annexGrowth | Кои договори за {period} имат сигнал за голямо увеличение на стойността? | Which contract records in {period} have a large value-increase signal? |
| newFirmWinner | Кои договори за {period} са спечелени от новоучредени фирми? | Which contract records in {period} were awarded to newly established firms? |
| splitPurchase | Кои договори за {period} имат сигнал за възможно разделяне на покупки? | Which contract records in {period} have a possible split-purchase signal? |
| appealUpheld | Покажи договорите за {period}, свързани с уважена жалба по процедурата. | Show contract records in {period} linked to a recorded upheld appeal. |
| weakCompetition | Покажи договорите за {period} със сигнал за слаба конкуренция. | Show contract records in {period} with a weak-competition signal. |
| directAward | Покажи договорите за {period} със сигнал за пряко възлагане. | Show contract records in {period} with a direct-award signal. |
| shortTenderPeriod | За договорите от {period} има ли данни за прекалено кратък срок за оферти? | Can the short tender-period check be evaluated for contract records in {period}? |
| nkidMismatch | Кои договори за {period} имат сигнал за несъответствие между дейността на фирмата и предмета? | Which contract records in {period} have a company-activity versus procurement-subject mismatch signal? |
| nonOpenProcedure | Покажи търговете за {period} със сигнал за неоткрита процедура. | Show tenders in {period} with a non-open-procedure signal. |
| rushedDeadline | Кои търгове за {period} имат сигнал за кратък срок за подаване на оферти? | Which tenders in {period} have a rushed-deadline signal? |
| shortDecisionPeriod | Кои търгове за {period} имат сигнал за много бързо сключване след крайния срок? | Which tenders in {period} have a short interval between submission deadline and signing? |
| awardOverEstimate | Кои търгове за {period} имат възложена стойност поне 10% над прогнозната? | Which tenders in {period} have awarded value at least 10% above their estimate? |

Keep unavailable checks discoverable as availability/explanation questions. Do not advertise a working list filter when no records can be evaluated. Additional starters for buyer exposure, supplier grade and currently active exclusions must say what population and snapshot they describe.

## Follow-up catalog and patch semantics

Generate at most a few useful suggestions per answer, chosen from supported actions. Every action has localized text, a structured patch and an expected applied query. These examples assume a contract one-bid query for 2026 unless noted.

| Follow-up | Patch / behavior |
|---|---|
| А за 2025? / And in 2025? | Replace period only; preserve metric, sector, identities and denominator. |
| А от април 2025 до януари 2026? | Replace bounds; keep all non-date scope. |
| А само за здравеопазването? | Keep period/metric; ask buyer-versus-subject clarification if unresolved. |
| Само за МЗ и НЗОК. | Set resolved buyer sector; preserve compatible subject/risk filters. |
| А само за АПИ? | Replace buyer scope with API; don't retain a contradictory inherited buyer-sector scope. Explain the changed scope. |
| Покажи тези договори. / Show those contracts. | Switch to list of the numerator cohort, not all base records. |
| Кои са най-големите пет? | Rank/list same cohort by declared current value, limit five. |
| Разбий ги по възложител. | Group same measure/base by buyer; include sample sizes. |
| А по месеци? | Trend same population, unchanged bounds. |
| А с пряко възлагане? | Add a direct-award base filter; explicitly state it is among the previous scope. |
| С един участник и уважена жалба. | AND numerator conditions; preserve independent denominator. |
| С един участник или уважена жалба. | OR/distinct union, no double counting. |
| А какъв е делът сред тези с известен брой участници? | Change denominator to positive-known bids; keep numerator/base. |
| Колко са с неизвестен брой участници? | Count missing bidder data; recorded zero shown separately. |
| А колко от тях са обжалвани? | Contract/procedure cohort retained; measure linked appeal presence, not complaint count. |
| Покажи жалбите по тези процедури. | Move to linked complaint cohort; say dates refer to the parent procedure scope unless an explicit complaint-date filter is supplied. |
| Покажи решенията, издадени през 2026. | Switch to act-date cohort; preserve valid entity/sector scope; make cohort change visible. |
| А само с жалби, подадени през 2026? | Add related complaint-date bounds to the current contract/tender population; do not replace its publication period. |
| Не 2026, а 2025. | Correct the targeted period while preserving every other compatible field. |
| Данните обновени ли са от последния отговор? | Compare revisions; offer explicit re-execution, without rewriting the historical answer. |
| А само спрените процедури? | Effective suspension condition; not merely requested interim measure. |
| Защо този договор е маркиран? | Selected-record detail with fired and unavailable checks, catalog/data revision and evidence. |
| Премахни филтъра за сектор. | Remove sector dimensions explicitly; preserve year and metric. |
| Покажи всички години. | Remove date bounds only; retain scope/metric. |
| Започни ново търсене. | Clear procurement continuation state. |

For “А само за АПИ?” the patch intentionally replaces incompatible buyer scope instead of intersecting API with МЗ/НЗОК and producing a misleading empty result. Conversely, an explicit “АПИ И здравния сектор” contradiction should be presented as an empty intersection or clarified, never silently repaired. Store patch intent, including replace versus add versus clear, in the action definition.

## Implementation test placement

| Test family | Proposed location / existing seam |
|---|---|
| Pure parsing/canonicalization | New `src/lib/procurementQuery.test.ts`, `ai/orchestrator/procurementQuery.test.ts`; fixed clock and span expectations |
| Tool scope propagation | New `ai/tools/procurementQuery.test.ts`; `setDbFetcher` + `clearDataCache`; assert exact backend parameters and scope metadata |
| Provider route guarding | Extend `routeScope`/argument tests and non-AI evaluation; fake model omissions, no network |
| SQL query compiler/routes | New `functions/db_routes.procurement_query.test.js`, collected through node:test; verify query parameterization and error handling |
| Independent data oracle | New SQL fixture integration suite plus `scripts/db/tests/*.data.test.ts` for actual corpus invariants, mask parity, KZK cardinality and refresh metadata |
| Questions/history/UI | Extend starters/followups/questionAdapter tests; collected `ai/app` TSX tests for clarification, edited prompts and restore |
| Link and browser parity | Pure codec tests plus browser/backend integration asserting row keys; include exact month-end boundary |
| Performance and release | Reproducible bounded query benchmark/harness using representative plans and full aggregates; report hardware/environment, warm/cold state and data version |

Keep prompt fixtures and expected slot definitions together in a versioned evaluation corpus. Add held-out paraphrases that were not used to tune routing. Report accuracy by corpus, period, intent, sector, entity and continuation, and separately count **silent constraint loss**; the release target for mandatory fixtures is zero silent loss. A high average score cannot compensate for failures on the screenshot or any explicit scope-preservation case.
