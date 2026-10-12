// The intra-group disclosure (W2): only suppliers that are themselves water
// EIKs count, and the whole-period split is labelled as whole-period.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/data/water/hubStats", () => ({
  useWaterHubStats: () => ({
    data: {
      intraGroup: {
        eur: 29_000_000,
        contracts: 50,
        loansToHoldingEur: 27_000_000,
        loansToHoldingContracts: 18,
        selfEur: 82_000,
        selfContracts: 2,
      },
      credits: { eur: 3_700_000, contracts: 9 },
    },
  }),
}));

import { WaterIntraGroupCard } from "./WaterIntraGroupCard";
import { VIK_HOLDING_EIK } from "@/lib/vikReferenceData";

describe("WaterIntraGroupCard", () => {
  it("counts only suppliers that are water-sector EIKs", () => {
    render(
      <WaterIntraGroupCard
        suppliers={[
          { eik: VIK_HOLDING_EIK, totalEur: 2_000_000 },
          { eik: "999999999", totalEur: 50_000_000 },
        ]}
        totalEur={100_000_000}
      />,
    );
    // 2M of 100M = 2% — the external supplier's 50M is not intra-group.
    expect(screen.getByText(/\(2% of the total\)/)).toBeTruthy();
  });

  it("names the whole-period split as whole-period, and keeps banks in", () => {
    render(<WaterIntraGroupCard suppliers={[]} totalEur={100} />);
    expect(screen.getByText(/Over the whole period/)).toBeTruthy();
    expect(screen.getByText(/stay in the ranking/)).toBeTruthy();
  });

  it("states the whole period on the same ex-self basis as the in-window lead", () => {
    const { container } = render(
      <WaterIntraGroupCard suppliers={[]} totalEur={100} />,
    );
    // 29.0M − 0.082M self = €28.9M between sector companies; self apart.
    const text = container.textContent ?? "";
    expect(text).toMatch(
      /€28[.,]9.{0,8} across 48 contracts between sector companies/,
    );
    expect(text).toMatch(/Separately, €82.{0,8} across 2 name the awarder/);
  });
});
