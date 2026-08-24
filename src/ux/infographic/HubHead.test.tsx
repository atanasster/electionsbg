// HubHead — the shared opening block for every module hub (SKILL.md §3.0/§3.1).
//
// The failure modes here are structural, and every one of them renders FINE:
//
//   • two <h1>s, when a screen keeps <Title> alongside the head — an SEO defect
//     nothing else fails on;
//   • a KPI value with no `basis` beside it — the exact state §3.1 rule 2 exists to
//     prevent, and TypeScript only enforces the field's presence, not its content;
//   • the evidence list rendered BEFORE the KPI band in the DOM, which on a phone
//     (one column, source order) puts a ranked list between the deck and the numbers;
//   • an empty band that still paints its container, or a note captioning nothing.
//
// So this mounts the real component and asserts the shape, rather than the copy.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HubHead, type HubKpi } from "./HubHead";

const base = {
  eyebrow: "PROCUREMENT",
  title: "Public procurement",
  seoDescription: "Aggregated public-procurement contracts",
  deck: "Every contract signed by the state.",
};

const KPIS: HubKpi[] = [
  {
    value: "€93,56 bn",
    label: "contracted",
    basis: "contracts 2011–2026",
    to: "/procurement/overview",
  },
  { value: "29 622", label: "suppliers", basis: "firms with a contract" },
];

const mount = (props: Partial<Parameters<typeof HubHead>[0]> = {}) =>
  render(
    <MemoryRouter initialEntries={["/procurement"]}>
      <HubHead {...base} {...props} />
    </MemoryRouter>,
  );

describe("HubHead", () => {
  it("renders exactly one h1", () => {
    mount({ kpis: KPIS });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders every KPI's basis, not only its value", () => {
    mount({ kpis: KPIS });
    for (const kpi of KPIS) {
      expect(screen.getByText(kpi.value)).toBeInTheDocument();
      expect(screen.getByText(kpi.basis)).toBeInTheDocument();
    }
  });

  it("links a KPI that declares a destination and leaves the rest inert", () => {
    mount({ kpis: KPIS });
    const linked = screen.getByText("contracted").closest("a");
    expect(linked).toHaveAttribute("href", "/procurement/overview");
    expect(screen.getByText("suppliers").closest("a")).toBeNull();
  });

  // §3.0: the DOM order IS the mobile order. Below `lg` the two-column grid is one
  // column in source order, so the aside must FOLLOW the band.
  it("keeps identity → KPI band → evidence in DOM order", () => {
    const { container } = mount({
      kpis: KPIS,
      evidence: {
        heading: "Largest sectors",
        rows: [{ label: "Roads", value: "€138.9m", to: "/sector/roads" }],
      },
    });
    const band = screen.getByText("€93,56 bn").closest("div.grid");
    const aside = container.querySelector("aside");
    expect(band).not.toBeNull();
    expect(aside).not.toBeNull();
    expect(
      band!.compareDocumentPosition(aside!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // A band short of four cells must not paint the container's divider colour into the
  // unused tracks — which happens on every cold load when two independent queries feed it.
  it("sizes the grid to the payload", () => {
    const two = mount({ kpis: KPIS }).container.querySelector("div.grid");
    expect(two?.className).toContain("sm:grid-cols-2");
    expect(two?.className).not.toContain("sm:grid-cols-4");

    const four = mount({
      kpis: [...KPIS, { ...KPIS[1], label: "a" }, { ...KPIS[1], label: "b" }],
    }).container.querySelector("div.grid");
    expect(four?.className).toContain("sm:grid-cols-4");
  });

  it("accepts an object `To` on an evidence row and keeps its search", () => {
    // `useAwarderHref` returns a `To` object, not a string — and the head re-merges the
    // active scope onto it. A string-only path would drop the search silently.
    mount({
      kpis: KPIS,
      evidence: {
        heading: "Largest buyers",
        rows: [
          {
            id: "000695089",
            label: "Агенция Пътна инфраструктура",
            value: "€8.8 bn",
            to: { pathname: "/awarder/000695089", search: "?pscope=all" },
          },
        ],
      },
    });
    const row = screen.getByText("Агенция Пътна инфраструктура").closest("a");
    expect(row).toHaveAttribute("href", "/awarder/000695089?pscope=all");
  });

  it("omits the band and its note entirely rather than rendering empty cells", () => {
    const { container } = mount({ kpis: [], kpiNote: "not comparable" });
    expect(screen.queryByText("not comparable")).not.toBeInTheDocument();
    expect(container.querySelector("div.grid")).toBeNull();
  });

  it("omits the evidence card when it has no rows", () => {
    const { container } = mount({
      kpis: KPIS,
      evidence: { heading: "Largest sectors", rows: [] },
    });
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.queryByText("Largest sectors")).not.toBeInTheDocument();
  });
});
