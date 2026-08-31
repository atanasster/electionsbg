import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveAbuseContext, parseHmacKeyring } from "../lib/abuse.js";
import { PUBLIC_ABUSE_POLICY } from "../lib/contract.js";
import { FirestoreEvaluationStore } from "../lib/storage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const fixture = JSON.parse(
  readFileSync(
    resolve(ROOT, "news/eval_contract/fixtures/stale_content.json"),
    "utf8",
  ),
);
const now = new Date("2026-08-31T10:15:00.000Z");
const keyring = parseHmacKeyring({
  active: "v2",
  keys: {
    v1: "old test-only HMAC secret with at least thirty-two bytes",
    v2: "active test-only HMAC secret with at least thirty-two bytes",
  },
});

function clone(value) {
  return structuredClone(value);
}

class FakeSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }

  data() {
    return this.value === undefined ? undefined : clone(this.value);
  }
}

class FakeReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.slice(path.lastIndexOf("/") + 1);
  }

  async get() {
    return new FakeSnapshot(this.database.documents.get(this.path));
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
  }

  collection(name) {
    return {
      doc: (id) => new FakeReference(this, `${name}/${id}`),
    };
  }

  async runTransaction(callback) {
    const staged = new Map();
    const transaction = {
      get: async (reference) =>
        new FakeSnapshot(this.documents.get(reference.path)),
      set: (reference, data, options) => {
        const current = options?.merge
          ? (this.documents.get(reference.path) ?? {})
          : {};
        staged.set(reference.path, { ...clone(current), ...clone(data) });
      },
    };
    const result = await callback(transaction);
    for (const [path, value] of staged) this.documents.set(path, value);
    return result;
  }
}

function encoded(articleKey) {
  return Buffer.from(articleKey, "utf8").toString("base64url");
}

function task(overrides = {}) {
  return {
    article_key: fixture.task.article_key,
    revision: fixture.task.revision,
    content_sha256: fixture.task.content_sha256,
    analysis_sha256: fixture.task.analysis_sha256,
    model_labels: clone(fixture.task.model_labels),
    accepts_public_evals: true,
    ...overrides,
  };
}

function request(overrides = {}) {
  const value = clone(fixture.value);
  value.content_sha256 = fixture.task.content_sha256;
  value.analysis_sha256 = fixture.task.analysis_sha256;
  return Object.assign(value, overrides);
}

function abuse(value) {
  return deriveAbuseContext(
    {
      articleKey: value.article_key,
      taskRevision: value.base_task_revision,
      idempotencyKey: value.idempotency_key,
      browserNonce: value.browser_nonce,
      semanticRequest: value,
      now,
    },
    keyring,
  );
}

function setup(seed = {}) {
  const articleKey = fixture.task.article_key;
  const database = new FakeFirestore({
    [`news_eval_tasks/${encoded(articleKey)}`]: task(),
    ...seed,
  });
  return { database, store: new FirestoreEvaluationStore(database) };
}

async function submit(store, value) {
  return store.submit({ request: value, abuse: abuse(value), now });
}

function collection(database, name) {
  return [...database.documents.entries()].filter(([path]) =>
    path.startsWith(`${name}/`),
  );
}

test("one transaction stores a normalized raw submission and bounded counters", async () => {
  const { database, store } = setup();
  const value = request();
  const outcome = await submit(store, value);
  assert.equal(outcome.kind, "accepted");
  assert.equal(outcome.created, true);
  assert.equal(outcome.receipt.evaluation.leaning.disposition, "confirmed");
  assert.equal(
    outcome.receipt.evaluation.russia_stance.disposition,
    "confirmed",
  );
  assert.equal(collection(database, "news_eval_submissions").length, 1);
  assert.equal(collection(database, "news_eval_dedupe").length, 2);
  assert.equal(collection(database, "news_eval_rate").length, 2);
  assert.equal(collection(database, "news_eval_abuse").length, 1);
  const aggregate = collection(database, "news_eval_aggregates")[0][1];
  assert.equal(aggregate.valid_submission_count, 1);
  assert.equal(aggregate.distinct_browser_count, 1);
  assert.equal(aggregate.leaning_counts.neutral, 1);
  assert.equal(aggregate.russia_stance_counts.not_applicable, 1);
  assert.equal(aggregate.party_pair_count, 0);
  assert.equal("party_tone_counts" in aggregate, false);
  assert.equal(aggregate.public_distribution_enabled, false);

  const serialized = JSON.stringify([...database.documents]);
  assert.doesNotMatch(
    serialized,
    /fixture-token|fixture-browser-01|fixture-stale-0001/,
  );
  const dedupe = collection(database, "news_eval_dedupe");
  assert.equal(
    dedupe.some(([, data]) => "expires_at" in data),
    false,
  );
  assert.equal(
    dedupe.some(([, data]) => "receipt" in data),
    false,
  );
  const browserTombstone = dedupe.find(
    ([, data]) => data.kind === "browser_article_revision",
  )[1];
  assert.equal("request_fingerprint" in browserTombstone, false);
});

test("an exact retry returns the original receipt without incrementing", async () => {
  const { database, store } = setup();
  const value = request();
  const first = await submit(store, value);
  const secondValue = clone(value);
  secondValue.turnstile_token = "a-fresh-provider-token";
  secondValue.browser_nonce = "a-fresh-browser-nonce";
  const second = await submit(store, secondValue);
  assert.equal(first.kind, "accepted");
  assert.equal(second.kind, "accepted");
  assert.equal(second.created, false);
  assert.equal(second.receipt.submission_id, first.receipt.submission_id);
  assert.equal(collection(database, "news_eval_submissions").length, 1);
  assert.equal(
    collection(database, "news_eval_aggregates")[0][1].valid_submission_count,
    1,
  );
});

test("same idempotency key with changed semantics conflicts", async () => {
  const { database, store } = setup();
  const value = request();
  assert.equal((await submit(store, value)).kind, "accepted");
  const changed = clone(value);
  changed.evaluation.leaning.label = "strong_progressive";
  changed.evaluation.leaning.evidence = "Конкретна различна оценка.";
  const outcome = await submit(store, changed);
  assert.deepEqual(outcome, { kind: "idempotency_conflict" });
  assert.equal(collection(database, "news_eval_submissions").length, 1);
});

test("a new key from the same browser/article/revision is a durable duplicate", async () => {
  const { database, store } = setup();
  const value = request();
  assert.equal((await submit(store, value)).kind, "accepted");
  const duplicate = clone(value);
  duplicate.idempotency_key = "a-new-idempotency-key-0002";
  duplicate.turnstile_token = "a-new-provider-token";
  assert.deepEqual(await submit(store, duplicate), {
    kind: "duplicate_article_revision",
  });
  assert.equal(collection(database, "news_eval_submissions").length, 1);
});

test("task revision/hash conflicts and semantic party gaps write nothing", async () => {
  const { database, store } = setup();
  const stale = request({
    base_task_revision: 3,
    idempotency_key: "stale-request-key-0001",
    browser_nonce: "stale-browser-key-0001",
  });
  assert.deepEqual(await submit(store, stale), {
    kind: "task_conflict",
    currentRevision: 4,
  });

  database.documents.set(
    `news_eval_tasks/${encoded(fixture.task.article_key)}`,
    task({
      model_labels: {
        ...fixture.task.model_labels,
        party_tones: [
          { party: "Примерна партия", party_id: "party-1", tone: "neutral" },
        ],
      },
    }),
  );
  const incomplete = request({
    idempotency_key: "incomplete-party-key-01",
    browser_nonce: "incomplete-browser-01",
  });
  assert.deepEqual(await submit(store, incomplete), {
    kind: "invalid_evaluation",
  });
  assert.equal(collection(database, "news_eval_submissions").length, 0);
  assert.equal(collection(database, "news_eval_rate").length, 0);
});

test("party tones derive changed/added dispositions against the task snapshot", async () => {
  const modelParties = [
    { party: "Партия едно", party_id: "party-1", tone: "neutral" },
    { party: "Партия две", party_id: "party-2", tone: "favorable" },
  ];
  const { database, store } = setup({
    [`news_eval_tasks/${encoded(fixture.task.article_key)}`]: task({
      model_labels: {
        ...fixture.task.model_labels,
        party_tones: modelParties,
      },
    }),
  });
  const value = request();
  value.evaluation.party_tones = [
    {
      party: "  ПАРТИЯ ЕДНО  ",
      party_id: "party-1",
      tone: "unfavorable",
      evidence: "Конкретна неблагоприятна оценка.",
      reason_codes: ["tone_misread"],
    },
    {
      party: "Партия три",
      party_id: "party-3",
      tone: "favorable",
      evidence: "Конкретна благоприятна оценка.",
      reason_codes: ["party_missing"],
    },
  ];
  value.evaluation.removed_model_parties = [
    {
      party: "Партия две",
      party_id: "party-2",
      reason_code: "party_not_meaningful",
    },
  ];
  const outcome = await submit(store, value);
  assert.equal(outcome.kind, "accepted");
  assert.deepEqual(
    outcome.receipt.evaluation.party_tones.map(
      ({ disposition }) => disposition,
    ),
    ["changed", "added"],
  );
  assert.equal(
    outcome.receipt.evaluation.party_tones[0].party,
    "  ПАРТИЯ ЕДНО  ",
  );
  assert.equal(
    collection(database, "news_eval_aggregates")[0][1].model_disagreement_count,
    1,
  );
  const partyAggregates = collection(database, "news_eval_party_aggregates");
  assert.equal(partyAggregates.length, 1);
  assert.deepEqual(
    partyAggregates.map(([, aggregate]) => ({
      party: aggregate.party,
      party_id: aggregate.party_id,
      tone_counts: aggregate.tone_counts,
    })),
    [
      {
        party: "Партия едно",
        party_id: "party-1",
        tone_counts: { unfavorable: 1 },
      },
    ],
  );
  assert.equal(
    collection(database, "news_eval_aggregates")[0][1].party_pair_count,
    2,
  );
  assert.equal(
    "party_tone_counts" in collection(database, "news_eval_aggregates")[0][1],
    false,
  );
});

test("exact global and browser limits reject before any write", async () => {
  const value = request();
  const context = abuse(value);
  for (const [path, document, scope] of [
    [
      `news_eval_rate/${context.globalDayKey}`,
      {
        submission_count: PUBLIC_ABUSE_POLICY.globalDailySubmissions,
        expires_at: new Date("2026-09-01T00:00:00.000Z"),
      },
      "global",
    ],
    [
      `news_eval_rate/${context.activeBrowserDayKey}`,
      {
        submission_count: PUBLIC_ABUSE_POLICY.browserDailySubmissions,
        expires_at: new Date("2026-09-01T00:00:00.000Z"),
      },
      "browser",
    ],
  ]) {
    const { database, store } = setup({ [path]: document });
    assert.deepEqual(await submit(store, value), {
      kind: "rate_limited",
      scope,
      retryAfterSeconds: 49_500,
    });
    assert.equal(collection(database, "news_eval_submissions").length, 0);
  }
});

test("malformed aggregate state aborts the transaction without partial writes", async () => {
  const articleKey = fixture.task.article_key;
  const { database, store } = setup({
    [`news_eval_aggregates/${encoded(articleKey)}`]: {
      article_key: articleKey,
      task_revision: fixture.task.revision,
      valid_submission_count: -1,
    },
  });
  const before = clone([...database.documents]);
  await assert.rejects(() => submit(store, request()), /counter/);
  assert.deepEqual([...database.documents], before);
});

test("malformed party aggregate state aborts all writes atomically", async () => {
  const modelParties = [
    { party: "Партия едно", party_id: "party-1", tone: "neutral" },
  ];
  const { database, store } = setup({
    [`news_eval_tasks/${encoded(fixture.task.article_key)}`]: task({
      model_labels: {
        ...fixture.task.model_labels,
        party_tones: modelParties,
      },
    }),
  });
  const first = request();
  first.evaluation.party_tones = [
    {
      party: "Партия едно",
      party_id: "party-1",
      tone: "neutral",
      evidence: "Конкретна неутрална оценка.",
      reason_codes: [],
    },
  ];
  assert.equal((await submit(store, first)).kind, "accepted");
  const [partyPath, partyDocument] = collection(
    database,
    "news_eval_party_aggregates",
  )[0];
  database.documents.set(partyPath, {
    ...partyDocument,
    tone_counts: { neutral: -1 },
  });
  const second = clone(first);
  second.idempotency_key = "party-counter-retry-key";
  second.browser_nonce = "party-counter-new-browser";
  second.turnstile_token = "party-counter-new-token";
  const before = clone([...database.documents]);
  await assert.rejects(() => submit(store, second), /counter/);
  assert.deepEqual([...database.documents], before);
});

test("a task revision change resets the current aggregate materialization", async () => {
  const { database, store } = setup();
  assert.equal((await submit(store, request())).kind, "accepted");
  database.documents.set(
    `news_eval_tasks/${encoded(fixture.task.article_key)}`,
    task({ revision: fixture.task.revision + 1 }),
  );
  const next = request({
    base_task_revision: fixture.task.revision + 1,
    idempotency_key: "next-revision-idempotency",
    browser_nonce: "next-revision-browser",
    turnstile_token: "next-revision-token",
  });
  const outcome = await submit(store, next);
  assert.equal(outcome.kind, "accepted");
  const aggregate = collection(database, "news_eval_aggregates")[0][1];
  assert.equal(aggregate.task_revision, fixture.task.revision + 1);
  assert.equal(aggregate.valid_submission_count, 1);
  assert.equal(aggregate.distinct_browser_count, 1);
});

test("public aggregate distributions remain withheld despite rotated nonces", async () => {
  const { store } = setup();
  for (let index = 0; index < 5; index += 1) {
    const value = request({
      idempotency_key: `aggregate-key-${String(index).padStart(8, "0")}`,
      browser_nonce: `aggregate-browser-${String(index).padStart(8, "0")}`,
      turnstile_token: `aggregate-token-${index}`,
    });
    assert.equal((await submit(store, value)).kind, "accepted");
  }
  const outcome = await store.aggregate({
    articleKey: fixture.task.article_key,
    now,
  });
  assert.equal(outcome.kind, "withheld");
  assert.equal(outcome.validSubmissionCount, 5);
});

test("missing or inactive tasks return stable outcomes without writes", async () => {
  const missingDatabase = new FakeFirestore();
  const missing = new FirestoreEvaluationStore(missingDatabase);
  assert.deepEqual(await submit(missing, request()), {
    kind: "task_not_found",
  });

  const { database, store } = setup({
    [`news_eval_tasks/${encoded(fixture.task.article_key)}`]: task({
      accepts_public_evals: false,
    }),
  });
  assert.deepEqual(await submit(store, request()), {
    kind: "task_unavailable",
  });
  assert.equal(collection(database, "news_eval_submissions").length, 0);
});

test("task model labels are allowlisted before storage and public receipts", async () => {
  const articleKey = fixture.task.article_key;
  const { database, store } = setup({
    [`news_eval_tasks/${encoded(articleKey)}`]: task({
      model_labels: {
        ...fixture.task.model_labels,
        private_excerpt: "must never leave the task document",
        party_tones: [],
      },
    }),
  });
  const outcome = await submit(store, request());
  assert.equal(outcome.kind, "accepted");
  assert.deepEqual(outcome.receipt.model_labels, {
    leaning: "neutral",
    russia_stance: "not_applicable",
    party_tones: [],
  });
  const submission = collection(database, "news_eval_submissions")[0][1];
  assert.deepEqual(submission.model_labels, outcome.receipt.model_labels);
  assert.doesNotMatch(JSON.stringify(submission), /must never leave/);
});

test("malformed task labels fail closed before any write", async () => {
  const articleKey = fixture.task.article_key;
  const { database, store } = setup({
    [`news_eval_tasks/${encoded(articleKey)}`]: task({
      model_labels: {
        ...fixture.task.model_labels,
        leaning: "invented_private_label",
      },
    }),
  });
  const before = clone([...database.documents]);
  await assert.rejects(() => submit(store, request()), /vocabulary/);
  assert.deepEqual([...database.documents], before);
});
