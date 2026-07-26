// Unit test for the name-index map build in useMunicipalOfficialsByName — specifically the
// null-municipality path, which the matview now emits (a listing with no filing) and which
// previously crashed the whole build inside .normalize(). No network, no DB.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).

import { describe, it, expect } from "vitest";
import { buildNameMaps, norm } from "./useMunicipalOfficialsByName";

describe("norm", () => {
  it("folds null/undefined to an empty string instead of throwing", () => {
    expect(norm(null)).toBe("");
    expect(norm(undefined)).toBe("");
    expect(norm("  Иван   Петров ")).toBe("иван петров");
  });
});

describe("buildNameMaps", () => {
  it("does not throw on an entry with a null municipality", () => {
    expect(() =>
      buildNameMaps([
        {
          slug: "s",
          name: "Иван Иванов",
          role: "councillor",
          municipality: null,
        },
      ]),
    ).not.toThrow();
  });

  it("still resolves a null-municipality entry by name", () => {
    const { byName } = buildNameMaps([
      { slug: "s", name: "Иван Иванов", role: "mayor", municipality: null },
    ]);
    expect(byName.get(norm("Иван Иванов"))?.slug).toBe("s");
  });

  it("first-wins keeps the higher-priority row when the wire is role-ordered", () => {
    // The route emits mayors before councillors for a shared name; first-wins must keep the
    // mayor so a namesake collision deep-links to the right official.
    const { byName } = buildNameMaps([
      {
        slug: "mayor-slug",
        name: "Петър Петров",
        role: "mayor",
        municipality: "Аксаково",
      },
      {
        slug: "councillor-slug",
        name: "Петър Петров",
        role: "councillor",
        municipality: "Варна",
      },
    ]);
    expect(byName.get(norm("Петър Петров"))?.slug).toBe("mayor-slug");
  });

  it("byNameAndMuni disambiguates two same-named officials by municipality", () => {
    const { byNameAndMuni } = buildNameMaps([
      {
        slug: "a",
        name: "Мария Иванова",
        role: "councillor",
        municipality: "Русе",
      },
      {
        slug: "b",
        name: "Мария Иванова",
        role: "councillor",
        municipality: "Плевен",
      },
    ]);
    expect(
      byNameAndMuni.get(`${norm("Мария Иванова")}::${norm("Плевен")}`)?.slug,
    ).toBe("b");
  });
});
