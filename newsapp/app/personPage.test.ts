import { describe, expect, it } from "vitest";
import type { PersonIndexRow } from "./data";
import {
  filterRows,
  officeLine,
  periodOf,
  roleChanges,
  rowFigures,
} from "./personPage";

const labels = {
  mp: { bg: "Народен представител", en: "Member of Parliament" },
  cabinet: { bg: "Член на кабинета", en: "Cabinet member" },
};

describe("officeLine", () => {
  it("names every current office, once", () => {
    expect(
      officeLine(
        [
          { role: "cabinet", start: "2026-05-18", current: true },
          { role: "mp", start: "2026-04-19", current: true },
          { role: "mp", start: "2021-04-04", current: true },
        ],
        labels,
        false,
      ),
    ).toEqual({
      text: "Член на кабинета (от 2026) · Народен представител (от 2021)",
      former: false,
    });
  });

  it("marks the latest office FORMER when none is current", () => {
    expect(
      officeLine(
        [
          {
            role: "mp",
            start: "2021-04-04",
            end: "2022-08-01",
            current: false,
          },
        ],
        labels,
        true,
      ),
    ).toEqual({ text: "Member of Parliament (2021–2022)", former: true });
    expect(officeLine([], labels, false)).toBeNull();
  });
});

describe("periodOf", () => {
  it("matches the build's buckets", () => {
    expect(periodOf("2026-09-24", "day")).toBe("2026-09-24");
    // 2026-09-24 is a Thursday; its ISO week starts on Monday the 21st.
    expect(periodOf("2026-09-24", "week")).toBe("2026-09-21");
    expect(periodOf("2026-09-24", "month")).toBe("2026-09-01");
    expect(periodOf("nope", "day")).toBeNull();
  });
});

describe("roleChanges", () => {
  it("marks only starts and ends inside the plotted range", () => {
    const out = roleChanges(
      [
        { role: "cabinet", start: "2026-09-15", current: true },
        { role: "mp", start: "2021-04-04", end: "2026-09-30", current: false },
      ],
      ["2026-09-01", "2026-09-15", "2026-09-20"],
      "day",
      labels,
      false,
    );
    expect(out).toEqual([
      { period: "2026-09-15", text: "Член на кабинета: встъпва" },
    ]);
  });
});

describe("filterRows", () => {
  const rows = [
    { domain: "a.bg", bucket: "neutral", subject_role: "primary" },
    { domain: "b.bg", bucket: "unfavorable", subject_role: "secondary" },
  ] as never[];
  it("applies every set field and ignores the empty ones", () => {
    expect(filterRows(rows, { outlet: "a.bg" })).toHaveLength(1);
    expect(
      filterRows(rows, { bucket: "unfavorable", role: "secondary" }),
    ).toHaveLength(1);
    expect(filterRows(rows, {})).toHaveLength(2);
  });
});

describe("rowFigures", () => {
  const row = {
    n: 9,
    counts: { neutral: 9 },
    by_outlet: { "pik.bg": [3, 1, 2, 0, 0, 0] },
  } as unknown as PersonIndexRow;
  it("redraws a row for one outlet from its cell", () => {
    expect(rowFigures(row, "pik.bg")).toEqual({
      n: 3,
      counts: {
        strongly_unfavorable: 1,
        unfavorable: 2,
        neutral: 0,
        favorable: 0,
        strongly_favorable: 0,
      },
    });
    expect(rowFigures(row, "none.bg").n).toBe(0);
    expect(rowFigures(row, null).n).toBe(9);
  });
});
