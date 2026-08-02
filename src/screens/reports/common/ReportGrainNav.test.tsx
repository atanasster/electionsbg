// ReportGrainNav is the ONLY inbound link the non-default report grains have —
// the reports hub deep-links one grain per type — so what it renders is not
// cosmetic. Three properties, each of which fails silently:
//
//   1. It offers the OTHER grains as real links. If it rendered the current
//      grain as a link too, or dropped the siblings, the 18 pages it rescues go
//      back to being unreachable with the page still looking correct.
//   2. It renders NOTHING for a single-grain report. ReportTemplate suppresses
//      its own level caption on the same predicate, so an over-eager nav here is
//      a one-option switcher and an under-eager one leaves the page stating its
//      grain nowhere.
//   3. It declines the problem-section DETAIL pages, which are separate screens
//      that merely live under a report path.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { ReportGrainNav } from "./ReportGrainNav";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ReportGrainNav />
    </MemoryRouter>,
  );

describe("ReportGrainNav", () => {
  it("links the other two grains and leaves the current one unlinked", () => {
    at("/reports/section/turnout");

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(
      links.map((a) => a.getAttribute("href")?.split("?")[0]).sort(),
    ).toEqual(["/reports/municipality/turnout", "/reports/settlement/turnout"]);

    // The active grain is present as text but must not be a self-link.
    const current = screen.getByText("by_sections");
    expect(current.closest("a")).toBeNull();
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("keeps the report type fixed while switching grain", () => {
    at("/reports/municipality/concentrated");
    for (const a of screen.getAllByRole("link"))
      expect(a.getAttribute("href")).toContain("/concentrated");
  });

  it("renders nothing for a single-grain report", () => {
    const { container } = at("/reports/section/problem_sections");
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a problem-section detail page", () => {
    const { container } = at(
      "/reports/section/problem_sections/sofia-fakulteta",
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing off the report tree", () => {
    const { container } = at("/risk-score");
    expect(container).toBeEmptyDOMElement();
  });
});
