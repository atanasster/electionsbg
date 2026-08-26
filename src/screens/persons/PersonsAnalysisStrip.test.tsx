// The /persons mix bar.
//
// ⚠️ THIS FILE USED TO PIN FOUR KPI CARDS AND NO LONGER CAN, because they are gone: the head
// band publishes those figures now, with a declared basis each, and their rule is tested in
// `personsKpiBasis.test.ts`. What was lost with the cards — the denominator distinction the old
// header described here — is pinned there instead ("rounds the rates against the FACET total,
// not the row count"), so the coverage moved rather than evaporating.
//
// What is left to pin is the bar itself: it must not render a partition of nothing, and its
// note must be able to carry the caller's extra sentence, which is what tells a reader that
// under „Всички" the „Бизнес" segment IS the private-sector scope.

import { render as rtlRender, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersonsAnalysisStrip } from "./PersonsAnalysisStrip";

const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const base = {
  facetMix: [],
  selectedFacet: null,
  onSelectFacet: () => {},
};

const MIX = [
  { value: "politician", count: 8 },
  { value: "magistrate", count: 2 },
];

describe("PersonsAnalysisStrip", () => {
  test("renders the mix bar only when there is a partition to show", () => {
    const { rerender, container } = render(<PersonsAnalysisStrip {...base} />);
    expect(container.textContent).not.toContain("Основна принадлежност");

    rerender(
      <TooltipProvider>
        <PersonsAnalysisStrip {...base} facetMix={MIX} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/Основна принадлежност/i)).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  test("publishes NO percentage of its own beside the bar", () => {
    // The four KPI cards moved into the head band. If they ever came back here the page would
    // state each figure twice — which reads as two different facts, not as one repeated — and
    // the copy here carries no basis, so the lower one would be the unqualified version.
    const { container } = render(
      <PersonsAnalysisStrip {...base} facetMix={MIX} />,
    );
    expect(container.textContent).not.toContain("С декларация");
    expect(container.textContent).not.toContain("С фирми в ТР");
  });

  test("appends extraNote to the standing note rather than replacing it", () => {
    // Both sentences have to survive: the standing one explains that the bar and the Група
    // filter answer different questions, and the extra one explains that under „Всички" the
    // „Бизнес" segment is provably the private-sector scope. Dropping either leaves a reader
    // with two controls that look like they do the same thing.
    const { container } = render(
      <PersonsAnalysisStrip
        {...base}
        facetMix={MIX}
        extraNote="ДОПЪЛНИТЕЛНА БЕЛЕЖКА"
      />,
    );
    expect(container.textContent).toContain("ДОПЪЛНИТЕЛНА БЕЛЕЖКА");
    expect(container.textContent).toContain("най-високата заемана длъжност");
  });

  test("renders the standing note alone when there is no extra one", () => {
    const { container } = render(
      <PersonsAnalysisStrip {...base} facetMix={MIX} />,
    );
    expect(container.textContent).toContain("най-високата заемана длъжност");
    // A naive join would leave a trailing separator.
    expect(container.textContent).not.toMatch(/\s{2,}$/);
  });
});
