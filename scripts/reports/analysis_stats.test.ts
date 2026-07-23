import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateAnalysisStats, AnalysisStat } from "./analysis_stats";

const stringify = (o: object) => JSON.stringify(o);
const YEAR = "2026_04_19";

let dir: string;

const write = (rel: string, obj: unknown) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), "utf8");
};

const run = (): Record<string, AnalysisStat> =>
  generateAnalysisStats({ publicFolder: dir, year: YEAR, stringify });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-stats-"));
  fs.mkdirSync(path.join(dir, YEAR), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateAnalysisStats", () => {
  it("omits every metric when no source file is present", () => {
    const stats = run();
    expect(stats).toEqual({});
    // …and still writes the (empty) blob.
    expect(fs.existsSync(path.join(dir, YEAR, "analysis_stats.json"))).toBe(
      true,
    );
  });

  it("extracts wasted share and turnout from national_summary", () => {
    write(`${YEAR}/national_summary.json`, {
      turnout: { pct: 50.7 },
      wastedVotes: { share: 18.02 },
    });
    const stats = run();
    expect(stats.wasted).toMatchObject({ kind: "percent", value: 18.02 });
    expect(stats.turnout).toMatchObject({ kind: "percent", value: 50.7 });
  });

  it("carries the total sections alongside the critical count", () => {
    write(`${YEAR}/reports/section/risk_score_summary.json`, {
      totalSections: 12705,
      counts: { low: 1, elevated: 1, high: 1, critical: 10 },
    });
    expect(run().risk).toMatchObject({
      kind: "count",
      value: 10,
      total: 12705,
    });
  });

  it("counts only benford parties whose (secondDigit ?? firstDigit) MAD >= 0.04", () => {
    write(`${YEAR}/reports/benford.json`, {
      parties: [
        { secondDigit: { mad: 0.05 }, firstDigit: { mad: 0.0 } }, // counts (2BL)
        { secondDigit: { mad: 0.039 } }, // below threshold
        { firstDigit: { mad: 0.09 } }, // counts via first-digit fallback
        { firstDigit: { mad: 0.01 } }, // below
      ],
    });
    expect(run().benford).toMatchObject({ kind: "count", value: 2 });
  });

  it("selects the transition pair whose folder ends _<year> and scales stayRate to %", () => {
    write(`transitions/2024_10_27_${YEAR}/persistence.json`, {
      national: { stayRate: 0.4315 },
    });
    // a decoy pair NOT ending at this year must be ignored
    write(`transitions/2021_04_04_2021_07_11/persistence.json`, {
      national: { stayRate: 0.99 },
    });
    const p = run().persistence;
    expect(p?.kind).toBe("percent");
    expect(p?.value).toBeCloseTo(43.15, 2);
  });

  it("picks the lowest agency MAE for the matching (hyphenated) election date", () => {
    write("polls/accuracy.json", {
      elections: [
        {
          electionDate: "2026-04-19",
          agencies: [{ mae: 2.3 }, { mae: 1.76 }, { mae: 2.75 }],
        },
        { electionDate: "2024-10-27", agencies: [{ mae: 0.1 }] }, // wrong election
      ],
    });
    expect(run().polls).toMatchObject({ kind: "score", value: 1.76 });
  });

  it("sums donated money (monetary + non-monetary), not the donation count", () => {
    // totalDonations is a COUNT and must be ignored; the euro figure is the sum.
    write(`${YEAR}/parties/donors.json`, {
      totalDonations: 848,
      totalMonetary: 1300978.76,
      totalNonMonetary: 707.26,
    });
    expect(run().financing).toMatchObject({ kind: "eur", value: 1301686 });

    write(`${YEAR}/parties/donors.json`, {
      totalDonations: 12,
      totalMonetary: 0,
      totalNonMonetary: 0,
    });
    expect(run().financing).toBeUndefined();
  });

  it("reads the sharpest cleavage (rows[0].spread) as the demographics score", () => {
    write(`${YEAR}/dashboard/demographic_cleavages.json`, {
      rows: [
        { metric: "religionMuslim", spread: 1.43 },
        { metric: "age15_29", spread: 0.44 },
      ],
    });
    expect(run().demographics).toMatchObject({ kind: "score", value: 1.43 });

    write(`${YEAR}/dashboard/demographic_cleavages.json`, { rows: [] });
    expect(run().demographics).toBeUndefined();
  });
});
