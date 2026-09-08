// The screening hook's four states, its guard, and the content predicate.
//
// ⚠⚠ THE PAYLOAD NAMES POLLING STATIONS UNDER „СКРИНИНГ", so the caveat arm is not a formality:
// the sentence carries both „this is not a determination" and the invalid-ballot confound.
// Every arm is asserted in the REJECTING direction.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetScreeningWarnings,
  fetchPresidentialScreening,
  hasScreeningContent,
  isPresidentialScreening,
  screeningPath,
  type PresidentialScreening,
} from "./useScreening";

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2001_11_11_pvr",
  round: 1,
  basis: "Скрининг, не присъда … r = +0,36 …",
  basisEn: "A screening, not a verdict … r = +0.36 …",
  coverage: {
    sections: 12057,
    scored: 11330,
    bothSignals: 11330,
    unscored: 727,
    flaggedDistrictOverlap: 0,
  },
  cuts: { elevated: 20, high: 40, critical: 60 },
  bands: [
    { band: "low", count: 11250, share: 0.9929 },
    { band: "elevated", count: 62, share: 0.0055 },
    { band: "high", count: 18, share: 0.0016 },
    { band: "critical", count: 0, share: 0 },
  ],
  elevatedShare: 0.0071,
  discriminating: true,
  top: [
    {
      code: "160100001",
      oblast: "PDV",
      placeName: "гр.Пробен",
      score: 52.3,
      band: "high",
      signalsAvailable: 2,
      components: [
        { id: "invalidBallots", rawPct: 21.4, normalized: 0.71 },
        { id: "additionalVoters", rawPct: 10.1, normalized: 0.34 },
      ],
    },
  ],
  ...over,
});

afterEach(() => {
  __resetScreeningWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isPresidentialScreening", () => {
  it("accepts a complete payload", () => {
    expect(isPresidentialScreening(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: "" }],
  ])("refuses a payload that lost its %s", (_name, over) => {
    expect(isPresidentialScreening(payload(over))).toBe(false);
  });

  it("refuses a payload with no cut points", () => {
    // ⚠ THE CUTS TRAVEL so a surface can print what „повишено" means. Without them a tile
    // would either omit the number or keep a second copy of it.
    expect(isPresidentialScreening(payload({ cuts: {} }))).toBe(false);
  });

  it("refuses a payload with no coverage", () => {
    expect(isPresidentialScreening(payload({ coverage: {} }))).toBe(false);
  });

  it("refuses a payload with no elevated share", () => {
    // ⚠ THE TILE READS IT rather than re-deriving it from the band counts — which is the only
    // reason a 100×-too-small `bands[].share` did not corrupt the „не отличава нищо" sentence
    // too. Absent, the sentence would interpolate „—" into a claim about the year.
    expect(isPresidentialScreening(payload({ elevatedShare: undefined }))).toBe(
      false,
    );
  });

  it("refuses a coverage block missing `unscored`", () => {
    expect(
      isPresidentialScreening(
        payload({
          coverage: {
            sections: 1,
            scored: 1,
            bothSignals: 1,
            flaggedDistrictOverlap: 0,
          },
        }),
      ),
    ).toBe(false);
  });

  it("ACCEPTS a null flagged-district overlap, and refuses a string", () => {
    // ⚠ NULL IS „NOT MEASURED", which must never render as a measured zero.
    expect(
      isPresidentialScreening(
        payload({
          coverage: { ...payload().coverage, flaggedDistrictOverlap: null },
        }),
      ),
    ).toBe(true);
    expect(
      isPresidentialScreening(
        payload({
          coverage: { ...payload().coverage, flaggedDistrictOverlap: "0" },
        }),
      ),
    ).toBe(false);
  });

  it("refuses a partial band ladder", () => {
    // ⚠ THE TILE LOOKS EACH BAND UP BY NAME and renders „0 · 0%" for one it does not find —
    // a claim that nothing was flagged.
    expect(
      isPresidentialScreening(payload({ bands: payload().bands.slice(0, 2) })),
    ).toBe(false);
  });

  it("refuses a top row with no oblast — the fallback the name falls back TO", () => {
    expect(
      isPresidentialScreening(
        payload({
          top: [{ ...payload().top[0], oblast: undefined }],
        }),
      ),
    ).toBe(false);
  });

  it("refuses a component with no normalized value", () => {
    expect(
      isPresidentialScreening(
        payload({
          top: [
            {
              ...payload().top[0],
              components: [{ id: "invalidBallots", rawPct: 21.4 }],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("refuses a non-boolean `discriminating`", () => {
    // ⚠ IT DECIDES WHETHER NAMES RENDER AT ALL. A truthy string would read as „discriminating".
    expect(isPresidentialScreening(payload({ discriminating: "true" }))).toBe(
      false,
    );
  });

  it.each([
    ["an unknown band name", [{ band: "severe", count: 1, share: 0.1 }]],
    ["a band with no count", [{ band: "high", share: 0.1 }]],
  ])("refuses %s", (_name, bands) => {
    expect(isPresidentialScreening(payload({ bands }))).toBe(false);
  });

  it.each([
    [
      "a section with no code",
      [{ score: 50, band: "high", signalsAvailable: 1, components: [] }],
    ],
    [
      "a section with an unknown band",
      [
        {
          code: "1",
          score: 50,
          band: "severe",
          signalsAvailable: 1,
          components: [],
        },
      ],
    ],
    [
      "a component with no raw percentage",
      [
        {
          code: "1",
          score: 50,
          band: "high",
          signalsAvailable: 1,
          components: [{ id: "invalidBallots" }],
        },
      ],
    ],
  ])("refuses %s", (_name, top) => {
    // ⚠ A ROW WITH NO CODE NAMES NO STATION a reader could check, on a list captioned „worth a
    // closer look".
    expect(isPresidentialScreening(payload({ top }))).toBe(false);
  });

  it("ACCEPTS an empty `top` — that is the non-discriminating state", () => {
    expect(
      isPresidentialScreening(payload({ discriminating: false, top: [] })),
    ).toBe(true);
  });
});

describe("hasScreeningContent", () => {
  const of = (o: Record<string, unknown>) =>
    payload(o) as unknown as PresidentialScreening;

  it("is true when something could be scored", () => {
    expect(hasScreeningContent(of({}))).toBe(true);
  });

  it("is FALSE when nothing could be scored", () => {
    // ⚠⚠ FOUR ZERO BANDS READ AS „every section was clean" when the truth is that none was
    // measurable.
    expect(
      hasScreeningContent(
        of({
          coverage: {
            sections: 12057,
            scored: 0,
            bothSignals: 0,
            unscored: 12057,
            flaggedDistrictOverlap: 0,
          },
          bands: [
            { band: "low", count: 0, share: 0 },
            { band: "elevated", count: 0, share: 0 },
            { band: "high", count: 0, share: 0 },
            { band: "critical", count: 0, share: 0 },
          ],
          top: [],
        }),
      ),
    ).toBe(false);
  });
});

describe("fetchPresidentialScreening", () => {
  it("reads a 404 as ABSENT — the ordinary answer", async () => {
    respond({ status: 404 });
    expect(await fetchPresidentialScreening("2001_11_11_pvr", 1)).toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, and warns ONCE per reason", async () => {
    respond({ status: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchPresidentialScreening("2001_11_11_pvr", 1)).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialScreening("2001_11_11_pvr", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialScreening("2001_11_11_pvr", 2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses a 200 that lost the caveat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basisEn: "" }) });
    expect(await fetchPresidentialScreening("2001_11_11_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a 200 carrying the SPA shell as unusable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchPresidentialScreening("2001_11_11_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const got = await fetchPresidentialScreening("2001_11_11_pvr", 1);
    expect(got.status).toBe("ready");
    expect(got.status === "ready" && got.screening.top.length).toBe(1);
  });
});

describe("screeningPath", () => {
  it("names the file the builder writes, per round", () => {
    // ⚠ THE PRODUCER SIDE IS PINNED IN `screening.data.test.ts` and the PUBLISH side in
    // `scripts/bucket_gzip.test.ts`, which derives its path set from this template.
    expect(screeningPath("2001_11_11_pvr", 2)).toBe(
      "2001_11_11_pvr/tur2/section_screening.json",
    );
  });
});
