// The party badge's fallback chain, which is the only thing standing between a former MP
// and a profile with no party on it at all.
//
// Three sources, in strict precedence:
//   1. the newest election they contested WITH RESULTS  — a real, cycle-attributable party
//   2. `currentPartyGroupShort`                          — the CURRENT-NS roster's group
//   3. `electedWith`                                     — the coalition off their profile
//
// 1 and 2 are both current-cycle, so before 3 existed a former MP had nothing: 1,443 of the
// 2,122 roster entries, including everyone who left before the roll-call corpus starts.
//
// 3 is a CAREER badge and must stay one. parliament.bg holds a single value per person, and
// against the roll-call-derived per-NS group for the 72 MPs who changed group it matches the
// last NS 12 times, the first 4, both 17, and neither endpoint 27 — so it is never linked to
// an election the way sources 1 and 2 are.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MpIndexEntry } from "@/data/parliament/useMps";

const mpEntry = vi.fn();
const dataCycles = vi.fn();
const findParty = vi.fn();

vi.mock("@/data/parliament/useMpEntry", () => ({
  useMpEntry: () => mpEntry(),
}));
vi.mock("@/data/dashboard/usePersonElections", () => ({
  usePersonDataCycles: () => dataCycles(),
}));
vi.mock("@/data/parties/usePartyInfo", () => ({
  usePartyInfo: () => ({ findParty }),
}));
// Mirrors the REAL fold's behaviour on the real corpus, measured against the committed
// canonical_parties.json: "ГЕРБ" resolves (85 MPs carry it) and "Коалиция за България" does
// not (no key, no alias, no normalised nickname). An earlier version of this mock invented
// the opposite and pinned a mapping production never makes.
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({
    findCanonicalNickName: (s: string) => (s === "ГЕРБ" ? "ГЕРБ" : undefined),
    colorFor: (s: string) => (s === "ГЕРБ" ? "rgb(0, 82, 155)" : undefined),
    partyGroupShortLabel: (s?: string | null) =>
      s ? s.replace(/^ПГ\s+(на\s+)?/, "").replace(/["„“”]/g, "") : null,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
// The compact MP bio and the avatar are separate concerns with their own fetches.
vi.mock("@/screens/components/candidates/MpProfileHeader", () => ({
  MpProfileHeader: () => null,
}));
vi.mock("@/screens/components/candidates/MpAvatar", () => ({
  MpAvatar: () => null,
}));

import { PersonProfileHeader } from "./PersonProfileHeader";

const entry = (o: Partial<MpIndexEntry>) =>
  ({
    id: 868,
    name: "X",
    nsFolders: [],
    isCurrent: false,
    ...o,
  }) as MpIndexEntry;

const show = () =>
  render(
    <MemoryRouter>
      <PersonProfileHeader
        name="Сергей Дмитриевич Станишев"
        mpId={868}
        profile={null}
      />
    </MemoryRouter>,
  );

beforeEach(() => {
  mpEntry.mockReset();
  dataCycles.mockReset();
  findParty.mockReset();
  dataCycles.mockReturnValue({ rows: [], dataCycles: [] });
  mpEntry.mockReturnValue({ entry: undefined });
});

describe("PersonProfileHeader — party badge fallback", () => {
  it("falls back to electedWith for a former MP", () => {
    // Станишев: no candidacy with results, no current roster group. Before this, the header
    // showed no party at all. The fold does not know this coalition, so it renders as the
    // 2005 ballot printed it.
    mpEntry.mockReturnValue({
      entry: entry({ electedWith: "Коалиция за България" }),
    });
    show();
    expect(screen.getByText("Коалиция за България")).toBeInTheDocument();
  });

  it("keeps the register's own words rather than a later coalition brand", () => {
    // The fold resolves "ГЕРБ" to canonical id `gerb`, whose displayName is "ГЕРБ-СДС" — a
    // 2021 coalition. 85 MPs in the corpus were elected with "ГЕРБ" before it existed, and
    // relabelling them would state they stood for it. findCanonicalNickName returns the
    // slug form, not the current display name, which is why this stays "ГЕРБ".
    mpEntry.mockReturnValue({ entry: entry({ electedWith: "ГЕРБ" }) });
    show();
    expect(screen.getByText("ГЕРБ")).toBeInTheDocument();
    expect(screen.queryByText("ГЕРБ-СДС")).not.toBeInTheDocument();
  });

  it("qualifies the electedWith badge as such, and does NOT link it", () => {
    // Presence AND absence together: asserting only "no link" is satisfied by rendering
    // nothing at all — i.e. by the very regression this tier exists to fix.
    mpEntry.mockReturnValue({
      entry: entry({ electedWith: "Коалиция за България" }),
    });
    show();
    expect(screen.getByText("Коалиция за България")).toBeInTheDocument();
    // Said to the reader, not just in a code comment.
    expect(screen.getByText("pp_elected_with")).toBeInTheDocument();
    // No cycle to attribute it to → no /party?elections= link.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("prefers the sitting roster's group over electedWith", () => {
    // Stored raw as parliament.bg's group label; the same fold tier 3 uses strips the "ПГ"
    // prefix and the quoting, so a sitting MP no longer gets a worse badge than a former one.
    mpEntry.mockReturnValue({
      entry: entry({
        currentPartyGroupShort: 'ПГ "Прогресивна България"',
        electedWith: "Коалиция за България",
      }),
    });
    show();
    expect(screen.getByText("Прогресивна България")).toBeInTheDocument();
    expect(screen.queryByText("Коалиция за България")).not.toBeInTheDocument();
    // Tier 2 is a CURRENT affiliation, so it carries no "elected with" qualifier.
    expect(screen.queryByText("pp_elected_with")).not.toBeInTheDocument();
  });

  it("prefers a real candidacy result over both", () => {
    dataCycles.mockReturnValue({
      rows: [{ election: "2021_11_14", partyNum: 7 }],
      dataCycles: ["2021_11_14"],
    });
    findParty.mockReturnValue({
      nickName: "ПП",
      color: "#123456",
      name: "Продължаваме промяната",
    });
    mpEntry.mockReturnValue({
      entry: entry({
        currentPartyGroupShort: "ПП-ДБ",
        electedWith: "Коалиция за България",
      }),
    });
    show();
    expect(screen.getByText("ПП")).toBeInTheDocument();
    // …and THAT one does link, with its cycle.
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("shows no badge at all when no source has a party", () => {
    mpEntry.mockReturnValue({ entry: entry({}) });
    const { container } = show();
    expect(container.querySelector("h1")).toBeInTheDocument();
    expect(screen.queryByText("pp_elected_with")).not.toBeInTheDocument();
  });

  it("treats an EMPTY group short as no party, not as a value", () => {
    // `toMp` emits "" for a member parliament.bg lists with no group (an independent) and
    // the loader stores it verbatim. `??` does not fall through on "", so the chain would
    // stop there and the badge would vanish — for exactly the people tier 3 is for.
    mpEntry.mockReturnValue({
      entry: entry({
        currentPartyGroupShort: "",
        electedWith: "Коалиция за България",
      }),
    });
    show();
    expect(screen.getByText("Коалиция за България")).toBeInTheDocument();
  });

  it("degrades to no badge for a non-MP", () => {
    // useMpEntry is disabled without an mpId, so `entry` is undefined and nothing in the
    // chain may reach for electedWith.
    mpEntry.mockReturnValue({ entry: undefined });
    render(
      <MemoryRouter>
        <PersonProfileHeader name="Търговец" mpId={null} profile={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("pp_elected_with")).not.toBeInTheDocument();
  });
});
