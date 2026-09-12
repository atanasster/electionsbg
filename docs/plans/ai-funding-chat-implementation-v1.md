# EU funds, farm subsidies and Interreg chat — implementation plan

Status: implementation started, 2026-09-12. Step 0 adds a local read-only coverage audit and arithmetic fixtures; application behavior and source data are unchanged at this stage. See [semantics and audit decisions](ai-funding-chat-semantics-v1.md). Subsequent steps below remain planned. Read with [tests and prompts](ai-funding-chat-tests-prompts-v1.md) and the implemented [procurement query reference](ai-procurement-chat-release-v1.md).

## Outcome and scope

Extend the procurement chat guarantees to awarded ISUN funding projects, DFZ agricultural subsidy records and Interreg operations/partners: capture intent, time, programme/scheme, sector/theme, entity, geography, money basis and supported signals; apply every requested constraint or clarify it before executing. Carry the same canonical query through typed prompts, all providers, starter/selector buttons, follow-ups, saved history, result links, pagination and exports.

“Subsidies” here means the existing DFZ/CAP module. Preserve existing film, municipal-transfer, railway and social-payment routes. A generic “субсидии” question without enough context asks which family. “Interreg contracts” defaults to an explicitly labeled grant-operation interpretation only when the question establishes that meaning; distinguish it from procurement contracts awarded by an Interreg participant. Do not infer a procurement-to-grant relationship from a shared EIK.

Reuse procurement's lifecycle and safety guarantees, not its population definitions, risk flags or calendar assumptions. Open calls remain a separate opportunity corpus: asking what one can apply for must not return past awards. Extend its handoff/scope preservation, not its source coverage or eligibility advice, in this plan.

## Audit findings and implementation consequences

| Current code evidence | Gap | Required change |
|---|---|---|
| `ai/tools/fiscal.ts`: `fundsOverview` and `fundsProjects` ignore `_args` and load national precomputed payloads. `router.ts` EU-funds arm passes `{}`. | Calendar, programme, intent and theme cannot survive into analytics. | Canonical funding parser and row-backed executor ahead of broad legacy fallbacks. Preserve legacy unscoped discovery. |
| `ai/tools/subsidies.ts`: overview/by-scheme accept one year; recipient uses an all-years payload and resolves a name using the highest-money first match. | Recipient year/scheme filters disappear; ambiguous names can select the wrong entity. | Scoped recipient execution and multi-candidate EIK clarification independent of ranking. |
| `016_fund_projects.sql`, `043_funds_serving.sql`, `projects_parse.ts`; `144_funds_wire.sql` explicitly documents no event dates. | ISUN has duration and current status, not signing/payment/completion dates. First-seen is ingestion time. | Date-source audit and optional evidenced enrichment before event-date capability; never derive event dates from duration, programme code or first-seen. |
| `046_agri_subsidies.sql`: one year × beneficiary × scheme record; `ingest.ts` aggregates annual amounts. | Rows are not individual dated transactions; financial year differs from calendar year. | Typed financial-year scope and record unit. Month ranges cannot be approximated by whole years. |
| `137_interreg.sql`: separate operations/partners, start/end dates and programming period, three budget publication states. | Grant operations, partner budgets and whole-project costs are different units. | Separate logical corpora and explicit amount/attribution basis; operation counting uses distinct keep ID. |
| `ai/tools/interregArm.ts`: optional helpers catch failures and return null; overview is unscoped. | Explicit Interreg requests could hide unavailable data; broad helpers cannot serve precise constraints. | New execution status per source, no silent disappearance of a requested source; retain unrelated legacy behavior until adapted. |
| `scripts/funds/integrity.ts`, `themes.ts`, taxonomy hooks; `163_agri_political.sql`. | Useful domain signals exist, but not as one scoped catalog. Integrity includes normalized-name debarred matches; themes use editorial rules. | Version definitions, matching evidence, availability, baseline and scope. Do not relabel name matches as verified EIK identity. |
| `ai/render/links.ts`: legacy funds/subsidy destinations largely point to hubs. | A correct scoped answer could reopen a broader result. | Durable funding query page with applied scope/revision and page-export parity. |
| `ai/orchestrator/routeScope.ts`, provider adapters, Chat and procurement continuations. | Current completeness guard and durable context are procurement-specific. | Extend a discriminated analytics context without weakening procurement regressions. |

Treat comments' historical corpus counts as context, not current measured totals. Phase 0 must inventory current tables, loader outputs and coverage under the read-only role before promising a capability.

## 1. Query representation and architecture

Add pure, import-free `src/lib/fundingQuery.ts`, companion `fundingCatalog.ts` and a generated Functions CJS artifact. Expose `fundingQuery` and `fundingQuestion` tools; do not create a tool for every filter combination. Keep flat bounded wire arguments compatible with existing `ToolArgs`, with a typed discriminated internal interpretation. Reuse the validated date/number/codec primitives where semantics match; extract shared primitives with parity tests instead of creating an all-domain parser or importing procurement React/data dependencies.

Canonical fields, validated by corpus capability:

| Dimension | Fields / behavior |
|---|---|
| Identity | Query schema version, population version; corpus `isunProjects`, `agriPayments`, `interregOperations`, `interregPartners`. |
| Operation | summary, count, sum, share, list, rank, trend, compare, detail, methodology. Ranking explicitly chooses metric/direction/grouping and minimum sample. |
| Time | Half-open event dates plus `dateBasis`; separate `financialYears`; separate `programmingPeriods`; explicit `asOf` for overlap/current-state queries and `comparison` window. No conflicting time representations. |
| Programme | Stable programme IDs, procedure IDs where actually represented, fund family/funding mechanism, scheme/intervention IDs with catalogue version. No fabricated procedure join from a title match. |
| Entity | Beneficiary/partner IDs, verified EIKs, entity class, lead-partner predicate; natural-person records have no invented EIK. |
| Place | Canonical place IDs and geography basis: project implementation location, recipient/partner seat, participant location, eligible area. Municipality, settlement and oblast remain distinct. |
| Sector | Beneficiary-sector roster versus project theme versus programme/scheme classification; explicit code/keyword fallback labeled as such. |
| Money | Selected amount basis, currency, strict/inclusive min/max bounds; numerical precision and conversion provenance. |
| Conditions | Separate base and numerator predicates, all/any/negation, explicit denominator and group baseline. Status is a versioned source-specific vocabulary. |
| Links | One-hop parent query with explicit relationship type and independent child period. Entire parent cohort, never its first page. |
| Execution | Stable ordering/tiebreak, bounded page size, revision-aware cursor or equivalent validated offset restart, bounded query encoding and export scope. |

Use an explicit allowlist and maximum sizes; validate unknown fields, malformed lists, contradictory bounds, non-finite numbers, ambiguous Boolean nesting, invalid enums and unsupported cross-corpus combinations. Retain raw prompt span/normalized value/confidence for capture diagnostics and clarification, not as executable SQL. Require parameterized queries and deterministic applied-query equality checks. A model cannot drop a period or substitute a metric silently.

Use a discriminated shared answer context such as `analytics: {domain, query, result}` with a compatibility reader for existing `Envelope.procurement`; choose the smallest migration that preserves saved procurement answers byte-for-byte. Reject unknown/future query versions without executing a broad fallback. A bundle contains at most two independently validated queries and independent source/status/units.

## 2. Time and data enablement

### ISUN

Keep programming period (`2014–2020`, `2021–2027`, etc.) independent of an event year. “ПВУ” is a funding mechanism, not a calendar interval. Normalize existing abbreviated taxonomy codes through a versioned map; retain unknown/Other without silently classifying EEA/Norway funding as EU budget money.

Phase 0 audits cached source exports and authoritative detail records for genuine signature/start/end/completion dates and payment events. If present, add nullable normalized fields and source/date-basis evidence through the existing parser, stage loader and additive migration; backfill with coverage counts and fixture proof. Select source precedence explicitly and preserve disagreements rather than overwriting protected data blindly. If not available, ship explicit unsupported event-date scope plus choices for an actual programming period or an explicitly requested “first observed” window. Do not advertise “signed in 2026” as a working starter until its capability probe succeeds.

“Paid for projects signed in 2026” means current cumulative paid value on that signing cohort, not payments made during 2026. A payment-during-period query requires a dated payment ledger; a current `paid_eur` field cannot support it. Historical values/status/links require snapshots; an `asOf` label does not manufacture them.

### DFZ subsidies

Default a bare year within an unambiguous DFZ question to source financial year and display that interpretation. Support explicit year sets/ranges and comparisons; a calendar-year or month-range request requires clarification/unavailability unless a verified finer-grain source has been ingested. Do not turn 04/2025–01/2026 into FY 2025–2026 without consent. Determine exact fiscal-year boundaries from the dataset metadata in Phase 0 rather than borrowing a universal CAP definition.

Keep unavailable/partial years separate from zero paid. Pin `latestAvailableFinancialYear` from source coverage and persist its resolved value. This scope must not inherit the app election year. Distinguish annual record count, legal recipients and source-reported person groupings; never label the annual row count as a count of bank transfers.

### Interreg

Support programming period, start-date and end-date windows, and active-during-window overlap where both date semantics are verified. A question “през 2026” without an event verb asks whether the user means started, ending or active during the year. Missing dates yield coverage loss, not invented activity. Agree source end-date inclusivity and normalize it once; test same-day and open-ended operations separately.

A current source status is separate from computed schedule overlap. “Active in 2026” does not prove the operation's historical administrative status, receipt of money or a contract signature. “Signed in 2026” remains unsupported without a verified signing field. Partner queries inherit their operation's explicit date basis; budget publication is not a payment date.

## 3. Population and money contracts

| Corpus | Count identity | Default sum and alternatives | Required exclusions/disclosures |
|---|---|---|---|
| ISUN projects | `contract_number` within its serving population; inspect cross-release identity first. Beneficiaries counted separately. | Explicit project total cost, grant, own cofinance or cumulative paid; default based on question, clarify ambiguous “received”. | Null money coverage, cancelled/current status, EEA/Norway versus EU funding mechanism; no joined-location duplication. |
| DFZ annual records | Stored source record identity; current `id` may change on reload, so links must be revision-bound or gain a stable source key. | Net published annual total; direct/market/rural components are alternatives, not additions to total. | Define/version gross-source versus attributable-recipient populations. Existing headlines and legal rankings differ on payer/state-intervention exclusions. Default public recipient analytics excludes payer entries consistently; retain explicitly labeled gross-source reconciliation. |
| Interreg operations | `keep_id`; operation_id requires programme scope and is nullable. | Whole-operation total or EU contribution, once per operation. | Never claim the whole project total went to the selected place/partner. |
| Interreg partners | Stable keep partnership ID, or verified operation/partner key. Unique organisations are another unit. | Own published partner budget or published partner EU contribution. | Bulgarian partner predicate reuses country OR department-country rule; published zero ≠ unpublished; missing EIK ≠ missing partner; negative corrections retained. |

Compute share as aggregate numerator / aggregate denominator over the same base. Expose both values, units and known coverage. Define zero-denominator and all-null results as unavailable ratios, not 0%; never clamp observed ratios to 100%. For ISUN name `paid/projectTotal` and `paid/grant` distinctly and verify the source meaning of `paid_eur` before labeling either “absorption”. Do not average project percentages. Concentration/HHI uses the selected monetary basis, beneficiary identity policy, denominator and complete cohort, with minimum sample and handling for nonpositive net totals.

Use numeric arithmetic at aggregation boundaries and a declared precision/rounding policy. Check source doubles before claiming cent-exact accounting; preserve reported original currency/rate where available. Negative corrections are not automatically excluded. A change to a legacy metric must be versioned and explained, not silently reused under its old label.

Cross-source questions return side-by-side ISUN grant/paid, DFZ paid and Interreg partner budgets with distinct units, coverage and periods. No grand total by default: these are commitments, costs and cash on potentially overlapping beneficiaries/programmes. A combined measure requires a separately reviewed compatible basis and duplicate/overlap policy, not an EIK join followed by SUM.

## 4. Sector, programme, geography and signal catalogs

Version programme aliases, programming periods, funding mechanisms, DFZ scheme aliases, Interreg programme names and BG/EN topic aliases. Programme names may repeat across periods; clarification must retain all other filters. A scheme rename is not proof of equivalence. Compound questions retain programme AND theme AND place, unless the user explicitly requests OR.

Use existing theme definitions (`data/funds/themes.json`, `scripts/funds/themes.ts`) and topic bridge (`functions/interreg_topics.js`) as reviewed inputs. Compile shared matchers so chat and browser use identical conditions. Distinguish title/summary search from a comprehensive sector classification. Multi-label themes must not duplicate projects or create additive shares summing above 100% without an overlap note. “Healthcare beneficiaries” and “healthcare projects” are separate; procurement CPV does not exist on these grant records and must not be reused as their taxonomy.

Geography must distinguish implementation locations, beneficiary headquarters, partner seats and programme eligibility. Reuse canonical place resolvers, preserve `SFO_CITY`/ISUN Sofia aliases and mixed NUTS levels, and keep ambiguous multi-place allocations separate from confirmed ones. Filter records with EXISTS, then aggregate at the original grain. Explicitly choose full-project inclusion versus existing allocated-place money; do not equal-split budgets or use the first location. Per-capita metrics need a named population source/year and unavailable handling, or remain unsupported in v1.

Audit and expose every existing applicable domain signal with a definition/evidence catalog, not all procurement flags by analogy:

- ISUN: existing HHI/top-one/top-five concentration, serial programme winners, debarred-name overlap, political-connection views and current zero-paid/project-status conditions. Known published-zero filters require source observation provenance matched to the serving revision; normalized recorded zero is a separately labeled observation. Distinguish aggregate signals from record filters. Zero paid is not delayed payment without elapsed-time evidence. Preserve the match basis for debarred names and legal timing uncertainty.
- DFZ: legal-recipient concentration, existing canonical public-figure connection predicate from migration 163, and cross-programme EIK presence. Connection status is current unless dated evidence supports another claim. Unknown identity coverage cannot become “not politically connected”.
- Interreg: published/unpublished budgets, EIK/place linkage coverage, lead-partner status, organisation/partner concentration where definable. These are data-quality/exposure measures, not corruption findings. No fabricated procurement CRI or one-bid flag.
- A request for contracts with one bidder funded by a grant requires an evidenced project-to-procurement link. EIK-only relationships may answer “procurement of these beneficiaries”, labeled as such, with a separate procurement period. Exact funded-by linkage remains unsupported until a verified relationship source exists.

Store catalog/source revisions and availability before risk-dependent base filters. AND/OR/NOT uses three-valued truth; unavailable evidence is neither positive nor known negative. Recompute scoped concentration from full scoped data rather than reusing national top-N payloads. Unsupported multi-category or nested expressions clarify before execution.

## 5. Serving and application integration

Add `/api/db/funding-query` and `/api/db/funding-capabilities`, generated package freshness checks and corpus-specific SQL compilers. Return status `success`, `partial`, `empty`, `unavailable` or `unsupported`, canonical applied query, revisions, catalog versions, totals, rows/groups, scope and coverage. Cap query size/list limits/runtime and return narrow timeout/missing-migration failures without expensive fallback retries.

The capability descriptor reports fields and date bases per corpus, source coverage windows, identity/money/link coverage, allowed signals and projection readiness. It must be executable under the actual read-only role. Empty fixtures may not disguise absent relations. Revision publication must be atomic with source/projection refresh, including taxonomy and political-link inputs. Use additive migrations with numbers selected at implementation time, loaders and grants; do not hardcode the next migration number in this plan.

Integrate a focused `fundingUnderstanding.ts` before legacy broad funding branches, with explicit arbitration against procurement and open calls. Parse BG/EN dates, years, negation, amounts, aliases and modifiers once; reuse stable primitives with a fixed test clock. Programme periods containing years must not be stolen by calendar parsing. Revalidate model-selected calls against captured constraints in OpenRouter/WebLLM and rules-only paths. Separate ambiguity from missing source support; both preserve the original query.

Add `ai/tools/funding.ts`, bilingual question contracts, typed starter metadata, suggested continuation intents and generated tool metadata. Continue from applied context, not a natural-language answer. A user replacing a period replaces only that compatible time field; changing metric resets its numerator/denominator as needed; changing corpus revalidates every retained field. No invisible deletion of incompatible scope. Resetting chat clears pending clarification and scope; request-generation guards prevent delayed answers changing newer context.

A dedicated `/funding/query` screen runs the same definition, with human-readable filters, evidence links, methodology, error/retry states and accessible controls. Existing entity/project/programme pages are detail destinations; they cannot substitute for a query URL that their controls cannot represent. Typed/clicked/copied follow-ups, history reload, browser navigation and CSV export must preserve all supported scopes. Source URLs and retrieved text are evidence, never instructions to the agent.

## 6. Delivery sequence and gates

| Step | Deliverables | Acceptance gate |
|---|---|---|
| 0. Semantics and source audit | Column/data coverage, duplicate identities, source date evidence, population/money/signal inventory, independent fixtures. | Every requested field is classified supported, enrichment-required or genuinely unavailable; no financial/calendar or operation/partner ambiguity. |
| 1. Shared query contract | Schema, catalog, codec, clean generated CJS, capability matrix and shared primitives. | Invalid/unsupported constraints cannot execute broadly; procurement tests remain unchanged and green. |
| 2. Data enablement | Evidenced date enrichment where available, taxonomy/scheme/theme projections, stable IDs, revision/grant/loader integration. | Local rollback fixtures and populated read-only audits pass; unavailable dates stay null and capabilities honest. |
| 3. ISUN analytics | Row-backed aggregates, money bases, programme/theme/place filters, domain signals. | Independent sums, weighted rates, identities and location fan-out tests reconcile. |
| 4. DFZ analytics | Annual scope, scoped recipients/schemes, typed identity and exclusion policy, political/concentration queries. | Year retained on recipient drill-down; no annual-row/transaction conflation; unknown persons never merged into legal entities. |
| 5. Interreg analytics | Separate operation/partner queries, programming/event dates, attribution and publication coverage. | Full-project and partner money never mix; missing budget and partial source availability remain visible. |
| 6. Understanding and providers | BG/EN extraction, entity/period/category clarification, completeness guard, bounded bundles and relationships. | Named prompt cases preserve every constraint or explicitly clarify; fake model omission and negative-domain tests pass. |
| 7. Product integration | Starters, selector, follow-ups/history, result page, pagination/export and metadata. | Typed/clicked/copied canonical parity and answer-to-browser row/aggregate parity. |
| 8. Release verification | Full affected suites, source-backed fixtures, both builds, performance, rollback and release record. | No scope-loss regressions; advertised capabilities execute against populated data; unresolved checks stated separately. |

Follow the repository's per-step review/repair process when implementation is requested. This plan does not authorize deployment or source publication. Do not stop after a parser that merely routes all requested analytics to unavailable: implement all capabilities supported by verified data, including necessary serving projections and source enrichment when proven available.

## 7. Rollout, observability and completion

Deploy compatible schema/projections/grants, verify source coverage and atomic refresh, then endpoint/capabilities, then ready UI templates. Test old-client/new-server and new-client/old-server combinations. A funding-specific disable flag must return honest unavailable responses and preserve legacy unscoped discovery; never roll back to dropped filters.

Measure representative bounded queries across all four logical corpora, first request and warm runs, skewed programme/EIK/place filters, multi-label EXISTS joins, concentration, prepared/generic plans and small concurrent load. Use procurement's <2 s warm p95 target as a measured target, not a guarantee; preserve server timeout semantics. Record corpus revisions, sample size and environment. Test projection failure and stale revision behavior.

Log normalized capability/rejection reasons, clarification outcomes, empty-versus-unavailable rates, query latency/timeouts and revision mismatches without persisting raw prompts, personal names or identifiers unnecessarily. Maintain an explicit acceptance-case-to-test mapping, not just an aggregate test count. Missing-source conditional tests cannot count as passed implementation of a working advertised feature.

Completion: period, intent, programme/scheme, sector/theme, entity/place, money basis and supported domain signals survive every entry and continuation path; independent arithmetic and source coverage reconcile; unavailable evidence never turns into a broad answer or a fabricated zero. Release notes must distinguish local tests, live-provider smoke tests and production deployment checks.

## 8. Plan gap review incorporated

The second pass added the following requirements to prevent a mechanical copy of procurement behavior:

1. Date enrichment is an explicit implementation dependency; programming periods, financial years and first-seen dates cannot substitute for missing event dates. A prompt can contain a programming period AND a separate event window.
2. ISUN project cost, grant and cumulative paid are separate measures; EEA/Norway and RRP classification is preserved. Current paid totals are not a dated payment ledger.
3. DFZ gross-source versus attributable-recipient populations and state/payer exclusions must reconcile before rollout; annual records are not transaction counts or verified person identities.
4. Interreg operation, partnership and organisation identities remain distinct. Budget publication, country/department-country, partial legal identity, reordered partners and non-reconciling partner sums all have test gates.
5. Geographic inclusion, allocation and eligibility are separate. Sector/theme aliases require a versioned corpus-specific map, not imported procurement CPVs.
6. Domain signal scope and evidence quality are cataloged. A name match, current political connection, unpublished budget or zero paid value is not a legal/corruption finding.
7. Cross-source/parent queries use full cohorts, separate dates and source statuses; EIK co-presence cannot establish that a grant financed a procurement contract.
8. Capability-driven starter visibility, typed continuation parity, old history compatibility, atomic revision publication, rollback, scoped exports and a per-case acceptance ledger are delivery requirements, not later polish.
