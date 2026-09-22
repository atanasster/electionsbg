// ⚠️ BOTH layouts are in the DOM at once (the phone stack is `md:hidden`,
// the table `hidden md:block` — jsdom applies neither), so every query here
// is scoped with `within(table)` / `within(stack)`. Do not "fix" a duplicate
// match with `getAllByRole(...)[0]`; scope it.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ArticleRecord, StoryMember, StorySynthesis } from "../data";
import { NewsLocaleProvider } from "../i18n";
import { StoryCompare, type CompareSource } from "./StoryCompare";

const member = (
  domain: string,
  extra: Partial<StoryMember> = {},
): StoryMember => ({
  domain,
  article_id: `${domain}-id`,
  url: `https://${domain}/a`,
  title: `Заглавие ${domain}`,
  published: "2026-09-20T10:05:00+03:00",
  leaning: "neutral",
  russia_stance: "not_applicable",
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
  ...extra,
});

const article = (domain: string, summary: string | null): ArticleRecord =>
  ({
    id: `${domain}-id`,
    domain,
    updated: "2026-09-20T12:00:00+03:00",
    analysis: summary
      ? { summary_bg: summary, summary_en: `EN ${summary}` }
      : undefined,
  }) as unknown as ArticleRecord;

const synthesis: StorySynthesis = {
  rubric_version: "v1",
  status: "ok",
  generated_at: "",
  outlets: ["a.bg", "b.bg"],
  synthesis: {
    common: [
      {
        claim: "c",
        supports: [
          {
            url: "https://a.bg/a",
            domain: "a.bg",
            quote: "цитиран откъс от А",
          },
          {
            url: "https://b.bg/a",
            domain: "b.bg",
            quote: "цитиран откъс от Б",
          },
        ],
      },
    ],
    disputed: [],
    emphasis: [],
  },
  caveat_bg: null,
  caveat_en: null,
  dropped: 0,
};

const sources = (): CompareSource[] => [
  {
    key: "a.bg/a.bg-id",
    member: member("a.bg", { leaning: "progressive" }),
    outlet: {
      outlet: "Медия А",
      owner: {
        name: "Холдинг АД",
        category: null,
        source: "https://register.example/a",
        checked: "2026-09-01",
      },
    },
    article: article("a.bg", "Кабинетът отложи решението."),
    loading: false,
  },
  {
    key: "b.bg/b.bg-id",
    member: member("b.bg", {
      published: null,
      leaning: null,
      russia_stance: null,
    }),
    outlet: { outlet: "Втора медия", owner: null },
    article: article("b.bg", null),
    loading: false,
  },
  {
    key: "c.bg/c.bg-id",
    member: member("c.bg"),
    outlet: undefined,
    article: undefined,
    loading: true,
  },
];

describe("StoryCompare", () => {
  afterEach(cleanup);

  it("aligns the same fields per source in both layouts, says what is missing, and never invents", () => {
    const onReset = vi.fn();
    render(
      <MemoryRouter>
        <StoryCompare
          sources={sources()}
          synthesis={synthesis}
          onReset={onReset}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Сравнение на 3 източника" }),
    ).toBeVisible();
    // Desktop: a table with the sources as column heads and one row per field.
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Поле", "Медия А", "Втора медия", "c.bg"]);
    const rows = within(table)
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(rows).toEqual([
      "Източник",
      "Публикувано / обновено",
      "Заглавие",
      "Кратко обобщение",
      "Цитирани откъси",
      "Политическо рамкиране",
      "Позиция спрямо Русия",
    ]);
    // Phone: one stack per source, the same fields in the same order.
    const stack = screen.getByTestId("story-compare-stack");
    expect(stack).toHaveClass("md:hidden");
    const stacks = within(stack).getAllByRole("region");
    expect(stacks.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Медия А",
      "Втора медия",
      "c.bg",
    ]);
    expect(
      within(stacks[0])
        .getAllByRole("term")
        .map((t) => t.textContent),
    ).toEqual(rows);
    expect(within(stacks[0]).getByRole("heading", { level: 4 })).toHaveClass(
      "sticky",
    );
    // Ownership is the REGISTERED owner with its source; absence is said.
    expect(
      within(table).getByText(/Вписан собственик: Холдинг АД/),
    ).toBeVisible();
    expect(
      within(table).getByRole("link", { name: "справка ↗" }),
    ).toHaveAttribute("href", "https://register.example/a");
    expect(
      within(table).getAllByText("Собственост: няма проверена справка."),
    ).toHaveLength(2);
    // Summary: the build's own, or "not assessed"; loading is said as loading.
    expect(
      within(table).getByText("Кабинетът отложи решението."),
    ).toBeVisible();
    expect(
      within(table).getByText("Материалът още не е оценен — няма обобщение."),
    ).toBeVisible();
    expect(within(table).getByText("зарежда се…")).toBeVisible();
    // Quotes are the synthesis's cited spans for THAT article only.
    expect(within(table).getByText("цитиран откъс от А")).toBeVisible();
    expect(within(table).getByText("цитиран откъс от Б")).toBeVisible();
    expect(
      within(table).getAllByText(
        "Обобщението на историята не цитира този материал.",
      ),
    ).toHaveLength(1);
    // Time: publication and declared update, or their absence.
    expect(within(table).getByText("без дата на публикуване")).toBeVisible();
    expect(within(table).getAllByText("без обявено обновяване")).toHaveLength(
      1,
    ); // c.bg is still loading
    // Framing: a badge with a text label, or "not assessed" — never a guessed position.
    expect(within(table).getAllByText("не е оценено")).toHaveLength(2);
    expect(within(table).getByText("Прогресивно")).toBeVisible();
    // Links: article page + original, both named.
    expect(
      within(table).getByRole("link", { name: "Заглавие a.bg" }),
    ).toHaveAttribute("href", "/article/a.bg/a.bg-id");
    expect(
      within(table).getAllByRole("link", { name: /Прочети оригинала/ })[0],
    ).toHaveAttribute("href", "https://a.bg/a");
    // The genre / person rows are absent and the absence is said.
    expect(rows).not.toContain("Жанр");
    expect(screen.getByText(/корпусът не носи жанр/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Изчисти сравнението" }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("reads in English", () => {
    render(
      <NewsLocaleProvider language="en">
        <MemoryRouter>
          <StoryCompare
            sources={sources().slice(0, 2)}
            synthesis={synthesis}
            onReset={() => {}}
          />
        </MemoryRouter>
      </NewsLocaleProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Comparing 2 sources" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear the comparison" }),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("EN Кабинетът отложи решението."),
    ).toBeVisible();
    expect(
      within(table).getByText("Not yet assessed — no summary."),
    ).toBeVisible();
    expect(
      within(table).getByText(/Registered owner: Холдинг АД/),
    ).toBeVisible();
  });
});
