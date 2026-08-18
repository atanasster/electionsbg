// /subsidies/browse — the hub's table view. Covered here for its BREADCRUMB
// only: the page gained one in step 6b (docs/plans/subsidies-hub-v1.md §7a),
// having had none at all, which left the deepest page in the agri family with
// no way back up. Its own table is a server-side DbDataTable with its own
// tests, and the facet query is stubbed.
//
// The specific regression this guards is the trail's SHAPE: /subsidies is a
// governance money vertical, absent from src/screens/governance/sectorRegistry.ts,
// so the crumb must not route a reader to the procurement sectors hub — which is
// what the family did before this change.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

// The oblast facet fires a real fetch; vitest.setup.ts throws on an unstubbed
// one, so it is stubbed rather than left to the network.
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQuery: () => ({ data: undefined }) };
});
vi.mock("@/ux/data_table/DbDataTable", () => ({ DbDataTable: () => null }));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const { SubsidiesBrowserDbScreen } = await import("./SubsidiesBrowserDbScreen");

describe("SubsidiesBrowserDbScreen", () => {
  it("hangs off the farm-subsidies hub, not the procurement sectors hub", () => {
    render(
      <MemoryRouter initialEntries={["/subsidies/browse"]}>
        <SubsidiesBrowserDbScreen />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    // Управление › Земеделски субсидии › Данни — the section links back, the
    // leaf is the current page and so carries no link.
    expect(hrefs).toEqual(["/governance", "/subsidies"]);
    expect(hrefs).not.toContain("/governance/sectors");
    expect(hrefs).not.toContain("/procurement");
    // i18next is not initialised under vitest, so `t()` returns its own key —
    // which is exactly what makes a MISSING key invisible in this repo. Assert
    // the leaf key by name so a rename cannot silently print itself on the page.
    expect(nav.textContent).toContain("subsidies_browse_nav");
  });
});
