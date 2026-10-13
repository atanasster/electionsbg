// The header search must record ONE `search` analytics event per settled query, not one per
// keystroke. Until 2026-10-13 `runSearch` called `trackSearch` on every recomputation, so
// Umami logged 1,075 `search` events in 7 days against ~69 selections — keystrokes, not
// searches, each one a write into the shared Cloud SQL instance.
//
//   npx vitest run src/layout/search/SearchContext.test.tsx

import { act, render } from "@testing-library/react";
import { useContext, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_SETTLE_MS } from "@/lib/analytics";
import { SearchContext, SearchContextProvider } from "./SearchContext";

// A tiny static index: every term matches one settlement row, so the count is non-zero and
// the search function is available immediately (no 2.7 MB index fetch).
vi.mock("@/data/search/useSearchItems", () => {
  const search = (q: string) => [
    {
      item: { type: "s", key: "68134", name: `match ${q}` },
      refIndex: 0,
      score: 0.01,
    },
  ];
  return { useSearchItems: () => ({ search }) };
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

const typeOut = async (word: string) => {
  for (let i = 1; i <= word.length; i++) {
    await act(async () => {
      ctx.setSearchTerm(word.slice(0, i));
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  track.mockClear();
  window.umami = { track };
  // The live person lookup — no people, so only the static row counts.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.umami;
});

const mount = async () => {
  render(
    <SearchContextProvider>
      <Probe />
    </SearchContextProvider>,
  );
  // Activate so the (mocked) index loader mounts and reports its search function.
  await act(async () => ctx.activate());
};

describe("header search analytics", () => {
  it("typing „софия“ char-by-char yields exactly one search event", async () => {
    await mount();
    await typeOut("софия");
    expect(track).not.toHaveBeenCalledWith("search", expect.anything());
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2);
    });
    const searches = track.mock.calls.filter(([name]) => name === "search");
    expect(searches).toEqual([["search", { result_count: 1 }]]);
  });

  it("a flush (selection / blur) sends at once, and the debounce then adds nothing", async () => {
    await mount();
    await typeOut("софия");
    act(() => ctx.flushSearch());
    expect(track).toHaveBeenCalledTimes(1);
    act(() => ctx.flushSearch());
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2);
    });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("clearing the box before it settles sends nothing", async () => {
    await mount();
    await typeOut("соф");
    await act(async () => ctx.setSearchTerm(""));
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2);
    });
    expect(track).not.toHaveBeenCalled();
  });
});
