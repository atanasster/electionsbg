/**
 * Gates on the bake-off passage. These are cheap and they protect the one thing
 * that makes the test meaningful: that `spoken` really is digit-free and `raw`
 * really is not, so listening to the pair actually measures the §2 mitigation
 * rather than two near-identical strings.
 */
import { describe, it, expect } from "vitest";
import {
  PASSAGE,
  VARIANTS,
  passageText,
  coveredCases,
  type HardCase,
} from "./passage";
import { blindLabel, googleUrl } from "./tts_bakeoff";

const ALL_CASES: HardCase[] = ["acronym", "place", "money", "percent", "idnum"];

describe("bake-off passage", () => {
  it("covers every hard case the plan says has no API-level fix", () => {
    expect(coveredCases()).toEqual([...ALL_CASES].sort());
  });

  it("keeps `spoken` free of digits — the whole point of the variant", () => {
    // If a number survives as digits here, that line silently stops testing the
    // mitigation and starts testing the same thing as `raw`.
    const offenders = PASSAGE.filter((l) => /\d/.test(l.spoken)).map(
      (l) => l.spoken,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps digits in `raw`, or the two variants are not a comparison", () => {
    const numeric = PASSAGE.filter((l) =>
      l.cases.some((c) => c !== "place" && c !== "acronym"),
    );
    expect(numeric.length).toBeGreaterThan(0);
    for (const line of numeric) expect(line.raw).toMatch(/\d/);
  });

  it("spells the euro amounts out rather than leaving a bare symbol", () => {
    const money = PASSAGE.filter((l) => l.cases.includes("money"));
    expect(money.length).toBeGreaterThan(0);
    for (const line of money) {
      expect(line.raw).toMatch(/€/);
      // A leading «€» is the shape engines mishandle; `spoken` must have resolved
      // it to the word, so no symbol may remain.
      expect(line.spoken).not.toMatch(/€/);
      expect(line.spoken).toMatch(/евро/);
    }
  });

  it("reads the ЕИК digit by digit, including its leading zeros", () => {
    const id = PASSAGE.find((l) => l.cases.includes("idnum"));
    expect(id).toBeDefined();
    expect(id!.raw).toContain("000695089");
    // Three leading zeros must survive as three spoken «нула»s.
    expect(id!.spoken.match(/нула/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("gives every line something specific to listen for", () => {
    for (const line of PASSAGE) {
      expect(line.listenFor.length).toBeGreaterThan(20);
    }
  });

  it("stays far inside the free tier on both variants", () => {
    for (const v of VARIANTS) {
      const len = passageText(v).length;
      expect(len).toBeGreaterThan(200); // long enough to judge a voice
      expect(len).toBeLessThan(5_000); // ~0.5% of the 1M/month free allowance
    }
  });
});

describe("compare-page helpers", () => {
  it("labels past Z without falling into punctuation", () => {
    expect(blindLabel(0)).toBe("A");
    expect(blindLabel(25)).toBe("Z");
    // String.fromCharCode(65 + 26) is "[" — the bug this guards.
    expect(blindLabel(26)).toBe("AA");
    expect(blindLabel(27)).toBe("AB");
    expect(blindLabel(51)).toBe("AZ");
    expect(blindLabel(52)).toBe("BA");
  });
});

describe("google url builder", () => {
  it("appends the key as a real param on an endpoint that already has a query", () => {
    process.env.GOOGLE_TTS_API_KEY = "test-key";
    const u = new URL(googleUrl("voices", { languageCode: "bg-BG" }));
    expect(u.searchParams.get("languageCode")).toBe("bg-BG");
    expect(u.searchParams.get("key")).toBe("test-key");
    // The bug this replaced produced "?languageCode=bg-BG?key=…".
    expect(u.toString().match(/\?/g)?.length).toBe(1);
    delete process.env.GOOGLE_TTS_API_KEY;
  });

  it("omits the key entirely when only a bearer token is configured", () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    expect(googleUrl("text:synthesize")).not.toContain("key=");
  });
});
