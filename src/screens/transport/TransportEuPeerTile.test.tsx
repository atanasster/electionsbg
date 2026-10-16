// The „без Гърция" clause is keyed on Greece's own value, not on the member count
// (review 2026-10-17, FINDING-002): a lagging reporter also makes the count 26.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const cofog = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/data/macro/useCofog", () => ({
  useCofog: () => ({ data: cofog.data, isLoading: false }),
}));

import { TransportEuPeerTile } from "./TransportEuPeerTile";

const payload = (withGreece: boolean) => ({
  peers: {
    GF0405: {
      year: 2024,
      bgPctGdp: 3.4,
      euAvgPctGdp: 2.5,
      rank: 6,
      total: 26, // one member missing either way
      top: { geo: "LV", pctGdp: 4.3 },
    },
  },
  peerSeriesByYear: {
    "2024": {
      BG: { GF0405: 3.4 },
      RO: { GF0405: 3.3 },
      HR: { GF0405: 2.8 },
      HU: { GF0405: 3.8 },
      EU27_2020: { GF0405: 2.5 },
      ...(withGreece ? { GR: { GF0405: 2.1 } } : {}),
    },
  },
});

describe("TransportEuPeerTile — the Greece caption", () => {
  beforeEach(() => {
    cofog.data = null;
  });

  it("says Greece is missing only when Greece has no value", () => {
    cofog.data = payload(false);
    render(<TransportEuPeerTile />);
    expect(screen.getByText(/Greece not included/)).toBeTruthy();
  });

  it("stays silent when Greece reports, even though the count is 26", () => {
    cofog.data = payload(true);
    render(<TransportEuPeerTile />);
    expect(screen.queryByText(/Greece not included/)).toBeNull();
  });
});
