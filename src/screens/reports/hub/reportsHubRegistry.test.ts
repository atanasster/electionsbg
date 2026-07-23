import { describe, it, expect } from "vitest";
import { REPORT_CLUSTERS, FEATURED_REPORTS } from "./reportsHubRegistry";
import { REPORT_SCENES } from "./reportsHubScenes";

// Structural guard for the data-driven hub: a registry entry whose `id` has no
// matching scene would pass `undefined` as the required `scene` FC and crash the
// /reports grid (and the /analysis featured strip) at render.
describe("reportsHubRegistry ↔ reportsHubScenes", () => {
  const reports = REPORT_CLUSTERS.flatMap((c) => c.reports);

  it("every report id resolves to a scene component", () => {
    for (const r of reports) {
      expect(REPORT_SCENES[r.id]).toBeTypeOf("function");
    }
  });

  it("has unique ids and unique routes", () => {
    const ids = reports.map((r) => r.id);
    const tos = reports.map((r) => r.to);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("exposes only flagged entries as featured (in registry order)", () => {
    expect(FEATURED_REPORTS.length).toBeGreaterThan(0);
    expect(FEATURED_REPORTS.every((r) => r.featured)).toBe(true);
    expect(FEATURED_REPORTS).toEqual(reports.filter((r) => r.featured));
  });
});
