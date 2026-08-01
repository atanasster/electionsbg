// The slug-keyed procurement section on PersonDashboard: it self-hides when the person has no
// procurement, and otherwise renders both breakdown tiles + the standalone-browser link. Fetch
// is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PersonProcurementSection } from "./PersonProcurementSection";

let response: unknown = { byCompany: [], bySettlement: [] };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/db/person-breakdowns"))
        return new Response(JSON.stringify(response), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderAt = (slug = "ivan-petrov-abc123") =>
  render(
    <MemoryRouter>
      <PersonProcurementSection slug={slug} />
    </MemoryRouter>,
  );

describe("PersonProcurementSection", () => {
  it("fetches, then hides when the person has no contract-winning firms", async () => {
    response = { byCompany: [], bySettlement: [] };
    const { container } = renderAt("some-slug");
    await new Promise((r) => setTimeout(r, 0));
    // Prove this is the EMPTY-data hide, not the still-loading hide: the hook actually
    // fetched the breakdowns and resolved before we asserted absence.
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("person-breakdowns"),
      ),
    ).toBe(true);
    expect(container.querySelector("#person-procurement")).toBeNull();
  });

  it("self-hides without throwing when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const { container } = renderAt();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("#person-procurement")).toBeNull();
  });

  it("renders both breakdowns and the standalone-browser link when there is procurement", async () => {
    response = {
      byCompany: [
        {
          eik: "130163919",
          name: "А Дейта Про",
          totalEur: 10675,
          contractCount: 1,
          awarderCount: 1,
        },
      ],
      bySettlement: [
        {
          ekatte: "68134",
          settlement: "София",
          totalEur: 10675,
          contractCount: 1,
          awarderCount: 1,
        },
      ],
    };
    const { getByText, findByText } = renderAt("ivan-petrov-abc123");
    await findByText("А Дейта Про");
    expect(getByText("София")).toBeTruthy();
    // The "see all" link points at the standalone browser for this slug.
    const link = getByText(/→/).closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/person/ivan-petrov-abc123/contracts",
    );
  });
  // (The non-linkable national settlement bucket is covered directly in
  // PersonProcurementBreakdownTile.test.tsx — the tile owns that link/non-link logic.)
});
