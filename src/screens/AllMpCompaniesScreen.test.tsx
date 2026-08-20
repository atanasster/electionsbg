// Which company rows on /mp/companies make a navigable identity claim.
//
// The screen had no test at all while the decision it makes is the same one the sibling
// surface got two tests for: 816 of the 2,969 index entries carry NO EIK, so there is no
// company page to reach and a link would promise one. The other 2,153 carry a UIC that
// `tr/integrate.ts` attached on a name-uniqueness check alone — good enough to navigate by,
// not good enough to describe as confirmed, which is why the interim state is documented at
// the call site and replaced wholesale in Tier 3.
//
// Deliberately NOT asserted here: sort order, the MP chips, the status badges. This file
// exists for the link branch, and the screen is scheduled for replacement.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompanyEntry } from "@/data/parliament/useCompanyIndex";

const companies = vi.hoisted(() => ({ current: [] as CompanyEntry[] }));

vi.mock("@/data/parliament/useCompanyIndex", () => ({
  useCompanyIndex: () => ({
    companies: companies.current,
    bySlug: new Map(),
    isLoading: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));

const { AllMpCompaniesScreen } = await import("./AllMpCompaniesScreen");

const entry = (over: Partial<CompanyEntry>): CompanyEntry =>
  ({
    slug: "primer-ood",
    displayName: "Пример ООД",
    registeredOffices: [],
    stakes: [],
    mpRoles: [],
    ...over,
  }) as CompanyEntry;

const draw = (rows: CompanyEntry[]) => {
  companies.current = rows;
  return render(
    <MemoryRouter>
      <AllMpCompaniesScreen />
    </MemoryRouter>,
  );
};

const hrefs = (): string[] =>
  screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "");

describe("AllMpCompaniesScreen — which names are links", () => {
  it("links a company that has an EIK to its /company/:eik page", () => {
    draw([
      entry({
        displayName: "Пример ООД",
        tr: { uic: "204361427", status: "active" } as CompanyEntry["tr"],
      }),
    ]);
    expect(hrefs()).toContain("/company/204361427");
  });

  it("renders a company with NO EIK as text, never as a link", () => {
    // 816 of 2,969 entries. There is no page behind them — the retired /mp/company/{slug}
    // was the only thing that ever pretended otherwise.
    draw([entry({ displayName: "Адвокатско дружество Иванов и Ко" })]);
    expect(
      screen.getByText("Адвокатско дружество Иванов и Ко"),
    ).toBeInTheDocument();
    expect(hrefs().some((h) => h.startsWith("/company/"))).toBe(false);
  });

  it("never emits a link to the retired declared-name route", () => {
    draw([
      entry({
        slug: "primer-ood",
        tr: { uic: "204361427", status: "active" } as CompanyEntry["tr"],
      }),
      entry({ slug: "bez-eik", displayName: "Без ЕИК" }),
    ]);
    expect(hrefs().some((h) => h.startsWith("/mp/company/"))).toBe(false);
  });

  it("a mixed page links only the rows that can be reached", () => {
    draw([
      entry({
        slug: "s-eik",
        displayName: "С ЕИК",
        tr: { uic: "111222333", status: "active" } as CompanyEntry["tr"],
      }),
      entry({ slug: "bez-eik", displayName: "Без ЕИК" }),
    ]);
    expect(hrefs().filter((h) => h.startsWith("/company/"))).toEqual([
      "/company/111222333",
    ]);
  });
});
