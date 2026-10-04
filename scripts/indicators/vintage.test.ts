import { describe, expect, test } from "vitest";
import type { IndicatorsPayload } from "./build";
import { carryPriorYears, findShrinkage } from "./vintage";

const meta = {
  labelBg: "",
  labelEn: "",
  unitBg: "",
  unitEn: "",
  cadence: "annual" as const,
  source: { name: "", url: "" },
};

const payload = (series: IndicatorsPayload["series"]): IndicatorsPayload => ({
  fetchedAt: "",
  indicators: Object.fromEntries(
    Object.keys(series).map((id) => [id, { ...meta, years: [0, 0] }]),
  ) as IndicatorsPayload["indicators"],
  series,
});

describe("carryPriorYears", () => {
  test("re-adds a year the source stopped returning (ДЗИ 2022, 2026-10)", () => {
    const prior = {
      BGS01: [
        { year: 2022, value: 3.47 },
        { year: 2023, value: 3.3 },
      ],
      SOF00: [{ year: 2022, value: 4.1 }],
    };
    const { rows, carried } = carryPriorYears(
      [{ obshtinaCode: "BGS01", year: 2023, value: 3.31 }],
      prior,
    );
    expect(carried).toEqual(new Map([[2022, 2]]));
    expect(rows).toContainEqual({
      obshtinaCode: "BGS01",
      year: 2022,
      value: 3.47,
    });
    // A year the source still serves is taken from the source (revision wins).
    expect(rows.filter((r) => r.year === 2023)).toEqual([
      { obshtinaCode: "BGS01", year: 2023, value: 3.31 },
    ]);
  });

  test("never fills a muni hole inside a fresh year", () => {
    const { rows, carried } = carryPriorYears(
      [{ obshtinaCode: "BGS01", year: 2023, value: 3.3 }],
      { SOF00: [{ year: 2023, value: 4 }] },
    );
    expect(carried.size).toBe(0);
    expect(rows).toHaveLength(1);
  });

  test("no committed file → unchanged", () => {
    const fresh = [{ obshtinaCode: "X", year: 2025, value: 1 }];
    expect(carryPriorYears(fresh, undefined).rows).toEqual(fresh);
  });
});

describe("findShrinkage", () => {
  const committed = payload({
    dzi: {
      A: [
        { year: 2022, value: 1 },
        { year: 2023, value: 1 },
      ],
      B: [{ year: 2024, value: 1 }],
    },
    unemployment: { A: [{ year: 2025, value: 5 }] },
  });

  test("reports a lost year even when every remaining year is intact", () => {
    const next = payload({
      dzi: { A: [{ year: 2023, value: 1 }], B: [{ year: 2024, value: 1 }] },
      unemployment: { A: [{ year: 2025, value: 5 }] },
    });
    expect(findShrinkage(next, committed)).toEqual([
      { id: "dzi", lostYears: [2022] },
    ]);
  });

  test("sees a hole in the middle of the range, not just the ends", () => {
    const next = payload({
      dzi: { A: [{ year: 2022, value: 1 }], B: [{ year: 2024, value: 1 }] },
      unemployment: { A: [{ year: 2025, value: 5 }] },
    });
    expect(findShrinkage(next, committed)[0].lostYears).toEqual([2023]);
  });

  test("a vanished indicator is shrinkage (e.g. a --source filter)", () => {
    const next = payload({ dzi: committed.series.dzi });
    expect(findShrinkage(next, committed)).toEqual([
      { id: "unemployment", lostYears: [], missingIndicator: true },
    ]);
  });

  test("growth and an identical rebuild are clean", () => {
    expect(findShrinkage(committed, committed)).toEqual([]);
    const grown = payload({
      ...committed.series,
      dzi: {
        ...committed.series.dzi,
        C: [{ year: 2026, value: 1 }],
      },
    });
    expect(findShrinkage(grown, committed)).toEqual([]);
    expect(findShrinkage(grown, undefined)).toEqual([]);
  });
});
