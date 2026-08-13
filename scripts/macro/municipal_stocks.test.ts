// Gates for the national municipal-stock series builder.
//
// The rule every assertion here defends: this corpus has holes BY DESIGN. When
// МФ freezes a column between releases the ingest withholds the field rather
// than repeating a stale figure, so a quarter can legitimately carry arrears
// and no commitments. A builder that filled either hole with a zero would
// publish „nothing contracted this quarter" — the exact opposite of the fact,
// on the one figure this whole pillar exists to surface.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildSeries,
  municipalStockIndicators,
  readCorpus,
  type QuarterFile,
} from "./municipal_stocks";
import type {
  Money,
  MunicipalFiscalQuarter,
} from "../budget/municipal_fiscal/types";

// Typed as `Money`, not shaped by hand: the point of the fixture is that a
// rename in the corpus type breaks these tests rather than passing them against
// a shape the corpus does not have.
const eur = (amountEur: number): Money => ({
  amount: amountEur * 1.95583,
  currency: "BGN",
  amountEur,
});

// The row cast is unavoidable — `MunicipalFiscalQuarter` carries ~30 columns
// none of these assertions touch — but it goes through `Partial`, so the fields
// that ARE set still typecheck.
const row = (
  obshtina: string,
  fields: Partial<
    Record<"commitments" | "expenseObligations" | "arrears", number>
  >,
): MunicipalFiscalQuarter =>
  ({
    obshtina,
    commitments: fields.commitments == null ? null : eur(fields.commitments),
    expenseObligations:
      fields.expenseObligations == null ? null : eur(fields.expenseObligations),
    arrears: fields.arrears == null ? null : eur(fields.arrears),
  }) as Partial<MunicipalFiscalQuarter> as MunicipalFiscalQuarter;

const file = (period: string, rows: MunicipalFiscalQuarter[]): QuarterFile => ({
  period,
  rows,
});

describe("buildSeries", () => {
  it("sums the field over every reporting município, in EUR million", () => {
    const got = buildSeries(
      [
        file("2024-Q4", [
          row("SOF00", { commitments: 1_000_000 }),
          row("BGS04", { commitments: 500_000 }),
        ]),
      ],
      "commitments",
    );
    expect(got).toEqual([
      {
        year: 2024,
        quarter: 4,
        period: "2024-Q4",
        value: 1.5,
        municipalityCount: 2,
        partial: false,
      },
    ]);
  });

  it("DROPS a quarter where the field is withheld everywhere — never emits 0", () => {
    // The load-bearing case: a frozen column. €0 here would read as „nothing
    // contracted", which is a claim the source never made.
    const got = buildSeries(
      [
        file("2025-Q2", [row("SOF00", { commitments: 1_000_000 })]),
        file("2025-Q3", [row("SOF00", { arrears: 1_000 })]),
      ],
      "commitments",
    );
    expect(got.map((p) => p.period)).toEqual(["2025-Q2"]);
    expect(got.some((p) => p.value === 0)).toBe(false);
  });

  it("keeps a quarter where SOME municipalities reported, and flags it partial", () => {
    // A partial quarter is a genuine undercount rather than a hole, so it is
    // published with its denominator instead of dropped.
    const got = buildSeries(
      [
        file("2025-Q3", [
          row("SOF00", { commitments: 2_000_000 }),
          row("BGS04", {}),
          row("VAR03", {}),
        ]),
      ],
      "commitments",
    );
    expect(got[0]).toMatchObject({
      value: 2,
      municipalityCount: 1,
      partial: true,
    });
  });

  it("does not flag a quarter every município reported", () => {
    const got = buildSeries(
      [file("2024-Q4", [row("SOF00", { arrears: 1_000_000 })])],
      "arrears",
    );
    expect(got[0].partial).toBe(false);
  });

  it("sorts chronologically and carries year/quarter separately from period", () => {
    const got = buildSeries(
      [
        file("2025-Q1", [row("SOF00", { arrears: 3_000_000 })]),
        file("2024-Q2", [row("SOF00", { arrears: 1_000_000 })]),
        file("2024-Q4", [row("SOF00", { arrears: 2_000_000 })]),
      ],
      "arrears",
    );
    expect(got.map((p) => p.period)).toEqual(["2024-Q2", "2024-Q4", "2025-Q1"]);
    expect(got.map((p) => [p.year, p.quarter])).toEqual([
      [2024, 2],
      [2024, 4],
      [2025, 1],
    ]);
  });

  it("ignores a file whose period is not a YYYY-Qn label", () => {
    const got = buildSeries(
      [file("2024", [row("SOF00", { arrears: 1_000_000 })])],
      "arrears",
    );
    expect(got).toEqual([]);
  });

  it("reads the three fields independently of one another", () => {
    const files = [
      file("2024-Q4", [
        row("SOF00", {
          commitments: 4_000_000,
          expenseObligations: 400_000,
          arrears: 73_000,
        }),
      ]),
    ];
    expect(buildSeries(files, "commitments")[0].value).toBe(4);
    expect(buildSeries(files, "expenseObligations")[0].value).toBe(0.4);
    expect(buildSeries(files, "arrears")[0].value).toBeCloseTo(0.1, 5);
  });

  it("returns nothing for an empty corpus", () => {
    expect(buildSeries([], "commitments")).toEqual([]);
  });
});

describe("buildSeries — the roster-relative `partial` flag", () => {
  it("flags a quarter whose FILE is short, not only one with withheld fields", () => {
    // The case the old row-count denominator could not see: a município that
    // filed nothing gets no row at all (ingest T1.5), so 2 of 2 reported and
    // `partial` was false while the national total was missing a município.
    const got = buildSeries(
      [
        file("2024-Q4", [
          row("SOF00", { arrears: 1_000_000 }),
          row("BGS04", { arrears: 1_000_000 }),
          row("VAR03", { arrears: 1_000_000 }),
        ]),
        file("2025-Q1", [
          row("SOF00", { arrears: 1_000_000 }),
          row("BGS04", { arrears: 1_000_000 }),
        ]),
      ],
      "arrears",
    );
    expect(got.find((p) => p.period === "2024-Q4")).toMatchObject({
      municipalityCount: 3,
      partial: false,
    });
    expect(got.find((p) => p.period === "2025-Q1")).toMatchObject({
      municipalityCount: 2,
      partial: true,
    });
  });

  it("excludes a malformed Money from BOTH the sum and the count", () => {
    // A row present but unparseable must not be counted as reporting while
    // contributing nothing — that is the same „a hole became a zero" failure the
    // module exists to prevent, one level down, and it would silently deflate
    // the national total with a full-looking denominator.
    const broken = {
      obshtina: "BGS04",
      arrears: { amount: 1, currency: "BGN", amountEur: NaN },
    } as Partial<MunicipalFiscalQuarter> as MunicipalFiscalQuarter;
    const got = buildSeries(
      [file("2024-Q4", [row("SOF00", { arrears: 1_000_000 }), broken])],
      "arrears",
    );
    expect(got[0]).toMatchObject({ value: 1, municipalityCount: 1 });
    expect(Number.isFinite(got[0].value)).toBe(true);
  });
});

describe("readCorpus", () => {
  const seed = () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-stocks-"));
    writeFileSync(
      join(dir, "2024-Q4.json"),
      JSON.stringify({
        period: "2024-Q4",
        rows: [row("SOF00", { commitments: 4_000_000, arrears: 73_000 })],
      }),
    );
    // Neither of these is a quarter file, and both live in the real corpus dir.
    writeFileSync(join(dir, "index.json"), JSON.stringify({ quarters: [] }));
    writeFileSync(join(dir, "2024-Q5.json"), JSON.stringify({ rows: [] }));
    return dir;
  };

  it("reads only YYYY-Qn.json", () => {
    expect(readCorpus(seed()).map((f) => f.period)).toEqual(["2024-Q4"]);
  });

  it("returns [] for an absent directory rather than throwing", () => {
    expect(readCorpus(join(tmpdir(), "mf-stocks-does-not-exist"))).toEqual([]);
  });
});

describe("municipalStockIndicators", () => {
  const dir = (() => {
    const d = mkdtempSync(join(tmpdir(), "mf-inds-"));
    writeFileSync(
      join(d, "2024-Q4.json"),
      JSON.stringify({
        period: "2024-Q4",
        rows: [
          row("SOF00", {
            commitments: 4_000_000,
            expenseObligations: 400_000,
            arrears: 73_000,
          }),
        ],
      }),
    );
    return d;
  })();

  it("emits the three stocks as quarterly curated entries", () => {
    const inds = municipalStockIndicators(dir);
    expect(inds.map((i) => i.key)).toEqual([
      "municipalCommitments",
      "municipalExpenseObligations",
      "municipalArrears",
    ]);
    for (const i of inds) {
      expect(i.cadence).toBe("quarterly");
      expect(i.source).toBe("curated");
      expect(i.series).toHaveLength(1);
    }
  });

  it("carries the not-a-component-of-the-deficit disclaimer in BOTH locales", () => {
    // The attribution is where the disclosure lives at the DATA layer, so any
    // future consumer of macro.json inherits it instead of having to know it.
    for (const i of municipalStockIndicators(dir)) {
      expect(i.attributionBg).toContain("НЕ са част от държавния дефицит");
      expect(i.attributionEn).toMatch(/NOT a component/);
    }
  });

  it("returns three EMPTY series rather than throwing on an absent corpus", () => {
    const inds = municipalStockIndicators(
      join(tmpdir(), "mf-inds-does-not-exist"),
    );
    expect(inds).toHaveLength(3);
    expect(inds.every((i) => i.series.length === 0)).toBe(true);
  });
});
