import assert from "node:assert/strict";
import test from "node:test";

import { deriveAbuseContext, parseHmacKeyring } from "../lib/abuse.js";
import { FirestoreFeedbackStore } from "../lib/feedback.js";

const ARTICLE_KEY = "example.bg/article-1";
const CONTENT_HASH = `sha256:${"a".repeat(64)}`;
const NOW = new Date("2026-09-01T08:00:00.000Z");
const keyring = parseHmacKeyring({
  active: "v1",
  keys: { v1: "feedback test HMAC secret with at least thirty-two bytes" },
});

const clone = (value) => structuredClone(value);
const encoded = (value) => Buffer.from(value, "utf8").toString("base64url");

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
        const prior = options?.merge
          ? (this.documents.get(reference.path) ?? {})
          : {};
        staged.set(reference.path, { ...clone(prior), ...clone(data) });
      },
    };
    const result = await callback(transaction);
    for (const [path, value] of staged) this.documents.set(path, value);
    return result;
  }
}

const task = (overrides = {}) => ({
  article_key: ARTICLE_KEY,
  revision: 7,
  content_sha256: CONTENT_HASH,
  analysis_sha256: null,
  public_data_revision: "2026-09-01T07:30:00.000Z",
  accepts_public_feedback: true,
  ...overrides,
});

const request = (overrides = {}) => ({
  schema_version: 1,
  article_key: ARTICLE_KEY,
  base_task_revision: 7,
  content_sha256: CONTENT_HASH,
  analysis_sha256: null,
  idempotency_key: "feedback-idempotency-0001",
  turnstile_token: "provider-token",
  browser_nonce: "feedback-browser-0001",
  feedback: {
    leaning: null,
    russia_stance: null,
    party_tones: [],
    issue_kinds: ["missing_analysis", "missing_entity"],
    public_note: "Липсва връзка към споменатата институция.",
  },
  ...overrides,
});

const abuse = (value) =>
  deriveAbuseContext(
    {
      articleKey: value.article_key,
      taskRevision: value.base_task_revision,
      idempotencyKey: value.idempotency_key,
      browserNonce: value.browser_nonce,
      semanticRequest: value,
      now: NOW,
    },
    keyring,
  );

const setup = (taskValue = task()) => {
  const database = new FakeFirestore({
    [`news_feedback_tasks/${encoded(ARTICLE_KEY)}`]: taskValue,
    "news_feedback_sync/task_manifest": {
      public_data_revision: taskValue.public_data_revision,
      tasks_sha256: `sha256:${"b".repeat(64)}`,
    },
  });
  return { database, store: new FirestoreFeedbackStore(database) };
};

const records = (database, collection) =>
  [...database.documents.entries()].filter(([path]) =>
    path.startsWith(`${collection}/`),
  );

test("all-article feedback accepts a partial raw report without analysis or auth", async () => {
  const { database, store } = setup();
  const value = request();
  const outcome = await store.submit({
    request: value,
    abuse: abuse(value),
    now: NOW,
  });
  assert.equal(outcome.kind, "accepted");
  assert.equal(outcome.created, true);
  assert.equal(outcome.receipt.status, "raw");
  const stored = records(database, "news_feedback_submissions")[0][1];
  assert.equal(stored.analysis_sha256, null);
  assert.equal(stored.mode, "article_feedback");
  assert.equal(stored.status, "raw");
  assert.deepEqual(stored.feedback.issue_kinds, [
    "missing_analysis",
    "missing_entity",
  ]);
  assert.doesNotMatch(
    JSON.stringify([...database.documents]),
    /provider-token|feedback-browser-0001|feedback-idempotency-0001/,
  );
});

test("feedback retries are idempotent and stale article revisions write nothing", async () => {
  const { database, store } = setup();
  const value = request();
  const first = await store.submit({
    request: value,
    abuse: abuse(value),
    now: NOW,
  });
  const retry = request({
    turnstile_token: "fresh-provider-token",
    browser_nonce: "fresh-feedback-browser",
  });
  const second = await store.submit({
    request: retry,
    abuse: abuse(retry),
    now: NOW,
  });
  assert.equal(first.kind, "accepted");
  assert.equal(second.kind, "accepted");
  assert.equal(second.created, false);
  assert.equal(second.receipt.submission_id, first.receipt.submission_id);
  assert.equal(records(database, "news_feedback_submissions").length, 1);

  const stale = request({
    idempotency_key: "feedback-idempotency-stale",
    browser_nonce: "feedback-browser-stale",
    base_task_revision: 6,
  });
  assert.deepEqual(
    await store.submit({ request: stale, abuse: abuse(stale), now: NOW }),
    { kind: "task_conflict", currentRevision: 7 },
  );
  assert.equal(records(database, "news_feedback_submissions").length, 1);
});

test("inactive and absent feedback tasks fail closed", async () => {
  const inactive = setup(task({ accepts_public_feedback: false }));
  assert.deepEqual(await inactive.store.task(ARTICLE_KEY), {
    kind: "task_unavailable",
  });
  const absentDatabase = new FakeFirestore();
  const absent = new FirestoreFeedbackStore(absentDatabase);
  assert.deepEqual(await absent.task(ARTICLE_KEY), { kind: "task_not_found" });
});

test("a staged task is unavailable until its manifest revision becomes active", async () => {
  const { database, store } = setup();
  database.documents.set("news_feedback_sync/task_manifest", {
    public_data_revision: "2026-08-31T08:00:00.000Z",
    tasks_sha256: `sha256:${"c".repeat(64)}`,
  });
  assert.deepEqual(await store.task(ARTICLE_KEY), { kind: "task_unavailable" });
  const value = request();
  assert.deepEqual(
    await store.submit({ request: value, abuse: abuse(value), now: NOW }),
    { kind: "task_unavailable" },
  );
  assert.equal(records(database, "news_feedback_submissions").length, 0);
});

test("malformed active feedback rate counters fail closed", async () => {
  const { database, store } = setup();
  const value = request();
  const context = abuse(value);
  database.documents.set(`news_feedback_rate/${context.globalDayKey}`, {
    submission_count: "not-a-number",
    expires_at: new Date("2026-09-02T00:00:00.000Z"),
  });
  await assert.rejects(
    store.submit({ request: value, abuse: context, now: NOW }),
    /feedback rate counter is invalid/,
  );
  assert.equal(records(database, "news_feedback_submissions").length, 0);
});
