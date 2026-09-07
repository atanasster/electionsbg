import { describe, expect, it } from "vitest";
import { e3 } from "../specs/e3-money-map";
import {
  assertFlyoverReelRuntime,
  flyoverReelDurations,
  materializeFlyoverCutdown,
  MONEY_MAP_REEL_EDITS,
} from "./flyoverReelMetadata";

describe("flyover reel cutdown", () => {
  it("selects the planned scenes in order", () => {
    const scenes = materializeFlyoverCutdown(e3, MONEY_MAP_REEL_EDITS);
    expect(scenes.map((scene) => scene.id)).toEqual([1, 2, 4]);
  });

  it("uses only complete passages from the approved explainer narration", () => {
    for (const edit of MONEY_MAP_REEL_EDITS) {
      const source = e3.scenes.find((scene) => scene.id === edit.id);
      expect(source?.voiceOver).toContain(edit.voiceOver);
      expect(edit.voiceOver).not.toMatch(/\d/);
    }
  });

  it("keeps skipped scenes' canvas resets in the resolved scene state", () => {
    const scenes = materializeFlyoverCutdown(e3, MONEY_MAP_REEL_EDITS);
    const agriculture = scenes[2]?.canvas;
    expect(agriculture?.arcs).toBe(0);
    expect(agriculture?.highlight).toBeNull();
    expect(agriculture?.weights).toEqual({
      proc: 0,
      funds: 0,
      agri: 1,
      elections: 0,
      prices: 0,
    });
  });

  it("rejects an ambiguous or unknown selection", () => {
    const edit = MONEY_MAP_REEL_EDITS[0]!;
    expect(() => materializeFlyoverCutdown(e3, [edit, edit])).toThrow(/unique/);
    expect(() => materializeFlyoverCutdown(e3, [{ ...edit, id: 99 }])).toThrow(
      /Unknown/,
    );
  });

  it("keeps the approved sentence edit inside the short runtime window", () => {
    const fps = 30;
    const durations = flyoverReelDurations(MONEY_MAP_REEL_EDITS, fps);
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    expect(total / fps).toBeCloseTo(40.13, 2);
    expect(() => assertFlyoverReelRuntime(total, fps)).not.toThrow();
  });

  it("accepts both runtime boundaries and rejects either side", () => {
    expect(() => assertFlyoverReelRuntime(25 * 30, 30)).not.toThrow();
    expect(() => assertFlyoverReelRuntime(50 * 30, 30)).not.toThrow();
    expect(() => assertFlyoverReelRuntime(25 * 30 - 1, 30)).toThrow(/25–50s/);
    expect(() => assertFlyoverReelRuntime(50 * 30 + 1, 30)).toThrow(/25–50s/);
  });
});
