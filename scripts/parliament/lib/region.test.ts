import { describe, it, expect } from "vitest";
import { seatedRegionOf } from "./region";

// The seated МИР is the field that takes person_role.place_code for `mp` from 11.3% fill
// to 100%, so its parsing is worth pinning without a network round-trip.
describe("seatedRegionOf", () => {
  it("parses the parliament.bg shape, zero-padding the МИР number", () => {
    // Zero-padding matters: OBLAST_TO_MIR in src/data/parliament/nsFolders.ts is keyed
    // on two-digit codes, and T3b joins against it directly.
    expect(seatedRegionOf({ A_ns_Va_name: "1-БЛАГОЕВГРАД" })).toEqual({
      code: "01",
      name: "БЛАГОЕВГРАД",
    });
    expect(seatedRegionOf({ A_ns_Va_name: "23-СОФИЯ" })).toEqual({
      code: "23",
      name: "СОФИЯ",
    });
  });

  it("keeps the two Plovdiv constituencies distinct", () => {
    // МИР 16 and 17 are different constituencies that roll up to one statistical
    // oblast; collapsing them would merge two separate electorates.
    expect(seatedRegionOf({ A_ns_Va_name: "16-ПЛОВДИВ ГРАД" })?.code).toBe(
      "16",
    );
    expect(seatedRegionOf({ A_ns_Va_name: "17-ПЛОВДИВ ОБЛАСТ" })?.code).toBe(
      "17",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(seatedRegionOf({ A_ns_Va_name: "  3-ВАРНА " })).toEqual({
      code: "03",
      name: "ВАРНА",
    });
  });

  it("returns null rather than a region with no code", () => {
    // A half-filled region would flow into place_code as an empty string and satisfy
    // the kind-iff-code CHECK while meaning nothing.
    expect(seatedRegionOf({ A_ns_Va_name: "" })).toBeNull();
    expect(seatedRegionOf({ A_ns_Va_name: "СОФИЯ" })).toBeNull();
    expect(seatedRegionOf({ A_ns_Va_name: undefined })).toBeNull();
  });
});
