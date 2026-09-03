// A contest held at a PARTIAL cycle must never be labelled „редовен вот".
//
// The defect this pins: `featuredKind` was derived as "is there a NEWER
// by-election superseding this one?" — which is a different question from "what
// kind of vote was this?". On a chmi-cycle page there is no newer event by
// construction, so every by-election fell through to "regular" and
// /local/2024_10_20_chmi/settlement/44063 announced с. Лозен's частичен избор as
// „Кмет на кметство · редовен вот · 20.10.2024".
//
// Asserted against the REAL Bulgarian dictionary rather than translation keys,
// because „редовен" is the word a reader sees and the word the bug produced. The
// regular-cycle case is asserted too — without it a component that had simply
// stopped rendering the badge would pass.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bgCorpus as bg } from "@/locales/allKeys";
import type {
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";

const dict = bg as Record<string, string>;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      (dict[k] ?? k).replace(/\{\{(\w+)\}\}/g, (m, name) =>
        vars && name in vars ? String(vars[name]) : m,
      ),
    i18n: { language: "bg" },
  }),
}));

// Connected avatar — downloads parliament/index.json. Irrelevant here.
vi.mock("@/screens/components/candidates/MpAvatar", () => ({
  MpAvatar: () => null,
}));
// Reached only once a parent município bundle exists (the §item-2 block below), and it opens a
// React Query of its own — irrelevant to what is gated here, same as MpAvatar above.
vi.mock("@/screens/myarea/MyAreaMayorPayTile", () => ({
  MayorPayCard: () => null,
}));
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({
    colorFor: () => "#888888",
    displayNameForId: (id: string) => id,
  }),
}));

const settlement: {
  current: {
    name: string | null;
    kmetstvo: LocalKmetstvoResult | null;
    /** The parent município bundle. `null` is the PARTIAL-cycle shape the contest-kind tests
     *  below rely on — a chmi folder holds only the municipalities that voted. */
    municipality?: LocalMunicipalityBundle | null;
  };
} = { current: { name: null, kmetstvo: null, municipality: null } };
const chmi: { current: ChmiHistoryEvent[] } = { current: [] };
const byElectionKmetstva: { current: LocalKmetstvoResult[] } = { current: [] };

vi.mock("@/data/local/useLocalSettlement", () => ({
  useLocalSettlement: () => ({
    name: settlement.current.name,
    kmetstvoObshtina: "SOF",
    // A partial cycle's folder holds only the municipalities that voted, so the
    // village's own район shard is legitimately absent — the real chmi shape.
    municipality: settlement.current.municipality ?? null,
    kmetstvo: settlement.current.kmetstvo,
    isLoading: false,
  }),
}));
vi.mock("@/data/local/useLocalMunicipality", () => ({
  useLocalMunicipality: () => ({
    municipality: byElectionKmetstva.current.length
      ? { kmetstva: byElectionKmetstva.current }
      : undefined,
  }),
}));
vi.mock("@/data/local/useChmiHistory", () => ({
  useChmiHistory: () => chmi.current,
}));
vi.mock("@/data/local/useLocalPlaceTrends", () => ({
  useLocalPlaceTrend: () => ({ data: undefined }),
}));

import { LocalSettlementDashboardCards } from "./LocalSettlementDashboardCards";

const candidate = (
  candidateName: string,
  over: Partial<LocalMayorResult> = {},
): LocalMayorResult => ({
  candidateName,
  localPartyNum: 1,
  localPartyName: "ГЕРБ",
  primaryCanonicalId: "gerb",
  memberCanonicalIds: [],
  isIndependent: false,
  round: 1,
  votes: 300,
  pctOfValid: 61.2,
  isElected: true,
  ...over,
});

const race = (winner: string): LocalKmetstvoResult => ({
  kmetstvoName: "Лозен",
  ekatte: "44063",
  candidates: [candidate(winner), candidate("Друг", { isElected: false })],
  elected: candidate(winner),
});

const event = (date: string, cycle: string): ChmiHistoryEvent => ({
  cycle,
  date,
  kind: "kmetstvo_mayor",
  obshtinaCode: "SOF",
  obshtinaName: "Столична",
  kmetstvoName: "Лозен",
  candidateName: "Нов Кмет",
  localPartyName: "ГЕРБ",
  primaryCanonicalId: "gerb",
  isIndependent: false,
  round: 1,
  pctOfValid: 55,
  votes: 250,
});

const renderCards = (cycle: string) =>
  render(
    <MemoryRouter>
      <LocalSettlementDashboardCards ekatte="44063" cycle={cycle} />
    </MemoryRouter>,
  ).container;

describe("LocalSettlementDashboardCards — contest kind", () => {
  it("labels a chmi-cycle contest частичен, never редовен", () => {
    settlement.current = {
      name: "Лозен",
      kmetstvo: race("ВАСИЛ ЛЮБОМИРОВ СТАНЧЕВ"),
    };
    chmi.current = [];
    byElectionKmetstva.current = [];

    const container = renderCards("2024_10_20_chmi");

    expect(
      screen.getByText(/частичен избор · 20\.10\.2024/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/редовен/);
  });

  // Guards the assertion above against going vacuous: the badge is still
  // rendered, and a genuinely regular cycle still says so.
  it("still labels a regular-cycle contest редовен", () => {
    settlement.current = {
      name: "Лозен",
      kmetstvo: race("ВАСИЛ ЛЮБОМИРОВ СТАНЧЕВ"),
    };
    chmi.current = [];
    byElectionKmetstva.current = [];

    const container = renderCards("2023_10_29_mi");

    expect(screen.getByText(/редовен вот · 29\.10\.2023/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/частичен/);
  });

  // The "Предишни избори" list had the same hardcoded kind, and on a chmi cycle
  // the chmi feed already carries that same vote — so the row must appear once,
  // as частичен.
  it("lists a superseded chmi-cycle contest once, as частичен", () => {
    settlement.current = {
      name: "Лозен",
      kmetstvo: race("ВАСИЛ ЛЮБОМИРОВ СТАНЧЕВ"),
    };
    chmi.current = [
      event("2024-10-20", "2024_10_20_chmi"), // the cycle being viewed
      event("2026-06-14", "2026_06_14_chmi"), // supersedes it
    ];
    byElectionKmetstva.current = [race("НОВ КМЕТ")];

    const container = renderCards("2024_10_20_chmi");

    // Headline is the newer by-election…
    expect(
      screen.getByText(/частичен избор · 14\.06\.2026/),
    ).toBeInTheDocument();
    // …and the viewed cycle drops to the previous list exactly once.
    expect(screen.getAllByText("20.10.2024")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/редовен/);
  });

  // "Предишни избори" claims to be newest-first, and the viewed cycle is NOT
  // necessarily the oldest row: `useChmiHistory` cuts off on the selected
  // PARLIAMENTARY election with no lower bound, so a кметство's by-elections
  // from before this cycle are in the shard. Sorting the feed and then appending
  // the viewed cycle put с. Трояново's 2021 by-election above its 2023 regular
  // vote — 18 кметства in the committed corpus render that shape.
  it("lists previous contests newest-first, including a pre-cycle by-election", () => {
    settlement.current = {
      name: "Лозен",
      kmetstvo: race("РЕДОВЕН КМЕТ"),
    };
    chmi.current = [
      event("2021-02-28", "2021_02_28_chmi"), // BEFORE the viewed regular cycle
      event("2024-10-20", "2024_10_20_chmi"), // supersedes it
    ];
    byElectionKmetstva.current = [race("НОВ КМЕТ")];

    const container = renderCards("2023_10_29_mi");
    const text = container.textContent ?? "";

    expect(text).toContain("29.10.2023");
    expect(text).toContain("28.02.2021");
    expect(text.indexOf("29.10.2023")).toBeLessThan(text.indexOf("28.02.2021"));
  });
});

// ─── §Phase 6 item 2: the settlement-mayor contest, and what stands in for it ────────────────

const bundle = (
  over: Partial<LocalMunicipalityBundle> = {},
): LocalMunicipalityBundle => ({
  cycle: "2023_10_29_mi",
  oikCode: "2301",
  obshtinaCode: "SOF",
  obshtinaName: "Столична",
  oblastName: "София (столица)",
  protocol: {
    numRegisteredVoters: 1000,
    totalActualVoters: 500,
    numValidVotes: 480,
  },
  // ⚠ NOT „Кмет На Общината", WHICH IS HOW THIS GATE WENT VACUOUS ONCE. „Общината" has
  // „Община" as a prefix, so a fixture name containing it satisfies the label assertion below
  // on its own — measured: with that name, deleting `local_settlement_parent_municipality`
  // from the card left the suite green. The fixture must not contain the string being gated.
  mayor: {
    round1: [candidate("Мария Иванова")],
    elected: candidate("Мария Иванова"),
  },
  council: [
    {
      localPartyNum: 1,
      localPartyName: "ГЕРБ",
      primaryCanonicalId: "gerb",
      memberCanonicalIds: [],
      isIndependent: false,
      totalVotes: 200,
      pctOfValid: 41.7,
      mandatesWon: 17,
      candidates: [],
    },
  ],
  kmetstva: [],
  districts: [],
  ...over,
});

/** `StatCard`'s own shell — the card, not whatever rounded ancestor happens to enclose it.
 *
 *  ⚠ THIS SELECTOR IS THE TEST. A loose `[class*='rounded']` climbs to a page-level wrapper
 *  that contains every card, so "the label is in the same card as the figure" degrades to "the
 *  label is somewhere on the page" — and the probe that deletes the label passes. Measured:
 *  with the loose selector, removing `local_settlement_parent_municipality` left the suite
 *  green. */
const CARD = ".rounded-xl.border.bg-card";

const noKmetstvo = () => {
  settlement.current = {
    name: "Лозен",
    kmetstvo: null,
    municipality: bundle(),
  };
  chmi.current = [];
  byElectionKmetstva.current = [];
};

describe("a settlement with no кметство of its own", () => {
  // ⚠ THE RULE HAS TWO HALVES AND ONLY ONE IS OBVIOUS. Not rendering an absent contest is the
  // easy half; the hard half is that what replaces it must not read as this settlement's own
  // result. The parent município's mayor and council sit on the page either way, and unlabelled
  // they say „this village elected a 17-seat council" about a place that elects no council.

  it("explains the absence in words, and names who governs instead", () => {
    noKmetstvo();
    renderCards("2023_10_29_mi");
    const note = screen.getByText(/няма собствено кметство/i);
    // ⚠ THE MUNICIPALITY IS NAMED IN THE SENTENCE ITSELF, not merely somewhere on the page —
    // the sentence raises the question "then who governs it?" and has to answer it. The parent
    // card lower down also says „Столична", which is why this reads the note's own text.
    expect(note.textContent).toContain("Столична");
  });

  it("labels the parent município's council AS the município's", () => {
    noKmetstvo();
    renderCards("2023_10_29_mi");
    // ⚠ SAME CARD, NOT SAME PAGE. A layout that puts the seat count in one card and the word
    // „Община" in another is exactly what makes 17 read as this village's council, so this
    // walks up from the FIGURE to its own StatCard and requires the label inside it.
    const card = screen.getByText("17").closest(CARD);
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(
      dict.local_settlement_parent_municipality,
    );
    expect(card!.textContent).toContain("Столична");
  });

  it("renders NO settlement-mayor contest — not an empty one", () => {
    noKmetstvo();
    const c = renderCards("2023_10_29_mi");
    // ⚠ A ZERO WOULD BE A CLAIM. „0 гласа", or an empty candidate table beside „Кмет на
    // кметство", says the contest happened and nobody stood — about a village where it was
    // never held. The heading may stand (it hosts the explanation); a RESULT must not.
    expect(c.textContent).not.toMatch(/редовен вот|частичен избор/);
    expect(screen.queryByText("61.2%")).toBeNull();
  });

  it("still renders the contest when the ballot DID exist", () => {
    // ⚠ THE DISCRIMINATING HALF. Without it a component that had stopped rendering the кметство
    // race entirely passes all three tests above — the explanation is what it falls back to.
    settlement.current = {
      name: "Лозен",
      kmetstvo: race("Стар Кмет"),
      municipality: bundle(),
    };
    chmi.current = [];
    byElectionKmetstva.current = [];
    const c = renderCards("2023_10_29_mi");
    expect(c.textContent).toContain("Стар Кмет");
    expect(screen.queryByText(/няма собствено кметство/i)).toBeNull();
  });
});
