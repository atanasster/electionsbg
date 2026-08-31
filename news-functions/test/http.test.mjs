import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { allowedOrigins, handleNewsEvalsRequest } from "../lib/http.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const validSubmission = JSON.parse(
  readFileSync(
    resolve(ROOT, "news/eval_contract/fixtures/stale_content.json"),
    "utf8",
  ),
).value;
const publicRequestBytes = JSON.parse(
  readFileSync(resolve(ROOT, "news/eval_contract/contract.json"), "utf8"),
).limits.public_request_bytes;
const config = {
  allowedOrigins: new Set(["https://news.electionsbg.com"]),
};

function invoke(request, initialHeaders = {}) {
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
  handleNewsEvalsRequest(request, response, config);
  return {
    status,
    headers,
    body,
    json: body ? JSON.parse(body) : undefined,
  };
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

test("only the two exact public route shapes are recognized", () => {
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

test("a schema-valid submission remains storage-closed", () => {
  const result = submit();
  assertSafeError(result, 503, "service_unavailable");
});
