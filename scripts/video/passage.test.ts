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
import { blindLabel, googleUrl, GEMINI_TTS_MODEL } from "./tts_bakeoff";

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

describe("gemini tts model pin", () => {
  it("names a TTS-capable model, since the audio path depends on it", () => {
    // Deliberately NOT asserting "not 2.5". A first draft did, on the strength
    // of a single empty response; re-measuring showed 5/5 identical Bulgarian
    // requests produce audio on both 2.5 and 3.1, so that gate would have
    // enshrined a transient as a fact. The real hazard it uncovered — an
    // intermittent 200 with an empty candidate — is handled by retry in
    // `synthesize`, not by pinning a version.
    expect(GEMINI_TTS_MODEL).toMatch(
      /^gemini-[\d.]+-[a-z]+-(tts|native-audio)/,
    );
  });
});

describe("google url builder", () => {
  it("composes params without doubling the query separator", () => {
    const u = new URL(googleUrl("voices", { languageCode: "bg-BG" }));
    expect(u.searchParams.get("languageCode")).toBe("bg-BG");
    // The bug this replaced produced "?languageCode=bg-BG?key=…".
    expect(u.toString().match(/\?/g)?.length).toBe(1);
  });

  it("never puts a credential in the URL, even if an API key is in the env", () => {
    // Cloud TTS answers `?key=` with 401 "API keys are not supported by this
    // API" (measured 2026-08-08), so a key here is not merely redundant — it is
    // a request that cannot succeed. Auth is the Bearer header, and this asserts
    // nobody reintroduces the key param after reading the old docs.
    process.env.GOOGLE_TTS_API_KEY = "test-key";
    try {
      for (const url of [
        googleUrl("text:synthesize"),
        googleUrl("voices", { languageCode: "bg-BG" }),
      ]) {
        expect(url).not.toContain("key=");
        expect(url).not.toContain("test-key");
      }
    } finally {
      delete process.env.GOOGLE_TTS_API_KEY;
    }
  });
});
