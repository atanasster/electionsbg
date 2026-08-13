// Gates for /budget/explorer.
//
// The two that matter are about CLAIMS rather than rendering:
//
//   1. The caption must live inside the dimension branch. This page shows two
//      genuinely different aggregates — the МФ state budget and Eurostat's S13
//      general government — and one caption slot. A caption outside the branch
//      describes the other one, which here would assert the state budget is a
//      general-government total.
//   2. Switching dimension must CLEAR the drill path. The path is a key in the
//      tree you left; carried across, it asks the new dimension for a node it
//      has never heard of, and the level comes back empty at a 200.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BudgetExplorerScreen } from "./BudgetExplorerScreen";

// The REAL Bulgarian strings, not a `t: () => ""` mock. With the mock these
// gates asserted on hardcoded fallbacks the app never renders, so swapping the
// two captions in translation.json left every one of them green.
import bg from "@/locales/bg/translation.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bg as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const level = (over: Record<string, unknown> = {}) => ({
  fiscalYear: 2024,
  dimension: "admin",
  parent: null,
  basis: "eur",
  source: "МФ — държавен бюджет",
  total: 1000,
  rows: [
    {
      key: "admin-a",
      nameBg: "Министерство А",
      nameEn: "A",
      amount: 600,
      hasChildren: true,
    },
    {
      key: "admin-b",
      nameBg: "Агенция Б",
      nameEn: "B",
      amount: 400,
      hasChildren: false,
    },
  ],
  ...over,
});

const renderAt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/explorer${search}`]}>
        <BudgetExplorerScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2024,
              yearsAvailable: [2023, 2024],
            }),
          }
        : {
            ok: true,
            json: async () =>
              level(
                url.includes("dimension=functional")
                  ? { dimension: "functional", source: "Eurostat gov_10a_exp" }
                  : {},
              ),
          },
    ),
  );
});

describe("BudgetExplorerScreen", () => {
  it("captions the ADMIN dimension as the state budget", async () => {
    renderAt();
    expect(
      await screen.findByText(/Първостепенните разпоредители/),
    ).toBeTruthy();
    // …and must NOT claim the wider perimeter here.
    expect(screen.queryByText(/общините и осигурителните фондове/)).toBeNull();
  });

  it("captions the FUNCTIONAL dimension as general government, not the state budget", async () => {
    renderAt("?dimension=functional");
    const caption = await screen.findByText(
      /общините и осигурителните фондове/,
    );
    expect(caption).toBeTruthy();
    // The whole point: it says this is NOT a breakdown of the state budget.
    expect(caption.textContent).toMatch(/не е разбивка на държавния бюджет/i);
  });

  it("clears the drill path when the dimension changes", async () => {
    renderAt("?path=admin-a");
    // The path segment is on screen while we are inside it.
    expect(await screen.findByText("admin-a")).toBeTruthy();
    fireEvent.click(await screen.findByText("По функция"));
    // …and gone once the dimension changes, because it is a key in the tree we
    // left. Asserted on what the reader sees rather than on the request URL:
    // the breadcrumb IS the path, so this cannot pass for the wrong reason.
    await waitFor(() => {
      expect(screen.queryByText("admin-a")).toBeNull();
    });
  });

  it("keeps other query params when the dimension changes", async () => {
    // The regression that made the path-clear gate unable to fail: rebuilding
    // params from window.location (empty under MemoryRouter) dropped every
    // other param AND made deleting `path` a no-op.
    renderAt("?fy=2023&path=admin-a");
    fireEvent.click(await screen.findByText("По функция"));
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("budget-explorer"));
      const last = urls[urls.length - 1];
      expect(last).toMatch(/dimension=functional/);
      expect(last).toMatch(/fy=2023/);
      expect(last).not.toMatch(/parent=/);
    });
  });

  it("gives a row an affordance only when it has children", async () => {
    renderAt();
    const withChildren = await screen.findByText(/Министерство А/i);
    const without = screen.getByText(/Агенция Б/i);
    // A button when it acts, a plain element when it does not — never a button
    // role on a row that does nothing.
    expect(withChildren.closest("button")).toBeTruthy();
    expect(without.closest("button")).toBeNull();
  });
});
