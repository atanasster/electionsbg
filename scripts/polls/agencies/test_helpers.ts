// Shared `fetchText`-mocking scaffold for the agency lister tests in this
// directory — one implementation so six near-identical copies (one per
// lister) cannot drift, the exact duplication a prior review in this plan
// flagged for scripts/watch/sources/*.test.ts.

import { vi } from "vitest";

/**
 * Mock `../../watch/fingerprint`'s `fetchText` for the duration of one test.
 *
 * `byUrl` may be a single constant (every call returns it), or a map of
 * URL-substring → response, matched in insertion order. A mapped value that
 * is an `Error` is thrown instead of returned, for exercising `fetchText`'s
 * real failure contract (a rejection, never a null resolve, except on a
 * 404 with `allow404` — which none of these listers pass).
 */
export const mockFetchText = (
  byUrl: string | null | Record<string, string | null | Error>,
) =>
  vi.doMock("../../watch/fingerprint", async (orig) => ({
    ...(await orig<typeof import("../../watch/fingerprint")>()),
    fetchText: async (url: string) => {
      if (typeof byUrl !== "object" || byUrl === null) return byUrl;
      for (const [needle, bodyOrErr] of Object.entries(byUrl)) {
        if (url.includes(needle)) {
          if (bodyOrErr instanceof Error) throw bodyOrErr;
          return bodyOrErr;
        }
      }
      throw new Error(`unexpected URL in test: ${url}`);
    },
  }));

/** Call from `afterEach` in every test file that uses `mockFetchText`. */
export const resetFetchTextMock = (): void => {
  vi.resetModules();
  vi.doUnmock("../../watch/fingerprint");
};
