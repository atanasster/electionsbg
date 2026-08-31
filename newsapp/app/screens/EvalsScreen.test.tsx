import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EvalArticleScreen } from "./EvalArticleScreen";
import { EvalsScreen } from "./EvalsScreen";

describe("public evaluation routes", () => {
  it("explains that the queue is public and requires no account", () => {
    render(
      <MemoryRouter initialEntries={["/evals"]}>
        <EvalsScreen />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Помогнете да проверим анализите" }),
    ).toBeVisible();
    expect(screen.getByText(/Не е необходим профил или вход/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /вход|регистрация/i }),
    ).toBeNull();
  });

  it("opens an article workspace without an authentication provider", () => {
    render(
      <MemoryRouter initialEntries={["/evals/article/example.bg/article-1"]}>
        <Routes>
          <Route
            path="/evals/article/:domain/:id"
            element={<EvalArticleScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Оценяване на статия" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Към публичната страница на статията",
      }),
    ).toHaveAttribute("href", "/article/example.bg/article-1");
    expect(screen.getByText(/без регистрация/i)).toBeVisible();
  });
});
