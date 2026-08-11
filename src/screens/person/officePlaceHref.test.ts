import { describe, expect, it } from "vitest";
import { officePlaceHref, type OfficePlaceRef } from "./officePlaceHref";

const row = (r: Partial<OfficePlaceRef>): OfficePlaceRef => ({
  source: "official_muni",
  ref: "x",
  ...r,
});

describe("officePlaceHref", () => {
  it("links an APPOINTED office to its município — the case that used to be dead text", () => {
    // Иван Такучев, главен архитект, Ивайловград (HKV11): an officials-roster row with a
    // typed place and no local-election ref, which the old local-only rule left unlinked.
    expect(
      officePlaceHref(
        row({
          source: "official_muni",
          placeKind: "obshtina",
          placeCode: "HKV11",
        }),
      ),
    ).toBe("/governance/HKV11");
  });

  it("links a settlement seat to the settlement dashboard", () => {
    expect(
      officePlaceHref(row({ placeKind: "settlement", placeCode: "04618" })),
    ).toBe("/governance/04618");
  });

  it("links a magistrate to their court", () => {
    expect(
      officePlaceHref(
        row({
          source: "magistrate",
          placeKind: "judicial",
          placeCode: "rs-sofiya",
        }),
      ),
    ).toBe("/court/rs-sofiya");
  });

  it("links an MP's МИР to its region node, folding Sofia's three into the city", () => {
    expect(
      officePlaceHref(
        row({ source: "mp", placeKind: "mir", placeCode: "SML" }),
      ),
    ).toBe("/governance/region/SML");
    // PDV-00 is Пловдив-град, a МИР that is not its oblast — it must not collapse to PDV.
    expect(
      officePlaceHref(
        row({ source: "mp", placeKind: "mir", placeCode: "PDV-00" }),
      ),
    ).toBe("/governance/region/PDV-00");
    for (const mir of ["S23", "S24", "S25"]) {
      expect(
        officePlaceHref(
          row({ source: "mp", placeKind: "mir", placeCode: mir }),
        ),
      ).toBe("/governance/SOF00");
    }
  });

  it("resolves the officials roster's synthetic Sofia code to the city dashboard", () => {
    // SFO_CITY is not an EKATTE obshtina and no resolver knows it: interpolating the code
    // would land on the "unknown place" screen while looking like a working link.
    expect(
      officePlaceHref(row({ placeKind: "obshtina", placeCode: "SFO_CITY" })),
    ).toBe("/governance/SOF00");
  });

  it("keeps a local-election seat on its cycle-scoped page", () => {
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "2023_10_29_mi:BLG11:mayor",
          placeKind: "obshtina",
          placeCode: "BLG11",
        }),
      ),
    ).toBe("/local/2023_10_29_mi/BLG11");
  });

  it("sends a кмет на кметство to the settlement its badge names, not the município", () => {
    // The ref's obshtina is Гърмен (BLG13) while the badge reads "с. Ореше" — the label and
    // the destination have to be the same place.
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "2007_10_28_mi:BLG13:kmetstvo",
          placeKind: "settlement",
          placeCode: "53727",
        }),
      ),
    ).toBe("/local/2007_10_28_mi/settlement/53727");
  });

  it("keeps a Sofia кметство on the settlement page too", () => {
    // Владая: the ref's município is SOF (the city bundle, which holds all 32 races) while
    // settlements.json puts the village in район Витоша (S2317), whose shard has none. The
    // href is the settlement page either way — what makes that honest is the SOF fold in
    // useLocalSettlement; without it the page says the village has no village mayor.
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "2023_10_29_mi:SOF:kmetstvo",
          placeKind: "settlement",
          placeCode: "11394",
        }),
      ),
    ).toBe("/local/2023_10_29_mi/settlement/11394");
  });

  it("keeps the cycle when a local ref carries no município segment", () => {
    // Unreachable today (every local ref is well-shaped) — but the row still holds a cycle
    // and a place, so dropping to the current governance page would discard the scoping for
    // no reason.
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "2023_10_29_mi",
          placeKind: "obshtina",
          placeCode: "BLG11",
        }),
      ),
    ).toBe("/local/2023_10_29_mi/BLG11");
    // And that path folds the roster's Sofia code onto the bundle the shards use, which a
    // raw interpolation of `placeCode` would not.
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "2023_10_29_mi",
          placeKind: "obshtina",
          placeCode: "SFO_CITY",
        }),
      ),
    ).toBe("/local/2023_10_29_mi/SOF");
  });

  it("falls back to the place page when a local ref has no cycle at all", () => {
    expect(
      officePlaceHref(
        row({
          source: "local",
          ref: "",
          placeKind: "obshtina",
          placeCode: "BLG11",
        }),
      ),
    ).toBe("/governance/BLG11");
  });

  it("stays plain text for a placeless role or an unservable code", () => {
    expect(
      officePlaceHref(row({ placeKind: null, placeCode: null })),
    ).toBeNull();
    // An oblast code we have no region page for — a dead link is worse than no link.
    expect(
      officePlaceHref(
        row({ source: "mp", placeKind: "mir", placeCode: "ZZZ" }),
      ),
    ).toBeNull();
  });
});
