import { describe, expect, it } from "vitest";
import type { MacroPayload } from "@/data/macro/useMacro";
import {
  computeLabourSlackCallout,
  computeSlackEuAverage,
} from "./labourSlack";

const fmt1 = (v: number) => v.toFixed(1);

// Minimal MacroPayload with only the two series the callout reads.
const macroWith = (
  labourSlack: { year: number; value: number }[] | undefined,
  unemployment: { year: number; quarter?: 1 | 2 | 3 | 4; value: number }[],
): MacroPayload =>
  ({
    series: {
      ...(labourSlack ? { labourSlack } : {}),
      unemployment,
    },
  }) as unknown as MacroPayload;

describe("computeLabourSlackCallout", () => {
  it("returns null when macro is undefined", () => {
    expect(computeLabourSlackCallout(undefined, fmt1)).toBeNull();
  });

  it("returns null when the slack series is missing or empty", () => {
    expect(
      computeLabourSlackCallout(macroWith(undefined, []), fmt1),
    ).toBeNull();
    expect(computeLabourSlackCallout(macroWith([], []), fmt1)).toBeNull();
  });

  it("uses the LATEST slack point and averages the same-year unemployment quarters", () => {
    const out = computeLabourSlackCallout(
      macroWith(
        [
          { year: 2024, value: 6.2 },
          { year: 2025, value: 5.5 },
        ],
        [
          { year: 2024, quarter: 1, value: 4.0 },
          { year: 2025, quarter: 1, value: 3.0 },
          { year: 2025, quarter: 2, value: 4.0 },
          // 2025 mean = (3.0 + 4.0) / 2 = 3.5 → ratio = 5.5 / 3.5 = 1.571…
        ],
      ),
      fmt1,
    );
    expect(out).toEqual({
      year: 2025,
      value: "5.5",
      unemp: "3.5",
      ratio: "1.6",
    });
  });

  it("leaves unemp and ratio null when no unemployment quarter shares the slack year", () => {
    const out = computeLabourSlackCallout(
      macroWith(
        [{ year: 2025, value: 5.5 }],
        [{ year: 2019, quarter: 1, value: 4.2 }],
      ),
      fmt1,
    );
    expect(out).toMatchObject({
      year: 2025,
      value: "5.5",
      unemp: null,
      ratio: null,
    });
  });

  it("guards against a zero unemployment mean (no divide-by-zero)", () => {
    const out = computeLabourSlackCallout(
      macroWith(
        [{ year: 2025, value: 5.5 }],
        [{ year: 2025, quarter: 1, value: 0 }],
      ),
      fmt1,
    );
    expect(out).toMatchObject({ unemp: "0.0", ratio: null });
  });
});

describe("computeSlackEuAverage", () => {
  it("returns null when there is no distribution", () => {
    expect(computeSlackEuAverage(null, 2025, fmt1)).toBeNull();
    expect(computeSlackEuAverage(undefined, 2025, fmt1)).toBeNull();
  });

  it("returns null when the EU average is missing", () => {
    expect(
      computeSlackEuAverage({ year: 2025, euAverage: null }, 2025, fmt1),
    ).toBeNull();
  });

  it("returns the formatted EU average when the year matches the callout", () => {
    expect(
      computeSlackEuAverage({ year: 2025, euAverage: 11.0 }, 2025, fmt1),
    ).toBe("11.0");
  });

  it("returns null on a year mismatch (never compare two different years)", () => {
    expect(
      computeSlackEuAverage({ year: 2024, euAverage: 11.0 }, 2025, fmt1),
    ).toBeNull();
  });

  it("skips the year guard when no callout year is available", () => {
    expect(
      computeSlackEuAverage({ year: 2024, euAverage: 11.0 }, null, fmt1),
    ).toBe("11.0");
  });
});
