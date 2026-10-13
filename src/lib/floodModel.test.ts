// The riverbed choropleth over the COMMITTED artifact (docs/plans/water-hub-v1.md
// W3 / D2): a national body's € must never land in an oblast — its seat is Sofia
// and its works are national, which painted Sofia with 73% of money spent
// elsewhere. The totals keep it; only the map leaves it out and states it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FloodMaintenanceFile } from "@/data/water/useFloodMaintenance";
import { FLOOD_NATIONAL_AWARDERS, buildFloodModel } from "./floodModel";
import { NAPOITELNI_EIK } from "./vikReferenceData";

const file = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/water/flood_maintenance.json"),
    "utf8",
  ),
) as FloodMaintenanceFile;

describe("buildFloodModel — national awarders off the map", () => {
  const m = buildFloodModel(file.contracts, null, null);

  it("puts no national awarder's € in any oblast", () => {
    const placed = new Map<string, number>();
    for (const c of file.contracts)
      if (!(c.awarderEik in FLOOD_NATIONAL_AWARDERS) && c.oblast)
        placed.set(c.oblast, (placed.get(c.oblast) ?? 0) + c.eur);
    for (const o of m.byOblast) expect(o.eur, o.code).toBe(placed.get(o.code));
  });

  it("states the national € instead of dropping it, and keeps it in the total", () => {
    const national = file.contracts
      .filter((c) => c.awarderEik in FLOOD_NATIONAL_AWARDERS)
      .reduce((s, c) => s + c.eur, 0);
    // Non-vacuity: the split exists because this money exists.
    expect(m.nationalEur).toBeGreaterThan(0);
    expect(m.nationalEur).toBe(national);
    const unplaced = file.contracts
      .filter((c) => !(c.awarderEik in FLOOD_NATIONAL_AWARDERS) && !c.oblast)
      .reduce((s, c) => s + c.eur, 0);
    const mapped = m.byOblast.reduce((s, o) => s + o.eur, 0);
    expect(m.unplacedEur).toBe(unplaced);
    expect(mapped + m.nationalEur + m.unplacedEur).toBe(m.totalEur);
  });

  it("covers Напоителни системи, the case that drove the rule", () => {
    expect(FLOOD_NATIONAL_AWARDERS[NAPOITELNI_EIK]).toBeTruthy();
    expect(m.napoitelniEur).toBeGreaterThan(0);
    expect(m.nationalEur).toBeGreaterThanOrEqual(m.napoitelniEur);
  });

  it("names the national bodies behind the figure, largest first", () => {
    const eur = m.nationalAwarders.map((a) => a.eur);
    expect(eur).toEqual([...eur].sort((a, b) => b - a));
    expect(m.nationalAwarders.reduce((s, a) => s + a.eur, 0)).toBe(
      m.nationalEur,
    );
    for (const a of m.nationalAwarders) expect(a.name).toBeTruthy();
  });
});
