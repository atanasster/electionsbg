import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateRiskScoreReport, RiskScoreReport } from "./risk_score";

const stringify = (o: object) => JSON.stringify(o);
const YEAR = "2026_04_19";
const PREV = "2024_10_27";

let dir: string;
let reports: string;

const write = (rel: string, obj: unknown) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), "utf8");
};

/** One polling section in the by-oblast shard shape the loader expects. */
const section = (
  id: string,
  {
    ekatte = "00001",
    registered = 1000,
    actual = 500,
    machines = 1,
    validPaper,
    validMachine,
    votes,
  }: {
    ekatte?: string;
    registered?: number;
    actual?: number;
    machines?: number;
    validPaper?: number;
    validMachine?: number;
    votes: [number, number][];
  },
) => [
  id,
  {
    section: id,
    ekatte,
    obshtina: "OBS01",
    oblast: "01",
    num_machines: machines,
    results: {
      protocol: {
        numRegisteredVoters: registered,
        totalActualVoters: actual,
        numValidVotes: validPaper,
        numValidMachineVotes: validMachine,
      },
      votes: votes.map(([partyNum, totalVotes]) => ({ partyNum, totalVotes })),
    },
  },
];

const writeSections = (year: string, entries: ReturnType<typeof section>[]) => {
  write(
    `${year}/sections/by-oblast/01.json`,
    Object.fromEntries(entries as unknown as [string, unknown][]),
  );
};

const run = (prevYear?: string): RiskScoreReport => {
  generateRiskScoreReport({
    publicFolder: dir,
    reportsFolder: reports,
    year: YEAR,
    prevYear,
    stringify,
  });
  return JSON.parse(
    fs.readFileSync(path.join(reports, "section", "risk_score.json"), "utf-8"),
  ) as RiskScoreReport;
};

const componentOf = (
  report: RiskScoreReport,
  sectionId: string,
  id: string,
) => {
  const row = report.rows.find((r) => r.section === sectionId);
  return row?.components.find((c) => c.id === id);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-score-"));
  reports = path.join(dir, "reports");
  fs.mkdirSync(path.join(reports, "section"), { recursive: true });
  // Three peers in one settlement so the peer-outlier z-score can be computed.
  writeSections(YEAR, [
    section("010100001", {
      votes: [
        [1, 300],
        [2, 100],
      ],
    }),
    section("010100002", {
      votes: [
        [1, 200],
        [2, 200],
      ],
    }),
    section("010100003", {
      votes: [
        [1, 210],
        [2, 190],
      ],
    }),
  ]);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateRiskScoreReport — known vs fired", () => {
  it("scores a computable-but-silent signal as 0 at full weight, not as missing", () => {
    // invalid_ballots.json exists and mentions only section 1. Section 2 is
    // therefore KNOWN-clean on that signal, not unmeasured.
    write("reports/section/invalid_ballots.json", [
      { section: "010100001", value: 15 },
    ]);
    const report = run();

    const flagged = componentOf(report, "010100001", "invalidBallots");
    const clean = componentOf(report, "010100002", "invalidBallots");
    expect(flagged?.normalized).toBeCloseTo(0.5, 5); // 15 / 30% cap
    expect(clean).toBeDefined();
    expect(clean?.normalized).toBe(0);
    expect(clean?.weight).toBe(0.15); // full weight, not dropped
  });

  it("drops a signal from the denominator when it is uncomputable for the election", () => {
    // No invalid_ballots.json at all — the signal is unknown everywhere.
    const report = run();
    expect(componentOf(report, "010100001", "invalidBallots")).toBeUndefined();
  });

  it("treats a machine-less section's SUEMG check as unknown, not clean", () => {
    write("reports/section/suemg_added.json", [
      { section: "010100001", pctSuemg: 10 },
    ]);
    writeSections(YEAR, [
      section("010100001", {
        votes: [
          [1, 300],
          [2, 100],
        ],
      }),
      section("010100002", {
        machines: 0,
        votes: [
          [1, 200],
          [2, 200],
        ],
      }),
      section("010100003", {
        votes: [
          [1, 210],
          [2, 190],
        ],
      }),
    ]);
    const report = run();

    // Had machines, no mismatch reported → measured zero.
    expect(componentOf(report, "010100003", "suemgMismatch")?.normalized).toBe(
      0,
    );
    // No machines → nothing to compare, signal absent.
    expect(componentOf(report, "010100002", "suemgMismatch")).toBeUndefined();
  });

  it("scores `concentrated` on the protocol valid-vote denominator", () => {
    // 360 of 400 party votes, but the protocol counts only 380 valid
    // (paper 300 + machine 80). The signal must use the protocol figure
    // (360/380 = 94.7%), not the summed party votes (90%) — otherwise
    // sections listed in concentrated.json and those scored here would
    // sit on different denominators.
    writeSections(YEAR, [
      section("010100001", {
        validPaper: 300,
        validMachine: 80,
        votes: [
          [1, 360],
          [2, 40],
        ],
      }),
      section("010100002", {
        votes: [
          [1, 200],
          [2, 200],
        ],
      }),
      section("010100003", {
        votes: [
          [1, 210],
          [2, 190],
        ],
      }),
    ]);
    const report = run();
    expect(
      componentOf(report, "010100001", "concentrated")?.rawValue,
    ).toBeCloseTo((100 * 360) / 380, 4);
  });

  it("always computes `concentrated`, falling back to the section's own winner share", () => {
    // concentrated.json lists nobody, yet section 1's winner took 75% and
    // section 2's took 50% — both are known, and both score 0 (below the
    // 80% threshold) rather than vanishing from the denominator.
    const report = run();
    const one = componentOf(report, "010100001", "concentrated");
    expect(one?.rawValue).toBeCloseTo(75, 5);
    expect(one?.normalized).toBe(0);
    expect(componentOf(report, "010100002", "concentrated")).toBeDefined();
  });

  it("does not let a rare signal inflate rank merely by being present", () => {
    // Section 1 is the only one with a recount, and it is a trivial one.
    // Under the old present-only denominator its score was computed from
    // that single signal; now the silent signals hold it down.
    write("reports/section/recount.json", [
      { section: "010100001", totalVotes: 400, addedVotes: 1, removedVotes: 1 },
    ]);
    write("reports/section/invalid_ballots.json", [
      { section: "010100002", value: 20 },
    ]);
    const report = run();
    const one = report.rows.find((r) => r.section === "010100001");
    const two = report.rows.find((r) => r.section === "010100002");
    // A 0.5% recount churn must not outrank a 20% invalid-ballot rate.
    expect(one!.score).toBeLessThan(two!.score);
  });
});

describe("generateRiskScoreReport — sub-scores", () => {
  it("splits the composite into procedural and distribution families", () => {
    write("reports/section/invalid_ballots.json", [
      { section: "010100001", value: 30 }, // saturates → normalized 1
    ]);
    const report = run();
    const row = report.rows.find((r) => r.section === "010100001")!;

    expect(row.proceduralScore).toBeDefined();
    expect(row.distributionScore).toBeDefined();
    // Only invalidBallots is procedural here and it saturated.
    expect(row.proceduralScore).toBeCloseTo(100, 5);
    // The composite must sit between the two families, never outside them.
    const lo = Math.min(row.proceduralScore!, row.distributionScore!);
    const hi = Math.max(row.proceduralScore!, row.distributionScore!);
    expect(row.score).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(row.score).toBeLessThanOrEqual(hi + 1e-6);
  });

  it("leaves a family undefined when it contributed no computable signal", () => {
    // No prior election and no procedural source files: only the
    // distribution family (concentrated, peerOutlier) can be computed.
    const report = run();
    const row = report.rows.find((r) => r.section === "010100001")!;
    expect(row.proceduralScore).toBeUndefined();
    expect(row.distributionScore).toBeDefined();
  });
});

describe("generateRiskScoreReport — swing", () => {
  it("records a matched section with no upward shift as 0 rather than omitting it", () => {
    // Prior election: identical shares, so the swing z is not positive.
    writeSections(PREV, [
      section("010100001", {
        votes: [
          [1, 300],
          [2, 100],
        ],
      }),
      section("010100002", {
        votes: [
          [1, 200],
          [2, 200],
        ],
      }),
      section("010100003", {
        votes: [
          [1, 210],
          [2, 190],
        ],
      }),
    ]);
    const report = run(PREV);
    const swing = componentOf(report, "010100001", "swing");
    expect(swing).toBeDefined();
    expect(swing?.normalized).toBe(0);
  });

  it("omits swing entirely when there is no prior election", () => {
    const report = run();
    expect(componentOf(report, "010100001", "swing")).toBeUndefined();
  });
});

describe("generateRiskScoreReport — band calibration", () => {
  it("cuts bands at 20/40/60, not the pre-fix 30/60/80", () => {
    write("reports/section/invalid_ballots.json", [
      { section: "010100001", value: 30 },
      { section: "010100002", value: 3 },
    ]);
    const report = run();
    const expected = (s: number) =>
      s < 20 ? "low" : s < 40 ? "elevated" : s < 60 ? "high" : "critical";
    for (const row of report.rows) {
      expect(`${row.section}:${row.band}`).toBe(
        `${row.section}:${expected(row.score)}`,
      );
    }
    // Guard against a vacuous pass: at least one row must clear "low",
    // and it must sit in a band the old 30/60/80 cuts would have missed.
    const elevated = report.rows.filter((r) => r.band !== "low");
    expect(elevated.length).toBeGreaterThan(0);
    expect(Math.max(...report.rows.map((r) => r.score))).toBeGreaterThan(20);
  });
});

describe("generateRiskScoreReport — recount cap", () => {
  it("saturates recount churn at 10%, not 50%", () => {
    write("reports/section/recount.json", [
      {
        section: "010100001",
        totalVotes: 400,
        addedVotes: 40,
        removedVotes: 0,
      },
    ]);
    const report = run();
    // 40/400 = 10% churn → exactly at the cap.
    expect(componentOf(report, "010100001", "recount")?.normalized).toBe(1);
    expect(report.caps.recountPct).toBe(0.1);
  });
});
