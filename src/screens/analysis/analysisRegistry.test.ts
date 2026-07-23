import { describe, it, expect } from "vitest";
import { ANALYSIS_CLUSTERS } from "./analysisRegistry";
import { ANALYSIS_SCENES } from "./analysisScenes";

// Structural guard for the data-driven hub: a registry entry whose `id` has no
// matching scene would pass `undefined` as the required `scene` FC and crash the
// whole /analysis grid at render. Cheap insurance against a future id typo.
describe("analysisRegistry ↔ analysisScenes", () => {
  const analyses = ANALYSIS_CLUSTERS.flatMap((c) => c.analyses);

  it("every analysis id resolves to a scene component", () => {
    for (const a of analyses) {
      expect(ANALYSIS_SCENES[a.id]).toBeTypeOf("function");
    }
  });

  it("has unique ids and unique routes", () => {
    const ids = analyses.map((a) => a.id);
    const tos = analyses.map((a) => a.to);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tos).size).toBe(tos.length);
  });
});
