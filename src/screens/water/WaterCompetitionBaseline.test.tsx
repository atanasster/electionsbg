// The water competition card shows the national baseline ONLY when both sides
// are on the ex-member basis for the same window — never a mismatched one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const national = vi.fn();
vi.mock("@/data/procurement/useNationalCompetition", async (orig) => ({
  ...(await orig<typeof import("@/data/procurement/useNationalCompetition")>()),
  useNationalCompetition: () => national(),
}));

import { WaterCompetitionBaseline } from "./WaterCompetitionBaseline";

const op = (eik: string, bidKnownN: number, singleBidN: number) => ({
  eik,
  name: eik,
  oblast: "",
  totalEur: 1,
  contractCount: bidKnownN,
  singleBidShare: bidKnownN ? singleBidN / bidKnownN : null,
  bidKnownN,
  singleBidN,
});
const OPS = [op("1", 60, 30), op("2", 40, 10)];
const NAT = {
  data: {
    singleBid: 50,
    bidKnown: 100,
    contracts: 100,
    singleBidExMembers: 40,
    bidKnownExMembers: 100,
  },
};

beforeEach(() => {
  national.mockReset();
});

describe("WaterCompetitionBaseline", () => {
  it("puts the ex-member national rate beside the sector rate", () => {
    national.mockReturnValue(NAT);
    render(<WaterCompetitionBaseline operators={OPS} exMembers />);
    // (30 + 10) / 100 = 40% sector; 40 / 100 = 40% national ex-member.
    expect(screen.getByText(/against 40% for all buyers/)).toBeTruthy();
  });

  it("shows no baseline when the rollup cannot vouch for its basis", () => {
    national.mockReturnValue(NAT);
    render(<WaterCompetitionBaseline operators={OPS} exMembers={false} />);
    expect(screen.queryByText(/for all buyers/)).toBeNull();
  });

  it("shows no baseline when the national function lacks the ex-member keys", () => {
    national.mockReturnValue({
      data: { singleBid: 50, bidKnown: 100, contracts: 100 },
    });
    render(<WaterCompetitionBaseline operators={OPS} exMembers />);
    expect(screen.queryByText(/for all buyers/)).toBeNull();
  });

  it("renders nothing without a known bid count", () => {
    national.mockReturnValue(NAT);
    const { container } = render(
      <WaterCompetitionBaseline operators={[]} exMembers />,
    );
    expect(container.innerHTML).toBe("");
  });
});
