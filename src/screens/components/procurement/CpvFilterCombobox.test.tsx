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
// The four properties, and why each one is here:
//
//   1. CLOSED ⇒ NO FETCH. The whole point.
//   2. OPENED ⇒ FETCHED. A gate that never opens is a broken filter, not a fast
//      one — searching would silently fall back to the ~40 divisions.
//   3. HOVER ⇒ FETCHED, STILL CLOSED. The arming that makes the lazy version feel
//      identical to the eager one for a mouse user.
//   4. A DEEP-LINKED FULL CODE ⇒ FETCHED ON MOUNT, and ONLY a full code.
//      `?cpv=38115100` renders its name on the closed trigger and that name exists
//      nowhere else, so it is worth an eager fetch. The same `?cpv` also carries
//      divisions, prefixes and comma-sets, which the catalogue cannot name at all —
//      they must NOT trigger it, or the exemption quietly restores the eager fetch
//      for the shared-link case this component was written for.
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

  // `?cpv` is a division / prefix / comma-set, not only a full code — and the
  // catalogue can name NONE of the latter two: every one of its 3,606 keys is an
  // 8-digit code, so `catalogByCode.get("45,50")` misses and the trigger reads a
  // bare "CPV 45,50" whether or not the fetch happened. An exemption looser than
  // /^\d{8}$/ therefore pays the eager fetch and buys nothing — silently undoing
  // this component's whole point for the shared-link case it was written for.
  it.each([
    ["a comma-joined set", "45,50"],
    ["a short prefix", "451"],
  ])(
    "does not fetch on mount for %s, which it could not name anyway",
    async (_label, value) => {
      renderCombobox(value);
      await screen.findByRole("combobox");
      expect(catalogCalls()).toHaveLength(0);
    },
  );

  it("arms the fetch on hover, before the picker is ever opened", async () => {
    // The headline UX of the lazy change: the request overlaps a mouse user's
    // reach, so the list is already there on click. It is one prop, trivially
    // dropped in a refactor, and losing it degrades every mouse user to the
    // touch/keyboard "loading note" path with nothing failing.
    renderCombobox();
    await userEvent.hover(await screen.findByRole("combobox"));
    await waitFor(() => expect(catalogCalls()).toHaveLength(1));
    // …and the popover genuinely never opened. Asserted through the DOM rather
    // than the input's placeholder: i18n is not initialised in this environment,
    // so which language that string is in is not something to depend on.
    expect(document.querySelector("[cmdk-input]")).toBeNull();
  });
});
