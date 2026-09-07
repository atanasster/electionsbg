// What the tile claims about a number the roll-up does not carry.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresidentialTopRegionsTile } from "./PresidentialTopRegionsTile";
import type { RoundRollup } from "@/data/presidential/useRoundRollup";
import type { PresidentialTicket } from "@/data/presidential/useTickets";

vi.mock("@/data/regions/useRegions", () => ({
  useRegions: () => ({
    findRegion: (code: string) => ({ name: `обл. ${code}`, name_en: code }),
  }),
}));

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const ticket = (n: number, president: string): PresidentialTicket =>
  ({
    number: n,
    president,
    vicePresident: "—",
    nominatedBy: { name: "—", kind: "party" },
    color: "#123456",
  }) as PresidentialTicket;

const TICKETS = new Map([
  [6, ticket(6, "Радев")],
  [15, ticket(15, "Герджиков")],
]);

const rollup = (
  entries: { key: string; votes: [number, number][] }[],
): RoundRollup => ({
  coverage: { basis: "b", sections: 1, excludedSections: 0 },
  entries: entries.map((e) => ({
    key: e.key,
    results: {
      votes: e.votes.map(([partyNum, totalVotes]) => ({
        partyNum,
        totalVotes,
      })),
    },
  })),
});

const mount = (r: RoundRollup) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PresidentialTopRegionsTile
          cycle="2021_11_14_pvr"
          rollup={r}
          tickets={TICKETS}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

const rows = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.getAttribute("href")?.includes("/region/"));

describe("PresidentialTopRegionsTile", () => {
  it("ranks by votes cast and links each oblast to its own page", () => {
    mount(
      rollup([
        {
          key: "BGS",
          votes: [
            [6, 100],
            [15, 50],
          ],
        },
        {
          key: "VAR",
          votes: [
            [6, 400],
            [15, 100],
          ],
        },
        {
          key: "BLG",
          votes: [
            [6, 10],
            [15, 240],
          ],
        },
      ]),
    );
    expect(rows().map((a) => a.getAttribute("href"))).toEqual([
      "/presidential/2021_11_14_pvr/region/VAR",
      "/presidential/2021_11_14_pvr/region/BLG",
      "/presidential/2021_11_14_pvr/region/BGS",
    ]);
  });

  it("names the leader of each oblast, not the national one", () => {
    // ⚠ BLG's LEADER IS THE RUNNER-UP NATIONALLY. A tile that painted every row with the
    // national winner would look right on four cycles out of five and be a false statement
    // about a named place on the fifth.
    mount(
      rollup([
        {
          key: "BGS",
          votes: [
            [6, 100],
            [15, 50],
          ],
        },
        {
          key: "BLG",
          votes: [
            [6, 10],
            [15, 240],
          ],
        },
      ]),
    );
    const blg = rows().find((a) => a.getAttribute("href")?.endsWith("BLG"));
    expect(within(blg as HTMLElement).getByText("Герджиков")).toBeTruthy();
  });

  it("shows the share of the ROUND's ticket votes, and says so", () => {
    // 400 of 900 — and the caption has to say this is not turnout, because the roll-up carries
    // no protocol at all: „не подкрепям никого" and invalid ballots are outside every figure
    // here, and in 2021 round 1 the „никого" line alone is 56,720 votes.
    mount(
      rollup([
        {
          key: "VAR",
          votes: [
            [6, 400],
            [15, 100],
          ],
        },
        {
          key: "BGS",
          votes: [
            [6, 300],
            [15, 100],
          ],
        },
      ]),
    );
    const var_ = rows()[0];
    expect(within(var_).getByText("55,6%")).toBeTruthy();
    expect(screen.getByText(/не от избирателната активност/)).toBeTruthy();
  });

  it("gives an oblast that cast NOTHING no colour and no row", () => {
    // ⚠ `leadersByPlace`'s RULE, and the map's. Colouring an empty oblast would put a named
    // pair's colour on a place nobody voted in — and ranking it would put a 0 at the top of a
    // list of the largest.
    mount(
      rollup([
        {
          key: "VAR",
          votes: [
            [6, 400],
            [15, 100],
          ],
        },
        {
          key: "SML",
          votes: [
            [6, 0],
            [15, 0],
          ],
        },
      ]),
    );
    expect(rows().length).toBe(1);
    expect(screen.queryByText(/SML/)).toBeNull();
  });

  it("renders NOTHING when no oblast cast a vote", () => {
    const { container } = mount(rollup([{ key: "SML", votes: [[6, 0]] }]));
    expect(container.textContent).toBe("");
  });
});
