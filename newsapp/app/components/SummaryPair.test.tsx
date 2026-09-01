import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewsLocaleProvider, type NewsLanguage } from "../i18n";
import { SummaryPair } from "./SummaryPair";

const renderSummary = (
  language: NewsLanguage,
  props: React.ComponentProps<typeof SummaryPair>,
) =>
  render(
    <NewsLocaleProvider language={language}>
      <SummaryPair {...props} />
    </NewsLocaleProvider>,
  );

describe("SummaryPair", () => {
  it("renders only the Bulgarian summary on the Bulgarian page", () => {
    renderSummary("bg", {
      bg: "Кабинетът отложи решението.",
      en: "The cabinet delayed the decision.",
    });
    expect(screen.getByText("Кабинетът отложи решението.")).toBeVisible();
    expect(
      screen.queryByText("The cabinet delayed the decision."),
    ).not.toBeInTheDocument();
  });

  it("renders only the English summary on the English page", () => {
    renderSummary("en", {
      bg: "Кабинетът отложи решението.",
      en: "The cabinet delayed the decision.",
    });
    expect(
      screen.getByText("The cabinet delayed the decision."),
    ).toHaveAttribute("lang", "en");
    expect(
      screen.queryByText("Кабинетът отложи решението."),
    ).not.toBeInTheDocument();
  });

  it("does not fall back to the other language when selected copy is missing", () => {
    renderSummary("en", { bg: "Само български.", en: null });
    expect(screen.getByText("English summary unavailable.")).toBeVisible();
    expect(screen.queryByText("Само български.")).not.toBeInTheDocument();
  });

  it("renders nothing when neither language has a summary", () => {
    const { container } = renderSummary("bg", { bg: null, en: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("passes spacing through to the wrapper", () => {
    const { container } = renderSummary("bg", {
      bg: "Текст.",
      en: "Text.",
      className: "mt-3",
    });
    expect(container.firstElementChild).toHaveClass("mt-3");
  });
});

describe("a withheld summary", () => {
  it("states why the selected Bulgarian summary is withheld", () => {
    renderSummary("bg", {
      bg: null,
      en: "Anton Slavchev got a payout.",
      withheld: { summary_bg: "altered_name" },
    });
    expect(screen.getByText(/не се показва/)).toBeInTheDocument();
    expect(screen.queryByText("Anton Slavchev got a payout.")).toBeNull();
  });

  it("states why the selected English summary is withheld", () => {
    renderSummary("en", {
      bg: "Българско резюме.",
      en: null,
      withheld: { summary_en: "altered_name" },
    });
    expect(screen.getByText(/English summary is not shown/)).toBeVisible();
    expect(screen.queryByText("Българско резюме.")).toBeNull();
  });

  it("uses the generic note for an unknown reason", () => {
    renderSummary("bg", {
      bg: null,
      en: "English.",
      withheld: { summary_bg: "future_code" },
    });
    expect(screen.getByText("Липсва резюме на български.")).toBeVisible();
  });
});
