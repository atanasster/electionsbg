import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "../data";

const story: Story = {
  id: "private-story-id",
  title_bg: "Тестова история",
  title_en: null,
  summary_bg: "Резюме",
  summary_en: null,
  first_published: "2026-08-27T08:00:00Z",
  last_published: "2026-08-27T09:00:00Z",
  topics: [],
  related_story_ids: [],
  entities: {
    people: [],
    parties: [],
    institutions: [],
    companies: [],
    places: [],
  },
  aggregates: {
    article_count: 2,
    outlet_count: 2,
    by_leaning: { progressive: 1, conservative: 1 },
    by_russia_stance: { pro_russia: 1, anti_russia: 1 },
    by_party_tone: {},
    by_domain: { "left.example": 1, "right.example": 1 },
  },
  blindspot: null,
  members: [
    {
      domain: "left.example",
      article_id: "private-member-left",
      url: "https://left.example/private",
      title: "Ляв материал",
      published: "2026-08-27T08:00:00Z",
      leaning: "progressive",
      russia_stance: "pro_russia",
      first_seen: null,
      scoop_lag_hours: null,
      first_here: false,
      scoop_decidable: false,
    },
    {
      domain: "right.example",
      article_id: "private-member-right",
      url: "https://right.example/private",
      title: "Десен материал",
      published: "2026-08-27T09:00:00Z",
      leaning: "conservative",
      russia_stance: "anti_russia",
      first_seen: null,
      scoop_lag_hours: null,
      first_here: false,
      scoop_decidable: false,
    },
  ],
};

describe("StoryScreen analytics", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
  });

  it("reports only filter axes and activation state", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    vi.doMock("../data", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../data")>()),
      useStories: () => ({
        data: { generated_at: "", stories: [story] },
        error: null,
        loading: false,
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
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    const reportBody = new URL(
      screen
        .getByRole("link", { name: /Сигнализирай проблем/ })
        .getAttribute("href")!,
    ).searchParams.get("body");
    expect(reportBody).toContain(
      "https://news.electionsbg.com/story/private-story-id",
    );
    expect(reportBody).not.toMatch(/Тестова история|private-member|\?/);

    const progressive = screen.getByRole("button", {
      name: /Прогресивно ·/,
    });
    fireEvent.click(progressive);
    fireEvent.click(progressive);
    const proRussia = screen.getByRole("button", { name: /Проруска ·/ });
    fireEvent.click(proRussia);
    fireEvent.click(proRussia);

    await waitFor(() => expect(sink).toHaveBeenCalledTimes(4));
    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      { name: "story_filter", axis: "leaning", active: true },
      { name: "story_filter", axis: "leaning", active: false },
      { name: "story_filter", axis: "russia", active: true },
      { name: "story_filter", axis: "russia", active: false },
    ]);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /private|member|Прогресивно|Русия/,
    );
  });
});
