// The place-blob builder is the one piece of the education place card that can
// be wrong without anything failing: a headline computed on a different rule
// from the directory's byOblast would put one number on /education and another
// on /governance/region/:oblast, both at a 200. These cases pin the rules that
// keep the two in step — latest-year membership, count weighting, the ≥10
// cohort gate on every ranked list, and deterministic ordering.

import { describe, it, expect } from "vitest";
import { buildPlacePayloads, type PlaceInputSchool } from "./school_places";

const school = (
  over: Partial<PlaceInputSchool> & { id: string },
): PlaceInputSchool => ({
  name: `school ${over.id}`,
  obshtina: "SML10",
  obshtinaName: "Смолян",
  oblast: "SML",
  latestYear: 2026,
  latestScore: 4.5,
  latestN: 20,
  series: [
    { year: 2022, score: 4.1, n: 18 },
    { year: 2026, score: 4.5, n: 20 },
  ],
  predicted: 4.3,
  residual: 0.2,
  verdict: "above",
  vaResidual: 0.15,
  vaVerdict: "above",
  ...over,
});

const NATIONAL = [
  { year: 2022, avg: 3.97 },
  { year: 2026, avg: 4.33 },
];

describe("buildPlacePayloads", () => {
  it("weights the headline by cohort, not by school", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "a", latestScore: 5, latestN: 300 }),
        school({ id: "b", latestScore: 3, latestN: 10 }),
      ],
      2026,
      NATIONAL,
    );
    // (5*300 + 3*10) / 310 = 4.94 — a per-school mean would say 4.00.
    expect(places.get("SML")?.avg).toBe(4.94);
    expect(places.get("SML")?.examinees).toBe(310);
    expect(places.get("SML")?.schools).toBe(2);
  });

  it("counts only schools whose own latest year is the national latest year", () => {
    // The directory's byOblast rule. A school that stopped reporting keeps its
    // old score in `latestScore`; folding it into today's headline would let a
    // 2022 number sit inside a 2026 average.
    const places = buildPlacePayloads(
      [
        school({ id: "a", latestScore: 5, latestN: 100 }),
        school({
          id: "stale",
          latestYear: 2022,
          latestScore: 2.5,
          latestN: 100,
          series: [{ year: 2022, score: 2.5, n: 100 }],
        }),
      ],
      2026,
      NATIONAL,
    );
    expect(places.get("SML")?.avg).toBe(5);
    expect(places.get("SML")?.schools).toBe(1);
    // …but the trend still shows the year that school did report.
    expect(
      places.get("SML")?.series.find((p) => p.year === 2022)?.schools,
    ).toBe(2);
  });

  it("keeps a school that stopped reporting out of every ranked list", () => {
    // It keeps its old score in `latestScore`, so without the year half of the
    // rule it would be ranked — undated — inside a 2026-headlined card.
    const places = buildPlacePayloads(
      [
        school({ id: "current", latestScore: 4.2, latestN: 40 }),
        school({
          id: "lapsed",
          latestYear: 2023,
          latestScore: 2.32,
          latestN: 11,
          series: [{ year: 2023, score: 2.32, n: 11 }],
          residual: -1.4,
        }),
      ],
      2026,
      NATIONAL,
    );
    const p = places.get("SML")!;
    for (const list of [p.top, p.bottom, p.above, p.va.rows]) {
      expect(list.map((r) => r.id)).not.toContain("lapsed");
    }
    // …and the same rule governs the headline and the residual verdict line,
    // so the card's number and its lists are one school set.
    expect(p.schools).toBe(1);
    expect(p.rankable).toBe(1);
    expect(p.meanResidual).toBe(0.2);
  });

  it("emits no blob for a place whose schools all stopped reporting", () => {
    const places = buildPlacePayloads(
      [
        school({
          id: "a",
          latestYear: 2022,
          series: [{ year: 2022, score: 4.1, n: 18 }],
        }),
      ],
      2026,
      NATIONAL,
    );
    // Not a blob reading avg: 0 — the tiles' contract is "no blob ⇒ hide".
    expect(places.get("SML")).toBeUndefined();
    expect(places.get("SML10")).toBeUndefined();
  });

  it("suppresses the worst list until the place can support both ends", () => {
    const few = buildPlacePayloads(
      [1, 2, 3].map((i) => school({ id: `s${i}`, latestScore: 4 + i / 10 })),
      2026,
      NATIONAL,
    ).get("SML")!;
    expect(few.top).toHaveLength(3);
    expect(few.bottom).toEqual([]);

    const many = buildPlacePayloads(
      Array.from({ length: 12 }, (_, i) =>
        school({ id: `s${i}`, latestScore: 3 + i / 10 }),
      ),
      2026,
      NATIONAL,
    ).get("SML")!;
    const overlap = many.top.filter((t) =>
      many.bottom.some((b) => b.id === t.id),
    );
    expect(many.bottom).toHaveLength(5);
    expect(overlap).toEqual([]);
  });

  it("throws rather than let an oblast code overwrite an obshtina blob", () => {
    // Six diaspora codes are 2 characters, for which the loader's slice(0,3)
    // returns the code itself — so the two key spaces can meet.
    expect(() =>
      buildPlacePayloads(
        [school({ id: "a", oblast: "EU", obshtina: "EU", obshtinaName: "ЕС" })],
        2026,
        NATIONAL,
      ),
    ).toThrow(/place key collision/);
  });

  it("keeps sub-cohort schools out of every ranked list", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "big", latestScore: 4, latestN: 40 }),
        school({ id: "tiny", latestScore: 6, latestN: 3, residual: 1.9 }),
      ],
      2026,
      NATIONAL,
    );
    const p = places.get("SML")!;
    for (const list of [p.top, p.bottom, p.above, p.va.rows]) {
      expect(list.map((r) => r.id)).not.toContain("tiny");
    }
    // The tiny school still counts toward the headline — it has graduates.
    expect(p.examinees).toBe(43);
  });

  it("ranks regions by the headline, highest first", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "a", oblast: "SML", obshtina: "SML10", latestScore: 4.5 }),
        school({
          id: "b",
          oblast: "VAR",
          obshtina: "VAR03",
          obshtinaName: "Варна",
          latestScore: 4.9,
        }),
      ],
      2026,
      NATIONAL,
    );
    expect(places.get("VAR")?.rank).toBe(1);
    expect(places.get("SML")?.rank).toBe(2);
    expect(places.get("SML")?.rankOf).toBe(2);
    // Municípios carry no rank — a 12-graduate village against Пловдив.
    expect(places.get("SML10")?.rank).toBeNull();
  });

  it("builds the по-общини table on the region blob only", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "a", obshtina: "SML10", obshtinaName: "Смолян" }),
        school({
          id: "b",
          obshtina: "SML31",
          obshtinaName: "Чепеларе",
          latestScore: 4.9,
        }),
      ],
      2026,
      NATIONAL,
    );
    expect(places.get("SML")?.byObshtina.map((m) => m.obshtina)).toEqual([
      "SML31",
      "SML10",
    ]);
    expect(places.get("SML10")?.byObshtina).toEqual([]);
    // Each row carries its own change, against its own first year.
    expect(places.get("SML")?.byObshtina[1].delta).toBe(0.4);
  });

  it("reports value-added coverage rather than implying completeness", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "a" }),
        school({ id: "b", vaResidual: null, vaVerdict: null }),
        school({ id: "c", vaResidual: null, vaVerdict: null }),
      ],
      2026,
      NATIONAL,
    );
    const p = places.get("SML")!;
    // "за 1 от 3 училища" — the denominator is the blob's own rankable count,
    // not something reachable only through the va object.
    expect(p.rankable).toBe(3);
    expect(p.va.covered).toBe(1);
    expect(p.va.meanResidual).toBe(0.15);
  });

  it("counts graduates in failing schools, not graduates who failed", () => {
    const places = buildPlacePayloads(
      [
        school({ id: "ok", latestScore: 4.5, latestN: 90 }),
        school({ id: "failing", latestScore: 2.8, latestN: 10 }),
      ],
      2026,
      NATIONAL,
    );
    expect(places.get("SML")?.shareInFailingSchools).toBe(10);
  });

  it("measures each município's change against the average beside it", () => {
    // The /education convention (oblastRows.ts): headline − first year, so the
    // change and the average a reader sees in one row reconcile.
    const places = buildPlacePayloads(
      [
        school({
          id: "a",
          latestScore: 4.5,
          latestN: 20,
          series: [
            { year: 2022, score: 4.1, n: 20 },
            { year: 2026, score: 4.5, n: 20 },
          ],
        }),
      ],
      2026,
      NATIONAL,
    );
    const row = places.get("SML")!.byObshtina[0];
    expect(row.avg).toBe(4.5);
    expect(row.delta).toBe(0.4);
    expect(row.delta).toBe(
      Math.round((row.avg - places.get("SML")!.series[0].avg) * 100) / 100,
    );
  });

  it("carries no national tick for a year the country has no average for", () => {
    const places = buildPlacePayloads([school({ id: "a" })], 2026, [
      { year: 2022, avg: 3.97 },
    ]);
    expect(places.get("SML")?.nationalAvg).toBeNull();
  });

  it("orders ties deterministically so the stored blob is byte-stable", () => {
    const rows = [
      school({ id: "z", latestScore: 4.5 }),
      school({ id: "a", latestScore: 4.5 }),
    ];
    const forward = buildPlacePayloads(rows, 2026, NATIONAL).get("SML")!;
    const reversed = buildPlacePayloads(
      [...rows].reverse(),
      2026,
      NATIONAL,
    ).get("SML")!;
    expect(forward.top.map((r) => r.id)).toEqual(["a", "z"]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("carries the national average of the latest year for the tick", () => {
    const places = buildPlacePayloads([school({ id: "a" })], 2026, NATIONAL);
    expect(places.get("SML")?.nationalAvg).toBe(4.33);
  });

  it("skips a place with no scored school at all", () => {
    const places = buildPlacePayloads(
      [school({ id: "a", latestScore: null, latestN: null, series: [] })],
      2026,
      NATIONAL,
    );
    expect(places.size).toBe(0);
  });
});
