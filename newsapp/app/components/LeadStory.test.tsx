import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ArticleRecord, Outlet, Story } from "../data";
import type { HomeLeadStoryItem } from "../homeHierarchy";
import { LeadStory } from "./LeadStory";

const imageArticle = {
  id: "article",
  domain: "example.bg",
  title: "Източниково заглавие",
  url: "https://example.bg/article",
  image: "https://upload.wikimedia.org/photo.jpg",
  image_alt: "Описателен надпис",
  story_id: "story",
  analysis: { summary_bg: "Резюме" },
  image_rights: {
    status: "cc",
    creator: "Автор",
    credit_text: "Автор · CC BY 4.0",
    credit_url: "https://commons.wikimedia.org/photo",
    licence_name: "CC BY 4.0",
    licence_url: "https://creativecommons.org/licenses/by/4.0/",
    source_url: "https://commons.wikimedia.org/photo",
    checked_at: "2026-08-28",
    display_home: true,
  },
} as ArticleRecord;

const story = {
  id: "story",
  title_bg: "Водеща история",
  title_en: null,
  summary_bg: "Синтезирано резюме",
  last_published: "2026-08-28T09:00:00Z",
  topics: [],
  aggregates: {
    outlet_count: 2,
    article_count: 2,
    by_domain: { "example.bg": 1, "second.bg": 1 },
  },
} as unknown as Story;

const outlets = [
  { domain: "example.bg", outlet: "Пример", rank: 2 },
  { domain: "second.bg", outlet: "Втори източник", rank: 1 },
] as Outlet[];

describe("LeadStory accessibility", () => {
  it("keeps credit, licence and story link in keyboard order and uses h3", async () => {
    const user = userEvent.setup();
    const item = {
      story,
      imageArticle,
      kind: "comparison",
    } as HomeLeadStoryItem;
    render(
      <MemoryRouter>
        <LeadStory item={item} taxonomy={null} outlets={outlets} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Водеща история" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Описателен надпис" }),
    ).toHaveAttribute("loading", "eager");
    const imageFrame = screen.getByRole("img", {
      name: "Описателен надпис",
    }).parentElement;
    expect(imageFrame).toHaveClass("aspect-[16/10]");
    expect(imageFrame).not.toHaveClass("md:aspect-auto", "md:min-h-80");
    const credit = screen.getByRole("link", {
      name: /Кредит за изображението/,
    });
    const licence = screen.getByRole("link", { name: /Условия на лиценза/ });
    const storyLink = screen.getByRole("link", {
      name: "Водеща история Синтезирано резюме",
    });
    expect(credit).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/photo",
    );
    expect(storyLink).toHaveAttribute("href", "/story/story");
    expect(screen.queryByText("Сравни отразяването")).toBeNull();
    expect(screen.queryByText("Анализирана статия")).toBeNull();
    expect(screen.getByText("Втори източник")).toBeVisible();
    expect(screen.getByText("Пример")).toBeVisible();
    await user.tab();
    expect(credit).toHaveFocus();
    await user.tab();
    expect(licence).toHaveFocus();
    await user.tab();
    expect(storyLink).toHaveFocus();
  });
});
