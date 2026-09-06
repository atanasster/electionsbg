// The pill's one behaviour: it appears on the pair that exists and on nothing else.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { ToLocalSameDay, ToPresidentialSameDay } from "./SameDayElectionLink";
import { PRESIDENTIAL_CATALOGUE } from "@/data/presidentialCatalogue";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const mount = (node: React.ReactNode) =>
  render(<MemoryRouter>{node}</MemoryRouter>);

describe("ToPresidentialSameDay", () => {
  it("links a local cycle to the presidential vote held the same day", () => {
    mount(<ToPresidentialSameDay cycle="2011_10_23_mi" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/presidential/2011_10_23_pvr");
    // ⚠ THE LABEL NAMES THE OTHER VOTE AND ITS YEAR. „See also" would leave a reader to guess
    // what they are being told, and what they are being told is a fact most do not know.
    expect(link.textContent).toMatch(/2011/);
    expect(link.textContent).toMatch(/резидент/);
  });

  it("keeps the place when the page has one", () => {
    // ⚠ 261 OF 262 LOCAL 2011 CODES HAVE A PRESIDENTIAL MUNICIPALITY PAGE. Dropping to the
    // national result would throw away the place the reader was looking at.
    mount(<ToPresidentialSameDay cycle="2011_10_23_mi" obshtina="SML09" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/presidential/2011_10_23_pvr/municipality/SML09",
    );
  });

  it("falls back to the country page for the one code with no twin", () => {
    // ⚠ `SOF` IS THE LOCAL TREE'S SYNTHETIC CITY AGGREGATE and has no presidential page; a
    // place-scoped URL for it would be a link to nothing.
    mount(<ToPresidentialSameDay cycle="2011_10_23_mi" obshtina="SOF" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/presidential/2011_10_23_pvr",
    );
  });

  it("renders NOTHING where no presidential vote shared the day", () => {
    // Four of the five local cycles. A disabled pill would point at a page that does not exist.
    const { container } = mount(
      <ToPresidentialSameDay cycle="2023_10_29_mi" />,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders nothing for an unknown cycle rather than guessing from the slug", () => {
    const { container } = mount(
      <ToPresidentialSameDay cycle="2016_11_06_mi" />,
    );
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("ToLocalSameDay", () => {
  it("links the presidential cycle back", () => {
    // ⚠ BOTH DIRECTIONS. A pill on one side only is a route a reader can take once and never
    // find again.
    mount(<ToLocalSameDay cycle="2011_10_23_pvr" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/local/2011_10_23_mi",
    );
  });

  it("renders nothing on the cycles with no local vote that day", () => {
    // ⚠ ALL FOUR, iterated from the catalogue — the earlier version said „the four" and listed
    // two. 2016 is the interesting one: a PARTIAL local cycle really was held that day and is
    // excluded by decision, not by absence (see `sameDayPresidential.ts`).
    for (const c of PRESIDENTIAL_CATALOGUE.map((e) => e.name).filter(
      (n) => n !== "2011_10_23_pvr",
    )) {
      const { container } = mount(<ToLocalSameDay cycle={c} />);
      expect(container.querySelector("a"), c).toBeNull();
    }
  });

  it("labels the pair in English too", async () => {
    // Every label branches on language and no assertion had ever rendered the EN one.
    await i18n.changeLanguage("en");
    mount(<ToLocalSameDay cycle="2011_10_23_pvr" />);
    expect(screen.getByRole("link").textContent).toMatch(
      /Local elections 2011/,
    );
    await i18n.changeLanguage("bg");
  });
});
