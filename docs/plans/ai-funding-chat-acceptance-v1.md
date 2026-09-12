# Funding chat acceptance ledger

This maps all 100 specification IDs to executable assertions or explicitly gated rollout evidence. A shared fixture covers multiple assertions; rows are not separate test-count claims. Execution totals and limitations are recorded in [the release record](ai-funding-chat-release-v1.md).

| ID | Scenario | Evidence | Assertion / boundary |
|---|---|---|---|
| A01 | ISUN “signed in 2026”, baseline without dates | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Unsupported date basis; no all-time execution. |
| A02 | ISUN programme 2021–2027 | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Programming-period filter only; no calendar range inferred. An additional explicit event window is a separate AND constraint. |
| A03 | ISUN 04/2025–01/2026 | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Capture exact requested range; unavailable until a date basis is resolved/supported. |
| A04 | Enriched signature date at year boundaries | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Baseline-gated: signature enrichment is absent; schema rejects signed dates. This is not a successful enriched-date implementation. |
| A05 | Current paid on a signed cohort vs payments during a year | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Different capabilities; cumulative value cannot answer payment-flow query. |
| A06 | DFZ “за 2025” | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Source financial year 2025 displayed and persisted. |
| A07 | DFZ explicit calendar/month scope | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Clarify/unavailable; no rounding to annual coverage. |
| A08 | Interreg “през 2026” | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Ask started/ending/active; preserve other constraints. |
| A09 | Interreg start/end/overlap boundary, null end | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Correct declared inclusivity and missing-date policy. |
| A10 | Latest available FY, relative dates and comparison | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Fixed clock; resolved values persist; no election-year inheritance. |
| B01 | Same programme name in two periods | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Clarification retains metric/place. |
| B02 | Programme code plus fund family | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | ISUN SQL catalog ID validity and programme cohort tests; mechanism classification also covered by query_catalog.test.ts. |
| B03 | Scheme alias across revisions | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Canonical ID/version; ambiguous renamed schemes are not merged. |
| B04 | Beneficiary EIK plus FY and scheme | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | All three reach executor and browser. |
| B05 | Two companies matching a name | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Candidate chooser; never highest-money auto-selection. |
| B06 | Natural-person name or 10-digit personal identifier | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | No EIK coercion or inferred cross-corpus identity. |
| B07 | Lead Bulgarian Interreg partner | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Country/department-country predicate and lead role both applied. |
| B08 | Healthcare institution vs healthcare project | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | P01 offers project-theme and the explicitly limited MZ/NHIF roster choices. |
| B09 | Programme AND theme AND amount | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | All constraints retained; strict > differs from ≥. |
| B10 | RRP and EEA/Norway | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Correct mechanism, not an invented calendar period or EU-only label. |
| C01 | ISUN complete fixture sums | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | 300 cost / 230 grant / 190 paid, coverage shown. |
| C02 | Weighted rates vs mean of rates | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | 190/300 and 190/230 separately labeled. |
| C03 | Zero denominator | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | Unavailable ratio; no 0%, NaN or Infinity. |
| C04 | All-null amount vs published zero | [scripts/funds/query_catalog.test.ts](../../scripts/funds/query_catalog.test.ts) | Unknown differs from 0. |
| C05 | DFZ total and three components | [scripts/db/tests/funding_agri.data.test.ts](../../scripts/db/tests/funding_agri.data.test.ts) | Never sum total plus its components. |
| C06 | DFZ negative correction | [scripts/db/tests/funding_agri.data.test.ts](../../scripts/db/tests/funding_agri.data.test.ts) | FY2026 A net = 35. |
| C07 | Currency conversion/decimal boundaries | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | NBSP EUR parsing and strict comparisons; [SQL fixture](../../scripts/db/tests/funding_isun.data.test.ts) checks >80, ≥80 and >149.99 against source-converted EUR. Query execution does not perform FX conversion or claim cent-exact source precision. |
| C08 | Paid exceeds chosen denominator | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | Preserve >100% with basis note; no clamping. |
| C09 | Count share vs value share | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Parser distinguishes amount denominator; ISUN SQL fixture also asserts count/value shares and evidence. |
| C10 | Cross-source combined funding request | [ai/tools/funding.test.ts](../../ai/tools/funding.test.ts) | Separate compatible measures/statuses; no automatic grand total. |
| D01 | ISUN multiple locations/theme matches | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | One contract identity; no SUM fan-out. |
| D02 | Multi-place money | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Only whole-project inclusion is supported. No allocation or equal-split capability is advertised. |
| D03 | HQ vs implementation location | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Same place words can produce different explicit scopes. |
| D04 | Sofia SFO_CITY / ISUN alias | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Canonical place round-trip retains correct municipality. |
| D05 | Eligible NUTS2 vs participant NUTS3 | [scripts/funds/interreg/programmes.test.ts](../../scripts/funds/interreg/programmes.test.ts) | Prefix eligibility matching distinct from actual participation. |
| D06 | Interreg operation joined to two BG partners | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | O1 counted once, whole budget 1,000. |
| D07 | Partner versus organisation counts | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Partnership rows not called unique legal beneficiaries. |
| D08 | Partner array reordered on reload | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Changing partner_seq leaves the displayed source partnership keys unchanged. |
| D09 | Programme-scoped operation ID duplicate | [src/lib/fundingQuery.test.ts](../../src/lib/fundingQuery.test.ts) | Canonical detail identity is keep_id / keep_partnership_id; unsupported fields and malformed keys fail validation. |
| D10 | Per-capita scope without valid population denominator | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Explicit unavailable/clarify; no guessed population. |
| E01 | Scoped HHI/top-N | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | Full scoped beneficiary population; fixed independent arithmetic. |
| E02 | Tiny sample or nonpositive money denominator | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | No misleading concentration grade. |
| E03 | Debarred normalized-name match | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Catalog label explicitly says name overlap. It does not claim verified identity or unlawful award. |
| E04 | Public-figure connection | [scripts/db/tests/funding_agri.data.test.ts](../../scripts/db/tests/funding_agri.data.test.ts) | Existing canonical predicate parity; current vs historical timing disclosed. |
| E05 | Unknown EIK/link evidence | [scripts/db/tests/funding_agri.data.test.ts](../../scripts/db/tests/funding_agri.data.test.ts) | Unknown not “unconnected”; coverage precedes base filtering. |
| E06 | Zero-paid ISUN project | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | Normalized zero differs from source-observed published zero; provenance gate required for the latter. Neither proves lateness, fraud or completion. |
| E07 | Interreg unpublished/published_zero | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Three publication states preserved in filters and totals. |
| E08 | AND/OR/NOT and negated among | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Parser scope capture plus [SQL fixture](../../scripts/db/tests/funding_isun.data.test.ts) asserts independent base/numerator true/false/unknown AND, OR and negated-base results. |
| E09 | Multiple scalar statuses/nested mixed logic | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Represent exactly or clarify; never pick first match. |
| E10 | One bidder/CRI on a grant | [ai/tests/fundingAcceptance.test.ts](../../ai/tests/fundingAcceptance.test.ts) | Not transferred from procurement; only an evidenced separate relationship may answer. |
| F01 | Precise ISUN prompt vs broad legacy overview | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | New scoped path wins. |
| F02 | DFZ recipient year dropped by old route | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Regression retains year. |
| F03 | Interreg-only prompt | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Dedicated corpus, not ISUN plus optional sidebar. |
| F04 | “Can I apply?” | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Open-call routing stays separate; P15 requires an explicit handoff and explains unsupported award-period/topic eligibility assumptions. |
| F05 | Film/rail/municipal/pension subsidies | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | The full starter suite additionally checks film, railway, culture and other legacy routes. |
| F06 | Procurement “contracts” vs grant agreements | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Domain clarification or correct explicit corpus. |
| F07 | Fake model omits period/programme/money basis | [ai/llm/fundingParity.test.ts](../../ai/llm/fundingParity.test.ts) | Reject/repair before execution. |
| F08 | Heuristic/OpenRouter/WebLLM parity | [ai/llm/fundingParity.test.ts](../../ai/llm/fundingParity.test.ts) | Same canonical query, deterministic numbers and scope, no external calls in CI. |
| F09 | BG accents/Latin aliases/NBSP numbers/typos | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Reviewed normalization; uncertain aliases clarify. |
| F10 | Prompt/document injection | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Closed wire schema plus bound hostile keyword SQL. Retrieved text is not executed as a query definition. |
| G01 | “А само за здравеопазването?” | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Project theme versus institutional roster is a concrete clarification, retaining prior scope. |
| G02 | “Не 2025, а 2026” | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Replace compatible time scope only. |
| G03 | “А по програми?” | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Change grouping, preserve base/amount/period. |
| G04 | “Само изплатеното” | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Switch money basis or clarify if unsupported; do not carry stale ratio predicates. |
| G05 | “Без политически свързаните” | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Known-negative filter with identity coverage. |
| G06 | Interreg operation → Bulgarian partners | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Entire parent cohort; independent amount grain and explicit period inheritance. |
| G07 | Parent result limit=1 with second matching operation | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Both parents' matching children included. |
| G08 | Unknown parent membership | [scripts/db/tests/funding_interreg.data.test.ts](../../scripts/db/tests/funding_interreg.data.test.ts) | Missing identity/date/base/numerator evidence and stale parent revisions cannot become authoritative empty children. |
| G09 | Funding beneficiary → procurement | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | EIK relationship labeled; independent procurement dates; not “funded by”. |
| G10 | Corpus switch with incompatible scope | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Clarify; no silent date/scheme/metric deletion. |
| H01 | Every ready starter typed/clicked/copied | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | All executable default templates plus edited financial-year values and selected S13 EIK/year/scheme in both languages. |
| H02 | Year/programme controls | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Selected value reaches query and visible scope. |
| H03 | Follow-up button and copied wording | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Same continuation intent and scope. |
| H04 | Saved current/legacy/invalid history | [ai/app/Chat.funding.test.tsx](../../ai/app/Chat.funding.test.tsx) | Valid versions restore; invalid version cannot execute broadly. |
| H05 | New chat during pending answer | [ai/app/Chat.funding.test.tsx](../../ai/app/Chat.funding.test.tsx) | Old request cannot overwrite new scope/clarification. |
| H06 | Answer → result URL | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Same canonical fields, stable identities and aggregate. |
| H07 | Revision changes between pages | [src/screens/funding/FundingQueryScreen.test.tsx](../../src/screens/funding/FundingQueryScreen.test.tsx) | Restart/reject; no mixed-revision page chain. |
| H08 | Failed page and retry | [src/screens/funding/FundingQueryScreen.test.tsx](../../src/screens/funding/FundingQueryScreen.test.tsx) | Clear stale rows, preserve scope, disable export until ready. |
| H09 | CSV formula prefixes and capped page | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Escape text; exact displayed rows, scope/revision, cap label. |
| H10 | Keyboard/screen reader and language switching | [src/screens/funding/FundingQueryScreen.test.tsx](../../src/screens/funding/FundingQueryScreen.test.tsx) | Component controls are native buttons with accessible names and table headers. Manual assistive-technology smoke is a rollout check. |
| I01 | Clean Functions-only package | [scripts/ai/buildFundingQuery.test.ts](../../scripts/ai/buildFundingQuery.test.ts) | Generated schema imports without src/React/runtime leakage. |
| I02 | Closed schema and malicious filters | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Unknown fields/SQL fragments/oversized lists rejected, bound SQL only. |
| I03 | Missing relation vs genuinely empty source | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Unavailable vs empty; source coverage explicit. |
| I04 | Explicit Interreg unavailable, ISUN available | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Requested source failure visible, not silently omitted. |
| I05 | Missing date enrichment | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Date capability disabled; unrelated supported metrics still work. |
| I06 | Mid-refresh failure | [scripts/db/tests/funding_catalog.data.test.ts](../../scripts/db/tests/funding_catalog.data.test.ts) | No half-published projection/revision. |
| I07 | Stale catalog or political-link revision | [scripts/db/tests/funding_catalog.data.test.ts](../../scripts/db/tests/funding_catalog.data.test.ts) | Role confidence mutation changes evidence and generation; [SQL fixture](../../scripts/db/tests/funding_isun.data.test.ts) rejects prior cohort tokens after political/debarred-only changes and restores tokens on rollback. |
| I08 | Timeout/permission failure | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Narrow typed failure; no expensive fallback retry. |
| I09 | Disable flag and mixed client/server versions | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Honest rollback; unsupported ready prompts hidden. |
| I10 | Two independent questions / three questions | [ai/orchestrator/fundingUnderstanding.test.ts](../../ai/orchestrator/fundingUnderstanding.test.ts) | Bounded two-result bundle; three requires selection. |
| J01 | Independent JSON oracle vs each SQL compiler | [ai/tests/fundingFixture.test.ts](../../ai/tests/fundingFixture.test.ts) | Counts, amounts, ratios and coverage reconcile. |
| J02 | Populated PostgreSQL fixtures | [scripts/db/tests/funding_isun.data.test.ts](../../scripts/db/tests/funding_isun.data.test.ts) | Required data suites execute; absent relations fail. |
| J03 | Existing procurement query suite | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Existing procurement parser, codec, providers, starters, page and independent SQL fixtures included in release runs. |
| J04 | Existing funds/Interreg/DFZ source suites | [scripts/funds/interreg/parse.test.ts](../../scripts/funds/interreg/parse.test.ts) | Interreg source parsing/measurement/ingest suite, DFZ amount parser and independent population fixtures. |
| J05 | Generated catalog/metadata/destination inventory | [scripts/ai/buildFundingQuery.test.ts](../../scripts/ai/buildFundingQuery.test.ts) | Both generated validators and tool metadata are checked; result URLs are codec-round-tripped. |
| J06 | Both application builds/typechecks | [ai/app/fundingIntegration.test.ts](../../ai/app/fundingIntegration.test.ts) | Main and AI application builds/typechecks are recorded in the release document, not inferred from a unit test. |
| J07 | First/warm/skewed/concurrent latency | [docs/plans/ai-funding-chat-performance-v1.json](../../docs/plans/ai-funding-chat-performance-v1.json) | Measured local first/warm, named custom/generic plans and two-query concurrency. Target attainment is reported, not assumed. |
| J08 | Query/list/rank/trend/export parity | [src/screens/funding/FundingQueryScreen.test.tsx](../../src/screens/funding/FundingQueryScreen.test.tsx) | Full cohort, pagination and deterministic tie ordering agree. |
| J09 | Source freshness/coverage and read-only grants | [scripts/db/tests/funding_catalog.data.test.ts](../../scripts/db/tests/funding_catalog.data.test.ts) | Actual local app_readonly role and populated corpora executed. Production deployment/role smoke remains a rollout check. |
| J10 | Release record and staged rollout | [functions/funding_query.test.js](../../functions/funding_query.test.js) | Disable flag tested hermetically; additive migration rollback tested locally. No production deployment performed. |
