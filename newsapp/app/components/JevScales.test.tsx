import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  APPLIES_FLOOR,
  JevAxisCard,
  JevProvenance,
  JevSubjects,
} from "./JevScales";
import { NewsLocaleProvider } from "../i18n";
import type { JevAxisScore, JevScore, JevSubject } from "../data";

const draw = (node: React.ReactNode, language: "bg" | "en" = "bg") =>
  render(<NewsLocaleProvider language={language}>{node}</NewsLocaleProvider>);

const score = (value: number, over: Partial<JevScore> = {}): JevScore => ({
  value,
  normalized: value / 2,
  spread: 0.3,
  confidence: 0.94,
  levels: 5,
  both_directions: false,
  distribution: [0.02, 0.1, 0.6, 0.2, 0.08],
  ...over,
});

const axis = (value: number, applies = 0.9, over: Partial<JevScore> = {}) =>
  ({ ...score(value, over), applies }) as JevAxisScore;

const markerLeft = (container: HTMLElement) =>
  (container.querySelector('[data-testid="scale-marker"]') as HTMLElement).style
    .left;

describe("JevAxisCard", () => {
  it("places the article on the scale and names its bucket", () => {
    const { container } = draw(
      <JevAxisCard title="Рамкиране" axis="leaning" score={axis(1.2)} />,
    );
    // normalized 0.6 → (0.6 + 1) / 2 = 80%.
    expect(markerLeft(container)).toBe("80%");
    expect(screen.getByText("Консервативно рамкиране")).toBeInTheDocument();
  });

  it("prints NO confidence percentage", () => {
    // ⚠️ Measured: neither confidence field predicts agreement on Russia
    // (AUC 0.555 / 0.541). A percentage would decorate the verdict. The
    // applicability line is the only percentage, and it says what it is.
    const { container } = draw(
      <JevAxisCard
        title="Русия"
        axis="russia_stance"
        score={axis(1.5, 0.97)}
      />,
    );
    const percents = container.textContent!.match(/\d+%/g) ?? [];
    expect(percents).toEqual(["97%"]);
    expect(
      screen.getByText(/Вероятност оста да се отнася/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/94%/);
  });

  it("draws the model's distribution instead", () => {
    const { container } = draw(
      <JevAxisCard title="Рамкиране" axis="leaning" score={axis(0)} />,
    );
    const bars = container.querySelectorAll(
      '[data-testid="scale-distribution"] > span',
    );
    expect(bars).toHaveLength(5);
  });

  it("shows an axis that does not apply as ABSENT, with no marker", () => {
    // ⚠️ A marker at the centre would read as „takes no side", a different
    // finding from „is not about sides".
    const { container } = draw(
      <JevAxisCard
        title="Русия"
        axis="russia_stance"
        score={axis(0, APPLIES_FLOOR - 0.01)}
      />,
    );
    expect(screen.getByTestId("axis-not-applicable")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="scale-marker"]')).toBeNull();
  });

  it("places an axis exactly AT the floor", () => {
    const { container } = draw(
      <JevAxisCard
        title="Русия"
        axis="russia_stance"
        score={axis(0, APPLIES_FLOOR)}
      />,
    );
    expect(
      container.querySelector('[data-testid="scale-marker"]'),
    ).not.toBeNull();
  });

  it("says a band the scale cut was cut", () => {
    // normalized 0.9 ± (0.4 / 2) runs past +1.
    draw(
      <JevAxisCard
        title="Рамкиране"
        axis="leaning"
        score={axis(1.8, 0.9, { spread: 0.4 })}
      />,
    );
    expect(screen.getByText(/излиза извън скалата/)).toBeInTheDocument();
  });

  it("buckets a nine-anchor value through ITS OWN scale", () => {
    // ⚠️ +2.0 on a ±4 scale is a quarter of the range — `conservative`.
    // Read as a ±2 value it would be `strong_conservative`, a step too strong.
    draw(
      <JevAxisCard
        title="Рамкиране"
        axis="leaning"
        score={axis(2.0, 0.9, { levels: 9, normalized: 0.5, distribution: [] })}
      />,
    );
    expect(screen.getByText("Консервативно рамкиране")).toBeInTheDocument();
  });

  it("uses the build's bucket, not a re-bucketing of the rounded value", () => {
    // ⚠️ `value` is rounded for the wire; 0.5 is ON the favorable edge, but
    // the exact value was a hair under it and the build said `neutral`. The
    // page must agree with the archive's count, so the shipped index wins.
    draw(
      <JevAxisCard
        title="Рамкиране"
        axis="leaning"
        score={axis(0.5, 0.9, { normalized: 0.25, bucket_index: 2 })}
      />,
    );
    expect(
      screen.getByText("Без ясно идеологическо рамкиране"),
    ).toBeInTheDocument();
  });

  it("renders the English copy on the English mirror", () => {
    draw(
      <JevAxisCard title="Framing" axis="leaning" score={axis(-1.2)} />,
      "en",
    );
    expect(screen.getByText("Model scale")).toBeInTheDocument();
  });
});

const subject = (over: Partial<JevSubject>): JevSubject => ({
  name: "ГЕРБ",
  kind: "party",
  subject_role: "primary",
  mentions: 4,
  tone: score(-1.5),
  ...over,
});

describe("JevSubjects", () => {
  it("rates the subjects the article is about", () => {
    // −1.0 → normalized −0.5 → `unfavorable`, a label the scale's end labels
    // („силно негативен" / „силно позитивен") do not also carry.
    draw(
      <JevSubjects subjects={[subject({ tone: score(-1.0) })]} dropped={0} />,
    );
    const list = screen.getByTestId("jev-subjects");
    expect(within(list).getByText("ГЕРБ")).toBeInTheDocument();
    expect(within(list).getByText("негативен")).toBeInTheDocument();
    expect(within(list).getByText("основен субект")).toBeInTheDocument();
  });

  it("lists a passing mention as NOT RATED, never as neutral", () => {
    // ⚠️ The Минчев case: a party quoted once is not the article's target.
    draw(
      <JevSubjects
        subjects={[
          subject({}),
          subject({
            name: "ПП-ДБ",
            subject_role: "incidental",
            tone: undefined,
          }),
        ]}
        dropped={0}
      />,
    );
    expect(screen.getByTestId("jev-passing")).toHaveTextContent(
      "споменати мимоходом — без оценка: ПП-ДБ",
    );
    expect(screen.queryByText("неутрален")).not.toBeInTheDocument();
  });

  it("does NOT call a subject whose call failed a passing mention", () => {
    // ⚠️ It was asked and has no answer; the archive says „not rated yet"
    // for the same record, and the two pages must agree.
    draw(
      <JevSubjects
        subjects={[
          subject({}),
          subject({ name: "БСП", subject_role: "secondary", tone: undefined }),
        ]}
        dropped={0}
      />,
    );
    expect(screen.getByTestId("jev-unrated")).toHaveTextContent(
      "още не са оценени: БСП",
    );
    expect(screen.queryByTestId("jev-passing")).toBeNull();
  });

  it("states the real cap, not a literal", () => {
    draw(<JevSubjects subjects={[subject({})]} dropped={2} max={18} />);
    expect(screen.getByTestId("jev-dropped")).toHaveTextContent(
      "най-много 18 на материал",
    );
  });

  it("says how many named were not rated at all", () => {
    draw(<JevSubjects subjects={[subject({})]} dropped={5} />);
    expect(screen.getByTestId("jev-dropped")).toHaveTextContent(
      "Още 5 споменати не са оценени",
    );
  });

  it("renders nothing with nobody to show", () => {
    const { container } = draw(<JevSubjects subjects={[]} dropped={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("JevProvenance", () => {
  it("names the model and date that produced the SCALES", () => {
    // ⚠️ The section header names the summary's model — a different one.
    draw(
      <JevProvenance
        textScope={null}
        articleUrl={null}
        model="typesafe/jev-1.13-20260917"
        assessedAt="2026-09-23T06:00:00Z"
      />,
    );
    const byline = screen.getByTestId("jev-byline");
    expect(byline).toHaveTextContent("модел typesafe/jev-1.13-20260917");
    expect(byline).toHaveTextContent("2026");
  });

  it("says the whole text was read and links the source", () => {
    draw(
      <JevProvenance
        textScope={{
          version: 1,
          kind: "full",
          chars_seen: 1200,
          chars_total: 1200,
          coverage: 1,
          basis: "provenance",
        }}
        articleUrl="https://a.bg/p"
      />,
    );
    expect(screen.getByTestId("jev-provenance")).toHaveTextContent(
      "Модел прочете целия материал",
    );
    expect(
      screen.getByRole("link", { name: "Проверете в източника" }),
    ).toHaveAttribute("href", "https://a.bg/p");
  });

  it("calls a prefix read partial even when its counts are missing", () => {
    // ⚠️ The kind decides. Requiring both counts first let such a record
    // fall through to the whole-text sentence.
    draw(
      <JevProvenance
        textScope={{
          version: 1,
          kind: "prefix",
          chars_seen: null,
          chars_total: null,
          coverage: null,
          basis: "provenance",
        }}
        articleUrl={null}
      />,
    );
    const line = screen.getByTestId("jev-provenance");
    expect(line).toHaveTextContent("част от материала");
    expect(line).not.toHaveTextContent("целия материал");
  });

  it("never claims the whole text for a truncated read", () => {
    // ⚠️ 56 articles exceed what Jev is sent; a whole-text line on those
    // would be false about what was read.
    draw(
      <JevProvenance
        textScope={{
          version: 1,
          kind: "prefix",
          chars_seen: 24000,
          chars_total: 30000,
          coverage: 0.8,
          basis: "provenance",
        }}
        articleUrl={null}
      />,
    );
    const line = screen.getByTestId("jev-provenance");
    expect(line).toHaveTextContent("първите 24");
    expect(line).not.toHaveTextContent("целия материал");
  });
});
