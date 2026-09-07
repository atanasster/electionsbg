// The flagged-districts hook's four states, its guard, and the content predicate.
//
// ⚠⚠ THE PAYLOAD NAMES EIGHT ROMA DISTRICTS, so the caveat arm is not a formality: a file that
// lost `basis`/`basisEn` and rendered anyway would put a table of named neighbourhoods under a
// „рискови" heading with nothing saying what the figures are about and no sources. Every arm is
// asserted in the REJECTING direction — „a good payload is accepted" is satisfied by a guard
// that accepts everything.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetNeighborhoodsWarnings,
  fetchPresidentialNeighborhoods,
  hasNeighborhoodContent,
  isPresidentialNeighborhoods,
  neighborhoodsPath,
  type PresidentialNeighborhoods,
} from "./useNeighborhoods";

const rates = (over: Record<string, unknown> = {}) => ({
  turnoutPct: 48.09,
  invalidPct: 5.31,
  additionalPct: 2.73,
  paperBallots: 45979,
  actualVoters: 40012,
  ...over,
});

// ⚠ THE FIXTURE IS SELF-CONSISTENT, because the guard now cross-checks `places.length` against
// `coverage.located` — a payload claiming eight districts with one row draws an empty-ish table
// under a heading that promises eight.
const MISSING_SEVEN = [
  "fakulteta",
  "filipovci",
  "nadezhda_sliven",
  "pobeda_burgas",
  "gorno_ezerovo",
  "dolno_ezerovo",
  "maksuda",
].map((id) => ({ id, name_bg: id, name_en: id }));

const place = (over: Record<string, unknown> = {}) => ({
  id: "stolipinovo",
  name_bg: "Столипиново / Шекер махала",
  name_en: "Stolipinovo / Sheker mahala",
  city_bg: "Пловдив",
  city_en: "Plovdiv",
  sourceUrl: "https://www.segabg.com/hot/category-bulgaria/x",
  sections: 70,
  valid: 18997,
  ...rates(),
  leader: { number: 13, president: "Румен Георгиев Радев", pct: 26.45 },
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2016_11_06_pvr",
  round: 1,
  basis: "Секции в ромски квартали — твърдение за секции, не за хората в тях.",
  basisEn:
    "Polling sections in Roma neighbourhoods — about stations, not people.",
  coverage: {
    catalogue: 8,
    located: 1,
    missing: MISSING_SEVEN,
    sections: 133,
    sectionsInCycle: 12015,
    validVotes: 40734,
    pctOfValid: 1.16,
  },
  national: rates({
    turnoutPct: 56.26,
    invalidPct: 3.05,
    paperBallots: 3786996,
  }),
  totals: rates(),
  tickets: [
    {
      number: 17,
      president: "Цецка Цачева Данговска",
      votes: 10139,
      pct: 24.89,
      pctNational: 21.96,
    },
  ],
  places: [place()],
  ...over,
});

afterEach(() => {
  __resetNeighborhoodsWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isPresidentialNeighborhoods", () => {
  it("accepts a complete payload", () => {
    expect(isPresidentialNeighborhoods(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: "" }],
  ])("refuses a payload that lost its %s", (_name, over) => {
    expect(isPresidentialNeighborhoods(payload(over))).toBe(false);
  });

  it("refuses a payload with no coverage block", () => {
    // ⚠ WITHOUT IT THE TILE CANNOT SAY WHICH DISTRICTS ARE IN THE AGGREGATE. Coverage is not
    // monotonic in time here — 2011 locates five and 2001 all eight — so a table without it
    // presents a different set of places under the same heading in every cycle.
    expect(isPresidentialNeighborhoods(payload({ coverage: {} }))).toBe(false);
  });

  it("refuses a payload whose `places` disagrees with `coverage.located`", () => {
    // ⚠⚠ `hasNeighborhoodContent` GATES THE SECTION ON `located`, so a payload claiming eight
    // districts with an empty `places` array opens the heading and draws an empty table — the
    // one state that gate exists to prevent, arriving through the other field.
    expect(isPresidentialNeighborhoods(payload({ places: [] }))).toBe(false);
  });

  it.each([
    ["no sourceUrl", { sourceUrl: undefined }],
    ["an http sourceUrl", { sourceUrl: "http://example.invalid/x" }],
    ["no city", { city_bg: "" }],
  ])("refuses a place with %s", (_name, over) => {
    // ⚠⚠ THE SOURCE STANDS WITH `basis`, NOT BELOW IT. „Рисков" is somebody else's published
    // finding, and with the attribute absent React renders an underlined, non-navigable
    // „източник" — a link that is not one, on the row that most needs to be checkable.
    expect(
      isPresidentialNeighborhoods(
        payload({ places: [place(over)], coverage: { ...payload().coverage } }),
      ),
    ).toBe(false);
  });

  it("refuses a rates block with no actual-voter denominator", () => {
    expect(
      isPresidentialNeighborhoods(
        payload({ totals: rates({ actualVoters: undefined }) }),
      ),
    ).toBe(false);
  });

  it("refuses a coverage block whose `missing` is not a list", () => {
    expect(
      isPresidentialNeighborhoods(
        payload({
          coverage: { ...payload().coverage, missing: undefined },
        }),
      ),
    ).toBe(false);
  });

  it("ACCEPTS a null rate — that is a published answer, not an absence", () => {
    // ⚠ 2021's districts filed 228 paper ballots, so the producer withholds their invalid rate
    // deliberately. A guard that refused null would take the whole round off the page.
    expect(
      isPresidentialNeighborhoods(
        payload({ totals: rates({ invalidPct: null, paperBallots: 228 }) }),
      ),
    ).toBe(true);
  });

  it.each([
    ["a string rate", { invalidPct: "5.31" }],
    ["a NaN rate", { turnoutPct: Number.NaN }],
    ["a missing denominator", { paperBallots: undefined }],
  ])("refuses %s", (_name, over) => {
    expect(isPresidentialNeighborhoods(payload({ totals: rates(over) }))).toBe(
      false,
    );
  });

  it.each([
    [
      "a ticket with no name",
      [{ number: 17, votes: 1, pct: 1, pctNational: 1 }],
    ],
    [
      "a ticket with no national share",
      [{ number: 17, president: "Ц", votes: 1, pct: 1 }],
    ],
    ["a null ticket", [null]],
  ])("refuses %s", (_name, tickets) => {
    // ⚠ A ROW READING „— 24,9%" ON A LIST ABOUT VOTE-BUYING RISK attributes the figure to
    // nobody a reader can check.
    expect(isPresidentialNeighborhoods(payload({ tickets }))).toBe(false);
  });

  it.each([
    ["a place with no id", [place({ id: undefined })]],
    ["a place with no Bulgarian name", [place({ name_bg: "" })]],
    [
      "a place with no rates",
      [{ id: "x", name_bg: "Х", sections: 1, valid: 1 }],
    ],
  ])("refuses %s", (_name, places) => {
    expect(isPresidentialNeighborhoods(payload({ places }))).toBe(false);
  });
});

describe("hasNeighborhoodContent", () => {
  const of = (o: Record<string, unknown>) =>
    payload(o) as unknown as PresidentialNeighborhoods;

  it("is true for a located, ticketed round", () => {
    expect(hasNeighborhoodContent(of({}))).toBe(true);
  });

  it("is FALSE when no district could be located", () => {
    // ⚠⚠ A „Рискови гласове" HEADING OVER A BLANK is an insinuation about eight named districts
    // with no figures under it.
    expect(
      hasNeighborhoodContent(
        of({
          coverage: { ...payload().coverage, located: 0 },
          places: [],
        }),
      ),
    ).toBe(false);
  });

  it("is FALSE when no ticket cleared the readability cut", () => {
    expect(hasNeighborhoodContent(of({ tickets: [] }))).toBe(false);
  });
});

describe("fetchPresidentialNeighborhoods", () => {
  it("reads a 404 as ABSENT — the ordinary answer", async () => {
    respond({ status: 404 });
    expect(await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1)).toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, and warns ONCE per reason", async () => {
    respond({ status: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1)).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialNeighborhoods("2016_11_06_pvr", 2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses a 200 that lost the caveat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basisEn: "" }) });
    expect(await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a 200 carrying the SPA shell as unusable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const got = await fetchPresidentialNeighborhoods("2016_11_06_pvr", 1);
    expect(got.status).toBe("ready");
    expect(got.status === "ready" && got.neighborhoods.coverage.located).toBe(
      1,
    );
  });
});

describe("neighborhoodsPath", () => {
  it("names the file the builder writes, per round", () => {
    // ⚠ THE PRODUCER SIDE IS PINNED IN `neighborhoods.data.test.ts` and the PUBLISH side in
    // `scripts/bucket_gzip.test.ts`, which derives its path set from this very template.
    expect(neighborhoodsPath("2016_11_06_pvr", 2)).toBe(
      "2016_11_06_pvr/tur2/neighborhoods.json",
    );
  });
});
