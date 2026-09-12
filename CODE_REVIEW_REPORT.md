# Code Review Report

Date: 2026-09-12
Scope: the uncommitted place-results routing change and its regression tests.

## Executive Summary

Two routing bugs found and reproduced. No security, accessibility, dependency or performance issues found in this scope.

## Findings

### [FINDING-001] A year is accepted as a settlement

- **File(s)**: `ai/orchestrator/router.ts` (bare-place branch)
- **Category**: Bug
- **Problem**: `What were the results in 2023?` selects settlementResults with place `2023`.
- **Suggestion**: Require letters in a place candidate and skip date-only prepositional phrases. Add a national-results regression.

### [FINDING-002] Latest-election wording loses the settlement

- **File(s)**: `ai/orchestrator/router.ts` (bare-place extraction and trend selection)
- **Category**: Bug
- **Problem**: `Резултатите в Панчарево на последните избори` selects nationalResults because the place capture includes the election phrase. Merely trimming that phrase would select history because the broad trend cues include `избори`.
- **Suggestion**: End the place at the Bulgarian election qualifier and use explicit temporal-history cues for unqualified places. Cover latest-election and history wording separately.

## Testing Gaps

The initial 13 cases did not cover a year after `in` or Bulgarian latest-election wording. Add both, plus a year-before-place case.

## Duplication and Documentation

No new abstraction needed for this small branch. Keep the scope comment beside the logic.

## Priority Fixes

1. Reject numeric candidates.
2. Preserve place scope on latest-election questions.

## Verification

Both findings reproduced using the current route() implementation before editing. Both are within the user's requested repair scope.

## Repair and Validation

Both findings repaired. Numeric date phrases are skipped, latest-election wording retains the settlement, and explicit history requests retain their time window. Added five regression cases (18 place-scope cases total).

- 178 orchestrator tests passed across 12 files.
- Scoped ESLint and git diff whitespace checks passed.
- `npm run build:ai` passed, including TypeScript checking. Vite emitted font-path and chunk-size advisory warnings.
- Final diff review: no remaining findings in scope.
