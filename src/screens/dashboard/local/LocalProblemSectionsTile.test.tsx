// The local „Проблемни секции" table — what it counts, and which município's districts it may
// show.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LocalProblemSectionsReport } from "@/data/local/useLocalProblemSections";
import { LocalProblemSectionsTile } from "./LocalProblemSectionsTile";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

let report: LocalProblemSectionsReport | undefined;

vi.mock("@/data/local/useLocalProblemSections", () => ({
  useLocalProblemSections: () => ({ data: report }),
}));
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({
    displayNameForId: (id: string) => (id === "gerb" ? "ГЕРБ-СДС" : undefined),
  }),
}));

const neighborhood = (
  over: Partial<LocalProblemSectionsReport["neighborhoods"][number]> = {},
): LocalProblemSectionsReport["neighborhoods"][number] => ({
  id: "stolipinovo",
  name_bg: "Столипиново / Шекер махала",
  name_en: "Stolipinovo / Sheker mahala",
  city_bg: "Пловдив",
  city_en: "Plovdiv",
  source_url: "https://www.segabg.com/hot/x",
  obshtinaCode: "PDV22",
  obshtinaName: "Пловдив",
  rayonCode: "02",
  sectionCount: 70,
  numRegisteredVoters: 40000,
  totalActualVoters: 12066,
  numValidVotes: 10000,
  parties: [
    {
      localPartyNum: 4,
      localPartyName: "БЪЛГАРСКА ПРОГРЕСИВНА ЛИНИЯ",
      primaryCanonicalId: null,
      color: "#123456",
      votes: 2087,
    },
    {
      localPartyNum: 1,
      localPartyName: "ГЕРБ",
      primaryCanonicalId: "gerb",
      color: "#0088cc",
      votes: 1760,
    },
  ],
  ...over,
});

const mount = (props: { obshtinaCode: string; rayonCode?: string }) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <LocalProblemSectionsTile cycle="2023_10_29_mi" {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
  report = { cycle: "2023_10_29_mi", neighborhoods: [neighborhood()] };
});

describe("LocalProblemSectionsTile", () => {
  it("counts sections, voters and turnout for the município's districts", () => {
    mount({ obshtinaCode: "PDV22" });
    expect(screen.getByText("Столипиново / Шекер махала")).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("12,066")).toBeTruthy();
    // 12,066 of 40,000 registered.
    expect(screen.getByText("30.2%")).toBeTruthy();
  });

  it("names the leading slate by its CANONICAL name where there is one", () => {
    // ⚠ A local ballot number is OIK-scoped and reassigned each cycle, so the raw slate name is
    // the fallback and the canonical id is what makes „ГЕРБ" the same party across cycles.
    report = {
      cycle: "2023_10_29_mi",
      neighborhoods: [
        neighborhood({
          parties: [
            {
              localPartyNum: 1,
              localPartyName: "ГЕРБ",
              primaryCanonicalId: "gerb",
              color: "#0088cc",
              votes: 4000,
            },
          ],
        }),
      ],
    };
    mount({ obshtinaCode: "PDV22" });
    expect(screen.getByText("ГЕРБ-СДС")).toBeTruthy();
    // 4,000 of 10,000 valid council votes — the same base the by-party tile beside it uses.
    expect(screen.getByText("40.0%")).toBeTruthy();
    expect(screen.getByText("4,000")).toBeTruthy();
  });

  it("shows a district only on ITS município", () => {
    mount({ obshtinaCode: "VAR06" });
    expect(screen.queryByText("Столипиново / Шекер махала")).toBeNull();
  });

  it("narrows to the административен район on a drill-down page", () => {
    // ⚠ Sofia's районни pages re-anchor to the SOF bundle plus a 2-digit код; a tile that
    // ignored it would show Филиповци on every Sofia район.
    mount({ obshtinaCode: "PDV22", rayonCode: "07" });
    expect(screen.queryByText("Столипиново / Шекер махала")).toBeNull();
    mount({ obshtinaCode: "PDV22", rayonCode: "02" });
    expect(screen.getByText("Столипиново / Шекер махала")).toBeTruthy();
  });

  it("links the district to the report that named it", () => {
    // ⚠⚠ „РИСКОВ" IS SOMEBODY ELSE'S PUBLISHED FINDING — the same rule the presidential twin
    // of this tile follows.
    mount({ obshtinaCode: "PDV22" });
    const link = screen.getByText(bgCorpus.source);
    expect(link.getAttribute("href")).toBe("https://www.segabg.com/hot/x");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders NOTHING when the report has not loaded", () => {
    report = undefined;
    const { container } = mount({ obshtinaCode: "PDV22" });
    expect(container.textContent).toBe("");
  });
});
