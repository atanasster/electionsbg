// The contract this file exists to pin: askJev NEVER throws and never hangs.
// Every failure path must come back as null, because Jev is a routing
// accelerator inside a lane — if it could throw, a routing outage would take
// the lane down instead of degrading within it (plan §6).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askJev,
  BREAKER_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  choiceOf,
  jevBreakerOpen,
  JEV_TIMEOUT_MS,
  lastJevSkip,
  noulOf,
  resetJevBreaker,
} from "./jevClient";

vi.mock("./session", () => ({
  PROXY_URL: "https://example.test/api/llm",
  hasAiSession: () => mockHasSession,
}));
let mockHasSession = true;

const creds = { sessionToken: "s", questionId: "q" };
const questions = {
  tool: {
    type: "choice" as const,
    instructions: "Which tool?",
    criteria: { turnout: null, results: null },
  },
};

const okBody = {
  answers: {
    tool: {
      type: "choice",
      choice: "turnout",
      probabilities: { turnout: 0.9 },
      confidence: 0.88,
    },
    is_compound: { type: "noul", noul: 0.02 },
  },
  model: "jev-1.13.0",
  usage: { input_tokens: 1000, output_tokens: 40 },
};

const okFetch = vi.fn(async () => ({
  ok: true,
  json: async () => okBody,
})) as unknown as typeof fetch;

beforeEach(() => {
  resetJevBreaker();
  mockHasSession = true;
  vi.clearAllMocks();
});

describe("askJev", () => {
  it("returns typed answers and measures its own latency", async () => {
    let t = 1000;
    const result = await askJev("state", questions, creds, {
      fetchImpl: okFetch,
      now: () => (t += 250),
    });
    expect(result).not.toBeNull();
    expect(choiceOf(result, "tool")?.choice).toBe("turnout");
    expect(noulOf(result, "is_compound")).toBe(0.02);
    expect(result!.latencyMs).toBeGreaterThan(0);
    expect(result!.usage?.input_tokens).toBe(1000);
  });

  it("sends the systemone action with the caller's credentials", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => okBody,
    }));
    await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.action).toBe("systemone");
    expect(body.sessionToken).toBe("s");
    expect(body.questionId).toBe("q");
    // The client never names a model — the proxy pins it server-side.
    expect(body.model).toBeUndefined();
  });

  it("skips without credentials, without touching the breaker", async () => {
    const fetchImpl = vi.fn();
    const result = await askJev("state", questions, undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("no_session");
    expect(fetchImpl).not.toHaveBeenCalled();
    // The No-LLM lane has no session by design; that is the ordinary path
    // there, so it must not count toward an outage.
    expect(jevBreakerOpen()).toBe(false);
  });

  it("skips when the session has expired", async () => {
    mockHasSession = false;
    const result = await askJev("state", questions, creds, {
      fetchImpl: okFetch,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("no_session");
  });

  it.each([
    [
      "http_error",
      async () => ({ ok: false, status: 429, json: async () => ({}) }),
    ],
    [
      "malformed",
      async () => ({ ok: true, json: async () => ({ model: "x" }) }),
    ],
    // A 200 the body of which will not parse is the SERVER's fault (a hosting
    // interstitial, an edge error page), so it must not be filed as "network".
    [
      "malformed",
      async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }),
    ],
    // `answers` present but not a map — truthy, and previously accepted.
    [
      "malformed",
      async () => ({ ok: true, json: async () => ({ answers: "yes" }) }),
    ],
    [
      "malformed",
      async () => ({ ok: true, json: async () => ({ answers: [] }) }),
    ],
  ])("returns null rather than throwing on %s", async (reason, impl) => {
    const result = await askJev("state", questions, creds, {
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe(reason);
  });

  it("returns null rather than throwing when the call times out", async () => {
    const fetchImpl = async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    };
    const result = await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("timeout");
  });

  it("returns null rather than throwing on a network error", async () => {
    const fetchImpl = async () => {
      throw new Error("connection reset");
    };
    const result = await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("network");
  });

  // ---- the "never hangs" half of the contract -----------------------------
  // Without these, deleting the `signal:` line leaves the whole suite green
  // while removing the module's only defence against a hung socket.
  it("attaches an abort signal to every request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => okBody,
    }));
    await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(
      init.signal,
      "no abort signal — a hung socket would hang the turn",
    ).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });

  it("abandons a request that never settles, rather than hanging the turn", async () => {
    // A fetch that only ever rejects when the signal fires — i.e. the real
    // hung-socket shape. If the budget were not applied this would never
    // resolve and the test would time out instead of returning null.
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "TimeoutError";
          reject(e);
        });
      });
    const result = await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("timeout");
  });

  it("stays strictly under the server's own abort, read from the server", () => {
    // The two values live in different packages (browser ESM vs CommonJS Cloud
    // Function), so there is no shared constant to import. Read the server's
    // real literal instead of restating it: a third hand-copied 2000 in this
    // file would keep passing while someone lowered the server's abort and
    // silently inverted the ordering the reservation protocol depends on.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../functions/llm_http.js"),
      "utf8",
    );
    const jevLane = src.slice(src.indexOf('body.action === "systemone"'));
    const m = /AbortSignal\.timeout\((\d+)\)/.exec(jevLane);
    expect(
      m,
      "server Jev abort not found — did llm_http.js move?",
    ).toBeTruthy();
    const serverAbortMs = Number(m![1]);
    expect(JEV_TIMEOUT_MS).toBeLessThan(serverAbortMs);
    // Headroom, not seconds: the server must release the reservation just
    // AFTER we stop waiting, so the lane's fallback can claim the same
    // question without hitting `429 call_limit`.
    expect(serverAbortMs - JEV_TIMEOUT_MS).toBeLessThanOrEqual(1000);
  });
});

describe("circuit breaker", () => {
  const failing = (async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  })) as unknown as typeof fetch;

  it("opens after consecutive failures so an outage costs one timeout, not one per turn", async () => {
    const t = 0;
    for (let i = 0; i < BREAKER_THRESHOLD; i++)
      await askJev("state", questions, creds, {
        fetchImpl: failing,
        now: () => t,
      });
    expect(jevBreakerOpen(t)).toBe(true);

    const fetchImpl = vi.fn();
    const result = await askJev("state", questions, creds, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });
    expect(result).toBeNull();
    expect(lastJevSkip()).toBe("breaker_open");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("half-opens after the cooldown and closes again on success", async () => {
    let t = 0;
    for (let i = 0; i < BREAKER_THRESHOLD; i++)
      await askJev("state", questions, creds, {
        fetchImpl: failing,
        now: () => t,
      });
    t += BREAKER_COOLDOWN_MS + 1;
    expect(jevBreakerOpen(t)).toBe(false);

    const result = await askJev("state", questions, creds, {
      fetchImpl: okFetch,
      now: () => t,
    });
    expect(result).not.toBeNull();
    expect(jevBreakerOpen(t)).toBe(false);
  });

  it("re-opens on a single failure while still broken, not after another full threshold", async () => {
    let t = 0;
    for (let i = 0; i < BREAKER_THRESHOLD; i++)
      await askJev("state", questions, creds, {
        fetchImpl: failing,
        now: () => t,
      });
    t += BREAKER_COOLDOWN_MS + 1;
    await askJev("state", questions, creds, {
      fetchImpl: failing,
      now: () => t,
    });
    expect(jevBreakerOpen(t)).toBe(true);
  });

  it("does not count a successful call toward the breaker", async () => {
    const t = 0;
    for (let i = 0; i < BREAKER_THRESHOLD * 2; i++)
      await askJev("state", questions, creds, {
        fetchImpl: okFetch,
        now: () => t,
      });
    expect(jevBreakerOpen(t)).toBe(false);
  });
});

describe("answer readers", () => {
  it("narrow by type, so a mismatched shape reads as no answer", async () => {
    const result = await askJev("state", questions, creds, {
      fetchImpl: okFetch,
    });
    expect(choiceOf(result, "is_compound")).toBeNull();
    expect(noulOf(result, "tool")).toBeNull();
    expect(choiceOf(result, "missing")).toBeNull();
    expect(choiceOf(null, "tool")).toBeNull();
  });

  it("rejects an answer whose payload field is the wrong type", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({
        answers: {
          tool: {
            type: "choice",
            choice: 42,
            probabilities: {},
            confidence: 1,
          },
          flag: { type: "noul", noul: "high" },
        },
      }),
    })) as unknown as typeof fetch;
    const result = await askJev("state", questions, creds, { fetchImpl });
    // The envelope is well-formed, so the call succeeds — but a `choice` that
    // is not a string cannot be routed on, and reading it must not hand the
    // caller a number typed as a tool name.
    expect(result).not.toBeNull();
    expect(choiceOf(result, "tool")).toBeNull();
    expect(noulOf(result, "flag")).toBeNull();
  });
});

describe("skip-reason channel", () => {
  it("clears on success, so a stale reason cannot outlive its call", async () => {
    await askJev("state", questions, undefined, { fetchImpl: okFetch });
    expect(lastJevSkip()).toBe("no_session");
    await askJev("state", questions, creds, { fetchImpl: okFetch });
    expect(lastJevSkip()).toBeNull();
  });

  it("is cleared by resetJevBreaker, so a new chat inherits nothing", async () => {
    await askJev("state", questions, undefined, { fetchImpl: okFetch });
    expect(lastJevSkip()).toBe("no_session");
    resetJevBreaker();
    expect(lastJevSkip()).toBeNull();
  });
});
