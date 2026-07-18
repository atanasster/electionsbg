// Branch coverage for the Consumption hub's area banner. The two data hooks
// and the AreaSniperButton child are mocked so the test never touches the
// network (an unstubbed fetch throws in jsdom, per the repo testing standard).
// Guards the picker-flash regression: an anchor must show the drill-down link
// even before its name resolves — never the picker.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AreaAnchor } from "@/data/area/areaAnchor";
import type { ResolvedArea } from "@/data/area/useAreaResolver";

const anchorMock = vi.fn<() => AreaAnchor | null>();
const resolverMock = vi.fn<() => ResolvedArea | null>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));
vi.mock("@/data/area/areaAnchor", () => ({
  useAreaAnchor: () => anchorMock(),
}));
vi.mock("@/data/area/useAreaResolver", () => ({
  useAreaResolver: () => resolverMock(),
}));
vi.mock("@/layout/header/AreaSniperButton", () => ({
  AreaSniperButton: () => <div data-testid="area-sniper" />,
}));

import { ConsumptionAreaBanner } from "./ConsumptionAreaBanner";

const renderBanner = () =>
  render(
    <MemoryRouter>
      <ConsumptionAreaBanner />
    </MemoryRouter>,
  );

describe("ConsumptionAreaBanner", () => {
  beforeEach(() => {
    anchorMock.mockReset();
    resolverMock.mockReset();
  });

  it("shows the location picker when no anchor is set", () => {
    anchorMock.mockReturnValue(null);
    resolverMock.mockReturnValue(null);
    renderBanner();
    expect(screen.getByTestId("area-sniper")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the drill-down link (not the picker) once an anchor resolves", () => {
    anchorMock.mockReturnValue({ id: "68134" });
    resolverMock.mockReturnValue({
      kind: "settlement",
      id: "68134",
      ekatte: "68134",
      obshtina: "SOF00",
      oblast: "S23",
      settlement: {
        ekatte: "68134",
        name: "София",
        name_en: "Sofia",
        obshtina: "SOF00",
        oblast: "S23",
        t_v_m: "гр.",
        kmetstvo: "",
        loc: "",
      },
    });
    renderBanner();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/consumption/68134");
    expect(screen.getByText("София")).toBeInTheDocument();
    expect(screen.queryByTestId("area-sniper")).not.toBeInTheDocument();
  });

  it("still shows the drill-down link while the anchor name is unresolved", () => {
    anchorMock.mockReturnValue({ id: "68134" });
    resolverMock.mockReturnValue(null); // resolver blobs not loaded yet
    renderBanner();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/consumption/68134",
    );
    expect(screen.queryByTestId("area-sniper")).not.toBeInTheDocument();
  });
});
