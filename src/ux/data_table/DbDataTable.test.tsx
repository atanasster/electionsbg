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

import { render, waitFor } from "@testing-library/react";
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
    const url = decodeURIComponent(
      (vi.mocked(fetch).mock.calls[0][0] as string).split("?q=")[1],
    );
    const req = JSON.parse(url);
    expect(req.filters.global).toBeUndefined();
    // The REQUEST still goes out — suppressing the term, not the query, is what keeps
    // the unfiltered page (and its aggregates footer) on screen while someone types.
    expect(req.resource).toBe("test");
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
    const req = JSON.parse(
      decodeURIComponent(
        (vi.mocked(fetch).mock.calls[0][0] as string).split("?q=")[1],
      ),
    );
    expect(req.filters.global).toBe("апи");
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
    const req = JSON.parse(
      decodeURIComponent(
        (vi.mocked(fetch).mock.calls[0][0] as string).split("?q=")[1],
      ),
    );
    expect(req.filters.global).toBeUndefined();
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
    const req = JSON.parse(
      decodeURIComponent(
        (vi.mocked(fetch).mock.calls[0][0] as string).split("?q=")[1],
      ),
    );
    expect(req.filters.global).toBe("00");
  });
});
