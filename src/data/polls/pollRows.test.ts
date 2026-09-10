import { describe, expect, it } from "vitest";
import { groupByPollSortedBySupport, latestPollPerAgency } from "./pollRows";

describe("groupByPollSortedBySupport", () => {
  it("groups rows by pollId, each group sorted by support descending", () => {
    const rows = [
      { pollId: "p1", support: 10 },
      { pollId: "p1", support: 40 },
      { pollId: "p2", support: 5 },
      { pollId: "p1", support: 25 },
    ];
    const m = groupByPollSortedBySupport(rows);
    expect([...m.keys()]).toEqual(["p1", "p2"]);
    expect(m.get("p1")?.map((r) => r.support)).toEqual([40, 25, 10]);
    expect(m.get("p2")?.map((r) => r.support)).toEqual([5]);
  });

  it("returns an empty map for an empty input", () => {
    expect(groupByPollSortedBySupport([]).size).toBe(0);
  });
});

describe("latestPollPerAgency", () => {
  it("keeps only the newest-fieldwork poll per agency", () => {
    const polls = [
      { agencyId: "GM", fieldwork: "Jan 01 2025" },
      { agencyId: "GM", fieldwork: "Jul 11 2026" },
      { agencyId: "TR", fieldwork: "Mar 01 2026" },
    ];
    const latest = latestPollPerAgency(polls);
    expect(latest).toHaveLength(2);
    expect(latest.find((p) => p.agencyId === "GM")?.fieldwork).toBe(
      "Jul 11 2026",
    );
  });

  it("orders the result newest-fieldwork-first across agencies", () => {
    const polls = [
      { agencyId: "TR", fieldwork: "Jan 01 2025" },
      { agencyId: "GM", fieldwork: "Jul 11 2026" },
    ];
    const latest = latestPollPerAgency(polls);
    expect(latest.map((p) => p.agencyId)).toEqual(["GM", "TR"]);
  });

  it("sorts an unreadable fieldwork last, never first", () => {
    const polls = [
      { agencyId: "A", fieldwork: "not a date" },
      { agencyId: "B", fieldwork: "Jul 11 2026" },
    ];
    const latest = latestPollPerAgency(polls);
    expect(latest.map((p) => p.agencyId)).toEqual(["B", "A"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(latestPollPerAgency([])).toEqual([]);
  });
});
