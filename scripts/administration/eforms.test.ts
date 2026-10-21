// The pure halves of the еФорми ingest. The table shape is the thing worth pinning: reading
// counts out of a reordered table would publish one service's volume against another's name.

import { describe, expect, it } from "vitest";
import {
  EFORMS_HEADERS,
  droppedPeriods,
  parseEformsSnapshot,
  parseEformsTable,
  periodOfResourceName,
  serialiseEforms,
  type EformsSnapshot,
} from "./eforms";
import { resourceTable } from "../budget/lib/egov_api";

const H = [...EFORMS_HEADERS];

describe("periodOfResourceName", () => {
  it("reads the month the resource name ends with", () => {
    expect(
      periodOfResourceName(
        "Списък на заявените електронни административни услуги … еФорми( 2026-07 )",
      ),
    ).toBe("2026-07");
  });
  it("refuses a name with no month, or a month that does not exist", () => {
    expect(periodOfResourceName("Списък на заявените услуги")).toBeNull();
    expect(periodOfResourceName("… еФорми( 2026-13 )")).toBeNull();
  });
});

describe("resourceTable", () => {
  it("orders the {headers, rowN} shape numerically, not lexically", () => {
    expect(
      resourceTable({
        headers: H,
        row10: ["3", "в", "1"],
        row2: ["2", "б", "5"],
        row1: ["1", "а", "9"],
      }).map((r) => r[0]),
    ).toEqual([H[0], "1", "2", "3"]);
  });
  it("passes a 2D array through", () => {
    expect(resourceTable([H, ["1", "а", 9]])).toEqual([H, ["1", "а", "9"]]);
  });
});

describe("parseEformsTable", () => {
  it("reads rows, largest first", () => {
    expect(
      parseEformsTable([H, ["2", "б", "5"], ["1", "а", "9"]], "2026-07"),
    ).toEqual([
      { serviceId: "1", name: "а", requests: 9 },
      { serviceId: "2", name: "б", requests: 5 },
    ]);
  });
  it("throws on reordered headers rather than reading the wrong column", () => {
    expect(() =>
      parseEformsTable(
        [
          [H[0], H[2], H[1]],
          ["1", "9", "а"],
        ],
        "2026-07",
      ),
    ).toThrow(/headers/);
  });
  it("throws on a malformed count rather than skipping the row", () => {
    expect(() => parseEformsTable([H, ["1", "а", "n/a"]], "2026-07")).toThrow(
      /malformed/,
    );
  });
  it("sums a service listed twice in one month", () => {
    expect(
      parseEformsTable([H, ["1", "а", "2"], ["1", "а", "3"]], "2026-07"),
    ).toEqual([{ serviceId: "1", name: "а", requests: 5 }]);
  });
  it("refuses an empty month", () => {
    expect(() => parseEformsTable([H], "2026-07")).toThrow(/no rows/);
  });
});

describe("snapshot", () => {
  const snap: EformsSnapshot = {
    datasetId: 20218,
    datasetUri: "u",
    fetchedAt: "2026-10-21T00:00:00.000Z",
    months: [
      {
        period: "2026-06",
        resourceUri: "r6",
        updatedAt: "2026-07-01 05:30:21",
        rows: [{ serviceId: "1", name: "„а“", requests: 9 }],
      },
      {
        period: "2026-07",
        resourceUri: "r7",
        updatedAt: "2026-08-01 05:30:35",
        rows: [
          { serviceId: "1", name: "„а“", requests: 9 },
          { serviceId: "2", name: "б", requests: 5 },
        ],
      },
    ],
  };

  it("round-trips through the compact on-disk form, one row per line", () => {
    const text = serialiseEforms(snap);
    expect(parseEformsSnapshot(text)).toEqual(snap);
    expect(text.split("\n").filter((l) => l.startsWith("    ["))).toHaveLength(
      3,
    );
  });

  it("names a month that was published before and is absent now", () => {
    expect(droppedPeriods(snap.months, snap.months.slice(1))).toEqual([
      "2026-06",
    ]);
    expect(droppedPeriods(snap.months.slice(1), snap.months)).toEqual([]);
  });
});
