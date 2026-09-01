import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeBundle, HomeStory, Stats } from "../data";

const NOW = Date.parse("2026-08-31T07:00:00Z");

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

const story = (id: string, published: string): HomeStory => ({
  id,
  title_bg: id,
  title_en: null,
  summary_bg: "Резюме",
  summary_en: null,
  last_published: published,
  topics: [],
  aggregates: {
    article_count: 1,
    outlet_count: 1,
    by_leaning: {},
    by_russia_stance: {},
    by_party_tone: {},
    by_domain: {},
  },
});

const home = (stories: HomeStory[]): HomeBundle => ({
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
  articles: [],
});

const renderHome = async (
  bundle: HomeBundle | null,
  statsData: Stats | null = null,
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
      data: { version: 1, categories: [] },
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
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
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
});
