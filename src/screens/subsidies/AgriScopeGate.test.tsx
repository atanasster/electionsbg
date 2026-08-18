// The SHARED scope gate — the four states, tested once, for the seven /subsidies sub-pages
// that OFFER a scope.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY HERE AND NOT SEVEN TIMES. This is where the hub's own test used to carry its four-state
// coverage; step 7 turned /subsidies into a tile grid, so the states moved down to the pages
// that still fetch a payload. All seven render `<AgriScopeFallback>` — enforced by
// `scopeContract.test.ts`, whose exception for AgriScopeGate is granted on exactly that claim —
// so testing the component once covers all of them, and a per-page copy would be six restatements
// of one branch.
//
// SEVEN OF EIGHT. `/subsidies/coverage` is the eighth sub-page and offers no scope at all — it
// reads `useAgriOverview("all")` directly, so it sits outside both this component and
// `scopeContract.test.ts` (whose consumer set is „files rendering the shared picker"). Being
// outside the arrangement is what let it turn a failed fetch into „0 покрити финансови години"
// on the one page whose subject IS coverage; it now carries its own copy of the failure card.
// `/farm/:eik` is a second hand-rolled copy, outside the same glob.
//
// WHAT IS TESTED HERE IS THE RENDERING of each state. The DERIVATION — which query shape
// becomes which state — lives in `useAgriScope` and is tested in useAgriScope.test.tsx. That
// split matters: appending `|| paused` to the hook's `noData` term leaves every test in THIS
// file green.
//
// THE STATES ARE NOT INTERCHANGEABLE, which is the whole point of there being four:
//
//   ready   — the payload is in hand.
//   noData  — the fetch came back CARRYING NOTHING (a 404 or a 200-null), or the scope is
//             outside the corpus so no request was made. The ONLY state in which „ДФЗ
//             publishes nothing for this year" is a true sentence.
//   failed  — an error, or a PAUSED query (offline browser, backgrounded tab whose fetch
//             failed). No data, no error, not loading — the state that reads as „unpublished"
//             to any check that infers absence from the absence of an error.
//   loading — everything else.
//
// Folding failed/paused into noData is the defect this file guards: it tells a reader ДФЗ
// published nothing for a year, and then lists that same year among the published ones two
// lines below. Seen live before 52b242609f; re-introduced on /farm/:eik and on two of these
// sub-pages before steps 6b and 6c caught them.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AgriScopeState } from "@/data/agri/useAgriScope";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { AgriScopeFallback, AgriScopePicker } from "./AgriScopeGate";

const setScope = vi.fn();
const refetch = vi.fn();

const gate = (over: Partial<AgriScopeState> = {}): AgriScopeState =>
  ({
    scope: "ns",
    setScope,
    data: undefined,
    state: "loading",
    paused: false,
    refetch,
    ...over,
  }) as AgriScopeState;

// AgriScopeFallback is ROUTER-FREE — it renders no Link and reads no search param. The
// MemoryRouter below is for the picker tests only, where ScopeControl really does read
// `?pscope`. Wrapping the fallback in one too would suggest a coupling it does not have.
const at = (g: AgriScopeState) =>
  render(
    <AgriScopeFallback gate={g}>
      <p>THE PAGE</p>
    </AgriScopeFallback>,
  );

// i18next resolves nothing under vitest, so the component's own `bg` flag is false and the
// ENGLISH branch renders. Same convention as every other screen test in this module.
// vitest.setup.ts's afterEach restores SPIES, not standalone vi.fn() counters, so these
// would accumulate across the file and a `toHaveBeenCalledWith` could pass on an earlier
// test's call.
beforeEach(() => vi.clearAllMocks());

const page = () => screen.queryByText("THE PAGE");
const skeletons = () => document.querySelectorAll(".animate-pulse").length;

describe("AgriScopeFallback", () => {
  it("renders the page only when the payload is in hand", () => {
    at(gate({ state: "ready" }));
    expect(page()).toBeInTheDocument();
    expect(skeletons()).toBe(0);
  });

  it("claims 'no data' only when absence is known", () => {
    at(gate({ state: "noData", scope: "y:2019" }));
    expect(screen.getByText(/No subsidy data for 2019\./)).toBeInTheDocument();
    // …and says which years DO exist, so the reader learns something instead of hitting a
    // dead end. The list is derived, not spelled out here.
    expect(
      screen.getByText(new RegExp(AGRI_FINANCIAL_YEARS.join(", "))),
    ).toBeInTheDocument();
    expect(page()).toBeNull();
    expect(skeletons()).toBe(0);
  });

  it("does NOT claim 'no data' when the fetch failed", () => {
    at(gate({ state: "failed", scope: "y:2024" }));
    expect(screen.getByText(/failed to load/)).toBeInTheDocument();
    expect(screen.queryByText(/No subsidy data/)).toBeNull();
    expect(page()).toBeNull();
  });

  it("does NOT claim 'no data' when the query is paused, and offers no dead retry", () => {
    at(gate({ state: "failed", paused: true, scope: "y:2024" }));
    expect(screen.getByText(/waiting for the connection/)).toBeInTheDocument();
    expect(screen.queryByText(/No subsidy data/)).toBeNull();
    // React Query refuses to run a retry while paused and resumes by itself, so a button
    // here would do nothing but look like it might.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("offers a retry on a real failure, and it calls refetch", () => {
    at(gate({ state: "failed" }));
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton while loading, and does not mistake it for absence", () => {
    at(gate({ state: "loading" }));
    expect(skeletons()).toBeGreaterThan(0);
    expect(screen.queryByText(/No subsidy data/)).toBeNull();
    expect(page()).toBeNull();
  });

  it("offers the way out only when it would go somewhere", () => {
    // On a database where the loader never ran, the DEFAULT scope 404s too and this card
    // renders for „ns" itself — where an offer to switch to the scope already active is a
    // dead control.
    at(gate({ state: "noData", scope: "ns" }));
    expect(
      screen.queryByRole("button", { name: /Show the latest year/ }),
    ).toBeNull();

    at(gate({ state: "noData", scope: "y:2019" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Show the latest year/ }),
    );
    expect(setScope).toHaveBeenCalledWith("ns");
  });
});

describe("AgriScopePicker", () => {
  it("keeps showing an off-list year instead of silently moving the reader", () => {
    // The other half of this module's scope arrangement, and the reason its narrowed picker
    // is allowed to read `?pscope` unresolved at all (see NAMES_THE_GAP in
    // scopeContract.test.ts). 2019 is a valid procurement scope and is NOT in the CAP corpus,
    // so it arrives here on ordinary in-app links. The picker must display it — a control
    // that quietly snapped to 2025 would leave the pill and the „no data for 2019" card
    // below it describing two different windows.
    //
    // Radix renders a controlled Select whose value matches no item as EMPTY, not as the
    // placeholder, which is why ScopeControl prints the year explicitly rather than relying
    // on item lookup. This asserts the printed year, which is the part that was blank.
    render(
      <MemoryRouter initialEntries={["/subsidies/recipients?pscope=y:2019"]}>
        <AgriScopePicker />
      </MemoryRouter>,
    );
    expect(screen.getByText("2019")).toBeInTheDocument();
  });

  it("relabels the default pill for a corpus with no per-parliament slice", () => {
    // „ns" is meaningless here, so the pill says „Latest year" instead of the procurement
    // wording. WHICH year that resolves to is `agriScopeToKey`'s contract — the control
    // renders no year at all in this state, so this test cannot and does not claim one.
    render(
      <MemoryRouter initialEntries={["/subsidies/recipients"]}>
        <AgriScopePicker />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Latest year/)).toBeInTheDocument();
    expect(
      screen.queryByText(/This parliament|procurement_scope_this_ns/),
    ).toBeNull();
  });
});
