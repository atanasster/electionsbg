// The person-page summary card must stay spacious at any candidacy size: it shows a
// handful of rows and points to the dedicated /candidate/:slug/regions screen for the
// rest, rather than growing into a dense table as a candidate's region count grows.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./testI18n";
import { CandidateRegionsTile } from "./CandidateRegionsTile";
import type {
  CandidateDashboardSummary,
  CandidateRegionRow,
} from "@/data/dashboard/candidateDashboardTypes";

beforeAll(() => initTestI18n());

const region = (over: Partial<CandidateRegionRow> & { oblast: string }) =>
  ({
    name: `Регион ${over.oblast}`,
    pref: "1",
    totalVotes: 100,
    pctOfRegion: 5,
    ...over,
  }) as CandidateRegionRow;

const summary = (regions: CandidateRegionRow[]): CandidateDashboardSummary =>
  ({
    election: "2024_10_27",
    name: "Иван Иванов",
    partyNum: 1,
    partyColor: "#888",
    totalVotes: regions.reduce((s, r) => s + r.totalVotes, 0),
    regions,
    topSettlements: [],
    topSections: [],
    history: [],
  }) as CandidateDashboardSummary;

const renderTile = (regions: CandidateRegionRow[]) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CandidateRegionsTile data={summary(regions)} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("CandidateRegionsTile", () => {
  it("renders every region and hides the details link when there is nothing to hide", () => {
    renderTile([
      region({ oblast: "SOF", name: "София 25 МИР" }),
      region({ oblast: "PDV", name: "Пловдив" }),
    ]);
    expect(screen.getByText("София 25 МИР")).toBeInTheDocument();
    expect(screen.getByText("Пловдив")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Виж детайли/ }),
    ).not.toBeInTheDocument();
  });

  it("caps the inline list at 5 rows and shows a details link for the rest", () => {
    const regions = Array.from({ length: 8 }, (_, i) =>
      region({ oblast: `R${i}`, name: `Регион ${i}`, totalVotes: 100 - i }),
    );
    renderTile(regions);
    // Only the top 5 by the order given (already-sorted input) render inline.
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`Регион ${i}`)).toBeInTheDocument();
    }
    for (let i = 5; i < 8; i++) {
      expect(screen.queryByText(`Регион ${i}`)).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: /Виж детайли/ }),
    ).toBeInTheDocument();
  });

  it("hides the details link at exactly the cap (5 regions)", () => {
    const regions = Array.from({ length: 5 }, (_, i) =>
      region({ oblast: `R${i}`, name: `Регион ${i}` }),
    );
    renderTile(regions);
    expect(
      screen.queryByRole("link", { name: /Виж детайли/ }),
    ).not.toBeInTheDocument();
  });

  it("self-hides when the candidate has no regional data", () => {
    const { container } = renderTile([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a positive delta with a plus sign and the positive colour", () => {
    renderTile([region({ oblast: "SOF", deltaVotes: 42 })]);
    const delta = screen.getByText("+42");
    expect(delta).toBeInTheDocument();
    expect(delta).toHaveClass("text-positive");
  });

  it("renders a negative delta with a minus sign and the negative colour", () => {
    renderTile([region({ oblast: "SOF", deltaVotes: -17 })]);
    const delta = screen.getByText("−17");
    expect(delta).toBeInTheDocument();
    expect(delta).toHaveClass("text-negative");
  });

  it("renders a dash for a region with no prior-cycle comparison", () => {
    renderTile([region({ oblast: "SOF", deltaVotes: undefined })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
