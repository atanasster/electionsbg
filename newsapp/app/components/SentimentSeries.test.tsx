import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SentimentSeries } from "./SentimentSeries";
import { NewsLocaleProvider } from "../i18n";
import type { SentimentSeries as SeriesData, SeriesPoint } from "../data";

const point = (
  period: string,
  over: Partial<SeriesPoint> = {},
): SeriesPoint => ({
  period,
  counts: { neutral: 1 },
  rows: 1,
  assessed: 1,
  value_mean: null,
  value_scored: 0,
  value_se: null,
  ...over,
});

const draw = (series: SeriesData, language: "bg" | "en" = "bg") =>
  render(
    <NewsLocaleProvider language={language}>
      <SentimentSeries series={series} subject="ПП-ДБ" />
    </NewsLocaleProvider>,
  );

const series = (
  points: SeriesPoint[],
  over: Partial<SeriesData> = {},
): SeriesData => ({
  granularity: "day",
  points,
  undated: 0,
  ...over,
});

describe("SentimentSeries", () => {
  it("annotates every column with its count", () => {
    // ⚠️ §6.3 requires it in those words: a weekly mean over two articles is
    // not a trend, and the count must not be inferred from the line's shape.
    draw(
      series([
        point("2026-09-21", { rows: 3, counts: { neutral: 3 }, assessed: 3 }),
        point("2026-09-22", {
          rows: 7,
          counts: { unfavorable: 7 },
          assessed: 7,
        }),
      ]),
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("says that an absent period is absent, not zero", () => {
    draw(series([point("2026-09-01"), point("2026-09-20")]));
    expect(
      screen.getByText(/Периодите без материали липсват, а не са нула/),
    ).toBeInTheDocument();
  });

  it("renders one column per point and no filler between them", () => {
    // A gap in the data must not become a column of zero.
    draw(
      series([point("2026-09-01"), point("2026-09-10"), point("2026-09-20")]),
    );
    const columns = screen.getByRole("list", { name: /Материали по период/ });
    expect(within(columns).getAllByRole("listitem").length).toBe(3);
  });

  it("names the granularity the producer chose", () => {
    draw(
      series([point("2026-09-01"), point("2026-09-08")], {
        granularity: "week",
      }),
    );
    expect(screen.getByText(/по седмица/)).toBeInTheDocument();
  });

  it("draws no position row until at least two periods are scored", () => {
    // One scored point is not a series, and a lone marker on an axis reads
    // as a trend of one.
    draw(
      series([
        point("2026-09-01", { value_mean: 1.0, value_scored: 1 }),
        point("2026-09-02"),
      ]),
    );
    expect(
      screen.queryByRole("list", { name: /Положение по скалата/ }),
    ).not.toBeInTheDocument();
  });

  it("draws the position row once two periods carry a scalar", () => {
    draw(
      series([
        point("2026-09-01", {
          value_mean: 1.0,
          value_scored: 2,
          value_se: 0.3,
        }),
        point("2026-09-02", {
          value_mean: -1.5,
          value_scored: 4,
          value_se: 0.2,
        }),
      ]),
    );
    expect(
      screen.getByRole("list", { name: /Положение по скалата/ }),
    ).toBeInTheDocument();
  });

  it("says a point with no whisker is a single article", () => {
    // ⚠️ A band of zero width around one point reads as certainty.
    draw(
      series([
        point("2026-09-01", {
          value_mean: 1.0,
          value_scored: 1,
          value_se: null,
        }),
        point("2026-09-02", {
          value_mean: -1.0,
          value_scored: 3,
          value_se: 0.4,
        }),
      ]),
    );
    expect(screen.getByText(/няма разсейване за отчитане/)).toBeInTheDocument();
  });

  it("prints the position row's OWN denominator, not the column's", () => {
    // ⚠️ §6.3's "n on every point", on the row the plan is about. `rows` is a
    // different, larger number sitting directly above the marker, so printing
    // only that makes a mean over 2 look like a mean over 40.
    draw(
      series([
        point("2026-09-01", {
          rows: 40,
          counts: { neutral: 40 },
          assessed: 40,
          value_mean: 1.0,
          value_scored: 2,
          value_se: 0.3,
        }),
        point("2026-09-02", {
          rows: 5,
          counts: { neutral: 5 },
          assessed: 5,
          value_mean: -1.5,
          value_scored: 4,
          value_se: 0.2,
        }),
      ]),
    );
    const positions = screen.getByRole("list", {
      name: /Положение по скалата/,
    });
    expect(within(positions).getByText("1.0 · 2")).toBeInTheDocument();
    expect(within(positions).getByText("-1.5 · 4")).toBeInTheDocument();
  });

  it("says when a whisker was cut off by the scale", () => {
    // ⚠️ A clamped whisker turns "±0.3 around +2.0" into a one-sided interval
    // with nothing to show it was cut.
    draw(
      series([
        point("2026-09-01", {
          value_mean: 2.0,
          value_scored: 3,
          value_se: 0.5,
        }),
        point("2026-09-02", { value_mean: 0, value_scored: 3, value_se: 0.1 }),
      ]),
    );
    expect(
      screen.getByText(/излиза извън скалата и е отрязана/),
    ).toBeInTheDocument();
  });

  it("does not claim a clipped whisker when none was cut", () => {
    draw(
      series([
        point("2026-09-01", {
          value_mean: 1.0,
          value_scored: 3,
          value_se: 0.2,
        }),
        point("2026-09-02", { value_mean: 0, value_scored: 3, value_se: 0.1 }),
      ]),
    );
    expect(screen.queryByText(/излиза извън скалата/)).not.toBeInTheDocument();
  });

  it("labels a period by its own day, not a browser-local reading of it", () => {
    // ⚠️ `period` is a GROUPING KEY the producer cut in Europe/Sofia;
    // `formatDate` reads "2026-09-21" as UTC midnight and shifts the label a
    // day for every reader west of UTC.
    draw(series([point("2026-09-21"), point("2026-09-22")]));
    const columns = screen.getByRole("list", { name: /Материали по период/ });
    expect(within(columns).getByText(/21/)).toBeInTheDocument();
    expect(within(columns).getByText(/22/)).toBeInTheDocument();
  });

  it("gives the colours a legend, since they carry meaning", () => {
    draw(series([point("2026-09-01"), point("2026-09-02")]));
    expect(screen.getByText("позитивен")).toBeInTheDocument();
    expect(screen.getByText("негативен")).toBeInTheDocument();
  });

  it("reports undated rows rather than hiding them", () => {
    draw(series([point("2026-09-01"), point("2026-09-02")], { undated: 3 }));
    expect(screen.getByText(/3 без дата/)).toBeInTheDocument();
  });

  it("renders nothing for fewer than two periods", () => {
    // One column is not a series.
    expect(draw(series([point("2026-09-01")])).container).toBeEmptyDOMElement();
    expect(draw(series([])).container).toBeEmptyDOMElement();
  });

  it("renders the English copy on the English mirror", () => {
    draw(series([point("2026-09-01"), point("2026-09-02")]), "en");
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Coverage of ПП-ДБ over time",
    );
    expect(screen.getByText(/absent, not zero/)).toBeInTheDocument();
  });
});
