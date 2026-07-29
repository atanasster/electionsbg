// The /persons KPI strip.
//
// The percentages are the part worth pinning: they are computed from FACET counts, not from
// the visible page, and their denominator is a separate number from the headline count (the
// headline reacts to the search box, the facets do not). Getting the denominator wrong
// produces a plausible percentage that is quietly measuring the wrong population — the kind
// of error nothing else in the page would reveal.

import { render as rtlRender, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersonsAnalysisStrip } from "./PersonsAnalysisStrip";

// StatCard's `hint` renders a Radix tooltip, which requires the provider main.tsx mounts
// at the app root.
const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const base = {
  facetMix: [],
  selectedFacet: null,
  onSelectFacet: () => {},
};

describe("PersonsAnalysisStrip", () => {
  test("computes each share against the facet total", () => {
    render(
      <PersonsAnalysisStrip
        {...base}
        count={1000}
        withDeclaration={250}
        withCompanies={100}
        facetTotal={1000}
        obshtinaCount={12}
      />,
    );
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  test("shows an em dash rather than 0% or NaN while the facets are loading", () => {
    // undefined ≠ zero. Rendering "0%" before the data arrives asserts something false
    // about the corpus, and `part/undefined` would render NaN%.
    render(<PersonsAnalysisStrip {...base} count={1000} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  test("a zero denominator does not divide by zero", () => {
    // An over-narrow filter legitimately produces an empty set.
    render(
      <PersonsAnalysisStrip
        {...base}
        count={0}
        withDeclaration={0}
        withCompanies={0}
        facetTotal={0}
        obshtinaCount={0}
      />,
    );
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  test("renders the mix bar only when there is a partition to show", () => {
    const { rerender, container } = render(
      <PersonsAnalysisStrip {...base} count={10} />,
    );
    expect(container.textContent).not.toContain("Основна принадлежност");

    rerender(
      <TooltipProvider>
        <PersonsAnalysisStrip
          {...base}
          count={10}
          facetMix={[
            { value: "politician", count: 8 },
            { value: "magistrate", count: 2 },
          ]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/Основна принадлежност/i)).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});
