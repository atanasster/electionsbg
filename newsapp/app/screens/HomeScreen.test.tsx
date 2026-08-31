import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeBundle, HomeStory } from "../data";

const NOW = Date.parse("2026-08-31T07:00:00Z");

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
  stories,
  articles: [],
});

const renderHome = async (bundle: HomeBundle | null) => {
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useHome: () => ({ data: bundle, error: null, loading: bundle === null }),
    useStats: () => ({ data: null, error: null, loading: true }),
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
    expect(screen.queryByRole("status")).toBeNull();
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
});
