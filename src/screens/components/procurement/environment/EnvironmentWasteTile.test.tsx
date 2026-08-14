// Two claims on this tile are arithmetically right and false as sentences, and
// both are invisible to any check on the DATA — the numbers are correct
// Eurostat values either way.
//
// 1. Eurostat publishes the EU27 aggregate AHEAD of Bulgaria (today BG's
//    recycling series ends 2023 and EU27 ends 2024), so taking each series' own
//    last point compares two different years. Neither figure carried a year, so
//    "16.7% vs an EU average of 48%" read as one comparison and was two.
// 2. Waste per person "has risen to 490 kg" is true since 2016 (418 kg) and
//    reads as an all-time high, which it is not — the series opens at 554 kg in
//    2010.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { WasteFile } from "@/data/environment/useWaste";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

let waste: WasteFile | undefined;
vi.mock("@/data/environment/useWaste", () => ({
  useWaste: () => ({ data: waste }),
}));

const { EnvironmentWasteTile } = await import("./EnvironmentWasteTile");

const pt = (year: number, value: number) => ({ year, value });

/** The real 2026-08 shape: BG ends a year behind the EU aggregate. */
const file = (over: Partial<WasteFile> = {}): WasteFile => ({
  source: "Eurostat cei_wm011",
  sourceUrl: "https://example.invalid",
  fetchedAt: "2026-07-16T00:00:00.000Z",
  targets: { y2025: 55, y2030: 60, y2035: 65 },
  recyclingRate: {
    unit: "%",
    byGeo: {
      BG: [pt(2021, 28.2), pt(2022, 24.6), pt(2023, 16.7)],
      EU27_2020: [pt(2022, 49.1), pt(2023, 47.9), pt(2024, 48.1)],
    },
  },
  wastePerCapita: {
    unit: "kg",
    byGeo: { BG: [pt(2010, 554), pt(2016, 418), pt(2023, 490)] },
  },
  ...over,
});

beforeEach(() => {
  cleanup();
  lang = "bg";
  waste = file();
});

describe("EnvironmentWasteTile — like-year comparison", () => {
  it("quotes the EU figure for BULGARIA's year, not the EU's own latest", () => {
    // Real 2023 vs 2024 EU values round to the same 48%, so the rounded number
    // cannot discriminate. Use values that DO differ once rendered, then assert
    // positively on the one that must appear — `not.toContain("2024")` alone is
    // satisfied by a tile that renders no EU figure at all, which is how this
    // assertion went vacuous the first time it was written.
    waste = file({
      recyclingRate: {
        unit: "%",
        byGeo: {
          BG: [pt(2021, 28.2), pt(2022, 24.6), pt(2023, 16.7)],
          EU27_2020: [pt(2022, 49.1), pt(2023, 41.4), pt(2024, 68.3)],
        },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";

    expect(text).toContain("16,7%");
    expect(text).toContain("41%"); // BG's year
    expect(text).not.toContain("68%"); // the EU's own latest
    expect(text).not.toContain("2024");
  });

  it("names the EU year when Bulgaria's year is missing from the EU series", () => {
    waste = file({
      recyclingRate: {
        unit: "%",
        byGeo: {
          BG: [pt(2021, 28.2), pt(2022, 24.6), pt(2023, 16.7)],
          // No 2023 point — the fallback path.
          EU27_2020: [pt(2021, 49.6), pt(2022, 49.1), pt(2024, 48.1)],
        },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";

    // Falling back is fine; doing it silently is not.
    expect(text).toContain("2024");
  });

  it("labels Bulgaria's own year on the headline claim", () => {
    // A bare toContain("2023") is satisfied by the chart's own axis rail, so
    // assert the year in its SENTENCE position instead.
    render(<EnvironmentWasteTile />);
    expect(document.body.textContent ?? "").toContain("отпадъци (2023 г.)");
  });

  it("renders no EU comparison at all when the EU series is empty", () => {
    // The fallback is `euSameYear ?? euSeries.at(-1)`, which is undefined here.
    // Silence is the right output — but it must be silence, not a stray „и под
    // средното за ЕС ()".
    waste = file({
      recyclingRate: {
        unit: "%",
        byGeo: {
          BG: [pt(2021, 28.2), pt(2022, 24.6), pt(2023, 16.7)],
          EU27_2020: [],
        },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("16,7%");
    expect(text).not.toContain("средното за ЕС");
    expect(text).not.toContain("ЕС средно");
  });

  it("says ABOVE when Bulgaria is above the target and the EU mean", () => {
    // Both comparatives were unconditional prose, so a Bulgaria that met the
    // 55% target would still have read „под целта" — while the „N пункта под
    // целта" chip beside it, which IS guarded, correctly disappeared.
    waste = file({
      recyclingRate: {
        unit: "%",
        byGeo: {
          BG: [pt(2021, 50), pt(2022, 55), pt(2023, 58)],
          EU27_2020: [pt(2022, 49.1), pt(2023, 47.9)],
        },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("над целта");
    expect(text).toContain("над средното за ЕС");
    expect(text).not.toContain("пункта под целта");
  });
});

describe("EnvironmentWasteTile — the per-capita claim", () => {
  it("names the trough it rose FROM, so 490 kg cannot read as an all-time high", () => {
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("490");
    expect(text).toContain("418"); // the 2016 low
    expect(text).toContain("2016");
  });

  it("claims no rise when the latest point IS the series low", () => {
    waste = file({
      wastePerCapita: {
        unit: "kg",
        byGeo: { BG: [pt(2010, 554), pt(2016, 500), pt(2023, 400)] },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("400");
    expect(text).not.toContain("нагоре от");
  });

  it("carries both fixes in English too", () => {
    // The sibling VikContractorHhiTile test exists because a caption was fixed
    // in one language and not the other for a commit. Same risk here — so the
    // EU assertion is positive, not just an absence.
    lang = "en";
    waste = file({
      recyclingRate: {
        unit: "%",
        byGeo: {
          BG: [pt(2021, 28.2), pt(2022, 24.6), pt(2023, 16.7)],
          EU27_2020: [pt(2022, 49.1), pt(2023, 41.4), pt(2024, 68.3)],
        },
      },
    });
    render(<EnvironmentWasteTile />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("up from");
    expect(text).toContain("418 kg in 2016");
    expect(text).toContain("waste (2023)");
    expect(text).toContain("41%"); // BG's year, not the EU's own latest
    expect(text).not.toContain("68%");
  });
});
