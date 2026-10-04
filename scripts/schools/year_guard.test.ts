import { describe, expect, test } from "vitest";
import { findSchoolYearLoss } from "./year_guard";

const idx = (dzi: string[], nvo: string[]) => ({
  schoolsByObshtina: {
    BGS01: [
      {
        scoresByYear: Object.fromEntries(dzi.map((y) => [y, {}])),
        nvoByYear: Object.fromEntries(nvo.map((y) => [y, {}])),
      },
    ],
  },
});

describe("findSchoolYearLoss", () => {
  test("a dropped ДЗИ year is reported (2022 rotated off data.egov.bg)", () => {
    expect(
      findSchoolYearLoss(
        idx(["2023", "2024"], ["2021"]),
        idx(["2022", "2023", "2024"], ["2021"]),
      ),
    ).toEqual([{ field: "ДЗИ", lostYears: [2022] }]);
  });

  test("НВО is checked independently", () => {
    expect(
      findSchoolYearLoss(
        idx(["2024"], ["2020"]),
        idx(["2024"], ["2019", "2020"]),
      ),
    ).toEqual([{ field: "НВО", lostYears: [2019] }]);
  });

  test("same or more years, or no committed file, is clean", () => {
    const base = idx(["2022"], ["2019"]);
    expect(findSchoolYearLoss(base, base)).toEqual([]);
    expect(findSchoolYearLoss(idx(["2022", "2027"], ["2019"]), base)).toEqual(
      [],
    );
    expect(findSchoolYearLoss(base, undefined)).toEqual([]);
  });
});
