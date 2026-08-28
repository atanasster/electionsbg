import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { StoryMember } from "../data";
import { ArticleRow, StoryMemberRow } from "./ArticleRow";

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

  it("uses the aligned source layout for story members", () => {
    const member: StoryMember = {
      domain: "example.bg",
      article_id: "a1",
      url: "https://example.bg/a",
      title: "Заглавие на източника",
      published: "2026-08-27T09:00:00Z",
      leaning: "neutral",
      russia_stance: "neutral",
      first_seen: null,
      scoop_lag_hours: null,
      first_here: false,
      scoop_decidable: false,
    };

    const { container } = render(
      <MemoryRouter>
        <StoryMemberRow
          member={member}
          outletName="БИРД (Bureau for Investigative Reporting and Data)"
        />
      </MemoryRouter>,
    );

    expect(container.querySelector(".news-source-row")).toBeInTheDocument();
    expect(container.querySelector(".news-source-meta")).toHaveTextContent(
      "БИРД (Bureau for Investigative Reporting and Data)",
    );
    const outletLink = screen.getByRole("link", {
      name: "БИРД (Bureau for Investigative Reporting and Data)",
    });
    expect(outletLink).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(outletLink).not.toHaveClass("shrink-0");
    expect(container.querySelector(".news-source-content")).toHaveTextContent(
      "Заглавие на източника",
    );
    expect(container.querySelectorAll(".news-analysis-badge")).toHaveLength(2);
    expect(container.querySelector(".news-source-action a")).toHaveAttribute(
      "href",
      "https://example.bg/a",
    );
  });
});
