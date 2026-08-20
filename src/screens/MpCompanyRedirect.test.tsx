// The tombstone for /mp/company/:slug. Its whole job is to never dead-end, and to never
// invent a company page for a slug that has none.
//
// The retired screen had a test; this replaces it. What is NOT carried over is that file's
// subject matter — grouping, share-vs-role, the party-financing panel — because those moved:
// the first two to CompanyDeclaredStakesTile.test.tsx, and the party case to /party/:id,
// where it always belonged (parties register with the Sofia City Court, not the Commerce
// Registry, so they can never have a /company/:eik at all).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CompanyEntry } from "@/data/parliament/useCompanyIndex";

const index = vi.hoisted(() => ({
  rows: [] as CompanyEntry[],
  loading: false,
}));

vi.mock("@/data/parliament/useCompanyIndex", () => ({
  useCompanyIndex: () => ({
    companies: index.rows,
    bySlug: new Map(index.rows.map((c) => [c.slug, c])),
    isLoading: index.loading,
  }),
}));

const { MpCompanyRedirect } = await import("./MpCompanyRedirect");

const stake = (mpId: number) =>
  ({
    mpId,
    declarantName: "X",
    declarationYear: 2023,
  }) as CompanyEntry["stakes"][number];

const entry = (over: Partial<CompanyEntry>): CompanyEntry =>
  ({
    slug: "primer-ood",
    displayName: "Пример ООД",
    registeredOffices: [],
    stakes: [],
    ...over,
  }) as CompanyEntry;

/** Renders the redirect at the given slug and reports where it landed. */
const landOn = (
  slug: string,
  rows: CompanyEntry[],
  loading = false,
): string => {
  index.rows = rows;
  index.loading = loading;
  render(
    <MemoryRouter initialEntries={[`/mp/company/${encodeURIComponent(slug)}`]}>
      <Routes>
        <Route path="/mp/company/:slug" element={<MpCompanyRedirect />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByTestId("landed")?.textContent ?? "";
};

/** MemoryRouter keeps its history in memory, so `window.location` never moves — the landing
 *  path has to come from the router itself or every assertion reads "/". */
const Landed = () => {
  const { pathname } = useLocation();
  return <div data-testid="landed">{pathname}</div>;
};

describe("MpCompanyRedirect — where a retired company URL lands", () => {
  it("sends a slug with an EIK to that company's page", () => {
    // The fixture carries BOTH an EIK and a declarant on purpose. With stakes omitted, arms
    // 1 and 2 could be swapped and this still passed — and 1,145 of 2,969 index entries have
    // both, so the order is exactly what decides where they land.
    landOn("primer-ood", [
      entry({
        slug: "primer-ood",
        stakes: [stake(4598)],
        tr: { uic: "206258486", status: "active" } as CompanyEntry["tr"],
      }),
    ]);
    expect(screen.getByTestId("landed").textContent).toBe("/company/206258486");
  });

  it("renders nothing while the index is still loading", () => {
    // Redirecting before it lands would send EVERY visitor to the list, since no slug
    // resolves against an empty map — turning a transient state into a permanent wrong answer
    // for anyone whose fetch is slow.
    // The flag must be set BEFORE render — setting it after is a test that renders the
    // loaded path and then asserts about a state it never reached.
    index.rows = [];
    index.loading = true;
    const { container } = render(
      <MemoryRouter initialEntries={["/mp/company/primer-ood"]}>
        <Routes>
          <Route path="/mp/company/:slug" element={<MpCompanyRedirect />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='landed']")).toBeNull();
    index.loading = false;
  });

  it("never dead-ends on an unknown slug", () => {
    landOn("no-such-company", []);
    expect(screen.getByTestId("landed").textContent).toContain("/mp/companies");
  });

  it("sends an EIK-less slug declared by ONE person to that person", () => {
    // 808 of the 816 EIK-less entries. Their entire content is that declaration, which the
    // person's own profile renders with 096's reason attached.
    landOn("bez-eik", [entry({ slug: "bez-eik", stakes: [stake(4598)] })]);
    // The full path, not just the id — `toContain("4598")` passes on any URL that happens to
    // carry the number.
    expect(screen.getByTestId("landed").textContent).toBe("/candidate/mp-4598");
  });

  it("sends a PARTY to its financing register, not to one of its members", () => {
    // All five entries carrying a financing slug are political parties, none has an EIK
    // (parties register with the Sofia City Court), and three have exactly ONE declarant —
    // so with this arm below the declarant one, „ГЕРБ" would redirect to a single MP's
    // profile. The financing arm has to win.
    landOn("pp-gerb", [
      entry({
        slug: "pp-gerb",
        stakes: [stake(4598)],
        financing: { slug: "gerb" },
      }),
    ]);
    expect(screen.getByTestId("landed").textContent).toBe(
      "/financing/annual-reports/gerb",
    );
  });

  it("survives a malformed slug rather than blanking the app", () => {
    // React Router hands back the RAW segment on a bad escape, and there is no ErrorBoundary
    // in src/ — so a second decodeURIComponent here threw URIError during render and took
    // the whole app down, on the one route whose contract is "never dead-end".
    expect(() => landOn("%zz", [])).not.toThrow();
    expect(screen.getByTestId("landed").textContent).toBe("/mp/companies");
  });

  it("refuses to pick one of several declarants, and falls back to the list", () => {
    // Two people declaring one company is a finding ABOUT THE COMPANY. Redirecting to one of
    // them would publish half of it as the whole.
    landOn("bez-eik", [
      entry({ slug: "bez-eik", stakes: [stake(4598), stake(3643)] }),
    ]);
    const landed = screen.getByTestId("landed").textContent ?? "";
    expect(landed).toContain("/mp/companies");
    expect(landed).not.toContain("4598");
  });
});
