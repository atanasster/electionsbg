// Setup for the jsdom (browser) test project only — see vitest.config.ts.
//
// 1. Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument,
//    toHaveTextContent, …). The import also carries the TypeScript
//    augmentation of the `vitest` Assertion interface.
// 2. Unmounts anything Testing Library rendered after each test, so DOM state
//    never leaks between tests.
// 3. Hard-fails any test that reaches for the real network. Component/hook
//    tests must stub `fetch` (see docs/testing-standards.md); an unstubbed
//    fetch is a test bug, not a reason to hit the internet in CI.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// 4. jsdom has no ResizeObserver, and three separate things in this app reach
//    for it: Recharts' ResponsiveContainer, cmdk's list container and Radix.
//    Without it, MOUNTING a screen that renders any chart throws
//    `ReferenceError: ResizeObserver is not defined` — so the failure is not
//    „the chart looks wrong", it is every test in the file going red the moment
//    a chart is added to a screen that had none. Two test files already carried
//    their own copy; this is the one place it belongs.
//
//    It observes nothing on purpose. jsdom has no layout, so a real
//    implementation would report 0×0 anyway and ResponsiveContainer draws
//    nothing at width 0 — chart CONTENT is unit-tested through its data module,
//    never through the DOM.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    throw new Error(
      `Unstubbed fetch in a unit test: ${String(
        typeof input === "string" || input instanceof URL ? input : "request",
      )}. Stub it with vi.spyOn(globalThis, "fetch") — never hit the network.`,
    );
  });
});
