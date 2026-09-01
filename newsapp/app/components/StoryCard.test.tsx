import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord, HomeStory, Outlet } from "../data";
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
    by_party_tone: {},
    by_domain: { "example.bg": 1, "second.bg": 1 },
  },
} satisfies HomeStory;

const outlets = [
  { domain: "example.bg", outlet: "Пример", rank: 2 },
  { domain: "second.bg", outlet: "Втори източник", rank: 1 },
] as Outlet[];

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
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));
  it("links the headline and summary without a redundant CTA", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <StoryCard
          story={story}
          taxonomy={null}
          kind="comparison"
          imageArticle={imageArticle}
          outlets={outlets}
        />
      </MemoryRouter>,
    );

    const storyLink = screen.getByRole("link", {
      name: "История с ясен път Кратко резюме",
    });
    expect(storyLink).toHaveAttribute("href", "/story/story-1");
    expect(
      within(storyLink).getByRole("heading", {
        level: 3,
        name: "История с ясен път",
      }),
    ).toBeVisible();
    expect(within(storyLink).getByText("Кратко резюме")).toBeVisible();
    expect(storyLink).toHaveClass("focus-visible:ring-2");
    expect(screen.queryByText(/сравни отразяването/i)).toBeNull();
    expect(screen.queryByText(/прочети анализа/i)).toBeNull();
    expect(screen.queryByText(/анализирана статия/i)).toBeNull();
    expect(screen.getAllByText("Втори източник")).toHaveLength(2);
    expect(screen.getByText("Пример")).toBeVisible();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://commons.wikimedia.org/photo",
      "https://creativecommons.org/licenses/by/4.0/",
      "/story/story-1",
    ]);
    expect(document.querySelector("a a")).toBeNull();
    const caption = document.querySelector("figcaption");
    expect(caption).not.toBeNull();
    expect(within(caption!).getByText("Изображение: Автор")).toBeVisible();
    expect(within(caption!).getByText("CC BY 4.0")).toBeVisible();
    expect(caption).not.toHaveTextContent("http");
    expect(caption?.textContent?.match(/CC BY 4\.0/g)).toHaveLength(1);
    // The STRUCTURE §4.4 changes, not the height mechanism it retires.
    // `h-full`/`self-start` is what the side thumbnail replaces, so pinning it
    // here would fail the release gate before the rewrite could land. Card
    // HEIGHT is measured against the rendered page in
    // `tests/news/home-grid.spec.ts` — ⚠️ currently `test.fail()`, i.e.
    // documenting the live defect; those become enforced bounds when Phase 1
    // removes the annotations.
    //
    // What is asserted instead is that the media block and the body are
    // SIBLINGS inside the card. That holds for today's stacked anatomy and for
    // a side thumbnail, and nothing else in this test covers it — unlike
    // `figure`, which `figcaption` above already implies.
    const figure = container.querySelector("figure");
    expect(figure).not.toBeNull();
    expect(figure!.parentElement).toBe(
      container.querySelector(".news-card-body")!.parentElement,
    );
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    await user.tab();
    expect(storyLink).toHaveFocus();
  });

  it("renders a safe text-first fallback when no cleared image exists", () => {
    const { container } = render(
      <MemoryRouter>
        <StoryCard
          story={story}
          taxonomy={null}
          kind="comparison"
          imageArticle={null}
          outlets={outlets}
        />
      </MemoryRouter>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector(".aspect-\\[16\\/10\\]")).toBeNull();
    const textCard = container.querySelector(".news-story-card--text");
    expect(textCard).not.toBeNull();
    // A text-first card has NO media column at all — not an empty one (§4.4
    // AC#5: "reserve no fake media slot"). §4.4 keeps this falsifiable: the
    // thumbnail becomes a sibling of the body, present on an image-led card
    // and absent here. No optional chain — `expect(undefined).not.toBeNull()`
    // passes, so a chained assertion would carry no weight of its own.
    //
    // ⚠️ `--text` is queried here while `scripts/news_home_layout.test.ts`
    // deliberately de-pinned it in the CSS. That is not an oversight: §4.4 may
    // widen the KICKER to every card, but the modifier is retained as the DOM
    // marker for "this card has no media". If §4.4 removes the class as well,
    // this query moves to `.news-story-card` and the assertions below stand.
    expect(textCard!.querySelector("figure")).toBeNull();
    expect(textCard!.querySelector(".news-card-body")).not.toBeNull();
    expect(screen.getAllByText("society")).toHaveLength(1);
    expect(
      screen.getByRole("link", {
        name: "История с ясен път Кратко резюме",
      }),
    ).toHaveAttribute("href", "/story/story-1");
  });

  it("offers a genuinely compact local format and a low-cardinality task signal", async () => {
    const user = userEvent.setup();
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const { container } = render(
      <MemoryRouter>
        <StoryCard
          story={story}
          taxonomy={null}
          kind="comparison"
          density="compact"
          imageArticle={imageArticle}
          outlets={outlets}
        />
      </MemoryRouter>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Кратко резюме")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "История с ясен път" }));
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_task",
        task: "find_story",
        signal: "completed",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toContain("story-1");
  });
});
