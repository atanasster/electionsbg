import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ArticleRow } from "./ArticleRow";

describe("ArticleRow source navigation", () => {
  it("uses one external focus stop when no internal article page exists", () => {
    render(
      <MemoryRouter>
        <ArticleRow
          title="Оригинален материал"
          domain="example.bg"
          outletName="Пример"
          published={null}
          url="https://example.bg/a"
          articleId={null}
        />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2); // outlet profile + external headline
    expect(
      screen.getByRole("link", {
        name: /Оригинален материал — прочети оригинала в Пример.*нов раздел/,
      }),
    ).toHaveAttribute("href", "https://example.bg/a");
  });

  it("keeps a separate original link beside an internal analysis page", () => {
    render(
      <MemoryRouter>
        <ArticleRow
          title="Анализиран материал"
          domain="example.bg"
          outletName="Пример"
          published={null}
          url="https://example.bg/a"
          articleId="a1"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Анализиран материал" }),
    ).toHaveAttribute("href", "/article/example.bg/a1");
    expect(
      screen.getByRole("link", { name: /Прочети оригинала/ }),
    ).toBeVisible();
  });
});
