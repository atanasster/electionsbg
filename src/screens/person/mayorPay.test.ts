import { describe, expect, it } from "vitest";
import type { ProfileRole } from "./usePersonProfile";
import { mayorPayObshtinaForRoles } from "./mayorPay";

const role = (overrides: Partial<ProfileRole> = {}): ProfileRole => ({
  source: "local",
  facet: "governance",
  sourceLabel: "Local election",
  role: "mayor",
  ref: "2023_10_29_mi:BLG11",
  placeKind: "obshtina",
  placeCode: "BLG11",
  placeLabel: "Благоевград",
  placeLabelEn: "Blagoevgrad",
  judicialKind: null,
  confidence: "exact",
  start: "2023-10-29",
  end: null,
  dateBasis: "election",
  ...overrides,
});

describe("mayorPayObshtinaForRoles", () => {
  it("accepts an elected municipal mayor from the local-election source", () => {
    expect(mayorPayObshtinaForRoles([role()])).toBe("BLG11");
  });

  it("accepts a municipal-officials mayor role too", () => {
    expect(
      mayorPayObshtinaForRoles([role({ source: "official_muni" })]),
    ).toBe("BLG11");
  });

  it("does not mistake a settlement or non-mayor office for a municipality mayor", () => {
    expect(
      mayorPayObshtinaForRoles([
        role({ role: "village_mayor", placeKind: "settlement", placeCode: "04298" }),
        role({ role: "councillor" }),
      ]),
    ).toBeNull();
  });
});
