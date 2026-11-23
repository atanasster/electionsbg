import { describe, expect, it } from "vitest";
import {
  dailyLinesToAppend,
  fluLinesToAppend,
  lastIncidenceWeek,
  lastShortageWindow,
  missedAShortageWindow,
  missedAWeek,
  shortageLinesToAppend,
  type DailyLine,
} from "./snapshot";
import type { HisReport, IncidenceWeek, ShortageList } from "./sources";

const report = (flu: number, updated = "2026-11-23T09:05:00"): HisReport => ({
  year: 2026,
  updatedAt: [updated],
  total: flu,
  byVaccine: [
    {
      label: "Грип / Influenza",
      labelBg: "Грип",
      labelEn: "Influenza",
      n: flu,
    },
  ],
  byDistrict: [{ iso: "BG-01", n: flu }],
});

describe("dailyLinesToAppend", () => {
  it("records only counters that moved", () => {
    const first = dailyLinesToAppend([], report(1000), "t1");
    expect(first).toHaveLength(2);
    expect(dailyLinesToAppend(first, report(1000), "t2")).toEqual([]);
    const moved = dailyLinesToAppend(first, report(1010), "t3");
    expect(moved.map((l) => l.n_ytd)).toEqual([1010, 1010]);
  });
  it("accepts a small revision downwards but refuses a collapse", () => {
    const first: DailyLine[] = dailyLinesToAppend([], report(100_000), "t1");
    expect(dailyLinesToAppend(first, report(99_000), "t2")).toHaveLength(2);
    expect(() => dailyLinesToAppend(first, report(50_000), "t2")).toThrow(
      /refusing/,
    );
  });
});

const list = (validFrom: string, codes: string[]): ShortageList => ({
  validFrom,
  validTo: validFrom,
  rows: codes.map((c) => ({
    ncprCode: c,
    name: c,
    inn: "",
    strength: "",
    unit: "",
    form: "",
    pack: "",
    isVaccine: false,
  })),
});

describe("shortageLinesToAppend", () => {
  it("re-captures a window only when its list changed, removals included", () => {
    const a = shortageLinesToAppend([], list("2026-11-20", ["1", "2"]), "t1");
    expect(
      shortageLinesToAppend(a, list("2026-11-20", ["2", "1"]), "t2"),
    ).toEqual([]);
    expect(
      shortageLinesToAppend(a, list("2026-11-20", ["1", "2", "3"]), "t2").map(
        (l) => l.ncpr_code,
      ),
    ).toEqual(["1", "2", "3"]);
    const dropped = shortageLinesToAppend(a, list("2026-11-20", ["1"]), "t2");
    expect(dropped.map((l) => l.ncpr_code)).toEqual(["1"]);
    // Once the drop is recorded, the same reduced list is not appended again.
    expect(
      shortageLinesToAppend(
        [...a, ...dropped],
        list("2026-11-20", ["1"]),
        "t3",
      ),
    ).toEqual([]);
    expect(
      shortageLinesToAppend(a, list("2026-11-27", ["1"]), "t2"),
    ).toHaveLength(1);
    expect(lastShortageWindow(a)).toEqual({
      valid_from: "2026-11-20",
      valid_to: "2026-11-20",
    });
  });
});

const week = (weekStart: string, cases: number): IncidenceWeek => ({
  isoWeek: 47,
  weekStart,
  weekEnd: weekStart,
  rows: [
    {
      area: "Общо за страната",
      isNational: true,
      served: [1],
      cases: [cases],
      rate: [1],
    },
  ],
});

describe("fluLinesToAppend", () => {
  it("appends new weeks and revisions, not unchanged repeats", () => {
    const a = fluLinesToAppend([], [week("2026-11-16", 10)], [], "t1");
    expect(a).toHaveLength(1);
    expect(fluLinesToAppend(a, [week("2026-11-16", 10)], [], "t2")).toEqual([]);
    expect(
      fluLinesToAppend(a, [week("2026-11-16", 12)], [], "t2"),
    ).toHaveLength(1);
    expect(lastIncidenceWeek(a)).toBe("2026-11-16");
  });
});

describe("missedAWeek", () => {
  it("is false when the next week is still on show, true when it fell off", () => {
    expect(missedAWeek(null, "2026-11-16")).toBe(false);
    expect(missedAWeek("2026-11-09", "2026-11-16")).toBe(false);
    expect(missedAWeek("2026-11-02", "2026-11-16")).toBe(true);
  });
});

describe("missedAShortageWindow", () => {
  it("tolerates a shifted window but not a skipped one", () => {
    expect(missedAShortageWindow("2026-11-26", "2026-11-27")).toBe(false);
    expect(missedAShortageWindow("2026-11-26", "2026-11-29")).toBe(false);
    expect(missedAShortageWindow("2026-11-26", "2026-12-04")).toBe(true);
  });
});
