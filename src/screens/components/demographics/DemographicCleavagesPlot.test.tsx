import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DemographicCleavagesPayload } from "@/data/dashboard/useDemographicCleavages";

// t echoes the key; the sub-hooks are irrelevant to the structural guard.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({ displayNameFor: (n: string) => n }),
}));
vi.mock("@/ux/useTooltip", () => ({
  useTooltip: () => ({
    tooltip: null,
    onMouseEnter: () => {},
    onMouseMove: () => {},
    onMouseLeave: () => {},
  }),
}));

import { DemographicCleavagesPlot } from "./DemographicCleavagesPlot";

const payload: DemographicCleavagesPayload = {
  election: "2026_04_19",
  parties: [
    { partyNum: 1, nickName: "A", color: "#111", pctNational: 40 },
    { partyNum: 2, nickName: "B", color: "#222", pctNational: 10 },
    { partyNum: 3, nickName: "C", color: "#333", pctNational: 5 },
  ],
  rows: [
    { metric: "genderFemale", rs: [0.5, -0.9, 0.1], spread: 1.4 },
    { metric: "age15_29", rs: [0.1, 0.2, -0.3], spread: 0.5 },
  ],
};

const renderPlot = (
  props: React.ComponentProps<typeof DemographicCleavagesPlot>,
) =>
  render(
    <MemoryRouter>
      <DemographicCleavagesPlot {...props} />
    </MemoryRouter>,
  );

describe("DemographicCleavagesPlot", () => {
  it("renders one legend entry per party and one dot per party per row", () => {
    const { container } = renderPlot({ payload, rows: payload.rows });
    // Legend links (each party) — legend + row links are all <a>; assert the
    // combined count = parties (legend) + rows.
    expect(screen.getAllByRole("link")).toHaveLength(
      payload.parties.length + payload.rows.length,
    );
    // Row dots carry the `border-background` class (legend dots don't).
    expect(container.querySelectorAll(".border-background")).toHaveLength(
      payload.parties.length * payload.rows.length,
    );
    expect(
      screen.getByText("dashboard_demographic_cleavages_note"),
    ).toBeInTheDocument();
  });

  it("renders rows as buttons that call onMetricSelect instead of links", () => {
    const onMetricSelect = vi.fn();
    renderPlot({ payload, rows: payload.rows, onMetricSelect });
    // Rows are now <button>; only the party legend stays as links.
    expect(screen.getAllByRole("link")).toHaveLength(payload.parties.length);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(payload.rows.length);
    buttons[0].click();
    expect(onMetricSelect).toHaveBeenCalledWith("genderFemale");
  });
});
