# Tools workspace verification — 2026-09-10

Implemented the accepted searchable library plus persistent execution workspace across tiers 0–5. This is a local implementation/verification report; no deployment was performed.

## Coverage and contracts

The library derives one entry per registered executable tool (228 at this audit), with bilingual titles, taxonomy, searchable technical identifiers and structured examples. SQL-only discovery contains 59 questions; 15 reviewed dual-capability questions expose a separately labelled SQL example. Presets do not inflate the executable count.

The generated parameter gate compares complete live metadata, including optional and empty parameter lists. Shared validation covers required inputs, closed choices, integer bounds, defaults, compatibility aliases and trusted clarification pins. The original missing agency-history controls, local sub-mayor cycle and contract count are exposed. The dated plan/inventory describe the original baseline; the live registry and generated manifest are authoritative after implementation.

During the final run, concurrent ranking/person contract edits changed public fields. The parameter projection was refreshed, and the ranking starter was converted from a prose indicator to `indicator=unemployment, order=desc`. Those other implementation changes were preserved.

## Automated verification

- Component collection explicitly includes `ai/app/**/*.test.tsx` under jsdom.
- Component flows: required validation, exact chat intent, request ordering, stale drafts, trusted candidate clarification, source errors/retry, oversized share feedback, discovery, abandoned selection, structured presets, draft restoration and keyboard result tabs.
- Pure checks: complete library/title/category coverage, bilingual/transliterated search, recency ordering, metadata parity, validator/schema agreement, URL bounds/allowlist/round trips, history coordination, shared question/SQL catalogues and main entry graph.
- Final command: `node node_modules/vitest/vitest.mjs run ai src/lib/questions src/entryGraph.test.ts scripts/ai/toolMetadata.test.ts`.
- Final targeted repair pass: 593 tests passed across six files. Full shared-workspace run: 86 files passed, 3 skipped; 3,191 tests passed, 213 expected-failure cases and 23 skipped tests (3,427 total). No unexpected failures. Expected-failure cases belong to the concurrent AI evaluation suite; the workspace component/contract regressions pass normally.
- AI typecheck/build and scoped ESLint pass. Final main chunk: 2,149.03 kB raw / 619.41 kB gzip (+60.83 kB raw / +18.92 kB gzip versus the baseline). SQL alternatives and the SQL catalogue are separate lazy chunks (0.40 kB and 10.11 kB raw). No fixture HTML/module is emitted to `dist-ai`.

## Read-only data smoke

[Machine-readable smoke matrix](live-smoke.json) uses existing local `data/` corpus files and the real database route handlers against local Postgres. No stub or empty fallback was substituted by the smoke runner. Eight cases returned data; personProfile returned an actionable ambiguity chooser. All six domains were exercised: fiscal, elections, local, people, indicators and place. Inputs include company/person/place, year, count, local and presidential cycles, and election dates. This is a representative smoke matrix, not a live run of all 228 tools or a certification of upstream data freshness.

A separate real browser budget run returned data with its coverage caveat intact (8 of 48 institutions for 2024).

## Browser and layout checks

The local deterministic fixture at `/workspace-fixture.html` exercised a slow result followed by draft editing, explicit source failure, retry, and a successful company clarification. It uses synthetic envelopes and makes no live data requests. It is a separate development entry, absent from the production entry graph/build output.

Inspected desktop 1280×900, mobile 360×800 and tablet 768×1024. DOM width checks matched viewport width on mobile/tablet; the outer page did not acquire horizontal overflow. The mobile detail has a catalogue back action; the catalogue remains mounted to preserve filters. Result tables retain their existing local horizontal scroll. BG/EN and light/dark use the existing theme tokens. Native form controls, labelled fields and Radix tabs/chooser preserve keyboard semantics; automated keyboard coverage checks the result tabs. No claim of a full WCAG audit is made.

Screenshots:
- [Desktop Bulgarian/light](desktop-bg-light.png)
- [Desktop English/dark](desktop-en-dark.png)
- [Mobile English/dark](mobile-en-dark.png)
- [Tablet Bulgarian/light](tablet-bg-light.png)
- [Tablet English/dark](tablet-en-dark.png)
- [Resolved deterministic clarification](fixture-clarification.png)

## Release boundaries

URLs contain settings only after the explicit share action, are bounded and validated, and never auto-run. Only recent IDs are persisted by the tools workspace. Draft inputs/results live in the mounted session. Open-in-chat stages visible text tied to normalized arguments and retains the area anchor; chat submission remains explicit.

The baseline AI main chunk was 2,088.20 kB raw / 600.49 kB gzip. Compare final build metrics as whole-workspace observations: concurrent AI evaluation/routing edits also contribute, so the difference cannot be attributed solely to this UI. Existing large-chunk and missing `/fonts/fonts.css` build warnings remain visible. See the capability ledger for intentional exclusions (supporting APIs, admin/ingestion, news/social workflows and future tool adapters).

## Review closure

All six tiers received scoped review and repair gates. Ten confirmed review findings were fixed; none remain for manual review. The final repair made area-only history navigation reactive and tests both the area fingerprint and the rendered stale-result notice. Earlier repairs covered required contract metadata, model schema requiredness, recent ordering, incomplete titles, clarification ownership, area-preserving chat handoff, URL/navigation coordination and oversized sharing feedback.

Verification describes the shared working tree, including concurrent registry/routing edits. Those other implementation files were preserved and are not swept into the tools-workspace commits.
