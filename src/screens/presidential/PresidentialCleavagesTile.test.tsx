// What this tile must never draw without.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresidentialCleavagesTile } from "./PresidentialCleavagesTile";
import type { PresidentialCleavages } from "@/data/presidential/usePresidentialCleavages";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** ⚠ THE ROWS CLEAR `selectCleavageRows`' 0.6 SPREAD THRESHOLD, or the tile self-hides and
 *  every assertion below asserts nothing. */
const cleavages = (over: Partial<PresidentialCleavages> = {}) =>
  ({
    cycle: "2021_11_14_pvr",
    round: 1,
    basis: "БЪЛГАРСКАТА ОГРАДА",
    basisEn: "THE ENGLISH CAVEAT",
    municipalities: 265,
    votes: 2394489,
    abroadVotes: 220660,
    unmappedVotes: 0,
    tickets: [
      {
        number: 6,
        president: "Румен Георгиев Радев",
        color: "#111",
        pctNational: 49.42,
      },
      {
        number: 17,
        president: "Мустафа Сали Карадайъ",
        color: "#222",
        pctNational: 11.57,
      },
    ],
    rows: [
      { metric: "ethnicBulgarian", rs: [0.86, -0.87], spread: 1.73 },
      { metric: "religionMuslim", rs: [-0.84, 0.88], spread: 1.72 },
    ],
    ...over,
  }) as PresidentialCleavages;

// ⚠ BOTH PROVIDERS. `Hint` is a Radix tooltip and Radix THROWS without its provider; and the
// shared plot reaches `useCanonicalParties`, which is a React Query hook — so a mount without a
// client throws „No QueryClient set" before any assertion runs and reports missing scaffolding
// as a broken tile.
const mount = (c: PresidentialCleavages) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <MemoryRouter>
        <TooltipProvider>
          <PresidentialCleavagesTile cleavages={c} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialCleavagesTile", () => {
  it("renders the ECOLOGICAL caveat from the artifact, above the plot", () => {
    // ⚠⚠ THE WHOLE POINT OF THE TILE. Every dot says municipalities with more of a
    // characteristic gave a pair a larger share, and NOT that those voters chose them —
    // and the sentence comes from the DATA so a producer change reaches the reader with the
    // chart rather than waiting for somebody to update a locale file.
    mount(cleavages());
    const caveat = screen.getByText("БЪЛГАРСКАТА ОГРАДА");
    expect(caveat).toBeTruthy();
    // ABOVE the plot: a reader who stops at the picture has still read the qualification.
    const plot = document.querySelector(".flex.flex-wrap") as HTMLElement;
    expect(
      caveat.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("switches to the artifact's ENGLISH caveat", async () => {
    await i18n.changeLanguage("en");
    mount(cleavages());
    expect(screen.getByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
  });

  it("says the dots are PAIRS above a readability cut, not parties above a legal threshold", () => {
    // ⚠ THE FOOT NOTE IS BALLOT-SPECIFIC. The plot's default says „Всяка точка е ПАРТИЯ,
    // преминала прага от 4%" — two statements that are simply false here, and a tile that
    // renders correctly with the wrong noun is this family's stated failure mode.
    mount(cleavages());
    expect(screen.getByText(/Всяка точка е двойка/)).toBeTruthy();
    expect(screen.queryByText(/Всяка точка е партия/)).toBeNull();
  });

  it("makes every row INERT — the census explorer is about a different ballot", () => {
    // `/demographics` plots census against PARTY vote for the SELECTED PARLIAMENTARY election.
    const { container } = mount(cleavages());
    expect(container.querySelectorAll('a[href^="/demographics"]').length).toBe(
      0,
    );
  });

  it("names the correlated base, and suppresses the unplaced clause at zero", () => {
    mount(cleavages());
    expect(screen.getByText(/265/)).toBeTruthy();
    expect(screen.queryByText(/не е установена/)).toBeNull();
  });

  it("names the unplaced residue when there is one", () => {
    // ⚠ THE MUTATION CHECK for the clause above. It is 0 on all ten committed artifacts, so a
    // clause that had silently stopped rendering passes on every one of them — and the field
    // exists precisely because it may not stay 0.
    mount(cleavages({ unmappedVotes: 441328 }));
    expect(screen.getByText(/не е установена/)).toBeTruthy();
  });

  it("renders NOTHING when no row clears the spread threshold", () => {
    // `selectCleavageRows` keeps headline cleavages above 0.6 plus a pinned sex and age band;
    // with neither, a card with a heading and an empty track states nothing.
    const { container } = mount(
      cleavages({
        rows: [{ metric: "eduTertiary", rs: [0.05, 0.04], spread: 0.01 }],
      }),
    );
    expect(container.textContent).toBe("");
  });
});
