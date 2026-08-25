// Component guard for the per-filing property rows.
//
// Three things are worth locking, and all three are about what the block must NOT say:
//
//  1. Таблица 1 means different things on different filings. On an ANNUAL declaration it is
//     property ACQUIRED during the period; on an ENTRY declaration it is the WHOLE estate at
//     the date of taking office. Same table, same columns — only the filing's `kind` tells
//     them apart, and heading an entry filing „Придобито през периода" would turn a career's
//     holdings into one year's purchases.
//  2. An empty answer is not „declared nothing". It is also a filing the operator crawl has
//     not reached, and a document the parser REFUSED — the pre-v3.0 form is refused
//     wholesale, 61% of filings. So an empty result renders nothing at all.
//  3. Money only from a positionally-exact row. A sparse row is placed by nearest column
//     header and can merge two cells, so its price is exactly the figure not to publish
//     against a named judge.
//
// Hermetic: the data hook is mocked (vitest.setup throws on an unstubbed fetch).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MagistrateFilingAsset } from "@/data/judiciary/useMagistrateHoldings";

const langMock = vi.hoisted(() => ({ current: "bg" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: langMock.current },
  }),
}));

const assetsMock = vi.hoisted(() => ({
  current: undefined as MagistrateFilingAsset[] | undefined,
}));
vi.mock("@/data/judiciary/useMagistrateHoldings", () => ({
  useMagistrateFilingAssets: (_url: string, enabled: boolean) =>
    enabled ? assetsMock.current : undefined,
}));

const { MagistrateFilingProperties } =
  await import("./MagistrateFilingProperties");

// Адалберт Кръстев's 2026 annual, as the serving function actually returns it.
const asset = (
  over: Partial<MagistrateFilingAsset> = {},
): MagistrateFilingAsset => ({
  tableNum: "1",
  ord: 1,
  kind: "Апартамент",
  location: "гр.София",
  municipality: "Столична",
  area: "86",
  builtArea: "86",
  priceLv: 448863,
  priceCurrency: "BGN",
  acquiredYear: 2025,
  holderName: "Адалберт Живков Кръстев",
  share: "СИО",
  legalBasis: "покупко-продажба",
  fundsOrigin: "заеми и заплата",
  exact: true,
  ...over,
});

const renderProps = (
  rows: MagistrateFilingAsset[] | undefined,
  kind?: string | null,
  expanded = true,
) => {
  assetsMock.current = rows;
  return render(
    <MagistrateFilingProperties
      sourceUrl="http://62.176.124.194/images/declaracii/2026/x.pdf"
      kind={kind}
      expanded={expanded}
    />,
  );
};

afterEach(() => {
  langMock.current = "bg";
});

describe("MagistrateFilingProperties", () => {
  it("renders a declared property with what the document says", () => {
    renderProps([asset()]);
    expect(screen.getByText("Апартамент")).toBeInTheDocument();
    expect(screen.getByText(/гр.София/)).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("СИО")).toBeInTheDocument();
    expect(screen.getByText(/448\s?863 лв/)).toBeInTheDocument();
  });

  it("heads an ANNUAL filing as acquisitions in the period", () => {
    renderProps([asset()], "annual");
    expect(screen.getByText("Придобито през периода")).toBeInTheDocument();
    expect(
      screen.queryByText(/Имущество към встъпване/),
    ).not.toBeInTheDocument();
  });

  it("heads an ENTRY filing as the estate held on taking office", () => {
    // ⚠️ The same table with the same columns. Calling it „придобито" here would say a
    // magistrate bought their whole estate in one year — Цацаров's entry filing lists 11
    // properties acquired between 2003 and 2018.
    renderProps([asset()], "entry");
    expect(
      screen.getByText("Имущество към встъпване в длъжност"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Придобито през периода"),
    ).not.toBeInTheDocument();
  });

  it("keeps acquisitions and transfers in separate, separately-headed lists", () => {
    // They are opposite claims about the same person and must never sit in one list.
    renderProps(
      [
        asset(),
        asset({ tableNum: "2", ord: 1, kind: "вила", priceLv: 120000 }),
      ],
      "annual",
    );
    expect(screen.getByText("Придобито през периода")).toBeInTheDocument();
    expect(screen.getByText("Прехвърлено през периода")).toBeInTheDocument();
  });

  it("withholds the price on a row the parser could not place exactly", () => {
    // A sparse row is assigned by nearest header and can merge two cells — measured, a year
    // and an owner arriving together. Its description is still worth showing; its money is not.
    renderProps([asset({ exact: false })]);
    expect(screen.getByText("Апартамент")).toBeInTheDocument();
    expect(screen.queryByText(/448/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when the filing yields no rows", () => {
    // ⚠️ NOT „declared no property". Also a filing the crawl has not reached, and a document
    // the parser refused — it accepts form v3.0 only, in both directions.
    const { container } = renderProps([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches nothing until the reader expands the filing", () => {
    // A magistrate can have 72 filings and most readers open none.
    const { container } = renderProps([asset()], "annual", false);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the request is still in flight", () => {
    const { container } = renderProps(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render the register's placeholder punctuation as a place", () => {
    // The form's empty cells come through as „:" and „…"; printed as a location they read
    // as a real place the magistrate declared.
    renderProps([asset({ location: ":", municipality: "…" })]);
    expect(screen.queryByText(/[:…]/)).not.toBeInTheDocument();
  });

  it("does not print the same place twice", () => {
    // The settlement cell and the municipality cell frequently agree — measured, 2,552 of
    // 11,584 rows — so a blind join renders „Балчик - … · Балчик", which reads as two places.
    // The elision marker is kept: it is the register saying the street is not published.
    renderProps([asset({ location: "Балчик - …", municipality: "Балчик" })]);
    expect(screen.getByText("Балчик - …")).toBeInTheDocument();
    expect(
      screen.queryByText(/Балчик · Балчик|Балчик - … · Балчик/),
    ).not.toBeInTheDocument();
  });

  it("still shows both when they are genuinely different places", () => {
    renderProps([asset({ location: "гр. София", municipality: "Столична" })]);
    expect(screen.getByText("гр. София · Столична")).toBeInTheDocument();
  });

  it("asserts NEITHER meaning when the filing's kind is unknown", () => {
    // ⚠️ 34.6% of filings state no kind — the ИВСС does not print the marker row on the older
    // layouts. Rounding that to `annual` publishes a false sentence: Дияна Пенчовска's
    // `unknown` filing lists five properties acquired 1991-2021, so „Придобито през периода"
    // claims she acquired a 1991 apartment during 2025. 330 filings span over five years.
    renderProps([asset()], "unknown");
    expect(
      screen.getByText("Имоти, описани в декларацията"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Придобито през периода"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Имущество към встъпване/),
    ).not.toBeInTheDocument();
  });

  it("asserts neither for a missing kind either", () => {
    renderProps([asset()], null);
    expect(
      screen.getByText("Имоти, описани в декларацията"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Придобито през периода"),
    ).not.toBeInTheDocument();
  });

  it("shows a euro price in euro, not silently as leva", () => {
    // ⚠️ v4.0 is the euro reissue of the same form, so 2026 carries both units side by side —
    // 3,483 v3.0 filings in лева against 201 v4.0 in евро. Printing a евро figure as „лв"
    // understates a named judge's declared price by 1.95583×, in a number that looks
    // completely ordinary.
    renderProps([asset({ priceLv: 20196, priceCurrency: "EUR" })]);
    expect(screen.getByText(/20\s?196\s?€/)).toBeInTheDocument();
    // ⚠️ `/лв/` alone is VACUOUS here — the block's caption says „лева", and „лв" is not a
    // substring of „лева", so the original assertion passed while the caption asserted leva
    // directly above a euro figure. Match both spellings.
    expect(screen.queryByText(/\bлв\b|лева/)).not.toBeInTheDocument();
  });

  it("prints NO unit when the document's unit was never recorded", () => {
    // Bare looks worse and is honest. Defaulting to „лв" is the same 1.95583× misstatement,
    // waiting for the first euro row whose unit the corpus predates.
    renderProps([asset({ priceLv: 20196, priceCurrency: null })]);
    expect(screen.getByText(/20\s?196/)).toBeInTheDocument();
    expect(screen.queryByText(/\bлв\b|лева|€/)).not.toBeInTheDocument();
  });

  it("renders the same block in English", () => {
    langMock.current = "en";
    renderProps([asset()], "annual");
    expect(screen.getByText("Acquired during the period")).toBeInTheDocument();
    expect(
      screen.getByText(/Extracted from the declaration itself/),
    ).toBeInTheDocument();
  });
});
