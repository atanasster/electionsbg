// Component guard for the unit-cost methodology page.
//
// What it locks is the page's REASON to exist. Three sector tiles compute the
// same kind of number and used to restate their caveats separately; this page is
// the single home for the rules, so the two laws and the three legs must
// actually be on it. It also locks the §3b refusal: no composite index. A page
// that quietly grew an "efficiency score" across sectors would be averaging
// €/case, €/km and €/case-in-health, which are not commensurable.
//
// Hermetic: `t` echoes the key, so this asserts STRUCTURE (which rules and legs
// are present) rather than wording. The real strings are covered by the
// bg↔en parity gate.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { UnitCostMethodologyScreen } from "./UnitCostMethodologyScreen";

const renderPage = () =>
  render(
    <MemoryRouter>
      <UnitCostMethodologyScreen />
    </MemoryRouter>,
  );

describe("UnitCostMethodologyScreen", () => {
  it("states both laws", () => {
    renderPage();
    // Law 1: matching scope — the numerator/denominator rule.
    expect(screen.getByText("unit_cost_h_law1")).toBeInTheDocument();
    expect(screen.getByText("unit_cost_p_law1a")).toBeInTheDocument();
    // Law 2: case mix.
    expect(screen.getByText("unit_cost_h_law2")).toBeInTheDocument();
    expect(screen.getByText("unit_cost_p_law2a")).toBeInTheDocument();
  });

  it("says plainly that the metric is not an outcome", () => {
    renderPage();
    expect(screen.getByText("unit_cost_p_what1")).toBeInTheDocument();
  });

  it("names all three attribution limits", () => {
    renderPage();
    for (const k of [
      "unit_cost_p_cannot_attribution",
      "unit_cost_p_cannot_quality",
      "unit_cost_p_cannot_direction",
    ]) {
      expect(screen.getByText(k)).toBeInTheDocument();
    }
  });

  it("links every leg, each with its own basis", () => {
    renderPage();
    const legs = [
      ["unit_cost_leg_courts", "/judiciary"],
      ["unit_cost_leg_roads", "/awarder/000695089"],
    ] as const;
    for (const [key, href] of legs) {
      const link = screen.getByRole("link", { name: `${key}_name` });
      expect(link).toHaveAttribute("href", href);
      // The scope caveat travels with the leg, not with the family.
      expect(screen.getByText(new RegExp(`${key}_basis`))).toBeInTheDocument();
    }
  });

  it("does NOT list health as a leg — no surface computes a per-hospital €/case", () => {
    // NzokActivityTile states in its own caption that the activity corpus is
    // volume without price. Listing health as a leg would link a reader to a page
    // that says the opposite; it appears as a national CONTEXT figure instead.
    renderPage();
    expect(screen.queryByText("unit_cost_leg_health_name")).toBeNull();
    expect(screen.getByText("unit_cost_p_health_context")).toBeInTheDocument();
  });

  it("refuses a composite index explicitly (§3b)", () => {
    renderPage();
    expect(screen.getByText("unit_cost_h_notscore")).toBeInTheDocument();
    expect(screen.getByText("unit_cost_p_notscore1")).toBeInTheDocument();
  });

  it("carries the og capture readiness hook", () => {
    const { container } = renderPage();
    // The capture WAITS on this and ANCHORS on the h1; removing it would make the
    // shot race the render rather than fail loudly.
    expect(
      container.querySelector('[data-og="unit-cost-methodology"]'),
    ).not.toBeNull();
  });
});
