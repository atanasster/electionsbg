import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryMember } from "../data";
import { distinctiveHeadlineTerms } from "../headlineDifferences";
import { NewsLocaleProvider } from "../i18n";
import { HeadlineComparison } from "./HeadlineComparison";

const member = (domain: string, title: string): StoryMember => ({
  domain,
  article_id: domain,
  url: `https://${domain}/story`,
  title,
  published: "2026-09-01T08:00:00Z",
  leaning: null,
  russia_stance: null,
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
});

describe("HeadlineComparison", () => {
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));
  it("highlights only bounded headline-specific terms", () => {
    const terms = distinctiveHeadlineTerms([
      "Парламентът прие новия бюджет днес",
      "Парламентът отхвърли спорния бюджет днес",
    ]);
    expect(terms[0]).toContain("прие");
    expect(terms[1]).toContain("отхвърли");
    expect(terms[0]).not.toContain("парламентът");
    expect(terms[0].size).toBeLessThanOrEqual(6);
    expect(distinctiveHeadlineTerms(["Единствено заглавие"])[0].size).toBe(0);
  });

  it("renders no checkbox unless a selection is offered", () => {
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[member("one.bg", "Едно"), member("two.bg", "Две")]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("labels lexical differences without claiming bias", () => {
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[
            member("one.bg", "Парламентът прие новия бюджет"),
            member("two.bg", "Парламентът отхвърли спорния бюджет"),
          ]}
          outletNames={
            new Map([
              ["one.bg", "Първа медия"],
              ["two.bg", "Втора медия"],
            ])
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("прие", { selector: "mark" })).toBeVisible();
    expect(screen.getByText("отхвърли", { selector: "mark" })).toBeVisible();
    expect(screen.getByText(/разлики в думите/)).toBeVisible();
    expect(screen.getByRole("link", { name: /прие новия/ })).toHaveAttribute(
      "href",
      "/article/one.bg/one.bg",
    );
  });

  it.each(["bg", "en"] as const)(
    "states identical headlines without claiming identical articles (%s)",
    (language) => {
      const title =
        "Радев: България трябва да гарантира сигурността на всеки вид транспорт";
      const onToggle = vi.fn();
      const { container } = render(
        <NewsLocaleProvider language={language}>
          <MemoryRouter>
            <HeadlineComparison
              members={[
                member("one.bg", title),
                member("two.bg", ` ${title} `),
              ]}
              outletNames={new Map()}
              selection={{ selected: [], max: 3, onToggle }}
            />
          </MemoryRouter>
        </NewsLocaleProvider>,
      );
      expect(
        screen.getByText(
          language === "bg"
            ? "Заглавията са еднакви. Това сравнение обхваща само заглавията."
            : "The headlines are identical. This comparison covers headlines only.",
        ),
      ).toBeVisible();
      expect(container.querySelector("mark")).toBeNull();
      expect(screen.getAllByRole("link")).toHaveLength(2);
      fireEvent.click(screen.getAllByRole("checkbox")[0]);
      expect(onToggle).toHaveBeenCalledWith("one.bg/one.bg");
    },
  );

  it.each([
    ["Кабинетът прие бюджета", "Кабинетът не прие бюджета"],
    ["Бюджетът е 20 милиарда", "Бюджетът е 30 милиарда"],
    ["Кабинетът прие бюджета.", "Кабинетът прие бюджета?"],
    ["Кабинетът подкрепи парламента", "Парламента подкрепи кабинетът"],
  ])(
    "does not mistake unhighlighted differences for equality: %s / %s",
    (a, b) => {
      const { container } = render(
        <MemoryRouter>
          <HeadlineComparison
            members={[member("one.bg", a), member("two.bg", b)]}
            outletNames={new Map()}
          />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Заглавията се различават/)).toBeVisible();
      expect(container.querySelector("mark")).toBeNull();
      expect(screen.queryByText(/Заглавията са еднакви/)).toBeNull();
    },
  );

  it("does not compare missing titles as identical", () => {
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[
            { ...member("one.bg", ""), title: null },
            member("two.bg", " "),
          ]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Сравнението на заглавията е непълно/),
    ).toBeVisible();
    expect(screen.queryByText(/Заглавията са еднакви/)).toBeNull();
  });

  it("records the comparison task without headline or outlet ids", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[
            member("one.bg", "Частно заглавие едно"),
            member("two.bg", "Частно заглавие две"),
          ]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: /едно/ }));
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "comparison",
        outcome: "available",
      }),
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_task",
        task: "compare_coverage",
        signal: "completed",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/one\.bg|Частно/);
  });

  it("records when a comparison is unavailable without exposing the source", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <MemoryRouter>
        <HeadlineComparison
          members={[member("private.bg", "Самотно заглавие")]}
          outletNames={new Map()}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "comparison",
        outcome: "unavailable",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toContain("private.bg");
  });
});
