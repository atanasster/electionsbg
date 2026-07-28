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
