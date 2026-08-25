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
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The `t` mock echoes keys back — which is why assertions below name i18n KEYS rather
// than Bulgarian copy — EXCEPT for `tr_role_*`, which it really translates. That
// exception is load-bearing: with a pure echo, `trRoleLabel` falls back to the raw code
// for every input, so a render that had bypassed `trRoleList` entirely would produce
// byte-identical output and no assertion could tell the two apart. See the role-label
// test below, which is mutation-proven against exactly that.
const TR_ROLE_LABELS: Record<string, string> = {
  tr_role_partner: "съдружник",
  tr_role_actual_owner: "действителен собственик",
  tr_role_manager: "управител",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => TR_ROLE_LABELS[k] ?? k,
    i18n: { language: "bg" },
  }),
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

/** Stubs the page's `/api/db/person` load, and — when `shared` is given — the separate
 *  `/api/db/connection` call the „Проверка на връзка" button makes. Keyed on the URL
 *  because the two answer different shapes and a single body would let a connection
 *  assertion pass off the person payload. */
const stub = (
  body: Record<string, unknown>,
  shared?: Record<string, unknown>[],
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
    const url = String(input);
    const json = url.includes("/api/db/connection") ? { shared } : body;
    return { json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch);

const indexOfText = (id: string, needle: string): number =>
  (
    document.querySelector(`[data-dashboard-section="${id}"]`)?.textContent ??
    ""
  ).indexOf(needle);

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
});

describe("PersonScreen — Връзки reads by evidence, not by topic", () => {
  const associate = {
    name: "ПЕТЪР ПЕТРОВ",
    shared: 2,
    companies: [{ eik: "123456789", name: "АКМЕ ООД" }],
  };

  it("puts the two registry blocks adjacent, political links last", async () => {
    // Tier 3's ordering claim: „Проверка" reads the SAME tr_officers edge as „Кръг от
    // партньори", so it sits with it; „Политически връзки" reads another table with
    // another population, so it comes last and is labelled as different.
    stub(payload({ associates: [associate] }));
    show();
    // `expect(indexOfText(...))` with no matcher would be a no-op wait that resolves on
    // the first tick — assert the value so the wait actually waits for the fetch.
    await waitFor(() =>
      expect(
        indexOfText("person-connections", "Кръг от партньори"),
      ).toBeGreaterThanOrEqual(0),
    );
    const circle = indexOfText("person-connections", "Кръг от партньори");
    const check = indexOfText("person-connections", "Проверка на връзка");
    const political = indexOfText("person-connections", "Политически връзки");
    expect(circle).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(circle);
    expect(political).toBeGreaterThan(check);
  });

  it("states each block's evidence basis in the block", async () => {
    // The whole point of merging these into one section: without a per-block basis a
    // reader takes three different queries for three views of one dataset.
    stub(payload({ associates: [associate] }));
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Кръг от партньори"),
    );
    const text = sectionText("person-connections");
    // ALL THREE arms, one per block. An earlier cut of this test asserted only the
    // partners and political bases, and stayed 13/13 green with the check block's
    // whole <EvidenceBasis> deleted — a test named "each block" satisfied by an
    // implementation missing a third of them.
    // Partners: names the registry, and the exclusion by what it ACTUALLY removes.
    expect(text).toContain("съвместно вписване в Търговския регистър");
    expect(text).toContain("служебните записи на регистъра");
    // Check: names the block it shares an edge with, and that it drops the exclusions.
    expect(text).toContain("Търси същото");
    expect(text).toContain("без изключенията");
    // Political: names the two ways its population differs, in both directions.
    expect(text).toContain("декларирани дялове и длъжности");
    expect(text).toContain("спечелили обществени поръчки");
  });

  it("must NOT claim mass nominees were filtered out of the partner list", async () => {
    // Measured 2026-08-25, `officer_name_counts.company_count > 300` excludes exactly
    // one name-fold corpus-wide and it is „Заличено обстоятелство." — the registry's
    // deleted-fact placeholder, not a person. The real nominees (292 / 285 / 251) all
    // PASS and render here as partners, so copy promising they were removed tells the
    // reader the list is cleaner than it is, in the one line whose job is calibrating
    // trust in it. Kept as an assertion rather than a comment because the SQL's own
    // comment makes the same wrong claim and is the obvious thing to copy from.
    stub(payload({ associates: [associate] }));
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Кръг от партньори"),
    );
    const text = sectionText("person-connections");
    expect(text).not.toContain("масови пълномощници");
    expect(text).not.toMatch(/над 300 фирми.{0,40}са изключени/s);
  });

  it("does not name the partner cap below the limit", async () => {
    // `person_associates` ends in LIMIT 20 with no total beside it. Below the cap the
    // list is complete and „up to 20" would understate what the page knows.
    stub(payload({ associates: [associate] }));
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Кръг от партньори"),
    );
    expect(sectionText("person-connections")).not.toContain(
      "Показани са първите",
    );
  });

  it("names the partner cap AT the limit", async () => {
    // A separate `it` on purpose. Rendering twice inside one test leaves both trees in
    // the document — RTL cleans up in afterEach — and every helper in this file uses
    // `document.querySelector`, which returns the FIRST match, i.e. the stale render.
    stub(
      payload({
        associates: Array.from({ length: 20 }, (_, i) => ({
          ...associate,
          name: `ЛИЦЕ ${i}`,
        })),
      }),
    );
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain(
        "Показани са първите",
      ),
    );
  });

  it("reports a connection MISS as what was searched, never as absence", async () => {
    // The correctness fix. `connection_between` reads co-entry in tr_officers only, so
    // it is blind to a declared stake — the very edge Политически връзки is built on.
    // „Няма общи фирми" therefore denied, at a 200, a link the card below could be
    // asserting about the same named person.
    stub(payload({ associates: [] }), []);
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Проверка на връзка"),
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/друго име/), "Иван Петров");
    await user.click(screen.getByRole("button", { name: /Провери/ }));

    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    const text = sectionText("person-connections");
    // Scopes the claim to OUR copy of the register, not to the register itself —
    // `tr_officers` carries officers for 41% of companies, so for most firms the query
    // cannot find a co-entry that exists in reality.
    expect(text).toContain("В нашите данни");
    expect(text).not.toMatch(/не са вписани заедно/);
    // ...and does NOT claim there is no connection.
    expect(text).toContain("Това не значи, че връзка няма");
    // ...and points at the block that searches the other way, by a live anchor whose
    // target exists and can take focus.
    expect(
      document.querySelector('a[href="#person-political-links"]'),
    ).toBeInTheDocument();
    const target = document.getElementById("person-political-links");
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("tabindex", "-1");
  });

  it("names the TRIMMED term it searched, not what the box holds", async () => {
    stub(payload({ associates: [] }), []);
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Проверка на връзка"),
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/друго име/), "  Иван Петров  ");
    await user.click(screen.getByRole("button", { name: /Провери/ }));

    // The query is `other.trim()`, so the message must name that — otherwise a result
    // about two named individuals quotes a string nobody searched.
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("„Иван Петров“"),
    );
  });

  it("translates role codes in a hit rather than printing them raw", async () => {
    // The tier's role-label fix, mutation-proven. The fixture carries the RAW codes
    // Postgres returns; an earlier cut used Bulgarian ones, which made this assertion
    // pass identically whether or not `trRoleList` was called at all.
    stub(payload({ associates: [] }), [
      {
        uic: "123456789",
        company: "АКМЕ ООД",
        status: null,
        a_roles: "partner,actual_owner",
        b_roles: "manager",
      },
    ]);
    show();
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Проверка на връзка"),
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/друго име/), "Иван Петров");
    await user.click(screen.getByRole("button", { name: /Провери/ }));

    // Scoped to the section: „АКМЕ ООД" is also the company in the Фирми table above.
    await waitFor(() =>
      expect(sectionText("person-connections")).toContain("Общи фирми (1)"),
    );
    const text = sectionText("person-connections");
    expect(text).toContain("АКМЕ ООД");
    // Split AND translated — a lost split renders one unmatched key, a lost lookup
    // renders the English code.
    expect(text).toContain("съдружник, действителен собственик");
    expect(text).toContain("управител");
    expect(text).not.toContain("partner");
    expect(text).not.toContain("actual_owner");
    expect(screen.queryByText(/не се срещат заедно/)).toBeNull();
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
