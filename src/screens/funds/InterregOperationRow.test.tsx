// InterregOperationRow — the shared row shared by MyAreaInterregTile and
// FundsInterregProgrammeScreen. Both callers' tests exercise it only through
// fixtures that always carry a published budget; this pins the branch
// neither of them reaches.

import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { InterregListedOperation } from "@/data/funds/types";
import { InterregOperationRow } from "./InterregOperationRow";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const operation = (
  over: Partial<InterregListedOperation> = {},
): InterregListedOperation => ({
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
  ...over,
});

const mount = (op: InterregListedOperation) =>
  render(
    <MemoryRouter>
      <ul>
        <InterregOperationRow operation={op} bg lang="bg" />
      </ul>
    </MemoryRouter>,
  );

describe("the no-published-budget branch", () => {
  it("shows the unpublished-budget label when localBudgetEur is null", () => {
    mount(operation({ localBudgetEur: null, localBudgetBasis: "unpublished" }));
    expect(screen.getByText("без бюджет")).toBeTruthy();
  });

  it("shows the formatted euro figure when a budget is published", () => {
    mount(operation());
    expect(screen.queryByText("без бюджет")).toBeNull();
    expect(screen.getByText(/4 605 429|4605429/u)).toBeTruthy();
  });
});

describe("the English-title marker", () => {
  it("marks a titleBg-less row when reading in Bulgarian", () => {
    mount(operation({ titleBg: null }));
    expect(screen.getByText(/на английски/u)).toBeTruthy();
  });

  it("does not mark a row that has its own Bulgarian title", () => {
    mount(operation({ titleBg: "Развитие на река Дунав" }));
    expect(screen.queryByText(/на английски/u)).toBeNull();
    expect(screen.getByText("Развитие на река Дунав")).toBeTruthy();
  });
});

it("links to the operation's own detail page", () => {
  mount(operation());
  const link = screen.getByText("Development of the River Danube").closest("a");
  expect(link?.getAttribute("href")).toBe("/funds/interreg/17869");
});
