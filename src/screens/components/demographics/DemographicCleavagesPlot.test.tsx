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

describe("the ballot-specific overrides", () => {
  // ⚠ FOUR PROPS, ONE REASON. This plot now draws two kinds of ballot, and a parliamentary
  // legend entry is a PARTY — English display name, `/party/:slug` page, a 4% legal threshold
  // in its foot note, and a `/demographics` explorer that plots census against PARTY vote.
  // None of those is true of a presidential PAIR. A tile that renders correctly with the wrong
  // noun is this family's stated failure mode, so each override is pinned against its default.

  it("keeps the PARTY defaults when nothing is overridden", () => {
    const { container } = renderPlot({ payload, rows: payload.rows });
    // The legend links to `/party/…` and each row to the census explorer.
    expect(
      container.querySelectorAll('a[href^="/party/"]').length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('a[href^="/demographics?scatter="]').length,
    ).toBe(payload.rows.length);
    expect(
      screen.getByText("dashboard_demographic_cleavages_note"),
    ).toBeTruthy();
  });

  it("takes a caller's NAME and HREF for a legend entry, and renders a refusal as plain text", () => {
    renderPlot({
      payload,
      rows: payload.rows,
      nameFor: (p) => `${p.nickName}!`,
      // ⚠ THE REFUSAL IS THE POINT. A presidential name resolves to a person page only where
      // the corpus can name exactly ONE public figure; `undefined` must render as text rather
      // than as a link to somebody who merely shares a name.
      hrefFor: (p) => (p.partyNum === 1 ? "/person/x" : undefined),
    });
    expect(screen.getByText("A!")).toBeTruthy();
    expect(screen.getByText("B!").closest("a")).toBeNull();
    expect(screen.getByText("A!").closest("a")?.getAttribute("href")).toBe(
      "/person/x",
    );
  });

  it("takes a caller's foot NOTE", () => {
    renderPlot({ payload, rows: payload.rows, noteKey: "some_other_note" });
    expect(screen.getByText("some_other_note")).toBeTruthy();
    expect(
      screen.queryByText("dashboard_demographic_cleavages_note"),
    ).toBeNull();
  });

  it("makes a row INERT and drops BOTH hover affordances", () => {
    // ⚠ BOTH, AND THE SECOND IS THE ONE THAT WAS MISSED. `hover:bg-muted/50` is the background;
    // `group` on the container is what fires the label's `group-hover:underline`. A row that
    // underlines its metric name under the cursor — the browser's universal „this is a link"
    // signal — and does nothing when clicked is a control that does not exist.
    //
    // ⚠ AND NEITHER ASSERTION NAMES A LITERAL CLASS. An `innerHTML.not.toContain(
    // "hover:bg-muted/50")` passes vacuously the day somebody renames the opacity to /40.
    const { container } = renderPlot({
      payload,
      rows: payload.rows,
      metricHref: () => undefined,
    });
    expect(container.querySelectorAll('a[href^="/demographics"]').length).toBe(
      0,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
    const row = container.querySelector("div.grid.text-xs") as HTMLElement;
    expect(row.className).not.toMatch(/hover:bg-/);
    expect(row.className.split(/\s+/)).not.toContain("group");
  });

  it("KEEPS both affordances on a row that leads somewhere", () => {
    // ⚠ THE MUTATION CHECK. Without it, an implementation that dropped `group` unconditionally
    // — silently de-affording the two live PARLIAMENTARY callers — passes the test above.
    const { container } = renderPlot({ payload, rows: payload.rows });
    const row = container.querySelector(
      'a[href^="/demographics"]',
    ) as HTMLElement;
    expect(row.className).toMatch(/hover:bg-/);
    expect(row.className.split(/\s+/)).toContain("group");
  });

  it("still prefers onMetricSelect over any href", () => {
    // The `/party-demographics` page drives its own embedded scatter; that branch must not be
    // reachable-around by the new prop.
    const onMetricSelect = vi.fn();
    const { container } = renderPlot({
      payload,
      rows: payload.rows,
      onMetricSelect,
      metricHref: () => "/somewhere",
    });
    expect(container.querySelectorAll("button").length).toBe(
      payload.rows.length,
    );
    expect(container.querySelectorAll('a[href="/somewhere"]').length).toBe(0);
  });
});
