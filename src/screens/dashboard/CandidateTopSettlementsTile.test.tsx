// The person-page summary card must stay spacious at any candidacy size: it shows a
// handful of settlements and points to the dedicated /candidate/:slug/settlements screen
// for the rest, rather than growing into a dense table for a broadly-run candidate.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./testI18n";
import { CandidateTopSettlementsTile } from "./CandidateTopSettlementsTile";
import type { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import type { PreferencesInfo } from "@/data/dataTypes";

beforeAll(() => initTestI18n());

// Same mock pattern as useLocalSettlement.test.tsx: the tile's own row-cap behaviour is
// what's under test, not settlement-name resolution, and useSettlementsInfo is a
// react-query hook — stubbing it here avoids requiring a QueryClientProvider + a fetch
// mock just to exercise a lookup this test doesn't care about.
vi.mock("@/data/settlements/useSettlements", () => ({
  useSettlementsInfo: () => ({
    findSettlement: (ekatte?: string) => ({ long_name: `Село ${ekatte}` }),
  }),
}));

const settlement = (
  over: Partial<PreferencesInfo> & { ekatte: string },
): PreferencesInfo =>
  ({
    partyNum: 1,
    pref: "1",
    totalVotes: 10,
    ...over,
  }) as PreferencesInfo;

const summary = (
  topSettlements: PreferencesInfo[],
): CandidateDashboardSummary =>
  ({
    election: "2024_10_27",
    name: "Иван Иванов",
    partyNum: 1,
    totalVotes: 100,
    regions: [],
    topSettlements,
    topSections: [],
    history: [],
  }) as CandidateDashboardSummary;

const renderTile = (topSettlements: PreferencesInfo[]) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CandidateTopSettlementsTile data={summary(topSettlements)} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("CandidateTopSettlementsTile", () => {
  it("caps the inline list at 5 rows, ranked by votes, and links to the full list", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      settlement({ ekatte: `EK${i}`, totalVotes: 100 - i }),
    );
    renderTile(rows);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`Село EK${i}`)).toBeInTheDocument();
    }
    for (let i = 5; i < 9; i++) {
      expect(screen.queryByText(`Село EK${i}`)).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: /Виж детайли/ }),
    ).toBeInTheDocument();
  });

  it("shows the details link even with only 2 rows (unconditional, unlike CandidateRegionsTile)", () => {
    renderTile([settlement({ ekatte: "EK0" }), settlement({ ekatte: "EK1" })]);
    expect(
      screen.getByRole("link", { name: /Виж детайли/ }),
    ).toBeInTheDocument();
  });

  it("self-hides when the candidate has no settlement data", () => {
    const { container } = renderTile([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a positive delta with a plus sign", () => {
    renderTile([
      settlement({ ekatte: "EK0", totalVotes: 50, lyTotalVotes: 30 }),
    ]);
    expect(screen.getByText("+20")).toBeInTheDocument();
  });
});
