// `computeSiteArm` is the monotonic-fingerprint logic behind six watcher
// sources (decision 3, docs/plans/polls-agency-watchers-v1.md §6.1) — tested
// once, thoroughly, against a stub lister here rather than six times against
// six real ones. `makeAgencyPollsWatcher` is the thin WatchSource wrapper
// each of those six files calls.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../watch/state", () => ({ readState: vi.fn() }));

import { readState } from "../../watch/state";
import { computeSiteArm, makeAgencyPollsWatcher } from "./watcher";
import type { AgencyLister, Publication } from "../agencies/types";

const mockedReadState = vi.mocked(readState);

beforeEach(() => {
  vi.resetAllMocks();
});

const pub = (
  id: number,
  electoral: boolean,
  publishedAt: string | null = null,
): Publication => ({
  id,
  url: `https://x/${id}`,
  title: electoral ? `electoral post ${id}` : `other post ${id}`,
  publishedAt,
  kind: "html",
  attachments: [],
});

const isElectoral = (p: Publication): boolean =>
  p.title.startsWith("electoral");

describe("computeSiteArm", () => {
  it("on the first run, treats every electoral item as new (the backlog)", () => {
    const listed = [pub(10, true), pub(11, false), pub(12, true)];
    const arm = computeSiteArm(listed, isElectoral, null);
    expect(arm.newestId).toBe(12);
    expect(arm.items.map((i) => i.id)).toEqual([10, 12]);
    expect(arm.detail).toContain("+2 electoral publication(s)");
  });

  it("on a later run, reports only ids newer than the prior mark", () => {
    const listed = [
      pub(10, true),
      pub(11, false),
      pub(12, true),
      pub(13, true),
    ];
    const arm = computeSiteArm(listed, isElectoral, 12);
    expect(arm.newestId).toBe(13);
    expect(arm.items.map((i) => i.id)).toEqual([13]);
  });

  it("reports no new items, and keeps the mark, when nothing is newer", () => {
    const listed = [pub(10, true), pub(12, true)];
    const arm = computeSiteArm(listed, isElectoral, 12);
    expect(arm.newestId).toBe(12);
    expect(arm.items).toEqual([]);
    expect(arm.detail).toBe("no new electoral publications (newest id 12)");
  });

  it("NEVER regresses the mark when a bounded window rolls the highest electoral id off", () => {
    // Window previously held id 500 (electoral, now scrolled off by newer
    // non-electoral posts); only 480 and 490 are still electoral and visible.
    // Taking the current window's own max (490) would report a false
    // regression on a source that lost nothing.
    const listed = [pub(480, true), pub(490, true), pub(504, false)];
    const arm = computeSiteArm(listed, isElectoral, 500);
    expect(arm.newestId).toBe(500);
    expect(arm.items).toEqual([]); // neither 480 nor 490 exceeds the prior mark
  });

  it("carries the prior mark forward when the window has NO electoral items at all", () => {
    const listed = [pub(501, false), pub(502, false)];
    const arm = computeSiteArm(listed, isElectoral, 12);
    expect(arm.newestId).toBe(12);
    expect(arm.items).toEqual([]);
    expect(arm.detail).toBe("no electoral publications in the current window");
  });

  it("starts at 0 when there is no prior state AND no electoral items", () => {
    const listed = [pub(1, false)];
    const arm = computeSiteArm(listed, isElectoral, null);
    expect(arm.newestId).toBe(0);
    expect(arm.items).toEqual([]);
  });

  it("carries id/url/title/publishedAt through to meta items", () => {
    const listed = [pub(10, true, "2026-07-01")];
    const arm = computeSiteArm(listed, isElectoral, null);
    expect(arm.items).toEqual([
      {
        id: 10,
        url: "https://x/10",
        title: "electoral post 10",
        publishedAt: "2026-07-01",
      },
    ]);
  });
});

describe("makeAgencyPollsWatcher", () => {
  const makeLister = (
    listPublications: AgencyLister["listPublications"],
  ): AgencyLister => ({
    agencyId: "ZZ",
    listPublications,
    isElectoral,
  });

  it("wires id/label/url/cadence/publishes verbatim", () => {
    const source = makeAgencyPollsWatcher({
      id: "polls_zz",
      label: "Polls — ZZ",
      url: "https://zz.example",
      lister: makeLister(async () => []),
    });
    expect(source.id).toBe("polls_zz");
    expect(source.label).toBe("Polls — ZZ");
    expect(source.url).toBe("https://zz.example");
    expect(source.cadence).toBe("daily");
    expect(source.publishes).toBe("weekly");
  });

  it("reads its own state by id and feeds the prior mark into computeSiteArm", async () => {
    mockedReadState.mockReturnValue({
      fingerprint: "12",
      detail: "prior run",
      meta: { newestId: 12, items: [] },
      lastChecked: "2026-09-01T00:00:00.000Z",
    });
    const source = makeAgencyPollsWatcher({
      id: "polls_zz",
      label: "Polls — ZZ",
      url: "https://zz.example",
      lister: makeLister(async () => [pub(13, true)]),
    });
    const fp = await source.fingerprint();
    expect(mockedReadState).toHaveBeenCalledWith("polls_zz");
    expect(fp.value).toBe("13");
    expect(fp.meta).toEqual({
      newestId: 13,
      items: [
        {
          id: 13,
          url: "https://x/13",
          title: "electoral post 13",
          publishedAt: null,
        },
      ],
    });
  });

  it("propagates a lister's rejection rather than swallowing it", async () => {
    mockedReadState.mockReturnValue(null);
    const source = makeAgencyPollsWatcher({
      id: "polls_zz",
      label: "Polls — ZZ",
      url: "https://zz.example",
      lister: makeLister(async () => {
        throw new Error("network down");
      }),
    });
    await expect(source.fingerprint()).rejects.toThrow("network down");
  });

  it("passes the shared LISTING_WINDOW limit to the lister", async () => {
    mockedReadState.mockReturnValue(null);
    const listPublications = vi.fn(async () => []);
    const source = makeAgencyPollsWatcher({
      id: "polls_zz",
      label: "Polls — ZZ",
      url: "https://zz.example",
      lister: makeLister(listPublications),
    });
    await source.fingerprint();
    expect(listPublications).toHaveBeenCalledWith({ limit: 25 });
  });
});
