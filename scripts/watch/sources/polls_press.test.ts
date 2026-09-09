// The press-discovery watcher — one Google News RSS query per agency with
// `reach: "press"` (decision 2, §6.1). The behaviour under test: one
// agency's query failing does not fail the whole source (it carries that
// agency's prior value forward and records the error), Gallup is never
// queried here (it owns its own two-armed source), and only every agency
// failing with no prior state at all throws.

import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESS_ONLY_AGENCIES } from "../../polls/lib/agencies";

const mockPressQuery = (byQuery: (query: string) => Promise<unknown[]>) =>
  vi.doMock("../../polls/lib/google_news_rss", async (orig) => ({
    ...(await orig<typeof import("../../polls/lib/google_news_rss")>()),
    googleNewsRss: byQuery,
  }));

const mockReadState = (state: unknown) =>
  vi.doMock("../state", () => ({ readState: () => state }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../polls/lib/google_news_rss");
  vi.doUnmock("../state");
});

const pressItem = (
  title: string,
  pubDate: string,
  guid: string,
  sourceName = "БТВ",
) => ({
  title,
  link: "https://news.google.com/rss/articles/x",
  guid,
  pubDate,
  sourceUrl: null,
  sourceName,
});

describe("polls_press watch source", () => {
  it("is registered as polls_press, daily, weekly-publishing", async () => {
    mockPressQuery(async () => []);
    mockReadState(null);
    const { pollsPress } = await import("./polls_press");
    expect(pollsPress.id).toBe("polls_press");
    expect(pollsPress.cadence).toBe("daily");
    expect(pollsPress.publishes).toBe("weekly");
  });

  it("never queries Gallup — it owns its own two-armed source", () => {
    expect(PRESS_ONLY_AGENCIES.some((a) => a.id === "GIB")).toBe(false);
    expect(PRESS_ONLY_AGENCIES.length).toBeGreaterThan(0);
  });

  it("queries every press-only agency exactly once and combines the results", async () => {
    const calls: string[] = [];
    mockPressQuery(async (query: string) => {
      calls.push(query);
      const entry = PRESS_ONLY_AGENCIES.find((a) => a.pressQuery === query)!;
      return [
        pressItem(
          `${entry.seed.name_bg}: избори — проучване`,
          "Wed, 01 Jul 2026 08:00:00 GMT",
          `g-${entry.id}`,
        ),
      ];
    });
    mockReadState(null);
    const { pollsPress } = await import("./polls_press");
    const fp = await pollsPress.fingerprint();
    expect(calls).toHaveLength(PRESS_ONLY_AGENCIES.length);
    const tokens = fp.value.split("|");
    expect(tokens).toHaveLength(PRESS_ONLY_AGENCIES.length);
    for (const entry of PRESS_ONLY_AGENCIES) {
      expect(tokens.some((t) => t.startsWith(`${entry.id}:`))).toBe(true);
      expect(fp.detail).toContain(entry.seed.name_bg);
    }
  });

  it("carries a failed agency's PRIOR value forward rather than resetting it, and records the error", async () => {
    const failing = PRESS_ONLY_AGENCIES[0];
    mockPressQuery(async (query: string) => {
      if (query === failing.pressQuery) throw new Error("network timeout");
      return [];
    });
    const priorMs = Date.parse("Wed, 01 Jun 2026 00:00:00 GMT");
    mockReadState({
      fingerprint: "seed",
      detail: "seed",
      meta: {
        agencies: {
          [failing.id]: {
            latestMs: priorMs,
            latestGuid: "prior-guid",
            items: [],
          },
        },
      },
      lastChecked: "2026-06-01T00:00:00.000Z",
    });
    const { pollsPress } = await import("./polls_press");
    const fp = await pollsPress.fingerprint();
    expect(fp.value).toContain(`${failing.id}:${priorMs}:prior-guid`);
    expect(fp.detail).toContain(`query failed for ${failing.id}`);
    const meta = fp.meta as {
      agencies: Record<string, unknown>;
      queryErrors: Record<string, string>;
    };
    expect(meta.agencies[failing.id]).toEqual({
      latestMs: priorMs,
      latestGuid: "prior-guid",
      items: [],
    });
    expect(meta.queryErrors[failing.id]).toBe("network timeout");
    for (const o of PRESS_ONLY_AGENCIES.slice(1))
      expect(meta.queryErrors[o.id]).toBeUndefined();
  });

  it("does not spuriously flip an agency's token when its query succeeds with nothing new", async () => {
    // The FINDING-001 regression: a prior run had already established a
    // mark for one agency; today its query succeeds but finds nothing new
    // (the ordinary day-to-day case). That agency's token in the combined
    // value must stay byte-identical, not drop its guid.
    const settled = PRESS_ONLY_AGENCIES[0];
    mockPressQuery(async () => []); // every agency: no items today
    const priorMs = Date.parse("Wed, 01 Jun 2026 00:00:00 GMT");
    mockReadState({
      fingerprint: "seed",
      detail: "seed",
      meta: {
        agencies: {
          [settled.id]: { latestMs: priorMs, latestGuid: "gA", items: [] },
        },
      },
      lastChecked: "2026-06-01T00:00:00.000Z",
    });
    const { pollsPress } = await import("./polls_press");
    const fp = await pollsPress.fingerprint();
    const tokens = fp.value.split("|");
    expect(tokens.some((t) => t === `${settled.id}:${priorMs}:gA`)).toBe(true);
    const meta = fp.meta as {
      agencies: Record<string, { latestGuid: string }>;
    };
    expect(meta.agencies[settled.id].latestGuid).toBe("gA");
  });

  it("throws only when EVERY agency's query fails with no prior state", async () => {
    mockPressQuery(async () => {
      throw new Error("rate limited");
    });
    mockReadState(null);
    const { pollsPress } = await import("./polls_press");
    await expect(pollsPress.fingerprint()).rejects.toThrow(
      /every press query failed/,
    );
  });
});
