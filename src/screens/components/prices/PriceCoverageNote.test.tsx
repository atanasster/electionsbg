// Plan T4. The note that tells a reader a level figure was built on a thin day.
//
// The property that matters most is the negative one: ABSENT coverage must not
// be read as complete. A payload built before T4 carries no `coverage` at all,
// and React Query holds blobs at staleTime Infinity, so one can outlive a
// deploy — vouching for it would be the silent half of this feature. The
// producer side is gated separately, in
// scripts/db/tests/prices_last_seen.data.test.ts, because silence here is
// correct and therefore cannot catch a missing emit.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PriceCoverageNote } from "./PriceCoverageNote";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: lang }, t: (k: string) => k }),
}));

const ID = "price-coverage-note";
const thin = {
  chainsComplete: false,
  chains: 98,
  trailingMedian: 203.5,
  latestDate: "2026-08-14",
};

afterEach(() => {
  cleanup();
  lang = "bg";
});

describe("PriceCoverageNote", () => {
  it("says nothing when the day is complete", () => {
    render(<PriceCoverageNote coverage={{ ...thin, chainsComplete: true }} />);
    expect(screen.queryByTestId(ID)).toBeNull();
  });

  it("warns when the day is incomplete, naming the numbers and the day", () => {
    render(<PriceCoverageNote coverage={thin} />);
    const el = screen.getByTestId(ID);
    expect(el.textContent).toContain("непълни");
    // The figures are what make it checkable rather than a vague hedge.
    expect(el.textContent).toContain("98");
    expect(el.textContent).toContain("204"); // 203.5 rounded
    expect(el.textContent).toMatch(/2026|авг/i);
  });

  it("points at the index rather than ending on a hedge", () => {
    // With T3 reverted this is the actionable half: the index IS chain-matched,
    // so a reader who wants price CHANGE has somewhere correct to go.
    render(<PriceCoverageNote coverage={thin} />);
    expect(screen.getByTestId(ID).textContent).toContain("индекса");
  });

  it("does not claim a ranking on a single-place surface", () => {
    render(<PriceCoverageNote coverage={thin} basis="place" />);
    const el = screen.getByTestId(ID);
    expect(el.textContent).toContain("непълни");
    // No "ranking", no "between them" — this tile compares nothing.
    expect(el.textContent).not.toContain("Класирането");
    expect(el.textContent).toContain("магазин");
  });

  it("suppresses the detail rather than half of it", () => {
    // One number without its baseline is not a fact a reader can weigh.
    render(
      <PriceCoverageNote coverage={{ chainsComplete: false, chains: 98 }} />,
    );
    const el = screen.getByTestId(ID);
    expect(el.textContent).toContain("непълни");
    expect(el.textContent).not.toContain("98");
  });

  it("renders the English copy too", () => {
    lang = "en";
    render(<PriceCoverageNote coverage={thin} />);
    const el = screen.getByTestId(ID);
    expect(el.textContent).toContain("incomplete");
    expect(el.textContent).toContain("98");
    expect(el.textContent).toContain("index");
  });

  // ⚠️ The one that would be silent if wrong.
  it("does NOT vouch for a payload that carries no coverage", () => {
    render(<PriceCoverageNote coverage={undefined} />);
    expect(screen.queryByTestId(ID)).toBeNull();
  });

  it("treats an empty coverage object as unknown, not as complete", () => {
    render(<PriceCoverageNote coverage={{}} />);
    expect(screen.queryByTestId(ID)).toBeNull();
  });
});
