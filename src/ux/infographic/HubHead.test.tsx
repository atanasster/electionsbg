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

/** `at` is the URL the head is mounted ON. It matters: every href goes through
 *  `usePreserveParams`, whose whole job is to carry the reader's ambient scope forward — so a
 *  test that always mounts at a query-less path never exercises it, and an implementation that
 *  dropped `preserve()` entirely would pass. */
const mount = (
  props: Partial<Parameters<typeof HubHead>[0]> = {},
  at = "/procurement",
) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <HubHead {...base} {...props} />
    </MemoryRouter>,
  );

/** One evidence row with the given `to`, for the href assertions. */
const withRow = (
  to: Parameters<typeof HubHead>[0]["evidence"] extends
    | { rows: (infer R)[] }
    | undefined
    ? R extends { to?: infer T }
      ? T
      : never
    : never,
) => ({
  kpis: KPIS,
  evidence: { heading: "Groups", rows: [{ label: "Row", value: "1", to }] },
});

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

  it("does not DOUBLE the query of a string `to` that carries one", () => {
    // `path` used to take the whole string, query included, and the merged search was then
    // appended to it: `/companies?political=1` → `/companies?political=1?political=1`. React
    // Router routes that — everything after the first `?` is one query string — so the
    // destination LOADS and quietly filters by `political=1?political=1`, which no validator
    // accepts, so the params are dropped and the page renders unfiltered under a heading that
    // promised a narrowed set. Live on /governance/declarations; found on /persons.
    mount({
      kpis: KPIS,
      evidence: {
        heading: "Groups",
        rows: [
          { label: "Business", value: "85 060", to: "/persons?facet=company" },
        ],
      },
    });
    const row = screen.getByText("Business").closest("a");
    expect(row).toHaveAttribute("href", "/persons?facet=company");
  });

  it("keeps a string `to` with no query untouched", () => {
    mount({
      kpis: KPIS,
      evidence: {
        heading: "Groups",
        rows: [{ label: "MPs", value: "2 118", to: "/persons" }],
      },
    });
    expect(screen.getByText("MPs").closest("a")).toHaveAttribute(
      "href",
      "/persons",
    );
  });

  it("carries the reader's ambient scope into every href", () => {
    // THE HEAD'S STATED REASON FOR EXISTING. Without it, `?pscope=all` in the band read
    // „€93,6 млрд. · целият корпус" while „виж класацията" landed on the DEFAULT scope — a
    // top-three with zero names in common with the rows above it. Mounted at a URL that
    // CARRIES the scope, so an implementation that never calls `preserve()` fails here.
    mount(withRow("/procurement/overview"), "/procurement?pscope=all");
    expect(screen.getByText("Row").closest("a")).toHaveAttribute(
      "href",
      "/procurement/overview?pscope=all",
    );
  });

  it("lets a link's OWN params win over the ambient ones", () => {
    mount(
      withRow("/procurement/contracts?pscope=ns"),
      "/procurement?pscope=all",
    );
    expect(screen.getByText("Row").closest("a")).toHaveAttribute(
      "href",
      "/procurement/contracts?pscope=ns",
    );
  });

  it("strips a param that is NOT a global one", () => {
    // The allowlist is the point: a page-local param following a reader onto another page
    // answers a question they did not ask there.
    mount(withRow("/procurement/overview"), "/procurement?role=mp");
    expect(screen.getByText("Row").closest("a")).toHaveAttribute(
      "href",
      "/procurement/overview",
    );
  });

  it("keeps the HASH, and keeps it AFTER the search", () => {
    // `/procurement`'s evidence action is `"/procurement/overview#procurement-entities"` and
    // that hub forces `?pscope=all`. Appending the search to a path that still held the hash
    // emitted `…#procurement-entities?pscope=all`, which parses as a hash with NO search — the
    // scope silently dropped AND the anchor matching nothing.
    mount(
      withRow("/procurement/overview#procurement-entities"),
      "/procurement?pscope=all",
    );
    expect(screen.getByText("Row").closest("a")).toHaveAttribute(
      "href",
      "/procurement/overview?pscope=all#procurement-entities",
    );
  });

  it("does not leak one link's forced params into the next", () => {
    // `preserve()` used to strip and re-`set` on the hook's own URLSearchParams and hand the
    // same object back, so several links built in one render accumulated each other's params.
    // Measured on /governance: a cell forcing `?pscope=all` leaked it onto the following cell's
    // scope-free `/funds/beneficiaries`, which then answered for one window. Order-dependent.
    mount(
      {
        kpis: KPIS,
        evidence: {
          heading: "Groups",
          rows: [
            { label: "Forced", value: "1", to: "/a?pscope=all" },
            { label: "Free", value: "2", to: "/b" },
          ],
        },
      },
      "/procurement",
    );
    expect(screen.getByText("Free").closest("a")).toHaveAttribute("href", "/b");
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
