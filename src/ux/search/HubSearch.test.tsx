// HubSearch — the contracts a hub's finder must not lose.
//
// The presentation is EntitySearchTile's and is tested with it. What is tested here is the
// part this component exists for: that SCOPE RANKS AND NEVER FILTERS, and that the ways of
// accidentally turning it back into a filter are closed.
//
// Every case below corresponds to a way the partition silently becomes a filter — and the
// symptom of each is a box that still returns results, so none of them is visible without a
// test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Search } from "lucide-react";
import { HubSearch } from "./HubSearch";
import {
  scopedSources,
  type HubSearchSource,
  type IndexSource,
} from "./hubSearchSources";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import type { SearchItem } from "./EntitySearchTile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

interface Row {
  id: string;
  label: string;
  sub?: string;
  href: string;
}
/** buildEntityIndex(items, toRow, keysOf) — the search keys are supplied separately, so a
 *  test fixture must pass all three rather than a row carrying its own `keys`. */
const idx = (rows: Row[]) =>
  buildEntityIndex(
    rows,
    (r) => ({ id: r.id, label: r.label, sub: r.sub, href: r.href }),
    (r) => [r.label],
  );

const item = (id: string, primary = id): SearchItem => ({
  id,
  to: `/x/${id}`,
  primary,
  icon: Search,
});

const renderHub = (sources: HubSearchSource[]) =>
  render(
    <MemoryRouter>
      <HubSearch
        sources={sources}
        title={{ bg: "Търсене", en: "Search" }}
        placeholder={{ bg: "търси…", en: "search…" }}
        hint={{ bg: "подсказка", en: "hint" }}
        idPrefix="test"
      />
    </MemoryRouter>,
  );

const type = async (q: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox"), q);
};

describe("scope ranks, never filters", () => {
  // 12 rows: the first 10 in scope, the last 2 outside it, and the index is RANK-ORDERED so
  // the in-scope ones all come first. This fixture is the design constraint in miniature —
  // any implementation that scans one ranked corpus and splits the result afterwards cannot
  // reach the last two, however generous its cap.
  const all: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`,
    label: `Ivan M${i}`,
    sub: i < 10 ? "52" : "51",
    href: `/p/m${i}`,
  }));
  const inRows = all.filter((r) => r.sub === "52");
  const outRows = all.filter((r) => r.sub === "51");

  const scoped = (limit = 2): HubSearchSource[] =>
    scopedSources<IndexSource>({
      id: "mps",
      label: { bg: "Депутати · 52 НС", en: "MPs in this parliament" },
      outLabel: {
        bg: "Депутати от други НС",
        en: "MPs from other parliaments",
      },
      limit,
      inSource: { kind: "index", index: idx(inRows) },
      outSource: { kind: "index", index: idx(outRows) },
    });

  it("reaches the out-of-scope rows even when every in-scope row outranks them", async () => {
    // THE CASE THAT KILLED THE FIRST DESIGN. A single ranked scan capped at any multiple of
    // the display limit returns 10 in-scope rows and never sees m10/m11, so the second group
    // renders empty and the box has silently become a filter.
    renderHub(scoped());
    await type("ivan");
    await waitFor(() =>
      expect(screen.getByText("Депутати · 52 НС")).toBeTruthy(),
    );
    expect(screen.getByText("Депутати от други НС")).toBeTruthy();
    expect(screen.getByText("Ivan M10")).toBeTruthy();
  });

  it("caps each group independently", async () => {
    // A shared cap would let the 10 in-scope rows eat the whole budget. With limit=2 each
    // group shows exactly 2 — not 2 in total.
    renderHub(scoped(2));
    await type("ivan");
    await waitFor(() =>
      expect(screen.getByText("Депутати от други НС")).toBeTruthy(),
    );
    expect(screen.getByText("Ivan M10")).toBeTruthy();
    expect(screen.getByText("Ivan M11")).toBeTruthy();
  });

  it("names the scope the second group is outside, never a bare 'others'", async () => {
    renderHub(scoped());
    await type("ivan");
    await waitFor(() =>
      expect(screen.getByText("Депутати от други НС")).toBeTruthy(),
    );
    expect(screen.queryByText("Други")).toBeNull();
  });

  it("renders ONE group when the subject has nothing outside the scope", async () => {
    renderHub(
      scopedSources<IndexSource>({
        id: "mps",
        label: { bg: "Депутати · 52 НС", en: "In" },
        outLabel: { bg: "Депутати от други НС", en: "Out" },
        inSource: { kind: "index", index: idx(inRows) },
        outSource: null,
      }),
    );
    await type("ivan");
    await waitFor(() =>
      expect(screen.getByText("Депутати · 52 НС")).toBeTruthy(),
    );
    expect(screen.queryByText("Депутати от други НС")).toBeNull();
  });

  it("omits an empty out-of-scope group rather than showing a bare heading", async () => {
    renderHub(
      scopedSources<IndexSource>({
        id: "mps",
        label: { bg: "Депутати · 52 НС", en: "In" },
        outLabel: { bg: "Депутати от други НС", en: "Out" },
        inSource: { kind: "index", index: idx(inRows) },
        outSource: { kind: "index", index: idx([]) },
      }),
    );
    await type("ivan");
    await waitFor(() =>
      expect(screen.getByText("Депутати · 52 НС")).toBeTruthy(),
    );
    expect(screen.queryByText("Депутати от други НС")).toBeNull();
  });

  it("gives the see-all only to the in-scope group", async () => {
    // On the out-of-scope group it would mean "see all of a set this page is not about".
    renderHub(
      scopedSources<IndexSource>({
        id: "mps",
        label: { bg: "Депутати · 52 НС", en: "In" },
        outLabel: { bg: "Депутати от други НС", en: "Out" },
        inSource: {
          kind: "index",
          index: idx(inRows),
          seeAll: () => ({ label: "виж всички", to: "/persons" }),
        },
        outSource: { kind: "index", index: idx(outRows) },
      }),
    );
    await type("ivan");
    await waitFor(() => expect(screen.getByText("виж всички")).toBeTruthy());
    expect(screen.getAllByText("виж всички")).toHaveLength(1);
  });
});

describe("server sources", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const serverSrc = (fetch: ServerFetch): HubSearchSource => ({
    kind: "server",
    id: "srv",
    label: { bg: "От сървъра", en: "Server" },
    fetch,
  });
  type ServerFetch = (q: string, s: AbortSignal) => Promise<SearchItem[]>;

  it("debounces — typing a word issues ONE request, not one per keystroke", async () => {
    const fetch = vi.fn(async () => [item("s1")]);
    renderHub([serverSrc(fetch)]);
    await type("ivanov");
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText("s1")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not query below the minimum length", async () => {
    const fetch = vi.fn(async () => []);
    renderHub([serverSrc(fetch)]);
    await type("i");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts a superseded request so stale rows cannot land under a newer query", async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn(async (_q: string, s: AbortSignal) => {
      signals.push(s);
      return [item("s1")];
    });
    renderHub([serverSrc(fetch)]);
    await type("iva");
    await vi.advanceTimersByTimeAsync(400);
    await type("nov");
    await vi.advanceTimersByTimeAsync(400);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("a failing source shows nothing instead of blanking the whole box", async () => {
    const ok = vi.fn(async () => [item("good")]);
    const bad = vi.fn(async () => {
      throw new Error("500");
    });
    renderHub([
      serverSrc(bad),
      {
        kind: "server",
        id: "ok",
        label: { bg: "Втора", en: "Second" },
        fetch: ok,
      },
    ]);
    await type("ivanov");
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText("good")).toBeTruthy());
  });
});

describe("arming", () => {
  const renderArm = (onArm: () => void) =>
    render(
      <MemoryRouter>
        <HubSearch
          sources={[]}
          title={{ bg: "Т", en: "S" }}
          placeholder={{ bg: "p", en: "p" }}
          hint={{ bg: "h", en: "h" }}
          idPrefix="arm"
          onArm={onArm}
        />
      </MemoryRouter>,
    );

  it("fires onArm on a KEYSTROKE with no focus event at all", async () => {
    // `userEvent.type` focuses first, so a test written with it passes with the keystroke
    // arm deleted — it only ever exercises the focus path. fireEvent.change delivers the
    // input without focus, which is the case this path exists for: a browser that is not
    // frontmost may never deliver focus, and a missing arm leaves every index null while
    // the box says "no matches".
    const onArm = vi.fn();
    renderArm(onArm);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "iv" } });
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it("fires onArm on focus alone, before any keystroke", async () => {
    const onArm = vi.fn();
    renderArm(onArm);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it("fires at most once", async () => {
    const onArm = vi.fn();
    renderArm(onArm);
    fireEvent.focus(screen.getByRole("combobox"));
    await type("ivan");
    expect(onArm).toHaveBeenCalledTimes(1);
  });
});

describe("loading is a state, not an inference", () => {
  it("a null index that is NOT loading shows no results, never a permanent spinner", async () => {
    // A caller whose data genuinely does not exist would otherwise hold the whole dropdown
    // on "Зареждане…" for ever, which reads as a hang rather than as an empty group.
    renderHub([
      {
        kind: "index",
        id: "none",
        label: { bg: "Празно", en: "Empty" },
        index: null,
      },
    ]);
    await type("ivan");
    await waitFor(() => expect(screen.queryByText("Зареждане…")).toBeNull());
  });

  it("a null index that IS loading shows the loading state", async () => {
    renderHub([
      {
        kind: "index",
        id: "soon",
        label: { bg: "Идва", en: "Coming" },
        index: null,
        loading: true,
      },
    ]);
    await type("ivan");
    await waitFor(() => expect(screen.getByText("Зареждане…")).toBeTruthy());
  });
});

describe("an unmemoized sources array does not re-fire every fetch", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("re-rendering with a new array identity issues no extra request", async () => {
    // The prop doc asks callers to memoize. This makes forgetting merely wasteful on the
    // client rather than a request storm on the server: a parent re-render for any unrelated
    // reason (an election change, a React Query resolution) would otherwise abort the
    // in-flight request and re-issue every fetch.
    const fetch = vi.fn(async () => [item("s1")]);
    const mk = (): HubSearchSource[] => [
      { kind: "server", id: "srv", label: { bg: "С", en: "S" }, fetch },
    ];
    const { rerender } = render(
      <MemoryRouter>
        <HubSearch
          sources={mk()}
          title={{ bg: "Т", en: "S" }}
          placeholder={{ bg: "p", en: "p" }}
          hint={{ bg: "h", en: "h" }}
          idPrefix="memo"
        />
      </MemoryRouter>,
    );
    await type("ivanov");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++)
      rerender(
        <MemoryRouter>
          <HubSearch
            sources={mk()}
            title={{ bg: "Т", en: "S" }}
            placeholder={{ bg: "p", en: "p" }}
            hint={{ bg: "h", en: "h" }}
            idPrefix="memo"
          />
        </MemoryRouter>,
      );
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("server rows never outlive the query that produced them", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  // fireEvent.change, not userEvent.type: one synchronous input event per query, so the
  // debounce fires exactly once per step and the test is about staleness rather than about
  // keystroke timing.
  const setQuery = (v: string) =>
    fireEvent.change(screen.getByRole("combobox"), { target: { value: v } });

  it("does not show the previous query's rows under a newer one", async () => {
    // The symptom was invisible: a client-index group rendering alongside makes the dropdown
    // non-empty, so the tile hides the loading state and the stale server rows just sit
    // there. „иван" then „петров" showed Иванови under Петров until the second request
    // resolved. Keying the stored rows on the query they answered is the fix.
    //
    // The query must CHANGE WITHOUT GOING EMPTY. Clearing it drops below MIN_QUERY, which
    // resets the stored rows through a different branch entirely — a clear-based version of
    // this test passed with the freshness check deleted (verified by mutation).
    const fetch = vi.fn((q: string) =>
      q === "ivan"
        ? Promise.resolve([item("ivan-row", "Ivan Row")])
        : new Promise<SearchItem[]>(() => {}),
    );
    renderHub([
      { kind: "server", id: "srv", label: { bg: "Хора", en: "People" }, fetch },
      {
        kind: "index",
        id: "idx",
        label: { bg: "Индекс", en: "Index" },
        index: idx([{ id: "p", label: "Petrov P", href: "/p/p" }]),
      },
    ]);
    setQuery("ivan");
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText("Ivan Row")).toBeTruthy());

    setQuery("ivanov");
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.queryByText("Ivan Row")).toBeNull());
  });
});

describe("a failed fetch is not reported as an absence of data", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  // Firing the debounce is not enough: the rejection's microtask chain and React's state
  // flush have to settle too, and one advanceTimersByTimeAsync does not guarantee it — the
  // sentence is then read in its PRE-failure form and the test fails for a reason that has
  // nothing to do with the behaviour. (Real timers are not an option: this project's test
  // setup wires waitFor to the mocked timer API.)
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(400);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1);
  };

  it("omits a failed source from the 'searched in' sentence", async () => {
    // „Няма съвпадения в: хора" is a claim about the data. A 500 is a claim about us.
    const fetch = vi.fn(async () => {
      throw new Error("500");
    });
    // ONE source, not two. With the only source failed there is nothing that WAS searched,
    // so the sentence drops its "в: …" clause entirely — an unambiguous observable, where a
    // substring check against a two-item list is not.
    renderHub([
      { kind: "server", id: "srv", label: { bg: "Хора", en: "People" }, fetch },
    ]);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzzz" },
    });
    await settle();
    const msg = screen.getByText(/Няма съвпадения/).textContent ?? "";
    expect(msg).not.toContain("хора");
    expect(msg).not.toContain("в:");
  });

  it("a synchronously-throwing fetch does not leave the box loading for ever", async () => {
    // Such a fetch never returns a promise, so a `.catch()` on the call has nothing to
    // attach to and the rejection escapes Promise.all.
    const fetch = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as (q: string, s: AbortSignal) => Promise<SearchItem[]>;
    renderHub([
      { kind: "server", id: "srv", label: { bg: "Хора", en: "People" }, fetch },
    ]);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ivan" },
    });
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.queryByText("Зареждане…")).toBeNull());
  });
});

describe("dropdown option ids are unique across sources", () => {
  it("namespaces ids even when the caller supplies toItem", async () => {
    // Two sources returning the same entity — an MP who is also an official — would emit two
    // options with the same DOM id; the combobox then marks BOTH aria-selected while arrow
    // keys land on one.
    const same = [{ id: "dup", label: "Ivan Dup", href: "/p/dup" }];
    renderHub([
      {
        kind: "index",
        id: "a",
        label: { bg: "А", en: "A" },
        index: idx(same),
        toItem: (row) => ({
          id: row.id,
          to: row.href,
          primary: row.label,
          icon: Search,
        }),
      },
      { kind: "index", id: "b", label: { bg: "Б", en: "B" }, index: idx(same) },
    ]);
    await type("ivan");
    await waitFor(() =>
      expect(screen.getAllByText("Ivan Dup")).toHaveLength(2),
    );
    const ids = screen.getAllByRole("option").map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
