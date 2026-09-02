// MyAreaInterregTile's self-hide rule and its anchor id — the target of every
// "click a municipality with Interreg money" link elsewhere in this feature
// (InterregTile.tsx's movers list, FundsInterregProgrammeScreen.tsx's
// municipality list). A renamed or dropped anchor here breaks both silently,
// since neither of those is a compile-time reference to this file.
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import "@testing-library/jest-dom/vitest";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { bgCorpus as bg } from "@/locales/allKeys";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { GOVERNANCE_INTERREG_ANCHOR } from "@/screens/funds/InterregTile";
import { MyAreaInterregTile } from "./MyAreaInterregTile";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

// Intl formats bg-BG group separators with a non-breaking (or narrow-no-break)
// space, not a plain ASCII one — matching the pattern this codebase's other
// money-formatting tests already use.
const SP = "[\\s\\u00a0\\u202f]";

const stubFetch = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/db/interreg-place"))
        return new Response(JSON.stringify(body), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <MyAreaInterregTile obshtina="BGS12" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("self-hiding", () => {
  it("renders nothing for a place with zero Interreg operations", async () => {
    stubFetch({
      partnerCount: 0,
      operationCount: 0,
      budgetEur: 0,
      unpublishedPartnerCount: 0,
      linkedCount: 0,
      operations: [],
    });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("div")).toBeNull());
  });
});

describe("a place with Interreg money", () => {
  beforeEach(() => {
    stubFetch({
      partnerCount: 1,
      operationCount: 1,
      budgetEur: 357_183.12,
      unpublishedPartnerCount: 0,
      linkedCount: 1,
      operations: [
        {
          keepId: 33607,
          operationId: "BSB00963",
          programmeCode: "INTERREG-BSB-1420",
          programmeBg: "Черноморски басейн 2014-2020",
          programmeEn: "Black Sea Basin 2014-2020",
          period: "2014-2020",
          titleEn: "Cross-Border Cooperation for Promoting Bio-diversity",
          titleBg: null,
          titleLang: "en",
          status: "closed",
          startDate: null,
          endDate: null,
          operationTotalEur: 1_419_207.76,
          partnerCount: 5,
          countries: ["Bulgaria", "Turkey"],
          localBudgetEur: 357_183.12,
          localBudgetBasis: "published",
        },
      ],
    });
  });

  it("mounts at the shared governance anchor id", async () => {
    mount();
    await waitFor(() =>
      expect(document.getElementById(GOVERNANCE_INTERREG_ANCHOR)).toBeTruthy(),
    );
  });

  it("renders the operation's own share, not the whole cross-border total", async () => {
    // The intro line and the operation row both carry the same €357 183
    // figure, so this reads the whole tile's text rather than a single
    // element — the point is that BOTH figures appear, not which node holds
    // either one.
    const { container } = mount();
    await waitFor(() =>
      expect(container.textContent).toMatch(new RegExp(`357${SP}183`, "u")),
    );
    // The operation total (€1,419,208) appears only as labelled context,
    // never as the headline figure — see the module's own header comment.
    expect(container.textContent).toMatch(
      new RegExp(`1${SP}419${SP}20[78]`, "u"),
    );
  });

  it("links the operation to its own detail page", async () => {
    mount();
    await waitFor(() =>
      expect(
        screen
          .getByText(/Cross-Border Cooperation/u)
          .closest("a")
          ?.getAttribute("href"),
      ).toBe("/funds/interreg/33607"),
    );
  });
});
