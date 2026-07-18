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
