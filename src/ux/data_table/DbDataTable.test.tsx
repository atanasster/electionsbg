// DbDataTable — the onData notification contract.
//
// WHAT THIS PINS. onData receives the request that produced the response, so an exporter can
// re-issue it at a larger pageSize. The obvious implementation — putting `request` in the
// effect's dependency array — breaks EVERY page that uses this component: the request memo
// keys on `scope` / `fixedFilters` / `extraFilters`, which callers routinely pass as inline
// object literals, so its identity changes on each render, the effect fires on each render,
// and any onData that sets state loops until React throws "Maximum update depth exceeded".
//
// That shipped once and blanked /procurement/contracts. The failure is invisible to tsc and
// eslint, and only appears on a page whose onData sets state with a fresh value — so it gets
// a test rather than a comment.

import { render, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { DbDataTable } from "./DbDataTable";

type Row = { id: string; n: number };

const response = {
  rows: [{ id: "a", n: 1 }],
  total: 1,
  totalExact: true,
  page: 0,
  pageSize: 25,
  aggregates: { sumN: 1 },
};

const renderTable = (ui: React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
};

/** The request body behind one `fetch` call, decoded. Written once rather than eight times:
 *  the encoding (`/api/db/table?q=<json>`) is one implementation detail, and spelling it out
 *  per assertion makes a change to it an eight-site edit. */
interface DecodedRequest {
  resource: string;
  page: number;
  filters: { global?: string; columns?: { id: string; value?: unknown }[] };
}
const requestAt = (i: number): DecodedRequest => {
  const calls = vi.mocked(fetch).mock.calls;
  const url = (i < 0 ? calls.at(i) : calls[i])![0] as string;
  return JSON.parse(decodeURIComponent(url.split("?q=")[1])) as DecodedRequest;
};
/** The term the LAST request actually sent, or `undefined` when it was suppressed. */
const lastGlobal = (): string | undefined => requestAt(-1).filters.global;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => response })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DbDataTable onData", () => {
  it("fires once per response, not once per render", async () => {
    // The caller passes inline literals for scope/fixedFilters — a new identity every
    // render, which is exactly what the real screens do.
    const onData = vi.fn();
    const Host = () => (
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        scope={{ col: "scope_key", val: "all" }}
        fixedFilters={[{ id: "x", value: "y" }]}
        onData={onData}
      />
    );
    renderTable(<Host />);
    await waitFor(() => expect(onData).toHaveBeenCalled());
    // Give any runaway effect a chance to pile up before asserting.
    await new Promise((r) => setTimeout(r, 60));
    expect(onData.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("does not loop when onData sets state with a fresh value", async () => {
    // The regression itself. setState with a NEW object each time defeats React's
    // bail-out, so an over-eager effect re-renders forever.
    let renders = 0;
    const Host = () => {
      const [, setSeen] = useState<{ agg: Record<string, number> } | null>(
        null,
      );
      renders++;
      return (
        <DbDataTable<Row>
          resource="test"
          columns={[{ accessorKey: "id", header: "id" }]}
          scope={{ col: "scope_key", val: "all" }}
          extraFilters={[{ id: "p", value: ["q"] }]}
          onData={(resp) => setSeen({ agg: resp.aggregates })}
        />
      );
    };
    renderTable(<Host />);
    await new Promise((r) => setTimeout(r, 150));
    // An unbounded loop reaches React's 50-update limit almost immediately.
    expect(renders).toBeLessThan(20);
  });

  it("passes the request that produced the response", async () => {
    const onData = vi.fn();
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        scope={{ col: "scope_key", val: "ns:2026_04_19" }}
        onData={onData}
      />,
    );
    await waitFor(() => expect(onData).toHaveBeenCalled());
    const [, request] = onData.mock.calls[0];
    // What an exporter needs to re-issue the same query at a larger pageSize.
    expect(request).toMatchObject({
      resource: "test",
      scope: { col: "scope_key", val: "ns:2026_04_19" },
      page: 0,
    });
  });
});

// ---- the free-text length floor -------------------------------------------------
//
// WHAT THIS PINS. The engine REFUSES a global term below SEARCH_MIN_CHARS with a 400
// rather than serving an empty result (an empty result would read as "no such row").
// This component is the half that keeps an ordinary reader off that 400 — the same
// two-sided shape as FIT_MIN_QUERY / useFundsFit. Without it, every one- and
// two-character keystroke, and every `?q=` deep link shorter than the floor, renders the
// destructive "Could not load data." panel on 23 of the 24 registry resources.
//
// `?q=` is the case worth naming: `initialSearch` seeds the DEBOUNCED state directly, so
// a short seed fires on first paint with no delay to absorb it.

describe("DbDataTable search floor", () => {
  it("does not send a term below the floor, and asks unfiltered instead", async () => {
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="ст"
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBeUndefined();
    // The REQUEST still goes out — suppressing the term, not the query, is what keeps
    // the unfiltered page (and its aggregates footer) on screen while someone types.
    expect(requestAt(0)).toMatchObject({ resource: "test" });
  });

  it("renders the hint rather than the error panel", async () => {
    // There is no i18n provider in unit tests, so `t()` returns the KEY — same as the
    // pre-existing `db_table_error` branch beside it. Asserting the key is therefore
    // asserting the contract: which of the two branches rendered.
    const { findByText, queryByText } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="ст"
      />,
    );
    const cell = await findByText("db_table_search_min");
    // Guidance, not failure: nothing broke, the term was simply never sent. The colour
    // is the whole message here — `text-destructive` would tell the reader the site is
    // broken when it is working exactly as intended.
    expect(cell.className).toContain("text-muted-foreground");
    expect(cell.className).not.toContain("text-destructive");
    expect(queryByText("db_table_error")).toBeNull();
  });

  it("the hint key exists in BOTH corpora", async () => {
    // A key present in the component and missing from a corpus renders the raw
    // `db_table_search_min` to that language's readers. The i18n prune gate catches
    // UNUSED keys, which is the opposite direction and would not see this.
    const [bg, en] = await Promise.all([
      import("@/locales/bg/translation.json"),
      import("@/locales/en/translation.json"),
    ]);
    for (const [lang, corpus] of [
      ["bg", bg.default],
      ["en", en.default],
    ] as const) {
      const v = (corpus as Record<string, string>).db_table_search_min;
      expect(v, `${lang} is missing db_table_search_min`).toBeTruthy();
      // The count is interpolated, so a translation that drops the placeholder would
      // hard-code a floor that no longer tracks searchMinChars.
      expect(v, `${lang} must interpolate the count`).toContain("{{n}}");
    }
  });

  it("sends a term AT the floor", async () => {
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="апи"
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBe("апи");
  });

  it("counts characters, not UTF-16 code units", async () => {
    // "👍👍" is 4 code units and 2 characters, and pg_trgm extracts ZERO trigrams from
    // it — strictly worse than the two-letter term the floor was written for. A
    // `.length` check would send it and collect the 400.
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="👍👍"
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBeUndefined();
  });

  it("a resource with a lower floor may opt down", async () => {
    // e.g. a table whose only searchable column is an anchored identifier prefix, which
    // the engine floors at 1. Raising the prop above the engine floor is always safe;
    // lowering it below is what produces the 400 this guard exists to avoid.
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="00"
        searchMinChars={1}
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBe("00");
  });

  it("floors and SENDS the same string — the trimmed one", async () => {
    // One string decided, a different one sent, is two React Query entries, two onData
    // notifications and two exporter re-issues for one identical server-side query. A
    // whitespace-only term is the loud case: sent in full it matches everything.
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="  апи  "
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBe("апи");
  });

  it("suppresses a whitespace-only term entirely", async () => {
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="   "
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBeUndefined();
  });
});

// ---- the controlled-search seam -------------------------------------------------
//
// WHAT THIS PINS. A SEARCH-FIRST page (/persons) renders its own search field outside the
// table and owns the term in the URL, so it passes `search` and `hideSearchInput`. Two
// properties must survive that, and both are easy to lose:
//
//   1. THE 250 ms DEBOUNCE stays in this component. Losing it is one server round trip per
//      keystroke against a 300k–1M-row table, and no test that sets a term ONCE can see the
//      difference — so the assertion here is COALESCING, not arrival.
//   2. THE SEARCH_MIN_CHARS FLOOR stays here too, because the engine's 400 is one contract
//      and a page that built its own request would be a second implementation of it.
//
// The uncontrolled path is re-asserted alongside. Every one of the ~24 other registry
// resources passes none of the three props, and a regression there is invisible until a page
// nobody is watching stops searching.

describe("DbDataTable controlled search", () => {
  it("coalesces rapid controlled changes into ONE request", async () => {
    const Host = () => {
      const [q, setQ] = useState("");
      return (
        <>
          <button
            onClick={() => {
              setQ("а");
              setQ("ап");
              setQ("апи");
            }}
          >
            type
          </button>
          <DbDataTable<Row>
            resource="test"
            columns={[{ accessorKey: "id", header: "id" }]}
            search={q}
            hideSearchInput
          />
        </>
      );
    };
    const { getByText } = renderTable(<Host />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const before = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(getByText("type"));
    await waitFor(() => expect(lastGlobal()).toBe("апи"));
    // Without the debounce this is 3 — one round trip per intermediate term. The two
    // sub-floor ones would each be suppressed to an unfiltered scan of the whole table.
    expect(vi.mocked(fetch).mock.calls.length - before).toBe(1);
  });

  /** A controlled host whose term changes on a click — the shape a submitted search box has.
   *  `rerender` cannot be used here: it replaces the root children, dropping the
   *  QueryClientProvider `renderTable` wraps them in. */
  const CommittedHost = ({ committed }: { committed: boolean }) => {
    const [q, setQ] = useState("апи");
    return (
      <>
        <button onClick={() => setQ("апис")}>refine</button>
        <DbDataTable<Row>
          resource="test"
          columns={[{ accessorKey: "id", header: "id" }]}
          search={q}
          hideSearchInput
          {...(committed ? { searchIsCommitted: true as const } : {})}
        />
      </>
    );
  };

  it("⚠️ skips the debounce when the parent says the term is COMMITTED", async () => {
    // The opt-in half. A committed term arrives once per reader intention, so there is nothing
    // to coalesce — waiting is 250 ms of latency after an explicit button press, on every
    // refinement while a table is already up. (The FIRST search never paid it either way:
    // `debounced` is seeded from `search` at mount, so this is only ever about refinements.)
    //
    // ⚠️ FAKE TIMERS ADVANCED BY **0 ms**, WHICH IS THE WHOLE ASSERTION. `vi.waitFor` pumps the
    // fake clock while it polls, so `await vi.waitFor(() => expect(lastGlobal()).toBe("апис"))`
    // passes with the debounce fully intact — mutation-verified: with the skip replaced by
    // `if (false)`, that version stayed green. `advanceTimersByTimeAsync(0)` flushes microtasks
    // (so the request can go out) WITHOUT letting a 250 ms timer fire.
    vi.useFakeTimers();
    try {
      const { getByText } = renderTable(<CommittedHost committed />);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      fireEvent.click(getByText("refine"));
      await vi.advanceTimersByTimeAsync(0);
      expect(lastGlobal()).toBe("апис");
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠️ keeps the debounce when the parent does NOT claim a committed term", async () => {
    // Non-vacuity for the case above, and the reason the flag is explicit rather than inferred
    // from `search !== undefined`: /persons and /companies were controlled AND typed into for
    // months, so `if (controlled) skip` would have been one round trip per keystroke against a
    // 1.02M-row corpus.
    vi.useFakeTimers();
    try {
      const { getByText } = renderTable(<CommittedHost committed={false} />);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      fireEvent.click(getByText("refine"));
      // Nothing advanced, so the debounce has not fired and the request is still the old term.
      await vi.advanceTimersByTimeAsync(50);
      expect(lastGlobal()).toBe("апи");
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(lastGlobal()).toBe("апис"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the floor to a controlled term too", async () => {
    // The whole reason the term is controlled rather than the request: a page that built
    // its own request would have to re-implement this, and the failure is a 400 that
    // renders the destructive "Could not load data." panel.
    renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        search="ст"
        hideSearchInput
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBeUndefined();
  });

  it("still renders the below-the-floor hint with the input hidden", async () => {
    // The hint is the one place that explains why a term the reader CAN see (in the page's
    // own field) produced no rows. Hiding the input must not hide the explanation.
    const { findByText } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        search="ст"
        hideSearchInput
      />,
    );
    expect(await findByText("db_table_search_min")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("hideSearchInput removes the built-in input", async () => {
    const { queryByRole } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        search=""
        hideSearchInput
      />,
    );
    expect(queryByRole("searchbox")).toBeNull();
    // Let the in-flight query settle rather than leaving it to land during cleanup.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("a controlled VISIBLE input reports every keystroke", async () => {
    // The reachable-but-broken configuration the union type now refuses to let a caller
    // build accidentally: controlled, input visible, no `onSearchChange`. The parent owns
    // the value, so the callback is the ONLY evidence a keystroke landed — without it the
    // box silently discards everything typed into it, at a 200.
    const onSearchChange = vi.fn();
    const Host = () => {
      const [q, setQ] = useState("");
      return (
        <DbDataTable<Row>
          resource="test"
          columns={[{ accessorKey: "id", header: "id" }]}
          search={q}
          onSearchChange={(v) => {
            onSearchChange(v);
            setQ(v);
          }}
        />
      );
    };
    const { getByRole } = renderTable(<Host />);
    await userEvent.type(getByRole("searchbox"), "апи");
    expect(onSearchChange).toHaveBeenCalled();
    expect((getByRole("searchbox") as HTMLInputElement).value).toBe("апи");
  });

  it("a controlled input does NOT move on its own — only with the parent", async () => {
    // The subtlest rule in the seam: the controlled branch must not also write `inner`.
    // An "obvious fix" that adds it passes every other test here while forking the box
    // from the URL, so the box shows what was typed and the table queries something else.
    const onSearchChange = vi.fn();
    const { getByRole } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        search=""
        onSearchChange={onSearchChange}
      />,
    );
    await userEvent.type(getByRole("searchbox"), "апи");
    expect(onSearchChange).toHaveBeenCalledTimes(3);
    // The parent never accepted the term, so the box must still be empty.
    expect((getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("an UNCONTROLLED input both moves and reports", async () => {
    const onSearchChange = vi.fn();
    const { getByRole } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        onSearchChange={onSearchChange}
      />,
    );
    await userEvent.type(getByRole("searchbox"), "апи");
    expect((getByRole("searchbox") as HTMLInputElement).value).toBe("апи");
    expect(onSearchChange).toHaveBeenLastCalledWith("апи");
  });

  it("clearing a controlled term returns the unfiltered page", async () => {
    const Host = () => {
      const [q, setQ] = useState("апи");
      return (
        <>
          <button onClick={() => setQ("")}>clear</button>
          <DbDataTable<Row>
            resource="test"
            columns={[{ accessorKey: "id", header: "id" }]}
            search={q}
            hideSearchInput
          />
        </>
      );
    };
    const { getByText } = renderTable(<Host />);
    await waitFor(() => expect(lastGlobal()).toBe("апи"));
    fireEvent.click(getByText("clear"));
    // `"" || undefined` — an empty term must drop out of the request entirely, not be
    // sent as an empty global that the engine would have to special-case.
    await waitFor(() => expect(lastGlobal()).toBeUndefined());
  });

  it("ignores initialSearch when controlled", async () => {
    // The type refuses this combination (`initialSearch?: never` in both controlled arms),
    // so the cast is deliberate: it pins the RUNTIME fallback for a JS caller or a prop
    // spread. Honouring both would seed a term the controlled parent does not hold —
    // visible in the box, absent from the URL, and unclearable from the page's own field.
    const props = {
      resource: "test",
      columns: [{ accessorKey: "id", header: "id" }],
      search: "",
      hideSearchInput: true,
      initialSearch: "апи",
    } as unknown as React.ComponentProps<typeof DbDataTable<Row>>;
    renderTable(<DbDataTable<Row> {...props} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBeUndefined();
  });

  it("leaves the UNCONTROLLED path exactly as it was", async () => {
    // The regression net for the other ~24 resources: no `search` prop, so the component
    // owns the term, `initialSearch` seeds it, and the request carries it.
    const { getByRole } = renderTable(
      <DbDataTable<Row>
        resource="test"
        columns={[{ accessorKey: "id", header: "id" }]}
        initialSearch="апи"
      />,
    );
    expect((getByRole("searchbox") as HTMLInputElement).value).toBe("апи");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastGlobal()).toBe("апи");
  });
});

// ---- the page reset ------------------------------------------------------------
//
// WHAT THIS PINS. A change to the QUERY SHAPE returns to page 0; a parent re-render that
// changed nothing must not. `extraFilters` and `scope` are passed as inline object literals
// by ten screens, so an identity-keyed effect resets the page on every parent render — and a
// CONTROLLED parent re-renders on every keystroke of its own field, during a 250 ms window in
// which the debounced term has not moved at all.

describe("DbDataTable page reset", () => {
  it("holds the page across a parent re-render that changes nothing", async () => {
    const Host = () => {
      const [, bump] = useState(0);
      return (
        <>
          <button onClick={() => bump((n) => n + 1)}>bump</button>
          <DbDataTable<Row>
            resource="test"
            columns={[{ accessorKey: "id", header: "id" }]}
            // Inline literals — a NEW identity on every render, exactly as the real
            // screens pass them.
            scope={{ col: "scope_key", val: "all" }}
            extraFilters={[{ id: "p", value: ["q"] }]}
            pageSize={1}
          />
        </>
      );
    };
    const { getByText } = renderTable(<Host />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // The stub always answers total:1, so page 1 is the only page — assert on the REQUEST
    // instead, which is where `page` lives.
    expect(requestAt(-1)).toMatchObject({ page: 0 });
    const before = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(getByText("bump"));
    await new Promise((r) => setTimeout(r, 60));
    // No new request at all: the shape is unchanged, so neither the page nor the query key
    // may move.
    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });

  it("returns to page 0 when a filter's CONTENT changes", async () => {
    const Host = () => {
      const [v, setV] = useState("q");
      return (
        <>
          <button onClick={() => setV("z")}>change</button>
          <DbDataTable<Row>
            resource="test"
            columns={[{ accessorKey: "id", header: "id" }]}
            extraFilters={[{ id: "p", value: [v] }]}
          />
        </>
      );
    };
    const { getByText } = renderTable(<Host />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(getByText("change"));
    await waitFor(() =>
      expect(requestAt(-1)).toMatchObject({
        page: 0,
        filters: { columns: [{ id: "p", value: ["z"] }] },
      }),
    );
  });
});
