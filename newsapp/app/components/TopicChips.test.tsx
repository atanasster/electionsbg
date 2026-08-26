// Topic chips — two destinations per chip, never one.
//
// ⚠️ THE DEFECT THIS GUARDS IS INVISIBLE BY EYE. A single anchor wrapping
// „Лица и длъжностни лица · Декларации и конфликти на интереси" looks
// identical to two, and clicking either half silently lands the reader on the
// persons browser when they asked for the declarations register.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopicChips } from "./TopicChips";
import type { TaxonomyCategory } from "../data";

const axes = {
  article_count: 0,
  story_count: 0,
  primary_count: 0,
  outlet_count: 0,
  leaning: {},
  russia_stance: {},
  spread: {
    leaning: { spread: null, n: 0, enough: false },
    russia_stance: { spread: null, n: 0, enough: false },
  },
};

const taxonomy = [
  {
    id: "officials-people",
    label: { bg: "Лица и длъжностни лица", en: "Officials & people" },
    route: "/persons",
    ...axes,
    subcategories: [
      {
        id: "declarations-conflicts",
        label: { bg: "Декларации", en: "Declarations" },
        route: "/governance/declarations",
        article_count: 1,
      },
      {
        id: "appointments",
        label: { bg: "Назначения", en: "Appointments" },
        route: null,
        article_count: 0,
      },
    ],
  },
  {
    id: "elections-local",
    label: { bg: "Местни избори", en: "Local elections" },
    route: "/local/:cycle",
    ...axes,
    subcategories: [],
  },
] as unknown as TaxonomyCategory[];

describe("linking", () => {
  it("links each half at its OWN page", () => {
    render(
      <TopicChips
        categories={taxonomy}
        topics={[
          {
            category: "officials-people",
            subcategory: "declarations-conflicts",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Лица и длъжностни лица" }),
    ).toHaveAttribute("href", "https://electionsbg.com/persons");
    expect(screen.getByRole("link", { name: "Декларации" })).toHaveAttribute(
      "href",
      "https://electionsbg.com/governance/declarations",
    );
  });

  it("leaves a subcategory with no page as plain text", () => {
    // ⚠️ A refusal, not a gap. Most subcategories have no page that IS them.
    render(
      <TopicChips
        categories={taxonomy}
        topics={[{ category: "officials-people", subcategory: "appointments" }]}
      />,
    );
    expect(screen.getByText("Назначения")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Назначения" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Лица и длъжностни лица" }),
    ).toBeInTheDocument();
  });

  it("refuses a route PATTERN — `/local/:cycle` is a 404", () => {
    render(
      <TopicChips
        categories={taxonomy}
        topics={[{ category: "elections-local", subcategory: null }]}
      />,
    );
    expect(screen.getByText("Местни избори")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to the raw id when the taxonomy has not loaded", () => {
    render(
      <TopicChips
        categories={null}
        topics={[{ category: "officials-people", subcategory: null }]}
      />,
    );
    expect(screen.getByText("officials-people")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing at all for an empty topic list", () => {
    const { container } = render(
      <TopicChips categories={taxonomy} topics={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
