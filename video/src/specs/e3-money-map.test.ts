import { describe, expect, it } from "vitest";
import { ARTICLE_CHAPTERS } from "../../../src/lib/flyover/programmes/tour";
import { e3 } from "./e3-money-map";
import { VOICEABLE_SPECS } from "./registry";

describe("E3 money-map explainer", () => {
  it("reuses the article's first four chapter states in order", () => {
    expect(e3.scenes.slice(0, 4).map((scene) => scene.canvas)).toEqual(
      ARTICLE_CHAPTERS.slice(0, 4).map((chapter) => chapter.state),
    );
  });

  it("keeps digits out of narration and grounds every numeric audit line", () => {
    expect(e3.scenes).toHaveLength(5);
    for (const scene of e3.scenes) {
      expect(scene.voiceOver).not.toMatch(/\d/);
      if (/\d/.test(scene.onScreen)) {
        const refs = Array.isArray(scene.grounding)
          ? scene.grounding
          : [scene.grounding];
        expect(
          refs.every((ref) => ref?.file === "video/src/generated/flyover.json"),
        ).toBe(true);
      }
    }
  });

  it("pins its production metadata and shared CLI registry key", () => {
    expect(e3.canvasKind).toBe("flyover");
    expect(e3.runtimeSeconds).toEqual([60, 120]);
    expect(e3.slug).toBe("2026-09-money-map");
    expect(e3.scenes.map((scene) => scene.id)).toEqual([1, 2, 3, 4, 5]);
    expect(VOICEABLE_SPECS["e3-money-map"]).toBe(e3);
    expect(e3.scenes[1]?.grounding).toEqual([
      expect.objectContaining({
        path: "$.flows.coverage",
        tokens: ["43,9", "94,2"],
      }),
      expect.objectContaining({
        path: "$.figures",
        tokens: ["56,5", "23,9", "11,8"],
      }),
    ]);
    expect(e3.sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("aop.bg"),
        expect.stringContaining("eufunds.bg"),
        expect.stringContaining("dfz.bg"),
      ]),
    );
  });
});
