// Component guard for /mp/company/{slug}. The bug it locks: 1,914 of the 2,705
// companies-index entries carry NO per-officer TR rows (the officer-coverage
// ceiling — `tr.currentOfficers`/`currentOwners` are hardcoded empty on the
// TR-only entries augment_mp_roles.ts appends) and are linked to an MP ONLY
// through `mpRoles`. The page rendered neither, so a settlement tile advertising
// "Агроинвест-24 · Георги Иванов Георгиев · управител" deep-linked to a page
// saying "no current officers or owners" and "declared stakes (0)".
//
// Hermetic: fetch is stubbed by vitest.setup, and MpAvatar (which pulls the
// parliament index) is mocked out. `t` returns the key, so assertions read keys.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CompanyEntry } from "@/data/parliament/useCompanyIndex";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/screens/components/candidates/MpAvatar", () => ({
  MpAvatar: ({ name }: { name?: string | null }) => (
    <span data-testid="avatar">{name}</span>
  ),
}));

const bySlug = new Map<string, CompanyEntry>();
vi.mock("@/data/parliament/useCompanyIndex", () => ({
  useCompanyIndex: () => ({ companies: [], bySlug, isLoading: false }),
}));

import { MpCompanyScreen } from "./MpCompanyScreen";

const trOnly = (): CompanyEntry => ({
  slug: "Агроинвест-24",
  displayName: "Агроинвест-24",
  registeredOffices: ["БЪЛГАРИЯ, с. Динково, 3921"],
  stakes: [],
  mpRoles: [
    {
      mpId: 5113,
      mpName: "Георги Иванов Георгиев",
      role: "manager",
      isCurrent: true,
      confidence: "medium",
    },
    {
      mpId: 5113,
      mpName: "Георги Иванов Георгиев",
      role: "sole_owner",
      isCurrent: true,
      confidence: "medium",
    },
  ],
  tr: {
    uic: "208117541",
    legalForm: "EOOD",
    status: "active",
    seat: "БЪЛГАРИЯ, с. Динково, 3921",
    lastUpdated: null,
    currentOfficers: [],
    currentOwners: [],
  },
});

const renderCompany = (entry: CompanyEntry) => {
  bySlug.clear();
  bySlug.set(entry.slug, entry);
  return render(
    <MemoryRouter initialEntries={[`/mp/company/${encodeURI(entry.slug)}`]}>
      <Routes>
        <Route path="/mp/company/:slug" element={<MpCompanyScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("MpCompanyScreen — MPs linked via the Commerce Registry", () => {
  it("renders the mpRoles block when the company has no per-officer TR rows", () => {
    renderCompany(trOnly());
    expect(screen.getByText("company_mps_via_tr")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Георги Иванов Георгиев/ }),
    ).toHaveAttribute("href", "/candidate/mp-5113");
    // Both roles of the same MP collapse onto ONE row, comma-joined — the tile
    // that links here shows only the first, so the page must not lose the rest.
    // `t` returns the key here, so trRoleLabel falls back to the raw role name.
    expect(screen.getByText("manager, sole_owner")).toBeInTheDocument();
  });

  it("no longer claims 'no officers or owners' when mpRoles carry the link", () => {
    renderCompany(trOnly());
    expect(screen.queryByText("tr_no_current_records")).not.toBeInTheDocument();
  });

  it("suppresses the empty declared-stakes card (the '(0)' card)", () => {
    renderCompany(trOnly());
    expect(
      screen.queryByText(/company_stakes_held_by_mps/),
    ).not.toBeInTheDocument();
  });

  it("still shows the empty state when there is genuinely nobody on file", () => {
    const bare = trOnly();
    bare.mpRoles = [];
    // Only reachable via a stake-linked entry; the index drops link-less rows.
    bare.stakes = [
      {
        mpId: 5113,
        declarantName: "Георги Иванов Георгиев",
        declarationYear: 2025,
        fiscalYear: null,
        institution: "51-во Народно събрание",
        sourceUrl: "https://register.cacbg.bg/2025/x.xml",
        stake: {
          table: "10",
          shareSize: "100%",
          valueEur: 5,
          legalBasis: null,
          fundsOrigin: null,
        },
      },
    ];
    renderCompany(bare);
    expect(screen.getByText("tr_no_current_records")).toBeInTheDocument();
    expect(screen.getByText(/company_stakes_held_by_mps/)).toBeInTheDocument();
  });

  it("marks an MP whose every role was erased as former", () => {
    const former = trOnly();
    former.mpRoles = [
      {
        mpId: 4858,
        mpName: "Виктор Тенчев Папазов",
        role: "partner",
        isCurrent: false,
        confidence: "high",
      },
    ];
    renderCompany(former);
    expect(
      screen.getByText(/partner · company_conn_former/),
    ).toBeInTheDocument();
  });

  it("keeps a current MP current when only SOME of their roles ended", () => {
    const mixed = trOnly();
    mixed.mpRoles = [
      {
        mpId: 3309,
        mpName: "Ивайло Красимиров Кожухаров",
        role: "manager",
        isCurrent: true,
        confidence: "high",
      },
      {
        mpId: 3309,
        mpName: "Ивайло Красимиров Кожухаров",
        role: "sole_owner",
        isCurrent: false,
        confidence: "high",
      },
    ];
    renderCompany(mixed);
    expect(screen.queryByText(/company_conn_former/)).not.toBeInTheDocument();
  });
});
