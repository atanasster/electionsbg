// The water head's figures over the COMMITTED blob — the shape every visitor
// receives. The numbers themselves are gated against Postgres in
// scripts/db/tests/water_hub_figures.data.test.ts; this holds the sentences.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WaterHubStats } from "@/data/water/hubStats";
import {
  WATER_BAND_TILES,
  waterHubEvidence,
  waterHubKpis,
  waterKpiNote,
  waterTileMetric,
} from "./waterHubFigures";
import { WATER_TILES } from "./waterRegistry";
import { WATER_OPERATOR_TYPES, operatorByEik } from "@/lib/vikReferenceData";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/water/derived/hub_stats.json"),
    "utf8",
  ),
) as WaterHubStats;

describe("water hub figures", () => {
  it("renders nothing — never a zero — without a blob", () => {
    expect(waterHubKpis(null, "bg", true)).toEqual([]);
    expect(waterHubEvidence(undefined, "bg", true)).toBeUndefined();
    for (const t of WATER_TILES)
      expect(waterTileMetric(t.id, null, "bg", true)).toBeUndefined();
  });

  it("renders four KPI cells, each with a basis and a destination", () => {
    const kpis = waterHubKpis(blob, "bg", true);
    expect(kpis).toHaveLength(4);
    for (const k of kpis) {
      expect(k.basis.length).toBeGreaterThan(10);
      expect(k.to).toBeTruthy();
    }
  });

  it("says the four figures are never summed", () => {
    expect(waterKpiNote(true)).toMatch(/не се събират/);
    expect(waterKpiNote(false)).toMatch(/do not add up/);
  });

  it("puts the national baseline beside the single-bid share, on the ex-member basis", () => {
    const sb = waterHubKpis(blob, "bg", true)[1];
    expect(sb.label).toBe("с една оферта");
    expect(sb.basis).toMatch(/средно за всички възложители/);
    expect(sb.basis).toMatch(/обединения/);
  });

  it("dates the rationing figure with its НСИ year", () => {
    const r = waterHubKpis(blob, "bg", true)[3];
    expect(r.basis).toContain(String(blob.services?.year));
  });

  it("calls the EU-funds figure lifetime, not a window (W4)", () => {
    const f = waterHubKpis(blob, "bg", true)[2];
    expect(f.basis).toMatch(/целия програмен период/);
  });

  it("keeps band-owned tiles descriptor-only", () => {
    expect([...WATER_BAND_TILES].sort()).toEqual([
      "competition",
      "funds",
      "rationing",
    ]);
  });

  it("ranks only water OPERATORS on the rail, scoped to the whole corpus (G11)", () => {
    const ev = waterHubEvidence(blob, "bg", true)!;
    expect(ev.rows.length).toBe(5);
    for (const r of ev.rows) {
      const type = operatorByEik(String(r.id))?.type;
      expect(type && WATER_OPERATOR_TYPES.includes(type), String(r.id)).toBe(
        true,
      );
      expect(String(r.to)).toContain("pscope=all");
    }
  });

  it("names the intra-group money on the contractors tile (W2)", () => {
    const m = waterTileMetric("contractors", blob, "bg", true)!;
    expect(m.metricCaption).toBe("остават в сектора");
    expect(m.metricSecondary).toMatch(/заеми към холдинга/);
  });

  it("states the riverbed figure as every awarder's, not the sector's (W5)", () => {
    const m = waterTileMetric("riverbed", blob, "en", false)!;
    expect(m.metricSecondary).toMatch(/every awarder/);
  });
});
