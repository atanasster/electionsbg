// Covers the two payload shapes the table has to survive: the current deployed
// one (byOblast only, no trend) and the one the re-run loader ships
// (byOblastYear alongside it).

import { describe, it, expect } from "vitest";
import { buildOblastRows } from "./oblastRows";

const BY_OBLAST = [
  { oblast: "KRZ", avg: 4.33, examinees: 1200, schools: 20 },
  { oblast: "VAR", avg: 4.37, examinees: 2600, schools: 44 },
];

const BY_OBLAST_YEAR = [
  {
    oblast: "KRZ",
    years: [
      { year: 2022, avg: 3.73, examinees: 1100, schools: 20 },
      { year: 2024, avg: 4.1, examinees: 1150, schools: 20 },
      { year: 2026, avg: 4.33, examinees: 1200, schools: 20 },
    ],
  },
  {
    oblast: "VAR",
    years: [
      { year: 2022, avg: 4.11, examinees: 2500, schools: 44 },
      { year: 2026, avg: 4.37, examinees: 2600, schools: 44 },
    ],
  },
];

const name = (o: string) => ({ KRZ: "Кърджали", VAR: "Варна" })[o] ?? o;

describe("buildOblastRows", () => {
  it("pairs first and latest year and measures the change between them", () => {
    const rows = buildOblastRows(BY_OBLAST, BY_OBLAST_YEAR, 2026, name);
    const krz = rows.find((r) => r.oblast === "KRZ")!;
    expect(krz.name).toBe("Кърджали");
    expect(krz.firstYear).toBe(2022);
    expect(krz.firstAvg).toBe(3.73);
    expect(krz.latestYear).toBe(2026);
    expect(krz.latestAvg).toBe(4.33);
    expect(krz.delta).toBe(0.6);
  });

  it("keeps the columns internally consistent: latest − first = delta", () => {
    for (const r of buildOblastRows(BY_OBLAST, BY_OBLAST_YEAR, 2026, name)) {
      expect(r.delta).toBe(Math.round((r.latestAvg - r.firstAvg!) * 100) / 100);
    }
  });

  it("measures the change against byOblast, not the series' own last point", () => {
    // If the two aggregation rules ever diverge, the headline column wins so the
    // table can't display a change that doesn't match the numbers beside it.
    const drifted = [
      { ...BY_OBLAST_YEAR[0], years: [...BY_OBLAST_YEAR[0].years] },
    ];
    drifted[0].years[2] = { ...drifted[0].years[2], avg: 9.99 };
    const [krz] = buildOblastRows([BY_OBLAST[0]], drifted, 2026, name);
    expect(krz.latestAvg).toBe(4.33);
    expect(krz.delta).toBe(0.6);
  });

  it("degrades to the latest-year-only payload with no trend", () => {
    const rows = buildOblastRows(BY_OBLAST, undefined, 2026, name);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.firstAvg).toBeNull();
      expect(r.delta).toBeNull();
      expect(r.latestYear).toBe(2026);
      expect(r.latestAvg).toBeGreaterThan(4);
    }
  });

  it("treats a single-year series as having no trend", () => {
    const oneYear = [
      {
        oblast: "KRZ",
        years: [{ year: 2026, avg: 4.33, examinees: 1200, schools: 20 }],
      },
    ];
    const [krz] = buildOblastRows([BY_OBLAST[0]], oneYear, 2026, name);
    expect(krz.firstAvg).toBeNull();
    expect(krz.delta).toBeNull();
  });

  it("carries every oblast through, in byOblast order", () => {
    const rows = buildOblastRows(BY_OBLAST, BY_OBLAST_YEAR, 2026, name);
    expect(rows.map((r) => r.oblast)).toEqual(["KRZ", "VAR"]);
  });
});
