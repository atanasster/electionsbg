// The tile's copy is computed from the series, so these pin the arithmetic a
// reader sees: the record claim, the change against the pre-COVID year, the
// foreign share — and that an older blob without the annual series hides the
// tile rather than rendering an empty chart.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TourismAnnualNights } from "@/data/tourism/useTourismVisitors";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: lang };
    },
  }),
}));

let annual: TourismAnnualNights[] | undefined;
vi.mock("@/data/tourism/useTourismVisitors", () => ({
  useTourismVisitors: () => ({
    isLoading: false,
    data: { annualNights: annual },
  }),
}));

import { TourismAnnualNightsTile } from "./TourismAnnualNightsTile";

const row = (year: number, domestic: number, foreign: number) => ({
  year,
  domestic,
  foreign,
  total: domestic + foreign,
});

describe("TourismAnnualNightsTile", () => {
  it("states the latest total, the record, the change vs 2019 and the foreign share", () => {
    lang = "bg";
    annual = [
      row(2017, 9, 17),
      row(2018, 9, 18),
      row(2019, 10, 17), // 27
      row(2020, 7, 5),
      row(2025, 13, 16), // 29 → +7%, foreign 55%
    ];
    render(<TourismAnnualNightsTile />);
    const sub = screen.getByText(/2025:/);
    expect(sub.textContent).toMatch(/най-много от 2013/);
    expect(sub.textContent).toMatch(/\+7% спрямо 2019/);
    expect(sub.textContent).toMatch(/Чужденците са 55%/);
  });

  it("makes no record claim when an earlier year was higher", () => {
    lang = "en";
    annual = [
      row(2018, 9, 18),
      row(2019, 10, 20), // 30
      row(2020, 7, 5),
      row(2021, 9, 8),
      row(2022, 11, 13), // 24 → -20%
    ];
    render(<TourismAnnualNightsTile />);
    const sub = screen.getByText(/2022:/);
    expect(sub.textContent).not.toMatch(/most since/);
    expect(sub.textContent).toMatch(/-20% vs 2019/);
  });

  it("renders nothing for a blob built before the annual series existed", () => {
    annual = undefined;
    const { container } = render(<TourismAnnualNightsTile />);
    expect(container.innerHTML).toBe("");
  });
});
