import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryMember } from "../data";
import {
  axisCompleteness,
  type AxisCompleteness,
} from "../aggregateCompleteness";
import {
  AggregateCompleteness,
  COMPLETENESS_RUBRIC_ID,
  axisBreakdown,
  completenessSentence,
} from "./AggregateCompleteness";

const member = (domain: string, leaning: StoryMember["leaning"]): StoryMember =>
  ({ domain, leaning, russia_stance: null }) as StoryMember;

const c = (assessed: number, total: number): AxisCompleteness => ({
  assessed,
  total,
  positioned: assessed,
  notApplicable: 0,
  unavailable: total - assessed,
  partialScope: 0,
  outlets: assessed,
});
const tr = <T,>(bg: T): T => bg;
const trEn = <T,>(_bg: T, en: T): T => en;

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
      partialScope: 0,
      outlets: 1,
    });
    // ⚠️ THE MUTATION THIS CATCHES (T4.1c): a prefix-scope verdict counted
    // as assessed (or as unavailable). It is its own bucket, and its outlet
    // does not join the assessed set.
    const scoped = axisCompleteness(
      [
        member("one.bg", "progressive"),
        { ...member("two.bg", "conservative"), text_scope: "prefix" },
        { ...member("four.bg", "conservative"), text_scope: "unrecorded" },
        member("three.bg", null),
      ],
      (item) => item.leaning,
    );
    expect(scoped).toEqual({
      assessed: 1,
      total: 4,
      positioned: 1,
      notApplicable: 0,
      unavailable: 1,
      partialScope: 2,
      outlets: 1,
    });
  });

  it("says the one sentence, once, and keeps per-axis counts adjacent only when they differ", () => {
    const lean = {
      key: "l",
      label: "политическо рамкиране",
      completeness: c(2, 2),
    };
    const russia = {
      key: "r",
      label: "позиция спрямо Русия",
      completeness: c(2, 2),
    };
    expect(completenessSentence([lean, russia], tr)).toBe(
      "Оценени са и двата материала.",
    );
    expect(completenessSentence([lean, russia], trEn)).toBe(
      "Both articles are assessed.",
    );
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(1, 1) },
          { ...russia, completeness: c(1, 1) },
        ],
        tr,
      ),
    ).toBe("Оценен е единственият материал.");
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(5, 5) },
          { ...russia, completeness: c(5, 5) },
        ],
        tr,
      ),
    ).toBe("Оценени са всички 5 материала.");
    // Same shortfall on both axes: one figure.
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(2, 3) },
          { ...russia, completeness: c(2, 3) },
        ],
        tr,
      ),
    ).toBe("Оценени са 2 от 3 материала.");
    // ⚠️ THE MUTATION THIS CATCHES: collapsing two DIFFERENT per-axis counts
    // into one figure (either one would be a wrong claim about the other axis).
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(2, 3) },
          { ...russia, completeness: c(1, 3) },
        ],
        tr,
      ),
    ).toBe(
      "Оценени са 2 от 3 материала по политическо рамкиране и 1 от 3 по позиция спрямо Русия.",
    );
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(2, 3) },
          { ...russia, completeness: c(1, 3) },
        ],
        trEn,
      ),
    ).toBe(
      "Assessed: 2 of 3 articles on политическо рамкиране and 1 of 3 on позиция спрямо Русия.",
    );
    // Verb agrees with N (the T5.3 rule), noun with M; zero is an absence.
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(1, 3) },
          { ...russia, completeness: c(1, 3) },
        ],
        tr,
      ),
    ).toBe("Оценен е 1 от 3 материала.");
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(1, 3) },
          { ...russia, completeness: c(1, 3) },
        ],
        trEn,
      ),
    ).toBe("1 of 3 articles is assessed.");
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(1, 3) },
          { ...russia, completeness: c(2, 3) },
        ],
        tr,
      ),
    ).toBe(
      "Оценен е 1 от 3 материала по политическо рамкиране и 2 от 3 по позиция спрямо Русия.",
    );
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(0, 3) },
          { ...russia, completeness: c(0, 3) },
        ],
        tr,
      ),
    ).toBe("Нито един от 3 материала не е оценен.");
    // Each axis carries its own denominator — the component is axis-agnostic.
    expect(
      completenessSentence(
        [
          { ...lean, completeness: c(2, 3) },
          { ...russia, completeness: c(2, 4) },
        ],
        tr,
      ),
    ).toBe(
      "Оценени са 2 от 3 материала по политическо рамкиране и 2 от 4 по позиция спрямо Русия.",
    );
    // Fails closed: no axes, or an empty story, is said as such.
    expect(completenessSentence([], tr)).toBe("Няма оценени материали.");
    expect(completenessSentence([{ ...lean, completeness: c(0, 0) }], tr)).toBe(
      "Няма оценени материали.",
    );
  });

  it("spells the breakdown out in words with the verbs agreeing, zeros omitted, in both languages", () => {
    const full: AxisCompleteness = {
      assessed: 3,
      total: 3,
      positioned: 2,
      notApplicable: 1,
      unavailable: 0,
      partialScope: 0,
      outlets: 2,
    };
    expect(axisBreakdown(full, "bg")).toBe(
      "Оценени 3 от 3 материала (от 2 източника): 2 заемат позиция, 1 не заема позиция по тази ос.",
    );
    expect(axisBreakdown(full, "en")).toBe(
      "Assessed 3 of 3 articles (from 2 outlets): 2 take a position, 1 takes no position on this axis.",
    );
    expect(
      axisBreakdown(
        { ...full, outlets: 1, positioned: 1, notApplicable: 2 },
        "bg",
      ),
    ).toBe(
      "Оценени 3 от 3 материала (от 1 източник): 1 заема позиция, 2 не заемат позиция по тази ос.",
    );
    // ⚠️ THE MUTATION THIS CATCHES: a fixed plural opener — „Оценени 1 от 3".
    const single: AxisCompleteness = {
      assessed: 1,
      total: 3,
      positioned: 1,
      notApplicable: 0,
      unavailable: 2,
      partialScope: 0,
      outlets: 1,
    };
    expect(axisBreakdown(single, "bg")).toBe(
      "Оценен 1 от 3 материала (от 1 източник): 1 заема позиция; 2 не са оценени.",
    );
    expect(axisBreakdown(single, "en")).toBe(
      "Assessed 1 of 3 articles (from 1 outlet): 1 takes a position; 2 are not assessed.",
    );
    // Nothing assessed at all: the opener alone, no zero parts.
    expect(
      axisBreakdown(
        {
          assessed: 0,
          total: 2,
          positioned: 0,
          notApplicable: 0,
          unavailable: 2,
          partialScope: 0,
          outlets: 0,
        },
        "bg",
      ),
    ).toBe("Оценени 0 от 2 материала (от 0 източника); 2 не са оценени.");
  });

  it("puts the breakdown, rubric id and date behind a disclosure the page owns", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <AggregateCompleteness
        axes={[
          {
            key: "l",
            label: "политическо рамкиране",
            completeness: {
              assessed: 2,
              total: 3,
              positioned: 1,
              notApplicable: 1,
              unavailable: 1,
              partialScope: 0,
              outlets: 1,
            },
          },
        ]}
        generatedAt="2026-09-01T08:00:00Z"
        open={false}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("Оценени са 2 от 3 материала.")).toBeVisible();
    const details = screen
      .getByText("Подробности за оценката")
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(COMPLETENESS_RUBRIC_ID);
    expect(details).toHaveTextContent("news-article-evaluation-v1");
    // T5.6 — the breakdown is a plain sentence, not a row of rubric tags.
    expect(details).toHaveTextContent(
      "Оценени 2 от 3 материала (от 1 източник): 1 заема позиция, 1 не заема позиция по тази ос; 1 не е оценен.",
    );
    expect(details).not.toHaveTextContent("в спектъра");
    expect(details).not.toHaveTextContent("извън обхвата");
    expect(details).not.toHaveTextContent("без стойност");
    expect(details).toHaveTextContent("редакционният статус");
    // The owner learns the DOM's NEW state, not a constant.
    details!.open = true;
    fireEvent(details!, new Event("toggle"));
    expect(onToggle).toHaveBeenLastCalledWith(true);
    details!.open = false;
    fireEvent(details!, new Event("toggle"));
    expect(onToggle).toHaveBeenLastCalledWith(false);
    // The prop, not the DOM, decides: the owner flipping it opens the disclosure.
    rerender(
      <AggregateCompleteness
        axes={[
          {
            key: "l",
            label: "политическо рамкиране",
            completeness: {
              assessed: 2,
              total: 3,
              positioned: 1,
              notApplicable: 1,
              unavailable: 1,
              partialScope: 0,
              outlets: 1,
            },
          },
        ]}
        generatedAt="2026-09-01T08:00:00Z"
        open={true}
        onToggle={onToggle}
      />,
    );
    expect(details).toHaveAttribute("open");
  });
});
