import { describe, expect, it } from "vitest";
import { foldOffices, type OfficeRole } from "./offices";

const mp = (start: string | null, end: string | null): OfficeRole => ({
  source: "mp",
  role: "mp",
  placeCode: "SML",
  start,
  end,
  dateBasis: "term",
});

describe("foldOffices", () => {
  it("keeps only office-bearing sources", () => {
    const kept = foldOffices([
      { source: "mp", role: "mp", placeCode: "SML" },
      { source: "local", role: "mayor", placeCode: "BLG11" },
      { source: "magistrate", role: "magistrate", placeCode: "rs-sofiya" },
      { source: "official_muni", role: "chief_architect", placeCode: "HKV11" },
      // Not offices: a company-officer link and a candidacy have no term.
      { source: "tr", role: "manager", placeCode: null },
      { source: "candidate", role: "candidate", placeCode: null },
      { source: "donor", role: "donor", placeCode: null },
    ]);
    expect(kept.map((r) => r.source)).toEqual([
      "mp",
      "local",
      "magistrate",
      "official_muni",
    ]);
  });

  it("folds CONSECUTIVE terms into one span rather than naming one term", () => {
    // The defect this exists for: nine terms collapse to one row, and before the merge the
    // row carried whichever term the payload happened to put first. These three abut (a
    // term ends the day before the next begins), so they are one continuous stretch.
    const [office] = foldOffices([
      mp("2021-04-04", "2021-07-10"),
      mp("2017-03-26", "2021-04-03"),
      mp("2021-07-11", "2026-04-18"),
    ]);
    expect(office.spans).toEqual([{ start: "2017-03-26", end: "2026-04-18" }]);
  });

  it("does NOT bridge a real absence from the office", () => {
    // 1,675 people in the corpus hold a local seat across a gap. Merging to one span said
    // "since 2007" for a village mayor who served 2007-2011 and returned in 2025.
    const [office] = foldOffices([
      {
        source: "local",
        role: "village_mayor",
        placeCode: "53727",
        start: "2007-10-28",
        end: "2011-10-23",
        dateBasis: "election",
      },
      {
        source: "local",
        role: "village_mayor",
        placeCode: "53727",
        start: "2025-06-15",
        end: null,
        dateBasis: "election",
      },
    ]);
    expect(office.spans).toEqual([
      { start: "2007-10-28", end: "2011-10-23" },
      { start: "2025-06-15", end: null },
    ]);
  });

  it("treats an abutting local re-election as continuous", () => {
    // A local mandate's end IS the next election's date, so a re-elected mayor is one run.
    const [office] = foldOffices([
      {
        source: "local",
        role: "mayor",
        placeCode: "BLG11",
        start: "2019-10-27",
        end: "2023-10-29",
        dateBasis: "election",
      },
      {
        source: "local",
        role: "mayor",
        placeCode: "BLG11",
        start: "2023-10-29",
        end: null,
        dateBasis: "election",
      },
    ]);
    expect(office.spans).toEqual([{ start: "2019-10-27", end: null }]);
  });

  it("leaves the end OPEN when the latest term is still running", () => {
    // max()-ing the ends would retire a sitting member on their own profile.
    const [office] = foldOffices([
      mp("2021-04-04", "2026-04-18"),
      mp("2026-04-19", null),
      mp("2017-03-26", "2021-04-03"),
    ]);
    expect(office.spans).toEqual([{ start: "2017-03-26", end: null }]);
  });

  it("does not let a wholly undated row open or extend a run", () => {
    // A row with neither date says nothing about whether the seat is current.
    const [office] = foldOffices([
      mp("2024-10-27", "2026-04-18"),
      mp(null, null),
    ]);
    expect(office.spans).toEqual([{ start: "2024-10-27", end: "2026-04-18" }]);
  });

  it("never merges spans of different bases", () => {
    // A mandate bound and a declaration's filing date are different measurements; merging
    // them is the conflation date_basis exists to prevent.
    const [office] = foldOffices([
      {
        source: "official_muni",
        role: "chief_architect",
        placeCode: "HKV11",
        start: "2025-01-07",
        end: null,
        dateBasis: "filing",
      },
      {
        source: "local",
        role: "chief_architect",
        placeCode: "HKV11",
        start: "2015-10-25",
        end: "2019-10-27",
        dateBasis: "election",
      },
    ]);
    expect(office.dateBasis).toBe("filing");
    expect(office.spans).toEqual([{ start: "2025-01-07", end: null }]);
  });

  it("dedupes one seat recorded by two sources", () => {
    // A councillor appears in BOTH the local results and the officials roster.
    const kept = foldOffices([
      { source: "local", role: "councillor", placeCode: "BLG11" },
      { source: "official_muni", role: "councillor", placeCode: "BLG11" },
    ]);
    expect(kept).toHaveLength(1);
  });

  it("does not merge two place-LESS seats from different sources", () => {
    // Two seats we cannot locate are not evidence of being the same seat.
    const kept = foldOffices([
      { source: "official_exec", role: "official", placeCode: null },
      { source: "public_sector", role: "official", placeCode: null },
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps distinct seats distinct", () => {
    const kept = foldOffices([
      { source: "local", role: "mayor", placeCode: "BLG11" },
      { source: "local", role: "mayor", placeCode: "SML01" },
      { source: "local", role: "councillor", placeCode: "BLG11" },
    ]);
    expect(kept).toHaveLength(3);
  });

  it("carries a single term through as one span", () => {
    const only = mp("2026-04-19", null);
    const [office] = foldOffices([only]);
    expect(office.spans).toEqual([{ start: "2026-04-19", end: null }]);
    expect(office.source).toBe("mp");
  });

  it("contributes no dates when the representative has no basis", () => {
    const rows: OfficeRole[] = [
      {
        source: "mp",
        role: "mp",
        placeCode: "SML",
        start: "2024-10-27",
        end: null,
      },
    ];
    const [office] = foldOffices(rows);
    expect(office.spans).toEqual([]);
    expect(office.dateBasis).toBeUndefined();
  });
});
