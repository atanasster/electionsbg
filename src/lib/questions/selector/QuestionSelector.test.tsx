import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionCatalog, QuestionDefinition } from "../types";
import { QuestionSelector } from "./QuestionSelector";

const question = (
  id: string,
  overrides: Partial<QuestionDefinition> = {},
): QuestionDefinition => ({
  id,
  categoryId: "elections",
  subcategoryId: "parliamentary",
  question: { bg: `Въпрос ${id}`, en: `Question ${id}` },
  aliases: {},
  parameters: [],
  defaults: {},
  chat: { status: "ready", capabilityId: id },
  sql: { status: "ready", capabilityId: id, version: 1 },
  sourceIds: [],
  ...overrides,
});

const catalog: QuestionCatalog = {
  categories: [
    {
      id: "elections",
      label: { bg: "Избори", en: "Elections" },
      subcategories: [
        {
          id: "parliamentary",
          label: { bg: "Парламентарни", en: "Parliamentary" },
        },
      ],
    },
  ],
  questions: [
    question("one"),
    question("place", {
      question: { bg: "Резултати за място", en: "Results for a place" },
      parameters: [
        {
          id: "place",
          kind: "place",
          required: true,
          label: { bg: "Място", en: "Place" },
        },
      ],
    }),
    question("three"),
    question("four"),
    question("five"),
    question("six"),
    question("bounded", {
      question: { bg: "Година за справка", en: "Reference year" },
      parameters: [
        {
          id: "year",
          kind: "year",
          required: true,
          min: 2020,
          max: 2026,
          label: { bg: "Година", en: "Year" },
        },
      ],
      defaults: { year: 2025 },
    }),
    question("defaulted", {
      question: { bg: "Справка по тема", en: "Topic lookup" },
      parameters: [
        {
          id: "topic",
          kind: "string",
          required: true,
          label: { bg: "Тема", en: "Topic" },
        },
      ],
      defaults: { topic: "бюджет" },
    }),
    question("sql-only", {
      chat: {
        status: "unavailable",
        reason: { bg: "Само SQL", en: "SQL only" },
      },
    }),
  ],
};

const openLeaf = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Избори" }));
  await user.click(screen.getByRole("button", { name: "Парламентарни" }));
  return user;
};

afterEach(cleanup);

// Radix uses browser pointer and scrolling APIs that jsdom does not implement.
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

describe("QuestionSelector", () => {
  it("resets lookup display and submitted defaults when switching questions", async () => {
    const base = catalog.questions.find((q) => q.id === "place")!;
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        compact
        catalog={{
          ...catalog,
          questions: [
            { ...base, defaults: { place: "София" } },
            {
              ...base,
              id: "other-place",
              question: { bg: "Друг регион", en: "Other region" },
              defaults: { place: "Варна" },
            },
          ],
        }}
        surface="chat"
        lang="bg"
        initialQuestionId="place"
        onSelect={onSelect}
        lookupAdapters={{ place: { search: async () => [] } }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Място" })).toHaveValue(
      "София",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Въпрос" }));
    await user.click(screen.getByRole("option", { name: "Друг регион" }));
    expect(screen.getByRole("combobox", { name: "Място" })).toHaveValue(
      "Варна",
    );
    await user.click(screen.getByRole("button", { name: "Попитай" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "other-place",
      parameters: { place: "Варна" },
    });
  });
  it.each(["chat", "sql"] as const)(
    "shows global search results immediately on %s",
    async (surface) => {
      render(
        <QuestionSelector
          compact
          catalog={catalog}
          surface={surface}
          lang="bg"
          onSelect={vi.fn()}
        />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("tab", { name: "Търсене" }));
      expect(screen.queryByRole("combobox", { name: "Теми" })).toBeNull();
      const search = screen.getByRole("searchbox", {
        name: "Търси във всички въпроси",
      });
      expect(search).toBeVisible();
      expect(search.closest("nav")).toBeNull();
      expect(search).toHaveAccessibleDescription(/цялата библиотека/);
      expect(document.querySelector("details")).toBeNull();
      await user.type(search, "Results for a place");
      await user.click(
        screen.getByRole("button", { name: /Резултати за място/ }),
      );
      expect(
        screen.getByRole("heading", { name: "Резултати за място" }),
      ).toBeVisible();
      await user.clear(search);
      await user.type(search, "zzzzmissing");
      expect(screen.getByText("Няма въпроси за този избор.")).toBeVisible();
    },
  );
  it("uses compact dropdown breadcrumbs, resets descendants, and submits explicitly", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        compact
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={onSelect}
      />,
    );
    const user = userEvent.setup();
    const topic = screen.getByRole("combobox", { name: "Теми" });
    const subtopic = screen.getByRole("combobox", { name: "Подтема" });
    const choice = screen.getByRole("combobox", { name: "Въпрос" });
    expect(subtopic).toBeDisabled();
    expect(choice).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Избори" })).toBeNull();
    await user.click(topic);
    await user.click(screen.getByRole("option", { name: "Избори" }));
    await user.click(subtopic);
    await user.click(screen.getByRole("option", { name: "Парламентарни" }));
    await user.click(choice);
    await user.click(screen.getByRole("option", { name: "Въпрос one" }));
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Попитай" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "one",
      parameters: {},
    });
    await user.click(topic);
    await user.click(screen.getByRole("option", { name: "Теми" }));
    expect(subtopic).toHaveTextContent("Подтема");
    expect(choice).toHaveTextContent("Въпрос");
    expect(screen.queryByRole("button", { name: "Попитай" })).toBeNull();
  });

  it("preserves browse selection, edited parameters and search when switching icon modes", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        compact
        catalog={catalog}
        surface="chat"
        lang="bg"
        initialQuestionId="bounded"
        onSelect={onSelect}
      />,
    );
    const user = userEvent.setup();
    const year = screen.getByRole("spinbutton", { name: "Година" });
    await user.clear(year);
    await user.type(year, "2024");
    await user.click(screen.getByRole("tab", { name: "Търсене" }));
    await user.keyboard("{Escape}");
    const search = screen.getByRole("searchbox", {
      name: "Търси във всички въпроси",
    });
    await user.type(search, "results");
    expect(
      screen.getByRole("button", { name: /Резултати за място/ }),
    ).toHaveTextContent("Избори › Парламентарни");
    await user.click(screen.getByRole("tab", { name: "По теми" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Подтема" })).toHaveTextContent(
      "Парламентарни",
    );
    expect(screen.getByRole("combobox", { name: "Въпрос" })).toHaveTextContent(
      "Година за справка",
    );
    expect(screen.getByRole("spinbutton", { name: "Година" })).toHaveValue(
      2024,
    );
    await user.click(screen.getByRole("button", { name: "Попитай" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "bounded",
      parameters: { year: 2024 },
    });
    await user.click(screen.getByRole("tab", { name: "Търсене" }));
    expect(screen.getByRole("searchbox")).toHaveValue("results");
    expect(
      screen.getByRole("button", { name: /Резултати за място/ }),
    ).toBeVisible();
  });
  it("restores distinct lookup values for the same question in each mode", async () => {
    const base = catalog.questions.find((q) => q.id === "place")!;
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        compact
        catalog={{
          ...catalog,
          questions: [{ ...base, defaults: { place: "София" } }],
        }}
        surface="chat"
        lang="bg"
        initialQuestionId="place"
        onSelect={onSelect}
        lookupAdapters={{
          place: { search: async () => [{ value: "VAR", label: "Варна" }] },
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Търсене" }));
    await user.type(screen.getByRole("searchbox"), "results");
    await user.click(
      screen.getByRole("button", { name: /Резултати за място/ }),
    );
    const input = screen.getByRole("combobox", { name: "Място" });
    await user.clear(input);
    await user.type(input, "Вар");
    await user.click(await screen.findByRole("option", { name: "Варна" }));
    await user.click(screen.getByRole("tab", { name: "По теми" }));
    expect(screen.getByRole("combobox", { name: "Място" })).toHaveValue(
      "София",
    );
    await user.click(screen.getByRole("button", { name: "Попитай" }));
    expect(onSelect).toHaveBeenLastCalledWith({
      questionId: "place",
      parameters: { place: "София" },
    });
    await user.click(screen.getByRole("tab", { name: "Търсене" }));
    expect(screen.getByRole("combobox", { name: "Място" })).toHaveValue(
      "Варна",
    );
    await user.click(screen.getByRole("button", { name: "Попитай" }));
    expect(onSelect).toHaveBeenLastCalledWith({
      questionId: "place",
      parameters: { place: "VAR" },
    });
  });
  it("navigates without dispatch, reveals more, then submits explicitly", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={onSelect}
      />,
    );
    const user = await openLeaf();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[id^='question-choice-']")).toHaveLength(
      5,
    );
    await user.click(screen.getByRole("button", { name: "Още въпроси" }));
    expect(document.querySelectorAll("[id^='question-choice-']")).toHaveLength(
      8,
    );
    await user.click(screen.getByRole("button", { name: "Въпрос one" }));
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "one",
      parameters: {},
    });
  });

  it("uses Escape as back and restores focus to the question trigger", async () => {
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={vi.fn()}
      />,
    );
    const user = await openLeaf();
    const trigger = screen.getByRole("button", { name: "Въпрос one" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Въпрос one" })).toHaveFocus(),
    );
  });

  it("restores focus at each category level", async () => {
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={vi.fn()}
      />,
    );
    const user = await openLeaf();
    await user.click(screen.getByRole("button", { name: /Назад/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Парламентарни" }),
      ).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: /Назад/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Избори" })).toHaveFocus(),
    );
  });

  it("resolves a place choice and shows its geographic level", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={onSelect}
        lookupAdapters={{
          place: {
            search: async () => [
              {
                value: "EKATTE:68134",
                label: "София",
                level: "населено място",
                detail: "Столична община",
              },
            ],
          },
        }}
      />,
    );
    const user = await openLeaf();
    await user.click(
      screen.getByRole("button", { name: "Резултати за място" }),
    );
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Полето е задължително.",
    );
    const input = screen.getByRole("combobox", { name: "Място" });
    await user.type(input, "Соф");
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /София/ }));
    expect(screen.getByText(/населено място · Столична община/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "place",
      parameters: { place: "EKATTE:68134" },
    });
  });

  it("requires a canonical lookup choice and supports keyboard selection", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={onSelect}
        lookupAdapters={{
          place: {
            search: async () => [{ value: "EKATTE:68134", label: "София" }],
          },
        }}
      />,
    );
    const user = await openLeaf();
    await user.click(
      screen.getByRole("button", { name: "Резултати за място" }),
    );
    const input = screen.getByRole("combobox", { name: "Място" });
    await user.type(input, "Соф");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("heading", { name: "Резултати за място" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("София");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    expect(onSelect).toHaveBeenCalledWith({
      questionId: "place",
      parameters: { place: "EKATTE:68134" },
    });
  });

  it("ignores stale lookup responses and reports lookup failures", async () => {
    let resolveOld:
      | ((options: { value: string; label: string }[]) => void)
      | undefined;
    let resolveNew:
      | ((options: { value: string; label: string }[]) => void)
      | undefined;
    const search = vi.fn(
      (query: string) =>
        new Promise<{ value: string; label: string }[]>((resolve, reject) => {
          if (query === "Со") resolveOld = resolve;
          else if (query === "Соф") resolveNew = resolve;
          else reject(new Error("offline"));
        }),
    );
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={vi.fn()}
        lookupAdapters={{ place: { search } }}
      />,
    );
    await openLeaf();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Резултати за място" }));
    const input = screen.getByRole("combobox", { name: "Място" });
    fireEvent.change(input, { target: { value: "Со" } });
    fireEvent.change(input, { target: { value: "Соф" } });
    await act(async () => resolveNew?.([{ value: "1", label: "София" }]));
    expect(await screen.findByRole("option", { name: "София" })).toBeVisible();
    await act(async () => resolveOld?.([{ value: "2", label: "Созопол" }]));
    expect(screen.queryByRole("option", { name: "Созопол" })).toBeNull();
    fireEvent.change(input, { target: { value: "грешка" } });
    expect(
      await screen.findByText(
        "Търсенето временно не е достъпно. Опитайте отново.",
      ),
    ).toHaveAttribute("role", "status");
  });

  it("validates initial readiness, displays defaults, and localizes field errors", async () => {
    const { unmount } = render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        initialQuestionId="defaulted"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Тема" })).toHaveValue("бюджет");
    unmount();
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        initialQuestionId="sql-only"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Въпрос sql-only" }),
    ).toBeNull();

    cleanup();
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        initialQuestionId="bounded"
        onSelect={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const year = screen.getByRole("spinbutton", { name: "Година" });
    await user.clear(year);
    await user.type(year, "2030");
    await user.click(screen.getByRole("button", { name: "Използвай въпроса" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Максималната стойност е 2026.");
    expect(year).toHaveAttribute("aria-invalid", "true");
    expect(year).toHaveAttribute("aria-describedby", error.id);
    await user.clear(year);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("searches globally in both languages and shows an empty state", async () => {
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="en"
        onSelect={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", {
      name: "Search all questions",
    });
    await user.type(search, "Results for a place");
    expect(
      screen.getByRole("button", { name: "Results for a place" }),
    ).toBeVisible();
    await user.clear(search);
    await user.type(search, "missing phrase");
    expect(
      screen.getByText("No questions match this selection."),
    ).toBeVisible();
  });

  it("keeps unavailable questions out of ready results but explains them on request", async () => {
    render(
      <QuestionSelector
        catalog={catalog}
        surface="chat"
        lang="bg"
        onSelect={vi.fn()}
      />,
    );
    const user = await openLeaf();
    expect(screen.queryByRole("button", { name: /sql-only/ })).toBeNull();
    await user.click(
      screen.getByRole("checkbox", { name: "Покажи и неналичните" }),
    );
    await user.click(screen.getByRole("button", { name: "Още въпроси" }));
    const unavailable = screen.getByRole("button", { name: /Въпрос sql-only/ });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    expect(unavailable).toHaveTextContent("Само SQL");
  });
});
