// The invariant two serving surfaces now rest on: every shard carries an `attendance`
// block, and every shard carries `cohort.presentPctMedian`.
//
// `useMpScorecard` and `MpVotingTile` both read the seated denominator out of the shard and
// fall back to attendance.json only when it is absent — so the day a shard regenerates
// without the block, the cost is a wasted 43 KB download on that member's page rather than
// a wrong number. That fallback is untested against real pipeline output; this is the gate
// that says the healthy path stays the healthy path.
//
// The second test is the one that matters more: an MP the attendance pass did not see must
// get NO block rather than a fabricated 0%, because a fabricated rate is exactly the class
// of defect this whole area was fixed for.

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeMpShards } from "./per_mp_shards";
import type { LoyaltyOutput } from "./loyalty";
import type { AttendanceOutput } from "./attendance";
import type { SimilarityOutput } from "./similarity";
import type { DissentOutput } from "./dissents";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mp-shards-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

// Three members with the shape the 52nd actually holds: one full-term, one who gave up the
// bench for a ministry after 32 items, one sworn in for a single sitting day.
const MPS = [
  { mpId: 3996, totalItems: 32, present: 17, cast: 17 },
  { mpId: 4001, totalItems: 1198, present: 1088, cast: 1088 },
  { mpId: 4167, totalItems: 1, present: 0, cast: 0 },
];

const loyalty = (ids = MPS): LoyaltyOutput => ({
  computedAt: "2026-08-11T18:25:58.006Z",
  windowFrom: "2026-04-30",
  windowTo: "2026-07-31",
  totalVoteItems: 1198,
  entries: ids.map((m) => ({
    mpId: m.mpId,
    partyShort: "ПБ",
    votesCast: m.cast,
    withParty: m.cast,
    loyaltyPct: 1,
  })),
});

const attendance = (ids = MPS): AttendanceOutput => ({
  computedAt: "2026-08-11T18:25:58.006Z",
  windowFrom: "2026-04-30",
  windowTo: "2026-07-31",
  totalVoteItems: 1198,
  entries: ids.map((m) => ({
    mpId: m.mpId,
    partyShort: "ПБ",
    totalItems: m.totalItems,
    presentCount: m.present,
    absentCount: m.totalItems - m.present,
    presentPct: m.totalItems === 0 ? 0 : m.present / m.totalItems,
  })),
});

const empty = { computedAt: "", windowFrom: "", windowTo: "", entries: [] };
const run = (l: LoyaltyOutput, a: AttendanceOutput) => {
  const dir = tmp();
  writeMpShards(dir, {
    ns: "52",
    loyalty: l,
    attendance: a,
    similarity: empty as unknown as SimilarityOutput,
    dissents: empty as unknown as DissentOutput,
  });
  const out = path.join(dir, "per-mp", "52");
  return fs
    .readdirSync(out)
    .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
};

describe("writeMpShards", () => {
  it("gives every shard an attendance block and a cohort presentPctMedian", () => {
    const shards = run(loyalty(), attendance());
    expect(shards).toHaveLength(MPS.length);
    for (const s of shards) {
      expect(
        s.attendance,
        `mp ${s.mpId} has no attendance block`,
      ).toBeDefined();
      expect(s.attendance.totalItems).toBeGreaterThan(0);
      expect(s.cohort?.presentPctMedian).toBeDefined();
    }
    // The seated denominator itself, not merely its presence: 17 of 32 is the number the
    // profile publishes, and 17/1198 is the one it used to.
    const dem = shards.find((s) => s.mpId === 3996);
    expect(dem.attendance.totalItems).toBe(32);
    expect(dem.attendance.presentPct).toBeCloseTo(17 / 32, 10);
    expect(dem.loyalty.totalVoteItems).toBe(1198);
  });

  it("omits the block rather than inventing a rate for an MP attendance never saw", () => {
    // Loyalty is the roster that decides which shards exist, so an attendance pass that
    // missed someone still produces their shard. `attendance: undefined` is the honest
    // output — a zeroed block would publish "0% present" for a member nothing measured,
    // and the serving side treats absence as "ask attendance.json" rather than as a value.
    const shards = run(loyalty(), attendance(MPS.slice(1)));
    const missing = shards.find((s) => s.mpId === 3996);
    expect(missing).toBeDefined();
    expect(missing.attendance).toBeUndefined();
    // Non-vacuity: the other two still carry theirs, so this is not passing because the
    // writer stopped emitting the block for everyone.
    expect(shards.filter((s) => s.attendance).length).toBe(2);
  });

  it("takes the cohort median over presentPct, not over the chamber-relative rate", () => {
    // 53.125% / 90.8% / 0% → median 53.125%. Under the retired formulation (votesCast over
    // the chamber's 1,198) the same three are 1.4% / 90.8% / 0%, median 1.4%.
    const shards = run(loyalty(), attendance());
    expect(shards[0].cohort.presentPctMedian).toBeCloseTo(17 / 32, 10);
  });
});
