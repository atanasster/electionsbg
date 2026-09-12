# Funding chat — tests, starters and follow-ups

Status: proposed specification, 2026-09-12. Step 0 now has three executed independent arithmetic fixture tests in `ai/tests/fundingFixture.test.ts`; the 100-case matrix below remains an acceptance specification, not an assertion that those cases have executed. Companion to [implementation plan](ai-funding-chat-implementation-v1.md). Each case requires an implementation test path/assertion and recorded result before release. Conditional capabilities must remain hidden until source-backed verification succeeds.

## Independent arithmetic fixtures

Write fixture JSON and expected values before the compilers. Never calculate expectations by calling the production matcher/SQL builder. Keep both hermetic and PostgreSQL rollback fixtures; the latter must run without skipping for release.

### ISUN fixture

Four distinct project records, all in programme P21 (programming period 2021–2027). Separate funding mechanism labels are required in another fixture.

| Key | EIK | Theme | Total cost | Grant | Own | Cumulative paid | Signature |
|---|---|---|---:|---:|---:|---:|---|
| I1 | A | health | 100 | 80 | 20 | 40 | unknown |
| I2 | A | roads | 200 | 150 | 50 | 150 | unknown |
| I3 | B | health | 0 | 0 | 0 | 0 | unknown |
| I4 | unknown | unclassified | unknown | unknown | unknown | unknown | unknown |

Expected: 4 project records, 2 identifiable legal beneficiaries, 1 unidentified project; known total cost 300, grant 230, own 70, cumulative paid 190; one missing value in each monetary measure. All-project paid/project-cost ratio is 190/300 = 63.333…%; paid/grant is 190/230 = 82.608…%, not an average of row percentages. I3's standalone ratio is unavailable, not 0%. Health matches I1+I3, cost 100, grant 80, paid 40. If I1 has two implementation locations, filtering either location includes one I1; filtering their union still counts one I1. Allocation totals follow an explicitly supplied source fixture, never an invented equal split.

A separate date-enriched fixture, enabled only after source proof, places records at 2025-12-31, 2026-01-01, 2026-12-31 and 2027-01-01 plus a null date. This tests event-date boundaries independently of P21; do not fill dates on the baseline fixture.

### DFZ fixture

Rows are annual records, not transaction events. Values below are signed net EUR totals; component sums must equal each supplied row's published total where the fixture claims reconciliation.

| Key | FY | Recipient | Scheme | Total |
|---|---:|---|---|---:|
| A1 | 2025 | legal EIK A | S1 | 100 |
| A2 | 2025 | legal EIK A | S2 | 50 |
| A3 | 2025 | legal EIK B | S1 | 25 |
| A4 | 2025 | unidentified natural-person record | S1 | 20 |
| A5 | 2025 | excluded payer | S1 | 500 |
| A6 | 2026 | legal EIK A | S1 | 40 |
| A7 | 2026 | legal EIK A | S1 correction | -5 |

Expected FY2025 attributable population: 4 annual records, 195 EUR; legal-only 3 records, 2 EIKs, 175 EUR. A receives 150/175 = 85.714…% of legal money. S1 attributable total is 145, not 645. Gross-source FY2025 total is 695 and is a separately labeled measure. A's FY2026 net is 35, not 40 or 45. Cross-year distinct EIKs are not the sum of yearly recipient counts. Two natural-person rows with the same name must not establish one verified person identity.

### Interreg fixture

| Operation | Programme period | Whole budget | Partners |
|---|---|---:|---|
| O1 | 2021–2027 | 1,000 | Bulgarian X: 100; Bulgarian Y: unpublished; foreign Z: 900 |
| O2 | 2021–2027 | 500 | Bulgarian X: published zero; foreign W: 500 |
| O3 | 2014–2020 | 200 | Bulgarian Q: 50; foreign R: 150 |

Expected 2021–2027: 2 operations; 3 Bulgarian partnership rows; known Bulgarian budget 100; 1 unpublished budget; 1 published zero. O1 joined to X+Y still contributes one operation and 1,000 whole-operation EUR, never 2,000. X's partner total is 100, never 1,500. Partner organisation counts require stable source organisation identity and remain separate from partnership counts. Add an operation whose partner sum exceeds its published whole budget; preserve the discrepancy without rejecting it or forcing reconciliation. Add missing EIK, repeated organisation name, reordered partnership array, country/department disagreement and negative contribution corrections.

## Acceptance matrix: 100 named cases

Run prompt cases in BG and EN where applicable. “Clarify” asserts a pending structured scope and zero analytical DB execution, not just a particular sentence. Source-unavailable tests assert a typed status and no fallback. Expected failures from unrelated suites must be reported separately.

### A — Time capture

| ID | Scenario | Required assertion |
|---|---|---|
| A01 | ISUN “signed in 2026”, baseline without dates | Unsupported date basis; no all-time execution. |
| A02 | ISUN programme 2021–2027 | Programming-period filter only; no calendar range inferred. An additional explicit event window is a separate AND constraint. |
| A03 | ISUN 04/2025–01/2026 | Capture exact requested range; unavailable until a date basis is resolved/supported. |
| A04 | Enriched signature date at year boundaries | Include Jan 1/Dec 31; exclude adjacent years; report null dates. |
| A05 | Current paid on a signed cohort vs payments during a year | Different capabilities; cumulative value cannot answer payment-flow query. |
| A06 | DFZ “за 2025” | Source financial year 2025 displayed and persisted. |
| A07 | DFZ explicit calendar/month scope | Clarify/unavailable; no rounding to annual coverage. |
| A08 | Interreg “през 2026” | Ask started/ending/active; preserve other constraints. |
| A09 | Interreg start/end/overlap boundary, null end | Correct declared inclusivity and missing-date policy. |
| A10 | Latest available FY, relative dates and comparison | Fixed clock; resolved values persist; no election-year inheritance. |

### B — Scope and identity

| ID | Scenario | Required assertion |
|---|---|---|
| B01 | Same programme name in two periods | Clarification retains metric/place. |
| B02 | Programme code plus fund family | Intersection applied; incompatible combination is explicit empty, not relaxed. |
| B03 | Scheme alias across revisions | Canonical ID/version; ambiguous renamed schemes are not merged. |
| B04 | Beneficiary EIK plus FY and scheme | All three reach executor and browser. |
| B05 | Two companies matching a name | Candidate chooser; never highest-money auto-selection. |
| B06 | Natural-person name or 10-digit personal identifier | No EIK coercion or inferred cross-corpus identity. |
| B07 | Lead Bulgarian Interreg partner | Country/department-country predicate and lead role both applied. |
| B08 | Healthcare institution vs healthcare project | Roster/theme clarification; no procurement CPV conversion. |
| B09 | Programme AND theme AND amount | All constraints retained; strict > differs from ≥. |
| B10 | RRP and EEA/Norway | Correct mechanism, not an invented calendar period or EU-only label. |

### C — Money and denominators

| ID | Scenario | Required assertion |
|---|---|---|
| C01 | ISUN complete fixture sums | 300 cost / 230 grant / 190 paid, coverage shown. |
| C02 | Weighted rates vs mean of rates | 190/300 and 190/230 separately labeled. |
| C03 | Zero denominator | Unavailable ratio; no 0%, NaN or Infinity. |
| C04 | All-null amount vs published zero | Unknown differs from 0. |
| C05 | DFZ total and three components | Never sum total plus its components. |
| C06 | DFZ negative correction | FY2026 A net = 35. |
| C07 | Currency conversion/decimal boundaries | Declared currency/rate, deterministic rounding and strict comparisons. |
| C08 | Paid exceeds chosen denominator | Preserve >100% with basis note; no clamping. |
| C09 | Count share vs value share | Explicit separate denominators; “among” constrains base only. |
| C10 | Cross-source combined funding request | Separate compatible measures/statuses; no automatic grand total. |

### D — Grain, joins and geography

| ID | Scenario | Required assertion |
|---|---|---|
| D01 | ISUN multiple locations/theme matches | One contract identity; no SUM fan-out. |
| D02 | Multi-place money | Whole inclusion and allocated amount distinct; no inferred equal split. |
| D03 | HQ vs implementation location | Same place words can produce different explicit scopes. |
| D04 | Sofia SFO_CITY / ISUN alias | Canonical place round-trip retains correct municipality. |
| D05 | Eligible NUTS2 vs participant NUTS3 | Prefix eligibility matching distinct from actual participation. |
| D06 | Interreg operation joined to two BG partners | O1 counted once, whole budget 1,000. |
| D07 | Partner versus organisation counts | Partnership rows not called unique legal beneficiaries. |
| D08 | Partner array reordered on reload | Durable partnership identity unchanged. |
| D09 | Programme-scoped operation ID duplicate | Keep ID remains primary; bare ID requires programme. |
| D10 | Per-capita scope without valid population denominator | Explicit unavailable/clarify; no guessed population. |

### E — Signals and evidence

| ID | Scenario | Required assertion |
|---|---|---|
| E01 | Scoped HHI/top-N | Full scoped beneficiary population; fixed independent arithmetic. |
| E02 | Tiny sample or nonpositive money denominator | No misleading concentration grade. |
| E03 | Debarred normalized-name match | Evidence says name overlap, not verified EIK or illegal award. |
| E04 | Public-figure connection | Existing canonical predicate parity; current vs historical timing disclosed. |
| E05 | Unknown EIK/link evidence | Unknown not “unconnected”; coverage precedes base filtering. |
| E06 | Zero-paid ISUN project | Normalized zero differs from source-observed published zero; provenance gate required for the latter. Neither proves lateness, fraud or completion. |
| E07 | Interreg unpublished/published_zero | Three publication states preserved in filters and totals. |
| E08 | AND/OR/NOT and negated among | Independent base/numerator three-valued truth tables. |
| E09 | Multiple scalar statuses/nested mixed logic | Represent exactly or clarify; never pick first match. |
| E10 | One bidder/CRI on a grant | Not transferred from procurement; only an evidenced separate relationship may answer. |

### F — Routing and providers

| ID | Scenario | Required assertion |
|---|---|---|
| F01 | Precise ISUN prompt vs broad legacy overview | New scoped path wins. |
| F02 | DFZ recipient year dropped by old route | Regression retains year. |
| F03 | Interreg-only prompt | Dedicated corpus, not ISUN plus optional sidebar. |
| F04 | “Can I apply?” | Open-call handoff, never award statistics. |
| F05 | Film/rail/municipal/pension subsidies | Existing specialist routes unchanged. |
| F06 | Procurement “contracts” vs grant agreements | Domain clarification or correct explicit corpus. |
| F07 | Fake model omits period/programme/money basis | Reject/repair before execution. |
| F08 | Heuristic/OpenRouter/WebLLM parity | Same canonical query, deterministic numbers and scope, no external calls in CI. |
| F09 | BG accents/Latin aliases/NBSP numbers/typos | Reviewed normalization; uncertain aliases clarify. |
| F10 | Prompt/document injection | Source text cannot select SQL, change corpus or discard filters. |

### G — Follow-ups and relationships

| ID | Scenario | Required assertion |
|---|---|---|
| G01 | “А само за здравеопазването?” | Preserve period/metric; resolve beneficiary vs project meaning. |
| G02 | “Не 2025, а 2026” | Replace compatible time scope only. |
| G03 | “А по програми?” | Change grouping, preserve base/amount/period. |
| G04 | “Само изплатеното” | Switch money basis or clarify if unsupported; do not carry stale ratio predicates. |
| G05 | “Без политически свързаните” | Known-negative filter with identity coverage. |
| G06 | Interreg operation → Bulgarian partners | Entire parent cohort; independent amount grain and explicit period inheritance. |
| G07 | Parent result limit=1 with second matching operation | Both parents' matching children included. |
| G08 | Unknown parent membership | Partial/unavailable child, not authoritative empty. |
| G09 | Funding beneficiary → procurement | EIK relationship labeled; independent procurement dates; not “funded by”. |
| G10 | Corpus switch with incompatible scope | Clarify; no silent date/scheme/metric deletion. |

### H — UI, history and exports

| ID | Scenario | Required assertion |
|---|---|---|
| H01 | Every ready starter typed/clicked/copied | Canonical equality in both languages. |
| H02 | Year/programme controls | Selected value reaches query and visible scope. |
| H03 | Follow-up button and copied wording | Same continuation intent and scope. |
| H04 | Saved current/legacy/invalid history | Valid versions restore; invalid version cannot execute broadly. |
| H05 | New chat during pending answer | Old request cannot overwrite new scope/clarification. |
| H06 | Answer → result URL | Same canonical fields, stable identities and aggregate. |
| H07 | Revision changes between pages | Restart/reject; no mixed-revision page chain. |
| H08 | Failed page and retry | Clear stale rows, preserve scope, disable export until ready. |
| H09 | CSV formula prefixes and capped page | Escape text; exact displayed rows, scope/revision, cap label. |
| H10 | Keyboard/screen reader and language switching | Controls/clarification accessible; language does not change query identity. |

### I — Backend and lifecycle

| ID | Scenario | Required assertion |
|---|---|---|
| I01 | Clean Functions-only package | Generated schema imports without src/React/runtime leakage. |
| I02 | Closed schema and malicious filters | Unknown fields/SQL fragments/oversized lists rejected, bound SQL only. |
| I03 | Missing relation vs genuinely empty source | Unavailable vs empty; source coverage explicit. |
| I04 | Explicit Interreg unavailable, ISUN available | Requested source failure visible, not silently omitted. |
| I05 | Missing date enrichment | Date capability disabled; unrelated supported metrics still work. |
| I06 | Mid-refresh failure | No half-published projection/revision. |
| I07 | Stale catalog or political-link revision | Partial/unavailable policy, not stale authoritative signal. |
| I08 | Timeout/permission failure | Narrow typed failure; no expensive fallback retry. |
| I09 | Disable flag and mixed client/server versions | Honest rollback; unsupported ready prompts hidden. |
| I10 | Two independent questions / three questions | Bounded two-result bundle; three requires selection. |

### J — Release and regression

| ID | Scenario | Required assertion |
|---|---|---|
| J01 | Independent JSON oracle vs each SQL compiler | Counts, amounts, ratios and coverage reconcile. |
| J02 | Populated PostgreSQL fixtures | Required data suites execute; absent relations fail. |
| J03 | Existing procurement query suite | No parser, codec, provider or saved-history regression. |
| J04 | Existing funds/Interreg/DFZ source suites | Legacy population differences explicitly reconciled. |
| J05 | Generated catalog/metadata/destination inventory | Fresh and exactly covers registered tools. |
| J06 | Both application builds/typechecks | Real integrated and standalone builds pass. |
| J07 | First/warm/skewed/concurrent latency | Environment, sample count/revisions and p95 measured; no invented guarantee. |
| J08 | Query/list/rank/trend/export parity | Full cohort, pagination and deterministic tie ordering agree. |
| J09 | Source freshness/coverage and read-only grants | Actual deployed-role readiness across supported fields. |
| J10 | Release record and staged rollout | Executed counts/conditional gaps/manual checks explicit; rollback exercised. |

## Starter catalog

Store localized text and typed canonical intent together; interpolation must use resolved IDs, not text extraction on click. Programming-period controls and financial-year controls are different types. All years below are illustrative, not a claim of current data availability; the UI chooses from coverage. “Conditional” starters are hidden until their evidence/capability is available. Generic clarification prompts may remain visible because they do not promise execution.

| ID | Bulgarian | English | Canonical intent / readiness |
|---|---|---|---|
| S01 | Колко проекта по ИСУН има по програми 2021–2027? | How many ISUN projects are in 2021–2027 programmes? | Project count; programming period. |
| S02 | Кои са най-големите бенефициенти по размер на безвъзмездната помощ по ИСУН? | Which ISUN beneficiaries have the largest grants? | Rank EIKs by grant; identity coverage. |
| S03 | Какъв е размерът на безвъзмездната помощ за проекти за здравеопазване по ИСУН? | How much grant funding do ISUN healthcare projects have? | Theme, grant sum; reviewed theme capability. |
| S04 | Покажи проектите по ИСУН за пътища с обща стойност над 1 млн. евро. | Show ISUN road projects with total cost above €1 million. | Theme + strict cost threshold. |
| S05 | Какъв е делът на изплатеното спрямо безвъзмездната помощ по програми в ИСУН? | What is cumulative paid funding as a share of grants by ISUN programme? | Explicit weighted ratio; conditional source-basis verification. |
| S06 | Кои програми по ИСУН имат най-висока концентрация на безвъзмездна помощ по бенефициент? | Which ISUN programmes have the highest beneficiary concentration by grant value? | Scoped HHI, explicit minimum sample. |
| S07 | Покажи проектите по ИСУН за изпълнение в община Русе. | Show ISUN projects implemented in Ruse municipality. | Confirmed implementation-location basis. |
| S08 | Колко договора по ИСУН са подписани през 2026? | How many ISUN agreements were signed in 2026? | Conditional signing-date enrichment; never advertise against baseline. |
| S09 | Колко земеделски субсидии са изплатени за финансова 2025 година? | How much in farm subsidies was paid for financial year 2025? | Net FY total, declared attributable population. |
| S10 | Кои юридически лица са получили най-много земеделски субсидии за финансова 2025 година? | Which legal entities received the most farm subsidies for financial year 2025? | Legal-only FY ranking. |
| S11 | Разпредели земеделските субсидии за финансова 2025 година по схеми. | Break down farm subsidies for financial year 2025 by scheme. | Scheme grouping, full cohort. |
| S12 | Сравни земеделските субсидии за финансови 2024 и 2025 години. | Compare farm subsidies for financial years 2024 and 2025. | Compatible FY comparison. |
| S13 | Колко земеделски субсидии е получил ЕИК {eik} за финансова {year} година по схема {scheme}? | How much did EIK {eik} receive for financial year {year} under scheme {scheme}? | Resolved entity + year + scheme; never all-years detail. |
| S14 | Какъв дял от субсидиите за юридически лица получават десетте най-големи получатели през финансова 2025 година? | What share of legal-entity subsidies goes to the ten largest recipients in financial year 2025? | Top10 share, legal-money denominator. |
| S15 | Покажи юридическите получатели на земеделски субсидии с установена връзка с публични фигури за финансова 2025 година. | Show legal farm-subsidy recipients with documented public-figure links for financial year 2025. | Current linkage evidence on FY money; coverage note. |
| S16 | Разпредели земеделските субсидии по област на получателя за финансова 2025 година. | Break down farm subsidies by recipient region for financial year 2025. | Recipient region, not agricultural land location. |
| S17 | Колко операции по Interreg има за програмен период 2021–2027? | How many Interreg operations are in the 2021–2027 programming period? | Distinct keep IDs. |
| S18 | Какъв е публикуваният бюджет на българските партньори по Interreg за период 2021–2027? | What is the published budget of Bulgarian Interreg partners in 2021–2027? | Partner sum + unpublished coverage. |
| S19 | Покажи операциите по Interreg, започнали през 2026. | Show Interreg operations starting in 2026. | Start-date window, not signature. |
| S20 | Покажи операциите по Interreg с крайна дата през 2026. | Show Interreg operations with end dates in 2026. | End-date window, not proven completion. |
| S21 | Кои български партньори по Interreg имат най-голям публикуван бюджет? | Which Bulgarian Interreg partners have the largest published budgets? | Partner/organisation grouping explicitly chosen. |
| S22 | Какъв дял от българските партньорства по Interreg нямат публикуван бюджет? | What share of Bulgarian Interreg partnerships have unpublished budgets? | Partnership-count share; published zero excluded from numerator. |
| S23 | Покажи водещите български партньори по Interreg Румъния–България за 2021–2027. | Show Bulgarian lead partners in Interreg Romania–Bulgaria for 2021–2027. | Programme ID + role + country rule. |
| S24 | Покажи партньорствата по Interreg с партньори от община Русе. | Show Interreg partnerships with partners based in Ruse municipality. | Partner location, not whole project benefit attribution. |

## Follow-up catalog

Every follow-up must have typed intent and bilingual copy. The sample wording is not permission to discard incompatible inherited fields. Ask a clarification while keeping the previous query when necessary.

| ID | Bulgarian / English | State transition |
|---|---|---|
| P01 | А само за здравеопазването? / And healthcare only? | Preserve period/metric/entity; clarify project theme vs recipient sector. |
| P02 | Не 2025, а 2026. / Not 2025, but 2026. | Replace same time basis; unsupported year is explicit. |
| P03 | А по програми? / And by programme? | Change grouping only; validate corpus capability. |
| P04 | А по схеми? / And by scheme? | DFZ scheme grouping; never convert an ISUN programme automatically. |
| P05 | Само безвъзмездната помощ. / Grant value only. | Money-basis replacement; revalidate derived numerator/denominator. |
| P06 | А реално изплатеното? / And what has actually been paid? | ISUN cumulative or DFZ annual paid basis; Interreg explains missing expenditure. |
| P07 | Покажи съответстващите записи. / Show matching records. | Aggregate → list, all base/numerator constraints retained. |
| P08 | Без установените политически връзки. / Exclude documented political links. | Known-negative evidence; missing identities remain unknown. |
| P09 | Само българските партньори. / Bulgarian partners only. | Interreg operation → full matching partner cohort, switch grain/budget explicitly. |
| P10 | А общият бюджет на тези операции? / And the whole budget of these operations? | Partner cohort → distinct operations; label whole-budget attribution. |
| P11 | Покажи обществените поръчки на тези бенефициенти. / Show these beneficiaries' procurement contracts. | EIK relationship, entire parent cohort; request/resolve independent procurement period. |
| P12 | Само в община Русе. / Ruse municipality only. | Preserve scope; choose implementation location vs recipient/partner seat. |
| P13 | Сравни с предходната финансова година. / Compare with the previous financial year. | DFZ compatible previous FY; other corpora clarify. |
| P14 | Обясни знаменателя и липсващите данни. / Explain the denominator and missing data. | Methodology on same canonical query; no broader execution. |
| P15 | Има ли отворен прием за такъв проект? / Is there an open call for such a project? | Open-call handoff preserves supported topic/place/applicant hints, drops award-period only after explicitly explaining incompatibility; no invented Interreg coverage. |
| P16 | Покажи отделно ИСУН и Interreg за същата община. / Show ISUN and Interreg separately for the same municipality. | Two independent queries; money/geography/time bases shown per source, no grand total. |

## Suggested test locations and run gates

New: `src/lib/fundingQuery.test.ts`, `ai/orchestrator/fundingUnderstanding.test.ts`, `ai/tools/funding.test.ts`, `ai/llm/fundingParity.test.ts`, `ai/app/fundingIntegration.test.ts`, `src/screens/funding/FundingQueryScreen.test.tsx`, `ai/tests/fundingFixture.test.ts`, `scripts/ai/buildFundingQuery.test.ts`, Functions query/compiler tests, and PostgreSQL funding query data suites under `scripts/db/tests/`.

Extend the existing question/selector/metadata/destination fixtures, provider scope tests, procurement integration suite, Interreg serving tests, DFZ political/recipient data tests and funds integrity/theme tests where they own shared behavior. Tests must be collected by the repository's actual Vitest/Node configurations; adding a file outside their includes is not coverage.

Run lint, AI and main typechecks, both builds, affected unit/component/provider-fake/backend suites, populated PostgreSQL fixtures and existing domain parity harnesses. Then measure performance and execute controlled migration/read-only-role/rollback checks. A bounded live-provider smoke and deployed-role test are separate, explicitly reported rollout evidence; hermetic CI cannot claim them. No production count should be hardcoded as an evergreen oracle.
