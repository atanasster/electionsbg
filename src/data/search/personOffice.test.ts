// The two bridges between `/api/db/person-lookup` and the header's office+place line.
//
// WHY THESE ARE WORTH A TEST AT ALL — they are six lines of field copying, and that is
// exactly the problem: every field on both sides is OPTIONAL, so a dropped one type-checks,
// renders, and passes every other test in the repo. `SearchItems.test.tsx` constructs index
// items directly and hands them to the provider, so it exercises the RENDER half and bypasses
// the TRANSPORT half entirely. Before this module the two bridges sat in two different files
// with nothing tying them together, and deleting `placeLabelEn` from the `SearchContext` map
// left English readers with Bulgarian place names and every gate green.
//
//   npx vitest run src/data/search/personOffice.test.ts

import { describe, it, expect } from "vitest";
import {
  toPersonOffice,
  toRoleSubtitleInput,
  type PersonOffice,
} from "./personOffice";

/** The three keys, derived once so a fourth cannot be added on one side only. */
const KEYS = ["primaryRole", "placeLabel", "placeLabelEn"] as const;

describe("toPersonOffice — wire → index item", () => {
  it("carries EVERY office field, named one by one", () => {
    const wire = {
      primaryRole: "candidate",
      placeLabel: "София 24 МИР",
      placeLabelEn: "Sofia 24th MMC",
    };
    const out = toPersonOffice(wire);
    // Per key rather than a deep-equal, so a dropped field says WHICH one.
    for (const k of KEYS) expect(out[k], `${k} was dropped`).toBe(wire[k]);
  });

  it("turns null into undefined, because SearchIndexType declares `?: string`", () => {
    const out = toPersonOffice({
      primaryRole: null,
      placeLabel: null,
      placeLabelEn: null,
    });
    for (const k of KEYS) {
      expect(out[k]).toBeUndefined();
      // Not merely falsy: a surviving `null` in an optional field is the difference that
      // shows up in somebody's `=== undefined` months later.
      expect(out[k]).not.toBeNull();
    }
  });

  it("survives a payload that omits the keys entirely (a pre-082 backend)", () => {
    expect(toPersonOffice({})).toEqual({
      primaryRole: undefined,
      placeLabel: undefined,
      placeLabelEn: undefined,
    });
  });
});

describe("toRoleSubtitleInput — index item + language → the helper's three fields", () => {
  const full: PersonOffice = {
    primaryRole: "candidate",
    placeLabel: "София 24 МИР",
    placeLabelEn: "Sofia 24th MMC",
  };

  it("uses the Bulgarian place in BG and the English one in EN", () => {
    expect(toRoleSubtitleInput(full, true).place_label).toBe("София 24 МИР");
    expect(toRoleSubtitleInput(full, false).place_label).toBe("Sofia 24th MMC");
  });

  it("falls back to the Bulgarian name in EN when there is no English one", () => {
    // A judicial body: 120 carries `name_en` only for place_dim, so this is the designed
    // absence — blanking the place would delete a real discriminator rather than translate it.
    const judicial: PersonOffice = {
      primaryRole: "magistrate",
      placeLabel: "ВКС",
    };
    expect(toRoleSubtitleInput(judicial, false).place_label).toBe("ВКС");
  });

  it("maps a missing field to null, never to undefined", () => {
    // `roleSubtitle` filters on truthiness so both would work today — but its parameter type
    // says `string | null`, and an `undefined` there is a silent widening of that contract.
    const out = toRoleSubtitleInput({}, true);
    expect(out.primary_role).toBeNull();
    expect(out.place_label).toBeNull();
  });

  it("always reports position_type as null — person-lookup returns no broad facet", () => {
    expect(toRoleSubtitleInput(full, true).position_type).toBeNull();
  });
});
