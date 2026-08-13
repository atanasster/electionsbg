// Component guard for the "фирми, регистрирани тук" tile.
//
// What it locks is the distinction the tile exists to draw: an OFFICER is a
// name on a Commerce-Registry filing and gets no link and no MP treatment,
// while a POLITICIAN chip is an EIK-keyed attribution. Its predecessor blurred
// exactly that line — it matched MPs to companies by name, which put one MP's
// face on 319 companies he had nothing to do with.
//
// Hermetic: `t` returns the key, both data hooks are mocked, fetch is never
// reached (vitest.setup throws on an unstubbed one).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PlaceCompanies } from "@/data/parliament/usePlaceCompanies";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

const placeData: { current: PlaceCompanies | null } = { current: null };
vi.mock("@/data/parliament/usePlaceCompanies", () => ({
  usePlaceCompanies: () => ({ data: placeData.current, isLoading: false }),
}));
// NO second mock. The tile used to fetch the retired `{id}-summary.json` shard purely to
// decide whether to render the link to the full page — one extra bucket round-trip on every
// governance dashboard. The gate is now a field on the tile's own payload.

import { PlaceCompaniesTile } from "./PlaceCompaniesTile";

const village = (over: Partial<PlaceCompanies> = {}): PlaceCompanies => ({
  count: 2,
  moneyCount: 0,
  politicalCount: 0,
  companies: [
    {
      uic: "208117541",
      name: "Агроинвест-24",
      legalForm: "EOOD",
      status: "active",
      moneyEur: 0,
      officers: [
        { name: "ГЕОРГИ ИВАНОВ ГЕОРГИЕВ", roles: "manager,sole_owner" },
      ],
      politicians: [],
    },
  ],
  ...over,
});

const renderTile = (data: PlaceCompanies | null) => {
  placeData.current = data;
  return render(
    <MemoryRouter>
      <PlaceCompaniesTile kind="muni" obshtina="VID33" />
    </MemoryRouter>,
  );
};

describe("PlaceCompaniesTile", () => {
  it("names the officer and links the row to the company, not to a person", () => {
    renderTile(village());
    expect(screen.getByText(/ГЕОРГИ ИВАНОВ ГЕОРГИЕВ/)).toBeInTheDocument();
    // The row carries exactly ONE href, and it is the company. No person or
    // candidate destination anywhere: the officer is a name, not an identity —
    // asserting on hrefs rather than on the link's accessible name, since the
    // whole row is the anchor and the officer text sits inside it.
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/company/208117541"]);
  });

  it("renders the officer's roles through the TR role vocabulary", () => {
    renderTile(village());
    // `t` echoes keys, so trRoleLabel falls back to the raw role names.
    expect(screen.getByText(/manager, sole_owner/)).toBeInTheDocument();
  });

  it("decodes the registry's HTML-escaped quotes", () => {
    renderTile(
      village({
        companies: [
          {
            uic: "1",
            name: "&quot;СЛАВЯНА - 2004&quot;",
            legalForm: null,
            status: "active",
            moneyEur: 0,
            officers: [],
            politicians: [],
          },
        ],
      }),
    );
    expect(screen.getByText('"СЛАВЯНА - 2004"')).toBeInTheDocument();
  });

  it("shows a politician chip only when the company carries one", () => {
    expect(renderTile(village()).container.textContent).not.toMatch(
      /Иван Политиков/,
    );
    renderTile(
      village({
        politicalCount: 1,
        companies: [
          {
            uic: "9",
            name: "СВЪРЗАНА ЕООД",
            legalForm: "EOOD",
            status: "active",
            moneyEur: 1000,
            officers: [],
            politicians: [
              {
                name: "Иван Политиков",
                ref: "/candidate/mp-1",
                kind: "mp",
                role: "manager",
              },
            ],
          },
        ],
      }),
    );
    expect(screen.getByText("Иван Политиков")).toBeInTheDocument();
  });

  it("self-suppresses when the place has no placeable company", () => {
    const { container } = renderTile({
      count: 0,
      moneyCount: 0,
      politicalCount: 0,
      companies: [],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the full people-linked page only where the place has such a company", () => {
    // The gate is `personLinkCount` on the tile's OWN payload — no second fetch, and the
    // SAME predicate the page filters on. `politicalCount` is a different question
    // (money-restricted) and gating on it hid the link on 218 of 260 municipalities that have
    // a page, so the two are asserted apart here rather than assumed to agree.
    renderTile(village({ personLinkCount: 0, politicalCount: 3 }));
    expect(
      screen.queryByText(/place_companies_see_mp_linked/),
    ).not.toBeInTheDocument();
    renderTile(village({ personLinkCount: 3, politicalCount: 0 }));
    expect(
      screen.getByRole("link", { name: /place_companies_see_mp_linked/ }),
    ).toHaveAttribute("href", "/settlement/VID33/companies");
  });

  it("always carries the coverage + ranking caveat", () => {
    renderTile(village());
    expect(screen.getByText("place_companies_source_note")).toBeInTheDocument();
  });
});
