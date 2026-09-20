import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArticleRecord,
  HomeBundle,
  HomeStory,
  Stats,
  TaxonomyCategory,
} from "../data";
import { NEWS_BRIEFING_STORAGE_KEY } from "../briefing";

const NOW = Date.parse("2026-08-31T07:00:00Z");

beforeEach(() => localStorage.clear());

const stats: Stats = {
  generated_at: "2026-08-31T07:00:00Z",
  taxonomy_version: 1,
  accepted_snapshot_records_sha256: null,
  accepted_feedback_records_sha256: null,
  total_articles: 4366,
  analyzed_articles: 365,
  analyzed_pct: 8.4,
  stories: 86,
  domains: 55,
  outlets_catalogued: 59,
  first_published: "2007-06-13T21:07:26Z",
  last_published: "2026-08-31T07:00:00Z",
  articles_by_domain: {},
};

const story = (id: string, published: string, topic?: string): HomeStory => ({
  id,
  title_bg: id,
  title_en: null,
  summary_bg: "Резюме",
  summary_en: null,
  last_published: published,
  topics: topic ? [{ category: topic, subcategory: null, primary: true }] : [],
  aggregates: {
    article_count: 1,
    outlet_count: 1,
    by_leaning: {},
    by_russia_stance: {},
    by_party_tone: {},
    by_domain: {},
  },
});

const homeArticle = (id: string, storyId: string): ArticleRecord =>
  ({
    id,
    domain: "example.bg",
    title: id,
    url: `https://example.bg/${id}`,
    published: "2026-08-31T06:00:00Z",
    image: "https://cdn.example.bg/lead.jpg",
    image_rights: {
      status: "cc",
      creator: "Автор",
      credit_text: "Автор · CC BY 4.0",
      credit_url: "https://commons.wikimedia.org/wiki/File:Lead.jpg",
      licence_name: "CC BY 4.0",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      source_url: "https://commons.wikimedia.org/wiki/File:Lead.jpg",
      checked_at: "2026-08-31",
      display_home: true,
    },
    story_id: storyId,
    analysis: { summary_bg: "Резюме" },
  }) as ArticleRecord;

const home = (
  stories: HomeStory[],
  homeArticles: ArticleRecord[] = [],
): HomeBundle => ({
  version: 3,
  generated_at: "2026-08-31T07:00:00Z",
  eligibility: "published_recent_analyzed_with_cleared_images_only",
  window_days: 30,
  event_dedupe: "conservative_title_entity_v1",
  merge_proposals: [],
  home_health: {
    version: 1,
    default_days: 1,
    thresholds: {
      stories_for_24h_default: 6,
      maximum_implicit_days: 7,
      newest_story_max_hours: 24,
    },
    counts: {
      recent_raw: stories.length,
      recent_analyzed: stories.length,
      recent_story_linked: stories.length,
      recent_image_cleared: 0,
      selected_unique_events: stories.length,
      selected_within_24h: stories.length,
      default_visible: stories.length,
      default_comparisons: 0,
      default_image_eligible: 0,
      merge_proposals: 0,
    },
    default_age_hours: {
      newest_hours: null,
      median_hours: null,
      oldest_hours: null,
    },
    default_payload: [],
    checks: {
      selected_payload_not_empty: Boolean(stories.length),
      has_story_within_24h: Boolean(stories.length),
      default_window_at_most_7_days: true,
      default_payload_not_empty: Boolean(stories.length),
      selected_story_ids_unique: true,
      default_story_ids_unique: true,
      default_oldest_within_window: Boolean(stories.length),
      no_future_story_timestamps: true,
      every_default_story_has_analyzed_article: true,
    },
    ready: Boolean(stories.length),
  },
  stories,
  articles: homeArticles,
});

const renderHome = async (
  bundle: HomeBundle | null,
  statsData: Stats | null = null,
  categories: TaxonomyCategory[] = [],
  initialEntry = "/",
) => {
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useHome: () => ({ data: bundle, error: null, loading: bundle === null }),
    useStats: () => ({
      data: statsData,
      error: null,
      loading: statsData === null,
    }),
    useTaxonomy: () => ({
      data: { version: 1, categories },
      error: null,
      loading: false,
    }),
    useOutlets: () => ({
      data: { generated_at: "", outlets: [] },
      error: null,
      loading: false,
    }),
  }));
  const { HomeScreen } = await import("./HomeScreen");
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HomeScreen />
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
  Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
});

describe("home adaptive freshness window", () => {
  it("does not announce an expansion before the bundle loads", async () => {
    await renderHome(null);
    expect(screen.queryByText(/показваме последните/)).toBeNull();
  });

  it("defaults to 24 hours when six recent stories exist", async () => {
    await renderHome(
      home(
        Array.from({ length: 6 }, (_, index) =>
          story(`recent-${index}`, "2026-08-31T06:00:00Z"),
        ),
      ),
    );
    expect(screen.getByRole("button", { name: "24 часа" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText(/показваме последните/)).toBeNull();
  });

  it("expands only to seven days for a thin recent feed", async () => {
    await renderHome(home([story("weekly", "2026-08-27T06:00:00Z")]));
    expect(screen.getByRole("button", { name: "7 дни" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(
        "Няма достатъчно истории за 24 часа — показваме последните 7 дни.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "30 дни" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("keeps corpus detail in a compact coverage disclosure", async () => {
    await renderHome(home([story("weekly", "2026-08-31T06:00:00Z")]), stats);
    const summary = screen.getByText(/Покритие: 86 истории · 8.4% анализирани/);
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(summary.closest("summary")!);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText(/365 анализирани статии/)).toBeVisible();
  });

  it("uses a one-sentence mobile-first proposition", async () => {
    await renderHome(home([story("weekly", "2026-08-31T06:00:00Z")]));
    expect(
      screen.getByText(
        "Сравнете как българските медии разказват едни и същи събития и къде се различават.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/сигнали за съдържание/)).toBeNull();
  });

  it("shows every story, with no interests section and no following", async () => {
    // ⚠️ THE PAIR MATTERS. „Водещи истории извън интересите ви" existed to
    // prove nothing had been pushed out of the briefing by a followed topic;
    // withdrawing the following without it would hide stories silently, so
    // both went together until there is an account to hold the preference.
    const politics = {
      id: "politics",
      label: { bg: "Политика", en: "Politics" },
    } as TaxonomyCategory;
    const economy = {
      id: "economy",
      label: { bg: "Икономика", en: "Economy" },
    } as TaxonomyCategory;
    const stories = [
      story("Политическа история", "2026-08-31T06:00:00Z", "politics"),
      story("Икономическа история", "2026-08-31T05:00:00Z", "economy"),
    ];
    // A browser that ALREADY followed a topic must not keep a filtered
    // briefing — the empty list is passed at the call site, not by rewriting
    // what is stored.
    localStorage.setItem(
      NEWS_BRIEFING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cadence: "daily",
        density: "detailed",
        followedTopics: ["politics"],
        lastCompletedAt: null,
        completedStoryIds: [],
      }),
    );
    await renderHome(
      home(stories, [
        homeArticle("a1", stories[0].id),
        homeArticle("a2", stories[1].id),
      ]),
      null,
      [politics, economy],
    );

    expect(screen.getByRole("heading", { name: "Обнови ме" })).toHaveClass(
      "sr-only",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Водещи истории извън интересите ви",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Избор на следвани теми" }),
    ).toBeNull();
    // Both stories are present, although one is outside the stored interest.
    expect(screen.getAllByText("Политическа история").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Икономическа история").length).toBeGreaterThan(
      0,
    );
  });

  it("persists a local completion state without creating an endless feed", async () => {
    const item = story("Една история", "2026-08-31T06:00:00Z", "politics");
    await renderHome(home([item], [homeArticle("a1", item.id)]));
    fireEvent.click(screen.getByRole("button", { name: "Приключих прегледа" }));
    const stored = JSON.parse(
      localStorage.getItem(NEWS_BRIEFING_STORAGE_KEY) ?? "null",
    );
    expect(stored.lastCompletedAt).toBe("2026-08-31T07:00:00.000Z");
    expect(stored.completedStoryIds).toEqual([item.id]);
    expect(screen.getByText(/0 истории/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Прегледът е завършен" }),
    ).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Обнови ме" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Още анализирани истории" }),
    ).toBeVisible();
    expect(screen.getByText(item.id)).toBeVisible();
    expect(screen.queryByText(/Зареди още/)).not.toBeInTheDocument();
  });

  it("uses the URL period as the displayed cadence and restores a saved week", async () => {
    const recent = Array.from({ length: 6 }, (_, index) =>
      story(`recent-${index}`, "2026-08-31T06:00:00Z"),
    );
    localStorage.setItem(
      NEWS_BRIEFING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cadence: "weekly",
        density: "detailed",
        followedTopics: [],
        lastCompletedAt: null,
        completedStoryIds: [],
      }),
    );
    await renderHome(
      home(
        recent,
        recent.map((item, index) => homeArticle(`a${index}`, item.id)),
      ),
    );
    expect(screen.getByRole("button", { name: "7 дни" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Седмичен" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await renderHome(
      home(
        recent,
        recent.map((item, index) => homeArticle(`b${index}`, item.id)),
      ),
      null,
      [],
      "/?days=30",
    );
    expect(
      screen.getAllByText(/персонализиран период от 30 дни/),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: "Дневен" }).at(-1),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getAllByRole("button", { name: "Седмичен" }).at(-1),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("records empty/result search outcomes", async () => {
    const politics = {
      id: "politics",
      label: { bg: "Политика", en: "Politics" },
    } as TaxonomyCategory;
    const economy = {
      id: "economy",
      label: { bg: "Икономика", en: "Economy" },
    } as TaxonomyCategory;
    localStorage.setItem(
      NEWS_BRIEFING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cadence: "daily",
        density: "detailed",
        followedTopics: ["economy"],
        lastCompletedAt: null,
        completedStoryIds: [],
      }),
    );
    const matches = [
      story("Политика едно", "2026-08-31T06:00:00Z", "politics"),
      story("Политика две", "2026-08-31T05:00:00Z", "politics"),
    ];
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    await renderHome(
      home(matches, [
        homeArticle("a1", matches[0].id),
        homeArticle("a2", matches[1].id),
      ]),
      null,
      [politics, economy],
      "/?q=Политика",
    );

    expect(screen.getAllByText("Политика едно").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Политика две").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "search",
        outcome: "results",
      }),
    );
    expect(screen.getByText("2 истории")).toHaveClass("sr-only");
  });

  it("records an empty search outcome without storing the query", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    await renderHome(home([]), null, [], "/?q=private-empty-query");

    expect(screen.getByText("Няма истории за избраните филтри.")).toBeVisible();
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_outcome",
        task: "search",
        outcome: "empty",
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toContain(
      "private-empty-query",
    );
  });
});
