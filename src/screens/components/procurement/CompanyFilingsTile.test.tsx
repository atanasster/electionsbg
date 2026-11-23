// Component guard for the „Обявени документи" tile on /company/:eik.
//
// The property locked here is the one this source can break: an absent filing is NOT
// a non-filing. The feed stopped listing ГФО on 2026-10-12, so the tile must (1) hide
// on an empty list rather than render „nothing filed", and (2) carry the coverage
// caveat on every render. Hermetic: fetch is never reached (the pure view is tested).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  actLabel,
  CompanyFilingsView,
  documentUrl,
  groupByYear,
  type CompanyFilings,
  type FilingAct,
} from "./CompanyFilingsTile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

let n = 0;
const act = (over: Partial<FilingAct> = {}): FilingAct => ({
  actId: (n++).toString(16).padStart(32, "0"),
  kind: "Годишен финансов отчет",
  family: "gfo",
  fiscalYear: 2023,
  description: null,
  announcedOn: null,
  firstSeenFeedDay: "2024-07-01",
  erased: false,
  ...over,
});

const data = (acts: FilingAct[]): CompanyFilings => ({
  acts,
  inCr: false,
  coverage: {
    feedFrom: "2021-01-01",
    feedTo: "2026-11-21",
    feedGfoTo: "2026-10-11",
  },
});

describe("groupByYear", () => {
  it("puts the three annual families on one row per year, newest first, no-year last", () => {
    const rows = groupByYear([
      act({ fiscalYear: 2022 }),
      act({ fiscalYear: 2023, family: "report" }),
      act({ fiscalYear: null, family: "declaration" }),
      act({ fiscalYear: 2023 }),
      act({ family: "other", fiscalYear: null }),
    ]);
    expect(rows.map((r) => r.year)).toEqual([2023, 2022, null]);
    expect(rows[0].byFamily.gfo).toHaveLength(1);
    expect(rows[0].byFamily.report).toHaveLength(1);
    expect(rows[2].byFamily.declaration).toHaveLength(1);
  });
});

describe("actLabel", () => {
  it("names a split filing's components and numbers only the unnamed ones", () => {
    const opr = act({ description: "ОПР" });
    const a = act({ description: "за 2008 г." });
    const b = act();
    const cell = [opr, a, b];
    expect(actLabel(opr, cell)).toBe("ОПР");
    expect(actLabel(a, cell)).toBe("PDF 1");
    expect(actLabel(b, cell)).toBe("PDF 2");
    const solo = act({ description: "Годишен финансов отчет 2016" });
    expect(actLabel(solo, [solo, opr])).toBe("PDF");
  });
});

describe("CompanyFilingsView", () => {
  it("renders nothing for an empty list — never „filed nothing“", () => {
    const { container } = render(<CompanyFilingsView data={data([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each act to the registry PDF and states the coverage caveat", () => {
    const a = act({ announcedOn: "2024-06-28" });
    render(<CompanyFilingsView data={data([a])} />);
    const link = screen.getByRole("link", { name: /PDF/ });
    expect(link).toHaveAttribute("href", documentUrl(a.actId));
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("28.06.2024")).toBeInTheDocument();
    expect(
      screen.getByText(/не означава, че фирмата не го е подала/),
    ).toBeInTheDocument();
    expect(screen.getByText(/след 11\.10\.2026/)).toBeInTheDocument();
  });

  it("falls back to the feed's first-seen day when the announcement date is unknown", () => {
    render(<CompanyFilingsView data={data([act()])} />);
    expect(screen.getByText("в регистъра към 01.07.2024")).toBeInTheDocument();
  });

  it("previews six years and expands to all", () => {
    const acts = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((y) =>
      act({ fiscalYear: y }),
    );
    render(<CompanyFilingsView data={data(acts)} />);
    expect(screen.queryByText("2017")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Покажи всички 8 години"));
    expect(screen.getByText("2016")).toBeInTheDocument();
  });

  it("lists non-annual acts separately by their description", () => {
    render(
      <CompanyFilingsView
        data={data([
          act({
            family: "other",
            fiscalYear: null,
            kind: "Актуален дружествен договор/учредителен акт/устав",
          }),
        ])}
      />,
    );
    expect(screen.getByText(/Други обявени актове/)).toBeInTheDocument();
    expect(
      screen.getByText("Актуален дружествен договор/учредителен акт/устав"),
    ).toBeInTheDocument();
  });
});
