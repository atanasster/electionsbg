import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessAbuse,
  deriveAbuseContext,
  FixedWindowAttemptLimiter,
  parseHmacKeyring,
  requestFingerprintMatches,
} from "../lib/abuse.js";
import { PUBLIC_ABUSE_POLICY } from "../lib/contract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const submission = JSON.parse(
  readFileSync(
    resolve(ROOT, "news/eval_contract/fixtures/stale_content.json"),
    "utf8",
  ),
).value;
const now = new Date("2026-08-31T10:15:00.000Z");
const keyring = parseHmacKeyring({
  active: "v2",
  keys: {
    v1: "old test-only HMAC secret with at least thirty-two bytes",
    v2: "active test-only HMAC secret with at least thirty-two bytes",
  },
});

function context(overrides = {}, ring = keyring) {
  const semanticRequest = structuredClone(submission);
  return deriveAbuseContext(
    {
      articleKey: semanticRequest.article_key,
      taskRevision: semanticRequest.base_task_revision,
      idempotencyKey: semanticRequest.idempotency_key,
      browserNonce: semanticRequest.browser_nonce,
      semanticRequest,
      now,
      ...overrides,
    },
    ring,
  );
}

test("HMAC keyrings require one active, versioned, high-entropy key", () => {
  assert.equal(keyring.activeVersion, "v2");
  assert.deepEqual(
    keyring.keys.map(({ version }) => version),
    ["v2", "v1"],
  );
  for (const invalid of [
    null,
    {},
    { active: "V1", keys: { V1: "x".repeat(32) } },
    { active: "v2", keys: { v1: "x".repeat(32) } },
    { active: "v1", keys: { v1: "short" } },
    {
      active: "v1",
      keys: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
          `v${index + 1}`,
          "x".repeat(32),
        ]),
      ),
    },
  ]) {
    assert.throws(() => parseHmacKeyring(invalid));
  }
});

test("abuse keys are deterministic, versioned, and contain no raw identifier", () => {
  const first = context();
  const second = context();
  assert.deepEqual(first, second);
  assert.equal(first.day, "2026-08-31");
  assert.equal(first.activeKeyVersion, "v2");
  assert.notEqual(first.activeBrowserDayKey, first.globalDayKey);
  assert.notEqual(first.abuseRef, first.globalDayKey);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(
    serialized,
    /fixture-browser-01|fixture-stale-0001|example\.bg|Материалът/,
  );
});

test("daily counters rotate while durable dedupe and idempotency stay stable", () => {
  const first = context();
  const nextDay = context({ now: new Date("2026-09-01T00:00:01.000Z") });
  assert.notEqual(first.globalDayKey, nextDay.globalDayKey);
  assert.notEqual(first.activeBrowserDayKey, nextDay.activeBrowserDayKey);
  assert.equal(
    first.activeBrowserArticleRevisionKey,
    nextDay.activeBrowserArticleRevisionKey,
  );
  assert.deepEqual(first.activeIdempotency, nextDay.activeIdempotency);
});

test("missing disposable browser nonce omits browser counters and tombstones", () => {
  const result = context({ browserNonce: null });
  assert.equal(result.activeBrowserDayKey, null);
  assert.equal(result.activeBrowserArticleRevisionKey, null);
  assert.deepEqual(result.browserDayLookupKeys, []);
  assert.deepEqual(result.browserArticleRevisionLookupKeys, []);
  assert.ok(result.globalDayKey);
  assert.ok(result.activeIdempotency.key);
});

test("retry-only fields do not alter the semantic request fingerprint", () => {
  const first = context();
  const retryRequest = structuredClone(submission);
  retryRequest.turnstile_token = "a-different-single-use-token";
  retryRequest.idempotency_key = "a-different-idempotency-key";
  retryRequest.browser_nonce = "a-different-browser-nonce";
  const retry = context({ semanticRequest: retryRequest });
  assert.equal(
    first.activeIdempotency.requestFingerprint,
    retry.activeIdempotency.requestFingerprint,
  );

  const changedRequest = structuredClone(submission);
  changedRequest.evaluation.leaning.label = "strong_progressive";
  const changed = context({ semanticRequest: changedRequest });
  assert.notEqual(
    first.activeIdempotency.requestFingerprint,
    changed.activeIdempotency.requestFingerprint,
  );
});

test("active and previous HMAC versions are both available for rotation-safe lookup", () => {
  const rotated = context();
  assert.equal(rotated.idempotencyLookups.length, 2);
  assert.equal(rotated.browserArticleRevisionLookupKeys.length, 2);
  const oldOnly = parseHmacKeyring({
    active: "v1",
    keys: { v1: "old test-only HMAC secret with at least thirty-two bytes" },
  });
  const old = context({}, oldOnly);
  assert.deepEqual(rotated.idempotencyLookups[1], old.activeIdempotency);
  assert.equal(
    rotated.browserArticleRevisionLookupKeys[1],
    old.activeBrowserArticleRevisionKey,
  );
});

test("retention applies only to expiring abuse and rate sidecars", () => {
  const result = context();
  assert.equal(
    result.abuseExpiresAt.toISOString(),
    new Date(
      now.getTime() +
        PUBLIC_ABUSE_POLICY.abuseMetadataRetentionHours * 60 * 60 * 1000,
    ).toISOString(),
  );
  assert.equal(
    result.rateExpiresAt.toISOString(),
    new Date(
      now.getTime() +
        PUBLIC_ABUSE_POLICY.rateMetadataRetentionHours * 60 * 60 * 1000,
    ).toISOString(),
  );
  assert.equal("expiresAt" in result.activeIdempotency, false);
  assert.equal(typeof result.activeBrowserArticleRevisionKey, "string");
});

test("fingerprint comparisons are exact and timing-safe for equal lengths", () => {
  assert.equal(requestFingerprintMatches("abc", "abc"), true);
  assert.equal(requestFingerprintMatches("abc", "abd"), false);
  assert.equal(requestFingerprintMatches("abc", "longer"), false);
});

const openSnapshot = {
  idempotentSubmissionId: null,
  idempotentRequestMatches: false,
  browserArticleRevisionExists: false,
  globalDayCount: 0,
  browserDayCount: 0,
};

test("idempotency binding and one-per-article decisions precede rate limits", () => {
  assert.deepEqual(
    assessAbuse({
      ...openSnapshot,
      idempotentSubmissionId: "submission-1",
      idempotentRequestMatches: true,
      browserArticleRevisionExists: true,
      globalDayCount: Number.MAX_SAFE_INTEGER,
    }),
    { kind: "idempotent", submissionId: "submission-1" },
  );
  assert.deepEqual(
    assessAbuse({
      ...openSnapshot,
      idempotentSubmissionId: "submission-1",
    }),
    { kind: "idempotency_conflict" },
  );
  assert.deepEqual(
    assessAbuse({
      ...openSnapshot,
      browserArticleRevisionExists: true,
      globalDayCount: Number.MAX_SAFE_INTEGER,
    }),
    { kind: "duplicate_article_revision" },
  );
});

test("global and browser limits fail closed at their exact boundaries", () => {
  assert.deepEqual(assessAbuse(openSnapshot), { kind: "allow" });
  assert.deepEqual(
    assessAbuse({
      ...openSnapshot,
      globalDayCount: PUBLIC_ABUSE_POLICY.globalDailySubmissions,
    }),
    { kind: "rate_limited", scope: "global" },
  );
  assert.deepEqual(
    assessAbuse({
      ...openSnapshot,
      browserDayCount: PUBLIC_ABUSE_POLICY.browserDailySubmissions,
    }),
    { kind: "rate_limited", scope: "browser" },
  );
  assert.deepEqual(assessAbuse({ ...openSnapshot, globalDayCount: -1 }), {
    kind: "rate_limited",
    scope: "global",
  });
});

test("the per-instance Siteverify attempt limiter is exact and window-bounded", () => {
  const limiter = new FixedWindowAttemptLimiter(2, 60_000);
  assert.equal(limiter.allow(new Date("2026-08-31T10:15:00.000Z")), true);
  assert.equal(limiter.allow(new Date("2026-08-31T10:15:59.999Z")), true);
  assert.equal(limiter.allow(new Date("2026-08-31T10:15:59.999Z")), false);
  assert.equal(limiter.allow(new Date("2026-08-31T10:16:00.000Z")), true);
  assert.equal(limiter.allow(new Date(Number.NaN)), false);
  assert.throws(() => new FixedWindowAttemptLimiter(0));
});
