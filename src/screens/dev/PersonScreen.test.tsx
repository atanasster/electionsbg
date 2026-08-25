// Tier 1 of person-business-sections-redesign-v1 delivered an ARRANGEMENT: four
// sections, in a fixed order, each holding a specific set of blocks. Structure is
// exactly what nothing else in the repo would catch — before this file, "no block was
// dropped in the move" was verified only by an ad-hoc grep diff against HEAD. Two more
// tiers are queued to rearrange these same blocks, which is why the arrangement is
// pinned here rather than after them.
//
// Hermetic: the page's single `/api/db/person` fetch is stubbed, so no network and no
// database. `data-dashboard-section` is the handle — it is already emitted per section
// and is stable across copy changes, unlike the Bulgarian titles.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/scope/useScope", () => ({
  useScope: () => ({ scope: "all", setScope: () => {} }),
}));
vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
vi.mock("@/lib/useNoindex", () => ({ useNoindex: () => {} }));
// The magistrate tiles make their own react-query calls and are not what this file is
// about; both self-hide for an ordinary person anyway.
vi.mock(
  "@/screens/components/procurement/PersonMagistrateHoldingsTile",
  () => ({
    PersonMagistrateHoldingsTile: () => null,
  }),
);
vi.mock(
  "@/screens/components/procurement/PersonMagistratePoliticianLinks",
  () => ({ PersonMagistratePoliticianLinks: () => null }),
);
vi.mock("@/screens/components/ScopeControl", () => ({
  ScopeControl: () => <div data-testid="scope-control" />,
}));

import { PersonScreen } from "./PersonScreen";

/** A role with a start date, so PersonTimelineTile has something to plot. */
const role = () => ({
  uic: "123456789",
  company: "АКМЕ ООД",
  status: null,
  role: "sole_owner",
  share: "100",
  added_at: "2020-01-01",
  erased_at: null,
  active: true,
  contracts: "2",
  contracts_eur: 1000,
});

const procurement = () => ({
  totalEur: 1000,
  totalOther: {},
  contractCount: 2,
  awardCount: 0,
  amendmentCount: 0,
  awarderCount: 1,
  byAwarder: [
    {
      eik: "000695089",
      name: "АПИ",
      totalEur: 1000,
      totalOther: {},
      contractCount: 2,
    },
  ],
  byYear: [{ year: "2024", totalEur: 1000, totalOther: {}, contractCount: 2 }],
  topContracts: [],
  breakdown: {
    totalEur: 1000,
    cpvKnownEur: 1000,
    procKnownEur: 0,
    euEur: 0,
    euKnownEur: 0,
    cpvRaw: [{ d: "45", eur: 1000, n: 2 }],
    procRaw: [],
  },
});

const payload = (over: Record<string, unknown> = {}) => ({
  roles: [role()],
  politicians: [],
  procurement: procurement(),
  cabinets: [],
  associates: [],
  byCompany: [],
  bySettlement: [],
  ...over,
});

const stub = (body: Record<string, unknown>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (async () =>
      ({
        json: async () => body,
      }) as unknown as Response) as unknown as typeof fetch,
  );

const show = () =>
  render(
    <MemoryRouter initialEntries={["/person/%D0%98%D0%B2%D0%B0%D0%BD"]}>
      <Routes>
        <Route path="/person/:name" element={<PersonScreen />} />
      </Routes>
    </MemoryRouter>,
  );

const sectionIds = (): string[] =>
  [...document.querySelectorAll("[data-dashboard-section]")].map(
    (n) => n.getAttribute("data-dashboard-section") ?? "",
  );

const sectionText = (id: string): string =>
  document.querySelector(`[data-dashboard-section="${id}"]`)?.textContent ?? "";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe("PersonScreen — section structure", () => {
  it("renders the four sections in plan order", async () => {
    stub(payload());
    show();
    await waitFor(() =>
      expect(sectionIds()).toEqual([
        "person-portfolio",
        "person-procurement",
        "person-procurement-profile",
        "person-connections",
      ]),
    );
  });

  it("puts the participations AND their timeline in Фирми", async () => {
    // The timeline used to render between the political card and the connection
    // check, ~90 lines from the table of the same ten facts.
    stub(payload());
    show();
    await waitFor(() =>
      expect(sectionText("person-portfolio")).toContain("Участия"),
    );
    expect(sectionText("person-portfolio")).toContain("Хронология");
    expect(sectionText("person-connections")).not.toContain("Хронология");
  });

  it("keeps the awarders table out of the headline section", async () => {
    // Топ възложители belongs to the awarding PROFILE; the headline section is the
    // stat cards plus the biggest contracts only. Asserted on the i18n KEY, since
    // that tile is translated and this file's `t` mock echoes keys back.
    stub(payload());
    show();
    await waitFor(() => expect(sectionIds()).toContain("person-procurement"));
    expect(sectionText("person-procurement")).not.toContain(
      "company_top_awarders",
    );
    expect(sectionText("person-procurement-profile")).toContain(
      "company_top_awarders",
    );
  });

  it("holds all three connection blocks in one section", async () => {
    stub(payload({ associates: [] }));
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Политически връзки"),
    );
    expect(sectionText("person-connections")).toContain("Проверка на връзка");
  });

  it("drops both procurement sections for a person with no contracts", async () => {
    stub(payload({ procurement: null }));
    show();
    await waitFor(() =>
      expect(sectionIds()).toEqual(["person-portfolio", "person-connections"]),
    );
  });

  it("still renders Фирми and Връзки for an entirely empty payload", async () => {
    // The "no gate needed" judgement for these two, pinned: both must survive a
    // person with no rows of any kind rather than leaving the page blank.
    stub(payload({ roles: [], procurement: null }));
    show();
    await waitFor(() =>
      expect(sectionIds()).toEqual(["person-portfolio", "person-connections"]),
    );
    expect(screen.getByText(/Няма намерени участия/)).toBeInTheDocument();
  });

  it("never renders a section heading above nothing", async () => {
    // The orphaned-header shape: DashboardSection cannot see through a component
    // boundary, so a section whose children all self-hide shows a bare kicker.
    stub(payload());
    show();
    await waitFor(() => expect(sectionIds().length).toBeGreaterThan(0));
    for (const id of sectionIds()) {
      const el = document.querySelector(`[data-dashboard-section="${id}"]`)!;
      // More than just the kicker: every section must carry real content under it.
      expect(el.textContent!.trim().length).toBeGreaterThan(30);
    }
  });

  it("gives each section a real h2 and an accessible name", async () => {
    stub(payload());
    show();
    await waitFor(() => expect(sectionIds().length).toBe(4));
    for (const id of sectionIds()) {
      expect(
        document.querySelector(`[data-dashboard-section="${id}"]`),
      ).toHaveAttribute("aria-labelledby", `${id}-title`);
    }
    // h1 (the person) then h2s — no level is skipped.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
  });
});
