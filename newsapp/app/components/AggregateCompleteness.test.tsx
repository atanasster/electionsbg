import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoryMember } from "../data";
import { axisCompleteness } from "../aggregateCompleteness";
import { AggregateCompleteness } from "./AggregateCompleteness";

const member = (domain: string, leaning: StoryMember["leaning"]): StoryMember =>
  ({ domain, leaning, russia_stance: null }) as StoryMember;

describe("AggregateCompleteness", () => {
  it("keeps positioned, not-applicable, missing and outlet counts distinct", () => {
    const result = axisCompleteness(
      [
        member("one.bg", "progressive"),
        member("one.bg", "not_applicable"),
        member("two.bg", null),
      ],
      (item) => item.leaning,
    );
    expect(result).toEqual({
      assessed: 2,
      total: 3,
      positioned: 1,
      notApplicable: 1,
      unavailable: 1,
      outlets: 1,
    });
  });

  it("exposes the rubric, aggregation date and per-article review scope", () => {
    render(
      <AggregateCompleteness
        completeness={{
          assessed: 2,
          total: 3,
          positioned: 1,
          notApplicable: 1,
          unavailable: 1,
          outlets: 1,
        }}
        generatedAt="2026-09-01T08:00:00Z"
      />,
    );
    expect(screen.getByText(/Оценени 2\/3/)).toBeVisible();
    expect(screen.getByText(/news-article-evaluation-v1/)).toBeVisible();
    expect(screen.getByText(/редакционният статус/)).toBeVisible();
  });
});
