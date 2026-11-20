// The health finder (health-hub-v1 T6): the bodies group spans the whole roster
// — one row per institution, a retired РИОКОЗ EIK finding its РЗИ successor —
// ranked by the blob and landing on all-time awarder pages; the two НЗОК groups
// stay unbuilt (and not loading) until the box is armed; then the shared
// whole-register groups.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { HealthHubStats } from "@/data/health/hubStats";
import { HEALTH_ENTITIES } from "@/lib/healthReferenceData";
import { healthBodiesIndex, healthSearchSources } from "./healthSearch";
import {
  nzokHospitalIndex,
  nzokMoleculeIndex,
} from "@/screens/components/procurement/nzok/nzokSearchIndexes";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/health/derived/hub_stats.json"),
    "utf8",
  ),
) as HealthHubStats;

const idx = () => healthBodiesIndex(blob, "bg", true);

describe("health finder — bodies", () => {
  it("finds the ministry by name and links it on the all-time window", () => {
    const h = searchIndex(idx(), "министерство на здравеопазването")[0];
    expect(h?.id).toBe("000695317");
    expect(h!.href).toBe("/awarder/000695317?pscope=all");
    expect(h!.sub).toMatch(/€/);
  });

  it("finds a body by EIK", () => {
    expect(searchIndex(idx(), "121858220")[0]?.id).toBe("121858220");
  });

  it("finds the successor by a retired EIK, never the retired row", () => {
    expect(searchIndex(idx(), "000022349").map((h) => h.id)).toEqual([
      "176030552",
    ]);
  });

  it("finds a second-level body by its family noun", () => {
    expect(
      searchIndex(idx(), "ЦСМП Пловдив").some((h) => h.label.includes("ЦСМП")),
    ).toBe(true);
  });

  it("lists one row per institution, never a retired EIK", () => {
    const retired = new Set(
      HEALTH_ENTITIES.filter((e) => e.retiredEikOf).map((e) => e.eik),
    );
    const all = idx();
    const live = HEALTH_ENTITIES.filter((e) => !e.retiredEikOf);
    // Each live EIK finds ITS OWN row — not merely some non-retired one.
    for (const e of live)
      expect(searchIndex(all, e.eik)[0]?.id, e.eik).toBe(e.eik);
    expect(live.some((e) => retired.has(e.eik))).toBe(false);
  });

  it("names the English label in English", () => {
    const h = searchIndex(healthBodiesIndex(blob, "en", false), "000695317")[0];
    expect(h?.label).toBe("Ministry of Health");
  });
});

describe("health finder — sources", () => {
  const base = {
    stats: blob,
    hospitals: null,
    hospitalsLoading: false,
    molecules: null,
    moleculesLoading: false,
    lang: "bg",
    bg: true,
  };

  it("declares bodies, hospitals, molecules, then the whole-register groups", () => {
    expect(healthSearchSources(base).map((s) => s.id)).toEqual([
      "bodies",
      "hospitals",
      "molecules",
      "contractors",
      "contracts",
    ]);
  });

  it("does not hold the box on loading before it is armed", () => {
    for (const s of healthSearchSources(base))
      if (s.kind === "index") expect(s.loading ?? false).toBe(false);
  });

  it("serves hospitals by EIK on the all-time window and every INN", () => {
    const hosp = nzokHospitalIndex({
      hospitals: [
        {
          eik: "831605795",
          name: "УМБАЛ Александровска",
          rzokName: "София",
          cumulativeEur: 10,
        },
        {
          eik: "831605795",
          name: "Втори обект",
          rzokName: "София",
          cumulativeEur: 3,
        },
        { eik: null, name: "Без ЕИК", rzokName: "София", cumulativeEur: 99 },
      ] as never,
    });
    const hits = searchIndex(hosp, "София");
    expect(hits.map((h) => h.id)).toEqual(["831605795"]);
    expect(hits[0].label).toBe("УМБАЛ Александровска");
    expect(hits[0].href).toBe("/company/831605795?pscope=all");
    const mol = nzokMoleculeIndex({
      allInns: ["PEMBROLIZUMAB", "NIVOLUMAB"],
      top: [{ inn: "NIVOLUMAB", totalEur: 5 }] as never,
    });
    expect(searchIndex(mol, "pembro")[0]?.href).toBe("/molecule/PEMBROLIZUMAB");
  });
});
