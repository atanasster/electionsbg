// The header search must record ONE `search` analytics event per settled query, not one per
// keystroke. Until 2026-10-13 `runSearch` called `trackSearch` on every recomputation, so
// Umami logged 1,075 `search` events in 7 days against ~69 selections — keystrokes, not
// searches, each one a write into the shared Cloud SQL instance.
//
// The count must be the CURRENT term's: no event while the index is still loading (every
// term would read 0), and none carrying the previous term's person rows while the new
// lookup is in flight.
//
//   npx vitest run src/layout/search/SearchContext.test.tsx

import { act, render } from "@testing-library/react";
import { useContext, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_SETTLE_MS } from "@/lib/analytics";
import { SearchContext, SearchContextProvider } from "./SearchContext";

// A tiny static index: every term matches one settlement row. `indexReady` stands in for
// the ~2.7 MB index download; the real hook's `search` exists from the first render and
// answers undefined until the index is built.
let indexReady = true;
vi.mock("@/data/search/useSearchItems", () => {
  const search = (q: string) =>
    indexReady
      ? [
          {
            item: { type: "s", key: "68134", name: `match ${q}` },
            refIndex: 0,
            score: 0.01,
          },
        ]
      : undefined;
  return { useSearchItems: () => ({ search, ready: indexReady }) };
});

const track = vi.fn();
let ctx: React.ContextType<typeof SearchContext>;
const Probe = () => {
  const c = useContext(SearchContext);
  useEffect(() => {
    ctx = c;
  });
  return null;
};

// In 100 ms steps, each in its own `act`: React commits a state update only when `act`
// exits, so a timer armed by that commit (the tracker's, after the person rows land) would
// otherwise be scheduled after one long advance had already finished.
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
    });
  }
};

const typeOut = async (word: string) => {
  for (let i = 1; i <= word.length; i++) {
    await act(async () => {
      ctx.setSearchTerm(word.slice(0, i));
    });
    await advance(150);
  }
};

const searchEvents = () =>
  track.mock.calls.filter(([name]) => name === "search");

/** `/api/db/person-lookup` answers with `people[q] ?? []` after `delayMs`. */
const stubPersons = (people: Record<string, string[]>, delayMs = 0) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const q = new URL(url, "http://x").searchParams.get("q") ?? "";
      await new Promise((r) => setTimeout(r, delayMs));
      const hits = (people[q] ?? []).map((name, i) => ({
        slug: `${q}-${i}`,
        name,
      }));
      // A plain object, not a `Response`: its body stream resolves on the real event loop,
      // which fake timers never advance.
      return { ok: true, json: async () => hits };
    }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  track.mockClear();
  indexReady = true;
  window.umami = { track };
  stubPersons({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.umami;
});

const mount = async () => {
  const view = render(
    <SearchContextProvider>
      <Probe />
    </SearchContextProvider>,
  );
  await act(async () => ctx.activate());
  return view;
};

describe("header search analytics", () => {
  it("typing „софия“ char-by-char yields exactly one search event", async () => {
    await mount();
    await typeOut("софия");
    expect(searchEvents()).toEqual([]);
    await advance(SEARCH_SETTLE_MS * 2);
    expect(searchEvents()).toEqual([["search", { result_count: 1 }]]);
  });

  it("a flush (selection / blur) sends at once, and the debounce then adds nothing", async () => {
    await mount();
    await typeOut("софия");
    await advance(500);
    act(() => ctx.flushSearch());
    expect(track).toHaveBeenCalledTimes(1);
    act(() => ctx.flushSearch());
    await advance(SEARCH_SETTLE_MS * 2);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("clearing the box before it settles sends nothing", async () => {
    await mount();
    await typeOut("соф");
    await act(async () => ctx.setSearchTerm(""));
    await advance(SEARCH_SETTLE_MS * 2);
    expect(track).not.toHaveBeenCalled();
  });

  it("never reports the previous term's person rows while the new lookup is slow", async () => {
    await mount();
    // „иван“ settles with two people → 1 static + 2 = 3.
    stubPersons({ иван: ["Иван А", "Иван Б"] });
    await act(async () => ctx.setSearchTerm("иван"));
    await advance(SEARCH_SETTLE_MS * 2);
    expect(searchEvents()).toEqual([["search", { result_count: 3 }]]);

    // „ивана“ has no people, but its lookup takes longer than the settle window: the two
    // „иван“ rows are still in `items` all that time.
    stubPersons({}, SEARCH_SETTLE_MS * 2);
    await act(async () => ctx.setSearchTerm("ивана"));
    await advance(SEARCH_SETTLE_MS + 100);
    act(() => ctx.flushSearch());
    expect(searchEvents()).toHaveLength(1);

    await advance(SEARCH_SETTLE_MS * 3);
    expect(searchEvents()).toEqual([
      ["search", { result_count: 3 }],
      ["search", { result_count: 1 }],
    ]);
  });

  it("records nothing while the index loads, then one event with the real count", async () => {
    indexReady = false;
    const view = await mount();
    await typeOut("софия");
    await advance(SEARCH_SETTLE_MS * 2);
    expect(searchEvents()).toEqual([]);

    indexReady = true;
    view.rerender(
      <SearchContextProvider>
        <Probe />
      </SearchContextProvider>,
    );
    await advance(SEARCH_SETTLE_MS * 2);
    expect(searchEvents()).toEqual([["search", { result_count: 1 }]]);
  });
});
