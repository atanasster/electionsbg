import { render, screen, within } from "@testing-library/react";
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
  it("keeps the headline first on mobile and all links in keyboard order", async () => {
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
    expect(
      within(storyLink).getByRole("heading", {
        level: 3,
        name: "Водеща история",
      }),
    ).toBeVisible();
    expect(within(storyLink).getByText("Синтезирано резюме")).toBeVisible();
    expect(screen.queryByText(/сравни отразяването/i)).toBeNull();
    expect(screen.queryByText(/прочети анализа/i)).toBeNull();
    expect(screen.queryByText(/анализирана статия/i)).toBeNull();
    expect(document.querySelector("a a")).toBeNull();
    expect(storyLink.compareDocumentPosition(credit)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getAllByText("Втори източник")).toHaveLength(2);
    expect(screen.getByText("Пример")).toBeVisible();
    await user.tab();
    expect(storyLink).toHaveFocus();
    await user.tab();
    expect(credit).toHaveFocus();
    await user.tab();
    expect(licence).toHaveFocus();
  });

  it("shrinks the lead for compact rather than dropping it", () => {
    const item = {
      story,
      imageArticle,
      kind: "comparison",
    } as HomeLeadStoryItem;
    // ⚠️ Compact used to render NO lead at all, which removed the one
    // composition the page is built around and left compact as the standard
    // grid with less in each card. It keeps the module now, and has to earn it
    // by being smaller — the media ratio ALONE does not do that, because the
    // two columns are a grid row and the figure stretches to whichever side is
    // taller. Measured 2026-09-02 at 768px, a shallower ratio with an unchanged
    // body saved exactly 0px.
    const { container, unmount } = render(
      <MemoryRouter>
        <LeadStory
          item={item}
          taxonomy={null}
          outlets={outlets}
          density="compact"
        />
      </MemoryRouter>,
    );
    expect(container.querySelector(".news-story-card")).not.toBeNull();
    expect(container.querySelector(".aspect-\\[21\\/9\\]")).not.toBeNull();
    expect(container.querySelector(".news-story-summary")).toHaveClass(
      "line-clamp-2",
    );
    unmount();

    const detailed = render(
      <MemoryRouter>
        <LeadStory item={item} taxonomy={null} outlets={outlets} />
      </MemoryRouter>,
    );
    expect(
      detailed.container.querySelector(".aspect-\\[16\\/10\\]"),
    ).not.toBeNull();
    expect(detailed.container.querySelector(".news-story-summary")).toHaveClass(
      "line-clamp-3",
    );
  });
});
