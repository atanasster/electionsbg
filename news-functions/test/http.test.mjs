import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FixedWindowAttemptLimiter, parseHmacKeyring } from "../lib/abuse.js";
import { allowedOrigins, handleNewsEvalsRequest } from "../lib/http.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const validSubmission = JSON.parse(
  readFileSync(
    resolve(ROOT, "news/eval_contract/fixtures/stale_content.json"),
    "utf8",
  ),
).value;
const validFeedback = {
  schema_version: 1,
  article_key: "example.bg/article-1",
  base_task_revision: 9,
  content_sha256: `sha256:${"a".repeat(64)}`,
  analysis_sha256: null,
  target_registry_sha256: `sha256:${"d".repeat(64)}`,
  idempotency_key: "feedback-idempotency-0001",
  turnstile_token: "feedback-provider-token",
  browser_nonce: "feedback-browser-0001",
  feedback: {
    leaning: null,
    russia_stance: null,
    party_tones: [],
    link_proposals: [],
    issue_kinds: ["missing_analysis", "missing_entity"],
    public_note: "Липсва връзка към институцията.",
  },
};
const publicRequestBytes = JSON.parse(
  readFileSync(resolve(ROOT, "news/eval_contract/contract.json"), "utf8"),
).limits.public_request_bytes;
const config = {
  allowedOrigins: new Set(["https://news.electionsbg.com"]),
};
const testKeyring = parseHmacKeyring({
  active: "v1",
  keys: {
    v1: "test-only HMAC secret with at least thirty-two bytes",
  },
});

function securedConfig(verification, overrides = {}) {
  return {
    ...config,
    attemptLimiter: new FixedWindowAttemptLimiter(120),
    security: () => ({
      hmacKeyring: testKeyring,
      turnstileVerifier: { verify: async () => verification },
    }),
    ...overrides,
  };
}

function beginInvoke(request, initialHeaders = {}, runtimeConfig = config) {
  const headers = new Map(
    Object.entries(initialHeaders).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
  let status = 0;
  let body;
  const response = {
    set(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    vary(name) {
      const current = headers.get("vary");
      const fields = new Set(
        String(current ?? "")
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean),
      );
      fields.add(name);
      headers.set("vary", [...fields].join(", "));
      return this;
    },
    status(value) {
      status = value;
      return this;
    },
    send(value) {
      body = value;
    },
  };
  const completion = handleNewsEvalsRequest(request, response, runtimeConfig);
  return {
    completion,
    finish: () => ({
      status,
      headers,
      body,
      json: body ? JSON.parse(body) : undefined,
    }),
  };
}

function invoke(request, initialHeaders = {}) {
  const invocation = beginInvoke(request, initialHeaders);
  assert.equal(invocation.completion, undefined);
  return invocation.finish();
}

async function invokeAsync(request, runtimeConfig, initialHeaders = {}) {
  const invocation = beginInvoke(request, initialHeaders, runtimeConfig);
  await invocation.completion;
  return invocation.finish();
}

function submit(overrides = {}) {
  return invoke({
    method: "POST",
    path: "/api/news-evals/submit",
    headers: {
      origin: "https://news.electionsbg.com",
      "content-type": "application/json; charset=utf-8",
    },
    body: structuredClone(validSubmission),
    ...overrides,
  });
}

function assertSafeError(result, status, code) {
  assert.equal(result.status, status);
  assert.equal(result.json.error.code, code);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(
    result.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.doesNotMatch(result.body, /fixture-token|Материалът|fixture-browser/);
}

test("only the exact public route shapes are recognized", async () => {
  assertSafeError(
    invoke({ method: "GET", path: "/api/news-evals" }),
    404,
    "not_found",
  );
  assertSafeError(
    invoke({ method: "POST", path: "/api/news-evals/submit/" }),
    404,
    "not_found",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path: "/api/news-evals/aggregate/example.bg/article-1",
    }),
    503,
    "service_unavailable",
  );
  assertSafeError(
    await invokeAsync(
      {
        method: "GET",
        path: "/api/news-evals/feedback-task/example.bg/article-1",
      },
      config,
    ),
    503,
    "service_unavailable",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path: "/api/news-evals/aggregate/EXAMPLE.bg/article-1",
    }),
    404,
    "not_found",
  );
  for (const domain of [
    "a-.example.bg",
    `${"a".repeat(64)}.example.bg`,
    `${"a.".repeat(125)}example.bg`,
  ]) {
    assertSafeError(
      invoke({
        method: "GET",
        path: `/api/news-evals/aggregate/${domain}/article-1`,
      }),
      404,
      "not_found",
    );
  }
  assertSafeError(
    invoke({
      method: "GET",
      path: "/api/news-evals/aggregate/xn--e1afmkfd.xn--p1ai/article-1",
    }),
    503,
    "service_unavailable",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path: "/api/news-evals/aggregate/example.bg/a%2Fb",
    }),
    404,
    "not_found",
  );
});

test("recognized routes reject every method outside their allowlist", () => {
  const submission = invoke({ method: "GET", path: "/api/news-evals/submit" });
  assertSafeError(submission, 405, "method_not_allowed");
  assert.equal(submission.headers.get("allow"), "POST");

  const aggregate = invoke({
    method: "POST",
    path: "/api/news-evals/aggregate/example.bg/article-1",
  });
  assertSafeError(aggregate, 405, "method_not_allowed");
  assert.equal(aggregate.headers.get("allow"), "GET");

  const feedback = invoke({
    method: "GET",
    path: "/api/news-evals/feedback",
  });
  assertSafeError(feedback, 405, "method_not_allowed");
  assert.equal(feedback.headers.get("allow"), "POST");
});

test("public feedback tasks and partial raw submissions need no user identity", async () => {
  const feedbackStore = {
    async task(articleKey) {
      assert.equal(articleKey, "example.bg/article-1");
      return {
        kind: "available",
        task: {
          article_key: articleKey,
          revision: 9,
          content_sha256: validFeedback.content_sha256,
          analysis_sha256: null,
          target_registry_sha256: validFeedback.target_registry_sha256,
          public_data_revision: "2026-09-01T08:00:00.000Z",
        },
      };
    },
    async submit(input) {
      assert.equal(input.request.feedback.issue_kinds[0], "missing_analysis");
      assert.equal("user" in input.request, false);
      return {
        kind: "accepted",
        created: true,
        receipt: {
          submission_id: "feedback-submission-1",
          status: "raw",
          article_key: validFeedback.article_key,
          task_revision: validFeedback.base_task_revision,
          submitted_at: "2026-09-01T08:05:00.000Z",
        },
      };
    },
  };
  const taskResult = await invokeAsync(
    {
      method: "GET",
      path: "/api/news-evals/feedback-task/example.bg/article-1",
      headers: { origin: "https://news.electionsbg.com" },
    },
    { ...config, feedbackStore },
  );
  assert.equal(taskResult.status, 200);
  assert.equal(taskResult.json.task.analysis_sha256, null);

  const submitResult = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/feedback",
      headers: {
        origin: "https://news.electionsbg.com",
        "content-type": "application/json",
      },
      body: structuredClone(validFeedback),
    },
    securedConfig({ kind: "valid" }, { feedbackStore }),
  );
  assert.equal(submitResult.status, 201);
  assert.equal(submitResult.json.submission.status, "raw");
});

test("feedback submission rejects invalid fields and maps every store outcome", async () => {
  let verificationCalls = 0;
  const invalid = structuredClone(validFeedback);
  invalid.feedback.party_tones = [
    {
      party: "Примерна партия",
      party_id: null,
      tone: "unsupported",
      evidence: "",
    },
  ];
  const invalidResult = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/feedback",
      headers: { "content-type": "application/json" },
      body: invalid,
    },
    securedConfig(
      { kind: "valid" },
      {
        security: () => ({
          hmacKeyring: testKeyring,
          turnstileVerifier: {
            verify: async () => {
              verificationCalls += 1;
              return { kind: "valid" };
            },
          },
        }),
      },
    ),
  );
  assertSafeError(invalidResult, 422, "invalid_request");
  assert.equal(verificationCalls, 0);

  const outcomes = [
    [{ kind: "task_not_found" }, 404, "task_not_found"],
    [{ kind: "task_unavailable" }, 409, "task_unavailable"],
    [{ kind: "task_conflict", currentRevision: 10 }, 409, "stale_task"],
    [{ kind: "idempotency_conflict" }, 409, "idempotency_conflict"],
    [{ kind: "duplicate_article_revision" }, 409, "duplicate_submission"],
    [
      { kind: "rate_limited", scope: "global", retryAfterSeconds: 90 },
      429,
      "rate_limited",
    ],
  ];
  for (const [outcome, status, code] of outcomes) {
    const result = await invokeAsync(
      {
        method: "POST",
        path: "/api/news-evals/feedback",
        headers: { "content-type": "application/json" },
        body: structuredClone(validFeedback),
      },
      securedConfig(
        { kind: "valid" },
        { feedbackStore: { submit: async () => outcome } },
      ),
    );
    assertSafeError(result, status, code);
  }

  const challenge = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/feedback",
      headers: { "content-type": "application/json" },
      body: structuredClone(validFeedback),
    },
    securedConfig({ kind: "invalid", reasons: ["invalid-input-response"] }),
  );
  assertSafeError(challenge, 422, "challenge_failed");

  const unavailable = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/feedback",
      headers: { "content-type": "application/json" },
      body: structuredClone(validFeedback),
    },
    securedConfig(
      { kind: "valid" },
      {
        feedbackStore: {
          submit: async () => {
            throw new Error("storage unavailable");
          },
        },
      },
    ),
  );
  assertSafeError(unavailable, 503, "service_unavailable");
});

test("CORS echoes only the exact production origin", () => {
  const accepted = submit();
  assertSafeError(accepted, 503, "service_unavailable");
  assert.equal(
    accepted.headers.get("access-control-allow-origin"),
    "https://news.electionsbg.com",
  );
  assert.equal(accepted.headers.get("vary"), "Origin");

  const rejected = submit({
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
  });
  assertSafeError(rejected, 403, "forbidden_origin");
  assert.equal(rejected.headers.has("access-control-allow-origin"), false);

  const preserved = invoke(
    { method: "GET", path: "/api/news-evals/aggregate/example.bg/article-1" },
    { Vary: "Accept-Encoding" },
  );
  assert.equal(preserved.headers.get("vary"), "Accept-Encoding, Origin");
});

test("localhost is allowed only in explicit emulator configuration", () => {
  assert.deepEqual([...allowedOrigins({})], ["https://news.electionsbg.com"]);
  const local = allowedOrigins({
    FUNCTIONS_EMULATOR: "true",
    NEWS_EVAL_LOCAL_ORIGINS:
      "http://localhost:6000,https://evil.example,http://not-local.test",
  });
  assert.equal(local.has("http://127.0.0.1:5190"), true);
  assert.equal(local.has("http://localhost:5190"), true);
  assert.equal(local.has("http://localhost:6000"), true);
  assert.equal(local.has("https://evil.example"), false);
  assert.equal(local.has("http://not-local.test"), false);
  for (const rejected of [
    "ftp://localhost:6000",
    "http://user:secret@localhost:6000",
    "http://localhost:6000/route",
    "http://localhost:6000?query=1",
    "http://localhost:6000#fragment",
  ]) {
    assert.equal(
      allowedOrigins({
        FUNCTIONS_EMULATOR: "true",
        NEWS_EVAL_LOCAL_ORIGINS: rejected,
      }).has(rejected),
      false,
    );
  }
});

test("preflight is HTTP no-store with a 10-minute CORS permission TTL", () => {
  const result = invoke({
    method: "OPTIONS",
    path: "/api/news-evals/submit",
    headers: { origin: "https://news.electionsbg.com" },
  });
  assert.equal(result.status, 204);
  assert.equal(result.body, undefined);
  assert.equal(result.headers.get("access-control-allow-methods"), "POST");
  assert.equal(
    result.headers.get("access-control-allow-headers"),
    "Content-Type",
  );
  assert.equal(result.headers.get("access-control-max-age"), "600");
  assert.equal(result.headers.has("access-control-allow-credentials"), false);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("all recognized routes enforce the exact public request byte boundary", () => {
  assertSafeError(
    submit({ rawBody: Buffer.alloc(publicRequestBytes) }),
    503,
    "service_unavailable",
  );
  assertSafeError(
    submit({ rawBody: Buffer.alloc(publicRequestBytes + 1) }),
    413,
    "payload_too_large",
  );

  const aggregatePath = "/api/news-evals/aggregate/example.bg/article-1";
  assertSafeError(
    invoke({ method: "GET", path: aggregatePath, rawBody: Buffer.alloc(1) }),
    400,
    "unexpected_body",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path: aggregatePath,
      rawBody: Buffer.alloc(publicRequestBytes),
    }),
    400,
    "unexpected_body",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path: aggregatePath,
      rawBody: Buffer.alloc(publicRequestBytes + 1),
    }),
    413,
    "payload_too_large",
  );
});

test("framework-synthesized empty GET bodies remain bodyless", async () => {
  const path = "/api/news-evals/aggregate/example.bg/article-1";
  for (const headers of [{}, { "content-length": "0" }]) {
    const result = await invokeAsync(
      { method: "GET", path, headers, body: {} },
      {
        ...config,
        store: {
          aggregate: async ({ articleKey }) => ({
            kind: "withheld",
            articleKey,
            taskRevision: 1,
            validSubmissionCount: 0,
          }),
        },
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.state, "more_evaluations_needed");
  }

  assertSafeError(
    invoke({
      method: "GET",
      path,
      headers: { "content-length": "2" },
      body: {},
    }),
    400,
    "unexpected_body",
  );
  assertSafeError(
    invoke({
      method: "GET",
      path,
      headers: { "transfer-encoding": "chunked" },
      body: {},
    }),
    400,
    "unexpected_body",
  );
});

test("submit rejects media type, body shape, and schema before storage", () => {
  assertSafeError(
    submit({ headers: { "content-type": "text/plain" } }),
    415,
    "unsupported_media_type",
  );
  assertSafeError(submit({ body: undefined }), 400, "invalid_json");

  const invalid = structuredClone(validSubmission);
  invalid.unexpected = "must fail closed";
  invalid.turnstile_token = "secret-that-must-not-leak";
  const result = submit({ body: invalid });
  assertSafeError(result, 422, "invalid_request");
  assert.doesNotMatch(result.body, /secret-that-must-not-leak|unexpected/);
});

test("legal JSON outside the canonical subset returns a stable 422", () => {
  const adversarialValues = [
    JSON.parse('"\\ud800"'),
    JSON.parse('"\\udfff"'),
    JSON.parse("9007199254740993"),
  ];
  for (const adversarial of adversarialValues) {
    const body = structuredClone(validSubmission);
    body.evaluation.leaning.reason_codes = [adversarial];
    assertSafeError(submit({ body }), 422, "invalid_request");
  }
});

test("the whole canonical subset is rejected before Turnstile", async () => {
  let verificationCalls = 0;
  const runtimeConfig = securedConfig(
    { kind: "valid" },
    {
      security: () => ({
        hmacKeyring: testKeyring,
        turnstileVerifier: {
          verify: async () => {
            verificationCalls += 1;
            return { kind: "valid" };
          },
        },
      }),
    },
  );
  const mutations = [
    (body) => {
      body.evaluation.leaning.evidence = JSON.parse('"\\ud800"');
    },
    (body) => {
      body.evaluation.public_note = JSON.parse('"\\udfff"');
    },
    (body) => {
      body.evaluation.party_tones.push({
        party: JSON.parse('"\\ud800"'),
        party_id: null,
        tone: "neutral",
        evidence: "Конкретна фактическа основа.",
        reason_codes: [],
      });
    },
    (body) => {
      body.base_task_revision = Number.MAX_SAFE_INTEGER + 1;
    },
  ];
  for (const mutate of mutations) {
    const body = structuredClone(validSubmission);
    mutate(body);
    const result = await invokeAsync(
      {
        method: "POST",
        path: "/api/news-evals/submit",
        headers: { "content-type": "application/json" },
        body,
      },
      runtimeConfig,
    );
    assertSafeError(result, 422, "invalid_request");
  }
  assert.equal(verificationCalls, 0);
});

test("a schema-valid submission remains storage-closed", () => {
  const result = submit();
  assertSafeError(result, 503, "service_unavailable");
});

test("valid submissions verify Turnstile before deriving anonymous abuse keys", async () => {
  const prepared = [];
  const fixedClock = { now: () => new Date("2026-08-31T10:15:00.000Z") };
  const runtimeConfig = {
    ...config,
    clock: fixedClock,
    attemptLimiter: new FixedWindowAttemptLimiter(120),
    security: () => ({
      hmacKeyring: testKeyring,
      turnstileVerifier: {
        async verify(input) {
          assert.equal(input.token, "fixture-token");
          assert.equal(input.remoteIp, null);
          assert.deepEqual(input.now, fixedClock.now());
          return { kind: "valid" };
        },
      },
    }),
    store: {
      async submit(input) {
        prepared.push(input.abuse);
        return { kind: "task_unavailable" };
      },
    },
  };
  const request = {
    method: "POST",
    path: "/api/news-evals/submit",
    headers: {
      origin: "https://news.electionsbg.com",
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.5",
    },
    body: structuredClone(validSubmission),
  };
  const result = await invokeAsync(request, runtimeConfig);
  assertSafeError(result, 409, "task_unavailable");
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].day, "2026-08-31");
  assert.doesNotMatch(
    JSON.stringify(prepared[0]),
    /192\.0\.2\.10|198\.51\.100\.5|fixture-browser|fixture-stale/,
  );
});

test("Turnstile rejection and outage return stable non-leaking errors", async () => {
  for (const [verification, status, code] of [
    [{ kind: "invalid", reason: "provider_rejected" }, 422, "challenge_failed"],
    [{ kind: "unavailable", reason: "network" }, 503, "challenge_unavailable"],
  ]) {
    const result = await invokeAsync(
      {
        method: "POST",
        path: "/api/news-evals/submit",
        headers: {
          origin: "https://news.electionsbg.com",
          "content-type": "application/json",
        },
        body: structuredClone(validSubmission),
      },
      securedConfig(verification),
    );
    assertSafeError(result, status, code);
  }

  const thrown = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/submit",
      headers: { "content-type": "application/json" },
      body: structuredClone(validSubmission),
    },
    securedConfig(
      { kind: "valid" },
      {
        security: () => ({
          hmacKeyring: testKeyring,
          turnstileVerifier: {
            verify: async () => {
              throw new Error("provider details must not escape");
            },
          },
        }),
      },
    ),
  );
  assertSafeError(thrown, 503, "challenge_unavailable");
  assert.doesNotMatch(thrown.body, /provider details/);
});

test("the per-instance attempt cap rejects before Siteverify", async () => {
  let verifies = 0;
  const result = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/submit",
      headers: { "content-type": "application/json" },
      body: structuredClone(validSubmission),
    },
    securedConfig(
      { kind: "valid" },
      {
        attemptLimiter: { allow: () => false },
        security: () => ({
          hmacKeyring: testKeyring,
          turnstileVerifier: {
            verify: async () => {
              verifies += 1;
              return { kind: "valid" };
            },
          },
        }),
      },
    ),
  );
  assertSafeError(result, 429, "rate_limited");
  assert.equal(result.headers.get("retry-after"), "60");
  assert.equal(verifies, 0);
});

test("clock, lazy security, and submission failures keep stable boundaries", async () => {
  const request = {
    method: "POST",
    path: "/api/news-evals/submit",
    headers: { "content-type": "application/json" },
    body: structuredClone(validSubmission),
  };
  const clockFailure = await invokeAsync(
    request,
    securedConfig(
      { kind: "valid" },
      {
        clock: {
          now: () => {
            throw new Error("clock detail");
          },
        },
      },
    ),
  );
  assertSafeError(clockFailure, 503, "service_unavailable");

  const configurationFailure = await invokeAsync(request, {
    ...config,
    attemptLimiter: new FixedWindowAttemptLimiter(120),
    security: () => {
      throw new Error("secret detail");
    },
  });
  assertSafeError(configurationFailure, 503, "service_unavailable");

  const storageFailure = await invokeAsync(
    request,
    securedConfig(
      { kind: "valid" },
      {
        store: {
          submit: async () => {
            throw new Error("storage detail");
          },
        },
      },
    ),
  );
  assertSafeError(storageFailure, 503, "service_unavailable");
  assert.doesNotMatch(storageFailure.body, /challenge|storage detail/i);
});

test("security telemetry is bounded and never receives request identifiers", async () => {
  const recorded = [];
  const result = await invokeAsync(
    {
      method: "POST",
      path: "/api/news-evals/submit",
      headers: { "content-type": "application/json" },
      body: structuredClone(validSubmission),
    },
    securedConfig(
      { kind: "invalid", reason: "provider_rejected" },
      {
        metrics: {
          record: (...fields) => recorded.push(fields),
        },
      },
    ),
  );
  assertSafeError(result, 422, "challenge_failed");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][0], "challenge_invalid_provider");
  assert.equal(typeof recorded[0][1], "number");
  assert.doesNotMatch(
    JSON.stringify(recorded),
    /fixture-token|fixture-browser|fixture-stale|Материалът/,
  );
});

test("submission transaction outcomes map to stable public responses", async () => {
  const request = {
    method: "POST",
    path: "/api/news-evals/submit",
    headers: { "content-type": "application/json" },
    body: structuredClone(validSubmission),
  };
  const receipt = {
    submission_id: "submission-1",
    status: "raw",
    article_key: validSubmission.article_key,
    task_revision: validSubmission.base_task_revision,
    submitted_at: "2026-08-31T10:15:00.000Z",
    evaluation: validSubmission.evaluation,
    model_labels: {
      leaning: "neutral",
      russia_stance: "not_applicable",
      party_tones: [],
    },
  };
  for (const [outcome, status, code] of [
    [{ kind: "task_not_found" }, 404, "task_not_found"],
    [{ kind: "task_unavailable" }, 409, "task_unavailable"],
    [{ kind: "task_conflict", currentRevision: 5 }, 409, "stale_task"],
    [{ kind: "invalid_evaluation" }, 422, "invalid_evaluation"],
    [{ kind: "idempotency_conflict" }, 409, "idempotency_conflict"],
    [{ kind: "duplicate_article_revision" }, 409, "duplicate_submission"],
    [
      { kind: "rate_limited", scope: "browser", retryAfterSeconds: 12_345 },
      429,
      "rate_limited",
    ],
  ]) {
    const result = await invokeAsync(
      request,
      securedConfig(
        { kind: "valid" },
        { store: { submit: async () => outcome } },
      ),
    );
    assertSafeError(result, status, code);
    if (code === "stale_task")
      assert.equal(result.json.error.current_revision, 5);
    if (code === "rate_limited")
      assert.equal(result.headers.get("retry-after"), "12345");
  }

  for (const [created, status, idempotent] of [
    [true, 201, false],
    [false, 200, true],
  ]) {
    const result = await invokeAsync(
      request,
      securedConfig(
        { kind: "valid" },
        {
          store: {
            submit: async () => ({
              kind: "accepted",
              created,
              receipt,
            }),
          },
        },
      ),
    );
    assert.equal(result.status, status);
    assert.equal(result.json.idempotent, idempotent);
    assert.equal(result.json.submission.submission_id, "submission-1");
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
});

test("aggregate reads never expose withheld distributions", async () => {
  const request = {
    method: "GET",
    path: "/api/news-evals/aggregate/example.bg/article-1",
    headers: { origin: "https://news.electionsbg.com" },
  };
  const withheld = await invokeAsync(request, {
    ...config,
    store: {
      aggregate: async ({ articleKey }) => ({
        kind: "withheld",
        articleKey,
        taskRevision: 4,
        validSubmissionCount: 500,
      }),
    },
  });
  assert.equal(withheld.status, 200);
  assert.deepEqual(withheld.json, {
    article_key: "example.bg/article-1",
    task_revision: 4,
    state: "more_evaluations_needed",
    public_distribution: false,
  });
  assert.doesNotMatch(withheld.body, /500|counts|submission_id/);
  assert.equal(withheld.headers.get("cache-control"), "no-store");

  const missing = await invokeAsync(request, {
    ...config,
    store: { aggregate: async () => ({ kind: "task_not_found" }) },
  });
  assertSafeError(missing, 404, "task_not_found");

  const failed = await invokeAsync(request, {
    ...config,
    store: {
      aggregate: async () => {
        throw new Error("database detail");
      },
    },
  });
  assertSafeError(failed, 503, "service_unavailable");
  assert.doesNotMatch(failed.body, /database detail/);
});
