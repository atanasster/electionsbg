// What these tiles must never do: print a number without its year, rank a
// school the corpus can't stand behind, imply МИР-grain data for a Sofia
// constituency МОН publishes city-wide, or state a value-added average without
// saying how few schools it covers.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EducationPlaceTile } from "./EducationPlaceTile";
import { EducationExpectedTile } from "./EducationExpectedTile";
import { resolveEducationPlaceKey } from "@/data/schools/useEducationPlace";
import type {
  EducationPlace,
  EducationPlaceSchool,
} from "@/data/schools/useEducationPlace";

// The SHIPPED bg bundle, not a stub: the coverage label and the two verdict
// strings carry placeholders, and a renamed one there would leave "{{covered}}"
// on screen while a key-only assertion still passed.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const school = (
  over: Partial<EducationPlaceSchool> & { id: string },
): EducationPlaceSchool => ({
  name: `Училище ${over.id}`,
  obshtina: "SML10",
  obshtinaName: "Смолян",
  score: 4.5,
  n: 20,
  predicted: 4.3,
  residual: 0.2,
  verdict: "above",
  vaResidual: 0.15,
  vaVerdict: "above",
  ...over,
});

const place = (over: Partial<EducationPlace> = {}): EducationPlace => ({
  grain: "region",
  code: "SML",
  latestYear: 2026,
  avg: 4.55,
  examinees: 743,
  schools: 22,
  rank: 2,
  rankOf: 28,
  nationalAvg: 4.33,
  series: [
    { year: 2022, avg: 4.12, examinees: 800, schools: 22 },
    { year: 2026, avg: 4.55, examinees: 743, schools: 22 },
  ],
  shareInFailingSchools: 3.4,
  rankable: 20,
  byObshtina: [
    {
      obshtina: "SML10",
      name: "Смолян",
      avg: 4.7,
      examinees: 500,
      schools: 12,
      delta: 0.4,
    },
    {
      obshtina: "SML31",
      name: "Чепеларе",
      avg: 4.2,
      examinees: 243,
      schools: 10,
      delta: -0.1,
    },
  ],
  top: [school({ id: "a", score: 5.28 })],
  bottom: [school({ id: "z", score: 3.55 })],
  above: [school({ id: "a", score: 5.28, predicted: 4.6, residual: 0.68 })],
  meanResidual: 0.12,
  va: { covered: 8, meanResidual: 0.09, rows: [school({ id: "a" })] },
  ...over,
});

const renderTile = (p: EducationPlace, aliasNote?: string | null) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <EducationPlaceTile place={p} aliasNote={aliasNote} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("EducationPlaceTile", () => {
  it("headlines the average with its year and the gap to the country", () => {
    renderTile(place());
    expect(screen.getByText("4,55")).toBeInTheDocument();
    // The year labels the headline and the table's average column.
    expect(screen.getAllByText("2026").length).toBeGreaterThan(0);
    // 4.55 − 4.33, with a real minus sign when negative.
    expect(screen.getByText(/\+0,22/)).toBeInTheDocument();
  });

  it("shows the change since the first year, against the headline average", () => {
    renderTile(place());
    // 4.55 − 4.12, and the first year's own number so the reader can check it.
    expect(screen.getByText(/От 2022 г.: \+0,43/)).toBeInTheDocument();
    expect(screen.getByText(/тогава 4,12/)).toBeInTheDocument();
  });

  it("names what each column of the по-общини table is", () => {
    renderTile(place());
    expect(
      screen.getByRole("columnheader", { name: "Община" }),
    ).toBeInTheDocument();
    // The change column names its baseline — otherwise "+0,40" is a change
    // against nothing a reader can see.
    expect(
      screen.getByRole("columnheader", { name: /от 2022/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Зрелостници" }),
    ).toBeInTheDocument();
  });

  it("drops the по-общини table when it would restate the headline", () => {
    // Sofia city is one município: a one-row table is not a comparison.
    renderTile(
      place({
        byObshtina: [
          {
            obshtina: "SOF00",
            name: "Столична община",
            avg: 4.69,
            examinees: 10934,
            schools: 155,
            delta: 0.26,
          },
        ],
      }),
    );
    expect(screen.queryByText("По общини")).not.toBeInTheDocument();
  });

  it("links every município to its place node and every school to its page", () => {
    renderTile(place());
    expect(screen.getByRole("link", { name: "Смолян" })).toHaveAttribute(
      "href",
      "/governance/SML10",
    );
    expect(screen.getByRole("link", { name: /Училище a/ })).toHaveAttribute(
      "href",
      "/school/a",
    );
  });

  it("keeps the methodology note, so it can't contradict /education", () => {
    renderTile(place());
    expect(screen.getByText(/2,00/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Всички училища/ }),
    ).toHaveAttribute("href", "/education");
  });

  it("discloses when the numbers are another place's", () => {
    renderTile(place({ code: "S24" }), "МОН публикува Столична община общо.");
    expect(screen.getByText(/Столична община общо/)).toBeInTheDocument();
  });

  it("omits the worst list when the blob suppressed it", () => {
    renderTile(place({ bottom: [] }));
    expect(screen.queryByText("Най-нисък успех")).not.toBeInTheDocument();
    expect(screen.getByText("Най-висок успех")).toBeInTheDocument();
  });

  it("says nothing about failing schools when there are none", () => {
    renderTile(place({ shareInFailingSchools: 0 }));
    expect(screen.queryByText(/под 3,00/)).not.toBeInTheDocument();
  });

  it("drops the rank line at município grain", () => {
    renderTile(place({ grain: "muni", rank: null, rankOf: null }));
    expect(screen.queryByText(/от 28 области/)).not.toBeInTheDocument();
    expect(screen.getByText(/22 училища/)).toBeInTheDocument();
  });
});

const renderExpected = (p: EducationPlace) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <EducationExpectedTile place={p} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("EducationExpectedTile", () => {
  it("states the direction and shows actual against predicted", () => {
    renderExpected(place());
    expect(screen.getByText(/над очакваното за средата/)).toBeInTheDocument();
    expect(
      screen.getByText(/постигнат 5,28 · очакван 4,60/),
    ).toBeInTheDocument();
    expect(screen.getByText("+0,68")).toBeInTheDocument();
  });

  it("calls a near-zero mean flat rather than a direction", () => {
    renderExpected(place({ meanResidual: 0.01 }));
    expect(screen.getByText(/приблизително очакваното/)).toBeInTheDocument();
  });

  it("reads a negative mean as below expectation", () => {
    renderExpected(place({ meanResidual: -0.31 }));
    expect(screen.getByText(/под очакваното за средата/)).toBeInTheDocument();
    expect(screen.getByText(/0,31/)).toBeInTheDocument();
  });

  it("labels the value-added line with its coverage", () => {
    renderExpected(place());
    // "за 8 от 20 училища" — never an unlabelled place-wide average.
    expect(screen.getByText(/8 от 20 училища/)).toBeInTheDocument();
  });

  it("hides the value-added line when too few schools carry a prior", () => {
    renderExpected(place({ va: { covered: 4, meanResidual: 0.4, rows: [] } }));
    expect(screen.queryByText(/Напредък 7→12/)).not.toBeInTheDocument();
  });

  it("says so when no school beats its context", () => {
    renderExpected(place({ above: [] }));
    expect(
      screen.getByText(/Няма училище, което да постига/),
    ).toBeInTheDocument();
  });

  it("renders nothing at all when there is no residual to speak from", () => {
    // 28 of 243 município blobs have no rankable school. "Performs about as
    // its context predicts" would be a verdict derived from no measurement.
    const { container } = renderExpected(
      place({
        meanResidual: null,
        above: [],
        rankable: 0,
        va: { covered: 0, meanResidual: null, rows: [] },
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("carries its own year and methodology note", () => {
    // It renders matura averages and can appear without the headline tile.
    renderExpected(place());
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/2,00/)).toBeInTheDocument();
  });

  it("says nothing about the province when the place is a município", () => {
    // The same tiles serve /governance/{obshtina} in phase 2; copy that names
    // an oblast would be wrong on 243 places.
    const { container } = renderExpected(place({ grain: "muni" }));
    expect(container.textContent).not.toMatch(/област/i);
  });
});

describe("resolveEducationPlaceKey", () => {
  it("sends every Sofia МИР to the city aggregate, flagged", () => {
    expect(resolveEducationPlaceKey("S23")).toEqual({
      key: "S23",
      aliased: false,
      reason: null,
    });
    for (const mir of ["S24", "S25"]) {
      expect(resolveEducationPlaceKey(mir)).toEqual({
        key: "S23",
        aliased: true,
        reason: "sofia-city",
      });
    }
  });

  it("folds the Plovdiv city constituency into the province", () => {
    expect(resolveEducationPlaceKey("PDV-00")).toEqual({
      key: "PDV",
      aliased: true,
      reason: "plovdiv-province",
    });
    expect(resolveEducationPlaceKey("PDV")).toEqual({
      key: "PDV",
      aliased: false,
      reason: null,
    });
  });

  it("passes an ordinary code through untouched", () => {
    expect(resolveEducationPlaceKey("SML10")).toEqual({
      key: "SML10",
      aliased: false,
      reason: null,
    });
  });
});
