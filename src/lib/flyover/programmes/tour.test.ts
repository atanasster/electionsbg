import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTICLE_CHAPTERS,
  resolveArticleChapters,
  TOUR_CHAPTERS,
} from "./tour";
import { ANCHOR_SOURCES, ANCHOR_TOLERANCE_PX, OVERVIEW } from "./anchors";
import { LAYER_IDS } from "../types";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

interface FlyoverArtifact {
  frame: { w: number; h: number };
  geo: {
    cities: Record<string, [number, number, string, string]>;
    regions: Record<string, { oblast: string }>;
  };
  flows: { keys: string[] };
}
const ARTIFACT = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/home/flyover.json"), "utf8"),
) as FlyoverArtifact;

describe("the chapter table", () => {
  it("has five money chapters with stable, unique ids", () => {
    expect(TOUR_CHAPTERS.map((c) => c.id)).toEqual([
      "buys",
      "goes",
      "funds",
      "agri",
      "prices",
    ]);
  });

  it("extends the article to six chapters, elections last", () => {
    expect(ARTICLE_CHAPTERS.slice(0, 5)).toEqual(TOUR_CHAPTERS);
    expect(ARTICLE_CHAPTERS.map((c) => c.id).at(-1)).toBe("elections");
    expect(ARTICLE_CHAPTERS.at(-1)?.state.weights?.elections).toBe(1);
    for (const st of resolveArticleChapters().slice(0, 5))
      expect(st.weights.elections).toBe(0);
  });

  it("keeps every weight inside [0, 1] and never stacks two money layers", () => {
    // The three are TAPS over overlapping corpora, so two columns standing on one point at
    // once reads as a stack — i.e. as a total that has no name.
    for (const [i, st] of resolveArticleChapters().entries()) {
      for (const id of LAYER_IDS) {
        expect(st.weights[id], `${id} in chapter ${i}`).toBeGreaterThanOrEqual(
          0,
        );
        expect(st.weights[id], `${id} in chapter ${i}`).toBeLessThanOrEqual(1);
      }
      expect(
        st.weights.proc + st.weights.funds + st.weights.agri,
      ).toBeLessThanOrEqual(1);
      expect(st.arcs).toBeGreaterThanOrEqual(0);
      expect(st.arcs).toBeLessThanOrEqual(1);
      expect(Number.isFinite(st.camera.distance)).toBe(true);
    }
  });

  it("highlights only oblasts the artifact actually carries", () => {
    // `render.ts` compares by EQUALITY against `region.oblast`, so a typo is a silent no-op.
    // The artifact carries both `SFO` (София) and `SOF` (София-столица).
    const oblasts = new Set(
      Object.values(ARTIFACT.geo.regions).map((r) => r.oblast),
    );
    for (const st of resolveArticleChapters()) {
      if (!st.highlight) continue;
      expect(oblasts).toContain(st.highlight);
      expect(ARTIFACT.flows.keys).toContain(st.highlight);
    }
  });
});

describe("the camera anchors", () => {
  it("still point at the cities the artifact places", () => {
    for (const [code, anchor] of Object.entries(ANCHOR_SOURCES)) {
      const city = ARTIFACT.geo.cities[code];
      expect(city, code).toBeTruthy();
      expect(Math.abs(city[0] / 10 - anchor[0]), code).toBeLessThanOrEqual(
        ANCHOR_TOLERANCE_PX,
      );
      expect(Math.abs(city[1] / 10 - anchor[1]), code).toBeLessThanOrEqual(
        ANCHOR_TOLERANCE_PX,
      );
    }
  });

  it("centres the overview on the frame", () => {
    expect(Math.abs(OVERVIEW[0] - ARTIFACT.frame.w / 2)).toBeLessThanOrEqual(
      10,
    );
    expect(Math.abs(OVERVIEW[1] - ARTIFACT.frame.h / 2)).toBeLessThanOrEqual(
      10,
    );
  });
});
