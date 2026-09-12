# Code Review Report

Date: 2026-09-12
Scope: the complete chat-link/follow-up implementation from this task (nine changed/new files), with surrounding tool producers, question adapters, and destination screens inspected. Concurrent repository edits are outside this review.

## Executive Summary

Initial assessment before repair: the product fix is correct, but context preservation and aggregate navigation have gaps. Five initial findings and one expanded-test finding follow; no security or data-loss issue was found. Existing coverage validates routes more strongly than the meaning of their destination.

## Warnings

### [FINDING-001] Continuations can reuse sample election dates

- **File(s)**: `ai/app/followups.ts` (add, lines 142–190)
- **Category**: Bug, P1
- **Problem**: Election context is taken only from explicit arguments. A turnout answer using its default election can offer machineVoteShare for the catalog's sample 2023 election. Series counts/windows are also dropped while the target retains its sample window.
- **Suggestion**: Prefer the answer's single parliamentary provenance date, preserve compatible series windows, and omit election snapshots when no unambiguous answer contest is available. Keep chip labels consistent with executable parameters.
- **Verification**: Confirmed the machineVoteShare catalog default/legacy args are 2023_04_02; followUps(turnout) produces those executable args. Verified questionAdapter merges these defaults.

### [FINDING-002] Name-only portfolios get unsupported public-person continuations

- **File(s)**: `ai/app/followups.ts` (person continuations); `ai/tools/person.ts` (portfolioEnvelope and public profile responses)
- **Category**: Bug, P2
- **Problem**: person_id is also used for exact-name Commerce Registry portfolios, but wealth/connections tools explicitly reject portfolio resolution. Every such answer now offers guaranteed no-result prompts.
- **Suggestion**: Expose a hidden public_person_id only on resolved public-person responses and require that identifier for these continuations. Preserve name-keyed profile navigation.
- **Verification**: Confirmed portfolioEnvelope emits person_id=name and both target tools return notFound for resolved.kind=portfolio.

### [FINDING-003] Hospital ranking loses its aggregate destination

- **File(s)**: `ai/render/links.ts` (nzokHospitals and fallback selection); `ai/tests/regression.ts` (hospital ranking expectations)
- **Category**: Bug, P2
- **Problem**: Suppressing every general page once a deep link exists sends a ranking of all hospitals only to its largest hospital. That page cannot continue the ranking subject.
- **Suggestion**: Explicitly retain the NHIF hospitals page for this aggregate tool, with the largest hospital as a clearly labeled optional drilldown.
- **Verification**: Confirmed nzokHospitals emits the leading hospital's eik_id alongside a multi-hospital table.

### [FINDING-004] Presidential place answers link to national results

- **File(s)**: `ai/render/links.ts` (presidentialResults); `ai/tools/presidential.ts` (place result return)
- **Category**: Bug, P2
- **Problem**: The new link retains the cycle but drops the resolved place. Inferring Sofia from the map is unsafe because its aggregate is represented by the first MIR locator.
- **Suggestion**: Emit hidden resolved region/municipality identifiers in successful place results and construct the existing presidential place routes from them, with the national route for national results.
- **Verification**: Confirmed place tool output, Sofia aggregation, and the registered region/municipality routes and their shared screen.

## Suggestions

### [FINDING-005] Two maps contain conflicting definitions for the same tools

- **File(s)**: `ai/render/links.ts` (TOOL_SECTION and SUBJECT_PAGES)
- **Category**: Maintainability, P2
- **Problem**: Numerous old destinations remain silently shadowed by the new map; future edits can change a dead definition without affecting behavior.
- **Suggestion**: Consolidate defaults into one mapping and remove overridden entries; keep explicit entity handling separate.
- **Verification**: Confirmed shadowed entries for ministryBudget, contractSearch, noiFunds, attendance, indicators and other tools.

## Testing and documentation gaps

Add executable-argument assertions for default/historical elections and series windows; producer-level tests for portfolio omission and presidential place links; an aggregate hospital link assertion. Correct stale comments that still describe removed category links. Update the audit inventory after repair.

## Top 3 Priority Fixes

1. FINDING-001: prevent silent election changes.
2. FINDING-002: stop offering unsupported person prompts.
3. FINDING-003: keep aggregate ranking navigation.

## Repair status

All six findings are repaired. Repairs were authorized by the user's request to review and repair this implementation.

- FINDING-001: shared answerElection reads actual provenance; continuations preserve election and compatible n/years windows; the adapter removes competing sample units after serialization. Labels replace sample dates too.
- FINDING-002: public_person_id gates public-person continuations; producer integration tests preserve name-keyed page links while omitting unsupported portfolio prompts.
- FINDING-003: NHIF ranking overview is retained alongside a labeled largest-hospital drilldown.
- FINDING-004: hidden resolved place IDs drive canonical presidentialViewUrl. Sofia aggregate has no equivalent page and correctly emits no link. Governance routes also use the existing Sofia-folding helper.
- FINDING-005: one default map, with obsolete shadowed entries removed.
- FINDING-006: product routing preserves the original trimmed query; both bilingual starter contracts and product-router tests pass.

Validation: `npx vitest run --config ai/tests/vitest.chatLinks.config.ts` passes 21 files / 2,188 tests; link harness passes; `npm run build:ai` passes type checking and bundling. Build notices remain for runtime-resolved fonts and a large bundle. No deployment performed. Full network-backed golden regression was not run. No unresolved findings in the reviewed scope.

### [FINDING-006] Product starter and free-text argument contracts disagree

- **File(s)**: `ai/orchestrator/router.ts:4284`; `ai/orchestrator/router.prices.test.ts`
- **Category**: Inconsistency, P2
- **Problem**: Expanded starter-contract tests fail in both languages: free-text routing lowercases the product argument while structured starter execution preserves the original query. The product tool already performs its own search normalization.
- **Suggestion**: Preserve the trimmed original product query in the router; adjust the router regression to require preservation.
- **Verification**: Reproduced both failures in the expanded hermetic suite and confirmed the single return expression and existing test expectation before editing.

Additional validation: `npm run ai:test:non-ai` passed (743 passing cases; 207 predeclared expected failures). Final targeted ESLint and diff whitespace checks passed.

## Regression coverage before commit

- All 229 registered tools: exact default destinations locked to the reviewed inventory in `ai/render/fixtures/subject-destinations.json`, plus route validity and entity deep-link tests.
- Product fix and query preservation: `prices.product.test.ts`, `router.prices.test.ts`, bilingual starter contracts.
- Election context and series windows: `answerContext.test.ts` and `followups.test.ts`, including conflicting arguments, multi-election provenance, and serialized n/years continuations.
- Person identity: profile/portfolio integration and bilingual empty/populated wealth and connection responses in `person.test.ts` and `person.identity.test.ts`.
- Hospital ranking, historical budget/tender scope, ministry, settlement price and party breakdown links: `links.subject.test.ts` and the link harness.
- Presidential place identity and unsupported Sofia aggregate omission: `presidential.test.ts`.

Final coverage gate: 21 files, 2,188 tests passed; AI type checking and targeted lint passed. Production code is unchanged since the successful AI build recorded above.
