// Structural guard on the oblast table: the trend columns appear only when the
// payload carries a series, sorting reorders the rows, and the dumbbell places
// its dots on the shared scale. The dumbbell is positioned divs, so the geometry
// is assertable from inline styles without a browser.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OblastTrendTable, type OblastRow } from "./OblastTrendTable";

const row = (over: Partial<OblastRow> & { oblast: string }): OblastRow => ({
  name: over.oblast,
  firstYear: 2022,
  firstAvg: 4,
  latestYear: 2026,
  latestAvg: 4.3,
  delta: 0.3,
  examinees: 1000,
  schools: 20,
  ...over,
});

const ROWS: OblastRow[] = [
  row({
    oblast: "KRZ",
    name: "Кърджали",
    firstAvg: 3.73,
    latestAvg: 4.33,
    delta: 0.6,
  }),
  row({
    oblast: "VAR",
    name: "Варна",
    firstAvg: 4.11,
    latestAvg: 4.37,
    delta: 0.26,
  }),
  row({
    oblast: "PAZ",
    name: "Пазарджик",
    firstAvg: 3.8,
    latestAvg: 4.0,
    delta: 0.2,
  }),
];

const bodyNames = (): string[] =>
  screen
    .getAllByRole("row")
    .slice(1) // drop the header row
    .map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");

describe("OblastTrendTable", () => {
  it("shows the change column and both year readings when a series is present", () => {
    render(<OblastTrendTable rows={ROWS} nationalLatest={4.33} lang="bg" />);
    expect(screen.getByText("Промяна")).toBeInTheDocument();
    expect(screen.getByText("+0,60")).toBeInTheDocument();
    expect(screen.getByText("3,73")).toBeInTheDocument();
    expect(screen.getByText("4,33")).toBeInTheDocument();
    // The header names the span the dumbbell draws.
    expect(screen.getByText(/2022\s*→\s*2026/)).toBeInTheDocument();
  });

  it("defaults to the latest average, descending", () => {
    render(<OblastTrendTable rows={ROWS} nationalLatest={4.33} lang="bg" />);
    expect(bodyNames()).toEqual(["Варна", "Кърджали", "Пазарджик"]);
  });

  it("re-sorts by change when that header is clicked", async () => {
    const user = userEvent.setup();
    render(<OblastTrendTable rows={ROWS} nationalLatest={4.33} lang="bg" />);
    await user.click(screen.getByRole("button", { name: /Промяна/ }));
    // Biggest gain first — the convergence reading.
    expect(bodyNames()).toEqual(["Кърджали", "Варна", "Пазарджик"]);
    await user.click(screen.getByRole("button", { name: /Промяна/ }));
    expect(bodyNames()).toEqual(["Пазарджик", "Варна", "Кърджали"]);
  });

  it("places the dumbbell dots on one scale shared by every row", () => {
    const { container } = render(
      <OblastTrendTable rows={ROWS} nationalLatest={4.33} lang="bg" />,
    );
    const lefts = [
      ...container.querySelectorAll<HTMLElement>("[style*='left']"),
    ]
      .map((el) => parseFloat(el.style.left))
      .filter((v) => Number.isFinite(v));
    // Every positioned mark stays inside the plotted band.
    expect(lefts.length).toBeGreaterThan(0);
    for (const l of lefts) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(100);
    }
    // Pazardzhik's latest (4.00) is the lowest value in the set, so it must sit
    // left of Varna's latest (4.37), the highest — one scale, not per-row.
    const rows = screen.getAllByRole("row").slice(1);
    const dotLeft = (name: string): number => {
      const tr = rows.find((r) => r.textContent?.startsWith(name))!;
      const marks = [...tr.querySelectorAll<HTMLElement>("[style*='left']")];
      return parseFloat(marks[marks.length - 1].style.left);
    };
    expect(dotLeft("Пазарджик")).toBeLessThan(dotLeft("Варна"));
  });

  it("drops the trend columns when the payload has no series", () => {
    const flat = ROWS.map((r) => ({ ...r, firstAvg: null, delta: null }));
    render(<OblastTrendTable rows={flat} nationalLatest={4.33} lang="bg" />);
    expect(screen.queryByText("Промяна")).not.toBeInTheDocument();
    expect(screen.queryByText(/2022\s*→\s*2026/)).not.toBeInTheDocument();
    // …but the latest-year table still renders in full.
    expect(bodyNames()).toEqual(["Варна", "Кърджали", "Пазарджик"]);
  });

  it("labels the columns in English when asked", () => {
    render(<OblastTrendTable rows={ROWS} nationalLatest={4.33} lang="en" />);
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByText("Province")).toBeInTheDocument();
    expect(screen.getByText("+0.60")).toBeInTheDocument();
  });
});
