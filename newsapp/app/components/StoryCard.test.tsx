import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ArticleRecord, HomeStory } from "../data";
import { StoryCard } from "./StoryCard";

const story = {
  id: "story-1",
  title_bg: "История с ясен път",
  title_en: null,
  summary_bg: "Кратко резюме",
  summary_en: null,
  last_published: "2026-08-28T09:00:00Z",
  topics: [{ category: "society", subcategory: null, primary: true }],
  aggregates: {
    outlet_count: 2,
    article_count: 2,
    by_leaning: { neutral: 2 },
    by_russia_stance: {},
    by_domain: {},
  },
} satisfies HomeStory;

const imageArticle = {
  id: "article-1",
  domain: "example.bg",
  title: "Източниково заглавие",
  url: "https://example.bg/article",
  image: "https://upload.wikimedia.org/photo.jpg",
  image_alt: "Снимка към историята",
  story_id: story.id,
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

describe("StoryCard interaction scent", () => {
  it("exposes one descriptive story link with a visible action label", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <StoryCard
          story={story}
          taxonomy={null}
          kind="comparison"
          imageArticle={imageArticle}
        />
      </MemoryRouter>,
    );

    const storyLink = screen.getByRole("link", {
      name: "Сравни отразяването: История с ясен път",
    });
    expect(storyLink).toHaveAttribute("href", "/story/story-1");
    expect(screen.getByText("Сравни отразяването")).toBeVisible();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://commons.wikimedia.org/photo",
      "https://creativecommons.org/licenses/by/4.0/",
      "/story/story-1",
    ]);
    expect(document.querySelector("a a")).toBeNull();
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    await user.tab();
    expect(storyLink).toHaveFocus();
  });
});
