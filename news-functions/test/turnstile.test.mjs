import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_ABUSE_POLICY } from "../lib/contract.js";
import { CloudflareTurnstileVerifier } from "../lib/turnstile.js";

const now = new Date("2026-08-31T10:15:00.000Z");
const validPayload = {
  success: true,
  challenge_ts: "2026-08-31T10:14:00.000Z",
  hostname: "news.electionsbg.com",
  action: "news-evaluation-submit",
};

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function verifierWith(responses, requests = [], options = {}) {
  let index = 0;
  return new CloudflareTurnstileVerifier("test-turnstile-secret", {
    fetch: async (url, init) => {
      requests.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(url, init) : next;
    },
    ...options,
  });
}

test("Siteverify receives no IP and exact success fields are required", async () => {
  const requests = [];
  const verifier = verifierWith([response(validPayload)], requests);
  assert.deepEqual(
    await verifier.verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "valid" },
  );
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  );
  const body = requests[0].init.body;
  assert.equal(body.get("secret"), "test-turnstile-secret");
  assert.equal(body.get("response"), "browser-token");
  assert.equal(body.has("remoteip"), false);
  assert.match(body.get("idempotency_key"), /^[0-9a-f-]{36}$/);
});

test("the provider idempotency UUID is stable across invocations and token-specific", async () => {
  const requests = [];
  const verifier = verifierWith(
    [response(validPayload), response(validPayload), response(validPayload)],
    requests,
  );
  await verifier.verify({ token: "same-token", remoteIp: null, now });
  await verifier.verify({ token: "same-token", remoteIp: null, now });
  await verifier.verify({ token: "different-token", remoteIp: null, now });
  const ids = requests.map(({ init }) => init.body.get("idempotency_key"));
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
});

test("hostname, action, and malformed challenge timestamps fail closed", async () => {
  for (const [change, reason] of [
    [{ hostname: "evil.example" }, "hostname_mismatch"],
    [{ action: "different-action" }, "action_mismatch"],
    [{ challenge_ts: "not-a-date" }, "invalid_timestamp"],
    [{ challenge_ts: "2026-02-30T10:15:00Z" }, "invalid_timestamp"],
    [{ challenge_ts: "2026-08-31T25:00:00Z" }, "invalid_timestamp"],
    [{ challenge_ts: "2026-08-31t10:15:00z" }, "invalid_timestamp"],
  ]) {
    const verifier = verifierWith([response({ ...validPayload, ...change })]);
    assert.deepEqual(
      await verifier.verify({ token: "browser-token", remoteIp: null, now }),
      { kind: "invalid", reason },
    );
  }
});

test("challenge age and future skew accept their exact contract boundaries", async () => {
  for (const [challenge_ts, expected] of [
    ["2026-08-31T10:10:00.000Z", { kind: "valid" }],
    [
      "2026-08-31T10:09:59.999Z",
      { kind: "invalid", reason: "expired_timestamp" },
    ],
    ["2026-08-31T10:16:00.000Z", { kind: "valid" }],
    [
      "2026-08-31T10:16:00.001Z",
      { kind: "invalid", reason: "expired_timestamp" },
    ],
    ["2026-08-31T12:15:00.000+02:00", { kind: "valid" }],
  ]) {
    assert.deepEqual(
      await verifierWith([response({ ...validPayload, challenge_ts })]).verify({
        token: "browser-token",
        remoteIp: null,
        now,
      }),
      expected,
    );
  }
});

test("only documented visitor error codes are attributed to the challenge", async () => {
  for (const code of [
    "missing-input-response",
    "invalid-input-response",
    "timeout-or-duplicate",
  ]) {
    assert.deepEqual(
      await verifierWith([
        response({ success: false, "error-codes": [code] }),
      ]).verify({ token: "bad-token", remoteIp: null, now }),
      { kind: "invalid", reason: "provider_rejected" },
    );
  }
  for (const code of [
    "missing-input-secret",
    "invalid-input-secret",
    "bad-request",
  ]) {
    assert.deepEqual(
      await verifierWith([
        response({ success: false, "error-codes": [code] }),
      ]).verify({ token: "browser-token", remoteIp: null, now }),
      { kind: "unavailable", reason: "provider_configuration" },
    );
  }
  assert.deepEqual(
    await verifierWith([
      response({ success: false, "error-codes": ["unknown-provider-code"] }),
    ]).verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "invalid_response" },
  );
  assert.deepEqual(
    await verifierWith([
      response({ success: false, "error-codes": [] }),
    ]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "unavailable", reason: "invalid_response" },
  );
});

test("internal provider errors retry once with the same deterministic UUID", async () => {
  const requests = [];
  const verifier = verifierWith(
    [
      response({ success: false, "error-codes": ["internal-error"] }),
      response(validPayload),
    ],
    requests,
  );
  assert.deepEqual(
    await verifier.verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "valid" },
  );
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].init.body.get("idempotency_key"),
    requests[1].init.body.get("idempotency_key"),
  );

  assert.deepEqual(
    await verifierWith([
      response({ success: false, "error-codes": ["internal-error"] }),
      response({ success: false, "error-codes": ["internal-error"] }),
    ]).verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "provider_internal" },
  );
});

test("HTTP, network, and timeout failures remain provider unavailability", async () => {
  assert.deepEqual(
    await verifierWith([response({}, 500), response(validPayload)]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "valid" },
  );
  assert.deepEqual(
    await verifierWith([response({}, 429)]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "unavailable", reason: "http" },
  );
  assert.deepEqual(
    await verifierWith([new Error("offline"), new Error("offline")]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "unavailable", reason: "network" },
  );

  const timeoutPolicy = {
    ...PUBLIC_ABUSE_POLICY,
    turnstileTimeoutMilliseconds: 5,
  };
  const hanging = verifierWith(
    [
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    ],
    [],
    { policy: timeoutPolicy },
  );
  assert.deepEqual(
    await hanging.verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "timeout" },
  );
});

test("response-body timeout and network errors use the retry-aware path", async () => {
  const timeoutPolicy = {
    ...PUBLIC_ABUSE_POLICY,
    turnstileTimeoutMilliseconds: 5,
  };
  const timeoutRequests = [];
  const bodyStall = verifierWith(
    [
      (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener("abort", () =>
                controller.error(new Error("body aborted")),
              );
            },
          }),
        ),
    ],
    timeoutRequests,
    { policy: timeoutPolicy },
  );
  assert.deepEqual(
    await bodyStall.verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "timeout" },
  );
  assert.equal(timeoutRequests.length, 2);
  assert.equal(
    timeoutRequests[0].init.body.get("idempotency_key"),
    timeoutRequests[1].init.body.get("idempotency_key"),
  );

  const networkRequests = [];
  const bodyError = verifierWith(
    [
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              queueMicrotask(() => controller.error(new Error("body reset")));
            },
          }),
        ),
    ],
    networkRequests,
  );
  assert.deepEqual(
    await bodyError.verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "network" },
  );
  assert.equal(networkRequests.length, 2);
});

test("malformed, invalid UTF-8, and oversized provider bodies are bounded", async () => {
  assert.deepEqual(
    await verifierWith([new Response("not json")]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "unavailable", reason: "invalid_response" },
  );
  assert.deepEqual(
    await verifierWith([
      new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
    ]).verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "invalid_response" },
  );
  assert.deepEqual(
    await verifierWith([
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(16 * 1024 + 1) },
      }),
    ]).verify({ token: "browser-token", remoteIp: null, now }),
    { kind: "unavailable", reason: "invalid_response" },
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  assert.deepEqual(
    await verifierWith([new Response(stream)]).verify({
      token: "browser-token",
      remoteIp: null,
      now,
    }),
    { kind: "unavailable", reason: "invalid_response" },
  );
});

test("oversized tokens are rejected without contacting Siteverify", async () => {
  const requests = [];
  const verifier = verifierWith([response(validPayload)], requests);
  assert.deepEqual(
    await verifier.verify({
      token: "x".repeat(PUBLIC_ABUSE_POLICY.turnstileTokenCharacters + 1),
      remoteIp: null,
      now,
    }),
    { kind: "invalid", reason: "provider_rejected" },
  );
  assert.equal(requests.length, 0);
});
