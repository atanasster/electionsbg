import { describe, test, expect, vi, afterEach } from "vitest";
import {
  parseRetryAfter,
  wcfDate,
  mapPool,
  eopCall,
  throttleCount,
  throttleSummary,
  __resetThrottleForTests,
} from "./eop_api";

// Restore unconditionally. `vi.useRealTimers()` as the last statement of a test body
// never runs if an assertion above it throws, and fake timers would then leak into
// the setTimeout-based mapPool tests — turning one failure into four, with the
// reported failure pointing at the wrong test.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetThrottleForTests();
});

describe("parseRetryAfter", () => {
  // RFC 9110 allows delay-seconds OR an HTTP-date. Getting this wrong either
  // ignores the register's instruction (and we keep hammering) or parks the crawl.
  test("delay-seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("  30 ")).toBe(30_000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  test("HTTP-date is resolved relative to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    expect(parseRetryAfter("Mon, 03 Aug 2026 12:00:10 GMT")).toBe(10_000);
    // A date already in the past means "retry now", not a negative sleep.
    expect(parseRetryAfter("Mon, 03 Aug 2026 11:59:00 GMT")).toBe(0);
  });

  test("caps at 2 minutes so a hostile value cannot park the crawl", () => {
    expect(parseRetryAfter("99999")).toBe(120_000);
  });

  // Regression: Date.parse("-1") returns 2001-01-01, so routing a malformed NUMBER
  // through the date branch clamps to 0 — "no backoff" exactly when the register is
  // asking us to stop. A bad number must yield null so the caller's default applies.
  test("absent or unparseable yields null, so the caller uses its own default", () => {
    for (const v of [null, "", "   ", "soon", "-1", "-30", "1e", "NaN"])
      expect(parseRetryAfter(v)).toBeNull();
  });
});

describe("wcfDate", () => {
  // The service serialises dates as /Date(epochMs)/, sometimes with a trailing
  // offset. null means "the service had no date", which is an answer.
  test("parses the WCF form", () => {
    expect(wcfDate("/Date(1788555599000)/")).toBe("2026-09-04T20:59:59.000Z");
    // The trailing offset is presentation only — the epoch is already absolute, so
    // it must NOT shift the instant.
    expect(wcfDate("/Date(1788555599000+0300)/")).toBe(
      "2026-09-04T20:59:59.000Z",
    );
  });

  test("null for anything that is not a WCF date", () => {
    for (const v of [null, undefined, "", "2026-08-04", 123, {}])
      expect(wcfDate(v)).toBeNull();
  });
});

describe("mapPool", () => {
  test("preserves order regardless of completion order", async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  test("saturates the cap without exceeding it", async () => {
    let live = 0;
    let peak = 0;
    await mapPool(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live--;
        return null;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
    // …and actually reaches it. Without this a strictly serial implementation
    // (peak === 1) passes, so a regression that broke pooling would stay green
    // while the crawl silently ran ~4x slower.
    expect(peak).toBe(4);
  });

  test("an empty list does not spawn workers or hang", async () => {
    expect(await mapPool([], 6, async () => 1)).toEqual([]);
  });
});

// The brake is the headline of the §13.3 fix and is by nature never exercised in
// normal operation — the register has never throttled us in ~1,700 observed
// requests. Without these, a regression in it stays invisible until the exact
// emergency it was written for.
describe("eopCall throttling", () => {
  // `retry-after: 0` keeps these fast. Without a hint the backoff escalates
  // (5s, 10s, 20s …), which is correct behaviour but makes a unit test sleep for
  // minutes — so only the test that is specifically about waiting supplies a delay.
  const reply = (status: number, headers: Record<string, string> = {}) =>
    new Response("", { status, headers: { "retry-after": "0", ...headers } });

  test("a 429 yields `throttled`, not a generic `http` failure", async () => {
    vi.stubGlobal("fetch", async () => reply(429));
    const r = await eopCall("X", {}, { tries: 1 });
    expect(r).toMatchObject({ ok: false, reason: "throttled", status: 429 });
    expect(throttleCount()).toBeGreaterThan(0);
  });

  test("503 counts as throttling too", async () => {
    vi.stubGlobal("fetch", async () => reply(503));
    expect(await eopCall("X", {}, { tries: 1 })).toMatchObject({
      reason: "throttled",
    });
  });

  // The throttle budget is separate from `tries`, so a permanently-throttling
  // register must still terminate rather than spin forever.
  test("a sustained throttle terminates via its own budget", async () => {
    vi.stubGlobal("fetch", async () => reply(429));
    const r = await eopCall("X", {}, { tries: 1 });
    expect(r).toMatchObject({ ok: false, reason: "throttled" });
    expect(throttleCount()).toBeLessThanOrEqual(10);
  });

  test("a 429 then a 200 succeeds, and Retry-After is actually waited out", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () =>
      ++n === 1
        ? reply(429, { "retry-after": "1" })
        : new Response('{"ok":1}', { status: 200 }),
    );
    const t0 = Date.now();
    const r = await eopCall<{ ok: number }>(
      "X",
      {},
      { tries: 3, baseDelayMs: 0 },
    );
    expect(r).toMatchObject({ ok: true });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  test("the brake is process-wide: a concurrent call waits behind it", async () => {
    // A is throttled once (1s brake) then succeeds; B is never throttled itself.
    // B must still be held, because the brake is shared — that is the whole point,
    // and a per-call backoff would let B sail through while A waits.
    let n = 0;
    vi.stubGlobal("fetch", async (url: unknown) =>
      String(url).includes("/A") && ++n === 1
        ? reply(429, { "retry-after": "1" })
        : new Response("{}", { status: 200 }),
    );
    const t0 = Date.now();
    const [, bMs] = await Promise.all([
      eopCall("A", {}, { tries: 2, baseDelayMs: 0 }),
      // Start B a beat later so A's 429 has certainly landed and set the deadline.
      (async () => {
        await new Promise((r) => setTimeout(r, 50));
        const s = Date.now();
        await eopCall("B", {}, { tries: 1 });
        return Date.now() - s;
      })(),
    ]);
    expect(bMs).toBeGreaterThanOrEqual(700);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  // A throttle must not consume the retry budget: charging it against `tries` makes
  // the crawl abandon a subject purely because the register was busy.
  test("a throttle does not spend a retry — the call still succeeds after several", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () =>
      ++n <= 3 ? reply(429) : new Response('{"ok":1}', { status: 200 }),
    );
    // tries: 1 would be exhausted immediately if throttles counted against it.
    const r = await eopCall<{ ok: number }>("X", {}, { tries: 1 });
    expect(r).toMatchObject({ ok: true });
    expect(throttleCount()).toBe(3);
  });

  test("a 401 short-circuits and never engages the brake", async () => {
    vi.stubGlobal("fetch", async () => reply(401));
    expect(await eopCall("X", {}, { tries: 3 })).toMatchObject({
      reason: "denied",
    });
    expect(throttleCount()).toBe(0);
  });

  test("throttleSummary is null when quiet and names the count when not", async () => {
    expect(throttleSummary()).toBeNull();
    let n = 0;
    vi.stubGlobal("fetch", async () =>
      ++n === 1 ? reply(429) : new Response("{}", { status: 200 }),
    );
    await eopCall("X", {}, { tries: 2, baseDelayMs: 0 });
    expect(throttleSummary()).toContain("1 time(s)");
  });
});
