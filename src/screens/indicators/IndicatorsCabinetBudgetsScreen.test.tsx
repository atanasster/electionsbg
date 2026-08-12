// This page's body waits for governments.json, like every sibling /indicators/*
// screen. Here that is not a consistency preference — it was the worst layout
// shift in the route group.
//
// Rendering the body immediately meant first paint showed the methodology block
// at the FOOT of the page and nothing else, because every other block returns
// null without its payload. Both of them then arrived above it: the scorecard
// (governments.json) and the izdrazhka heatmap (izdrazhka_by_institution.json),
// each shoving the methodology off the viewport. Measured on the built dist
// (Pixel 5, 150ms RTT, 1.6Mbps, 4x CPU): whichever landed first scored ~0.64 and
// the second ~0.66, for 1.3276 median — 13x the CWV budget. Re-measure with
// `npm run perf:cls -- /indicators/budgets`.
//
// The property is that NOTHING data-dependent renders before governments.json:
// a page that renders its footer first has the defect regardless of which
// element happens to arrive next.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { IndicatorsCabinetBudgetsScreen } from "./IndicatorsCabinetBudgetsScreen";

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <IndicatorsCabinetBudgetsScreen />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
    client,
  };
};

beforeEach(() => {
  // Never settles — the window between first paint and governments.json.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>(() => {}),
  );
});

describe("IndicatorsCabinetBudgetsScreen while its data is in flight", () => {
  it("renders the page header and nothing below it", () => {
    const { container } = renderScreen();
    expect(container.textContent).toContain("cabinet_budgets_heading");
    // The methodology block's lead paragraph. Its presence at first paint is
    // the defect itself: it is the last thing on the page, so anything that
    // arrives later arrives ABOVE it.
    expect(container.textContent).not.toContain("cabinet_budgets_about_lead");
  });

  it("renders no sources list before the charts it describes exist", () => {
    // ChartSources sits inside the same block; asserting it separately keeps
    // the test honest if the lead paragraph is ever reworded away.
    const { container } = renderScreen();
    expect(container.querySelector("a[href*='eurostat']")).toBeNull();
  });
});

describe("IndicatorsCabinetBudgetsScreen with SOME payloads in and one still loading", () => {
  // The case that distinguishes this page's gate from every sibling's. They
  // wait for their primary payload; this one waits for all five, because each
  // late arrival grew or inserted a block above content that was already
  // painted. Fixing only the first arrival moved the score to the second
  // (0.6430), and fixing that moved it to the third (0.6637) — the scorecard
  // itself, which is nearly empty until the last of its four payloads lands.
  it("holds the whole body while any payload is still in flight", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("izdrazhka")) return new Promise<Response>(() => {});
      if (url.includes("governments.json")) {
        return new Response(JSON.stringify({ governments: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    });
    const { container, client } = renderScreen();
    // Key the wait on the QUERY, not the DOM. The loading return renders the
    // same header the loaded one does, so every DOM-shaped condition here is
    // also true before governments.json lands — which silently turns this into
    // a re-test of the first case. (It did: this assertion passed against a
    // build with the gate removed until the wait was rewritten.)
    await waitFor(() =>
      expect(client.getQueryState(["governments"])?.status).toBe("success"),
    );
    expect(client.getQueryState(["izdrazhkaByInstitution"])?.status).toBe(
      "pending",
    );
    // Neither the footer nor the blocks above it: one payload short is still
    // the header state.
    expect(container.textContent).not.toContain("cabinet_budgets_about_lead");
    expect(container.querySelector("a[href*='eurostat']")).toBeNull();
    // Both the scorecard and the heatmap render tables; the header renders
    // none. Cheaper to keep true than a child count of the header itself.
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("IndicatorsCabinetBudgetsScreen once its data has settled", () => {
  // Both gates are `isPending`, and both of these fetchers turn a non-ok
  // response into a resolved null/undefined that react-query calls SUCCESS. So
  // the state to prove is the PERMANENT one: a page whose payloads all failed
  // must still render its methodology, or the gates that fix the shift have
  // quietly deleted a section of the page instead.
  it("renders the methodology even when every payload has failed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("", { status: 404 }),
    );
    const { container } = renderScreen();
    await waitFor(() =>
      expect(container.textContent).toContain("cabinet_budgets_about_lead"),
    );
    expect(container.querySelector("a[href*='eurostat']")).not.toBeNull();
  });
});
