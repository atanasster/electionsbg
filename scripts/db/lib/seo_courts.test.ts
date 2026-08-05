// readSeoCourts() is the single source the /court prerender AND the /court
// sitemap enumerator read. The whole degrade-gracefully design rests on it
// RETURNING [] rather than throwing when Postgres cannot answer: a throw in the
// prerender aborts `npm run build` on any machine without Docker, and — worse —
// a throw in only ONE of the two callers would let the sitemap emit <loc>s for
// pages the prerender never wrote.
//
// Hermetic: `pg` is mocked, so no database is reached and the suite does not
// depend on the host answering a dead port with ECONNREFUSED rather than
// dropping the packet. Live coverage of the QUERY itself — the failure this
// file structurally CANNOT see, since a SQL fault takes the same branch as an
// unplugged database — is scripts/db/tests/seo_courts.data.test.ts.

import { describe, test, expect, vi, afterEach } from "vitest";
import { isCrawlableCourt } from "./seo_courts";

type FakeResult = { rows: unknown[] };

/** Re-import the reader with `pg` stubbed to a Pool that answers however the
 *  case needs. pg.ts captures its URL at import time, so each case needs a
 *  fresh module registry anyway. */
const loadWith = async (respond: () => Promise<FakeResult>) => {
  vi.resetModules();
  vi.doMock("pg", () => ({
    Pool: class {
      query = respond;
      end = async () => {};
      on = () => {};
    },
  }));
  return await import("./seo_courts");
};

const ROW = {
  body_code: "rs-varna",
  name: "Районен съд — Варна",
  kind: "court",
  tier: "районен",
  place: "Варна",
  place_code: "VAR03",
  magistrates: 42,
  first_year: 2019,
  last_year: 2024,
  year: 2024,
  judges: 30,
  filed_per_month: 5.68,
  resolved_per_month: 5.42,
  sources_built: true,
};

afterEach(() => {
  vi.doUnmock("pg");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("readSeoCourts", () => {
  test("maps every column to its camelCase field", async () => {
    const { readSeoCourts } = await loadWith(async () => ({ rows: [ROW] }));
    expect(await readSeoCourts()).toEqual([
      {
        bodyCode: "rs-varna",
        name: "Районен съд — Варна",
        kind: "court",
        tier: "районен",
        place: "Варна",
        placeCode: "VAR03",
        magistrates: 42,
        year: 2024,
        judges: 30,
        filedPerMonth: 5.68,
        resolvedPerMonth: 5.42,
        firstYear: 2019,
        lastYear: 2024,
        sourcesBuilt: true,
      },
    ]);
  });

  test("returns [] instead of throwing when the connection fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSeoCourts } = await loadWith(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), {
        code: "ECONNREFUSED",
      });
    });
    await expect(readSeoCourts()).resolves.toEqual([]);
    // The build must SAY it skipped the family — a silent [] is how "zero court
    // pages" looks identical to a healthy build.
    expect(String(warn.mock.calls[0]?.[0])).toContain("/court/*");
  });

  test("a failing QUERY degrades exactly like an unreachable server, and names its SQLSTATE", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSeoCourts } = await loadWith(async () => {
      throw Object.assign(
        new Error('relation "judicial_body" does not exist'),
        { code: "42P01" },
      );
    });
    await expect(readSeoCourts()).resolves.toEqual([]);
    // An unapplied migration 116 is not "Postgres is down", and an operator
    // whose server is plainly running will not go looking for one if that is
    // all the log says.
    expect(String(warn.mock.calls[0]?.[0])).toContain("42P01");
  });

  test("drops a body_code that is not URL-safe, and says which", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSeoCourts } = await loadWith(async () => ({
      rows: [ROW, { ...ROW, body_code: "РС Варна" }],
    }));
    const rows = await readSeoCourts();
    expect(rows.map((r) => r.bodyCode)).toEqual(["rs-varna"]);
    expect(String(warn.mock.calls[0]?.[0])).toContain("РС Варна");
  });
});

describe("isCrawlableCourt", () => {
  test("accepts the body_code shapes the loader derives", () => {
    for (const bodyCode of ["sgs", "rs-varna", "op-plovdiv", "as-sofia-grad"]) {
      expect(isCrawlableCourt({ bodyCode })).toBe(true);
    }
  });

  test("rejects a body_code that lost its lowercasing", () => {
    // The mundane regression, and the one a reader is most likely to assume is
    // covered: a loader change that stops lowercasing.
    for (const bodyCode of ["RS-Varna", "RS-VARNA", "Sgs"]) {
      expect(isCrawlableCourt({ bodyCode })).toBe(false);
    }
  });

  test("rejects anything that would need escaping in a URL or a path", () => {
    // Each of these would mint a sitemap <loc> that no dist/<path>/index.html
    // can back — Cyrillic and spaces percent-encode, a slash forks the path, and
    // a leading dash/empty string is not a slug at all.
    for (const bodyCode of [
      "",
      "-rs-varna",
      "rs varna",
      "rs/varna",
      "rs.varna",
      "rs_varna",
      "rs?varna",
      "съд",
    ]) {
      expect(isCrawlableCourt({ bodyCode })).toBe(false);
    }
    expect(isCrawlableCourt({ bodyCode: null })).toBe(false);
    expect(isCrawlableCourt({})).toBe(false);
  });
});
