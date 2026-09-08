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
    // ⚠ A TABLE OF THE COMPARABLE ONES ALONE READS AS „THESE ARE THE CANDIDATES", with the ones
    // everyone came to read about quietly absent.
    mount(SPLIT);
    expect(screen.getByText(/Йоло Димитров Денев/)).toBeTruthy();
    // ⚠ THE SINGULAR, BECAUSE THIS FIXTURE HAS ONE UNCOVERED FINALIST. The sentence was an
    // un-pluralised key reading „двамата, стигнали до балотажа" whatever the count — so it said
    // „the two" about one named man, and this assertion pinned that wording in place.
    expect(screen.getByText(/стигнал до балотажа/)).toBeTruthy();
    // ⚠ TWICE, AND BOTH TIMES DELIBERATELY: once in the list of pairs with no list, and once in
    // the sentence saying a finalist is among them. A reader who reads only one of the two
    // paragraphs must still learn it.
    expect(screen.getAllByText(/Румен Георгиев Радев/).length).toBe(2);
  });

  it("gives the reason a finalist is uncompared, rather than only the fact", () => {
    // ⚠⚠ THE ASYMMETRY IS THE RISK. Once one finalist is compared on an endorsement and the
    // other is not, „Радев не е в таблицата" with no reason reads as a choice about the two
    // men. The reason is that several parties on SEPARATE lists backed him, so no single list
    // can stand for his vote.
    mount(SPLIT);
    expect(screen.getByText(/няколко партии с отделни листи/)).toBeTruthy();
  });

  const ENDORSED: SplitTicket = {
    ...SPLIT,
    endorsedBasis: "ПОДКРЕПАТА, НЕ БЮЛЕТИНАТА",
    endorsedBasisEn: "THE BACKING, NOT THE BALLOT",
    endorsed: [
      {
        number: 15,
        president: "Анастас Георгиев Герджиков",
        nominator: "ИК за Анастас Герджиков и Невяна Митева",
        listName: "ГЕРБ-СДС",
        listNumber: 32,
        sourceUrl: "https://example.org/gerb-backs-gerdzhikov",
        ticketVotes: 590594,
        listVotes: 578726,
        minSplitVoters: 96708,
        sections: 12488,
      },
    ],
    refused: [
      ...SPLIT.refused,
      {
        number: 15,
        president: "Анастас Георгиев Герджиков",
        nominator: "ИК за Анастас Герджиков и Невяна Митева",
        kind: "committee",
        reason: "committee",
        reachedRunoff: true,
      },
    ],
  };

  it("renders the endorsement rows under their OWN heading and basis", () => {
    // ⚠⚠ NEVER IN THE TABLE ABOVE. The floor is computed identically, but „ДПС's list against
    // ДПС's ticket" is one entity on one ballot while this is two entities joined by somebody
    // else's published decision — so the two may not share a heading.
    mount(ENDORSED);
    expect(
      screen.getByText(bgCorpus.presidential_split_endorsed_heading),
    ).toBeTruthy();
    expect(screen.getByText("ПОДКРЕПАТА, НЕ БЮЛЕТИНАТА")).toBeTruthy();
    const row = screen.getByText(/Анастас Георгиев Герджиков/).closest("tr");
    expect(row?.textContent).toMatch(/590\s*594/);
    expect(row?.textContent).toMatch(/96\s*708/);
  });

  it("cites the endorsement ON THE ROW, not in a footnote", () => {
    // ⚠⚠ THE JOIN IS THE ONE CLAIM HERE THE BALLOT DOES NOT MAKE, so the evidence sits beside
    // the figure a reader might copy out.
    mount(ENDORSED);
    const link = screen.getByText(bgCorpus.source);
    expect(link.getAttribute("href")).toBe(
      "https://example.org/gerb-backs-gerdzhikov",
    );
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("stops saying an ENDORSED pair has no list to compare against", () => {
    // ⚠⚠ THE PAGE CONTRADICTING ITSELF. Герджиков is committee-nominated — true, and the
    // endorsement block's own basis says so — but naming him among „нямат листа, с която да
    // бъдат сравнени" while comparing him twenty lines below is the defect this subtraction
    // exists to prevent. He must appear ONCE, in the endorsement table.
    mount(ENDORSED);
    expect(screen.getAllByText(/Анастас Георгиев Герджиков/).length).toBe(1);
    // …and the surviving refusal sentence still names the one who really has no list.
    expect(screen.getAllByText(/Румен Георгиев Радев/).length).toBe(2);
  });

  it("renders the main table when the artifact predates the endorsement field", () => {
    // ⚠ DEPLOY ORDER. `split_ticket.json` is gitignored and reaches the bucket only through
    // `bucket:gz`, so a bundle carrying this feature WILL meet an older artifact. The
    // endorsement block is absent; nothing else may be.
    const { container } = mount(SPLIT);
    expect(
      screen.queryByText(bgCorpus.presidential_split_endorsed_heading),
    ).toBeNull();
    expect(container.textContent).toContain("ДПС");
    expect(screen.getByText("ДОЛНАТА ГРАНИЦА ОТ ФАЙЛА")).toBeTruthy();
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
