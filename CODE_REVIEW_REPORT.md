# Code Review Report

Date: 2026-09-12
Scope: chat interaction navigator (Chat.tsx, InteractionNavigator.tsx, InteractionNavigator.test.tsx), including surrounding scroll handling.

## Executive Summary

Two verified issues were repaired before committing. Toolbar-aware scrolling, escaped React text, localized previews, and reduced-motion support are sound. No security or data-loss findings.

## Warnings

### [FINDING-001] Smooth navigation can re-enable automatic following

- **File(s)**: `ai/app/Chat.tsx` (scroll handler around line 417)
- **Category**: Bug
- **Problem**: Clicking a rail item clears the follow pin, but the first upward smooth-scroll event can still be within the 80px bottom slack. The handler re-enables the pin; a streaming update or ResizeObserver can then jump back to the newest answer.
- **Suggestion**: Only re-enable a cleared pin when scrolling down toward the bottom. Verify upward scrolling inside the slack stays unpinned.
- **Verification**: Confirmed in the current handler; safe to repair within the requested scope.

### [FINDING-002] Redundant scroll work and subscription churn

- **File(s)**: `ai/app/InteractionNavigator.tsx` (effect around lines 61–94)
- **Category**: Performance / Duplication
- **Problem**: Both a scroller listener and a window capture listener process the same scroll. The effect also tears down and recreates observers on every streamed text update because it depends on the entire interactions array. Ancestor discovery is copied into three places across the feature.
- **Suggestion**: Share scroll helpers, subscribe once using window capture, and key subscriptions on prompt identity rather than response text.
- **Verification**: Confirmed from the dependency list, listener registration and ancestor loops.

## Testing Gaps

Add regression coverage for cleared-pin upward movement and for active-interaction updates when the outer document scrolls. Keep existing toolbar-offset and focus checks.

## Documentation Gaps

Document the follow-pin direction rule next to its implementation. No public API or user documentation changes needed.

## Priority Fixes

1. FINDING-001: prevent interrupted navigation while streaming.
2. FINDING-002: remove duplicate layout work and observer churn.

## Repair Status

Both findings verified and repaired under the user's authorization. No unresolved findings in the navigator changes.

## Completed Repairs and Validation

- FINDING-001 repaired: cleared follow pins only re-arm on downward movement near the bottom; upward and stationary frames stay unpinned.
- FINDING-002 repaired: shared scroll-ancestor helper, one captured scroll listener, and subscriptions keyed to prompt ids.
- Five focused regression tests passed, including toolbar-aware scrolling, outer-scroll active tracking, focus, empty/single chats, and follow-pin direction.
- Chat suite: 1,875 passed; 12 starter-routing failures reproduced from a separate clean HEAD source copy (560 passed / the identical 12 failed there). Those failures are outside the navigator changes.
- Browser: 30-interaction conversation; desktop smooth scroll and mobile reduced-motion scroll place the prompt ~16px below the sticky toolbar. Keyboard preview and Escape dismissal passed.
- Full npm run build passed, including TypeScript, Vite bundling, prerendering, text indexes, and image optimization. Repository lint: zero errors and one pre-existing react-refresh warning in src/screens/funds/InterregTile.tsx:53; all changed files lint-clean.

## Chain chat review — 2026-09-12

Scope: uncommitted chain identity, price summaries, links, routing, follow-up dispatch and regression coverage.

- FINDING-003 (P1), functions/db_routes.js: the identity guard only checks stores at the chain dimension's newest date. During ingestion, that date can advance before the old product payload is rebuilt, exposing the known incorrect pharmacy prices. Verified against the SQL and the integration fixture, which incorrectly expected clearance without replacing the payload. Keep the guard active for source evidence at or after the payload date; clear it only once the payload advances past the mismatched evidence.
- FINDING-004 (P2), ai/orchestrator/router.ts: the new chain political-connections branch precedes explicit EIK handling and overwrites a supplied identifier with a brand alias. Verified from branch order. Prefer the explicit identifier and add a regression case.

Both findings are confirmed and authorized for repair. Other changed paths preserve escaped React rendering, parameterized SQL, exact follow-up text matching, bounded price samples, source dates and comparable-only rankings. Existing starter prompts remain valid; no starter text changes are needed.

Repair verification: FINDING-003 now compares mismatched source-store dates against the published payload date, including the import/rebuild gap; the real PostgreSQL temporary-table regression passes. FINDING-004 now preserves the explicit EIK and its regression passes. Focused tests: 288 passed. Cloud Functions: 618 passed, 1 skipped. Wide AI suite: 1836/1836 regression cases, including 1422 starter/suggestion checks, passed. Scoped ESLint passed.

The earlier broader Vitest sweep found a pre-existing historical provider-audit mismatch for localMayorHistory (`са софия` versus the corrected `софия`); this review does not rewrite that historical audit.

Final build verification: `npm run build` passed, including TypeScript, Vite, 91,568 prerendered routes, both language indexes, image-reference verification and article packaging. Vite emitted only chunk-size warnings. No outstanding findings remain in the reviewed changes.
