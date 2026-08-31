import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { canonicalSha256 } from "../lib/eval-contract/canonical.js";
import { deriveTaskRevision, FirestoreOperatorStore } from "../lib/operator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-news-evals";
const HOSTING_ORIGIN = "http://127.0.0.1:5002";
const FIRESTORE_ORIGIN = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;
const ARTICLE_KEY = "example.bg/article-1";
const TASK_ID = Buffer.from(ARTICLE_KEY, "utf8").toString("base64url");
const CONTENT_HASH = `sha256:${"a".repeat(64)}`;
const ANALYSIS_HASH = `sha256:${"b".repeat(64)}`;

const fixture = JSON.parse(
  readFileSync(
    resolve(ROOT, "news/eval_contract/fixtures/stale_content.json"),
    "utf8",
  ),
);

function request(overrides = {}) {
  const value = structuredClone(fixture.value);
  value.content_sha256 = CONTENT_HASH;
  value.analysis_sha256 = ANALYSIS_HASH;
  value.idempotency_key = "emulator-idempotency-0001";
  value.browser_nonce = "emulator-browser-nonce-01";
  value.turnstile_token = "emulator-valid-first";
  return Object.assign(value, overrides);
}

async function http(path, options = {}) {
  const response = await fetch(`${HOSTING_ORIGIN}${path}`, options);
  const body = await response.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Some framework-level malformed-JSON responses are intentionally opaque.
  }
  return { response, body, json };
}

function sizedUnknownJson(bytes) {
  const prefix = '{"padding":"';
  const suffix = '"}';
  const padding = bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(padding >= 0);
  const body = `${prefix}${"x".repeat(padding)}${suffix}`;
  assert.equal(Buffer.byteLength(body), bytes);
  return body;
}

async function collectionDocuments(database, name) {
  return (await database.collection(name).get()).docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

const app = initializeApp({ projectId: PROJECT_ID }, "news-evals-integration");
const database = getFirestore(app);

try {
  await database.doc(`news_eval_tasks/${TASK_ID}`).set({
    article_key: ARTICLE_KEY,
    revision: 4,
    content_sha256: CONTENT_HASH,
    analysis_sha256: ANALYSIS_HASH,
    model_labels: {
      leaning: "neutral",
      russia_stance: "not_applicable",
      party_tones: [],
      private_excerpt: "must never cross the public boundary",
    },
    accepts_public_evals: true,
  });

  const root = await http("/");
  assert.equal(root.response.status, 200);
  assert.match(root.body, /News evaluation emulator fixture/);

  const nearMisses = [
    "/api/news-evals/submit/",
    "/api/news-evals/aggregate/example.bg/article-1/extra",
    "/api/news-evals/aggregate/example.bg/a%2Fb",
    "/api/news-evals/aggregate/EXAMPLE.bg/article-1",
  ];
  for (const path of nearMisses) {
    const result = await http(path);
    assert.equal(result.response.status, 404, path);
    assert.equal(result.json?.error?.code, "not_found", path);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  }

  const foreignPreflight = await http("/api/news-evals/submit", {
    method: "OPTIONS",
    headers: {
      Origin: "https://attacker.invalid",
      "Access-Control-Request-Method": "POST",
    },
  });
  // firebase-tools enables a permissive CORS wrapper around every v2 HTTP
  // function in debug mode, so it answers true preflights before user code.
  // The real origin gate remains pinned below by the actual foreign POST and
  // by the pure-handler suite, which does not install that emulator wrapper.
  assert.equal(foreignPreflight.response.status, 204);
  assert.equal(
    foreignPreflight.response.headers.get("access-control-allow-origin"),
    "https://attacker.invalid",
  );

  const foreignPost = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: "https://attacker.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request()),
  });
  assert.equal(foreignPost.response.status, 403);
  assert.equal(foreignPost.json?.error?.code, "forbidden_origin");
  assert.equal(
    foreignPost.response.headers.get("access-control-allow-origin"),
    "https://attacker.invalid",
  );

  const exactLimit = await http("/api/news-evals/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: sizedUnknownJson(65_536),
  });
  assert.equal(exactLimit.response.status, 422);
  assert.equal(exactLimit.json?.error?.code, "invalid_request");

  const overLimit = await http("/api/news-evals/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: sizedUnknownJson(65_537),
  });
  assert.equal(overLimit.response.status, 413);
  assert.equal(overLimit.json?.error?.code, "payload_too_large");

  const malformed = await http("/api/news-evals/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"broken"',
  });
  assert.equal(malformed.response.status, 400);

  const invalidChallenge = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: HOSTING_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      request({ turnstile_token: "emulator-invalid-challenge" }),
    ),
  });
  assert.equal(invalidChallenge.response.status, 422);
  assert.equal(invalidChallenge.json?.error?.code, "challenge_failed");
  assert.equal(
    (await collectionDocuments(database, "news_eval_submissions")).length,
    0,
  );

  const stale = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: HOSTING_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      request({
        base_task_revision: 3,
        idempotency_key: "emulator-stale-key-0001",
        browser_nonce: "emulator-stale-browser-01",
        turnstile_token: "emulator-valid-stale",
      }),
    ),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.json?.error?.code, "stale_task");
  assert.equal(stale.json?.error?.current_revision, 4);

  const firstRequest = request();
  const accepted = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: HOSTING_ORIGIN,
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.99",
    },
    body: JSON.stringify(firstRequest),
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.json?.idempotent, false);
  assert.equal(accepted.json?.submission?.status, "raw");
  assert.deepEqual(accepted.json?.submission?.model_labels, {
    leaning: "neutral",
    russia_stance: "not_applicable",
    party_tones: [],
  });
  assert.equal(accepted.response.headers.get("cache-control"), "no-store");
  assert.equal(
    accepted.response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(
    accepted.response.headers.get("access-control-allow-origin"),
    HOSTING_ORIGIN,
  );

  const retry = request({
    turnstile_token: "emulator-valid-retry",
    browser_nonce: "emulator-retry-browser-01",
  });
  const idempotent = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: HOSTING_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(retry),
  });
  assert.equal(idempotent.response.status, 200);
  assert.equal(idempotent.json?.idempotent, true);
  assert.equal(
    idempotent.json?.submission?.submission_id,
    accepted.json?.submission?.submission_id,
  );

  const duplicate = request({
    idempotency_key: "emulator-idempotency-0002",
    turnstile_token: "emulator-valid-duplicate",
  });
  const duplicateResult = await http("/api/news-evals/submit", {
    method: "POST",
    headers: {
      Origin: HOSTING_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(duplicate),
  });
  assert.equal(duplicateResult.response.status, 409);
  assert.equal(duplicateResult.json?.error?.code, "duplicate_submission");

  const submissions = await collectionDocuments(
    database,
    "news_eval_submissions",
  );
  assert.equal(submissions.length, 1);
  const aggregateDocuments = await collectionDocuments(
    database,
    "news_eval_aggregates",
  );
  const dedupeDocuments = await collectionDocuments(
    database,
    "news_eval_dedupe",
  );
  assert.equal(aggregateDocuments.length, 1);
  assert.equal(aggregateDocuments[0].valid_submission_count, 1);

  const persisted = JSON.stringify({
    submissions,
    dedupe: dedupeDocuments,
    abuse: await collectionDocuments(database, "news_eval_abuse"),
    rate: await collectionDocuments(database, "news_eval_rate"),
    aggregates: aggregateDocuments,
  });
  assert.doesNotMatch(
    persisted,
    /203\.0\.113\.99|emulator-valid-|emulator-browser-nonce|must never cross/,
  );
  for (const rawIdentifier of [
    "emulator-idempotency-0001",
    "emulator-idempotency-0002",
    "emulator-browser-nonce-01",
    "emulator-retry-browser-01",
    "emulator-stale-key-0001",
    "emulator-stale-browser-01",
  ]) {
    assert.equal(
      persisted.includes(rawIdentifier),
      false,
      `${rawIdentifier} must not be persisted`,
    );
  }
  const browserTombstones = dedupeDocuments.filter(
    (document) => document.kind === "browser_article_revision",
  );
  assert.equal(browserTombstones.length, 1);
  assert.equal("request_fingerprint" in browserTombstones[0], false);

  const aggregate = await http(
    "/api/news-evals/aggregate/example.bg/article-1",
    { headers: { Origin: HOSTING_ORIGIN } },
  );
  assert.equal(aggregate.response.status, 200);
  assert.deepEqual(aggregate.json, {
    article_key: ARTICLE_KEY,
    task_revision: 4,
    state: "more_evaluations_needed",
    public_distribution: false,
  });
  assert.equal(aggregate.response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(aggregate.body, /valid_submission_count|leaning_counts/);

  const directFirestore = await fetch(
    `${FIRESTORE_ORIGIN}/v1/projects/${PROJECT_ID}/databases/(default)/documents/news_eval_tasks/${TASK_ID}`,
  );
  assert.equal(directFirestore.status, 403);

  const operator = new FirestoreOperatorStore(database);
  const exported = await operator.exportSubmissions(PROJECT_ID);
  assert.equal(exported.manifest.record_count, 1);
  assert.equal(
    exported.records[0].submission_id,
    accepted.json?.submission?.submission_id,
  );
  assert.doesNotMatch(JSON.stringify(exported), /must never cross|abuse_ref/);

  await database.doc(`news_eval_tasks/${TASK_ID}`).update({
    model_labels: {
      leaning: "neutral",
      russia_stance: "not_applicable",
      party_tones: [],
    },
  });
  const sourceSubmissionId = exported.records[0].submission_id;
  const reviewResult = await operator.apply({
    schema_version: 1,
    operation_id: "emulator-review-operation-0001",
    occurred_at: "2026-08-31T13:00:00.000Z",
    actor: { kind: "maintainer", id: "emulator-editor" },
    action: "submission_reviewed",
    article_key: ARTICLE_KEY,
    content_sha256: CONTENT_HASH,
    source_submission_ids: [sourceSubmissionId],
    reason: "Emulator integration review.",
  });
  assert.equal(reviewResult.status, "reviewed");
  assert.equal(reviewResult.idempotent, false);

  const acceptanceCommand = {
    schema_version: 1,
    operation_id: "emulator-accept-operation-0001",
    occurred_at: "2026-08-31T13:01:00.000Z",
    actor: { kind: "maintainer", id: "emulator-editor" },
    action: "adjudication_accepted",
    article_key: ARTICLE_KEY,
    content_sha256: CONTENT_HASH,
    source_submission_ids: [sourceSubmissionId],
    expected_task_revision: 4,
    analysis_sha256: ANALYSIS_HASH,
    expected_adjudication_revision: 0,
    evaluation: exported.records[0].evaluation,
    public_explanation: "Проверено спрямо оригиналния материал.",
    reason: "Emulator integration acceptance.",
  };
  const promotionResult = await operator.apply(acceptanceCommand);
  assert.equal(promotionResult.status, "accepted");
  assert.equal(promotionResult.adjudicationRevision, 1);
  assert.equal(promotionResult.idempotent, false);
  assert.equal((await operator.apply(acceptanceCommand)).idempotent, true);

  const promotedSubmission = await database
    .doc(`news_eval_submissions/${sourceSubmissionId}`)
    .get();
  assert.equal(promotedSubmission.data()?.status, "promoted");
  const adjudication = await database
    .doc(`news_eval_adjudications/${TASK_ID}`)
    .get();
  assert.equal(adjudication.data()?.revision, 1);
  assert.equal(adjudication.data()?.analysis_sha256, ANALYSIS_HASH);
  const acceptanceEvent = await database
    .doc("news_eval_events/emulator-accept-operation-0001")
    .get();
  assert.equal(acceptanceEvent.data()?.action, "adjudication_accepted");

  const beforeConflict = JSON.stringify({
    submission: promotedSubmission.data(),
    adjudication: adjudication.data(),
    events: await collectionDocuments(database, "news_eval_events"),
  });
  await assert.rejects(
    () =>
      operator.apply({
        ...acceptanceCommand,
        operation_id: "emulator-accept-operation-0002",
        expected_task_revision: 3,
        expected_adjudication_revision: 1,
      }),
    /task or analysis revision is stale/,
  );
  const afterConflict = JSON.stringify({
    submission: (
      await database.doc(`news_eval_submissions/${sourceSubmissionId}`).get()
    ).data(),
    adjudication: (
      await database.doc(`news_eval_adjudications/${TASK_ID}`).get()
    ).data(),
    events: await collectionDocuments(database, "news_eval_events"),
  });
  assert.equal(afterConflict, beforeConflict);

  const syncedTask = {
    schema_version: 1,
    rubric_version: "news-article-evaluation-v1",
    article_key: ARTICLE_KEY,
    domain: "example.bg",
    article_id: "article-1",
    url: "https://example.bg/article-1",
    title: "Emulator public article",
    published: "2026-08-31T09:00:00.000Z",
    story_id: "story-1",
    primary_topic: "government",
    outlet: "example.bg",
    content_sha256: CONTENT_HASH,
    public_data_revision: "2026-08-31T11:00:00.000Z",
    analysis_sha256: ANALYSIS_HASH,
    model: "emulator-model",
    analyzed_at: "2026-08-31T10:00:00.000Z",
    prompt_hashes: {},
    model_labels: {
      leaning: "neutral",
      russia_stance: "not_applicable",
      party_tones: [],
    },
    review_reasons: { leaning: "Emulator review route." },
    dataset_ids: ["community-emulator-v1"],
    accepts_public_evals: true,
    revision: deriveTaskRevision(CONTENT_HASH, ANALYSIS_HASH, {
      leaning: "neutral",
      russia_stance: "not_applicable",
      party_tones: [],
    }),
    updated_at: "2026-08-31T11:00:00.000Z",
  };
  const taskManifest = {
    schema_version: 1,
    manifest_kind: "news-eval-task-sync",
    generated_at: "2026-08-31T11:00:00.000Z",
    public_data_revision: "2026-08-31T11:00:00.000Z",
    rubric_version: "news-article-evaluation-v1",
    task_count: 1,
    tasks_sha256: canonicalSha256([syncedTask]),
    queue_sha256: `sha256:${"d".repeat(64)}`,
    tasks: [syncedTask],
  };
  const releaseProof = {
    publicDataRevision: taskManifest.public_data_revision,
    queueSha256: taskManifest.queue_sha256,
    runId: "emulator-release-20260831",
    liveManifestUrl: "https://example.test/news/app-data/manifest.json",
  };
  const taskSync = await operator.syncTasks(taskManifest, releaseProof);
  assert.equal(taskSync.updated, 1);
  assert.equal(taskSync.unchanged, 0);
  const taskSyncRetry = await operator.syncTasks(taskManifest, releaseProof);
  assert.equal(taskSyncRetry.updated, 0);
  assert.equal(taskSyncRetry.unchanged, 1);
  assert.equal(
    (await database.doc("news_eval_sync/task_manifest").get()).data()
      ?.tasks_sha256,
    taskManifest.tasks_sha256,
  );

  console.log("news eval emulator integration: all assertions passed");
} finally {
  await deleteApp(app);
}
