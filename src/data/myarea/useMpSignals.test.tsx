// The My-Area strip's presence badge, which carried half of the seated-window fix and had
// no test at all. It is the surface that both mislabelled a minister — "присъствие 1%" for
// a member who cast 17 of the 32 votes held while they held the seat — and TINTED them rose
// for it, so the badge is a judgement and not merely a figure.
//
// Three behaviours here are new and none of them is observable anywhere else: the rate is
// measured over the member's own window, `severe` is gated on that window being long enough
// to judge, and the badge now survives a missing loyalty slice (the two files are fetched
// independently, so either can arrive first).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AttendanceEntry } from "@/data/parliament/votes/types";

const attendanceHook = vi.fn();

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
// Only the HOOK is stubbed — ATTENDANCE_MIN_ITEMS stays the real export, so a change to the
// floor moves these tests rather than sliding past them.
vi.mock("@/data/parliament/votes/useAttendance", async (orig) => {
  const actual =
    await orig<typeof import("@/data/parliament/votes/useAttendance")>();
  return { ...actual, useAttendance: () => attendanceHook() };
});

import { useMpSignals } from "./useMpSignals";
import { ATTENDANCE_MIN_ITEMS } from "@/data/parliament/votes/useAttendance";

// Иван Демерджиев's real numbers in the 52nd (mp 3996): seated for 32 of the chamber's
// 1,198 items, cast 17. 17/32 = 53%; 17/1198 = 1%.
const MP = 3996;
const CHAMBER_ITEMS = 1198;

const attendance = (
  totalItems: number,
  presentCount: number,
): AttendanceEntry => ({
  mpId: MP,
  partyShort: "ПБ",
  totalItems,
  presentCount,
  absentCount: totalItems - presentCount,
  presentPct: totalItems === 0 ? 0 : presentCount / totalItems,
});

const setAttendance = (e: AttendanceEntry | null) =>
  attendanceHook.mockReturnValue({
    byMpId: new Map(e ? [[e.mpId, e]] : []),
    entries: e ? [e] : [],
    isLoading: false,
  });

const loyaltyFile = (loyaltyPct = 1) => ({
  computedAt: "2026-08-11T18:25:58.006Z",
  byNs: {
    "52": {
      windowFrom: "2026-04-30",
      windowTo: "2026-07-31",
      totalVoteItems: CHAMBER_ITEMS,
      entries: [
        {
          mpId: MP,
          partyShort: "ПБ",
          votesCast: 17,
          withParty: 17,
          loyaltyPct,
        },
      ],
    },
  },
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const run = async () => {
  const { result, rerender } = renderHook(() => useMpSignals([MP]), {
    wrapper,
  });
  // The loyalty half is a real useQuery; let it settle so the dissent arm is exercised too.
  await vi.waitFor(() => {
    if (result.current.isLoading) throw new Error("pending");
  });
  rerender();
  return result.current.byMpId.get(MP)!;
};

beforeEach(() => {
  attendanceHook.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => loyaltyFile(),
    })),
  );
});

describe("useMpSignals", () => {
  it("measures presence over the seated window, not over the chamber", async () => {
    setAttendance(attendance(32, 17));
    const sig = await run();
    expect(sig.attendance?.label_bg).toBe("присъствие 53%");
    expect(sig.attendance?.label_en).toBe("attendance 53%");
    // The regression, named. 17/1198 rounds to 1% — the figure this surface published
    // beside a named minister, with the rose tint on it.
    expect(sig.attendance?.label_bg).not.toBe("присъствие 1%");
  });

  it("does not tint a window too short to judge", async () => {
    // A replacement MP sworn in for the term's last sitting day: one item, missed. 0% is
    // true and is evidence of nothing.
    setAttendance(attendance(1, 0));
    const sig = await run();
    expect(sig.attendance?.attendance).toBe(0);
    expect(sig.attendance?.severe).toBe(false);
  });

  it("tints the SAME 0% once the window reaches the floor", async () => {
    // Mutation guard: the gate must be the window, not the value. Without this the test
    // above is also satisfied by a hook that stopped tinting altogether.
    setAttendance(attendance(ATTENDANCE_MIN_ITEMS, 0));
    const sig = await run();
    expect(sig.attendance?.attendance).toBe(0);
    expect(sig.attendance?.severe).toBe(true);
  });

  it("still emits the presence badge when the loyalty slice has not arrived", async () => {
    // Two independent chamber-wide fetches; either can land first. Before the rewrite a
    // missing loyalty slice returned EMPTY for every MP and the badge never appeared.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    setAttendance(attendance(32, 17));
    const sig = await run();
    expect(sig.attendance?.label_bg).toBe("присъствие 53%");
    expect(sig.dissent).toBeNull();
  });

  it("reports nothing for an MP neither file knows", async () => {
    setAttendance(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    const sig = await run();
    expect(sig.attendance).toBeNull();
    expect(sig.dissent).toBeNull();
  });
});
