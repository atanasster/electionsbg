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
    // The story link comes FIRST. The credit and licence links live in the
    // figure's caption, which renders BELOW the headline now that the media is
    // a side thumbnail — so the figure is written after the headline and tab
    // order matches what a sighted reader scans. While the media was a block
    // above the text, the caption was above the headline and this order was
    // the reverse.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/story/story-1",
      "https://commons.wikimedia.org/photo",
      "https://creativecommons.org/licenses/by/4.0/",
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
    // What is asserted instead is that the media is a GRID ITEM of the card
    // body, placed by area rather than by document order. That is the whole
    // §4.4 anatomy in one check: the figure sits inside the same grid as the
    // headline, the credit and the footer, and its `display: contents` wrapper
    // is what lets the image and its caption land in different areas.
    const body = container.querySelector(".news-card-body");
    const figure = container.querySelector("figure");
    expect(body).toHaveClass("news-card-grid");
    expect(figure).not.toBeNull();
    expect(figure!.parentElement).toBe(body);
    expect(figure!.querySelector(".news-card-media")).not.toBeNull();
    await user.tab();
    expect(storyLink).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    await user.tab();
    expect(links[2]).toHaveFocus();
  });

  it("only claims a difference when the labels actually differ", () => {
    // ⚠️ THE CUE IS A CLAIM ABOUT NAMED OUTLETS. Deriving it from label
    // PRESENCE rather than divergence made it false for every comparison story
    // in the live corpus — measured 2026-09-01, both are uniform
    // (`{neutral: 2}` and `{neutral: 3}`). The spectrum bar it replaced was
    // honest by construction because it DREW the distribution; a sentence has
    // to earn that itself.
    const render_ = (aggregates: Partial<HomeStory["aggregates"]>) =>
      render(
        <MemoryRouter>
          <StoryCard
            story={{
              ...story,
              aggregates: { ...story.aggregates, ...aggregates },
            }}
            taxonomy={null}
            kind="comparison"
            imageArticle={null}
            outlets={outlets}
          />
        </MemoryRouter>,
      );

    const uniform = render_({ by_leaning: { neutral: 2 } });
    expect(uniform.container.textContent).toContain("сходно рамкиране");
    expect(uniform.container.textContent).not.toContain("различия");
    uniform.unmount();

    const divergent = render_({ by_leaning: { neutral: 1, progressive: 1 } });
    expect(divergent.container.textContent).toContain("различия в рамкирането");
    divergent.unmount();

    // `not_applicable` is not a position, so it can never make a second one.
    const notApplicable = render_({
      by_leaning: { neutral: 2, not_applicable: 3 },
    });
    expect(notApplicable.container.textContent).toContain("сходно рамкиране");
    notApplicable.unmount();

    // A single-source story is not a comparison and states nothing at all.
    const single = render_({ by_leaning: { neutral: 1, progressive: 1 } });
    single.unmount();
    const { container } = render(
      <MemoryRouter>
        <StoryCard
          story={story}
          taxonomy={null}
          kind="analyzed_article"
          imageArticle={null}
          outlets={outlets}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toContain("рамкиране");
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
    const body = textCard!.querySelector(".news-card-body");
    expect(body).not.toBeNull();
    // ⚠️ "No figure" is not "no media slot" — a card can reserve an empty
    // column and still render nothing in it, which is the placeholder
    // treatment AC#5 forbids. The media column is opt-in, so its ABSENCE is
    // what has to be asserted.
    expect(body).not.toHaveClass("news-card-grid--media");
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
