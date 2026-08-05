// readSeoCourts() is the single source the /court prerender AND the /court
// sitemap enumerator read. The whole degrade-gracefully design rests on it
// RETURNING [] rather than throwing when Postgres cannot answer: a throw in the
// prerender aborts `npm run build` on any machine without Docker, and — worse —
// a throw in only ONE of the two callers would let the sitemap emit <loc>s for
// pages the prerender never wrote.
//
// Hermetic: the failure case dials a closed port, so no database is needed and
// none is touched.

import { describe, test, expect, vi, afterEach } from "vitest";
import { isCrawlableCourt } from "./seo_courts";

/** Re-import with a chosen DATABASE_URL. pg.ts captures it at import time, so
 *  each case needs a fresh module registry. */
const load = async (databaseUrl: string) => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", databaseUrl);
  return await import("./seo_courts");
};

// Port 1 is reserved (tcpmux) and never listening — a connection refusal, which
// is the same class of failure as "Docker is not running".
const UNREACHABLE = "postgres://postgres:postgres@127.0.0.1:1/electionsbg";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("readSeoCourts", () => {
  test("returns [] instead of throwing when Postgres is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSeoCourts } = await load(UNREACHABLE);
    await expect(readSeoCourts()).resolves.toEqual([]);
    // The build must SAY it skipped the family — a silent [] is how "zero court
    // pages" looks identical to a healthy build.
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("/court/*");
    warn.mockRestore();
  });
});

describe("isCrawlableCourt", () => {
  test("accepts the body_code shapes the loader derives", () => {
    for (const bodyCode of ["sgs", "rs-varna", "op-plovdiv", "as-sofia-grad"]) {
      expect(isCrawlableCourt({ bodyCode })).toBe(true);
    }
  });

  test("rejects anything that would need escaping in a URL or a path", () => {
    // Each of these would mint a sitemap <loc> that no dist/<path>/index.html
    // can back — Cyrillic and spaces percent-encode, a slash forks the path, and
    // a leading dash/empty string is not a slug at all.
    for (const bodyCode of ["", "-rs-varna", "rs varna", "rs/varna", "съд"]) {
      expect(isCrawlableCourt({ bodyCode })).toBe(false);
    }
    expect(isCrawlableCourt({ bodyCode: null })).toBe(false);
    expect(isCrawlableCourt({})).toBe(false);
  });
});
