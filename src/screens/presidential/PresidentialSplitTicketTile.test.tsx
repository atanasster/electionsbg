// The tile's three claims, each of which would render as a working table.
//
// ⚠ THE COPY IS THE CONTRACT. „поне" must reach every figure, the derivation must come from the
// artifact rather than a locale file, and the nine committee-nominated pairs — both finalists
// among them — must be NAMED rather than quietly missing from a table of fourteen.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresidentialSplitTicketTile } from "./PresidentialSplitTicketTile";
import type { SplitTicket } from "@/data/presidential/useSplitTicket";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const SPLIT: SplitTicket = {
  cycle: "2021_11_14_pvr",
  sameDayElection: "2021_11_14",
  basis: "ДОЛНАТА ГРАНИЦА ОТ ФАЙЛА",
  basisEn: "THE BOUND FROM THE FILE",
  pairs: [
    {
      number: 17,
      president: "Мустафа Сали Карадайъ",
      nominator: "Движение за права и свободи – ДПС",
      listName: "ДПС",
      ticketVotes: 222598,
      listVotes: 253257,
      minSplitVoters: 41235,
      sections: 12488,
    },
  ],
  refused: [
    {
      number: 6,
      president: "Румен Георгиев Радев",
      nominator: "ИК за Румен Радев и Илияна Йотова",
      kind: "committee",
      reason: "committee",
      reachedRunoff: true,
    },
    {
      number: 1,
      president: "Йоло Димитров Денев",
      nominator: "ИК за Йоло Денев и Марио Филев",
      kind: "committee",
      reason: "committee",
      reachedRunoff: false,
    },
  ],
  coverage: {
    basis: "ОБХВАТ",
    basisEn: "COVERAGE",
    sectionsMatched: 12488,
    sectionsPvrOnly: 0,
    sectionsNsOnly: 750,
  },
};

const mount = (split: SplitTicket) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PresidentialSplitTicketTile split={split} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialSplitTicketTile", () => {
  it("renders the derivation the ARTIFACT carries", () => {
    mount(SPLIT);
    expect(screen.getByText("ДОЛНАТА ГРАНИЦА ОТ ФАЙЛА")).toBeTruthy();
  });

  it("switches to the artifact's ENGLISH derivation rather than dropping it", async () => {
    // ⚠ SEPARATE TESTS, because `render` does not unmount the previous tree — two mounts in one
    // test leave both in the document and every `getByText` finds two.
    await i18n.changeLanguage("en");
    mount(SPLIT);
    expect(screen.getByText("THE BOUND FROM THE FILE")).toBeTruthy();
    expect(screen.queryByText("ДОЛНАТА ГРАНИЦА ОТ ФАЙЛА")).toBeNull();
  });

  it("qualifies the figure IN THE CELL, not only in the column head", () => {
    // ⚠ A NUMBER COPIED OUT OF A TABLE TAKES ITS CAPTION WITH IT ONLY IF THE CAPTION IS BESIDE
    // IT. „41 235" alone is a count of people who changed their minds; „поне 41 235" is what
    // the data supports.
    mount(SPLIT);
    const cell = screen.getByText(/поне/);
    expect(cell.textContent).toMatch(/41\s*235/);
  });

  it("names the pairs it cannot compare, and says the finalists are among them", () => {
    // ⚠ A TABLE OF THE COMPARABLE ONES ALONE READS AS „THESE ARE THE CANDIDATES", with the two
    // everyone came to read about quietly absent.
    mount(SPLIT);
    expect(screen.getByText(/Йоло Димитров Денев/)).toBeTruthy();
    expect(screen.getByText(/стигнали до балотажа/)).toBeTruthy();
    // ⚠ TWICE, AND BOTH TIMES DELIBERATELY: once in the list of pairs with no list, and once in
    // the sentence saying a finalist is among them. A reader who reads only one of the two
    // paragraphs must still learn it.
    expect(screen.getAllByText(/Румен Георгиев Радев/).length).toBe(2);
  });

  it("never calls a NON-committee refusal committee-nominated", () => {
    // ⚠ THE TRIPWIRE FOR THE ONE FALSE CLAIM THIS TILE CAN MAKE. `reason` distinguishes a fact
    // about the BALLOT (an инициативен комитет put this pair up) from a fact about OUR MATCHER
    // (the nominator is on the ballot and we could not resolve their list). Rendering the
    // second through the committee sentence invents a nominator kind the register did not
    // record — and `nominatedBy.kind` is „unknown" for 10 of 2021's 14 matched nominators, so
    // the population at risk is most of the table.
    const { container } = mount({
      ...SPLIT,
      refused: [
        {
          number: 7,
          president: "Партиен Кандидат",
          nominator: "КОАЛИЦИЯ Y-Z",
          kind: "coalition",
          reason: "no-list",
          reachedRunoff: false,
        },
      ],
    });
    expect(container.textContent ?? "").toMatch(/Партиен Кандидат/);
    expect(container.textContent ?? "").not.toMatch(/инициативн/i);
  });

  it("uses the singular where there is one refusal", () => {
    // „Още 1 двойки" is what a `{{count}}` key with no `_one`/`_other` siblings renders.
    const { container } = mount({ ...SPLIT, refused: [SPLIT.refused[0]] });
    expect(container.textContent ?? "").not.toMatch(/Още 1 двойки/);
  });

  it("never states a share of a party's voters", () => {
    // ⚠ THE ONE SENTENCE THIS TILE MAY NOT CARRY. „N% от избирателите на партията" is an
    // ecological inference; a floor on a symmetric difference is not.
    const { container } = mount(SPLIT);
    expect(container.textContent ?? "").not.toMatch(/%/);
  });
});
