// The chart is now shared by /education (the country, with the governments
// strip) and /school/:id (one school against the country, without it). These
// guard the props that separate those two modes — a regression here would put a
// cabinet band beside a single school's line, or silently drop the benchmark
// that makes a school's own rise readable at all.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/governments/useGovernments", () => ({
  useGovernments: () => ({
    data: [
      {
        id: "x",
        pmBg: "Тестов Премиер",
        pmEn: "Test PM",
        startDate: "2021-01-01",
        endDate: null,
        type: "regular",
        parties: [],
        partiesEn: [],
        endReason: "incumbent",
        endReasonBg: "",
        endReasonEn: "",
        source: "",
      },
    ],
  }),
}));
// jsdom reports offsetWidth 0, and the chart deliberately draws nothing without
// a measured width — hand it one.
vi.mock("@/ux/useMeasuredWidth", () => ({
  useMeasuredWidth: () => [() => {}, 640],
}));
// The strip itself is covered by the governments suite and drags in React Query;
// here we only care whether the chart asks for one.
vi.mock("@/screens/components/governments/ChartCabinetStrip", () => ({
  ChartCabinetStrip: () => <div data-testid="cabinet-strip" />,
}));
// jsdom has no matchMedia; the chart only uses it to pick the right-hand gutter.
vi.mock("@/ux/useMediaQueryMatch", () => ({
  useMediaQueryMatch: () => false,
}));
vi.mock("@/ux/useTooltip", () => ({
  useTooltip: () => ({
    tooltip: null,
    onMouseEnter: () => {},
    onMouseMove: () => {},
    onMouseLeave: () => {},
  }),
}));

import { MaturaTrendChart } from "./MaturaTrendChart";

const NATIONAL = [
  { year: 2022, avg: 3.97, examinees: 43012 },
  { year: 2023, avg: 3.84, examinees: 45866 },
  { year: 2024, avg: 4.3, examinees: 46899 },
  { year: 2025, avg: 4.21, examinees: 48067 },
  { year: 2026, avg: 4.33, examinees: 49014 },
];

// A weak school with one tiny cohort — the 2023 year is 7 examinees.
const SCHOOL = [
  { year: 2022, avg: 2.53, examinees: 12 },
  { year: 2023, avg: 2.24, examinees: 7 },
  { year: 2024, avg: 2.43, examinees: 12 },
  { year: 2025, avg: 2.48, examinees: 23 },
  { year: 2026, avg: 2.73, examinees: 16 },
];

const svg = (c: HTMLElement) => c.querySelector("svg")!;

describe("MaturaTrendChart", () => {
  it("draws one line and the governments strip for the national series", () => {
    const { container } = render(
      <MaturaTrendChart national={NATIONAL} lang="bg" />,
    );
    expect(svg(container).querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.getByText("Правителства")).toBeInTheDocument();
    expect(screen.queryByText("страната")).not.toBeInTheDocument();
  });

  it("adds a dashed benchmark and drops the strip on a school", () => {
    const { container } = render(
      <MaturaTrendChart
        national={SCHOOL}
        reference={NATIONAL}
        referenceLabel="страната"
        showCabinet={false}
        lang="bg"
      />,
    );
    const lines = [...svg(container).querySelectorAll("polyline")];
    expect(lines).toHaveLength(2);
    // The benchmark is the dashed one, drawn before (behind) the subject.
    expect(lines[0].getAttribute("stroke-dasharray")).toBe("5 3");
    expect(lines[1].getAttribute("stroke-dasharray")).toBeNull();
    expect(screen.getByText("страната")).toBeInTheDocument();
    expect(screen.queryByText("Правителства")).not.toBeInTheDocument();
  });

  it("widens the y band so both series fit on one scale", () => {
    // The school sits at 2.2–2.7 and the country at 3.8–4.3; a domain fitted to
    // the school alone would push the benchmark off the plot.
    const { container } = render(
      <MaturaTrendChart
        national={SCHOOL}
        reference={NATIONAL}
        showCabinet={false}
        lang="bg"
      />,
    );
    const ticks = [...svg(container).querySelectorAll("text")]
      .map((t) => t.textContent ?? "")
      .filter((t) => /^\d,\d\d$/.test(t))
      .map((t) => Number(t.replace(",", ".")));
    expect(Math.min(...ticks)).toBeLessThanOrEqual(2.5);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(4.3);
  });

  it("hollows out the dots for cohorts below the threshold", () => {
    const { container } = render(
      <MaturaTrendChart
        national={SCHOOL}
        reference={NATIONAL}
        provisionalBelow={10}
        showCabinet={false}
        lang="bg"
      />,
    );
    const dots = [...svg(container).querySelectorAll("circle")];
    const hollow = dots.filter((d) => d.getAttribute("stroke"));
    expect(dots).toHaveLength(5);
    expect(hollow).toHaveLength(1); // only 2023, at 7 examinees
    expect(screen.getByText("под 10 зрелостници")).toBeInTheDocument();
  });

  it("leaves every dot solid when no threshold is given", () => {
    const { container } = render(
      <MaturaTrendChart national={SCHOOL} showCabinet={false} lang="bg" />,
    );
    const dots = [...svg(container).querySelectorAll("circle")];
    expect(dots.filter((d) => d.getAttribute("stroke"))).toHaveLength(0);
    expect(screen.queryByText(/под 10/)).not.toBeInTheDocument();
  });

  it("carries the series in the screen-reader label", () => {
    const { container } = render(
      <MaturaTrendChart
        national={SCHOOL}
        showCabinet={false}
        ariaTitle="Успех по години за Тест"
        lang="bg"
      />,
    );
    expect(svg(container).getAttribute("aria-label")).toBe(
      "Успех по години за Тест: 2022 — 2,53; 2023 — 2,24; 2024 — 2,43; 2025 — 2,48; 2026 — 2,73",
    );
  });

  it("drops the cohort band and the provisional marks on a payload with no counts", () => {
    // The deployed payload predates per-year counts, so `n` arrives undefined
    // and the screen passes 0. Without the guard every dot would read hollow
    // ("too small to trust") under a row of zero-height bars labelled "0".
    const noCounts = SCHOOL.map((p) => ({ ...p, examinees: 0 }));
    const { container } = render(
      <MaturaTrendChart
        national={noCounts}
        reference={NATIONAL}
        provisionalBelow={10}
        showCabinet={false}
        lang="bg"
      />,
    );
    const dots = [...svg(container).querySelectorAll("circle")];
    expect(dots.filter((d) => d.getAttribute("stroke"))).toHaveLength(0);
    expect(svg(container).querySelectorAll("rect[fill^='hsl']")).toHaveLength(
      0,
    );
    expect(screen.queryByText(/под 10/)).not.toBeInTheDocument();
    expect(screen.queryByText("брой зрелостници")).not.toBeInTheDocument();
    // The lines themselves still draw.
    expect(svg(container).querySelectorAll("polyline")).toHaveLength(2);
  });

  it("renders nothing for a single-year series", () => {
    const { container } = render(
      <MaturaTrendChart national={[SCHOOL[0]]} lang="bg" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
