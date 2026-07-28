import { describe, it, expect } from "vitest";
import {
  oblastToMir,
  mirToOblast,
  electionToNsFolder,
  MIR_CODES,
} from "./nsFolders";

// This crosswalk is what turns parliament.bg's seated-МИР number into the site's МИР
// code, so `mp` roles can carry a place. A silent hole in it would leave MPs unplaced;
// a wrong entry would seat them in the wrong constituency.
describe("oblastToMir / mirToOblast", () => {
  const CODES = [
    "BLG", "BGS", "VAR", "VTR", "VID", "VRC", "GAB", "DOB",
    "KRZ", "KNL", "LOV", "MON", "PAZ", "PER", "PVN", "PDV-00",
    "PDV", "RAZ", "RSE", "SLS", "SLV", "SML", "S23", "S24",
    "S25", "SFO", "SZR", "TGV", "HKV", "SHU", "JAM",
  ]; // prettier-ignore

  it("covers all 31 constituencies", () => {
    expect(CODES).toHaveLength(31);
    for (const c of CODES) expect(oblastToMir(c), c).toBeTruthy();
  });

  it("contains NOTHING beyond the 31 — both directions", () => {
    // Checking only the witness list INTO the map lets an extra entry through: a 32nd
    // pseudo-region (scripts/parsers/region_codes.ts really does carry a "World" one)
    // would pass silently and then flow into place_code as a МИР.
    expect([...MIR_CODES].sort()).toEqual([...CODES].sort());
  });

  it("round-trips every code", () => {
    for (const c of CODES) expect(mirToOblast(oblastToMir(c)), c).toBe(c);
  });

  it("is a bijection — no two codes share a МИР number", () => {
    const mirs = CODES.map((c) => oblastToMir(c));
    expect(new Set(mirs).size).toBe(CODES.length);
  });

  it("keeps Пловдив град and област on their own numbers", () => {
    // МИР 16 is the CITY and 17 the PROVINCE. Folding them — as the statistical oblast
    // rollup does — would merge two separate electorates.
    expect(oblastToMir("PDV-00")).toBe("16");
    expect(oblastToMir("PDV")).toBe("17");
    expect(mirToOblast("16")).toBe("PDV-00");
    expect(mirToOblast("17")).toBe("PDV");
  });

  it("keeps Sofia's three city constituencies apart from Sofia province", () => {
    expect(["23", "24", "25"]).toEqual(
      ["S23", "S24", "S25"].map((c) => oblastToMir(c)),
    );
    expect(oblastToMir("SFO")).toBe("26");
  });

  it("accepts an unpadded МИР number", () => {
    // parliament.bg writes "1-БЛАГОЕВГРАД"; the padding is ours.
    expect(mirToOblast("1")).toBe("BLG");
    expect(mirToOblast("01")).toBe("BLG");
  });

  it("returns null for anything it does not know", () => {
    expect(mirToOblast(null)).toBeNull();
    expect(mirToOblast("")).toBeNull();
    expect(mirToOblast("99")).toBeNull();
    expect(oblastToMir("NOPE")).toBeNull();
  });
});

describe("electionToNsFolder", () => {
  it("maps an election to its National Assembly", () => {
    expect(electionToNsFolder("2014_10_05")).toBe("43");
    expect(electionToNsFolder("2026_04_19")).toBe("52");
    expect(electionToNsFolder("1999_01_01")).toBeNull();
  });
});
