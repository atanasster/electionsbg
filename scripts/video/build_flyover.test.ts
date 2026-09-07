import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FlyoverWorld } from "../../src/lib/flyover/types";
import { OUT, SOURCE, assertFlyoverClaims } from "./build_flyover";

const world = (): FlyoverWorld =>
  JSON.parse(readFileSync(SOURCE, "utf8")) as FlyoverWorld;

describe("flyover video data claims", () => {
  it("keeps the committed video artifact byte-identical to the home artifact", () => {
    expect(readFileSync(OUT).equals(readFileSync(SOURCE))).toBe(true);
  });

  it("accepts the committed artifact vintage", () => {
    expect(() => assertFlyoverClaims(world())).not.toThrow();
  });

  it("refuses to keep narrating a moved finding", () => {
    const moved = world();
    moved.figures.sofiaBuyerShare = 0.5;
    expect(() => assertFlyoverClaims(moved)).toThrow(/Sofia buyer share/);
  });

  it("pins the flow basis and the three agricultural leaders", () => {
    const movedFlow = world();
    movedFlow.flows.coverage.bothPlacedEur += 1;
    expect(() => assertFlyoverClaims(movedFlow)).toThrow(/both-placed euros/);

    const movedAgri = world();
    movedAgri.layers.all!.agri!.PDV += 1;
    expect(() => assertFlyoverClaims(movedAgri)).toThrow(
      /Plovdiv farm subsidies/,
    );
  });
});
