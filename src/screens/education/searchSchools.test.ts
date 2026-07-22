// Covers the finder wiring on top of the (separately tested) skeletonMatches
// folding: the ≥2-char guard, name-OR-община match, shliokavitsa reach, score sort,
// and the 30-result cap.

import { describe, it, expect } from "vitest";
import { searchSchools } from "./searchSchools";
import type { DirectorySchool } from "@/data/schools/useSchoolDirectory";

const school = (over: Partial<DirectorySchool>): DirectorySchool => ({
  id: over.id ?? "x",
  name: "",
  obshtina: "",
  obshtinaName: "",
  oblast: "",
  latestYear: 2026,
  latestScore: null,
  latestN: 10,
  series: [],
  mathLatest: null,
  ses: null,
  predicted: null,
  residual: null,
  verdict: null,
  nvoPrior: null,
  vaPredicted: null,
  vaResidual: null,
  vaVerdict: null,
  ...over,
});

describe("searchSchools", () => {
  it("returns nothing for queries under 2 chars", () => {
    const schools = [school({ id: "a", name: "НЕМСКА ГИМНАЗИЯ" })];
    expect(searchSchools(schools, "")).toEqual([]);
    expect(searchSchools(schools, "n")).toEqual([]);
    expect(searchSchools(schools, "  ")).toEqual([]);
  });

  it("surfaces a Cyrillic-named school from a shliokavitsa (Latin) query", () => {
    const schools = [
      school({ id: "nemska", name: '91.НЕМСКА ЕЗИКОВА ГИМНАЗИЯ "Гълъбов"' }),
      school({ id: "other", name: "Математическа гимназия" }),
    ];
    const ids = searchSchools(schools, "nemska").map((s) => s.id);
    expect(ids).toEqual(["nemska"]);
  });

  it("matches on община as well as name", () => {
    const schools = [
      school({ id: "plv", name: "Езикова гимназия", obshtinaName: "Пловдив" }),
      school({ id: "sof", name: "Друго", obshtinaName: "София" }),
    ];
    expect(searchSchools(schools, "plovdiv").map((s) => s.id)).toEqual(["plv"]);
  });

  it("sorts matches by latest matura, highest first", () => {
    const schools = [
      school({ id: "lo", name: "СУ Тест", latestScore: 3.1 }),
      school({ id: "hi", name: "СУ Тест", latestScore: 5.6 }),
      school({ id: "mid", name: "СУ Тест", latestScore: 4.2 }),
    ];
    expect(searchSchools(schools, "тест").map((s) => s.id)).toEqual([
      "hi",
      "mid",
      "lo",
    ]);
  });

  it("caps results at 30", () => {
    const schools = Array.from({ length: 45 }, (_, i) =>
      school({ id: `s${i}`, name: "Гимназия", latestScore: i }),
    );
    expect(searchSchools(schools, "гимназия")).toHaveLength(30);
  });
});
