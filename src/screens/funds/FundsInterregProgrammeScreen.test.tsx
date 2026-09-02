// FundsInterregProgrammeScreen's render branching — the 200+null contract
// that distinguishes "no such programme" from "the request failed" (same
// convention as FundsInterregScreen, the operation page beside it), and that
// a loaded programme renders its operations and municipalities with the
// links a reader actually needs.

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { InterregProgrammeDetail } from "@/data/funds/types";

const hook = vi.hoisted(() => ({
  data: undefined as InterregProgrammeDetail | null | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@/data/funds/useInterreg", async (orig) => ({
  ...(await orig<typeof import("@/data/funds/useInterreg")>()),
  useInterregProgramme: () => ({
    data: hook.data,
    isLoading: hook.isLoading,
    isError: hook.isError,
  }),
}));

vi.mock("@/data/municipalities/useMunicipalities", () => ({
  useMunicipalities: () => ({
    municipalities: [],
    findMunicipality: (code?: string | null) =>
      code === "RSE27"
        ? { obshtina: "RSE27", name: "Русе", name_en: "Ruse" }
        : undefined,
  }),
}));

const { FundsInterregProgrammeScreen } =
  await import("./FundsInterregProgrammeScreen");

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const programme = (
  over: Partial<InterregProgrammeDetail> = {},
): InterregProgrammeDetail => ({
  code: "INTERREG-ROBG-1420",
  nameBg: "ИНТЕРРЕГ V-A Румъния - България 2014-2020",
  nameEn: "INTERREG V-A Romania-Bulgaria",
  period: "2014-2020",
  cci: null,
  eligibleNuts: null,
  coverageNote: null,
  budgetEur: 130_933_260,
  partnerCount: 226,
  operationCount: 169,
  placedCount: 223,
  linkedCount: 0,
  unpublishedPartnerCount: 0,
  operations: [
    {
      keepId: 17869,
      operationId: null,
      programmeCode: "INTERREG-ROBG-1420",
      programmeBg: "ИНТЕРРЕГ V-A Румъния - България 2014-2020",
      programmeEn: "INTERREG V-A Romania-Bulgaria",
      period: "2014-2020",
      titleEn: "Development of the River Danube",
      titleBg: null,
      titleLang: "en",
      status: "closed",
      startDate: "2017-05-12",
      endDate: "2023-11-11",
      operationTotalEur: 7_349_963,
      partnerCount: 2,
      countries: ["Bulgaria", "Romania"],
      localBudgetEur: 4_605_429,
      localBudgetBasis: "published",
    },
  ],
  munis: [
    {
      obshtina: "RSE27",
      budgetEur: 19_028_132,
      partnerCount: 36,
      operationCount: 30,
    },
  ],
  ...over,
});

const mount = (code = "INTERREG-ROBG-1420") =>
  render(
    <MemoryRouter initialEntries={[`/funds/interreg/programme/${code}`]}>
      <Routes>
        <Route
          path="/funds/interreg/programme/:code"
          element={<FundsInterregProgrammeScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  hook.data = undefined;
  hook.isLoading = false;
  hook.isError = false;
});

describe("the 200+null contract", () => {
  it("renders nothing while loading", () => {
    hook.isLoading = true;
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an ERROR, distinguishable from not-found", () => {
    hook.isError = true;
    mount();
    expect(screen.getByText(/грешка при заявката/u)).toBeTruthy();
    expect(screen.queryByText(/Няма такава програма/u)).toBeNull();
  });

  it("renders not-found for a null payload, with a way back", () => {
    hook.data = null;
    mount();
    expect(screen.getByText(/Няма такава програма/u)).toBeTruthy();
    // Matched by its own link text, not a bare /Interreg/ pattern — the page
    // now also carries an <h1>Interreg</h1> from the fixed <Title> usage.
    const back = screen.getByText("Към Interreg").closest("a");
    expect(back?.getAttribute("href")).toBe("/funds/interreg");
  });
});

describe("a loaded programme", () => {
  beforeEach(() => {
    hook.data = programme();
  });

  it("renders the programme's own name as the ONE heading", () => {
    mount();
    expect(
      screen.getByRole("heading", {
        name: "ИНТЕРРЕГ V-A Румъния - България 2014-2020",
      }),
    ).toBeTruthy();
    // <Title>'s children become its own <h1> — a second explicit <h1> in the
    // page body (an earlier draft had one) would nest one inside the other.
    expect(document.querySelectorAll("h1").length).toBe(1);
  });

  it("sets the document title and meta description", () => {
    mount();
    // <SEO> adds a site-name prefix, so this checks the programme name
    // REACHED document.title at all — the bug being tested for is an EMPTY
    // title, not the exact string.
    expect(document.title).toMatch("ИНТЕРРЕГ V-A Румъния - България 2014-2020");
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBeTruthy();
  });

  it("shows the unpublished-partner caveat only when there is one to show", () => {
    const { unmount } = mount();
    expect(
      screen.queryByText(
        /партньор.*без публикуван бюджет|carry no published budget/iu,
      ),
    ).toBeNull();
    unmount();

    hook.data = programme({ unpublishedPartnerCount: 4 });
    mount();
    expect(document.body.textContent).toMatch(/4/);
  });

  it("lists its operations, linking each to /funds/interreg/:keepId", () => {
    mount();
    const link = screen
      .getByText(/Development of the River Danube/u)
      .closest("a");
    expect(link?.getAttribute("href")).toBe("/funds/interreg/17869");
  });

  it("lists its municipalities, linking each to the governance dashboard", () => {
    mount();
    const link = screen.getByText("Русе").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/governance/RSE27#myarea-interreg",
    );
  });

  it("shows a coverage note only when the programme is genuinely empty", () => {
    hook.data = programme({
      operationCount: 0,
      operations: [],
      munis: [],
      budgetEur: 0,
      coverageNote: "0 of 616 partnerships in keep.eu.",
    });
    const { container } = mount();
    expect(container.textContent).toMatch(/0 of 616 partnerships/u);
  });
});
