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

  it("folds a multi-term office into ONE span rather than naming one term", () => {
    // The defect this exists for: nine terms collapse to one row, and before the merge the
    // row carried whichever term the payload happened to put first.
    const [office] = foldOffices([
      mp("2024-10-27", "2026-04-18"),
      mp("2017-03-26", "2021-04-03"),
      mp("2021-04-04", "2021-07-10"),
    ]);
    expect(office.start).toBe("2017-03-26");
    expect(office.end).toBe("2026-04-18");
  });

  it("leaves the end OPEN when any term in the group is still running", () => {
    // max()-ing the ends would retire a sitting member on their own profile.
    const [office] = foldOffices([
      mp("2024-10-27", "2026-04-18"),
      mp("2026-04-19", null),
      mp("2017-03-26", "2021-04-03"),
    ]);
    expect(office.start).toBe("2017-03-26");
    expect(office.end).toBeNull();
  });

  it("does not treat a wholly undated row as an open term", () => {
    // A row with neither date says nothing about whether the seat is current.
    const [office] = foldOffices([
      mp("2024-10-27", "2026-04-18"),
      mp(null, null),
    ]);
    expect(office.end).toBe("2026-04-18");
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
    expect(office.start).toBe("2025-01-07");
    expect(office.end).toBeNull();
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

  it("returns the representative untouched when the merge changes nothing", () => {
    // Identity preserved so React keys and referential equality are stable for the common
    // single-term case.
    const only = mp("2026-04-19", null);
    expect(foldOffices([only])[0]).toBe(only);
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
    expect(office.start).toBe("2024-10-27");
    expect(office.dateBasis).toBeUndefined();
  });
});
