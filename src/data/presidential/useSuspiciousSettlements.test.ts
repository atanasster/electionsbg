// The suspicious-settlements hook's four states, its guard, and the content predicate.
//
// ⚠⚠ THIS PAYLOAD NAMES VILLAGES, so the guard's caveat arm is not a formality: a file that
// lost `basis`/`basisEn` and rendered anyway would put a list of named places under the word
// „подозрителни" with nothing saying what the threshold does and does not prove. Every arm is
// asserted in the REJECTING direction — „a good payload is accepted" is satisfied by a guard
// that accepts everything.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSuspiciousSettlementsWarnings,
  fetchPresidentialSuspicious,
  hasSuspiciousContent,
  isPresidentialSuspicious,
  suspiciousPath,
  type PresidentialSuspicious,
} from "./useSuspiciousSettlements";

const category = (over: Record<string, unknown> = {}) => ({
  count: 12,
  threshold: 80,
  nationalPct: 49.42,
  measurableSettlements: 2341,
  flaggedShare: 0.005,
  discriminating: true,
  // ⚠ A ROW THE PRODUCER CAN ACTUALLY EMIT. `region_name` comes from `regions.json`, where
  // S23/S24/S25 carry the bare numbers „23"/„24"/„25" — and Sofia's settlements are outside
  // the ЕКАТТЕ join entirely, which is what the coverage block counts. The settlement prefix
  // is concatenated with no space („с.Сърница"), as all 56 committed top-rows are.
  top: [
    {
      ekatte: "65231",
      oblast: "HKV",
      settlement: "с.Сърница",
      settlement_en: "Sarnitsa",
      region_name: "Хасково",
      region_name_en: "Haskovo",
      value: 94.88,
    },
  ],
  votesAffected: 812,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  round: 1,
  basis: "Сигнал, не присъда.",
  basisEn: "A red flag, not a verdict.",
  coverage: {
    settlements: 4921,
    sections: 11132,
    sectionsWithoutEkatte: 1355,
    votesWithoutEkatte: 502133,
  },
  concentrated: category(),
  invalidBallots: category({ threshold: 10, nationalPct: 0.44 }),
  additionalVoters: category({ threshold: 10, nationalPct: 1.2 }),
  ...over,
});

afterEach(() => {
  __resetSuspiciousSettlementsWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isPresidentialSuspicious", () => {
  it("accepts a complete payload", () => {
    expect(isPresidentialSuspicious(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: "" }],
  ])("refuses a payload that lost its %s", (_name, over) => {
    // ⚠⚠ THE WHOLE REASON THE SENTENCE TRAVELS INSIDE THE FILE. A surface cannot supply its
    // own caveat, so „the list rendered" must imply „the caveat rendered".
    expect(isPresidentialSuspicious(payload(over))).toBe(false);
  });

  it("refuses a coverage block with no votesWithoutEkatte", () => {
    // ⚠ HALF A MILLION VOTES ON A REAL CYCLE (2016 r1: 554,044). It is the line that stops a
    // settlement-grain count reading as a national one, so a dash there leaves the София
    // caveat as a sentence with a hole in it.
    expect(
      isPresidentialSuspicious(
        payload({
          coverage: {
            settlements: 4921,
            sections: 11132,
            sectionsWithoutEkatte: 1355,
          },
        }),
      ),
    ).toBe(false);
  });

  it("refuses a payload with no coverage block", () => {
    // Without it the tile cannot say that София is outside every figure on it — an omission
    // that makes a national-looking count into a claim about a country it never measured.
    expect(isPresidentialSuspicious(payload({ coverage: {} }))).toBe(false);
  });

  it.each([["concentrated"], ["invalidBallots"], ["additionalVoters"]])(
    "refuses a payload whose %s category is missing",
    (key) => {
      expect(isPresidentialSuspicious(payload({ [key]: undefined }))).toBe(
        false,
      );
    },
  );

  it.each([
    ["count", { count: "12" }],
    ["threshold", { threshold: null }],
    ["nationalPct", { nationalPct: Number.NaN }],
    ["measurableSettlements", { measurableSettlements: "2341" }],
    // ⚠⚠ THE NON-DISCRIMINATING SENTENCE IS THIS FIELD'S ONLY READER, and `null * 100` is 0
    // while `formatPct(0)` is „0%" rather than „—" — so an unguarded null prints „обхваща 0%
    // от измеримите населени места" beside „сигналът не отличава нищо". `undefined` degrades
    // to a dash instead, which is survivable; both are refused because a half-validated
    // category is an arbitrary line to draw.
    ["flaggedShare (null)", { flaggedShare: null }],
    ["flaggedShare (absent)", { flaggedShare: undefined }],
    ["discriminating", { discriminating: "true" }],
    ["top", { top: {} }],
  ])("refuses a category whose %s is the wrong type", (_name, over) => {
    // ⚠ `nationalPct` IS NOT DECORATION. „≥10% invalid" means something different in a year
    // at 0.4% and a year at 6.4%, and a NaN there renders as „—" beside a real count, which
    // reads as a threshold nobody can calibrate.
    expect(
      isPresidentialSuspicious(payload({ concentrated: category(over) })),
    ).toBe(false);
  });

  it.each([
    ["a row with no ekatte", [{ oblast: "HKV", value: 94.88 }]],
    ["a row with no value", [{ ekatte: "65231", oblast: "HKV" }]],
    ["a row whose value is a string", [{ ekatte: "65231", value: "94.88" }]],
    ["a null row", [null]],
  ])("refuses %s", (_name, top) => {
    // ⚠ THE ROW IS A NAMED PLACE. A row with no `ekatte` has no React key and no fallback
    // label, so it renders as a blank line in a list of flagged settlements — one more place,
    // to a reader counting them.
    expect(
      isPresidentialSuspicious(payload({ concentrated: category({ top }) })),
    ).toBe(false);
  });

  it("accepts an EMPTY top list — that is the `discriminating: false` state", () => {
    // ⚠ THE PRODUCER SENDS NO NAMES when the flag caught a third of the country. Refusing the
    // payload for it would take the count and the national rate away too, which are exactly
    // what makes „the whole country was like this" legible.
    expect(
      isPresidentialSuspicious(
        payload({
          concentrated: category({ discriminating: false, top: [] }),
        }),
      ),
    ).toBe(true);
  });
});

describe("hasSuspiciousContent", () => {
  const of = (o: Record<string, unknown>) =>
    payload(o) as unknown as PresidentialSuspicious;

  it("is true when at least one rule was measurable", () => {
    expect(hasSuspiciousContent(of({}))).toBe(true);
  });

  it("is true for a measurable rule that flagged nothing", () => {
    // „0 settlements above 10% invalid, out of 2,341 measurable, against a national 0.4%" is
    // an answer, not an absence.
    expect(
      hasSuspiciousContent(
        of({
          concentrated: category({ count: 0, top: [] }),
          invalidBallots: category({ count: 0, top: [] }),
          additionalVoters: category({ count: 0, top: [] }),
        }),
      ),
    ).toBe(true);
  });

  it("is FALSE when no rule could be computed at all", () => {
    // ⚠⚠ THREE ZEROS OVER „measurable for 0 settlements" READS AS „nothing was wrong here"
    // when the truth is that nothing could be checked. That is the case this predicate — and
    // the section gate above it — exists for.
    expect(
      hasSuspiciousContent(
        of({
          concentrated: category({
            count: 0,
            measurableSettlements: 0,
            top: [],
          }),
          invalidBallots: category({
            count: 0,
            measurableSettlements: 0,
            top: [],
          }),
          additionalVoters: category({
            count: 0,
            measurableSettlements: 0,
            top: [],
          }),
        }),
      ),
    ).toBe(false);
  });
});

describe("fetchPresidentialSuspicious", () => {
  it("reads a 404 as ABSENT — the ordinary answer", async () => {
    // `data/*_pvr` is gitignored and reaches the bucket only through `bucket:gz`.
    respond({ status: 404 });
    expect(await fetchPresidentialSuspicious("2021_11_14_pvr", 1)).toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, and warns ONCE per reason", async () => {
    respond({ status: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchPresidentialSuspicious("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialSuspicious("2021_11_14_pvr", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    // A different round is a different key, so a second round's failure is not swallowed.
    await fetchPresidentialSuspicious("2021_11_14_pvr", 2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses a 200 that lost the caveat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basisEn: "" }) });
    expect(await fetchPresidentialSuspicious("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a 200 carrying the SPA shell as unusable, not as a clean round", async () => {
    // ⚠ THE CI SHAPE. With no data base the fetch goes same-origin, reaches the SPA catch-all
    // and comes back 200 with `index.html`, which `firebase.json` stamps `application/json`.
    // Read as „ready" that would publish an empty anomalies section as a finding.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchPresidentialSuspicious("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a rejected fetch as unusable rather than as routine absence", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchPresidentialSuspicious("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const got = await fetchPresidentialSuspicious("2021_11_14_pvr", 1);
    expect(got.status).toBe("ready");
    expect(got.status === "ready" && got.suspicious.concentrated.count).toBe(
      12,
    );
  });
});

describe("suspiciousPath", () => {
  it("names the file the builder writes, per round", () => {
    // ⚠ THE PRODUCER SIDE IS PINNED IN `scripts/parsers_presidential/suspicious.data.test.ts`
    // and the PUBLISH side in `scripts/bucket_gzip.test.ts`, which derives its path set from
    // this very template. A rename here fails on all three rather than 404ing in production.
    expect(suspiciousPath("2021_11_14_pvr", 2)).toBe(
      "2021_11_14_pvr/tur2/suspicious_settlements.json",
    );
  });
});
