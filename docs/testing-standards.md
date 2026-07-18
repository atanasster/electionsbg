# Testing standards

How we test electionsbg.com / Наясно. This is the convention new code (and new
PRs) should copy. Keep it boring and idiomatic — the point is that every
subsystem tests the same way.

## The two layers

| Layer | Runner | Scope | Command |
| --- | --- | --- | --- |
| Unit + component | **Vitest** | pure functions, data transforms, resolver/matching logic, SQL-payload shape, React hooks/tiles | `npm run test:unit` |
| End-to-end / SEO / perf | **Playwright** | prerendered HTML, route smoke, resource budgets, responsive layout | `npm test` |

Vitest is the unit/component runner because it is Vite-native: it reuses the
`@/*` alias (via `vite-tsconfig-paths`, reading the same tsconfig the app build
uses) and the SWC React transform, runs native ESM + TypeScript, and gives us
jsdom + Testing Library for component tests — something the old `node:test`
setup could not do. Playwright stays as-is for the browser-level gates; the two
do not overlap.

`vitest.config.ts` splits the run into two projects:

- **browser** — `src/**/*.test.{ts,tsx}`, jsdom environment, `vitest.setup.ts`
  loaded (jest-dom matchers + Testing Library auto-cleanup + the network guard).
- **node** — `scripts/**/*.test.ts`, node environment, generous timeout for the
  Postgres integration gates.

### The one exception: `functions/`

The Firebase Functions package (`functions/`) is deployed independently, is
CommonJS, has its own `node_modules`, and keeps its self-contained,
zero-dependency `node --test` gate (wired into `deploy:functions`). Run it with
`npm run functions:test`. Do not pull it into the root Vitest run.

## File naming and location

Co-locate tests next to the code they test as `*.test.ts` (or `*.test.tsx` for
anything rendering JSX). No separate `__tests__/` tree.

- `src/lib/contractTitle.ts` -> `src/lib/contractTitle.test.ts`
- `scripts/lib/slug.ts` -> `scripts/lib/slug.test.ts`
- `src/data/fetchJson.ts` -> `src/data/fetchJson.test.tsx`

Rationale: co-location keeps the test in view when you edit the module, makes an
untested file obvious, and matches every test already in the repo. The Postgres
integration gates are the sole grouped exception — they live under
`scripts/db/tests/*.data.test.ts` because they assert over the whole loaded
corpus, not one module.

Seed examples to copy from, one per layer:

- pure util — [`src/lib/translitSearch.test.ts`](../src/lib/translitSearch.test.ts)
- data layer (fetch + React Query) — [`src/data/fetchJson.test.tsx`](../src/data/fetchJson.test.tsx)
- scripts pure fn — [`scripts/lib/slug.test.ts`](../scripts/lib/slug.test.ts)

## What to test where

**Unit-test (fast, hermetic, the default):**

- pure utils and formatters (`src/lib/**`, `scripts/lib/**`)
- data transforms / parsers in the pipeline (`scripts/**` — CSV/HTML/XLSX ->
  normalized rows, id derivation, classification)
- resolver / matching / normalization logic (name folding, transliteration,
  blocking keys) — the code where a bug becomes a wrong public claim; give it a
  labelled fixture set, not just spot checks
- the shape of a SQL payload builder's output (given rows in, assert the jsonb
  the serving function emits)

**Component-test (jsdom + Testing Library):**

- a tile/screen renders the right text/structure from props
- a React Query hook resolves/erates correctly with `fetch` stubbed
- an interaction (click/type) changes what's shown

Keep component tests at the unit of a tile or hook. Whole-page,
cross-route, and prerender/SEO behaviour belongs to Playwright, not jsdom.

**Leave to the existing gates (do not re-implement in Vitest):**

- byte-level serving parity between an old JSON path and a new `/api/db` path —
  that is a parity script / `*.data.test.ts` invariant against the real corpus
- "does the deployed page still render / stay within budget" — Playwright
  (`tests/ui.spec.ts`, `tests/seo.spec.ts`, `tests/perf.spec.ts`)

## No network, no Postgres in unit tests

A unit test must not reach the network or a live database. The jsdom setup
(`vitest.setup.ts`) enforces the network half: an **unstubbed `fetch` throws**,
so a test that forgets to stub fails loudly instead of hitting GCS.

Stub `fetch` per case and drive hooks through a real `QueryClientProvider`:

```ts
vi.spyOn(globalThis, "fetch").mockResolvedValue(
  { ok: true, json: async () => ({ id: "42" }) } as Response,
);
```

See `src/data/fetchJson.test.tsx` for the full `renderHook` + `QueryClientProvider`
(retries off) pattern.

The Postgres exception: the `scripts/db/tests/*.data.test.ts` integration gates
DO query Postgres — but they **auto-skip when it is unreachable** (a top-level
probe feeds `test.skipIf`), so `npm run test:unit` stays green on a fresh clone
or in CI with no database. When Postgres is up they run for real. Run them on
purpose with `npm run test:data`, or the golden/manifest comparisons with
`npm run db:verify` (`DB_VERIFY=1`).

## Fixtures

Commit sample inputs under a `__fixtures__/` directory next to the test (small,
representative, anonymised where needed). Load them from disk in `node` tests;
inline small literals directly. Never fetch a fixture over the network and never
snapshot the whole live corpus into a fixture — fixtures are hand-sized inputs,
the corpus is what the `*.data.test.ts` gates check.

## Determinism

Tests must be deterministic. No real `Date.now()`, `new Date()` (argless), or
`Math.random()` in the code path under test — inject the value or freeze it:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-18T00:00:00Z"));
// ...
vi.useRealTimers(); // (afterEach restores mocks; restore timers too)
```

Sort before asserting on collection order unless order is itself the guarantee
(then assert it explicitly). This mirrors the pipeline's own determinism rules
(rounded sort keys, eik tiebreaks) — see the PG payload-determinism note.

## Assertions

New tests use Vitest's `expect`. The `*.data.test.ts` gates and other files
migrated from `node:test` keep `node:assert/strict` — it runs fine under Vitest,
so there is no need to churn them. Do not mix the two styles within one file.

## Coverage

Coverage is v8 (`npm run test:coverage`, HTML report in `coverage/`). The
expectation is pragmatic: **cover the modules you add or change**, not a global
percentage. A PR that adds a pure util or a payload builder should add its test;
a PR that changes matching logic should extend the fixture set. We do not gate
CI on a coverage number — a blanket threshold on a codebase this size would
reward tests-for-the-metric over the ones that matter (the resolver, the money
math, the security-sensitive routes).

## Where it runs

- **Local, while working:** `npm run test:unit` (or `npm run test:unit:watch`).
  Namespaced subsets exist for a tight loop: `npm run test:lib`,
  `npm run test:nzok`, `npm run test:person`, etc. — `test:<subsystem>` maps to
  `vitest run <path>`.
- **Pre-commit / pre-push (recommended):** `npm run lint && npm run test:unit`.
  Both are fast and need no services.
- **CI:** the workflow runs `lint` -> `build` -> Playwright today. Add
  `npm run test:unit` as a step after `lint` (before `build`) — it is hermetic
  and needs no browser, emulator, or database. The `*.data.test.ts` Postgres
  gates auto-skip in CI (no container); run them in the data-refresh job that
  already has Postgres up, via `npm run test:data` / `npm run db:verify`.
