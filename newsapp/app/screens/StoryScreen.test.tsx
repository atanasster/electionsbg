import {
  cleanup,
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

/**
 * The served-detail mock every describe here needs: one story, an empty
 * taxonomy and outlet list. Extra hooks (`useCases`, …) ride on `extra`.
 */
const mockServedStory = (served: Story, extra: Record<string, unknown> = {}) =>
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useStoryDetail: () => ({
      data: { generated_at: "", story: served, related: [] },
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
    ...extra,
  }));

describe("StoryScreen analytics", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
  });

  it("reports only filter axes and activation state", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    mockServedStory(story);
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
    // T5.4 — ONE completeness sentence for both axes, the breakdown behind a
    // single disclosure the page owns.
    expect(screen.getAllByText("Оценени са 2 от 3 материала.")).toHaveLength(1);
    expect(screen.getAllByText(/редакционният статус/)).toHaveLength(1);
    expect(screen.getAllByText(/news-article-evaluation-v1/)).toHaveLength(1);
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

describe("what the assessed coverage licenses each axis to say (T5.2)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });

  const renderWith = async (members: Story["members"]) => {
    mockServedStory({ ...story, members });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  };
  const [left, right, undated] = story.members;

  it("two outlets on two labels is a distribution; one outlet with two labels is single-source", async () => {
    await renderWith([left, right, undated]);
    expect(screen.getByTestId("divergence-leaning")).toHaveAttribute(
      "data-state",
      "distribution",
    );
    expect(screen.getByTestId("divergence-leaning")).toHaveTextContent(
      "Разпределение между 2 източника с позиция; сегментите броят материали, не източници.",
    );
    cleanup();
    vi.resetModules();
    // ⚠️ THE MUTATION THIS CATCHES: counting distinct LABELS (the old card
    // rule) — the same two labels from ONE outlet are not two outlets
    // disagreeing.
    await renderWith([left, { ...right, domain: "left.example" }, undated]);
    expect(screen.getByTestId("divergence-leaning")).toHaveAttribute(
      "data-state",
      "single_source",
    );
    const note = screen.getByTestId("divergence-leaning");
    expect(note).toHaveTextContent("Само един източник има позиция");
    expect(note).toHaveTextContent("няма с какво да се сравни");
    expect(note).not.toHaveTextContent("Оценен е само един");
  });

  it("matching framing across outlets is said to be no agreement on facts; not_applicable is no position", async () => {
    await renderWith([
      left,
      { ...right, leaning: "progressive", russia_stance: "not_applicable" },
      { ...undated, russia_stance: "not_applicable" },
    ]);
    const lean = screen.getByTestId("divergence-leaning");
    expect(lean).toHaveAttribute("data-state", "uniform");
    expect(lean).toHaveTextContent("не е съгласие по фактите");
    // Russia: only `left` is positioned → single-source, not „none“ and not uniform.
    expect(screen.getByTestId("divergence-russia")).toHaveAttribute(
      "data-state",
      "single_source",
    );
  });

  it("says so when no member holds a position — in the POSITIONED vocabulary", async () => {
    await renderWith([
      { ...left, russia_stance: null },
      { ...right, russia_stance: "not_applicable" },
    ]);
    const note = screen.getByTestId("divergence-russia");
    expect(note).toHaveAttribute("data-state", "none");
    // ⚠️ THE MUTATION THIS CATCHES: copy in the ASSESSED vocabulary. `right`
    // IS assessed (not_applicable is a verdict, and the completeness line
    // beneath counts it), so „няма оценка" would be false right here.
    expect(note).toHaveTextContent("позиция");
    expect(note).not.toHaveTextContent("няма оценка");
  });
});

describe("not_applicable is said beside the bar it is missing from (T5.3)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });
  const [left, right, undated] = story.members;
  const renderWith = async (members: Story["members"]) => {
    mockServedStory({ ...story, members });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("counts the out-of-scope verdicts per axis, immediately under that bar only", async () => {
    await renderWith([
      left,
      { ...right, russia_stance: "not_applicable" },
      { ...undated, russia_stance: "not_applicable" },
    ]);
    const note = screen.getByTestId("outside-axis-russia");
    expect(note).toHaveTextContent("2 от 3 материала са извън тази ос");
    expect(note).not.toHaveTextContent("моделът");
    // The leaning axis has no out-of-scope verdict: no sentence under it.
    expect(screen.queryByTestId("outside-axis-leaning")).toBeNull();
    // Placement is the point of choosing this surface: after the bar it
    // explains, inside that bar's own block, before the completeness strip.
    const bar = screen.getByText("Позиция спрямо Русия");
    expect(
      bar.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(note.parentElement).toBe(bar.closest("div.space-y-2"));
    expect(note.nextElementSibling).toBeNull();
  });

  it("agrees the verb with N and the count noun with M, in both languages", async () => {
    await renderWith([
      left,
      { ...right, russia_stance: "not_applicable" },
      undated,
    ]);
    expect(screen.getByTestId("outside-axis-russia")).toHaveTextContent(
      "1 от 3 материала е извън тази ос",
    );
    cleanup();
    vi.resetModules();
    mockServedStory({
      ...story,
      members: [left, { ...right, russia_stance: "not_applicable" }, undated],
    });
    const { StoryScreen } = await import("./StoryScreen");
    // After resetModules the screen reads a FRESH i18n context; the provider
    // must come from that same module instance.
    const { NewsLocaleProvider } = await import("../i18n");
    render(
      <NewsLocaleProvider language="en">
        <MemoryRouter initialEntries={["/story/private-story-id"]}>
          <Routes>
            <Route path="/story/:id" element={<StoryScreen />} />
          </Routes>
        </MemoryRouter>
      </NewsLocaleProvider>,
    );
    expect(screen.getByTestId("outside-axis-russia")).toHaveTextContent(
      "1 of 3 articles falls outside this axis",
    );
  });

  it("an UNASSESSED article is not „outside the axis“ — that is a different absence", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: counting every member the bar does not
    // draw (null verdicts included) as judged out of scope.
    await renderWith([left, right, { ...undated, russia_stance: null }]);
    expect(screen.queryByTestId("outside-axis-russia")).toBeNull();
    cleanup();
    vi.resetModules();
    await renderWith([
      left,
      { ...right, russia_stance: "not_applicable" },
      { ...undated, russia_stance: null },
    ]);
    expect(screen.getByTestId("outside-axis-russia")).toHaveTextContent(
      "1 от 3 материала е извън тази ос",
    );
  });
});

describe("one completeness strip for both axes (T5.4)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });
  const [left, right, undated] = story.members;
  const renderWith = async (members: Story["members"]) => {
    mockServedStory({ ...story, members });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("renders once, keeps differing per-axis counts adjacent, and the page owns the disclosure", async () => {
    await renderWith([left, { ...right, russia_stance: null }, undated]);
    expect(screen.getAllByTestId("aggregate-completeness")).toHaveLength(1);
    // ⚠️ THE MUTATION THIS CATCHES: one figure for two axes that differ.
    expect(
      screen.getByText(
        "Оценени са 2 от 3 материала по политическо рамкиране и 1 от 3 по позиция спрямо Русия.",
      ),
    ).toBeVisible();
    const details = screen
      .getByText("Подробности за оценката")
      .closest("details")!;
    expect(details).not.toHaveAttribute("open");
    // Both axes' breakdowns sit in the ONE disclosure.
    expect(details).toHaveTextContent("политическо рамкиране");
    expect(details).toHaveTextContent("позиция спрямо Русия");
    expect(details).toHaveTextContent("news-article-evaluation-v1");
  });

  it("closes the disclosure when the reader moves to another story", async () => {
    // ⚠️ <details> keeps native state React never reads back; the page must
    // flip its own `open` on a story change or the next story inherits it.
    vi.doMock("../data", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../data")>()),
      useStoryDetail: (id: string | null | undefined) => ({
        data: {
          generated_at: "",
          story: { ...story, id: id ?? "", members: [left, right, undated] },
          related: [],
        },
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
    const { Link } = await import("react-router-dom");
    render(
      <MemoryRouter initialEntries={["/story/first-story"]}>
        <Link to="/story/second-story">next</Link>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    const details = screen
      .getByText("Подробности за оценката")
      .closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(details).toHaveAttribute("open");
    fireEvent.click(screen.getByText("next"));
    expect(
      screen.getByText("Подробности за оценката").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("collapses to one sentence when both axes are complete", async () => {
    await renderWith([left, right]);
    expect(screen.getByText("Оценени са и двата материала.")).toBeVisible();
  });
});

describe("a filtered-empty timeline has a way out (T5.7)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
    Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
  });

  it("clears BOTH axes, says so, and reports one reset", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    // left: progressive + pro_russia; right: conservative + anti_russia —
    // „Прогресивно" ∩ „Антируска" is empty.
    mockServedStory(story);
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Прогресивно ·/ }));
    expect(screen.queryByTestId("timeline-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Антируска ·/ }));
    expect(screen.getByTestId("timeline-empty")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Покажи всички — изчиства избора и по двете оси",
      }),
    );
    // ⚠️ THE MUTATION THIS CATCHES: clearing one axis only — the other
    // segment stays pressed and the list stays narrowed.
    expect(screen.queryByTestId("timeline-empty")).toBeNull();
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: /Прогресивно ·/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Антируска ·/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => {
      const filterEvents = sink.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === "story_filter");
      // One `both` event, not two per-axis clears — so a bail-out is countable.
      expect(filterEvents.slice(-1)).toEqual([
        { name: "story_filter", axis: "both", active: false },
      ]);
    });
  });
});

describe("a story with no members offers no reset (T5.7)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });

  it("describes the list as empty rather than as a filter result", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: passing the handler unconditionally —
    // a reset button for a selection that does not exist.
    mockServedStory({ ...story, members: [] });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("timeline-empty")).toHaveTextContent(
      "Няма материали.",
    );
    expect(screen.queryByRole("button", { name: /Покажи всички/ })).toBeNull();
  });
});

describe("comparison as an action (T5.8)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
    Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
  });
  const bundles = {
    useOutletArticles: (domain: string | null) => ({
      data: domain
        ? {
            domain,
            outlet: domain,
            generated_at: "",
            articles: [
              {
                id: `private-member-${domain.split(".")[0]}`,
                domain,
                updated: null,
                analysis: {
                  summary_bg: `Обобщение за ${domain}`,
                  summary_en: `Summary for ${domain}`,
                },
              },
            ],
          }
        : null,
      error: null,
      loading: false,
    }),
  };
  const renderAt = async (path: string) => {
    mockServedStory(story, bundles);
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("reads the selection from the URL, ignores keys from elsewhere, and aligns the sources", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    await renderAt(
      "/story/private-story-id?compare=right.example/private-member-right,other.example/x,left.example/private-member-left",
    );
    const compare = screen.getByTestId("story-compare");
    expect(
      within(compare).getByRole("heading", {
        name: "Сравнение на 2 източника",
      }),
    ).toBeVisible();
    // URL order is the column order; the foreign key is dropped, not rendered.
    const table = within(compare).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Поле", "right.example", "left.example"]);
    expect(within(table).getByText("Обобщение за right.example")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Сравни: left.example" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Сравни: right.example" }),
    ).toBeChecked();
    await waitFor(() =>
      expect(
        sink.mock.calls
          .map(([e]) => e)
          .filter((e) => e.name === "story_compare"),
      ).toEqual([{ name: "story_compare", sources: 2 }]),
    );
  });

  it("ticking writes the URL, one tick asks for another, a fourth is refused, and reset clears", async () => {
    await renderAt("/story/private-story-id");
    expect(screen.queryByTestId("story-compare")).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Сравни: left.example" }),
    );
    expect(
      screen.getByText(
        "Отбележете още един източник, за да се покаже сравнението.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("story-compare")).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Сравни: right.example" }),
    );
    expect(screen.getByTestId("story-compare")).toBeVisible();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Сравни: undated.example" }),
    );
    expect(
      within(screen.getByTestId("story-compare")).getByRole("heading", {
        name: "Сравнение на 3 източника",
      }),
    ).toBeVisible();
    // ⚠️ THE MUTATION THIS CATCHES: a fourth pick evicting the first, or a
    // checkbox that stays enabled past the cap. (The fixture has three
    // members, so the cap is exercised through the helper's refusal and the
    // disabled state on an un-ticked box in a wider story.)
    for (const box of screen.getAllByRole("checkbox"))
      expect(box).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Изчисти сравнението" }),
    );
    expect(screen.queryByTestId("story-compare")).toBeNull();
    for (const box of screen.getAllByRole("checkbox"))
      expect(box).not.toBeChecked();
  });

  it("emits ONE story_compare per comparison reached, not per edit", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    await renderAt("/story/private-story-id");
    const tick = (n: string) =>
      fireEvent.click(screen.getByRole("checkbox", { name: `Сравни: ${n}` }));
    tick("left.example");
    tick("right.example"); // 2 → the comparison is reached
    tick("undated.example"); // 3 → an edit, not a new comparison
    tick("undated.example"); // back to 2
    tick("right.example"); // below the minimum — re-arms
    tick("right.example"); // reached again
    // ⚠️ THE MUTATION THIS CATCHES: firing on every count change (2, 3, 2, 2).
    await waitFor(() =>
      expect(
        sink.mock.calls
          .map(([e]) => e)
          .filter((e) => e.name === "story_compare"),
      ).toEqual([
        { name: "story_compare", sources: 2 },
        { name: "story_compare", sources: 2 },
      ]),
    );
  });

  it("shares the comparison, and the bare story when there is none", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    try {
      await renderAt(
        "/story/private-story-id?compare=left.example/private-member-left,right.example/private-member-right",
      );
      fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
      await waitFor(() =>
        expect(share).toHaveBeenLastCalledWith(
          expect.objectContaining({
            url: "https://news.electionsbg.com/story/private-story-id?compare=left.example/private-member-left,right.example/private-member-right",
          }),
        ),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Изчисти сравнението" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
      await waitFor(() =>
        expect(share).toHaveBeenLastCalledWith(
          expect.objectContaining({
            url: "https://news.electionsbg.com/story/private-story-id",
          }),
        ),
      );
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("does not read the previous domain's bundle as 'not assessed' while a slot reloads", async () => {
    // What `useData` returns mid-swap: the PREVIOUS path's data with loading=true.
    const stale = {
      useOutletArticles: (domain: string | null) => ({
        data: domain
          ? {
              domain: "left.example",
              outlet: "left.example",
              generated_at: "",
              articles: [
                {
                  id: "private-member-left",
                  domain: "left.example",
                  updated: null,
                  analysis: { summary_bg: "Обобщение за left", summary_en: "" },
                },
              ],
            }
          : null,
        error: null,
        loading: true,
      }),
    };
    mockServedStory(story, stale);
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter
        initialEntries={[
          "/story/private-story-id?compare=right.example/private-member-right,left.example/private-member-left",
        ]}
      >
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    const table = within(screen.getByTestId("story-compare")).getByRole(
      "table",
    );
    // ⚠️ THE MUTATION THIS CATCHES: reading any loaded bundle for any domain —
    // right.example would then be „още не е оценен" off left.example's bundle.
    expect(within(table).getByText("зарежда се…")).toBeVisible();
    expect(within(table).queryByText(/още не е оценен/)).toBeNull();
    expect(within(table).getByText("Обобщение за left")).toBeVisible();
  });

  it("disables the un-ticked boxes at the cap and says why", async () => {
    const fourth: Story["members"][number] = {
      ...story.members[0],
      domain: "fourth.example",
      article_id: "private-member-fourth",
      url: "https://fourth.example/private",
      title: "Четвърти материал",
    };
    mockServedStory({ ...story, members: [...story.members, fourth] }, bundles);
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter
        initialEntries={[
          "/story/private-story-id?compare=left.example/private-member-left,right.example/private-member-right,undated.example/private-member-undated",
        ]}
      >
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    const box = screen.getByRole("checkbox", {
      name: "Сравни: fourth.example (най-много 3)",
    });
    expect(box).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Сравни: left.example" }),
    ).toBeEnabled();
  });
});

describe("a prefix-scope verdict is a scoped observation (T4.1c)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });
  const [left, right, undated] = story.members;

  it("keeps a prefix-scope member out of the bars, the divergence and the assessed count, and says so", async () => {
    mockServedStory({
      ...story,
      members: [left, { ...right, text_scope: "prefix" }, undated],
    });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    // ⚠️ THE MUTATION THIS CATCHES: the prefix member's „Консервативно"
    // drawn as a segment and counted as a second positioned outlet.
    expect(
      screen.queryByRole("button", { name: /^Консервативно ·/ }),
    ).toBeNull();
    expect(screen.getByTestId("divergence-leaning")).toHaveAttribute(
      "data-state",
      "single_source",
    );
    const details = screen
      .getByText("Подробности за оценката")
      .closest("details")!;
    expect(details).toHaveTextContent(
      "1 не е оценен върху целия текст и не се брои",
    );
    expect(screen.getByText(/Оценен е 1 от 3 материала/)).toBeVisible();
    // The member's badge on the timeline carries the scope mark; the full
    // read's does not.
    const marks = screen.getAllByTestId("scope-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("частично");
    expect(marks[0].closest("[data-testid='timeline-item']")).toHaveTextContent(
      "Десен материал",
    );
  });

  it("marks an unrecorded read as such — no figure, no rollup", async () => {
    mockServedStory({
      ...story,
      members: [left, { ...right, text_scope: "unrecorded" }],
    });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: /^Консервативно ·/ }),
    ).toBeNull();
    expect(screen.getByTestId("scope-mark")).toHaveTextContent(
      "незаписан обхват",
    );
    expect(document.body.textContent).not.toMatch(/6[\s\u00a0]?000/);
  });
});

describe("de-jargoned copy (T5.6)", () => {
  afterEach(() => {
    vi.resetModules();
    cleanup();
  });

  it("names a group of articles, never a cluster, and reads the axis labels from labels.ts in both languages", async () => {
    mockServedStory(story);
    const { StoryScreen } = await import("./StoryScreen");
    const { container } = render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/клъстер/i);
    expect(screen.getByText("Най-ранен материал")).toBeVisible();
    // The segment must carry the SAME short form the badge on every row
    // carries: `.label` („Прогресивно рамкиране") cannot match `/^Прогресивно ·/`.
    // (Re-typing the identical short form inline would pass — what is gated
    // is drift between segment and badge, not the location of the string.)
    expect(
      screen.getByRole("button", { name: /^Прогресивно ·/ }),
    ).toBeVisible();
    cleanup();
    vi.resetModules();
    mockServedStory(story);
    const en = await import("./StoryScreen");
    const { NewsLocaleProvider } = await import("../i18n");
    const rendered = render(
      <NewsLocaleProvider language="en">
        <MemoryRouter initialEntries={["/story/private-story-id"]}>
          <Routes>
            <Route path="/story/:id" element={<en.StoryScreen />} />
          </Routes>
        </MemoryRouter>
      </NewsLocaleProvider>,
    );
    expect(rendered.container.textContent).not.toMatch(/cluster/i);
    // Same register as BG: the short form, not „Progressive framing".
    expect(
      screen.getByRole("button", { name: /^Progressive ·/ }),
    ).toBeVisible();
  });

  it("the not-found hint names a group of articles, never a cluster", async () => {
    vi.doMock("../data", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../data")>()),
      useStoryDetail: () => ({ data: null, error: null, loading: false }),
      useTaxonomy: () => ({ data: null, error: null, loading: false }),
      useOutlets: () => ({ data: null, error: null, loading: false }),
    }));
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Историята не е намерена" }),
    ).toBeVisible();
    expect(screen.getByText(/групата материали да е обединена/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/клъстер|cluster/i);
  });

  it("keeps the rubric term out of the none-state parenthesis in both languages", async () => {
    const [left, right] = story.members;
    const none = [
      { ...left, russia_stance: null },
      { ...right, russia_stance: "not_applicable" as const },
    ];
    mockServedStory({ ...story, members: none });
    const bg = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<bg.StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("divergence-russia")).toHaveTextContent(
      "„не заема позиция“ не е позиция",
    );
    cleanup();
    vi.resetModules();
    mockServedStory({ ...story, members: none });
    const en = await import("./StoryScreen");
    const { NewsLocaleProvider } = await import("../i18n");
    render(
      <NewsLocaleProvider language="en">
        <MemoryRouter initialEntries={["/story/private-story-id"]}>
          <Routes>
            <Route path="/story/:id" element={<en.StoryScreen />} />
          </Routes>
        </MemoryRouter>
      </NewsLocaleProvider>,
    );
    const note = screen.getByTestId("divergence-russia");
    expect(note).toHaveTextContent(
      "“takes no position” verdict is not a position",
    );
    expect(note).not.toHaveTextContent(/not applicable/i);
  });
});

describe("a story the release no longer serves", () => {
  afterEach(() => vi.resetModules());

  const renderGone = async (
    status: number,
    registry:
      | {
          data: Record<string, unknown> | null;
          error: Error | null;
          loading: boolean;
        }
      | undefined,
  ) => {
    const asked: boolean[] = [];
    // ⚠️ The error is minted from the SAME module instance the screen
    // reads `storyIsGone` from — `instanceof` across two evaluations of
    // data.ts is false, and every 404 then reads as a server error.
    vi.doMock("../data", async (importOriginal) => {
      const original = await importOriginal<typeof import("../data")>();
      const error = new original.HttpStatusError(
        "/stories/20200101-deadbeef.json",
        status,
      );
      return {
        ...original,
        useStoryDetail: () => ({ data: null, error, loading: false }),
        useRetiredStories: (enabled: boolean) => {
          asked.push(enabled);
          return registry && enabled
            ? {
                ...registry,
                data: registry.data
                  ? { generated_at: "", version: 1, retired: registry.data }
                  : null,
              }
            : { data: null, error: null, loading: false };
        },
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
      };
    });
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/20200101-deadbeef"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    return asked;
  };

  it("explains a withdrawal with the registry's own reason and date", async () => {
    await renderGone(404, {
      data: {
        "20200101-deadbeef": {
          reason: "withdrawn",
          on: "2026-09-21",
          note: "Оттеглена след сигнал за грешно свързване.",
        },
      },
      error: null,
      loading: false,
    });
    expect(
      screen.getByRole("heading", { name: "Историята е оттеглена" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Оттеглена след сигнал за грешно свързване\. \(2026-09-21\)/,
      ),
    ).toBeVisible();
  });

  it("links a merged story to the one that replaced it", async () => {
    await renderGone(404, {
      data: {
        "20200101-deadbeef": {
          reason: "merged",
          on: "2026-09-21",
          note: "Обединена.",
          target: "20200102-cafebabe",
        },
      },
      error: null,
      loading: false,
    });
    expect(
      screen.getByRole("link", { name: "Към обединената история" }),
    ).toHaveAttribute("href", "/story/20200102-cafebabe");
  });

  it("says a 404 the registry does not name is not a published story", async () => {
    await renderGone(404, {
      data: {},
      error: null,
      loading: false,
    });
    expect(
      screen.getByRole("heading", { name: "Историята не е намерена" }),
    ).toBeVisible();
    expect(
      screen.getByText(/не отговаря на публикувана история/),
    ).toBeVisible();
    // T5.6: nothing on the retired/unknown branches names a cluster.
    expect(document.body.textContent).not.toMatch(/клъстер|cluster/i);
  });

  it("does not claim never-published while the registry is in flight or unreadable", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: rendering the „not found" copy on
    // `!entry` alone — a withdrawn story would read as a broken link for
    // the second the registry takes to arrive, and for ever if it failed.
    await renderGone(404, {
      data: null,
      error: null,
      loading: true,
    });
    expect(screen.getByText(/Проверяваме регистъра/)).toBeVisible();
    expect(screen.queryByText(/не отговаря на публикувана история/)).toBeNull();
    vi.resetModules();
    await renderGone(404, {
      data: null,
      error: new Error("offline"),
      loading: false,
    });
    expect(screen.getByText(/регистърът на оттеглените не можа/)).toBeVisible();
  });

  it("does not paint never-published in the frame before the registry fetch starts", async () => {
    // The shape `useData` returns in the render where `gone` first flips:
    // the effect that starts the fetch has not run yet.
    await renderGone(404, { data: null, error: null, loading: false });
    expect(screen.queryByText(/не отговаря на публикувана история/)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Историята не е намерена" }),
    ).toBeNull();
    expect(screen.getByText(/Проверяваме регистъра/)).toBeVisible();
  });

  it("asks for the registry only once the story has 404'd, and keeps a server error separate", async () => {
    const asked = await renderGone(502, {
      data: {},
      error: null,
      loading: false,
    });
    expect(
      screen.getByRole("heading", { name: "Данните не се заредиха" }),
    ).toBeVisible();
    expect(asked.every((enabled) => enabled === false)).toBe(true);
  });
});

describe("a story that belongs to a case", () => {
  afterEach(() => vi.resetModules());

  const renderWithCases = async (
    caseIds: string[] | undefined,
    registry: { slug: string; name: { bg: string; en: string } }[] | null,
  ) => {
    const asked: boolean[] = [];
    mockServedStory(
      { ...story, case_ids: caseIds },
      {
        useCases: (enabled: boolean) => {
          asked.push(enabled);
          return {
            data:
              enabled && registry
                ? {
                    generated_at: "",
                    version: 1,
                    editorial_note: { bg: "", en: "" },
                    cases: registry,
                  }
                : null,
            error: null,
            loading: false,
          };
        },
      },
    );
    const { StoryScreen } = await import("./StoryScreen");
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <Routes>
          <Route path="/story/:id" element={<StoryScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    return asked;
  };

  it("links the case by its registry NAME, labelled as a case", async () => {
    await renderWithCases(
      ["petrohan"],
      [
        {
          slug: "petrohan",
          name: { bg: "Казусът „Петрохан“", en: "P" },
        } as never,
      ],
    );
    expect(
      screen.getByRole("link", { name: "Казусът „Петрохан“" }),
    ).toHaveAttribute("href", "/case/petrohan");
    expect(screen.getByRole("heading", { name: "Казус" })).toBeVisible();
  });

  it("renders no chip for a bare slug and does not fetch the registry for a story outside every case", async () => {
    const asked = await renderWithCases(
      [],
      [{ slug: "petrohan", name: { bg: "П", en: "P" } } as never],
    );
    expect(screen.queryByRole("heading", { name: "Казус" })).toBeNull();
    expect(asked.every((enabled) => enabled === false)).toBe(true);
    cleanup();
    // The registry did not resolve the slug: no chip, rather than a slug.
    await renderWithCases(["petrohan"], []);
    expect(screen.queryByRole("heading", { name: "Казус" })).toBeNull();
    expect(screen.queryByText("petrohan")).toBeNull();
  });
});
