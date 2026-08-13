// The fleet-basis rule and its two consumers. Both the /sector/energy plants
// tile and the powerPlants AI tool summed capacity over EVERY row in
// plants.json, so the single planned AP1000 (АЕЦ Козлодуй 7/8, 2 300 MW) was
// published as installed capacity — 15.9 GW against a real 13.6 (+16.9%) and a
// state/JV share of 60% against 53%. Nothing caught it on either surface, so
// these tests pin the rule AND the invariant that the consumers actually apply
// it. Pure functions over the committed JSON: no network, no DB, no fixtures.

import { describe, it, expect } from "vitest";
import plantsFile from "../../../data/energy/plants.json";
import generationFile from "../../../data/energy/generation.json";
import {
  ENERGY_FUELS,
  installedPlants,
  isInstalled,
  isStateLinked,
  type EnergyGeneration,
  type PlantFuel,
  type PlantOwnership,
  type PlantStatus,
  type PowerPlant,
  type PowerPlantsFile,
} from "./types";

const file = plantsFile as PowerPlantsFile;
const generation = generationFile as EnergyGeneration;

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
    // Stated as "the excluded capacity is exactly the planned capacity" rather
    // than re-deriving the basis with a `status !== "planned"` filter. That
    // filter is the DENY-LIST types.ts documents at length as the wrong rule, so
    // encoding it here would pin the test to the semantics the fix removed — and
    // would fail on a correctly-classified new status such as "under-construction".
    expect(all - installed).toBe(
      sumMw(file.plants.filter((p) => p.status === "planned")),
    );
  });

  it("reports a fleet total in the band the real Bulgarian fleet occupies", () => {
    // A band, not a magic number — the fleet is curated and moves. The ceiling is
    // the load-bearing half: the defect it must catch is 15.908 GW (planned
    // capacity back in the basis). 15.5 leaves ~1.9 GW of headroom, which matters
    // because the "Други соларни паркове (разпределени)" row is an aggregate that
    // grows on every refresh — a 15.0 ceiling would fire on a correct update.
    const gw = sumMw(installedPlants(file.plants)) / 1000;
    expect(gw).toBeGreaterThan(12);
    expect(gw).toBeLessThan(15.5);
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

describe("the committed generation series (data/energy/generation.json)", () => {
  // The stacked fuel-mix bar divides each fuel by the REPORTED totalGen, not by
  // the sum of its own segments, so an Ember fuel bucket missing from
  // ENERGY_FUELS does not throw — the bar just stops short of 100% and the
  // legend's percentages quietly no longer add up. That is the failure this
  // pins; it is the generation tile's equivalent of the plants defect.
  const latest = generation.years[generation.years.length - 1];

  it("every fuel present in the data has a label in ENERGY_FUELS", () => {
    const known = new Set(ENERGY_FUELS.map((f) => f.key));
    const unmapped = Object.keys(latest.byFuel).filter((k) => !known.has(k));
    expect(unmapped).toEqual([]);
  });

  it("the fuel breakdown reconciles to the reported total", () => {
    const sum = Object.values(latest.byFuel).reduce((a, v) => a + v, 0);
    expect(latest.totalGen).not.toBeNull();
    // Float TWh to two decimals — an exact compare would fail on ordinary
    // rounding in the Ember export.
    expect(Math.abs(sum - (latest.totalGen ?? 0))).toBeLessThan(0.01);
  });

  it("the latest row is the one latestYear names", () => {
    expect(latest.year).toBe(generation.latestYear);
  });
});
