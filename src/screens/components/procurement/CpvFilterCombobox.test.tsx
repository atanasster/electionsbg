// WHEN the CPV catalogue is fetched — the only thing about this component that
// is invisible when it breaks.
//
// `/api/db/cpv-catalog` is the largest single payload on every page that carries
// a CPV filter: 363 KB decoded, 56 KB gzipped on the wire. Until 2026-07-31 four
// screens each called `useCpvCatalog()` at the top of their render, so every
// reader downloaded the whole thing whether or not they ever touched the filter.
// On /procurement/settlement/:ekatte that was two thirds of the page's first
// load — more than the entire page cost before the browser was added there.
//
// Nothing about the closed control depends on it (the 2-digit divisions it shows
// arrive free with the facet), so the regression is silent in both directions: an
// eager fetch looks identical to a lazy one on screen, and a lazy one that never
// arms looks identical until somebody searches. Hence a test on the REQUEST, not
// on the rendering.
//
// The three properties, and why each one is here:
//
//   1. CLOSED ⇒ NO FETCH. The whole point.
//   2. OPENED ⇒ FETCHED. A gate that never opens is a broken filter, not a fast
//      one — searching would silently fall back to the ~40 divisions.
//   3. A DEEP-LINKED FINE CODE ⇒ FETCHED ON MOUNT. `?cpv=38115100` renders its
//      name on the closed trigger, and that name exists nowhere else. Without
//      this exemption the button reads a bare "CPV 38115100" — a filter the
//      reader cannot identify, on a page they arrived at from a shared link.
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CpvFilterCombobox, CPV_ALL } from "./CpvFilterCombobox";

const CATALOG = [
  { cpv: "38115100", desc: "Оборудване за радарно наблюдение" },
  { cpv: "45231300", desc: "Строителни и монтажни работи по общо изграждане" },
];

/** Every URL this render fetched. */
let calls: string[] = [];

beforeEach(() => {
  // jsdom lacks both; cmdk's list touches them when the popover content mounts.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(CATALOG), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const catalogCalls = () =>
  calls.filter((u) => u.includes("/api/db/cpv-catalog"));

const renderCombobox = (value = CPV_ALL) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <CpvFilterCombobox
        value={value}
        onChange={() => {}}
        divisions={[{ value: "45", count: 12 }]}
      />
    </QueryClientProvider>,
  );

describe("CpvFilterCombobox", () => {
  it("does not fetch the catalogue while the picker is closed", async () => {
    renderCombobox();
    // The trigger renders from `divisions` alone — wait for it, then assert the
    // catalogue was never asked for. Asserting immediately would pass even on an
    // eager fetch that simply had not been issued yet.
    await screen.findByRole("combobox");
    expect(catalogCalls()).toHaveLength(0);
  });

  it("fetches the catalogue once the picker is opened", async () => {
    renderCombobox();
    await userEvent.click(await screen.findByRole("combobox"));
    await waitFor(() => expect(catalogCalls()).toHaveLength(1));
  });

  it("fetches on mount for a deep-linked fine code, to name it on the trigger", async () => {
    renderCombobox("38115100");
    await waitFor(() => expect(catalogCalls()).toHaveLength(1));
    expect(
      await screen.findByText(/Оборудване за радарно наблюдение/),
    ).toBeInTheDocument();
  });

  it("does not fetch on mount for a division, whose name comes from cpvSectors", async () => {
    // The /procurement/contractors case: ?cpv is normalised to a 2-digit division
    // on write, so that page never pays for the catalogue unless it is opened.
    renderCombobox("45");
    await screen.findByRole("combobox");
    expect(catalogCalls()).toHaveLength(0);
  });
});
