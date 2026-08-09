/**
 * Gates on caption derivation. These matter more than they look: the timing is
 * DERIVED from character counts rather than measured by a transcriber, so the
 * invariants below are the only thing standing between a caption track and
 * silently drifting or dropping speech.
 */
import { describe, expect, it } from "vitest";
import { paginate, timePages, toVtt, vttTime } from "./captions";
import { e1 } from "../specs/e1-inflation";

const SCENE = "Разликата между най-скъпия и най-евтиния глас е над десет пъти.";

describe("paginate", () => {
  it("never drops or reorders a word", () => {
    const joined = paginate(SCENE).join(" ");
    expect(joined.split(/\s+/)).toEqual(SCENE.split(/\s+/));
  });

  it("keeps pages inside the readable width", () => {
    for (const p of paginate(SCENE)) expect(p.length).toBeLessThanOrEqual(40);
  });

  it("does not emit empty pages", () => {
    expect(paginate("   ")).toEqual([]);
    expect(paginate(SCENE).every((p) => p.trim().length > 0)).toBe(true);
  });

  it("breaks after a sentence rather than straddling two", () => {
    const two = "Първото изречение свършва тук. Второто започва сега.";
    const pages = paginate(two, 80);
    // With maxChars generous enough to fit both, the sentence rule must still
    // split them — otherwise a page shows the end of one thought and the start
    // of another, which is the least readable shape.
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.endsWith(".")).toBe(true);
  });
});

describe("timePages", () => {
  it("covers the whole scene with no gaps and no overlap", () => {
    const pages = timePages(SCENE, 8);
    expect(pages[0]!.fromSec).toBe(0);
    expect(pages[pages.length - 1]!.toSec).toBeCloseTo(8, 5);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.fromSec).toBeCloseTo(pages[i - 1]!.toSec, 5);
    }
  });

  it("gives every page a positive duration", () => {
    for (const p of timePages(SCENE, 8)) {
      expect(p.toSec).toBeGreaterThan(p.fromSec);
    }
  });

  it("returns nothing for an empty scene rather than a zero-length cue", () => {
    expect(timePages("", 8)).toEqual([]);
    expect(timePages(SCENE, 0)).toEqual([]);
  });
});

describe("vttTime", () => {
  it("formats as WebVTT expects", () => {
    expect(vttTime(0)).toBe("00:00:00.000");
    expect(vttTime(1.234)).toBe("00:00:01.234");
    expect(vttTime(61.5)).toBe("00:01:01.500");
    expect(vttTime(3661)).toBe("01:01:01.000");
  });

  it("pads seconds below ten — 00:00:1.500 is not a valid cue", () => {
    expect(vttTime(1.5)).toBe("00:00:01.500");
  });
});

describe("toVtt", () => {
  it("emits cues in ascending order across scene offsets", () => {
    const vtt = toVtt([
      { text: SCENE, offsetSec: 0, durationSec: 6 },
      { text: SCENE, offsetSec: 6, durationSec: 6 },
    ]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    const starts = [...vtt.matchAll(/^(\d\d:\d\d:\d\d\.\d\d\d) -->/gm)].map(
      (m) => m[1]!,
    );
    expect(starts.length).toBeGreaterThan(1);
    expect([...starts].sort()).toEqual(starts);
  });
});

describe("the E1 script itself", () => {
  it("paginates every scene without losing a word", () => {
    for (const scene of e1.scenes) {
      const joined = paginate(scene.voiceOver).join(" ");
      expect(joined.split(/\s+/)).toEqual(scene.voiceOver.split(/\s+/));
    }
  });

  it("carries no digits in any voiceOver — rule 7", () => {
    // Duplicated from the synthesize-time check on purpose: that one fires only
    // when audio is generated, and a spec can be committed long before.
    for (const scene of e1.scenes) {
      expect(scene.voiceOver).not.toMatch(/\d/);
    }
  });
});
