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
