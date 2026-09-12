# Procurement chat: implementation plan

Status: implemented locally, 2026-09-12; release verification is recorded in [the release record](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-release-v1.md). This document retains the original design requirements; the release record identifies concrete implementation choices and deployment limits. Read with the [code audit](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-audit-v1.md) and [test and prompt specification](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-tests-prompts-v1.md).

Plan review incorporated on 2026-09-12: the query representation, deployment boundary, KZK evidence semantics, query/history lifecycle and release gates below include the second-pass corrections. The audit records the gaps and their disposition.

## Required outcome

For “какъв процент от обществените поръчки за 2026 са с 1 участник”, capture the contracts corpus, percentage operation, exact-one-bid measure and calendar 2026. The answer must provide a scoped numerator and denominator, identify excluded/unknown records and show the date basis and data coverage. It must not return the all-time overview. A follow-up such as “А само за здравеопазването?” must preserve 2026 and the measure while resolving what healthcare means.

Apply the same query machinery to contracts, amendment events, announced tenders, KZK complaints and KZK acts. Support typed questions, offline chat, model-selected calls, starter buttons, the question selector, clarification buttons, follow-ups, restored history and result links.

## Product questions to support

These are proposed user needs inferred from the product and audit, not claims from analytics or interviews.

| Need | Questions and useful operations |
|---|---|
| Understand spending | How many contracts, for how much, in which period? Current recorded value or signing value? Monthly trend; compare years or equivalent year-to-date windows. |
| Understand competition | Share with exactly one bidder; distribution of bidder counts; direct awards; which buyers/sectors have unusually weak competition relative to a defined baseline? |
| Investigate signals | List contracts firing a named check; two checks together; any of several checks; no observed signals versus checks unavailable; highest fired count/CRI with coverage. |
| Compare institutions and suppliers | Largest buyers/winners in a scope; highest rates with sample sizes; buyer exposure versus supplier risk; one entity's history. |
| Explore sectors | Purchases by a sector's institutions; purchases of a subject by any institution; intersections of both; hospitals versus ministries; road works versus АПИ. |
| Find tender opportunities | Announced in a window, open for submissions now, cancelled, funding/framework type, topic/CPV, buyer, deadline and estimated value. |
| Follow tender outcomes | Which procedures have contracts, how quickly, awards over estimates, appeals and suspensions; drill down by УНП. |
| Understand KZK | Complaints filed in a window, outcomes known now, acts issued in a window, upheld/rejected/refused proceedings, requested versus granted interim measures, unresolved linkage. |
| Trace evidence | Show matching records, source act, exact risk explanation, cohort definition, coverage, and the same filters on the website. |

Do not promise corruption verdicts, supplier participation lists when only a bidder count exists, cash payments from contract values, historical knowledge snapshots without source snapshots, or appeal-duration statistics without verified dates.

## 1. One query contract

Create an import-free shared module, proposed `src/lib/procurementQuery.ts`, with schema, types, canonicalization, capability validation and localized scope descriptions. Split growing catalogs into adjacent pure modules. It must not import React, fiscal tool implementations, node-pg or filesystem code. Extract roster metadata from the React sector-pack module; the UI may continue attaching its `Section` components separately.

Use a discriminated internal query model. The following is a specification sketch, not an assertion that current `ToolArgs` supports nested objects:

```ts
type CommonProcurementQuery = {
  version: 1;
  operation: 'summary' | 'count' | 'share' | 'sum' | 'list'
    | 'rank' | 'trend' | 'compare' | 'detail' | 'methodology';
  period: { from?: string; toExclusive?: string; dateBasis: DateBasis };
  scope: {
    buyerIds?: string[]; supplierIds?: string[];
    buyerSectorIds?: string[]; subjectSectorIds?: string[];
    cpvPrefixes?: string[]; topicId?: string; keyword?: string;
    geography?: GeographyScope; funding?: FundingScope;
  };
  relatedPeriod?: RelatedPeriod; // Separate related complaint/act date constraint.
  parentCohort?: ParentCohort;   // Validated one-hop parent query and relationship.
  groupBy?: Grouping;
  comparison?: ComparisonSpec;
  order?: OrderSpec;
  limit?: number;
};
type ProcurementQuery = CommonProcurementQuery & {
  [C in Corpus]: {
    corpus: C;
    filters: FiltersByCorpus[C];
    measure: MeasureByCorpus[C];
  }
}[Corpus];
```

Carry extraction evidence separately: raw question, explicit/inherited/default origin per slot, recognized spans, unresolved material phrases and any clarification choices. It is not SQL input. Log only the minimum existing privacy policy allows; prefer anonymous aggregate error classes over storing raw prompts.

Current `ToolArgs` is flat, and `ParamType` does not provide arbitrary nested schemas. Add a deliberate wire adapter with registry-supported flat fields: corpus, operation, from, toExclusive, dateBasis, metric, denominator, buyer IDs, supplier IDs, buyerSector, subjectSector, CPV prefixes, topic, status/outcome, risk IDs/mode, grouping, limit and comparison fields. Extend declared enum-array validation/schema generation once for risk/ID lists; never encode an unchecked query or SQL expression in a free-form JSON string. Validate bounds and cross-field combinations after flat arguments are parsed.

Introduce a single registered capability, proposed `procurementQuery`, for analytical requests. Keep existing tool IDs as compatibility adapters for saved questions/history. Specialized methodology, debarred-register, buyer-grade and supplier-grade questions retain their own measures and explicit adapters. Decompose internal services by corpus so one public contract does not produce another monolithic fiscal file.

Unknown procurement fields must produce a validation error. Scope this change to procurement initially; do not unexpectedly break all legacy tool argument handling. Generated model schemas, tool parameter metadata and question definitions must all derive from the same supported fields. Model tool descriptions should include the differences between complaint/decision dates and buyer/subject sectors.

### Executable schema requirements

Step 1 must define the sketch's referenced types and a complete operation × corpus × measure × filter support table. Do not leave `MeasureSpec` or `CorpusFilters` as unchecked dictionaries. Every advertised prompt must map to declared fields, including bidder comparisons, minimum fired-check count, minimum group sample, amount bounds/currency, procedure type, funding/framework status, cancellation, appeal presence, outcome, suspension, date basis and value basis. A filter on a joined corpus belongs to a named relation and cannot accidentally filter the primary corpus instead.

Define bounded predicate sets with `all`/`any` and explicit negation. V1 supports one level of predicates such as exact-one-bid, named risk, appeal presence and named outcome; ordinary period/entity/sector dimensions remain conjunctive base filters. Distinguish `basePredicates` from `numeratorPredicates`. The flat wire adapter must represent both, including the existing “one bidder OR upheld appeal” prompt; supply declared predicate IDs, comparison values and set mode rather than arbitrary expression text. Unsupported nested Boolean expressions require clarification; they cannot be flattened by changing precedence. AND/OR/NOT must use three-valued evaluation: for example, true OR unknown is true, false AND unknown is false, and NOT unknown is unknown. Report evaluable/unknown composite counts as well as each flag's availability.

Represent “contracts published in 2025 with complaints filed in 2026” with primary `period` on contract publication and `relatedPeriod` on complaint filing. Its wire fields are `relatedCorpus`, `relatedDateBasis`, `relatedFrom` and `relatedToExclusive`; validate them against an allowed relation table. A parent cohort contains the canonical base/numerator query, its population version and a relation such as contract→procedure→complaints. Permit one analytical parent hop, forbid cycles/unbounded nested queries, and calculate the relation by server-side semijoin. Do not implement it as an opaque reference that only works in one browser session.

For an utterance with two measures on one population, use an explicit summary bundle such as count + value. For two distinct requests, return a bounded two-item query plan with per-item scope and status, executed through the same query capability; if the request exceeds that bound, ask which part to run first. A single tool choice must not quietly answer only the first clause. Catalog complexity must be measured against each provider's supported schema; use a compact corpus-specific schema projection if necessary, with the full server validator remaining authoritative.

The proposed `src/lib` module cannot be directly imported from deployed CommonJS functions outside their deployment directory. [Firebase's functions source](/Users/atanasster/data-bg/firebase.json:21) is `functions/`. Keep one TypeScript source of truth and generate a self-contained CommonJS validator/catalog artifact under `functions/generated/` with a schema hash and freshness check, or use an equivalent explicit build/package step that ships all dependencies. Specify and test that step before route implementation; never maintain a hand-copied validator or assume Node/tsx in development proves the deployed package works.

## 2. Routing, clarification and scope preservation

Pipeline: **detect corpus → extract period/operation/filters/entities → resolve references → validate capabilities and completeness → execute → verify applied scope → render**.

Use deterministic parsing for dates, quantities, explicit IDs, known aliases, catalog risk names and common operations. A model may propose remaining slots through the same schema. Do not let the model generate SQL, database route names, CPV regexes or risk formulas. An independent deterministic extraction pass guards explicit periods, identities and known constraints against model omission. Unhandled procurement qualifiers trigger clarification or an explicit unsupported result, not a general overview.

Place procurement intent handling before overlapping generic company/place/budget routes. Keep negative-domain tests for prices, funds, health expenditure, Търговище, търговски дружества and non-procurement КЗК activity. “КЗК” alone can require a corpus clarification. An exact УНП plus “жалби” or “рискове” should select the requested aspect of that procedure, rather than discard the aspect in unconditional detail routing.

Resolve АПИ and other known institution aliases through shared stable identities; fuzzy names require scored candidates and ambiguity handling, not `limit:1`. “Участник” in a one-bid question maps to the recorded bidder-count field, never to consortium-member count or a fabricated bidder list. Support synonyms such as една оферта/един кандидат/one bidder only with a displayed data-field interpretation; clarify where wording explicitly asks for another quantity.

Fresh unscoped procurement questions use all available records with that scope visible, preserving established discovery behavior. Explicit calendar periods always win over global election selection. Inherit a resolved period within a relevant follow-up. “За този парламент” explicitly invokes the existing parliament window. Do not infer a procurement calendar from a bare four-digit election token in unrelated history.

Ask one focused question when ambiguity materially changes the population; preserve every resolved slot while waiting. A clarification response patches a pending query and goes through normal validation. Provide supported alternatives for unavailable capabilities; never silently execute the closest one.

Unknown capability is not the same as an unknown phrase: first try literal entity/subject resolution within the detected corpus. Recognize Bulgarian inflections, Unicode spacing, common Latin transliterations, grouped numbers and decimal commas without stripping meaningful negation or quoted subjects. Distinguish a new complete question from an elliptical continuation. Corrections such as “не 2026, а 2025” replace the rejected value rather than creating a range. Scope evidence belongs to the current user request or a selected prior answer; quoted tender/act text is source data, never an instruction to change tools or filters.

## 3. Time semantics

Use ISO date bounds with a half-open interval `[from, toExclusive)` throughout canonical queries and SQL. Existing inclusive table consumers need an explicit calendar-day conversion until the table API supports exclusive bounds. Do not reuse the present “off by one day is fine” browser behavior.

| Input | Canonical period |
|---|---|
| за 2026 / in 2026 | `[2026-01-01, 2027-01-01)` |
| от 04/2025 до 01/2026 | `[2025-04-01, 2026-02-01)`; inclusive named end month |
| от 15.04.2025 до 31.01.2026 | `[2025-04-15, 2026-02-01)`; inclusive named end day |
| април 2025 – януари 2026 | Same month interval |
| второто тримесечие на 2026 | `[2026-04-01, 2026-07-01)` |
| миналата година | Calendar 2025 with a clock fixed to 2026-09-12, Europe/Sofia |
| през последните 12 месеца | `[2025-09-13, 2026-09-13)` under the fixed clock: upper bound is tomorrow, lower bound is 12 calendar months before it, with month-end clamping |

Reject impossible/reversed dates and ambiguous numeric locale dates rather than normalizing invalid dates. Distinguish a range from “сравни 2025 и 2026”. Support open-ended since/until dates with explicit bounds. Relative terms resolve once using an injected Europe/Sofia clock; persisted answers keep their resolved bounds. Handle leap days and year rollover.

Default contract date basis is the existing record/publication `date`, honestly labeled. Requests for signed contracts use a verified signature-date field only; assess existing fallbacks before enabling the signature measure. Do not filter publication dates and label results as signature dates. Tender default is publication date; “с краен срок през…” uses submission deadline. Appeals default is complaint date; decisions default is act date. Normalize text dates into validated queryable date projections with invalid/missing counts, retaining raw source strings.

“Жалби подадени през 2026 и уважени” is a complaint-date cohort with outcomes known at data refresh. “Решения през 2026” is an act-date cohort even when its complaints are older. Cross-corpus follow-ups must state which cohort is preserved. An explicit cohort can carry a stable parent query reference rather than thousands of client-supplied IDs.

Current-year answers show source freshness and observed coverage; do not infer complete-year coverage from the newest record. Offer an equal-window year-to-date comparison explicitly, never silently shorten a requested full-year comparison. Stored current values, political links, concentration baselines and risk caches are current knowledge about selected older rows, not historical knowledge at the time of award.

An “open now” predicate needs an instant, not just a calendar date. Preserve deadline timezone/time precision; compare a verified timestamp with injected `asOfInstant`. A date-only deadline is uncertain on its final day unless the source defines an end-of-day rule; do not invent 23:59. Unknown status/deadline stays unknown. Keep date-based annual windows distinct from timestamp comparison, including DST transitions. Such queries expire at the earliest relevant deadline/status freshness limit, even if the data revision is unchanged; cap cache TTL at 60 seconds and include the resolved as-of basis. Reopening a saved “open now” query explicitly refreshes the instant, while its historical answer remains labeled with the original instant.

Data coverage must distinguish valid matching rows, invalid/missing date rows in the relevant non-date scope, records outside the date window and missing source partitions. Invalid dates cannot be assigned to the requested year, so disclose them as unassignable rather than claiming they are excluded 2026 records. Preserve expected-month gaps from ingestion metadata; latest-row date is insufficient. Future-dated observed records remain visible if explicitly within the query, with a data-quality flag instead of silent clipping to today.

## 4. Statistical and monetary definitions

Phase 0 must pin the serving population contract before SQL is written. Recommended v1 measure: **recorded contract awards**, `tag='contract'`, excluding `consortium_role='member'`; retain the carrier and ordinary rows. Count stable stored keys and expose `unit='contract_records'`. Do not deduplicate by УНП, value or title: that collapses distinct lots/contracts. Supplier-participation questions use a separate unit and can include member rows. Audit cross-source and multi-release identity before offering “unique legal contracts” as another unit. Keep legacy overview adapters on a labeled legacy basis until a coordinated count change is intentionally released.

Treat amendments as a separate event corpus; count changes independently, and use cumulative annex growth on their base contracts. A base-contract-only query requesting the amendment-row flag should map to amendment events after explicit interpretation or clarify. It must not return a deceptively clean zero.

Keep framework attribution as modeled today, label framework ceilings and their count unit, and separate them from signed delivery/spending claims. Validate the existing normalized allocation across framework supplier rows rather than copying the full ceiling to every supplier. Never sum `consortium_full_eur` for member rows into contracted totals or assume a member's private revenue share.

For the screenshot, return the exact-one-bid count and **two explicitly named shares**: one-bid/all selected contract records, and one-bid/records with positive known bidder counts. Show zero/invalid and missing counts separately. Thus the user's “of all procurement” wording is answered without hiding data availability. An explicit denominator choice can select one as primary. A zero denominator produces no percentage, never 0% or NaN.

Define `baseScope` separately from a measure's numerator condition. For “share with one bidder”, do not filter the denominator to one bidder. For “among direct awards”, direct award is a base filter. For “one bidder AND upheld appeal”, compute the intersection; “OR” computes the distinct union. Negated flags require available-and-not-fired, excluding unavailable rows and reporting them.

Keep these measures distinct:

- Raw exact-one-bid prevalence, including direct awards if no procedure filter was requested.
- Existing competition benchmark's population and methodology, including its present recorded-zero treatment unless intentionally revised and versioned.
- `weakCompetition`, a catalog-defined risk with CPV exclusions and relative thresholds.
- Per-contract grade (fired-count bands), CRI (available-check ratio), buyer exposure grade and supplier risk grade.

Return money as a numeric value plus EUR unit/basis. `amount_eur` is current post-annex value; use signing value only where derivation is trustworthy and label missing coverage. Tender estimate, framework ceiling, contract value and cash payment are different measures. Do not aggregate preformatted strings. Rankings must aggregate the full filtered population before LIMIT, use stable tie-breakers and show denominator/sample size. Rate comparisons should show low-sample warnings; any minimum sample filter is explicit.

Specify `minGroupCount` with `minGroupCountBasis`: population or the measure's evaluable denominator. The “at least 20 contracts” starter means 20 population records; “20 with known bids” means the latter. Rank percentages by exact fractions, not rounded display values. A comparison returns per-period numerator/denominator and both labeled percentage-point difference and relative-percent change where requested; relative change from zero is unavailable. Do not treat overlapping sector totals as additive or average sector percentages. Trend bins with observed coverage and no matches are zero counts; missing/unavailable bins are null, and ratios with zero denominator are null.

Money thresholds need explicit value basis and currency. Parse Bulgarian grouped numbers/decimal commas; use the repository's pinned normalization basis for BGN/EUR, not a live exchange rate, and echo the interpreted threshold. Preserve numeric precision through database/wire aggregation and round once for display; values beyond safe JS integer precision need an exact decimal representation. A sum with all values unknown is unknown, not EUR0; zero known values are legitimate zero. Distinguish missing/negative/invalid source values and framework/VAT basis where known. Do not invent a common VAT basis or remove documented correction records merely to make totals positive. The flat envelope `facts` remains a presentation projection; do not force structured null/coverage values into misleading numeric zeros.

## 5. Full risk coverage

Use [riskFlagCatalog.ts](/Users/atanasster/data-bg/src/lib/riskFlagCatalog.ts) for IDs, explanations, availability and threshold metadata; preserve SQL as the contract-score authority and existing TS parity tests. The following are the current product rules, not independently verified legal standards.

| ID | Required query behavior and interpretation |
|---|---|
| `debarred` | Contract signal from the modeled register match; distinguish active-register browsing from matches on historical awards and historical exclusion-at-award queries. |
| `mpConnected` | Canonical MP connection evidence; current linkage basis disclosed; overlap with official connections must not double-count totals. |
| `pepConnected` | Official/PEP connection evidence and availability; preserve distinction from MP-only linkage. |
| `awarderConcentration` | Existing pair share threshold 30%, buyer-value floor €100,000; existing baseline is broader than an arbitrary question window. A new window-local concentration measure needs a different ID. |
| `amendment` | Row is an amendment event, not proof of irregularity; separate event population. |
| `annexGrowth` | Existing cumulative growth check at 50%; signing/current value basis, availability and catalog caveats. |
| `newFirmWinner` | Company established less than 12 months before award, with valid dates. |
| `splitPurchase` | Existing repeated-purchase grouping heuristic; preserve its grouping window and baseline rather than regrouping a truncated result page. |
| `appealUpheld` | Linked upheld merits outcome; a complaint alone or refused proceedings cannot fire it. |
| `weakCompetition` | Raw bid data plus catalog CPV baseline; preserve structural single-bid suppression and the existing five-digit cohort comparison. |
| `directAward` | Canonical known procedure type/rationale; distinguish unknown type from competitive procedure. |
| `shortTenderPeriod` | Contract tender-period dates and existing 14-day check; currently unavailable in the audited 2026 local rows. Expose unavailable, not zero prevalence. |
| `nkidMismatch` | Existing company activity/CPV crosswalk; missing or unmapped NACE/CPV is unavailable. |
| `nonOpenProcedure` | Tender check using known procedure type; no invented “competition” for missing types. |
| `rushedDeadline` | Tender competitive tiers only, valid duration below 12 days according to the current catalog. |
| `shortDecisionPeriod` | Tender award-dependent check: earliest genuine signing date after deadline, 1–4 days inclusive; preserve rejection of fallback dates/day zero. |
| `awardOverEstimate` | Tender award-dependent check: aggregate awarded value strictly greater than 110% of positive estimate; count/amount attribution prevents duplicated consortium value. |

Expose available/fired/unavailable counts for every requested check. SQL mask checks must reference stable catalog IDs/positions and served `contract_risk_meta`, not simply the newest bundled catalog version. Missing/stale incompatible risk caches produce capability-unavailable status until rebuilt. Never change bit meanings in place.

Buyer exposure and supplier grades are additional supported analytical families; use their existing weights, evidence and populations. The neutral `ngoForeignFunded` disclosure remains outside risk counts and grades. “Няма рискове” should be phrased as “няма установени сигнали сред проверимите показатели”. A model must not convert a signal into a corruption allegation.

Separate the date window selecting records from the context window that generated their signals. For concentration, split-purchase, CPV benchmarks and current political/register links, return `baselineScope` and evidence revision. Filtering to January must not recompute a lifetime flag as a January-only flag, or imply that it did. Historical-as-known queries require actual historical evidence; a period-filtered current cache is not enough. Dedicated buyer/supplier grades cannot accept an unsupported custom period through an adapter and then silently return a lifetime grade.

## 6. Sector classification

Maintain two independent, versioned registries: `buyerSector` (audited EIK membership) and `subjectSector` (reviewed CPV/topic definitions). Normalize EIK aliases using established identity logic; deduplicate membership before counting. OR within a sector/ID list, AND between distinct dimensions. Overlapping sectors cannot be summed as disjoint national shares.

Keep `nzok` as a compatible URL alias for the existing МЗ + НЗОК buyer group. Preserve the roads/АПИ pack. A generic healthcare query offers “възложители МЗ + НЗОК” versus “медицински стоки/услуги по CPV”; broader hospital coverage requires an explicitly audited roster with a meaningful label. A road-work subject needs a reviewed set of CPV prefixes/topics; all CPV 45 construction is too broad. Do not invent this crosswalk from chat keywords at runtime.

“На АПИ” selects a buyer; “за мантинели” selects the curated topic. Both constraints apply together. Topic text matching and CPV matching must have one server definition, including prefix length and diacritics/transliteration policy, shared with browser results. Unknown sectors produce suggestions/clarification, not a broad default. KZK sector-by-subject usually relies on a verified tender link; report unmatched coverage and do not classify unlinked complaints as outside the sector by fact.

Subject definitions must record CPV edition/prefix rules, inclusion/exclusion examples and text-match evidence. Check additional/lot CPVs as well as a primary CPV if the corpus stores them; otherwise label primary-CPV-only coverage. Healthcare cannot be reduced to division33 (goods), and all division85 is not automatically healthcare. Scope for buyer geography means the institution's address unless verified execution-location data exists; supplier address or institution headquarters must not be presented as where work occurred. Register a fixed roster/classification version for historical queries; either use verified effective-dated membership or clearly label current-roster membership applied to historical records.

## 7. Server queries and data serving

Add a validated analytics route, proposed `/api/db/procurement-query`, backed by corpus-specific services and a shared filter compiler. Extend the table engine where appropriate for reusable predicates; the same query must drive full-population aggregates, rows, facets, charts and exports. Do not fetch all raw records into the AI process, calculate on top-10 rows or send raw SQL through a tool.

Implementation requirements:

1. Parameterized filters with bounded IDs, CPV prefixes, date windows, groupings, sort fields and page sizes. Catalog IDs resolve to server expressions; reject malformed/unknown dimensions. Keyword input is literal text unless an explicitly supported syntax exists; escape LIKE wildcards.
2. Canonical contract base with mask/availability joins; separate amendment base. Avoid multiplying amounts when joining company links, risk evidence or KZK records: use EXISTS or pre-aggregated one-row-per-unit joins.
3. One tender row per УНП, with correctly attributed award aggregates and four risk checks in a queryable projection/cache. Refresh it after tenders, contracts and relevant attribution changes; add freshness/version metadata. Do not reimplement thresholds without parity fixtures.
4. Complaints view with complaint date, effective outcome/suspension, requested interim measures, buyer identity, linked procedure and queryable act date. Decisions view with validated act date, kind, source and normalized outcome only where the existing evidence supports it. Preserve acts without linked complaints. Treat unknown historical act kind explicitly; never present null-kind acts as known merits decisions.
5. Use existing act references/match outputs where proven; a decision-to-complaint relation must support many-to-many provenance, matching method and uncertainty. Do not join on names alone or explode semicolon-delimited participants into synthetic complaints. Decision counts are distinct act numbers; complaint counts use complaint primary keys; procedure counts are distinct linked УНП with unknown linkage reported.
6. Separate complaint outcome distribution from an upheld rate among classified merits outcomes. Refusal, suspension, procedural acts and unclassified records need their own buckets. “Обжалвани договори” uses linked contract/procedure membership, not complaint count.
7. One SQL statement for mutually consistent numerator, denominator and page, or deliberate repeatable-read scope for a multi-statement result. Add an ingestion-concurrency test. READ ONLY by itself is insufficient.
8. Reuse existing precomputed payloads only when the entire canonical query matches their supported scope and measure version. Never slice a cached top-25 list to answer arbitrary buyers/sectors. Keep bounded live queries for custom ranges and combinations; introduce rollups only after measurement. Ratios require summed numerator/denominator, not averages of percentages.
9. Canonical cache keys include resolved query, population/methodology version and relevant data revision. Cache only valid compatible results; rejection/timeout must not persist as zero data. Monitor hit rate and query class without logging unnecessary free text.
10. Validate local and serving-equivalent query plans with production-shaped statistics, generic/prepared plans and cold/warm paths. Aim for p95 under 2 seconds for bounded indexed analytics; treat this as a release target to measure, not a claimed current benchmark. Preserve the existing 10-second database timeout and test timeout UX. Narrow KZK migration fallback to known missing-relation/function SQLSTATEs; never retry 57014 as an expensive live calculation.

### KZK outcome evidence and protected data

The current [classifyOutcome](/Users/atanasster/data-bg/scripts/procurement/kzk_match.ts:259) prioritizes upheld segments in mixed/partial acts to answer a procedure-risk question. The reserved `частично` code is not currently produced by that classifier. Reusing its output as a precise “fully successful complaint” measure would be wrong. Preserve existing risk behavior, name the analytical metric as recorded upheld outcome including partial/mixed acts, and expose the limitation. A full-versus-partial success question needs independently reviewed, party/lot-specific evidence; return unsupported where that evidence is absent. Do not propagate one act-level label to every linked complaint as an independently verified party outcome.

Distinguish `outcomeBasis` values for protected manual classification, act-derived coarse classification and status-derived effective ending. Keep the as-of classification used in an answer and its evidence link. Multiple acts per complaint require explicit act-kind/date ordering and a reviewed rule for the served outcome; the newest procedural act cannot supersede a merits outcome just because it is newer. Do not infer final judicial status from the KZK register.

New query views are read-only. Preserve [131's provenance ownership](/Users/atanasster/data-bg/scripts/db/schema/pg/131_kzk_appeal_provenance.sql:15) and [partitionByProvenance](/Users/atanasster/data-bg/scripts/procurement/kzk_provenance.ts): protected manual rows, including date-only hand-touched rows, cannot be overwritten by a query migration/rebuild. Status-derived `отказана` is computed on read and never written back to raw outcome. Add row-level before/after checks for protected values, not just a minimum row-count assertion. Source classifications and linkage uncertainty stay separate; a new bridge is not authorization to reclassify the corpus.

The new endpoint also needs route registration in the deployed handler, query/response typings and read-only database access checks. Cap predicate count, relation depth, comparisons (two), page size (100), keyword length (256 characters) and resolved ID sets (200 unless an audited server-side roster is used). Reject oversize requests explicitly; never truncate filters. Deduplicate identical in-flight requests and propagate cancellation where supported, while guarding UI state even when a database query cannot be cancelled. Test representative concurrent query load as well as one-user latency.

New projections need migration ordering, read-only grants, refresh/dependency registration, health checks and data-test coverage. Follow the repository's actual migration/loader architecture; choose the next migration number at implementation time because this working tree is active. Do not create a second independent ingestion pipeline for chat.

## 8. Answers, prompts and continuations

Extend the result envelope with a typed procurement result block: requested query, applied query, resolved identities/classifications, population/unit, numerator/denominator, coverage, data and risk revisions, date/value basis, warnings, query fingerprint and supported drill-downs. Keep numbers numeric until formatting. Add explicit statuses: success, empty, partial, clarification, unsupported and unavailable. An actual empty query differs from a missing corpus or failed query.

Render a compact applied-scope line: corpus, exact period/date basis, sector definition, buyer/supplier and active conditions. Lead percentage answers with the number and fraction, then unknown/excluded counts. Sources should include a query-preserving results link and record/act evidence links where appropriate. Use source update metadata when present; if completeness is unknown, say so. For model narration, ground scope and denominator claims as well as numeric claims. Deterministic rendering remains the fallback.

Persist canonical resolved queries alongside chat messages, with a versioned migration for older history. Follow-ups are typed patches: change year, add sector, list the numerator cohort, group by buyer, compare another window, clear a filter or move to linked complaints. Preserve unspecified filters. A corpus change must validate incompatible metrics and make date/cohort semantics explicit. Deduplicate suggestions by resolved query rather than visible wording.

Bind pending clarifications and result callbacks to a query/request ID and originating message. An answer arriving after a new search, cancellation or history switch must not replace the active scope or produce follow-ups for the wrong message. Clear pending clarification on an incompatible new question. Old history that lacks a resolved query can be shown as historical text, but must be re-resolved before issuing a scoped follow-up; unsupported future schema versions fail visibly rather than defaulting to all-time scope.

Use the shared question catalog rather than a second prompt menu. Add procurement templates with parameter bindings and BG/EN labels. Generate registry metadata with `scripts/ai/toolMetadata.ts --write` as needed. Chips, copied prompt text, edited text and selector submission must resolve equivalently. Render text from actual parameter values; avoid stale sample years/entities plus appended hidden corrections.

One tool will now serve many questions. Preserve question-specific ID, defaults, editable/hidden parameters, category and source IDs; do not use the first matching tool prompt to classify every question. [toolMetadata.ts](/Users/atanasster/data-bg/scripts/ai/toolMetadata.ts) currently uses `prompts.find` for tool topics, and the [question catalog](/Users/atanasster/data-bg/src/lib/questions/catalog.ts:233) derives readiness and sources from tool-level metadata. Adapt those projections explicitly. A single decision question must not inherit contract-only sources or every possible parameter control. The SQL question surface remains unavailable/review until its own adapter is tested; chat readiness does not grant SQL readiness.

Capability readiness must be the intersection of shipped UI/tool/schema support and backend schema/data capability. Gate starters and direct endpoint execution from the same advertised capability version, including individual corpus/risk availability. Register deterministic narration for every new result shape and include scope/denominator/coverage facts in provider inputs. The existing numeric-token grounding check alone cannot detect swapped denominators or wrong sector descriptions; validate structured claims or keep those sentences deterministic. Complete BG and EN wording for every visible question/clarification before marking it ready.

Use a versioned, bounded query URL codec shared by chat and browser. Adapt existing `pscope`, sector/topic and buyer links for compatibility; add custom range/status/risk support to destination screens. URL decoding validates everything again. A link must preserve the numerator/list cohort that its label promises. If a screen cannot yet express a query, implement that view or clearly mark the broader navigation; do not label it “these results”.

The browser codec must preserve **population/version, denominator/numerator predicates, value/date basis and parent relation**, not only familiar visible filters. This is essential because the new contract population excludes member rows while legacy browser totals may include them. Use an explicit versioned analytics mode in the existing screen or a dedicated compatible result view; retain legacy links on their original labeled basis. Compare row keys and totals at the same data revision.

Separate a durable query from an immutable result. A URL re-executes its validated definition against current data; it does not promise the old count after ingestion. Show “data updated since this answer” when revisions differ. Pagination cursors carry query fingerprint, order and data revision; reject/restart on revision mismatch so rows do not repeat or disappear silently. Large parent queries need a bounded, validated durable encoding or a stored-query reference with an explicit expiry/error contract; never silently broaden an expired reference. Full exports use the identical query and revision or report that they are a fresh execution, include scope/provenance, and distinguish a capped export from all results. Escape spreadsheet formula prefixes in CSV text fields.

## 9. Delivery sequence and acceptance gates

These steps are ordered implementation work, not automatic authorization to deploy this planning task. Each step must include its own meaningful tests; the complete matrix remains the release gate.

| Step | Concrete deliverables and likely files | Acceptance gate |
|---|---|---|
| 0 — Freeze semantics | Shared population/metric specification; inspect identity/consortium/framework samples; approve versioned CPV subject and buyer-roster meanings in code review; preserve local audit fixtures. | Units, date bases, raw-vs-adjusted competition, KZK denominators and data gaps are unambiguous. Screenshot expected result is independently computable. |
| 1 — Query contract | Proposed pure query/schema modules; registry wire adapter; generated deployed CJS artifact; `toolSchema.ts`, `validateArguments.ts`, `routeScope.ts`, `types.ts`; capability matrix and strict completeness gate. | All prompt fields, predicate sets and dual-date/parent relations represented; clean deployed-package import passes; invalid constraints cannot execute broadly; legacy IDs deserialize. |
| 2 — Contract analytics | Proposed backend query compiler/services, `db_table.js`, `db_routes.js`, contract masks/meta, scoped counts/shares/ranks/trends and amendment events. | Fixture numerators/denominators and money reconcile; every contract signal has testable support or explicit unavailability; list and aggregate agree. |
| 3 — Tenders and KZK | Tender risk projection/parity; complaint/decision queryable dates and linkage views; shared topic predicates; migration/grants/refresh integration. | Four tender checks, timestamp/deadline expiry, separate count units, coarse/partial outcome semantics, protected manual data, unmatched coverage and dual periods tested. |
| 4 — Query understanding | Focused procurement parser and resolver modules; `router.ts`, `heuristicRoute.ts`, provider route validation; aliases, dates, intent, sector and clarification. | All audit reproductions and negative-domain cases pass without changing question meaning; model omission tests blocked/repaired explicitly. |
| 5 — Product integration | `fiscal.ts` adapters, result envelope/rendering, `links.ts`, browser query codecs, scope controls, Chat/history, catalog, starters, follow-ups, generated metadata. | Per-question metadata/readiness and legacy adapters work; no stale response changes scope; query population and row identity survive links, pagination, exports and history. |
| 6 — Release verification | Full affected suites, live local fixture/data audits, serving-equivalent performance, both application entries, provider parity, docs and diagnostics. | All mandatory cases pass with zero scope-loss allowance; no missing data suites disguised as passes; meaningful release metrics and rollback verified. |

Step 4 parsing prototypes can be developed earlier, but analytical execution must remain behind a capability flag until steps 1–3 validate its semantics. A safe intermediate release may explicitly report unsupported scope rather than show wrong totals; it does not satisfy the full requested feature.

Use the standard project review/repair process before each implementation commit. Keep changes isolated from the pre-existing chat/prices work. Update shared guidance only if the implementation establishes a new repository-wide invariant. Do not refactor unrelated fiscal tools merely to reduce file size.

## 10. Verification and rollout

The [test specification](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-tests-prompts-v1.md) defines fixture arithmetic, 160 named acceptance cases, all risk prompts and follow-up behavior. Add a dedicated procurement suite to the normal collected CI path. Existing function JS tests run with `node --test`; ensure new tests are actually collected. New AI render tests must be placed in a collected configuration rather than assuming every TSX directory is included.

Run affected unit/backend tests first, then `npm run typecheck:ai`, the required main-app type/build checks, non-AI evaluation and procurement tool/risk/link harnesses. Run data-backed suites per repository standards: skip explicitly only when a database is unavailable; a required relation missing from an otherwise populated test database is a failure. Before release, require a populated fixture/local environment so required data suites cannot all skip. Report denominators and failed assertions, not just an aggregate pass count.

For model paths, use deterministic fake-provider cases in CI plus a bounded recorded/manual evaluation through each supported provider; compare canonical interpretation and applied scope, not prose equality. Verify standalone AI and integrated main-app entries and import boundaries. No external model credential should be required for hermetic unit tests.

Roll out behind a procurement-query capability flag after compatible migrations and projection refreshes. Observe constraint-loss rejections, clarification rate, empty versus unavailable responses, query latency/timeouts, browser parity and risk-data revision mismatches. Review anonymized failed interpretations to expand explicit fixtures; do not auto-learn unreviewed semantics into production. Rollback disables new analytical execution while preserving honest unsupported responses and legacy unscoped discovery. Never roll back to silently ignoring requested filters.

Use expand-and-contract deployment: add compatible schema/views/grants, backfill and verify projections without blanking currently served data, deploy the packaged endpoint/capability descriptor, then enable UI entry points. Validate both old-client/new-server and new-client/old-server combinations. Readiness checks must exercise all five corpora under the actual read-only role. Keep prior serving projections available until the new revision is verified; a partial refresh must not publish mixed revisions as one snapshot. The new population basis must be visibly versioned during this transition. A successful parser with a permanently unsupported advertised backend is not feature completion.

Completion means every requested dimension is either applied, clarified or explicitly unsupported; every advertised risk and corpus is implemented and tested; and no result link, provider path or follow-up silently widens the query.
