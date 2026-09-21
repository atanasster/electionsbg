import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryIndexRow, TaxonomyCategory } from "../data";
import { queryStories, type FilterRow } from "../storyQuery";

const NOW = Date.parse("2026-09-21T12:00:00Z");

const category = (id: string): TaxonomyCategory =>
  ({ id, label: { bg: id, en: id } }) as TaxonomyCategory;

const row = (
  id: string,
  topic: string,
  domains: string[],
  score: number,
  published = "2026-09-21T10:00:00Z",
): StoryIndexRow => ({
  id,
  title_bg: `Заглавие ${id}`,
  title_en: `Title ${id}`,
  topics: [{ category: topic, subcategory: null, primary: true }],
  first_published: published,
  last_published: published,
  member_count: domains.length,
  domains,
  prominence: {
    version: 1,
    score,
    outlets: domains.length,
    articles: domains.length,
    arriving: 0,
    age_hours: 2,
    publication_time_known: true,
  },
});

/** The whole-corpus index the predicate runs over, from the same rows. */
const filterRow = (r: StoryIndexRow): FilterRow => [
  r.id,
  r.last_published ?? "",
  [r.topics[0].category],
  r.domains,
];

interface Harness {
  /** The ordered pages, as the publisher would emit them. */
  pages: StoryIndexRow[][];
  /**
   * Which rows the corpus index knows; defaults to every page's rows.
   * `null` is a failed index, `"loading"` one still in flight.
   */
  corpus?: StoryIndexRow[] | null | "loading";
  staleVintage?: boolean;
  /** A page whose fetch fails until `retry` is pressed. */
  failPage?: number;
  merged?: boolean;
}

const fetched: { pages: number[] } = { pages: [] };
/** The sorts the screen asked `useStoryList` for, in order. */
let receivedSorts: string[] = [];

const renderBrowse = async (harness: Harness, entry = "/stories") => {
  vi.resetModules();
  fetched.pages = [];
  receivedSorts = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const React = await import("react");
  const corpusRows =
    harness.corpus === undefined ? harness.pages.flat() : harness.corpus;
  vi.doMock("../data", async (importOriginal) => {
    const original = await importOriginal<typeof import("../data")>();
    return {
      ...original,
      useTaxonomy: () => ({
        data: {
          version: 1,
          categories: [category("elections"), category("economy")],
        },
        error: null,
        loading: false,
      }),
      useOutlets: () => ({
        data: {
          generated_at: "",
          outlets: [
            { domain: "a.bg", outlet: "A" },
            { domain: "b.bg", outlet: "B" },
          ],
        },
        error: null,
        loading: false,
      }),
      useActiveOverlay: () => null,
      useGlobalStoryQuery: (query: Parameters<typeof queryStories>[1]) => {
        if (corpusRows === "loading")
          return {
            result: queryStories(null, query),
            ready: false,
            loading: true,
            error: null,
          };
        if (corpusRows === null)
          return {
            result: queryStories(null, query),
            ready: false,
            loading: false,
            error: new Error("offline"),
          };
        return {
          result: queryStories(
            {
              query_version: 1,
              fields: [],
              total: corpusRows.length,
              facets_basis: {},
              facets: { categories: {}, domains: {} },
              stories: corpusRows.map(filterRow),
            },
            query,
          ),
          ready: true,
          loading: false,
          error: null,
        };
      },
      // A stateful stand-in for the paged prefix that keeps the REAL hook's
      // shape: `loadMore` asks for a page, the page lands one render later
      // (`loaded`), and `loadMore` is a no-op while the asked-for page is
      // not in hand — which is what stops a re-fired fill effect from
      // stepping ahead. Every fetch is recorded so a test can say which
      // pages a browse actually needed.
      useStoryList: (sort: string) => {
        if (receivedSorts.at(-1) !== sort) receivedSorts.push(sort);
        const [page, setPage] = React.useState(1);
        const [loaded, setLoaded] = React.useState(0);
        const [failed, setFailed] = React.useState(false);
        React.useEffect(() => {
          fetched.pages.push(page);
          if (page === harness.failPage) setFailed(true);
          else setLoaded(page);
        }, [page]);
        const pageInHand = loaded === page;
        const stories = harness.pages.slice(0, loaded).flat();
        return {
          stories,
          total: harness.pages.flat().length,
          vintage: "2026-09-21T11:00:00Z",
          asOf: "2026-09-21T11:00:00Z",
          sort,
          merged: Boolean(harness.merged),
          loading: loaded === 0,
          error: failed ? new Error("page failed") : null,
          hasMore: page < harness.pages.length,
          loadMore: React.useCallback(() => {
            if (!pageInHand) return;
            setPage((n) => Math.min(n + 1, harness.pages.length));
          }, [pageInHand]),
          retry: () => {
            harness.failPage = undefined;
            setFailed(false);
            fetched.pages.push(page);
            setLoaded(page);
          },
          staleVintage: Boolean(harness.staleVintage),
          reset: () => setPage(1),
        };
      },
    };
  });
  const { StoriesScreen } = await import("./StoriesScreen");
  render(
    <MemoryRouter initialEntries={[entry]}>
      <StoriesScreen />
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  sessionStorage.clear();
});

describe("the corpus browse", () => {
  it("shows the page's rows in the page's order, with both numbers", async () => {
    await renderBrowse({
      pages: [
        [
          row("top", "elections", ["a.bg", "b.bg"], 3),
          row("next", "economy", ["a.bg"], 1),
        ],
      ],
    });
    const links = await screen.findAllByRole("link", { name: /Заглавие/ });
    expect(links.map((l) => l.textContent)).toEqual([
      "Заглавие top",
      "Заглавие next",
    ]);
    expect(links[0]).toHaveAttribute("href", "/story/top");
    expect(
      screen.getByText(/Показани са 2 от 2 истории — това са всички/),
    ).toBeVisible();
    // The components, not the score.
    expect(screen.getByText("2 издания · 2 статии")).toBeVisible();
  });

  it("keeps a topic filter from the URL and counts it over the corpus", async () => {
    await renderBrowse(
      {
        pages: [
          [
            row("e1", "elections", ["a.bg"], 3),
            row("x1", "economy", ["a.bg"], 2),
            row("e2", "elections", ["b.bg"], 1),
          ],
        ],
      },
      "/stories?category=elections",
    );
    const links = await screen.findAllByRole("link", { name: /Заглавие/ });
    expect(links.map((l) => l.textContent)).toEqual([
      "Заглавие e1",
      "Заглавие e2",
    ]);
    expect(screen.getByText(/Показани са 2 от 2 истории/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "elections · 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The chip for the OTHER topic counts what selecting it would show.
    expect(screen.getByRole("button", { name: "economy · 1" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Показваме: elections · 7 дни · Най-отразявани",
    );
  });

  it("reaches a story whose only match is on page 2", async () => {
    // ⚠️ THE FIXTURE THE PLAN ASKS FOR BY NAME (T1.4). A browse that showed
    // „0 от 1" here would be the gate's reachability rule failing in the
    // one place the gate cannot see — the client.
    await renderBrowse(
      {
        pages: [
          [
            row("x1", "economy", ["a.bg"], 3),
            row("x2", "economy", ["a.bg"], 2),
          ],
          [row("deep", "elections", ["b.bg"], 0.5)],
        ],
      },
      "/stories?category=elections",
    );
    expect(
      await screen.findByRole("link", { name: "Заглавие deep" }),
    ).toBeVisible();
    expect(screen.getByText(/Показани са 1 от 1 история/)).toBeVisible();
    expect(fetched.pages).toEqual([1, 2]);
  });

  it("does not fetch past what the target needs", async () => {
    await renderBrowse({
      pages: [
        Array.from({ length: 40 }, (_, i) =>
          row(`p1-${i}`, "economy", ["a.bg"], 40 - i),
        ),
        [row("p2", "economy", ["a.bg"], 0.1)],
      ],
    });
    expect(
      await screen.findByText(/Показани са 30 от 41 истории/),
    ).toBeVisible();
    expect(fetched.pages).toEqual([1]);
    fireEvent.click(screen.getByRole("button", { name: "Покажи още" }));
    // Ten more were in hand; the second page is fetched only once needed.
    expect(
      await screen.findByText(/Показани са 41 от 41 истории/),
    ).toBeVisible();
    expect(fetched.pages).toEqual([1, 2]);
  });

  it("fills one page at a time, never two for one shortfall", async () => {
    // ⚠️ THE OBSERVABLE THIS PINS. The render right after `setPage` still
    // reports `loading: false` with the previous page in hand, so a fill
    // effect that re-fires there would ask for page 3 while page 2 is in
    // flight. Two things keep it to one page — the effect is keyed on
    // `loadMore`, and `loadMore` refuses to advance from a page not in hand
    // — and this test holds whichever of the two a future edit removes.
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        row(`p${n}-${i}`, "economy", ["a.bg"], 100 - n * 20 - i),
      );
    await renderBrowse({ pages: [page(1, 20), page(2, 20), page(3, 5)] });
    expect(
      await screen.findByText(/Показани са 30 от 45 истории/),
    ).toBeVisible();
    await waitFor(() => expect(fetched.pages).toEqual([1, 2]));
  });

  it("filters by outlet from the URL", async () => {
    await renderBrowse(
      {
        pages: [
          [
            row("a1", "economy", ["a.bg"], 3),
            row("b1", "economy", ["b.bg"], 2),
          ],
        ],
      },
      "/stories?domain=b.bg",
    );
    const links = await screen.findAllByRole("link", { name: /Заглавие/ });
    expect(links.map((l) => l.textContent)).toEqual(["Заглавие b1"]);
    expect(screen.getByRole("status")).toHaveTextContent("· B ·");
  });

  it("says nothing about the corpus while it is still being counted", async () => {
    await renderBrowse({
      pages: [[row("x", "economy", ["a.bg"], 1)]],
      corpus: "loading",
    });
    expect(screen.queryByText(/Няма истории/)).toBeNull();
    expect(screen.queryByText(/Показани са/)).toBeNull();
    expect(screen.queryByText(/Не можахме/)).toBeNull();
  });

  it("says it could not count rather than that nothing exists", async () => {
    await renderBrowse({
      pages: [[row("x", "economy", ["a.bg"], 1)]],
      corpus: null,
    });
    expect(
      await screen.findByText(/Не можахме да заредим индекса/),
    ).toBeVisible();
    expect(screen.queryByText(/Няма истории/)).toBeNull();
  });

  it("says nothing matches only when the corpus really holds nothing", async () => {
    await renderBrowse({ pages: [[]], corpus: [] });
    expect(
      await screen.findByText(/Няма истории за избраните филтри/),
    ).toBeVisible();
  });

  it("names the scope of a text search rather than implying it saw everything", async () => {
    await renderBrowse(
      {
        pages: [
          [
            row("x1", "economy", ["a.bg"], 3),
            row("x2", "economy", ["a.bg"], 2),
          ],
          [row("x3", "economy", ["a.bg"], 1)],
        ],
      },
      "/stories?q=x1",
    );
    const links = await screen.findAllByRole("link", { name: /Заглавие/ });
    expect(links.map((l) => l.textContent)).toEqual(["Заглавие x1"]);
    expect(
      screen.getByText(
        /търсено в 2 от 3 истории за този филтър — заредете още/,
      ),
    ).toBeVisible();
  });

  it("reports a new release and refuses to continue the old prefix from it", async () => {
    await renderBrowse(
      {
        pages: [
          [row("x1", "economy", ["a.bg"], 3)],
          [row("e1", "elections", ["a.bg"], 1)],
        ],
        staleVintage: true,
      },
      "/stories?category=elections",
    );
    expect(await screen.findByText(/Излезе ново издание/)).toBeVisible();
    // The fill would have fetched page 2 to find the match; it must not.
    await waitFor(() => expect(fetched.pages).toEqual([1]));
    expect(
      screen.getByRole("button", { name: "Обнови списъка" }),
    ).toBeVisible();
  });

  it("stops filling when a page fails, says so, and retries in place", async () => {
    // ⚠️ `useData` keeps the previous page beside the error, so a fill that
    // ignored it would flip back to true and ask for the next page — a
    // prefix with a hole, ending in „това са всички". Two guards stop that
    // (`!list.error` in the predicate; `loadMore` refusing to advance from a
    // page not in hand), and this pins the observable: no skip, an alert,
    // and a retry that lands the missing page in place.
    await renderBrowse(
      {
        pages: [
          [row("x1", "economy", ["a.bg"], 3)],
          [row("x2", "economy", ["a.bg"], 2)],
          [row("e1", "elections", ["a.bg"], 1)],
        ],
        failPage: 2,
      },
      "/stories?category=elections",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Следващата страница не се зареди.",
    );
    await waitFor(() => expect(fetched.pages).toEqual([1, 2]));
    expect(screen.queryByRole("link", { name: "Заглавие e1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Опитай пак" }));
    expect(
      await screen.findByRole("link", { name: "Заглавие e1" }),
    ).toBeVisible();
    expect(fetched.pages).toEqual([1, 2, 2, 3]);
  });

  it("stops the fill at the row ceiling and names the cost on the button", async () => {
    const filler = (n: number) =>
      Array.from({ length: 150 }, (_, i) =>
        row(`p${n}-${i}`, "economy", ["a.bg"], 1000 - n * 150 - i),
      );
    await renderBrowse(
      {
        pages: [
          ...Array.from({ length: 7 }, (_, i) => filler(i + 1)),
          [row("deep", "elections", ["a.bg"], 0.1)],
        ],
      },
      "/stories?category=elections",
    );
    const button = await screen.findByRole("button", {
      name: "Зареди още страници от подредбата",
    });
    // 6 pages × 150 = 900 revealed rows: the ceiling, and no page 7.
    expect(fetched.pages).toEqual([1, 2, 3, 4, 5, 6]);
    expect(screen.queryByRole("link", { name: "Заглавие deep" })).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(fetched.pages).toEqual([1, 2, 3, 4, 5, 6, 7]));
    // ⚠️ ONE page per click past the ceiling, never a burst.
    expect(screen.queryByRole("link", { name: "Заглавие deep" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Зареди още страници от подредбата" }),
    );
    expect(
      await screen.findByRole("link", { name: "Заглавие deep" }),
    ).toBeVisible();
  });

  it("switches the ordering through the URL and starts a new list", async () => {
    await renderBrowse({
      pages: [
        [row("s1", "economy", ["a.bg"], 3), row("s2", "economy", ["a.bg"], 2)],
      ],
    });
    await screen.findByRole("link", { name: "Заглавие s1" });
    const latest = screen.getByRole("button", { name: "Последни" });
    expect(latest).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(latest);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Последни" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("· Последни");
    expect(receivedSorts.at(-1)).toBe("latest");
    fireEvent.click(screen.getByRole("button", { name: "Най-отразявани" }));
    await waitFor(() => expect(receivedSorts.at(-1)).toBe("ranked"));
  });

  it("says the ranked order is the base's only when the overlay changed the prefix", async () => {
    await renderBrowse({
      pages: [[row("s1", "economy", ["a.bg"], 3)]],
      merged: false,
    });
    await screen.findByRole("link", { name: "Заглавие s1" });
    expect(screen.queryByText(/без ново класиране/)).toBeNull();
    vi.restoreAllMocks();
    await renderBrowse({
      pages: [[row("s2", "economy", ["a.bg"], 3)]],
      merged: true,
    });
    expect(await screen.findByText(/без ново класиране/)).toBeVisible();
  });

  it("restores the depth a reader had revealed before going Back", async () => {
    sessionStorage.setItem("naiasno.news.browse.depth:", "60");
    await renderBrowse({
      pages: [
        Array.from({ length: 70 }, (_, i) =>
          row(`r-${i}`, "economy", ["a.bg"], 70 - i),
        ),
      ],
    });
    expect(
      await screen.findByText(/Показани са 60 от 70 истории/),
    ).toBeVisible();
  });
});
