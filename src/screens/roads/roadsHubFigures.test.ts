// The roads head's figures over the COMMITTED blob — the shape every visitor
// receives. The numbers themselves are gated against Postgres in
// scripts/db/tests/roads_hub_figures.data.test.ts; this holds the sentences.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import {
  ROADS_BAND_TILES,
  roadsHubEvidence,
  roadsHubKpis,
  roadsKpiNote,
  roadsTileMetric,
} from "./roadsHubFigures";
import { ROADS_TILES } from "./roadsRegistry";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/roads/derived/hub_stats.json"),
    "utf8",
  ),
) as RoadsHubStats;

describe("roads hub figures", () => {
  it("renders nothing — never a zero — without a blob", () => {
    expect(roadsHubKpis(null, "bg", true)).toEqual([]);
    expect(roadsHubEvidence(undefined, "bg", true)).toBeUndefined();
    for (const t of ROADS_TILES)
      expect(roadsTileMetric(t.id, null, "bg", true)).toBeUndefined();
  });

  it("states the headline's basis: current value after annexes (D6)", () => {
    const [eur] = roadsHubKpis(blob, "bg", true);
    expect(eur.basis).toContain("след анекси");
    expect(roadsKpiNote(true)).toContain("след анекси");
    const [eurEn] = roadsHubKpis(blob, "en", false);
    expect(eurEn.basis).toContain("after annexes");
  });

  it("puts the national baseline beside the single-bid share", () => {
    const sb = roadsHubKpis(blob, "bg", true)[1];
    expect(sb.label).toBe("с една оферта");
    expect(sb.basis).toMatch(/средно за всички възложители/);
  });

  it("puts the in-house share on its own tile, not also in the band (§3.1-5)", () => {
    const k = roadsHubKpis(blob, "bg", true)[3];
    expect(k.basis).not.toContain("Автомагистрали");
    expect(
      roadsTileMetric("inhouse", blob, "bg", true)?.metricSecondary,
    ).toMatch(/от сектора/);
  });

  it("quotes only the OPTION part as option growth and names the rest", () => {
    const m = roadsTileMetric("options", blob, "bg", true)!;
    const opt = blob.annexOptions.byReason.find((r) => r.reason === "option")!;
    expect(m.metricCaption).toBe("ръст по клауза за опция");
    expect(blob.annexOptions.growthEur).toBeGreaterThan(opt.growthEur);
    expect(m.metricSecondary).toMatch(/по други основания/);
  });

  it("never calls the option cluster an overrun (D4/D6)", () => {
    for (const [lang, bg] of [
      ["bg", true],
      ["en", false],
    ] as const) {
      const m = roadsTileMetric("options", blob, lang, bg);
      const text = JSON.stringify(m).toLowerCase();
      expect(text).not.toMatch(/преразход|overrun|надвиш/);
    }
  });

  it("keeps band-owned tiles descriptor-only", () => {
    // The screen skips them; the function is not even consulted. This pins
    // that the list matches what the registry gate expects.
    expect([...ROADS_BAND_TILES].sort()).toEqual([
      "competition",
      "contractors",
    ]);
  });

  it("links each corridor to the network page, encoded and unscoped", () => {
    const ev = roadsHubEvidence(blob, "bg", true)!;
    expect(ev.rows.length).toBeGreaterThan(0);
    for (const r of ev.rows) {
      const to = String(r.to);
      expect(to.startsWith("/sector/roads/network?corridor=")).toBe(true);
      expect(to).toContain("pscope=all");
      expect(decodeURIComponent(to.split("corridor=")[1].split("&")[0])).toBe(
        r.label,
      );
    }
  });
});
