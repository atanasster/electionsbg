import { beforeEach, expect, it, vi } from "vitest";
const fetchDb = vi.hoisted(() => vi.fn());
vi.mock("./dataClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dataClient")>()),
  fetchDb,
}));
import { vaccineUptake } from "./nzok";
import type { ToolContext } from "./types";

const ctx = (lang: "bg" | "en"): ToolContext => ({
  lang,
  election: "2026_04_19",
});

const plan = (
  id: string,
  doses: number,
  sourceDate: string,
  supersededBy: string | null = null,
) => ({
  id,
  channel: "total",
  doses,
  qualifier: null,
  source: "МЗ",
  sourceDate,
  supersededBy,
});

const overview = (completeThrough: string | null, season = 2026) => ({
  season,
  curve: {
    seasons: [
      {
        season,
        points: [
          { month: `${season}-08`, m: 1, n: 10 },
          { month: `${season}-09`, m: 2, n: 20 },
          { month: `${season}-10`, m: 3, n: 30 },
          { month: `${season}-11`, m: 4, n: 99 },
        ],
      },
      {
        season: season - 1,
        points: [
          { month: `${season - 1}-08`, m: 1, n: 11 },
          { month: `${season - 1}-09`, m: 2, n: 21 },
          { month: `${season - 1}-10`, m: 3, n: 31 },
          { month: `${season - 1}-11`, m: 4, n: 41 },
        ],
      },
    ],
  },
  plan: {
    rows: [
      plan("old", 500_000, "2026-08-01", "new"),
      plan("new", 770_000, "2026-09-29"),
      plan("earlier", 600_000, "2026-07-01"),
    ],
  },
  recorded: {
    asOf: "2026-11-23T14:07:49Z",
    completeThrough,
    completeTotal: completeThrough ? 60 : null,
    sameMonthsLastSeason: completeThrough ? 63 : null,
    seasonToDate: 349_385,
    seasonToDateAsOf: "2026-11-23T06:08:00",
  },
});

beforeEach(() => fetchDb.mockReset());

it("compares complete months only, and stops before the partial month", async () => {
  fetchDb.mockResolvedValue(overview("2026-10"));
  const env = await vaccineUptake({}, ctx("en"));
  expect(env.rows?.map((r) => r.month)).toEqual([
    "2026-08",
    "2026-09",
    "2026-10",
  ]);
  expect(env.facts.complete_months).toBe("2026-10");
});

it("shows no monthly comparison when no month is complete yet", async () => {
  fetchDb.mockResolvedValue(overview(null));
  const env = await vaccineUptake({}, ctx("en"));
  expect(env.rows).toEqual([]);
  expect(env.subtitle).toMatch(/no complete month yet/);
  expect(env.facts.recorded_season_to_date).toBe("349,385");
});

it("quotes the latest total that nothing superseded", async () => {
  fetchDb.mockResolvedValue(overview("2026-10"));
  const env = await vaccineUptake({}, ctx("en"));
  expect(env.facts.announced_doses).toBe("770,000");
});

it("says so when the asked season is not held", async () => {
  fetchDb.mockResolvedValue(overview("2026-10"));
  const env = await vaccineUptake({ season: 2019 }, ctx("bg"));
  expect(fetchDb).toHaveBeenCalledWith("vaccines-overview", { season: 2019 });
  expect(env.subtitle).toContain(
    "Няма данни за сезон 2019/20; показан е сезон 2026/27.",
  );
});

it("degrades a missing corpus to a 'not loaded' answer", async () => {
  fetchDb.mockResolvedValue(null);
  const env = await vaccineUptake({}, ctx("en"));
  expect(env.kind).toBe("scalar");
  expect(env.title).toBe("The flu-vaccine data are not loaded");
});
