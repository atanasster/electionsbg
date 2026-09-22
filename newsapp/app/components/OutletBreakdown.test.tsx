import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OutletBreakdown } from "./OutletBreakdown";
import { NewsLocaleProvider } from "../i18n";
import type { OutletBreakdownRow } from "../data";

const row = (
  domain: string,
  counts: OutletBreakdownRow["counts"],
  over: Partial<OutletBreakdownRow> = {},
): OutletBreakdownRow => {
  const assessed = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return {
    domain,
    counts,
    rows: assessed,
    assessed,
    first_published: null,
    last_published: null,
    value_mean: null,
    value_scored: 0,
    value_se: null,
    ...over,
  };
};

const draw = (rows: OutletBreakdownRow[], language: "bg" | "en" = "bg") =>
  render(
    <MemoryRouter>
      <NewsLocaleProvider language={language}>
        <OutletBreakdown rows={rows} subject="ПП-ДБ" />
      </NewsLocaleProvider>
    </MemoryRouter>,
  );

describe("OutletBreakdown", () => {
  it("groups outlets by the framing that predominates in their coverage", () => {
    draw([
      row("actualno.com", { favorable: 2 }),
      row("pik.bg", { unfavorable: 3 }),
      row("bta.bg", { neutral: 4 }),
    ]);
    expect(screen.getAllByText(/преобладаващо/).length).toBe(3);
    expect(screen.getAllByText("pik.bg").length).toBeGreaterThan(0);
  });

  it("renders every outlet's ACTUAL distribution, not only the summary", () => {
    // ⚠️ THE MITIGATION THE COMMENTS PROMISED AND THE FIRST CUT OMITTED.
    // Without it „pik.bg · 5" under „преобладаващо негативен" reads as five
    // negative articles when it is three neutral and two negative.
    draw([row("pik.bg", { unfavorable: 2, neutral: 3 })]);
    expect(screen.getByText(/преобладаващо/)).toHaveTextContent("неутрален");
    expect(screen.getByText(/неутрален 3/)).toBeInTheDocument();
    expect(screen.getByText(/негативен 2/)).toBeInTheDocument();
  });

  it("names the subject, so the claim is about coverage of it", () => {
    draw([row("pik.bg", { unfavorable: 1 })]);
    expect(screen.getByRole("heading")).toHaveTextContent("ПП-ДБ");
    expect(screen.getByText(/не оценка на самото издание/)).toBeInTheDocument();
  });

  it("never says 'mostly' about a single article", () => {
    draw([row("once.bg", { unfavorable: 1 })]);
    expect(screen.getByText(/един материал/)).toBeInTheDocument();
    expect(screen.queryByText(/преобладаващо/)).not.toBeInTheDocument();
  });

  it("separates 'no assessment published' from 'no single framing'", () => {
    draw([
      row("split.bg", { favorable: 2, unfavorable: 2 }),
      row("quiet.bg", {}, { rows: 4, assessed: 0 }),
    ]);
    expect(screen.getByText(/без преобладаваща рамка/)).toBeInTheDocument();
    expect(screen.getByText(/без публикувана оценка/)).toBeInTheDocument();
  });

  it("spells the denominator out rather than showing a bare slash", () => {
    draw([row("partial.bg", { neutral: 2 }, { rows: 5 })]);
    expect(screen.getByText(/2 оценени от 5/)).toBeInTheDocument();
    expect(screen.queryByText("2/5")).not.toBeInTheDocument();
  });

  it("links each outlet to its own page", () => {
    draw([row("pik.bg", { unfavorable: 2 })]);
    expect(screen.getByRole("link", { name: "pik.bg" })).toHaveAttribute(
      "href",
      "/outlet/pik.bg",
    );
  });

  it("gives the section an accessible name", () => {
    draw([row("pik.bg", { unfavorable: 2 })]);
    // The outlet appears twice by design — once in the summary, once in the
    // distribution list — so the assertion is on the region, not the count.
    const section = screen.getByRole("region", { name: /ПП-ДБ/ });
    expect(within(section).getAllByText("pik.bg").length).toBe(2);
  });

  it("renders the English copy on the English mirror", () => {
    draw([row("pik.bg", { unfavorable: 2 }, { rows: 3 })], "en");
    expect(screen.getByRole("heading")).toHaveTextContent(
      "How each outlet covers ПП-ДБ",
    );
    expect(
      screen.getByText(/not an assessment of the outlet itself/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 assessed of 3/)).toBeInTheDocument();
    expect(screen.getByText(/^mostly/)).toBeInTheDocument();
  });

  it("renders nothing at all when there are no outlets", () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });
});
