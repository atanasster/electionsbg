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
import bg from "@/locales/bg/translation.json";
import type { LocalKmetstvoResult, LocalMayorResult } from "@/data/local/types";
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
  };
} = { current: { name: null, kmetstvo: null } };
const chmi: { current: ChmiHistoryEvent[] } = { current: [] };
const byElectionKmetstva: { current: LocalKmetstvoResult[] } = { current: [] };

vi.mock("@/data/local/useLocalSettlement", () => ({
  useLocalSettlement: () => ({
    name: settlement.current.name,
    kmetstvoObshtina: "SOF",
    // A partial cycle's folder holds only the municipalities that voted, so the
    // village's own район shard is legitimately absent — the real chmi shape.
    municipality: null,
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
});
