// Gates for the due watcher.
//
// This source is unusual: it probes nothing. Its whole value is the calendar
// arithmetic and the "still needed is not changed" distinction, so those are
// what the tests pin — a passing fingerprint proves very little here.

import { describe, it, expect } from "vitest";
import {
  PUBLICATION_LAG_DAYS,
  buildRequest,
  compareQuarters,
  coverageOf,
  expectedFilenames,
  fmtQuarter,
  municipalFiscalDue,
  newestDue,
  parseQuarter,
  quarterEndMs,
} from "./municipal_fiscal_due";

const at = (iso: string) => newestDue(Date.parse(iso));

describe("parseQuarter / fmtQuarter", () => {
  it("round-trips the index.json period format", () => {
    expect(parseQuarter("2025-Q3")).toEqual({ year: 2025, q: 3 });
    expect(fmtQuarter({ year: 2025, q: 3 })).toBe("2025-Q3");
  });

  it("rejects anything that is not a period", () => {
    for (const bad of ["", "2025", "2025-Q5", "25-Q1", "2025Q3", "abc"]) {
      expect(parseQuarter(bad)).toBeNull();
    }
  });
});

describe("newestDue", () => {
  it("names the newest quarter that has CLOSED, one lag ago", () => {
    // 90 days back from each date, then the last quarter to have finished.
    expect(fmtQuarter(at("2026-08-13"))).toBe("2026-Q1"); // -90d → mid-May, Q2
    expect(fmtQuarter(at("2026-04-10"))).toBe("2025-Q4"); // -90d → mid-Jan, Q1
    expect(fmtQuarter(at("2025-11-20"))).toBe("2025-Q2"); // -90d → late Aug, Q3
  });

  it("rolls the YEAR back when the lag lands in Q1", () => {
    // The off-by-one this exists to prevent: with the lag landing in Q1, the
    // newest closed quarter is the PREVIOUS year's Q4, not this year's Q0.
    expect(fmtQuarter(at("2026-01-05"))).toBe("2025-Q3"); // -90d → early Oct
    expect(fmtQuarter(at("2026-04-10"))).toBe("2025-Q4"); // -90d → mid-Jan
  });

  it("does not call a quarter due until the lag has fully elapsed", () => {
    // The boundary, stated because it is easy to get wrong by a day in either
    // direction. Q4-2025 closes 2025-12-31; 90 days later is 2026-03-31, and on
    // that date the lag has only just been reached — `now - lag` is still
    // 2025-12-31, inside Q4, so Q4 has not closed by then.
    expect(fmtQuarter(at("2026-03-31"))).toBe("2025-Q3");
    expect(fmtQuarter(at("2026-04-01"))).toBe("2025-Q4");
  });

  it("moves with the lag rather than hard-coding it", () => {
    const iso = "2026-05-01";
    expect(fmtQuarter(newestDue(Date.parse(iso), 0))).toBe("2026-Q1");
    expect(fmtQuarter(newestDue(Date.parse(iso), 200))).toBe("2025-Q3");
    expect(PUBLICATION_LAG_DAYS).toBeGreaterThan(0);
  });
});

describe("quarterEndMs", () => {
  it("lands on the last instant of the quarter, not the first of the next", () => {
    expect(new Date(quarterEndMs({ year: 2025, q: 1 })).toISOString()).toBe(
      "2025-03-31T23:59:59.999Z",
    );
    expect(new Date(quarterEndMs({ year: 2025, q: 4 })).toISOString()).toBe(
      "2025-12-31T23:59:59.999Z",
    );
  });
});

describe("compareQuarters", () => {
  it("orders across a year boundary", () => {
    expect(
      compareQuarters({ year: 2024, q: 4 }, { year: 2025, q: 1 }),
    ).toBeLessThan(0);
    expect(
      compareQuarters({ year: 2025, q: 3 }, { year: 2025, q: 2 }),
    ).toBeGreaterThan(0);
    expect(compareQuarters({ year: 2025, q: 2 }, { year: 2025, q: 2 })).toBe(0);
  });
});

const cov = (newest: string | null, gaps: string[] = []) => ({
  newest: newest ? parseQuarter(newest) : null,
  gaps: gaps.map((g) => parseQuarter(g)!),
  unreadable: false,
});

describe("coverageOf", () => {
  it("finds the holes between the oldest and newest held quarter", () => {
    // Not hypothetical: the committed corpus is missing 2024-Q1 and 2025-Q1
    // today, so once the newest catches up a two-quarter hole would otherwise
    // read as „up to date".
    const c = coverageOf([
      "2024-Q2",
      "2024-Q3",
      "2024-Q4",
      "2025-Q2",
      "2025-Q3",
    ]);
    expect(fmtQuarter(c.newest!)).toBe("2025-Q3");
    expect(c.gaps.map(fmtQuarter)).toEqual(["2025-Q1"]);
  });

  it("crosses a year boundary when walking the series", () => {
    expect(coverageOf(["2024-Q3", "2025-Q2"]).gaps.map(fmtQuarter)).toEqual([
      "2024-Q4",
      "2025-Q1",
    ]);
  });

  it("reports no gaps for a contiguous or single-quarter series", () => {
    expect(coverageOf(["2025-Q1", "2025-Q2", "2025-Q3"]).gaps).toEqual([]);
    expect(coverageOf(["2025-Q3"]).gaps).toEqual([]);
    expect(coverageOf([]).newest).toBeNull();
  });
});

describe("buildRequest", () => {
  it("asks when the corpus is behind, naming both quarters", () => {
    const r = buildRequest(cov("2025-Q3"), { year: 2026, q: 1 });
    expect(r).not.toBeNull();
    expect(r!.instruction).toContain("2026-Q1");
    expect(r!.instruction).toContain("2025-Q3");
    expect(r!.dropDir).toBe("data/_cache/minfin_municipal_fiscal");
    expect(r!.files?.length).toBeGreaterThan(0);
  });

  it("stays silent when the corpus is level or ahead AND has no holes", () => {
    // Ahead is reachable: the operator may ingest a release before the lag has
    // elapsed, and that is not a reason to keep asking for it.
    expect(buildRequest(cov("2026-Q1"), { year: 2026, q: 1 })).toBeNull();
    expect(buildRequest(cov("2026-Q2"), { year: 2026, q: 1 })).toBeNull();
  });

  it("still asks when the newest is current but the middle has a hole", () => {
    const r = buildRequest(cov("2026-Q1", ["2025-Q2"]), { year: 2026, q: 1 });
    expect(r).not.toBeNull();
    expect(r!.instruction).toContain("2025-Q2");
  });

  it("asks distinctly when nothing has been ingested at all", () => {
    const r = buildRequest(cov(null), { year: 2026, q: 1 });
    expect(r!.instruction).toMatch(/corpus is empty/);
  });

  it("does not claim an empty corpus when the index is merely unreadable", () => {
    // The two states need different instructions: sending someone to
    // re-download five quarters they already hold is a wasted afternoon.
    const r = buildRequest(
      { newest: null, gaps: [], unreadable: true },
      { year: 2026, q: 1 },
    );
    expect(r!.instruction).toMatch(/unreadable/);
    expect(r!.instruction).not.toMatch(/corpus is empty/);
  });
});

describe("expectedFilenames", () => {
  it("builds the release name from the PREVIOUS year's Q4 as the middle column", () => {
    // The rule that makes one file per year enough: a release's middle column
    // is always the prior year's year-end.
    expect(expectedFilenames({ year: 2026, q: 1 })[0]).toBe(
      "1. quarterly-reports-Q12025-Q42025-Q12026-website.xlsx",
    );
  });

  it("collapses the middle segment for a Q4 release", () => {
    // A Q4 release has only TWO periods — the prior year's Q4 is already the
    // „prev" column. All six Q4 workbooks in the drop directory are that shape,
    // and Q4 is the due quarter for a 90-day window every year, so emitting
    // Q42025-Q42025-Q42026 would name a file that has never existed.
    for (const n of expectedFilenames({ year: 2026, q: 4 })) {
      expect(n).toContain("Q42025-Q42026");
      expect(n).not.toContain("Q42025-Q42025");
    }
  });

  it("offers both naming conventions, newest first", () => {
    // МФ has changed the convention at least twice (hyphens and a „1. " prefix
    // from 2024, spaces and no prefix before). Both are guesses — the parser
    // reads periods from the workbook's header row, never from the name.
    const names = expectedFilenames({ year: 2026, q: 1 });
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^1\. quarterly-reports-/);
    expect(
      names.slice(1).every((n) => n.startsWith("quarterly reports ")),
    ).toBe(true);
  });
});

describe("the source itself", () => {
  it("declares a probe cadence that samples its publication period twice", () => {
    // cadence.test.ts enforces this globally; asserted here too because a
    // quarterly source checked quarterly would miss releases by construction.
    expect(municipalFiscalDue.publishes).toBe("quarterly");
    expect(municipalFiscalDue.cadence).toBe("weekly");
  });

  it("answers manualRequest without a fingerprint", async () => {
    // The property that lets it fire on the off-cadence and error paths, where
    // nothing was fetched. If this needed `curr` it would go quiet exactly on
    // the runs where the corpus is most likely to be stale.
    expect(() => municipalFiscalDue.manualRequest?.(null, null)).not.toThrow();
  });

  it("moves its fingerprint on ingest or a new due quarter, not on waiting", async () => {
    // „Still needed" must not read as „changed": a request that re-fired daily
    // would be indistinguishable from noise within a week.
    // Stable across consecutive runs — waiting is not a change.
    const a = await municipalFiscalDue.fingerprint();
    const b = await municipalFiscalDue.fingerprint();
    expect(a.value).toBe(b.value);
    // …and the value genuinely carries BOTH sides plus the gap list, so an
    // ingest, a newly-due quarter, or a filled hole each move it. A mutation to
    // `${due}|${due}` would satisfy a shape-only regex, so assert the held part
    // matches what the corpus actually reports.
    const [held, due, gaps] = a.value.split("|");
    expect(held).toBe(a.meta?.held);
    expect(due).toBe(a.meta?.due);
    expect(gaps).toBe((a.meta?.gaps as string[]).join(","));
    expect(held).not.toBe(due); // the corpus is behind today
  });
});
