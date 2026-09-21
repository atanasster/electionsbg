import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderList = async (data: unknown, error: Error | null = null) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useCases: () => ({ data, error, loading: data === null && !error }),
  }));
  const { CasesScreen } = await import("./CasesScreen");
  render(
    <MemoryRouter initialEntries={["/cases"]}>
      <CasesScreen />
    </MemoryRouter>,
  );
};

afterEach(() => vi.resetModules());

describe("the case register", () => {
  it("lists each case with its counts, and says when a timeline is withheld", async () => {
    await renderList({
      generated_at: "",
      version: 1,
      editorial_note: { bg: "Редакционен подбор.", en: "Editorial selection." },
      cases: [
        {
          slug: "petrohan",
          name: { bg: "Петрохан", en: "P" },
          description: {
            bg: "Досъдебно производство.",
            en: "An investigation.",
          },
          opened_on: "2026-02-13",
          membership: "attached",
          story_count: 12,
          article_count: 30,
          outlets: { "a.bg": 20, "b.bg": 10 },
          rule_version: 1,
        },
        {
          slug: "narco-pardon",
          name: { bg: "Помилването", en: "The pardon" },
          description: { bg: "Помилване от 2022 г.", en: "A 2022 pardon." },
          opened_on: "2026-09-11",
          membership: "review",
          story_count: 0,
          article_count: 0,
          outlets: {},
          rule_version: 1,
        },
      ],
    });
    expect(screen.getByText("Редакционен подбор.")).toBeVisible();
    // The register says what each affair IS, not only its counts.
    expect(screen.getByText("Досъдебно производство.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Петрохан" })).toHaveAttribute(
      "href",
      "/case/petrohan",
    );
    expect(screen.getByText(/12 истории · 30 статии · 2 медии/)).toBeVisible();
    expect(screen.getByText(/хронологията не се публикува/)).toBeVisible();
  });

  it("tells a failed load from an empty register", async () => {
    await renderList(null, new Error("offline"));
    expect(screen.getByText(/не се зареди: offline/)).toBeVisible();
    cleanup();
    await renderList({
      generated_at: "",
      version: 1,
      editorial_note: { bg: "", en: "" },
      cases: [],
    });
    expect(screen.getByText(/Регистърът е празен/)).toBeVisible();
  });
});
