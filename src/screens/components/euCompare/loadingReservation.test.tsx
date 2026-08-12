// /indicators/compare renders its whole body on first paint — unlike the
// sibling /indicators/* pages, which hold everything back until governments.json
// lands and so append below the fold. So every panel here renders its
// "no data yet" branch FIRST, and when that branch was one line of text the
// sections grew as the payloads landed: WGI 208px → 1284px, COFOG 192px → 796px,
// the scatters 356px → 1028px. Measured on the built dist (Pixel 5, 150ms RTT,
// 1.6Mbps, 4x CPU, page served at the electionsbg.com origin) the WGI growth
// alone pushed the snapshot table out of the viewport for a 0.2230 layout shift
// — the largest single shift on the page.
//
// Two properties, each failing a different way:
//   - reserve WHILE PENDING, or the growth comes back;
//   - reserve ONLY while pending. Every one of these fetchers returns undefined
//     on a non-ok response, which react-query records as SUCCESS — so the
//     no-data state is PERMANENT after a failed fetch, and an unconditional
//     reservation would hold a screen of empty boxes for ever instead of saying
//     the data is unavailable. The "collapses once settled" cases below are what
//     keep the first half from being fixed the wrong way.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { EuCompareWgiSmallMultiples } from "./EuCompareWgiSmallMultiples";
import { EuCompareWgiRadar } from "./EuCompareWgiRadar";
import { EuCompareCofogMultiples } from "./EuCompareCofogMultiples";
import { EuCompareSpendOutcomeScatters } from "./EuCompareSpendOutcomeScatters";
import { TOGGLEABLE_PEERS } from "./usePeerSelection";

// Never settles — the window between first paint and the payload landing, which
// on a throttled phone is a whole render pass wide.
const pendingFetch = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => new Promise<Response>(() => {}));

// Settles as react-query SUCCESS with `undefined` data — what a 404/5xx on the
// data bucket actually produces here, and the state that must NOT reserve.
const failedFetch = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response("", { status: 404 }));

const renderPanel = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
};

const boxes = (c: HTMLElement, cls: string) =>
  c.querySelectorAll(`.${CSS.escape(cls)}`).length;

beforeEach(() => {
  // The panels' own placeholders never mount a chart, so recharts' measurement
  // path is not exercised — but ResponsiveContainer is imported either way.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("EuCompareWgiSmallMultiples", () => {
  it("holds one panel per selected peer, at the plot's own height, while pending", () => {
    pendingFetch();
    const { container } = renderPanel(<EuCompareWgiSmallMultiples />);
    // The panel COUNT comes from the URL peer selection, not the payload, which
    // is what makes an exact reservation possible here at all.
    expect(boxes(container, "h-[200px]")).toBe(TOGGLEABLE_PEERS.length);
    expect(container.textContent).not.toContain("gov_macro_unavailable");
  });

  it("collapses to the unavailable line once the query has settled empty", async () => {
    failedFetch();
    const { container } = renderPanel(<EuCompareWgiSmallMultiples />);
    await waitFor(() =>
      expect(container.textContent).toContain("gov_macro_unavailable"),
    );
    expect(boxes(container, "h-[200px]")).toBe(0);
  });

  // The toggle renders during loading, so the placeholder has to follow it —
  // otherwise clicking "наложени" mid-fetch does nothing until the payload
  // lands, and the swap when it does is the shift all over again.
  it("follows the view toggle while pending, reserving the overlaid plot", async () => {
    pendingFetch();
    const { container } = renderPanel(<EuCompareWgiSmallMultiples />);
    await userEvent.click(
      screen.getByRole("button", { name: "eu_compare_wgi_view_overlaid" }),
    );
    expect(boxes(container, "h-[340px]")).toBe(1);
    expect(boxes(container, "h-[200px]")).toBe(0);
  });
});

describe("EuCompareWgiRadar", () => {
  it("reserves its plot while pending and collapses once settled empty", async () => {
    pendingFetch();
    const pendingRender = renderPanel(<EuCompareWgiRadar />);
    expect(boxes(pendingRender.container, "h-[340px]")).toBe(1);
    expect(pendingRender.container.textContent).not.toContain(
      "gov_macro_unavailable",
    );

    vi.restoreAllMocks();
    failedFetch();
    const settled = renderPanel(<EuCompareWgiRadar />);
    await waitFor(() =>
      expect(settled.container.textContent).toContain("gov_macro_unavailable"),
    );
    expect(boxes(settled.container, "h-[340px]")).toBe(0);
  });
});

describe("EuCompareSpendOutcomeScatters", () => {
  it("holds both cards at the plot's own height while pending", () => {
    pendingFetch();
    const { container } = renderPanel(<EuCompareSpendOutcomeScatters />);
    expect(boxes(container, "h-[220px]")).toBe(2);
    expect(container.textContent).not.toContain("gov_macro_unavailable");
  });

  it("collapses to the unavailable line once both queries have settled empty", async () => {
    failedFetch();
    const { container } = renderPanel(<EuCompareSpendOutcomeScatters />);
    await waitFor(() =>
      expect(container.textContent).toContain("gov_macro_unavailable"),
    );
    expect(boxes(container, "h-[220px]")).toBe(0);
  });
});

const reservedHeights = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLElement>("div[style]")]
    .map((d) => d.style.height)
    .filter(Boolean);

describe("EuCompareCofogMultiples", () => {
  it("reserves the chart's own height while pending", () => {
    pendingFetch();
    const { container } = renderPanel(<EuCompareCofogMultiples />);
    // 260 is the chart's viewBox height, read from the same constant the loaded
    // <svg height> uses — not a number chosen to match a screenshot.
    expect(reservedHeights(container)).toContain("260px");
    expect(container.textContent).not.toContain("gov_macro_unavailable");
  });

  it("collapses to the unavailable line once the query has settled empty", async () => {
    failedFetch();
    const { container } = renderPanel(<EuCompareCofogMultiples />);
    await waitFor(() =>
      expect(container.textContent).toContain("gov_macro_unavailable"),
    );
    expect(reservedHeights(container)).not.toContain("260px");
  });
});
