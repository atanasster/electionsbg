import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  missingDayRuns,
  auditDayCoverage,
  totalMissingDays,
} from "./day_coverage";

let dir: string;

const seed = (days: string[]): void => {
  for (const d of days) fs.writeFileSync(path.join(dir, `${d}.json.gz`), "x");
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "daycov-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("missingDayRuns", () => {
  test("a dense cache has no gaps", () => {
    seed(["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(missingDayRuns(dir)).toEqual([]);
  });

  test("finds one contiguous interior run and reports its extent", () => {
    seed(["2024-01-01", "2024-01-05"]);
    const [g] = missingDayRuns(dir);
    expect(g).toMatchObject({ from: "2024-01-02", to: "2024-01-04", days: 3 });
  });

  test("finds several disjoint runs", () => {
    seed(["2024-01-01", "2024-01-03", "2024-01-07"]);
    expect(missingDayRuns(dir).map((g) => [g.from, g.to, g.days])).toEqual([
      ["2024-01-02", "2024-01-02", 1],
      ["2024-01-04", "2024-01-06", 3],
    ]);
  });

  // The regression this whole module exists for: 2023-10-24 → 2023-12-31, 69 days,
  // which every run republished at exit 0 for ~2.5 years.
  test("reproduces the 69-day 2023 hole", () => {
    seed(["2023-10-23", "2024-01-01"]);
    const [g] = missingDayRuns(dir);
    expect(g.from).toBe("2023-10-24");
    expect(g.to).toBe("2023-12-31");
    expect(g.days).toBe(69);
  });

  // Bounded by the dir's OWN extremes: a cache that has not caught up to today is
  // not holed, or every incremental run would refuse to build.
  test("a trailing edge is not a gap", () => {
    seed(["2024-01-01", "2024-01-02"]);
    expect(missingDayRuns(dir)).toEqual([]);
  });

  test("degenerate caches have no interior", () => {
    expect(missingDayRuns(path.join(dir, "nope"))).toEqual([]);
    expect(missingDayRuns(dir)).toEqual([]); // empty
    seed(["2024-01-01"]);
    expect(missingDayRuns(dir)).toEqual([]); // single day
  });

  test("ignores non-day files rather than treating them as boundaries", () => {
    seed(["2024-01-01", "2024-01-02"]);
    fs.writeFileSync(path.join(dir, "_notes.txt"), "x");
    fs.writeFileSync(path.join(dir, "index.json.gz"), "x");
    expect(missingDayRuns(dir)).toEqual([]);
  });

  test("spans a leap day correctly", () => {
    seed(["2024-02-28", "2024-03-01"]);
    const [g] = missingDayRuns(dir);
    expect(g).toMatchObject({ from: "2024-02-29", to: "2024-02-29", days: 1 });
  });
});

describe("auditDayCoverage", () => {
  // The two caches are disjoint eras (РОП 2010–2019, ЦАИС 2020→) and are audited
  // per-dir precisely so the 2020-01-01 seam between them is never flagged.
  test("audits dirs independently — the seam between them is not a gap", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "rop-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "eop-"));
    for (const d of ["2019-12-30", "2019-12-31"])
      fs.writeFileSync(path.join(a, `${d}.json.gz`), "x");
    for (const d of ["2020-01-02", "2020-01-03"])
      fs.writeFileSync(path.join(b, `${d}.json.gz`), "x");
    expect(auditDayCoverage([a, b])).toEqual([]);
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });

  test("totalMissingDays sums across runs", () => {
    seed(["2024-01-01", "2024-01-03", "2024-01-07"]);
    expect(totalMissingDays(auditDayCoverage([dir]))).toBe(4);
  });
});
