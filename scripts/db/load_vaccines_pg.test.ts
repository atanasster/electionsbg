import { describe, expect, it } from "vitest";
import {
  buildDailyRuns,
  expandIncidence,
  latestShortageLists,
  reconcileClosedYears,
  shrinkRefusal,
} from "./load_vaccines_pg";
import {
  HIS_OBLASTS,
  VACCINE_DIM,
  oblastCodeFor,
  vaccineByLabel,
} from "../health/vaccines/vaccine_dim";
import type {
  DailyLine,
  FluLine,
  ShortageLine,
} from "../health/vaccines/snapshot";

const daily = (
  fetched_at: string,
  key: string,
  n_ytd: number,
  year = 2026,
  scope: DailyLine["scope"] = "vaccine",
): DailyLine => ({ fetched_at, year, scope, key, n_ytd, updated_at: "" });

describe("buildDailyRuns", () => {
  it("closes each run at the next capture of the same counter", () => {
    const runs = buildDailyRuns([
      daily("t2", "Seasonal influenza vaccine", 20),
      daily("t1", "Seasonal influenza vaccine", 10),
      daily("t1", "BG-22", 5, 2026, "district"),
    ]);
    const flu = runs.filter((r) => r.key === "flu");
    expect(flu.map((r) => [r.valid_from, r.valid_to, r.n_ytd])).toEqual([
      ["t1", "t2", 10],
      ["t2", null, 20],
    ]);
    expect(runs.find((r) => r.scope === "oblast")?.key).toBe("SOFIA_CITY");
    expect(flu[0].as_of).toBeNull();
  });
  it("refuses an unclassified vaccine label", () => {
    expect(() => buildDailyRuns([daily("t1", "Smallpox vaccine", 1)])).toThrow(
      /not classified/,
    );
  });
});

const sh = (
  fetched_at: string,
  valid_from: string,
  code: string,
): ShortageLine => ({
  fetched_at,
  valid_from,
  valid_to: valid_from,
  ncpr_code: code,
  name: code,
  inn: "",
  strength: "",
  unit: "",
  form: "",
  pack: "",
  is_vaccine: false,
});

describe("latestShortageLists", () => {
  it("keeps each window's latest capture only, so a dropped product drops", () => {
    const rows = latestShortageLists([
      sh("t1", "2026-11-20", "1"),
      sh("t1", "2026-11-20", "2"),
      sh("t2", "2026-11-20", "1"),
      sh("t1", "2026-11-13", "9"),
    ]);
    expect(rows.map((r) => `${r.valid_from}:${r.ncpr_code}`).sort()).toEqual([
      "2026-11-13:9",
      "2026-11-20:1",
    ]);
  });
});

describe("expandIncidence", () => {
  const line = (fetched_at: string, cases: number): FluLine => ({
    fetched_at,
    kind: "incidence",
    iso_week: 47,
    week_start: "2026-11-16",
    week_end: "2026-11-22",
    area: "Общо за страната",
    is_national: true,
    served: [1, 2, 3, 4, 5, 15],
    cases: [0, 0, 0, 0, 0, cases],
    rate: [0, 0, 0, 0, 0, 1],
  });
  it("emits five bands plus 'all', from the latest capture", () => {
    const rows = expandIncidence([line("t1", 7), line("t2", 9)], () => "BG");
    expect(rows.map((r) => r.age_band)).toEqual([
      "0-4",
      "5-14",
      "15-29",
      "30-64",
      "65+",
      "all",
    ]);
    expect(rows.at(-1)?.cases).toBe(9);
  });
  it("refuses a row whose arrays do not match the bands", () => {
    const bad = { ...line("t1", 1), served: [1, 2] } as FluLine;
    expect(() => expandIncidence([bad], () => "BG")).toThrow(/expected 6/);
  });
});

describe("reconcileClosedYears", () => {
  const monthly = [
    { year: 2025, vaccine: "Seasonal influenza vaccine", n: 1000 },
    { year: 2025, vaccine: "Other", n: 5 },
    { year: 2024, vaccine: "Seasonal influenza vaccine", n: 10 },
    { year: 2026, vaccine: "Seasonal influenza vaccine", n: 1 },
  ];
  it("passes an equal year, reports an uncaptured one as unchecked", () => {
    const r = reconcileClosedYears(
      monthly,
      [daily("t1", "Seasonal influenza vaccine", 1000, 2025)],
      2026,
    );
    expect(r).toEqual({ checked: [2025], unchecked: [2024], failures: [] });
  });
  it("fails beyond 0.1% against the latest captured page", () => {
    const r = reconcileClosedYears(
      monthly,
      [
        daily("t1", "Seasonal influenza vaccine", 1000, 2025),
        daily("t2", "Seasonal influenza vaccine", 1100, 2025),
      ],
      2026,
    );
    expect(r.failures).toHaveLength(1);
  });
});

describe("shrinkRefusal", () => {
  it("refuses a fall beyond 5% of a populated table only", () => {
    expect(shrinkRefusal("t", 0, 0)).toBeNull();
    expect(shrinkRefusal("t", 100, 96)).toBeNull();
    expect(shrinkRefusal("t", 100, 90)).toMatch(/refusing/);
  });
});

describe("vaccine_dim", () => {
  it("classifies 31 labels with unique codes, and 28 distinct oblasts", () => {
    expect(VACCINE_DIM).toHaveLength(31);
    expect(new Set(VACCINE_DIM.map((v) => v.code)).size).toBe(31);
    expect(new Set(HIS_OBLASTS.map((o) => o.code)).size).toBe(28);
    expect(vaccineByLabel("Nasal seasonal influenza vaccine").family).toBe(
      "flu_nasal",
    );
  });
  it("keeps Sofia City and Sofia province apart, and asserts the label", () => {
    expect(oblastCodeFor(22, "Sofia City")).toBe("SOFIA_CITY");
    expect(oblastCodeFor(23, "Sofia")).toBe("SFO");
    expect(() => oblastCodeFor(23, "Sofia City")).toThrow(/does not match/);
  });
});
