// Gates for the council fetch layer's three deadlines, the per-município
// budget and the per-host circuit breaker.
//
// These exist because the defect they close was INVISIBLE: on 2026-08-09
// obs.kazanlak.bg accepted TCP connections and then never answered, and
// the scraper — which had an AbortController on its listing fetches but
// not on the brute-force probe — sat on it for over an hour. Nothing
// failed, nothing logged, and the município after it was never scraped.
//
// Every server here is a local http.Server. No network.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createMuniBudget,
  endMuniBudget,
  runInMuniBudget,
  __enterMuniBudgetForTests,
  __setTimingForTests,
  fetchHead,
  fetchHtml,
  muniBudgetExpired,
  muniLookupFailureReasons,
  muniLookupFailures,
  resetHostState,
  BudgetExhaustedError,
  CONSECUTIVE_TIMEOUT_LIMIT,
  DEFAULT_HEADERS_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_RETRIES,
  FILE_TOTAL_MS,
  HEAD_TOTAL_MS,
  HTML_TOTAL_MS,
  MAX_BODY_BYTES,
  THROTTLE_COOLDOWN_MS,
  FetchTimeoutError,
  HostThrottledError,
  HostUnreachableError,
} from "./fetch";

type Behaviour =
  | "silent"
  | "stall-body"
  | "ok"
  | "not-found"
  | "server-error"
  | "rate-limited"
  | "no-head";

const servers: Server[] = [];

/** The budget the current test is running under, so assertions can read
 *  its counters the way the orchestrator does. */
let budget: ReturnType<typeof createMuniBudget> | undefined;

/** Open a budget and enter it for the rest of the test body. */
const enterBudget = (label: string, ms: number) => {
  if (budget) endMuniBudget(budget);
  budget = createMuniBudget(label, ms);
  __enterMuniBudgetForTests(budget);
  return budget;
};

/** Start a server whose behaviour the test picks per request. `silent`
 *  completes the handshake and then never writes — the shape a plain
 *  fetch() hangs on for ever. */
const startServer = async (
  behaviour: () => Behaviour,
): Promise<{
  base: string;
  hits: () => number;
  methods: () => string[];
}> => {
  let hits = 0;
  const methods: string[] = [];
  const server = createServer((_req, res) => {
    hits++;
    methods.push(_req.method ?? "?");
    const mode = behaviour();
    // A server that serves GET happily and refuses the HEAD for the same
    // URL — common on small municipal CMSes, and silently fatal to a
    // speculative probe that reads 405 as "not there".
    if (mode === "no-head" && _req.method === "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (mode === "silent") return; // headers never sent
    if (mode === "not-found") {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("nope");
      return;
    }
    if (mode === "server-error" || mode === "rate-limited") {
      res.writeHead(mode === "rate-limited" ? 429 : 520);
      res.end("no");
      return;
    }
    if (mode === "stall-body") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Transfer-Encoding": "chunked",
      });
      res.write("<html>partial");
      return; // never ends
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>ok</html>");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    hits: () => hits,
    methods: () => [...methods],
  };
};

beforeEach(() => {
  // The behaviour under test is ordering and accounting, not duration.
  __setTimingForTests({ politeDelayMs: 0, retryBackoffMs: [1, 1] });
  // A generous budget by default, so a test that does not care about the
  // wall clock cannot inherit an expired one from the test before it —
  // enterWith persists down the async context.
  enterBudget("DEFAULT", 60_000);
});

afterEach(async () => {
  __setTimingForTests({ politeDelayMs: 250, retryBackoffMs: [1_000, 3_000] });
  if (budget) endMuniBudget(budget);
  budget = undefined;
  // Cooldowns and the HEAD-unsupported memo are process-wide by design —
  // they must outlive a budget, so only an explicit reset clears them
  // between tests.
  resetHostState();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections?.();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("per-request deadlines", () => {
  it("gives up on a server that never sends headers", async () => {
    const { base } = await startServer(() => "silent");
    const t0 = Date.now();
    // retries: 0 keeps this about the DEADLINE. With retries on, the same
    // dead host is legitimately three attempts plus backoff — covered in
    // the "retry" block below, and not what this assertion is measuring.
    await expect(
      fetchHtml(`${base}/x`, { headersMs: 200, timeoutMs: 5000, retries: 0 }),
    ).rejects.toMatchObject({
      name: "FetchTimeoutError",
      phase: "headers",
    });
    // The point of the gate: it RETURNS. A bare fetch() here never does.
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("gives up on a response that starts and then stalls mid-body", async () => {
    const { base } = await startServer(() => "stall-body");
    const err = await fetchHtml(`${base}/x`, {
      headersMs: 3000,
      idleMs: 200,
      timeoutMs: 10_000,
    }).catch((e: unknown) => e);
    // The headers arrived, so this must NOT be reported as a connect
    // failure — the two are different diagnoses for the operator.
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect((err as FetchTimeoutError).phase).toBe("idle");
  });

  it("passes a healthy response straight through", async () => {
    const { base } = await startServer(() => "ok");
    await expect(fetchHtml(`${base}/x`)).resolves.toContain("ok");
  });
});

describe("host circuit breaker", () => {
  it("stops dialling a dead host after N consecutive failures", async () => {
    const { base, hits } = await startServer(() => "silent");
    enterBudget("TEST", 60_000);

    // retries: 0 mirrors the brute-force probe, the caller this exists for.
    for (let i = 0; i < CONSECUTIVE_TIMEOUT_LIMIT; i++) {
      await expect(
        fetchHead(`${base}/probe-${i}`, { timeoutMs: 100, retries: 0 }),
      ).rejects.toBeInstanceOf(FetchTimeoutError);
    }
    const connectionsMade = hits();

    // The next one must fail WITHOUT a request — that is the whole saving.
    // Казанлък's probe is 1,440 URLs; at 5 s each that is two hours.
    const t0 = Date.now();
    await expect(
      fetchHead(`${base}/probe-after`, { timeoutMs: 5000, retries: 0 }),
    ).rejects.toBeInstanceOf(HostUnreachableError);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(hits()).toBe(connectionsMade);
  });

  it("does not trip on 404s — the brute-force probes expect them", async () => {
    const { base } = await startServer(() => "not-found");
    enterBudget("TEST", 60_000);
    for (let i = 0; i < CONSECUTIVE_TIMEOUT_LIMIT + 3; i++) {
      const r = await fetchHead(`${base}/missing-${i}`, { timeoutMs: 2000 });
      expect(r.status).toBe(404);
    }
  });

  it("resets the strike count once the host answers again", async () => {
    let mode: Behaviour = "silent";
    const { base } = await startServer(() => mode);
    enterBudget("TEST", 60_000);

    for (let i = 0; i < CONSECUTIVE_TIMEOUT_LIMIT - 1; i++) {
      await expect(
        fetchHead(`${base}/flaky-${i}`, { timeoutMs: 100, retries: 0 }),
      ).rejects.toBeInstanceOf(FetchTimeoutError);
    }
    mode = "ok";
    await expect(fetchHead(`${base}/back`)).resolves.toMatchObject({
      status: 200,
    });
    mode = "silent";
    // Still a plain timeout, not a tripped breaker — a flaky server that
    // recovers must not be written off for the rest of the município.
    await expect(
      fetchHead(`${base}/flaky-again`, { timeoutMs: 100, retries: 0 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });
});

describe("retry", () => {
  // Without this, ONE dropped connection on a município's index page is
  // terminal for that município: the orchestrator's rule is
  // `protocolsTouched === 0 && lookupFailures > 0`, so a single blip is
  // the difference between a stamped ingest and UNVERIFIED.
  it("rides out a transient failure and returns the eventual success", async () => {
    let calls = 0;
    const { base } = await startServer(() =>
      ++calls === 1 ? "server-error" : "ok",
    );
    enterBudget("TEST", 60_000);
    await expect(fetchHtml(`${base}/index`)).resolves.toContain("ok");
    // Recovered, so nothing was ever unreadable.
    expect(muniLookupFailures(budget!)).toBe(0);
  });

  it("counts ONE lookup failure per lookup, however many attempts it took", async () => {
    const { base, hits } = await startServer(() => "server-error");
    enterBudget("TEST", 60_000);

    await expect(fetchHtml(`${base}/gone`)).rejects.toThrow(/520/);
    // Three attempts, one failure: the count the orchestrator reads must
    // stay a count of things we could not SEE, not of times we tried.
    expect(hits()).toBe(3);
    expect(muniLookupFailures(budget!)).toBe(1);
  });

  it("does not retry when the caller opts out", async () => {
    const { base, hits } = await startServer(() => "server-error");
    enterBudget("TEST", 60_000);
    await expect(
      fetchHead(`${base}/probe`, { retries: 0 }),
    ).resolves.toMatchObject({ status: 520 });
    expect(hits()).toBe(1);
  });

  it("does not retry once the município budget is blown", async () => {
    const { base, hits } = await startServer(() => "server-error");
    enterBudget("TEST", 60_000);
    await fetchHead(`${base}/a`, { retries: 0 });
    const before = hits();

    enterBudget("TINY", 40);
    await new Promise((r) => setTimeout(r, 90));
    await expect(fetchHtml(`${base}/b`)).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    // Not one extra dial: a run that is out of time must unwind, not sleep.
    expect(hits()).toBe(before);
  });
});

describe("429 back-off", () => {
  // web.archive.org's CDX index is read by FOUR parsers — DOB28, HKV34,
  // GAB05 and SZR12 — one município after another. On 2026-08-09 it
  // IP-throttled us and the run kept dialling it once per município,
  // which is both futile and the reason the throttle never lifts.
  it("stops dialling a rate-limited host, ACROSS municipalities", async () => {
    const { base, hits } = await startServer(() => "rate-limited");
    enterBudget("DOB28", 60_000);
    await expect(fetchHtml(`${base}/cdx`)).rejects.toThrow(/429/);
    const dialled = hits();
    expect(muniLookupFailures(budget!)).toBe(1);

    // The next município must not re-dial it. A per-município breaker
    // cannot do this job — it is reset by beginMuniBudget, and each of the
    // four parsers makes exactly ONE CDX call.
    enterBudget("HKV34", 60_000);
    await expect(fetchHtml(`${base}/cdx2`)).rejects.toBeInstanceOf(
      HostThrottledError,
    );
    expect(hits()).toBe(dialled);
    // Still recorded as a failed lookup — skipping is not seeing, so the
    // município is UNVERIFIED rather than quietly stamped.
    expect(muniLookupFailures(budget!)).toBe(1);
  });

  it("retries a 429 before writing the host off", async () => {
    let calls = 0;
    const { base } = await startServer(() =>
      ++calls === 1 ? "rate-limited" : "ok",
    );
    enterBudget("TEST", 60_000);
    await expect(fetchHtml(`${base}/cdx`)).resolves.toContain("ok");
    // A one-off 429 must not silence the host for the next three parsers.
    await expect(fetchHtml(`${base}/cdx2`)).resolves.toContain("ok");
  });
});

describe("existence probe", () => {
  // The dangerous failure mode this closes is a SILENT one: a server that
  // 405s every HEAD makes a speculative probe read "not there" for every
  // URL, so the município reports zero protocols with zero LOOKUP
  // failures — indistinguishable from a council that published nothing.
  it("falls back to a ranged GET on a host that refuses HEAD", async () => {
    const { base, methods } = await startServer(() => "no-head");
    enterBudget("TEST", 60_000);

    await expect(
      fetchHead(`${base}/protokol-1.pdf`, { retries: 0 }),
    ).resolves.toMatchObject({ ok: true });
    expect(methods()).toEqual(["HEAD", "GET"]);

    // And it must not re-probe with HEAD for the rest of the process —
    // Казанлък's probe walks 1,440 URLs, so one wasted round trip each is
    // the whole cost of the walk again.
    await fetchHead(`${base}/protokol-2.pdf`, { retries: 0 });
    expect(methods()).toEqual(["HEAD", "GET", "GET"]);
    // Not counted as a failed lookup: the 405 was answered, then served.
    expect(muniLookupFailures(budget!)).toBe(0);
  });

  it("still reports a genuine 404 as not-found", async () => {
    const { base } = await startServer(() => "not-found");
    enterBudget("TEST", 60_000);
    await expect(
      fetchHead(`${base}/missing.pdf`, { retries: 0 }),
    ).resolves.toMatchObject({ ok: false, status: 404 });
  });
});

describe("failure reasons", () => {
  it("records WHY each lookup failed, not just how many", async () => {
    // The count alone cost an hour on 2026-08-09: ten municipalities each
    // reported "1 failed lookup" and the ten were three unrelated faults.
    const { base } = await startServer(() => "server-error");
    enterBudget("TEST", 60_000);
    await fetchHead(`${base}/down`, { retries: 0 });

    const why = muniLookupFailureReasons(budget!);
    expect(why).toHaveLength(1);
    expect(why[0]).toContain("/down");
    expect(why[0]).toContain("520");
  });

  it("names a timeout's phase, so a dead host reads differently from a stalled one", async () => {
    const { base } = await startServer(() => "silent");
    enterBudget("TEST", 60_000);
    await expect(
      fetchHtml(`${base}/x`, { headersMs: 100, timeoutMs: 500, retries: 0 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(muniLookupFailureReasons(budget!)[0]).toMatch(/no response headers/);
  });
});

describe("lookup-failure counter", () => {
  // This is what lets the orchestrator say UNVERIFIED instead of "no new
  // protocols". Getting it wrong in either direction is a wrong claim on
  // the page: over-count and a quiet council reads as a broken source,
  // under-count and an unreadable source reads as a quiet council.
  it("counts transport failures and server-side refusals, not 404s", async () => {
    let mode: Behaviour = "not-found";
    const { base } = await startServer(() => mode);

    enterBudget("QUIET", 60_000);
    for (let i = 0; i < 3; i++)
      await fetchHead(`${base}/missing-${i}`, { retries: 0 });
    // A 404 is a definitive answer — the source spoke.
    expect(muniLookupFailures(budget!)).toBe(0);

    mode = "server-error";
    await fetchHead(`${base}/down`, { retries: 0 });
    expect(muniLookupFailures(budget!)).toBe(1);

    mode = "silent";
    await expect(
      fetchHead(`${base}/dead`, { timeoutMs: 100, retries: 0 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(muniLookupFailures(budget!)).toBe(2);
  });

  it("resets per município", async () => {
    const { base } = await startServer(() => "server-error");
    enterBudget("A", 60_000);
    await fetchHead(`${base}/x`, { retries: 0 });
    expect(muniLookupFailures(budget!)).toBe(1);
    enterBudget("B", 60_000);
    expect(muniLookupFailures(budget!)).toBe(0);
    expect(muniLookupFailureReasons(budget!)).toEqual([]);
  });
});

describe("a straggler crossing a município boundary", () => {
  // F-002. The budget used to be a module singleton, so an ABANDONED
  // dispatcher — one the orchestrator gave up on but which is still
  // running, which is the entire purpose of the hard stop — resumed later,
  // read the global, and found the NEXT município's budget. Its failures
  // were charged there: a município whose source read perfectly reported
  // UNVERIFIED, declined to stamp, and printed the previous one's URLs.
  it("charges the failure to the município that owns it, not the next one", async () => {
    const { base } = await startServer(() => "silent");

    const slow = createMuniBudget("SLOW", 60_000);
    // Started inside SLOW and deliberately never awaited — the zombie.
    const straggler = runInMuniBudget(slow, () =>
      fetchHead(`${base}/x`, { timeoutMs: 300, retries: 0 }),
    ).catch(() => undefined);

    // The orchestrator abandons SLOW and opens the next município.
    endMuniBudget(slow);
    const next = enterBudget("NEXT", 60_000);

    await straggler;

    expect(muniLookupFailures(next)).toBe(0);
    expect(muniLookupFailureReasons(next)).toEqual([]);
    // …and it landed where it belongs.
    expect(muniLookupFailures(slow)).toBe(1);
  });

  it("stops a zombie dialling once its budget is closed", async () => {
    const { base, hits } = await startServer(() => "ok");
    const slow = createMuniBudget("SLOW", 60_000);
    endMuniBudget(slow);
    const before = hits();
    // A closed budget is the abandoned case: the dispatcher is still
    // running, and every request it makes from here would otherwise spend
    // the NEXT município's wall clock.
    await expect(
      runInMuniBudget(slow, () => fetchHtml(`${base}/x`)),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(hits()).toBe(before);
  });
});

describe("município budget", () => {
  it("aborts the in-flight request and short-circuits every later one", async () => {
    const { base, hits } = await startServer(() => "silent");
    enterBudget("SZR12", 250);

    // Long per-request timeout on purpose: the budget, not the request
    // deadline, has to be what ends this.
    await expect(
      fetchHtml(`${base}/slow`, { timeoutMs: 30_000 }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(muniBudgetExpired(budget!)).toBe(true);

    const after = hits();
    const t0 = Date.now();
    await expect(
      fetchHtml(`${base}/next`, { timeoutMs: 30_000 }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
    // Immediate and connectionless — this is what lets a dispatcher's
    // remaining loop unwind in milliseconds instead of minutes.
    expect(Date.now() - t0).toBeLessThan(100);
    expect(hits()).toBe(after);
  });

  it("does not leak across municipalities", async () => {
    const { base } = await startServer(() => "ok");
    enterBudget("SZR12", 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(muniBudgetExpired(budget!)).toBe(true);

    // The next município gets a clean budget — and a clean strike map.
    enterBudget("GAB05", 60_000);
    expect(muniBudgetExpired(budget!)).toBe(false);
    await expect(fetchHtml(`${base}/x`)).resolves.toContain("ok");
  });
});

describe("the tuning surface", () => {
  // These constants have no importer — they exist so an operator can find
  // and change them. Pinning them here is what makes them worth exporting:
  // without a gate they read as dead code, and the next cleanup deletes
  // them; with one, a change is a deliberate edit in two places.
  //
  // Each number is a claim about a failure mode, so the assertion carries
  // the claim rather than just the value.
  it("bounds a request the three ways the layer promises", () => {
    // Connect + first byte, matched to the undici Agent's own connect
    // timeout — the two disagreeing is what made headersMs a lie.
    expect(DEFAULT_HEADERS_MS).toBe(30_000);
    // A stalled body, which is the failure a single total deadline
    // cannot tell apart from a slow one.
    expect(DEFAULT_IDLE_MS).toBe(30_000);
    // A protokol PDF gets longer than a listing page; a HEAD probe is
    // speculative and gets much less.
    expect(HTML_TOTAL_MS).toBe(60_000);
    expect(FILE_TOTAL_MS).toBe(180_000);
    expect(HEAD_TOTAL_MS).toBe(15_000);
    expect(HEAD_TOTAL_MS).toBeLessThan(HTML_TOTAL_MS);
    expect(HTML_TOTAL_MS).toBeLessThan(FILE_TOTAL_MS);
  });

  it("keeps a dead host cheap and a 429 respected", () => {
    // limit × headersMs is what a dead host costs — Казанлък's probe is
    // 1,440 URLs, so this is the difference between 25 s and two hours.
    expect(CONSECUTIVE_TIMEOUT_LIMIT).toBe(5);
    // Longer than any one município's share of a run, because the host
    // that does this to us is shared by four parsers.
    expect(THROTTLE_COOLDOWN_MS).toBe(120_000);
    expect(DEFAULT_RETRIES).toBe(2);
  });

  it("caps a body well above a real protokol and well below memory", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024 * 1024);
  });
});
