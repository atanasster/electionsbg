// The buy-side link's COPY — the half no source scan can reach.
//
// `?sector=` filters the browse table by the sector's whole EIK roster, so naming
// the lead institution is only true when the lead IS the roster. Inverting that
// branch renders „Обществените поръчки на МВР" over a table holding 73 other
// directorates: a wrong claim about whose contracts the reader is looking at,
// and one that looks perfectly fine on the single-member page a developer opens.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import bgDict from "@/locales/bg/translation.json";
import { PackContractsLink } from "./SectorDashboardScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

const wrap = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const show = (memberN: number, bg = true) =>
  render(
    <PackContractsLink
      to={{ pathname: "/procurement/contracts", search: "?sector=customs" }}
      name={bg ? "Агенция „Митници“" : "Customs Agency"}
      memberN={memberN}
      bg={bg}
    />,
    { wrapper: wrap },
  );

describe("PackContractsLink", () => {
  it("names the institution when it IS the whole roster", () => {
    show(1);
    expect(
      screen.getByText(/Обществените поръчки на Агенция „Митници“/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/на сектора/)).not.toBeInTheDocument();
  });

  it("names the SECTOR, with a count, when the roster is wider", () => {
    show(74);
    expect(
      screen.getByText("Обществените поръчки на сектора"),
    ).toBeInTheDocument();
    expect(screen.getByText(/74 възложители/)).toBeInTheDocument();
    // The institution's name must not appear — that is the wrong claim.
    expect(screen.queryByText(/Агенция „Митници“/)).not.toBeInTheDocument();
  });

  it("treats 2 as wider, not as single", () => {
    // The boundary: health is a 2-member sector, so an `>= 2` typo here is live.
    show(2);
    expect(
      screen.getByText("Обществените поръчки на сектора"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 възложители/)).toBeInTheDocument();
  });

  it("links to the destination it was given", () => {
    show(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/procurement/contracts?sector=customs",
    );
  });

  it("says the same thing in English", () => {
    show(74, false);
    expect(
      screen.getByText("Public contracts in this sector"),
    ).toBeInTheDocument();
    expect(screen.getByText(/What 74 awarders buy/)).toBeInTheDocument();
  });
});
