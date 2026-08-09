// The pure helpers behind the open-calls tile. Each one exists because a wrong answer here is
// invisible on the page: a stale list that does not say so, or a deadline printed in the wrong
// year, both render as confident and correct.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  crawlAgeHours,
  formatSofiaStamp,
  newestCrawl,
  STALE_AFTER_HOURS,
  useOpenCalls,
  type OpenCallsCrawl,
} from "./useOpenCalls";

const crawl = (
  source: string,
  crawledAt: string,
  ok = true,
): OpenCallsCrawl => ({ source, crawledAt, rowsSeen: 1, ok, note: null });

describe("newestCrawl", () => {
  it("returns null when nothing has ever run", () => {
    expect(newestCrawl([])).toBeNull();
  });

  it("ignores FAILED runs — a crawl that errored is not evidence of freshness", () => {
    // This is the whole point of the `ok` flag. A failed run today must not make a list
    // last successfully refreshed a week ago look current.
    const rows = [
      crawl("isun", "2026-08-08T06:00:00Z", false),
      crawl("sp2023", "2026-08-01T06:00:00Z", true),
    ];
    expect(newestCrawl(rows)?.source).toBe("sp2023");
  });

  it("returns null when every run failed, rather than the newest failure", () => {
    expect(
      newestCrawl([
        crawl("isun", "2026-08-08T06:00:00Z", false),
        crawl("sp2023", "2026-08-07T06:00:00Z", false),
      ]),
    ).toBeNull();
  });

  it("picks the newest across sources", () => {
    expect(
      newestCrawl([
        crawl("sp2023", "2026-08-01T06:00:00Z"),
        crawl("isun", "2026-08-08T06:00:00Z"),
        crawl("ahu", "2026-07-01T06:00:00Z"),
      ])?.source,
    ).toBe("isun");
  });
});

describe("crawlAgeHours", () => {
  const now = new Date("2026-08-08T12:00:00Z").getTime();

  it("is Infinity when nothing has ever run, so the caller reads as STALE", () => {
    // Not 0. A never-crawled table must trip the staleness branch, not the fresh one.
    expect(crawlAgeHours([], now)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlAgeHours([], now) > STALE_AFTER_HOURS).toBe(true);
  });

  it("measures from the newest SUCCESSFUL run", () => {
    expect(
      crawlAgeHours(
        [
          crawl("isun", "2026-08-08T11:00:00Z", false),
          crawl("sp2023", "2026-08-08T06:00:00Z", true),
        ],
        now,
      ),
    ).toBe(6);
  });

  it("crosses the SLA only after a whole missed run", () => {
    // The crawl is daily, so 24 h is one run and must stay fresh; 48 h means one was missed.
    expect(crawlAgeHours([crawl("isun", "2026-08-07T12:00:00Z")], now)).toBe(
      24,
    );
    expect(
      crawlAgeHours([crawl("isun", "2026-08-07T12:00:00Z")], now),
    ).toBeLessThan(STALE_AFTER_HOURS);
    expect(
      crawlAgeHours([crawl("isun", "2026-08-06T11:00:00Z")], now),
    ).toBeGreaterThan(STALE_AFTER_HOURS);
  });
});

describe("formatSofiaStamp", () => {
  const now = new Date("2026-08-08T09:00:00Z");

  it("renders the time in SOFIA, not the runner's zone", () => {
    // 16:30 EEST is the cut-off ИСУН actually publishes. A viewer in Berlin must still read
    // 16:30 — printing 15:30 would misstate the rule they have to meet.
    expect(formatSofiaStamp("2026-09-14T13:30:00Z", "bg", now)).toContain(
      "16:30",
    );
    expect(formatSofiaStamp("2026-09-14T13:30:00Z", "en", now)).toContain(
      "16:30",
    );
  });

  it("uses a 24-hour clock in both locales", () => {
    const s = formatSofiaStamp("2026-09-14T14:30:00Z", "en", now);
    expect(s).toContain("17:30");
    expect(s).not.toMatch(/[ap]m/i);
  });

  it("ELIDES the year for a deadline in the current Sofia year", () => {
    expect(formatSofiaStamp("2026-09-14T13:30:00Z", "bg", now)).not.toContain(
      "2026",
    );
  });

  it("SHOWS the year for a deadline in another year", () => {
    // bg-BG renders `month:"short"` as a number, so a 2029 deadline printed as „31.12" reads
    // as this December — the defect this branch exists to prevent.
    const s = formatSofiaStamp("2029-12-31T15:30:00Z", "bg", now);
    expect(s).toContain("2029");
    expect(s).toContain("17:30");
  });

  it("compares years in Sofia's calendar, not UTC's", () => {
    // 2026-12-31T22:30Z is already 2027-01-01 00:30 in Sofia. Anchored on a `now` that is
    // itself in 2027 Sofia time, the instant is the CURRENT year and the year must be elided —
    // a UTC comparison would call it 2026 and print a year that contradicts the printed day.
    const nowSofia2027 = new Date("2026-12-31T23:00:00Z"); // 2027-01-01 01:00 in Sofia
    const s = formatSofiaStamp("2026-12-31T22:30:00Z", "bg", nowSofia2027);
    expect(s).toContain("00:30");
    expect(s).not.toContain("2027");
    expect(s).not.toContain("2026");
  });
});

// ── The request the hook builds ───────────────────────────────────────────────────────────
// Two things here are silent when wrong: a blank `audience` reaching the route empties every
// group (`audience @> ARRAY['']` matches nothing), and `staleTime: Infinity` — the house default
// for the static JSON tree — would freeze the countdown and the „Проверено на" stamp in an open
// tab, which is invariant 3 breaking in the one dataset whose value IS its freshness.

describe("useOpenCalls request", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            calls: [],
            indicative: [],
            consultations: [],
            crawl: [],
            totals: { calls: 0, indicative: 0, consultations: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mount = (opts: Parameters<typeof useOpenCalls>[0]) => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return {
      qc,
      ...renderHook(() => useOpenCalls(opts), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      }),
    };
  };

  it("passes the limit through", async () => {
    const { result } = mount({ limit: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toBe("/api/db/open-calls?limit=5");
  });

  it("sends a real audience facet", async () => {
    const { result } = mount({ limit: 5, audience: "farmer" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toBe("/api/db/open-calls?limit=5&audience=farmer");
  });

  it("OMITS a blank audience rather than sending an empty string", async () => {
    const { result } = mount({ limit: 5, audience: "   " });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toBe("/api/db/open-calls?limit=5");
  });

  it("does NOT cache for ever — freshness is the payload's point", async () => {
    const { qc, result } = mount({ limit: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Read the resolved option off the cache entry, not a re-declared constant: the failure this
    // guards against is someone "simplifying" the hook back to the JSON tree's
    // `staleTime: Infinity`, which would freeze the countdown and the „Проверено на" stamp in an
    // open tab while presenting both as current.
    const entry = qc.getQueryCache().find({ queryKey: ["open-calls", 5, ""] });
    expect(entry).toBeTruthy();
    const staleTime = entry!.observers[0]?.options.staleTime;
    expect(staleTime).toBeTypeOf("number");
    expect(staleTime).toBeLessThanOrEqual(60 * 60_000);
    expect(staleTime).toBeGreaterThan(0);
  });
});
