// The fleet-basis rule and its two consumers. Both the /sector/energy plants
// tile and the powerPlants AI tool summed capacity over EVERY row in
// plants.json, so the single planned AP1000 (АЕЦ Козлодуй 7/8, 2 300 MW) was
// published as installed capacity — 15.9 GW against a real 13.6 (+16.9%) and a
// state/JV share of 60% against 53%. Nothing caught it on either surface, so
// these tests pin the rule AND the invariant that the consumers actually apply
// it. Pure functions over the committed JSON: no network, no DB, no fixtures.

import { describe, it, expect } from "vitest";
import plantsFile from "../../../data/energy/plants.json";
import {
  installedPlants,
  isInstalled,
  isStateLinked,
  type PlantFuel,
  type PlantOwnership,
  type PlantStatus,
  type PowerPlant,
  type PowerPlantsFile,
} from "./types";

const file = plantsFile as PowerPlantsFile;

const plant = (over: Partial<PowerPlant> = {}): PowerPlant => ({
  id: "p",
  name: { bg: "Централа", en: "Plant" },
  fuel: "coal" as PlantFuel,
  capacityMw: 100,
  owner: { bg: "Собственик", en: "Owner" },
  ownership: "state" as PlantOwnership,
  status: "operating" as PlantStatus,
  ...over,
});

const sumMw = (rows: PowerPlant[]): number =>
  rows.reduce((a, p) => a + (p.capacityMw ?? 0), 0);

describe("isInstalled", () => {
  it("counts operating and retiring, excludes planned", () => {
    expect(isInstalled(plant({ status: "operating" }))).toBe(true);
    // retiring plants GENERATE TODAY — they only carry a phase-out date. This is
    // the subtle half: an "exclude anything with a retirement year" edit would
    // drop 2 528 MW and 7 state-share points.
    expect(isInstalled(plant({ status: "retiring", retire: 2038 }))).toBe(true);
    expect(isInstalled(plant({ status: "planned" }))).toBe(false);
  });

  it("installedPlants drops planned rows and preserves order", () => {
    const rows = [
      plant({ id: "a" }),
      plant({ id: "b", status: "planned" }),
      plant({ id: "c", status: "retiring" }),
    ];
    expect(installedPlants(rows).map((p) => p.id)).toEqual(["a", "c"]);
  });
});

describe("isStateLinked", () => {
  it("counts state and JV, excludes private and municipal", () => {
    expect(isStateLinked(plant({ ownership: "state" }))).toBe(true);
    // НЕК holds 27% of Марица изток 3 — a state stake is state-linked.
    expect(isStateLinked(plant({ ownership: "jv" }))).toBe(true);
    expect(isStateLinked(plant({ ownership: "private" }))).toBe(false);
    // municipal is local government, not the state: both consumers label this
    // "държавна/смесена", so folding it in would relabel the figure.
    expect(isStateLinked(plant({ ownership: "municipal" }))).toBe(false);
  });
});

describe("the committed fleet (data/energy/plants.json)", () => {
  it("still contains a planned row, so the tests below are not vacuous", () => {
    expect(file.plants.some((p) => p.status === "planned")).toBe(true);
  });

  it("keeps planned capacity out of the fleet total", () => {
    const all = sumMw(file.plants);
    const installed = sumMw(installedPlants(file.plants));
    expect(installed).toBeLessThan(all); // today: 13 608 < 15 908
    expect(installed).toBe(
      sumMw(file.plants.filter((p) => p.status !== "planned")),
    );
  });

  it("reports a fleet total in the band the real Bulgarian fleet occupies", () => {
    // A band, not a magic number — the fleet is curated and moves. The ceiling
    // is what matters: 15.9 GW (planned capacity back in the basis) is out.
    const gw = sumMw(installedPlants(file.plants)) / 1000;
    expect(gw).toBeGreaterThan(12);
    expect(gw).toBeLessThan(15);
  });

  it("keeps the state/JV share off the planned unit's thumb", () => {
    const installed = installedPlants(file.plants);
    const pct = Math.round(
      (sumMw(installed.filter(isStateLinked)) / sumMw(installed)) * 100,
    );
    // 60% was the value with the state-owned AP1000 inflating both sides.
    expect(pct).toBeGreaterThan(45);
    expect(pct).toBeLessThan(58);
  });

  it("agrees with the AI tool on the coal count", () => {
    // Guards the divergence the tile fix originally left open: the tool built
    // its coal list from every row while the tile filtered. Both now derive it
    // from installedPlants, so this holds by construction — and breaks the
    // moment one of them stops.
    const coal = installedPlants(file.plants).filter((p) => p.fuel === "coal");
    expect(coal.length).toBeGreaterThan(0);
    expect(coal.every(isInstalled)).toBe(true);
  });
});
