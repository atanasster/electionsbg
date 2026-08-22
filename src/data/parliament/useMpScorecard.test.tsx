// The scorecard's ATTENDANCE metric, and the denominator it divides by.
//
// A member's presence rate is measured over the items they were SEATED for — present or
// absent — never over the chamber's item count. The two coincide only for a member who sat
// the whole term, and the site publishes the difference under one word beside a named
// person: Иван Демерджиев left the 52nd's benches for a ministry after 32 items and cast 17
// of them, which is 53.1% and was rendered as **1.4%**.
//
// The old code computed `loyalty.votesCast / slice.totalVoteItems`, which cannot express the
// seated window at all — the loyalty artifact carries no per-MP denominator, so the only
// divisor within reach was the wrong one. These tests assert the fix on both source paths
// (the per-MP shard, and the attendance aggregate the shard-miss path falls back to) and
// pin the numbers to Демерджиев's real shard, so a regression reads as the figure that
// shipped rather than as an abstract ratio.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  AttendanceEntry,
  LoyaltyEntry,
} from "@/data/parliament/votes/types";

const loyaltyHook = vi.fn();
const attendanceHook = vi.fn();

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
// Mutable so a test can put the member OUTSIDE the selected parliament, which is what
// drives `servedInSelectedNs` and therefore whether the roll-call hooks fetch at all.
let nsFolders = ["52"];
vi.mock("@/data/candidates/CandidateMpContext", () => ({
  useMpEntryForName: () => ({
    entry: { nsFolders },
    id: 3996,
    isLoading: false,
  }),
}));
vi.mock("./useMpAssets", () => ({
  useMpAssets: () => ({ rollup: undefined, isLoading: false }),
}));
vi.mock("./votes/useMpLoyalty", () => ({
  useMpLoyalty: (...args: unknown[]) => loyaltyHook(...args),
}));
vi.mock("./votes/useAttendance", () => ({
  useAttendance: (...args: unknown[]) => attendanceHook(...args),
  ATTENDANCE_MIN_ITEMS: 30,
}));

import { useMpScorecard } from "./useMpScorecard";

// The 52nd's real numbers for mp 3996 (data/parliament/votes/derived/per-mp/52/3996.json).
const CHAMBER_ITEMS = 1198;
const SEATED_ITEMS = 32;
const CAST = 17;
const SEATED_PCT = CAST / SEATED_ITEMS; // 0.53125
const CHAMBER_PCT = CAST / CHAMBER_ITEMS; // 0.0141902… — what used to be published

const loyaltyEntry: LoyaltyEntry = {
  mpId: 3996,
  partyShort: "ПБ",
  votesCast: CAST,
  withParty: CAST,
  loyaltyPct: 1,
};

// The window the loyalty route reports for the parliament.
const loyaltyFile = {
  windowFrom: "2026-04-30",
  windowTo: "2026-07-31",
  totalVoteItems: CHAMBER_ITEMS,
  entries: [],
};

// The chamber medians /api/db/mp-loyalty returns beside the member's own figures — the
// `cohort` block the retired per-MP shard used to carry.
const cohort = {
  size: 268,
  votesCastMedian: 913.5,
  loyaltyPctMedian: 0.971,
  presentPctMedian: 0.7625208681135225,
};

const attendanceEntry = (
  mpId: number,
  totalItems: number,
  presentCount: number,
): AttendanceEntry => ({
  mpId,
  partyShort: "ПБ",
  totalItems,
  presentCount,
  absentCount: totalItems - presentCount,
  presentPct: totalItems === 0 ? 0 : presentCount / totalItems,
});

const setLoyalty = (over: Record<string, unknown> = {}) =>
  loyaltyHook.mockReturnValue({
    entry: loyaltyEntry,
    entries: [],
    file: loyaltyFile,
    cohort,
    isLoading: false,
    ...over,
  });

const setAttendance = (entries: AttendanceEntry[]) =>
  attendanceHook.mockImplementation((enabled = true) => ({
    file: undefined,
    slice: undefined,
    ns: "52",
    entries,
    byMpId: new Map(entries.map((e) => [e.mpId, e])),
    isLoading: false,
    enabled,
  }));

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const run = () =>
  renderHook(() => useMpScorecard("ИВАН ПЕТЕВ ДЕМЕРДЖИЕВ"), { wrapper }).result
    .current.scorecard;

beforeEach(() => {
  nsFolders = ["52"];
  loyaltyHook.mockReset();
  attendanceHook.mockReset();
  // Two small /api/db calls fire for the other two metrics; keep them off the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, headers: { get: () => "" } })),
  );
});

describe("useMpScorecard — attendance denominator", () => {
  it("divides by the seated window, not by the chamber's item count", () => {
    setLoyalty();
    setAttendance([attendanceEntry(3996, SEATED_ITEMS, CAST)]);
    const sc = run();
    expect(sc.attendance.value).toBeCloseTo(SEATED_PCT, 10);
    expect(sc.attendanceItems).toBe(SEATED_ITEMS);
    // The regression, named: 17/1198. Without this the assertion above would also pass a
    // hook that returned the chamber rate on some other MP's numbers.
    expect(sc.attendance.value).not.toBeCloseTo(CHAMBER_PCT, 3);
  });

  it("falls back to the route's cohort median when no sample is loaded", () => {
    // /api/db/mp-loyalty returns the chamber medians beside the member's own figures, so a
    // page that has not (yet) loaded the attendance ENTRIES still has a median to show
    // against. Preferring the local sample when it exists is what keeps the median and the
    // rank beside it over one population.
    setLoyalty();
    setAttendance([]);
    const sc = run();
    expect(sc.attendance.median).toBeCloseTo(0.7625208681135225, 10);
  });

  // The `enabled` assertions this file used to carry ("never fetches the aggregate") went
  // with the shard. Their replacement is the gate that still matters: useAttendance must be
  // OFF for a member who did not serve in the selected parliament — there is no attendance
  // record to show, and firing the request would put a chamber's numbers behind a page that
  // has no member in it.
  it("does not query attendance for a member who did not serve this term", () => {
    nsFolders = ["49"]; // seated in the 49th, page viewed under the 52nd
    setLoyalty();
    setAttendance([]);
    run();
    expect(attendanceHook).toHaveBeenCalledWith(false);
    nsFolders = ["52"];
  });

  it("reports no rank when the cohort sample was never loaded", () => {
    // The route supplies a cohort MEDIAN without a cohort SAMPLE, so the rank basis is `[]`.
    // An empty cohort is unrankable — `rank: 1` beside `cohortSize: 268` reads as "#1 of
    // 268" for every member of the chamber, and ScorecardMetric.rank promises null.
    setLoyalty();
    setAttendance([]);
    const sc = run();
    expect(sc.attendance.rank).toBeNull();
    expect(sc.loyalty.rank).toBeNull();
  });

  it("ranks on the rate, over the attendance entries", () => {
    setLoyalty({ entries: [loyaltyEntry] });
    setAttendance([
      attendanceEntry(3996, SEATED_ITEMS, CAST), // 53.1%
      attendanceEntry(4001, CHAMBER_ITEMS, 1100), // 91.8%
      attendanceEntry(4002, CHAMBER_ITEMS, 700), // 58.4%
    ]);
    const sc = run();
    expect(attendanceHook).toHaveBeenCalledWith(true);
    expect(sc.attendance.value).toBeCloseTo(SEATED_PCT, 10);
    expect(sc.attendanceItems).toBe(SEATED_ITEMS);
    // Ranked on the RATE. On votesCast — the old ordering — 17 would rank last of three;
    // on presentPct 53.1% is third of three here too, so the discriminating assertion is
    // the median, which the two orderings disagree about.
    expect(sc.attendance.rank).toBe(3);
    expect(sc.attendance.cohortSize).toBe(3);
    expect(sc.attendance.median).toBeCloseTo(700 / CHAMBER_ITEMS, 10);
  });

  it("reports no attendance at all when neither source carries it", () => {
    // A dash under a confident label is the thing the scorecard exists not to print: the
    // metric must be ABSENT, not zero, when the seated window is unknown.
    setLoyalty({ entries: [loyaltyEntry], cohort: undefined });
    setAttendance([]);
    const sc = run();
    expect(sc.attendance.value).toBeNull();
    expect(sc.attendanceItems).toBeNull();
  });
});
