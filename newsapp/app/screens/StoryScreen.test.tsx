import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    article_count: 3,
    outlet_count: 3,
    by_leaning: { progressive: 1, conservative: 1 },
    by_russia_stance: { pro_russia: 1, anti_russia: 1 },
    by_party_tone: {},
    by_domain: {
      "left.example": 1,
      "right.example": 1,
      "undated.example": 1,
    },
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
    {
      domain: "undated.example",
      article_id: "private-member-undated",
      url: "https://undated.example/private",
      title: "Материал без дата",
      published: null,
      leaning: null,
      russia_stance: null,
      first_seen: "2026-08-27T10:00:00Z",
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

    expect(screen.getByText("Какво се случи")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Как се различава отразяването",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Какво показва анализът",
      }),
    ).toBeVisible();
    const chronologyHeading = screen.getByRole("heading", {
      level: 2,
      name: "Източници и хронология ( 3 от 3)",
    });
    expect(chronologyHeading).toBeVisible();
    expect(screen.getByText(/лексикална разлика/)).toBeVisible();
    expect(screen.getAllByText(/Оценени 2\/3/)).toHaveLength(2);
    expect(screen.getAllByText(/редакционният статус/)).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Към източниците" }),
    ).toHaveAttribute("href", "#sources-chronology");
    expect(screen.queryByText(/Първи съобщи/)).toBeNull();
    expect(
      screen.getByText("Няма измерим еднозначен първи източник"),
    ).toBeVisible();
    const chronology = chronologyHeading.closest("section")!;
    const datedLink = within(chronology).getByRole("link", {
      name: "Десен материал",
    });
    const undatedLink = within(chronology).getByRole("link", {
      name: "Материал без дата",
    });
    expect(
      datedLink.compareDocumentPosition(undatedLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const progressive = screen.getByRole("button", {
      name: /Прогресивно ·/,
    });
    fireEvent.click(progressive);
    expect(
      within(chronology).getByRole("link", { name: "Ляв материал" }),
    ).toBeVisible();
    expect(
      within(chronology).queryByRole("link", { name: "Десен материал" }),
    ).toBeNull();
    fireEvent.click(progressive);
    const proRussia = screen.getByRole("button", { name: /Проруска ·/ });
    fireEvent.click(proRussia);
    fireEvent.click(proRussia);

    await waitFor(() =>
      expect(
        sink.mock.calls.filter(([event]) => event.name === "story_filter"),
      ).toHaveLength(4),
    );
    expect(
      sink.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === "story_filter"),
    ).toEqual([
      { name: "story_filter", axis: "leaning", active: true },
      { name: "story_filter", axis: "leaning", active: false },
      { name: "story_filter", axis: "russia", active: true },
      { name: "story_filter", axis: "russia", active: false },
    ]);
    expect(sink).toHaveBeenCalledWith({
      name: "reader_outcome",
      task: "comparison",
      outcome: "available",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /private|member|Прогресивно|Русия/,
    );
  });
});
