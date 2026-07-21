import { describe, expect, it } from "vitest";
import { allocateSeats, hareQuota, TOTAL_SEATS } from "./seatAllocation";

describe("hareQuota", () => {
  it("hands leftover seats to the largest remainders and always sums to `seats`", () => {
    // 3 parties, 10 seats. quota = 100/10 = 10.
    // 47 -> 4.7, 33 -> 3.3, 20 -> 2.0  => 4+3+2 = 9, one seat left to .7 (party 0).
    expect(hareQuota([47, 33, 20], 10)).toEqual([5, 3, 2]);
  });

  it("hands the single leftover seat to the largest remainder", () => {
    // quota = 200/4 = 50. 90 -> 1.8, 60 -> 1.2, 50 -> 1.0. assigned 3, 1 left.
    // remainders .8/.2/.0 -> the .8 (index 0) wins.
    expect(hareQuota([90, 60, 50], 4)).toEqual([2, 1, 1]);
  });

  it("breaks an exact remainder tie by lower index", () => {
    // quota = 150/4 = 37.5. each 50 -> 1.333, all remainders equal (.333).
    // assigned 3, 1 left -> equal weights, so the lowest index takes it.
    expect(hareQuota([50, 50, 50], 4)).toEqual([2, 1, 1]);
  });

  it("returns all-zero for degenerate input", () => {
    expect(hareQuota([], 10)).toEqual([]);
    expect(hareQuota([1, 2, 3], 0)).toEqual([0, 0, 0]);
    expect(hareQuota([0, 0], 5)).toEqual([0, 0]);
  });
});

describe("allocateSeats", () => {
  // Official 19 April 2026 result: ПрБ 131, ГЕРБ-СДС 39, ПП-ДБ 37, ДПС 21,
  // Възраждане 12 (src/data/json/election_seats.json). The national Hare-Niemeyer
  // quota on the parties that cleared 4% reproduces it exactly.
  it("reproduces the official 2026 national seat allocation", () => {
    const rows = allocateSeats(
      [
        { partyNum: 21, nickName: "ПрБ", totalVotes: 1444920 },
        { partyNum: 15, nickName: "ГЕРБ-СДС", totalVotes: 433755 },
        { partyNum: 7, nickName: "ПП-ДБ", totalVotes: 408846 },
        { partyNum: 17, nickName: "ДПС", totalVotes: 230693 },
        { partyNum: 8, nickName: "Възраждане", totalVotes: 137940 },
      ],
      4,
    );
    const seatByNum = Object.fromEntries(
      rows.map((r) => [r.partyNum, r.seats]),
    );
    expect(seatByNum).toEqual({ 21: 131, 15: 39, 7: 37, 17: 21, 8: 12 });
    expect(rows.reduce((s, r) => s + r.seats, 0)).toBe(TOTAL_SEATS);
  });

  it("gives zero seats to parties below the threshold", () => {
    const rows = allocateSeats(
      [
        { partyNum: 1, totalVotes: 600000 },
        { partyNum: 2, totalVotes: 380000 },
        { partyNum: 3, totalVotes: 20000 }, // 2% -> below 4%
      ],
      4,
    );
    const below = rows.find((r) => r.partyNum === 3)!;
    expect(below.passedThreshold).toBe(false);
    expect(below.seats).toBe(0);
    expect(rows.reduce((s, r) => s + r.seats, 0)).toBe(TOTAL_SEATS);
  });
});
