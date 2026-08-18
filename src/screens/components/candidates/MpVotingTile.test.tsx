// The caption under the voting tile. It prints the chamber's item count directly beside
// "подадени гласове 17", and for a member who left the bench mid-term those two numbers sit
// on different denominators — a reader who divides one by the other gets 1.4% for someone
// who was present for 17 of the 32 votes held while they held the seat. The clause naming
// the seated window is what stops that arithmetic, so it needs a test on both sides of its
// boundary: present when the window is shorter, absent when the member sat the full term.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MpShard } from "@/data/parliament/votes/types";

const loyaltyHook = vi.fn();
const attendanceHook = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolates only the one key under test, so the assertion can read the rendered
    // sentence rather than a key plus a detached number.
    t: (k: string, o?: Record<string, unknown>) =>
      o && "seated" in o ? `от тях ${o.seated} по време на мандата` : k,
    i18n: { language: "bg" },
  }),
}));
vi.mock("@/data/parliament/useMps", () => ({
  useMps: () => ({
    findMpByName: () => ({ id: 3996 }),
    isLoading: false,
  }),
}));
vi.mock("@/data/parliament/votes/useMpLoyalty", () => ({
  useMpLoyalty: () => loyaltyHook(),
}));
vi.mock("@/data/parliament/votes/useAttendance", () => ({
  useAttendance: (...a: unknown[]) => attendanceHook(...a),
}));
// Keeps the tile's own fetches out: the sessions list and the dissents section are not
// what this file is about, and both would need a router.
vi.mock("@/data/parliament/votes/useRollcallIndex", () => ({
  useRollcallIndex: () => ({ sessions: [] }),
}));
vi.mock("./MpDissentsSection", () => ({ MpDissentsSection: () => null }));

import { MpVotingTile } from "./MpVotingTile";

const CHAMBER_ITEMS = 1198;
const entry = {
  mpId: 3996,
  partyShort: "ПБ",
  votesCast: 17,
  withParty: 17,
  loyaltyPct: 1,
};
const file = {
  windowFrom: "2026-04-30",
  windowTo: "2026-07-31",
  totalVoteItems: CHAMBER_ITEMS,
  entries: [],
};

const show = (seatedItems: number | null, viaShard = true) => {
  const shard = (
    seatedItems != null && viaShard
      ? {
          mpId: 3996,
          attendance: {
            totalItems: seatedItems,
            presentCount: 17,
            absentCount: seatedItems - 17,
            presentPct: 17 / seatedItems,
          },
        }
      : { mpId: 3996 }
  ) as MpShard;
  loyaltyHook.mockReturnValue({ entry, file, shard, isLoading: false });
  attendanceHook.mockImplementation((enabled?: boolean) => ({
    byMpId: new Map(
      seatedItems != null && !viaShard
        ? [
            [
              3996,
              {
                mpId: 3996,
                partyShort: "ПБ",
                totalItems: seatedItems,
                presentCount: 17,
                absentCount: seatedItems - 17,
                presentPct: 17 / seatedItems,
              },
            ],
          ]
        : [],
    ),
    entries: [],
    isLoading: false,
    enabled,
  }));
  return render(<MpVotingTile name="ИВАН ПЕТЕВ ДЕМЕРДЖИЕВ" />);
};

const caption = () => screen.getByText(/mp_voting_window/).textContent ?? "";

beforeEach(() => {
  loyaltyHook.mockReset();
  attendanceHook.mockReset();
});

describe("MpVotingTile — seated-window caption", () => {
  it("names the seated window when it is shorter than the chamber's", () => {
    show(32);
    expect(caption()).toContain("1198");
    expect(caption()).toContain("от тях 32 по време на мандата");
  });

  it("omits the clause for a member who sat the full term", () => {
    // The `<` boundary specifically: an `!==` would get the equal case wrong and append
    // "of which 1198 during their term" to every full-term MP on the site.
    show(CHAMBER_ITEMS);
    expect(caption()).toContain("1198");
    expect(caption()).not.toContain("от тях");
  });

  it("recovers the window from the aggregate when the shard has none", () => {
    // The shardless path is the one the caption fix originally missed, and the one where
    // the misleading juxtaposition survived.
    show(32, false);
    expect(attendanceHook).toHaveBeenCalledWith(true);
    expect(caption()).toContain("от тях 32 по време на мандата");
  });

  it("does not fetch the aggregate when the shard already carries the window", () => {
    show(32);
    expect(attendanceHook).toHaveBeenCalledWith(false);
  });
});
