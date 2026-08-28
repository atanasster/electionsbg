import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_NEWS_KEY } from "../components/savedNews";
import { SavedScreen } from "./SavedScreen";

vi.mock("../data", () => ({
  useStories: () => ({
    data: {
      stories: [{ id: "a", title_bg: "Проверена история", title_en: null }],
    },
  }),
  useLatest: () => ({
    data: {
      articles: [
        { domain: "example.bg", id: "x", title: "Първа статия" },
        { domain: "example.bg", id: "y", title: "Втора статия" },
        {
          domain: "pik.bg",
          id: "20260821-българия-a1",
          title: "Статия с кирилски адрес",
        },
      ],
    },
  }),
}));

describe("SavedScreen", () => {
  beforeEach(() => localStorage.clear());

  it("explains empty browser-local storage", () => {
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/само в този браузър/)).toBeVisible();
    expect(screen.getByText(/Още няма запазени/)).toBeVisible();
  });

  it("resolves links and supports per-item and clear-all deletion", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/story/a", "/article/example.bg/x"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Проверена история" }),
    ).toHaveAttribute("href", "/story/a");
    fireEvent.click(
      screen.getByRole("button", { name: /Премахни Проверена история/ }),
    );
    expect(JSON.parse(localStorage.getItem(SAVED_NEWS_KEY) ?? "[]")).toEqual([
      "/article/example.bg/x",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Изчисти всички" }));
    expect(screen.getByText(/Още няма запазени/)).toBeVisible();
  });

  it("gives same-outlet articles distinct titles and removal names", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/article/example.bg/x", "/article/example.bg/y"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Първа статия" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Втора статия" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Премахни Първа статия" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Премахни Втора статия" }),
    ).toBeVisible();
  });

  it("announces denied removal and preserves the list", () => {
    localStorage.setItem(SAVED_NEWS_KEY, JSON.stringify(["/story/a"]));
    render(
      <MemoryRouter>
        <SavedScreen persistSaved={() => false} />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Премахни Проверена история" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Браузърът не позволи промяната",
    );
    expect(
      screen.getByRole("link", { name: "Проверена история" }),
    ).toBeVisible();
  });

  it("renders a saved article whose corpus id contains Cyrillic", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/article/pik.bg/20260821-българия-a1"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Статия с кирилски адрес" }),
    ).toHaveAttribute("href", "/article/pik.bg/20260821-българия-a1");
  });
});
