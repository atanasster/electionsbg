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

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  beginMuniBudget,
  endMuniBudget,
  fetchHead,
  fetchHtml,
  muniBudgetExpired,
  muniLookupFailureReasons,
  muniLookupFailures,
  resetHostCooldowns,
  BudgetExhaustedError,
  CONSECUTIVE_TIMEOUT_LIMIT,
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
  | "rate-limited";

const servers: Server[] = [];

/** Start a server whose behaviour the test picks per request. `silent`
 *  completes the handshake and then never writes — the shape a plain
 *  fetch() hangs on for ever. */
const startServer = async (
  behaviour: () => Behaviour,
): Promise<{ base: string; hits: () => number }> => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    const mode = behaviour();
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
  return { base: `http://127.0.0.1:${port}`, hits: () => hits };
};

afterEach(async () => {
  endMuniBudget();
  // Cooldowns are process-wide by design — they must outlive a budget, so
  // only an explicit reset clears them between tests.
  resetHostCooldowns();
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
    beginMuniBudget("TEST", 60_000);

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
    beginMuniBudget("TEST", 60_000);
    for (let i = 0; i < CONSECUTIVE_TIMEOUT_LIMIT + 3; i++) {
      const r = await fetchHead(`${base}/missing-${i}`, { timeoutMs: 2000 });
      expect(r.status).toBe(404);
    }
  });

  it("resets the strike count once the host answers again", async () => {
    let mode: Behaviour = "silent";
    const { base } = await startServer(() => mode);
    beginMuniBudget("TEST", 60_000);

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
    beginMuniBudget("TEST", 60_000);
    await expect(fetchHtml(`${base}/index`)).resolves.toContain("ok");
    // Recovered, so nothing was ever unreadable.
    expect(muniLookupFailures()).toBe(0);
  });

  it("counts ONE lookup failure per lookup, however many attempts it took", async () => {
    const { base, hits } = await startServer(() => "server-error");
    beginMuniBudget("TEST", 60_000);

    await expect(fetchHtml(`${base}/gone`)).rejects.toThrow(/520/);
    // Three attempts, one failure: the count the orchestrator reads must
    // stay a count of things we could not SEE, not of times we tried.
    expect(hits()).toBe(3);
    expect(muniLookupFailures()).toBe(1);
  });

  it("does not retry when the caller opts out", async () => {
    const { base, hits } = await startServer(() => "server-error");
    beginMuniBudget("TEST", 60_000);
    await expect(
      fetchHead(`${base}/probe`, { retries: 0 }),
    ).resolves.toMatchObject({ status: 520 });
    expect(hits()).toBe(1);
  });

  it("does not retry once the município budget is blown", async () => {
    const { base, hits } = await startServer(() => "server-error");
    beginMuniBudget("TEST", 60_000);
    await fetchHead(`${base}/a`, { retries: 0 });
    const before = hits();

    beginMuniBudget("TINY", 40);
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
    beginMuniBudget("DOB28", 60_000);
    await expect(fetchHtml(`${base}/cdx`)).rejects.toThrow(/429/);
    const dialled = hits();
    expect(muniLookupFailures()).toBe(1);

    // The next município must not re-dial it. A per-município breaker
    // cannot do this job — it is reset by beginMuniBudget, and each of the
    // four parsers makes exactly ONE CDX call.
    beginMuniBudget("HKV34", 60_000);
    await expect(fetchHtml(`${base}/cdx2`)).rejects.toBeInstanceOf(
      HostThrottledError,
    );
    expect(hits()).toBe(dialled);
    // Still recorded as a failed lookup — skipping is not seeing, so the
    // município is UNVERIFIED rather than quietly stamped.
    expect(muniLookupFailures()).toBe(1);
  });

  it("retries a 429 before writing the host off", async () => {
    let calls = 0;
    const { base } = await startServer(() =>
      ++calls === 1 ? "rate-limited" : "ok",
    );
    beginMuniBudget("TEST", 60_000);
    await expect(fetchHtml(`${base}/cdx`)).resolves.toContain("ok");
    // A one-off 429 must not silence the host for the next three parsers.
    await expect(fetchHtml(`${base}/cdx2`)).resolves.toContain("ok");
  });
});

describe("failure reasons", () => {
  it("records WHY each lookup failed, not just how many", async () => {
    // The count alone cost an hour on 2026-08-09: ten municipalities each
    // reported "1 failed lookup" and the ten were three unrelated faults.
    const { base } = await startServer(() => "server-error");
    beginMuniBudget("TEST", 60_000);
    await fetchHead(`${base}/down`, { retries: 0 });

    const why = muniLookupFailureReasons();
    expect(why).toHaveLength(1);
    expect(why[0]).toContain("/down");
    expect(why[0]).toContain("520");
  });

  it("names a timeout's phase, so a dead host reads differently from a stalled one", async () => {
    const { base } = await startServer(() => "silent");
    beginMuniBudget("TEST", 60_000);
    await expect(
      fetchHtml(`${base}/x`, { headersMs: 100, timeoutMs: 500, retries: 0 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(muniLookupFailureReasons()[0]).toMatch(/no response headers/);
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

    beginMuniBudget("QUIET", 60_000);
    for (let i = 0; i < 3; i++)
      await fetchHead(`${base}/missing-${i}`, { retries: 0 });
    // A 404 is a definitive answer — the source spoke.
    expect(muniLookupFailures()).toBe(0);

    mode = "server-error";
    await fetchHead(`${base}/down`, { retries: 0 });
    expect(muniLookupFailures()).toBe(1);

    mode = "silent";
    await expect(
      fetchHead(`${base}/dead`, { timeoutMs: 100, retries: 0 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(muniLookupFailures()).toBe(2);
  });

  it("resets per município", async () => {
    const { base } = await startServer(() => "server-error");
    beginMuniBudget("A", 60_000);
    await fetchHead(`${base}/x`, { retries: 0 });
    expect(muniLookupFailures()).toBe(1);
    beginMuniBudget("B", 60_000);
    expect(muniLookupFailures()).toBe(0);
    expect(muniLookupFailureReasons()).toEqual([]);
  });
});

describe("município budget", () => {
  it("aborts the in-flight request and short-circuits every later one", async () => {
    const { base, hits } = await startServer(() => "silent");
    beginMuniBudget("SZR12", 250);

    // Long per-request timeout on purpose: the budget, not the request
    // deadline, has to be what ends this.
    await expect(
      fetchHtml(`${base}/slow`, { timeoutMs: 30_000 }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(muniBudgetExpired()).toBe(true);

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
    beginMuniBudget("SZR12", 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(muniBudgetExpired()).toBe(true);

    // The next município gets a clean budget — and a clean strike map.
    beginMuniBudget("GAB05", 60_000);
    expect(muniBudgetExpired()).toBe(false);
    await expect(fetchHtml(`${base}/x`)).resolves.toContain("ok");
  });
});
