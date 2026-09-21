import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSE_DEFAULT_DAYS,
  BROWSE_FILL_ROW_CEILING,
  BROWSE_STEP,
  browseHref,
  browseRows,
  browseSearch,
  parseBrowseFilters,
  readBrowseDepth,
  writeBrowseDepth,
} from "./storyBrowse";

const params = (search: string) => new URLSearchParams(search);
const known = { categories: ["elections", "economy"], domains: ["a.bg"] };

describe("the browse filters read off the URL", () => {
  it("defaults to 7 days, every topic, every source, ranked", () => {
    expect(parseBrowseFilters(params(""), known)).toEqual({
      category: "all",
      days: BROWSE_DEFAULT_DAYS,
      domain: "all",
      sort: "ranked",
      query: "",
    });
  });

  it("reads every documented value", () => {
    expect(
      parseBrowseFilters(
        params("category=economy&days=0&domain=a.bg&sort=latest&q=x"),
        known,
      ),
    ).toEqual({
      category: "economy",
      days: 0,
      domain: "a.bg",
      sort: "latest",
      query: "x",
    });
  });

  it("reads an unknown value as the default, never as an empty page", () => {
    // ⚠️ `?category=x` for a topic nobody has would otherwise be a shared
    // link that reads as „no such coverage exists".
    const read = parseBrowseFilters(
      params("category=nope&days=12&domain=z.bg&sort=random"),
      known,
    );
    expect(read.category).toBe("all");
    expect(read.days).toBe(BROWSE_DEFAULT_DAYS);
    expect(read.domain).toBe("all");
    expect(read.sort).toBe("ranked");
  });

  it("reads an EMPTY or malformed window as the default, not as all-time", () => {
    // ⚠️ `Number("")` is 0 and 0 is a real member of BROWSE_DAYS — so
    // `?days=` would otherwise open the whole corpus.
    expect(parseBrowseFilters(params("days="), known).days).toBe(
      BROWSE_DEFAULT_DAYS,
    );
    expect(parseBrowseFilters(params("days=%200%20"), known).days).toBe(
      BROWSE_DEFAULT_DAYS,
    );
    expect(parseBrowseFilters(params("days=0x0"), known).days).toBe(
      BROWSE_DEFAULT_DAYS,
    );
    expect(parseBrowseFilters(params("days=07"), known).days).toBe(7);
    expect(parseBrowseFilters(params("sort="), known).sort).toBe("ranked");
  });

  it("keeps the raw value while the vocabulary is still loading", () => {
    // A deep link must not flash the unfiltered corpus before the taxonomy
    // lands.
    const read = parseBrowseFilters(params("category=economy&domain=a.bg"), {
      categories: null,
      domains: null,
    });
    expect(read.category).toBe("economy");
    expect(read.domain).toBe("a.bg");
  });

  it("caps the free-text query", () => {
    const read = parseBrowseFilters(params(`q=${"x".repeat(500)}`), known);
    expect(read.query).toHaveLength(200);
  });
});

describe("the browse href", () => {
  it("omits defaults so the default view is the bare route", () => {
    expect(browseHref({ category: "all", days: BROWSE_DEFAULT_DAYS })).toBe(
      "/stories",
    );
    expect(browseSearch({ sort: "ranked" })).toBe("");
  });

  it("carries the home page's topic and window", () => {
    expect(browseHref({ category: "elections", days: 1 })).toBe(
      "/stories?category=elections&days=1",
    );
  });

  it("round-trips through the parser", () => {
    const filters = {
      category: "economy",
      days: 0,
      domain: "a.bg",
      sort: "latest" as const,
      query: "петрохан",
    };
    expect(parseBrowseFilters(params(browseSearch(filters)), known)).toEqual(
      filters,
    );
  });

  it("refuses a window the browse does not offer", () => {
    expect(browseSearch({ days: 12 })).toBe("");
  });
});

describe("the rows a browse shows", () => {
  const row = (id: string, title: string) => ({ id, title });
  const revealed = [row("a", "Петрохан"), row("b", "Бюджет"), row("c", "Ток")];

  it("keeps the prefix to the match set, in the prefix's order", () => {
    const { rows } = browseRows(
      revealed,
      new Set(["c", "a"]),
      "",
      (r) => r.title,
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("never shows a row the query did not match, whatever the text says", () => {
    // ⚠️ THE MUTATION THIS CATCHES: applying the text query to the whole
    // prefix and forgetting the match set — the page would then answer the
    // search over stories outside the reader's own filter.
    const { rows } = browseRows(
      revealed,
      new Set(["b"]),
      "петрохан",
      (r) => r.title,
      1,
    );
    expect(rows).toEqual([]);
  });

  it("reports the search scope against the CORPUS count, not the prefix", () => {
    const { scope } = browseRows(
      revealed,
      new Set(["a", "b", "c"]),
      "ток",
      (r) => r.title,
      139,
    );
    expect(scope).toEqual({ searched: 3, of: 139, complete: false });
  });

  it("calls a search complete only when every match was in hand", () => {
    const { scope } = browseRows(
      revealed,
      new Set(["a", "b", "c"]),
      "ток",
      (r) => r.title,
      3,
    );
    expect(scope.complete).toBe(true);
  });
});

describe("the Back-button depth", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts at one step and remembers a deeper reveal per browse", () => {
    expect(readBrowseDepth("category=x")).toBe(BROWSE_STEP);
    writeBrowseDepth("category=x", BROWSE_STEP * 3);
    expect(readBrowseDepth("category=x")).toBe(BROWSE_STEP * 3);
    // Keyed by the browse, not shared across them.
    expect(readBrowseDepth("category=y")).toBe(BROWSE_STEP);
  });

  it("forgets a depth that shrank back to one step", () => {
    writeBrowseDepth("", BROWSE_STEP * 2);
    writeBrowseDepth("", BROWSE_STEP);
    expect(sessionStorage.getItem("naiasno.news.browse.depth:")).toBeNull();
  });

  it("caps a remembered depth at the fill ceiling and refuses junk", () => {
    sessionStorage.setItem("naiasno.news.browse.depth:a", "999999");
    expect(readBrowseDepth("a")).toBe(BROWSE_FILL_ROW_CEILING);
    sessionStorage.setItem("naiasno.news.browse.depth:b", "lots");
    expect(readBrowseDepth("b")).toBe(BROWSE_STEP);
  });

  it("degrades to the top of the list when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readBrowseDepth("a")).toBe(BROWSE_STEP);
    expect(() => writeBrowseDepth("a", 90)).not.toThrow();
  });
});
