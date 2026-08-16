// The comparative words in this tile's closing sentence — the direction, the
// magnitude and the rank — are DERIVED from `band`, not written down. That is the
// whole point of the 2026-08-15 audit fix (§5): the previous copy asserted „под
// средното", „чувствително" and „не е най-ниският" as literals beside numbers it
// interpolated, so a Eurostat vintage that moved any of them would have left the
// sentence contradicting the chart directly above it, in both languages, with
// nothing failing.
//
// Each case below drives the component with a fabricated band, so the assertions
// are about the RULE rather than about today's numbers (BG 14.4% vs an EU 19.6%).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialEuPeerTile } from "./SocialEuPeerTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

interface Band {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
  top?: { geo: string; pctGdp: number };
}

let band: Band;
vi.mock("@/data/macro/useCofog", () => ({
  useCofog: () => ({
    data: {
      peers: { GF10: band },
      peerSeriesLatestYear: band.year,
      peerSeriesByYear: {
        [String(band.year)]: {
          BG: { GF10: band.bgPctGdp },
          RO: { GF10: 13.6 },
          HR: { GF10: 13.8 },
          HU: { GF10: 12.3 },
          ...(band.euAvgPctGdp != null
            ? { EU27_2020: { GF10: band.euAvgPctGdp } }
            : {}),
          ...(band.top ? { [band.top.geo]: { GF10: band.top.pctGdp } } : {}),
        },
      },
    },
  }),
}));

const BASE: Band = {
  year: 2024,
  bgPctGdp: 14.4,
  euAvgPctGdp: 19.6,
  rank: 17,
  total: 26,
  top: { geo: "FI", pctGdp: 26.5 },
};

const renderTile = (over: Partial<Band> = {}) => {
  band = { ...BASE, ...over };
  return render(<SocialEuPeerTile />);
};

beforeEach(() => {
  lang = "bg";
});

describe("SocialEuPeerTile — the gap word follows the numbers", () => {
  it('says „чувствително под" when BG is far under the average', () => {
    const { container } = renderTile({ bgPctGdp: 14.4, euAvgPctGdp: 19.6 });
    expect(container.textContent).toContain("чувствително под");
  });

  // The case the old hardcoded copy could not survive: if BG ever overtook the
  // EU average, the sentence would still have read „под средното".
  it('flips to „над" when BG overtakes the average', () => {
    const { container } = renderTile({ bgPctGdp: 22.0, euAvgPctGdp: 19.6 });
    expect(container.textContent).toContain("над");
    expect(container.textContent).not.toContain("чувствително под");
  });

  it('says „около" when the two are within two percent of each other', () => {
    const { container } = renderTile({ bgPctGdp: 19.7, euAvgPctGdp: 19.6 });
    expect(container.textContent).toContain("около");
  });

  it("keeps EN in step with BG on the same band", () => {
    lang = "en";
    const { container } = renderTile({ bgPctGdp: 22.0, euAvgPctGdp: 19.6 });
    expect(container.textContent).toContain("above");
    expect(container.textContent).not.toContain("below");
  });
});

describe("SocialEuPeerTile — the rank claim follows the rank", () => {
  it("states the position when BG is mid-table", () => {
    const { container } = renderTile({ rank: 17, total: 26 });
    expect(container.textContent).toContain("17-о място от 26");
    expect(container.textContent).not.toContain("най-ниският");
  });

  // The old copy said „не е най-ниският в ЕС" unconditionally.
  it("says so when BG IS the lowest", () => {
    const { container } = renderTile({ rank: 26, total: 26 });
    expect(container.textContent).toContain("най-ниският");
  });

  it("says so when BG is the highest", () => {
    const { container } = renderTile({ rank: 1, total: 26 });
    expect(container.textContent).toContain("най-високият");
  });
});

describe("SocialEuPeerTile — a missing EU average is omitted, never rendered as 0", () => {
  // fetch_cofog picks the band year on BG + ≥20 member states without requiring the
  // EU27 aggregate, so this vintage is reachable. The old `?? 0` rendered it as
  // „0,0%" and the sentence then claimed 14.4% was below a 0.0% average.
  it.each(["bg", "en"])("drops the comparison clause — %s", (l) => {
    lang = l;
    const { container } = renderTile({ euAvgPctGdp: null });
    expect(container.textContent).not.toMatch(/0,0%|0\.0%/);
    expect(container.textContent).not.toMatch(
      l === "bg" ? /средното за ЕС/ : /the EU average/,
    );
    // …but BG's own figure still renders, so the tile is not silently empty.
    expect(screen.getAllByText(/14,4%|14\.4%/).length).toBeGreaterThan(0);
  });
});

describe("SocialEuPeerTile — no per-euro efficiency verdict", () => {
  // The contradiction this fix removed: this tile used to conclude „проблемът е
  // ефектът върху бедността" while the tile directly above it concluded the
  // opposite. Efficiency is SocialValueForMoneyTile's claim to make, not this one's.
  it.each(["bg", "en"])("stays descriptive — %s", (l) => {
    lang = l;
    const { container } = renderTile();
    expect(container.textContent).not.toMatch(
      l === "bg"
        ? /проблемът е ефектът|на евро|ефективност/
        : /the issue is its effect|per euro|efficien/i,
    );
  });
});
