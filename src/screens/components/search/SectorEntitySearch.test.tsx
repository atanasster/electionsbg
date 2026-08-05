// The four behaviours that are DECISIONS in this component (see its header), and
// each of which is silent when it breaks:
//
//   1. Results are grouped and every row navigates to its own href.
//   2. Below the 2-character floor the list stays shut — a one-character query
//      matches most of a corpus.
//   3. The empty state NAMES what was searched. A bare "no results" leaves the
//      reader unsure whether the box even covers what they wanted.
//   4. `onArm` fires once, on first focus, so a caller can defer building a
//      large index until the reader has signalled intent.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildEntityIndex } from "@/lib/entitySearchIndex";

// Pin the language: the component picks bg/en labels off i18n, and the untouched
// default in tests is EN — which would quietly assert the wrong half.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { SectorEntitySearch } from "./SectorEntitySearch";
import { entityGroup } from "./entityGroups";

beforeEach(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

const HOSPITALS = [
  { id: "115576405", name: "УМБАЛ Свети Георги", place: "Пловдив", n: 40 },
  { id: "000090697", name: "МБАЛ Шумен", place: "Шумен", n: 20 },
];
const MOLECULES = [{ id: "PEMBROLIZUMAB", name: "PEMBROLIZUMAB", n: 25 }];

const hospitalIndex = () =>
  buildEntityIndex(
    HOSPITALS,
    (h) => ({
      id: h.id,
      label: h.name,
      sub: h.place,
      href: `/company/${h.id}`,
    }),
    (h) => [h.name, h.place, h.id],
    (h) => h.n,
  );

const moleculeIndex = () =>
  buildEntityIndex(
    MOLECULES,
    (m) => ({ id: m.id, label: m.name, href: `/molecule/${m.id}` }),
    (m) => [m.name],
    (m) => m.n,
  );

const setup = (opts?: { onArm?: () => void; loading?: boolean }) => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/sector/health"]}>
      <Routes>
        <Route
          path="/sector/health"
          element={
            <SectorEntitySearch
              idPrefix="test"
              groups={[
                entityGroup("hosp", "Болници", "Hospitals", hospitalIndex(), {
                  loading: opts?.loading,
                }),
                entityGroup("mol", "Молекули", "Molecules", moleculeIndex()),
              ]}
              title={{ bg: "Търсене", en: "Search" }}
              placeholder={{ bg: "болница, лекарство…", en: "hospital, drug…" }}
              hint={{ bg: "Търси в сектора", en: "Search this sector" }}
              onArm={opts?.onArm}
            />
          }
        />
        <Route path="/company/:eik" element={<div>КОМПАНИЯ</div>} />
        <Route path="/molecule/:inn" element={<div>МОЛЕКУЛА</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { user, input: screen.getByRole("combobox") };
};

describe("SectorEntitySearch", () => {
  it("groups results and labels each group", async () => {
    const { user, input } = setup();
    await user.type(input, "pembro");
    expect(screen.getByText("Молекули")).toBeInTheDocument();
    expect(screen.getByText("PEMBROLIZUMAB")).toBeInTheDocument();
  });

  it("navigates to the row's own href on select", async () => {
    const { user, input } = setup();
    await user.type(input, "sveti georgi");
    await user.click(screen.getByText("УМБАЛ Свети Георги"));
    expect(screen.getByText("КОМПАНИЯ")).toBeInTheDocument();
  });

  it("accepts shliokavitsa end to end", async () => {
    const { user, input } = setup();
    await user.type(input, "6umen");
    expect(screen.getByText("МБАЛ Шумен")).toBeInTheDocument();
  });

  it("matches a query spanning name and place", async () => {
    const { user, input } = setup();
    await user.type(input, "свети георги пловдив");
    expect(screen.getByText("УМБАЛ Свети Георги")).toBeInTheDocument();
  });

  it("returns nothing below the 2-character floor", async () => {
    const { user, input } = setup();
    await user.type(input, "у");
    expect(screen.queryByText("Болници")).not.toBeInTheDocument();
    await user.type(input, "м");
    expect(screen.getByText("Болници")).toBeInTheDocument();
  });

  it("names what was searched when nothing matches", async () => {
    const { user, input } = setup();
    await user.type(input, "zzzz");
    // The searched groups, so the reader can tell an empty result from a box
    // that never covered their entity.
    expect(screen.getByText(/болници/)).toBeInTheDocument();
    expect(screen.getByText(/молекули/)).toBeInTheDocument();
  });

  it("says loading rather than 'no matches' while a group is still fetching", async () => {
    const { user, input } = setup({ loading: true });
    await user.type(input, "zzzz");
    expect(screen.getByText("Зареждане…")).toBeInTheDocument();
  });

  it("fires onArm exactly once, on first focus", async () => {
    const onArm = vi.fn();
    const { user, input } = setup({ onArm });
    await user.click(input);
    await user.type(input, "ум");
    await user.tab();
    await user.click(input);
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it("does not fire onArm before the reader touches the box", () => {
    const onArm = vi.fn();
    setup({ onArm });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("arms on the first keystroke even if no focus event ever arrives", () => {
    // fireEvent.change, NOT userEvent.type: the latter clicks first, so it
    // focuses, so it arms through the onFocus path and would pass with this
    // fix reverted. Only a bare change event isolates the keystroke trigger.
    //
    // Why the trigger exists: focus is the natural signal but not a reliable
    // one — a non-frontmost window may never deliver one, and a reader can
    // arrive with the box already focused. Without it every index stays null
    // and the box answers "no matches" for every query. Reproduced in the
    // browser on a fresh /sector/health mount: clicked, typed, and the lazy
    // index was never requested.
    const onArm = vi.fn();
    const { input } = setup({ onArm });
    fireEvent.change(input, { target: { value: "ум" } });
    expect(onArm).toHaveBeenCalledTimes(1);
  });
});
