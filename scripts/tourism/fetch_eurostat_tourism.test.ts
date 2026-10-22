import { describe, expect, it } from "vitest";
import { buildAnnualNights } from "./fetch_eurostat_tourism";

const m = (rows: [number, number][]) => new Map(rows);

describe("buildAnnualNights", () => {
  it("keeps every year from 2013 with total = domestic + foreign", () => {
    const years = [2013, 2014, 2015, 2016, 2017];
    const rows = buildAnnualNights(
      m(years.map((y) => [y, 30])),
      m(years.map((y) => [y, 10])),
      m(years.map((y) => [y, 20])),
    );
    expect(rows.map((r) => r.year)).toEqual(years);
    expect(rows[0]).toEqual({
      year: 2013,
      total: 30,
      domestic: 10,
      foreign: 20,
    });
  });
  it("ignores the gappy pre-2013 years", () => {
    const years = [2013, 2014, 2015, 2016, 2017];
    const rows = buildAnnualNights(
      m([[1990, 99], ...years.map((y): [number, number] => [y, 3])]),
      m(years.map((y) => [y, 1])),
      m([[1990, 50], ...years.map((y): [number, number] => [y, 2])]),
    );
    expect(rows[0].year).toBe(2013);
  });
  it("refuses a hole inside the range rather than plotting a collapse", () => {
    const years = [2013, 2014, 2016, 2017, 2018];
    expect(() =>
      buildAnnualNights(
        m([...years, 2015].map((y) => [y, 3])),
        m(years.map((y) => [y, 1])),
        m([...years, 2015].map((y) => [y, 2])),
      ),
    ).toThrow(/2015 is missing/);
  });
  it("refuses a total that is not domestic + foreign", () => {
    const years = [2013, 2014, 2015, 2016, 2017];
    expect(() =>
      buildAnnualNights(
        m(years.map((y) => [y, 40])),
        m(years.map((y) => [y, 10])),
        m(years.map((y) => [y, 20])),
      ),
    ).toThrow(/!= domestic/);
  });
});
