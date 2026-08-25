// The person-page summary card must stay spacious at any candidacy size: it shows a
// handful of voting sections and points to the dedicated /candidate/:slug/sections screen
// for the rest, rather than growing into a dense table for a broadly-run candidate.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./testI18n";
import { CandidateTopSectionsTile } from "./CandidateTopSectionsTile";
import type { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import type { PreferencesInfo } from "@/data/dataTypes";

beforeAll(() => initTestI18n());

const section = (
  over: Partial<PreferencesInfo> & { section: string },
): PreferencesInfo =>
  ({
    partyNum: 1,
    pref: "1",
    totalVotes: 10,
    ...over,
  }) as PreferencesInfo;

const summary = (topSections: PreferencesInfo[]): CandidateDashboardSummary =>
  ({
    election: "2024_10_27",
    name: "Иван Иванов",
    partyNum: 1,
    totalVotes: 100,
    regions: [],
    topSettlements: [],
    topSections,
    history: [],
  }) as CandidateDashboardSummary;

const renderTile = (topSections: PreferencesInfo[]) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CandidateTopSectionsTile data={summary(topSections)} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("CandidateTopSectionsTile", () => {
  it("caps the inline list at 5 rows, ranked by votes, and links to the full list", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      section({ section: `10000000${i}`, totalVotes: 100 - i }),
    );
    renderTile(rows);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`10000000${i}`)).toBeInTheDocument();
    }
    for (let i = 5; i < 9; i++) {
      expect(screen.queryByText(`10000000${i}`)).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: /Виж детайли/ }),
    ).toBeInTheDocument();
  });

  it("shows the details link even with only 2 rows (unconditional, unlike CandidateRegionsTile)", () => {
    renderTile([
      section({ section: "100000001" }),
      section({ section: "100000002" }),
    ]);
    expect(
      screen.getByRole("link", { name: /Виж детайли/ }),
    ).toBeInTheDocument();
  });

  it("self-hides when the candidate has no section data", () => {
    const { container } = renderTile([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a positive delta with a plus sign", () => {
    renderTile([
      section({ section: "100000001", totalVotes: 50, lyTotalVotes: 30 }),
    ]);
    expect(screen.getByText("+20")).toBeInTheDocument();
  });
});
