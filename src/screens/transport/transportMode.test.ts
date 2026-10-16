// ?mode= is validated on read: an unknown value is ignored (whole sector), never
// turned into an empty filter.

import { describe, it, expect } from "vitest";
import { eiksForMode, parseTransportMode } from "./transportMode";
import {
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_UNIVERSES,
  transportUniverseOf,
} from "@/lib/transportReferenceData";

describe("transport ?mode", () => {
  it("accepts every universe and nothing else", () => {
    for (const u of TRANSPORT_UNIVERSES) expect(parseTransportMode(u)).toBe(u);
    for (const bad of [null, "", "roads", "RAIL", "rail "])
      expect(parseTransportMode(bad)).toBeNull();
  });

  it("filters to the mode's bodies, and to the whole roll-up without one", () => {
    expect(eiksForMode(null)).toEqual(TRANSPORT_SECTOR_EIKS);
    const rail = eiksForMode("rail");
    expect(rail.length).toBeGreaterThan(1);
    for (const e of rail) expect(transportUniverseOf(e)).toBe("rail");
    const all = TRANSPORT_UNIVERSES.flatMap((u) => eiksForMode(u));
    expect(all.sort()).toEqual([...TRANSPORT_SECTOR_EIKS].sort());
  });
});
