// The claim this component must never make: that it knows which party an MP's declared
// wealth belongs to outside the current parliament. The roster carries only today's group,
// so for any other bucket the route returns `applicable: false` — and the chart has to say
// so rather than render whatever rows happen to be there.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  MpAssetsByParty,
  MpAssetsPartyGroup,
} from "@/data/parliament/useAssetsRankings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: "bg" },
  }),
}));

vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({
    partyGroupShortLabel: (s: string | null | undefined) =>
      s ? s.replace(/^ПГ (на )?/, "") : null,
    partyGroupShortColor: () => "#123456",
  }),
}));

const useMpAssetsByParty = vi.fn();
vi.mock("@/data/parliament/useAssetsRankings", () => ({
  useMpAssetsByParty: (opts: unknown) => useMpAssetsByParty(opts),
}));

const { AssetsByGroup } = await import("./AssetsByGroup");

const group = (over: Partial<MpAssetsPartyGroup> = {}): MpAssetsPartyGroup => ({
  party: "ПГ на ДПС",
  mps: 21,
  declared: 21,
  totalNetEur: 11_560_382,
  totalAssetsEur: 12_913_152,
  totalDebtsEur: 1_352_771,
  medianNetEur: 77_742,
  meanNetEur: 550_494,
  ...over,
});

const payload = (over: Partial<MpAssetsByParty> = {}): MpAssetsByParty => ({
  ns: "52",
  applicable: true,
  groups: [group()],
  ungrouped: { mps: 0, declared: 0, totalNetEur: 0 },
  ...over,
});

const renderChart = (data: MpAssetsByParty | null, isLoading = false) => {
  useMpAssetsByParty.mockReturnValue({ data, isLoading });
  return render(<AssetsByGroup ns="52" mpIds={null} />);
};

describe("AssetsByGroup", () => {
  it("refuses to attribute outside the current parliament — explains, draws nothing", () => {
    const { container } = renderChart(
      payload({ ns: "all", applicable: false, groups: [] }),
    );
    expect(
      screen.getByText(/mp_assets_by_group_unavailable/),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-og="assets-groups"]'),
    ).not.toBeInTheDocument();
  });

  it("renders the bars for the current parliament", () => {
    const { container } = renderChart(payload());
    expect(
      container.querySelector('[data-og="assets-groups"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("ДПС")).toBeInTheDocument();
    // Default mode is the group total; the median rides along as its complement, so the
    // €11.56m and the €77,742 median are on screen together and neither can pass for the other.
    expect(screen.getByText(/€11/)).toBeInTheDocument();
    expect(
      screen.getByText(/mp_assets_by_group_median_of/),
    ).toBeInTheDocument();
  });

  it("states the declaration denominator whenever it is not the seat count", () => {
    renderChart(payload({ groups: [group({ mps: 131, declared: 121 })] }));
    expect(
      screen.getByText(/mp_assets_by_group_declared_of.*121.*131/),
    ).toBeInTheDocument();
  });

  it("says nothing extra when every member of the group has filed", () => {
    // Proves the assertion above discriminates rather than always matching.
    renderChart(payload());
    expect(screen.queryByText(/mp_assets_by_group_declared_of/)).toBeNull();
    expect(screen.getByText(/mp_assets_by_group_mps/)).toBeInTheDocument();
  });

  it("flags MPs left out of the bars, so they can be added up to the table", () => {
    renderChart(
      payload({ ungrouped: { mps: 3, declared: 2, totalNetEur: 5 } }),
    );
    expect(
      screen.getByText(/mp_assets_by_group_ungrouped.*"count":3/),
    ).toBeInTheDocument();
  });

  it("renders nothing while loading or when the scope holds no group", () => {
    const { container: loading } = renderChart(null, true);
    expect(loading).toBeEmptyDOMElement();
    const { container: empty } = renderChart(payload({ groups: [] }));
    expect(empty).toBeEmptyDOMElement();
  });
});
