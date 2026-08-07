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

// Only the two data hooks are stubbed — FILING_STATUSES and the rest stay
// real, so PartyAnnualReportPanel renders its true markup.
type Shard = import("@/data/financing/useFinancingReports").PartyShard;
let financingShard: Shard | null | undefined;
vi.mock("@/data/financing/useFinancingReports", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/data/financing/useFinancingReports")
  >()),
  useFinancingPartyReport: () => ({ data: financingShard }),
  useFinancingReportsSummary: () => ({ data: { years: [{ year: 2025 }] } }),
}));

const shard = (): Shard => ({
  slug: "vazrazhdane",
  name: "Възраждане",
  firstYear: 2021,
  lastYear: 2025,
  counts: { on_time: 5, late: 0, non_compliant: 0, not_filed: 0 },
  complianceRate: 1,
  filings: [
    {
      year: 2025,
      deadline: "2026-03-31",
      status: "on_time",
      reportDocId: "1",
      reportUrl: "https://gfopp.bulnao.government.bg/GfoUp.aspx?ID=1",
    },
  ],
});

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

// The ДА България case. A standing relationship is re-declared at every entry
// into office, and one интереси filing can list it in BOTH the held-now and
// the held-before table — so the index legitimately carries the same fact
// three times for Ивайло Мирчев's board seat. Rendered one-row-per-filing it
// read as three identical rows, two of them captioned "Декларация 2021" with
// nothing to separate the 45th National Assembly from the 46th.
const party = (): CompanyEntry => ({
  slug: "Политическа-партия-Движение-ДА-българия",
  displayName: 'Политическа партия "Движение ДА българия"',
  registeredOffices: [],
  stakes: [
    {
      mpId: 5244,
      declarantName: "ИВАЙЛО НИКОЛАЕВ МИРЧЕВ",
      declarationYear: 2023,
      fiscalYear: null,
      institution: "49-то Народно събрание",
      sourceUrl: "https://register.cacbg.bg/2023/…148665.xml",
      stake: {
        table: "10",
        stakeKind: "role",
        shareSize: "ЧЛЕН НА УПРАВИТЕЛЕН СЪВЕТ",
        valueEur: null,
        legalBasis: null,
        fundsOrigin: null,
      },
    },
    {
      // Same filing, held-before table.
      mpId: 5244,
      declarantName: "ИВАЙЛО НИКОЛАЕВ МИРЧЕВ",
      declarationYear: 2023,
      fiscalYear: null,
      institution: "49-то Народно събрание",
      sourceUrl: "https://register.cacbg.bg/2023/…148665.xml",
      stake: {
        table: "11",
        stakeKind: "role",
        shareSize: "ЧЛЕН НА УПРАВИТЕЛЕН СЪВЕТ",
        valueEur: null,
        legalBasis: null,
        fundsOrigin: null,
      },
    },
    {
      // A separate 2021 filing — different mandate, casing differs too.
      mpId: 5244,
      declarantName: "ИВАЙЛО НИКОЛАЕВ МИРЧЕВ",
      declarationYear: 2021,
      fiscalYear: null,
      institution: "Народно събраниe",
      sourceUrl: "https://register.cacbg.bg/2021_nc/…122967.xml",
      stake: {
        table: "10",
        stakeKind: "role",
        shareSize: "Член на управителен съвет",
        valueEur: null,
        legalBasis: null,
        fundsOrigin: null,
      },
    },
  ],
});

describe("MpCompanyScreen — declared roles vs declared stakes", () => {
  it("collapses one relationship's repeated filings into a single row", () => {
    renderCompany(party());
    expect(screen.getAllByTestId("avatar")).toHaveLength(1);
    expect(
      screen.getByText(/company_roles_declared \(1\)/),
    ).toBeInTheDocument();
  });

  const sourceLinks = () =>
    screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h) => h?.startsWith("https://register.cacbg.bg"));

  it("keeps a source link per year and body, never per filing", () => {
    renderCompany(party());
    // Three stake rows, two distinct filings from two bodies: the same-URL
    // table-10/11 pair must not produce two links to the identical document.
    expect(new Set(sourceLinks()).size).toBe(2);
    expect(sourceLinks()).toHaveLength(2);
  });

  // Entering and leaving a mandate each triggers a filing, so one unchanged
  // holding can carry four documents in a year. Аврамов's 50% arrives with
  // eight for 2021 alone — a wall of identical "2021" links.
  it("collapses a year's repeat filings from the same body to one link", () => {
    const repeats = party();
    const base = repeats.stakes[0];
    repeats.stakes = [1, 2, 3, 4].map((n) => ({
      ...base,
      declarationYear: 2021,
      institution: "Народно събраниe",
      sourceUrl: `https://register.cacbg.bg/2021_nc/${n}.xml`,
    }));
    renderCompany(repeats);
    expect(sourceLinks()).toHaveLength(1);
  });

  // The register labels BOTH of Мирчев's 2021 mandates "Народно събраниe",
  // so they are indistinguishable to the key and collapse. A deliberate lost
  // source: either document proves the same seat. The tiebreak must make the
  // survivor stable, so a rebuild never silently cites a different one.
  it("collapses same-year filings the register labels identically", () => {
    const sameLabel = party();
    const base = sameLabel.stakes[0];
    const rows = [
      {
        ...base,
        declarationYear: 2021,
        institution: "Народно събраниe" as const,
        sourceUrl: "https://register.cacbg.bg/2021_nc/b.xml",
      },
      {
        ...base,
        declarationYear: 2021,
        institution: "Народно събраниe" as const,
        sourceUrl: "https://register.cacbg.bg/2021_nc/a.xml",
      },
    ];
    sameLabel.stakes = rows;
    renderCompany(sameLabel);
    expect(sourceLinks()).toEqual(["https://register.cacbg.bg/2021_nc/a.xml"]);
  });

  // The tiebreak's whole job: same two filings, opposite index order, same
  // surviving citation. Must be its own test — renderCompany does not unmount,
  // so a second render in one test leaves both in the DOM.
  it("cites the same filing whichever order the index lists them in", () => {
    const flipped = party();
    const base = flipped.stakes[0];
    const at = (name: string) => ({
      ...base,
      declarationYear: 2021,
      institution: "Народно събраниe",
      sourceUrl: `https://register.cacbg.bg/2021_nc/${name}.xml`,
    });
    flipped.stakes = [at("a"), at("b")];
    renderCompany(flipped);
    expect(sourceLinks()).toEqual(["https://register.cacbg.bg/2021_nc/a.xml"]);
  });

  it("but keeps both bodies when one year spans two parliaments", () => {
    const twoBodies = party();
    const base = twoBodies.stakes[0];
    twoBodies.stakes = [
      {
        ...base,
        declarationYear: 2021,
        institution: "45-то Народно събрание",
        sourceUrl: "https://register.cacbg.bg/2021_nc/a.xml",
      },
      {
        ...base,
        declarationYear: 2021,
        institution: "45-то Народно събрание",
        sourceUrl: "https://register.cacbg.bg/2021_nc/b.xml",
      },
      {
        ...base,
        declarationYear: 2021,
        institution: "46-то Народно събрание",
        sourceUrl: "https://register.cacbg.bg/2021_nc/c.xml",
      },
    ];
    renderCompany(twoBodies);
    expect(sourceLinks()).toHaveLength(2);
  });

  it("names every year the relationship was declared in", () => {
    renderCompany(party());
    expect(screen.getByText(/declaration_year 2023, 2021/)).toBeInTheDocument();
  });

  it("files a directorship under roles, never under declared stakes", () => {
    renderCompany(party());
    expect(
      screen.getByText(/company_roles_declared \(1\)/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/company_stakes_held_by_mps/),
    ).not.toBeInTheDocument();
  });

  it("never labels a role 'transferred' — table 11 means something else", () => {
    renderCompany(party());
    expect(screen.queryByText(/stake_transferred/)).not.toBeInTheDocument();
  });

  it("still says transferred for a share that really was", () => {
    const sold = party();
    sold.stakes = [
      {
        ...sold.stakes[0],
        stake: {
          table: "11",
          stakeKind: "share",
          shareSize: "50%",
          valueEur: 1000,
          legalBasis: null,
          fundsOrigin: null,
        },
      },
    ];
    renderCompany(sold);
    expect(screen.getByText(/stake_transferred/)).toBeInTheDocument();
    expect(
      screen.getByText(/company_stakes_held_by_mps \(1\)/),
    ).toBeInTheDocument();
  });

  // Димитър Аврамов's single 50% of Гала-инвест-холдинг arrives as 28 rows
  // across five years, and the value/basis fields are blank on some of them —
  // so a key that includes those fields still leaves four rows of one holding.
  it("keeps one holding on one row when only the value drifts", () => {
    const holding = party();
    const base = {
      mpId: 4000,
      declarantName: "Димитър Иванов Аврамов",
      fiscalYear: null,
      institution: "51-во Народно събрание",
    };
    holding.stakes = [
      {
        ...base,
        declarationYear: 2025,
        sourceUrl: "https://register.cacbg.bg/2025/a.xml",
        stake: {
          table: "10",
          stakeKind: "share",
          shareSize: "50%",
          valueEur: 153387.56,
          legalBasis: "покупка",
          fundsOrigin: null,
        },
      },
      {
        ...base,
        declarationYear: 2023,
        sourceUrl: "https://register.cacbg.bg/2023/b.xml",
        stake: {
          table: "10",
          stakeKind: "share",
          shareSize: "50%",
          valueEur: null,
          legalBasis: null,
          fundsOrigin: null,
        },
      },
    ];
    renderCompany(holding);
    expect(
      screen.getByText(/company_stakes_held_by_mps \(1\)/),
    ).toBeInTheDocument();
    // A year left blank must not erase a figure declared in another year.
    expect(screen.getByText(/153/)).toBeInTheDocument();
    expect(screen.getByText("покупка")).toBeInTheDocument();
  });

  it("still separates two genuinely different holdings", () => {
    const two = party();
    const base = {
      mpId: 4000,
      declarantName: "Димитър Иванов Аврамов",
      fiscalYear: null,
      institution: "51-во Народно събрание",
      declarationYear: 2025,
    };
    two.stakes = [
      {
        ...base,
        sourceUrl: "https://register.cacbg.bg/2025/a.xml",
        stake: {
          table: "10",
          stakeKind: "share",
          shareSize: "50%",
          valueEur: 100,
          legalBasis: null,
          fundsOrigin: null,
        },
      },
      {
        ...base,
        sourceUrl: "https://register.cacbg.bg/2025/b.xml",
        stake: {
          table: "10",
          stakeKind: "share",
          shareSize: "25%",
          valueEur: 50,
          legalBasis: null,
          fundsOrigin: null,
        },
      },
    ];
    renderCompany(two);
    expect(
      screen.getByText(/company_stakes_held_by_mps \(2\)/),
    ).toBeInTheDocument();
  });

  it("treats a stake with no stakeKind as a share (older index files)", () => {
    const legacy = party();
    legacy.stakes = [
      {
        ...legacy.stakes[0],
        stake: { ...legacy.stakes[0].stake, stakeKind: undefined },
      },
    ];
    renderCompany(legacy);
    expect(
      screen.getByText(/company_stakes_held_by_mps \(1\)/),
    ).toBeInTheDocument();
  });
});

// The commit's central claim is "render no panel rather than borrow someone
// else's record", and until now it was tested only at the build layer
// (enrichWithFinancing) — never at the layer that decides what a reader sees.
describe("MpCompanyScreen — the party financing panel", () => {
  const financingParty = (): CompanyEntry => ({
    ...party(),
    financing: { slug: "vazrazhdane" },
  });

  it("shows the heading and the panel once the shard has arrived", () => {
    financingShard = shard();
    renderCompany(financingParty());
    expect(screen.getByText("annual_reports_panel_title")).toBeInTheDocument();
    expect(screen.getByText("annual_reports_panel_entity")).toBeInTheDocument();
  });

  // The heading used to be gated on `financing` alone while the panel returns
  // null until its query resolves — so every first paint of five party pages
  // drew a heading over empty space.
  it("shows no heading while the shard is still loading", () => {
    financingShard = undefined;
    renderCompany(financingParty());
    expect(
      screen.queryByText("annual_reports_panel_title"),
    ).not.toBeInTheDocument();
  });

  // Permanent version of the same thing: the link stores a slug resolved at
  // build time, the shards come from a separate scraper run, so a re-slug
  // leaves a 404 behind.
  it("shows no heading when the shard 404s", () => {
    financingShard = null;
    renderCompany(financingParty());
    expect(
      screen.queryByText("annual_reports_panel_title"),
    ).not.toBeInTheDocument();
  });

  // A coalition, or a party predating the 2011 register: no link was ever
  // resolved. It must render nothing rather than borrow a neighbour's record.
  it("shows no heading for a party the register does not carry", () => {
    financingShard = shard();
    const unlinked = party();
    expect(unlinked.financing).toBeUndefined();
    renderCompany(unlinked);
    expect(
      screen.queryByText("annual_reports_panel_title"),
    ).not.toBeInTheDocument();
  });
});
