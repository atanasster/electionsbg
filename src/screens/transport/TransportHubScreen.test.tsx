// Mounts the real hub: once with no blob (a checkout that never ran the
// generator — must render cleanly, no zeros) and once with the committed blob.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TransportHubScreen } from "./TransportHubScreen";
import { TRANSPORT_HUB_COPY, TRANSPORT_TILES } from "./transportRegistry";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/transport/derived/hub_stats.json"),
    "utf8",
  ),
);

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/sector/transport"]}>
        <TransportHubScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("TransportHubScreen", () => {
  it("renders every tile and no band without a blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => null })),
    );
    const { container } = mount();
    for (const t of TRANSPORT_TILES)
      expect(
        await screen.findByText(TRANSPORT_HUB_COPY[t.titleKey].en),
      ).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(0),
    );
  });

  it("renders four KPI cells from the blob, under one h1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("transport/derived/hub_stats.json")
          ? { ok: true, status: 200, json: async () => blob }
          : { ok: false, status: 404, json: async () => null },
      ),
    );
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(4),
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The roads cross-link sits in the footer, never in the band.
    expect(container.querySelector('a[href="/sector/roads"]')).toBeTruthy();
  });

  it("says the figures did not load when the blob request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
    );
    mount();
    expect(
      await screen.findByText(/summary figures could not be loaded/),
    ).toBeTruthy();
  });
});
