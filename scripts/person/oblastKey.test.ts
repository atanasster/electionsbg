import { describe, expect, it } from "vitest";
import { SOFIA_CITY_KEY, oblastKeyFor } from "./oblastKey";

// Every МИР code in use on 2026-11-23 (person_role, place_kind='mir').
const MIR_CODES = [
  "BGS",
  "BLG",
  "DOB",
  "GAB",
  "HKV",
  "JAM",
  "KNL",
  "KRZ",
  "LOV",
  "MON",
  "PAZ",
  "PDV",
  "PDV-00",
  "PER",
  "PVN",
  "RAZ",
  "RSE",
  "S23",
  "S24",
  "S25",
  "SFO",
  "SHU",
  "SLS",
  "SLV",
  "SML",
  "SZR",
  "TGV",
  "VAR",
  "VID",
  "VRC",
  "VTR",
];

describe("oblastKeyFor", () => {
  it("keys every МИР code in use", () => {
    for (const c of MIR_CODES) expect(oblastKeyFor("mir", c)).not.toBeNull();
  });

  it("keeps Sofia city apart from Sofia province — SFO_CITY is not SFO", () => {
    expect(oblastKeyFor("obshtina", "SFO_CITY")).toBe(SOFIA_CITY_KEY);
    expect(oblastKeyFor("mir", "SFO")).toBe("SFO");
    expect(oblastKeyFor("obshtina", "SFO18")).toBe("SFO");
    expect(oblastKeyFor("obshtina", "SFO_CITY")).not.toBe(
      oblastKeyFor("mir", "SFO"),
    );
  });

  it("maps the three Sofia МИР and the район shards to the city", () => {
    for (const c of ["S23", "S24", "S25"])
      expect(oblastKeyFor("mir", c)).toBe(SOFIA_CITY_KEY);
    for (const c of ["S2302", "S2415", "S2524"])
      expect(oblastKeyFor("obshtina", c)).toBe(SOFIA_CITY_KEY);
  });

  it("folds Plovdiv city МИР into the Plovdiv oblast", () => {
    expect(oblastKeyFor("mir", "PDV-00")).toBe("PDV");
    expect(oblastKeyFor("mir", "PDV")).toBe("PDV");
    expect(oblastKeyFor("obshtina", "PDV22")).toBe("PDV");
  });

  it("takes the oblast prefix of an ordinary община code", () => {
    expect(oblastKeyFor("obshtina", "RAZ26")).toBe("RAZ");
    expect(oblastKeyFor("obshtina", "BLG03")).toBe("BLG");
  });

  it("returns null for what it cannot compare", () => {
    expect(oblastKeyFor("settlement", "02511")).toBeNull();
    expect(oblastKeyFor("judicial", "rs-sofiya")).toBeNull();
    expect(oblastKeyFor("obshtina", "SOF")).toBeNull();
    expect(oblastKeyFor("mir", "XX")).toBeNull();
    expect(oblastKeyFor("mir", null)).toBeNull();
    expect(oblastKeyFor(null, "RAZ")).toBeNull();
  });
});
