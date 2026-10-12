// D3 (docs/plans/water-hub-v1.md): operators the map cannot place are named under
// it with their €, so its total differs from the table's for a stated reason.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/screens/components/maps/SectorPointMap", () => ({
  SectorPointMap: () => <div data-testid="map" />,
}));

import { WaterOperatorMap } from "./WaterOperatorMap";

const POINT = {
  eik: "103002253",
  name: "ВиК Варна ООД",
  settlement: "Варна",
  municipality: "Варна",
  oblast: "Варна",
  loc: [27.9, 43.2] as [number, number],
  contractCount: 10,
  totalEur: 1_000_000,
  bidKnownN: 8,
  singleBidN: 4,
  singleBidShare: 0.5,
};

describe("WaterOperatorMap", () => {
  it("names the operators it cannot place", () => {
    render(
      <WaterOperatorMap
        operators={[POINT]}
        unpinned={[
          { eik: "200736851", name: "ВиК Свищов ЕАД", totalEur: 2_000_000 },
        ]}
      />,
    );
    expect(screen.getByText(/Not on the map/)).toBeTruthy();
    expect(screen.getByText(/ВиК Свищов ЕАД/)).toBeTruthy();
  });

  it("says nothing when every operator is placed", () => {
    render(<WaterOperatorMap operators={[POINT]} />);
    expect(screen.queryByText(/Not on the map/)).toBeNull();
  });
});
