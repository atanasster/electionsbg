import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildLocalReviewBundle,
  buildRawSubmissionExport,
  FirestoreOperatorStore,
  parseRawSubmissionExport,
  parseReviewCommand,
  serializeRawSubmissionExport,
  writeAtomicPrivateFile,
} from "../lib/operator.js";

const CONTENT_HASH = `sha256:${"a".repeat(64)}`;
const OTHER_CONTENT_HASH = `sha256:${"c".repeat(64)}`;
const ANALYSIS_HASH = `sha256:${"b".repeat(64)}`;
const ARTICLE_KEY = "example.bg/article-1";
const TASK_ID = Buffer.from(ARTICLE_KEY, "utf8").toString("base64url");
const NOW = "2026-08-31T12:00:00.000Z";

const evaluation = {
  schema_version: 1,
  leaning: {
    label: "progressive",
    disposition: "changed",
    evidence: "Авторският текст предпочита по-широка социална защита.",
    reason_codes: ["model_missed_context"],
  },
  russia_stance: {
    label: "anti_russia",
    disposition: "confirmed",
    evidence: "Русия е описана като агресор в авторския разказ.",
    reason_codes: [],
  },
  parties_confirmed_complete: true,
  party_tones: [
    {
      party: "ГЕРБ",
      party_id: "gerb",
      tone: "unfavorable",
      evidence: "Партията е пряко критикувана.",
      disposition: "changed",
      reason_codes: ["tone_misread"],
    },
  ],
  removed_model_parties: [],
  public_note: "Прочетен е целият материал.",
};

const modelLabels = {
  leaning: "neutral",
  russia_stance: "anti_russia",
  party_tones: [{ party: "ГЕРБ", party_id: "gerb", tone: "neutral" }],
};

function clone(value) {
  return structuredClone(value);
}

function submission(id, overrides = {}) {
  return {
    schema_version: 1,
    submission_id: id,
    mode: "community",
    article_key: ARTICLE_KEY,
    task_revision: 4,
    content_sha256: CONTENT_HASH,
    analysis_sha256: ANALYSIS_HASH,
    abuse_ref: "opaque-abuse-sidecar-reference",
    submitted_at: new Date(NOW),
    evaluation: clone(evaluation),
    model_labels: clone(modelLabels),
    status: "raw",
    ...overrides,
  };
}

function snapshot(id, data, exists = true) {
  return {
    id,
    exists,
    data: () => (exists ? clone(data) : undefined),
  };
}

class FakeFirestore {
  constructor(entries = []) {
    this.documents = new Map(
      entries.map(([path, value]) => [path, clone(value)]),
    );
    this.readTime = new Date("2026-08-31T12:30:00.000Z");
  }

  collection(name) {
    return {
      doc: (id) => ({ id, path: `${name}/${id}` }),
      get: async () => {
        const prefix = `${name}/`;
        const docs = [...this.documents.entries()]
          .filter(
            ([path]) =>
              path.startsWith(prefix) &&
              !path.slice(prefix.length).includes("/"),
          )
          .map(([path, value]) => snapshot(path.slice(prefix.length), value));
        return { docs, readTime: this.readTime };
      },
    };
  }

  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) =>
        this.documents.has(reference.path)
          ? snapshot(reference.id, this.documents.get(reference.path))
          : snapshot(reference.id, undefined, false),
      set: (reference, data, options) => {
        writes.push({
          reference,
          data: clone(data),
          merge: options?.merge === true,
        });
      },
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const prior = this.documents.get(write.reference.path);
      this.documents.set(
        write.reference.path,
        write.merge ? { ...(prior ?? {}), ...write.data } : write.data,
      );
    }
    return result;
  }
}

function reviewCommand(overrides = {}) {
  return {
    schema_version: 1,
    operation_id: "review-operation-0001",
    occurred_at: NOW,
    actor: { kind: "maintainer", id: "editor@example.test" },
    action: "submission_reviewed",
    article_key: ARTICLE_KEY,
    content_sha256: CONTENT_HASH,
    source_submission_ids: ["submission-0001"],
    reason: "Evidence checked against the local article.",
    ...overrides,
  };
}

function acceptanceCommand(overrides = {}) {
  return {
    schema_version: 1,
    operation_id: "accept-operation-0001",
    occurred_at: NOW,
    actor: { kind: "maintainer", id: "editor@example.test" },
    action: "adjudication_accepted",
    article_key: ARTICLE_KEY,
    content_sha256: CONTENT_HASH,
    source_submission_ids: ["submission-0001"],
    expected_task_revision: 4,
    analysis_sha256: ANALYSIS_HASH,
    expected_adjudication_revision: 0,
    evaluation: clone(evaluation),
    public_explanation: "Проверено спрямо целия оригинален материал.",
    reason: "Accepted after local editorial review.",
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    article_key: ARTICLE_KEY,
    revision: 4,
    content_sha256: CONTENT_HASH,
    analysis_sha256: ANALYSIS_HASH,
    model_labels: clone(modelLabels),
    accepts_public_evals: true,
    ...overrides,
  };
}

test("raw export is sorted, hashed, allowlisted, and round-trips as JSONL", () => {
  const exported = buildRawSubmissionExport("electionsbg-news", {
    readTime: new Date("2026-08-31T12:30:00.000Z"),
    docs: [
      snapshot(
        "submission-0002",
        submission("submission-0002", {
          submitted_at: new Date("2026-08-31T12:02:00Z"),
        }),
      ),
      snapshot(
        "submission-0001",
        submission("submission-0001", {
          submitted_at: new Date("2026-08-31T12:01:00Z"),
        }),
      ),
    ],
  });
  assert.deepEqual(
    exported.records.map((record) => record.submission_id),
    ["submission-0001", "submission-0002"],
  );
  assert.equal(exported.manifest.record_count, 2);
  assert.match(exported.manifest.records_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal("abuse_ref" in exported.records[0], false);
  const serialized = serializeRawSubmissionExport(exported);
  assert.doesNotMatch(serialized, /opaque-abuse-sidecar-reference/);
  assert.deepEqual(parseRawSubmissionExport(serialized), exported);

  const tampered = serialized.replace('"status":"raw"', '"status":"reviewed"');
  assert.throws(
    () => parseRawSubmissionExport(tampered),
    /hash does not match/,
  );
});

test("raw export fails closed on missing read time or private model-label fields", () => {
  assert.throws(
    () =>
      buildRawSubmissionExport("electionsbg-news", {
        readTime: new Date(NOW),
        docs: [],
      }),
    /last known-good/,
  );
  assert.throws(
    () =>
      buildRawSubmissionExport("electionsbg-news", {
        docs: [snapshot("submission-0001", submission("submission-0001"))],
      }),
    /read time/,
  );
  const unsafe = submission("submission-0001");
  unsafe.model_labels.private_excerpt = "must never be exported";
  assert.throws(
    () =>
      buildRawSubmissionExport("electionsbg-news", {
        readTime: new Date(NOW),
        docs: [snapshot("submission-0001", unsafe)],
      }),
    /unexpected fields/,
  );
});

test("atomic private writes replace only after a complete write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-eval-operator-"));
  const destination = join(directory, "snapshot.jsonl");
  await writeAtomicPrivateFile(destination, "first\n");
  await writeAtomicPrivateFile(destination, "second\n");
  assert.equal(await readFile(destination, "utf8"), "second\n");
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});

test("local review bundle groups evidence with full local text and marks stale content", async () => {
  const exported = buildRawSubmissionExport("electionsbg-news", {
    readTime: new Date(NOW),
    docs: [
      snapshot("submission-0001", submission("submission-0001")),
      snapshot(
        "submission-0002",
        submission("submission-0002", {
          status: "quarantined",
          evaluation: {
            ...clone(evaluation),
            leaning: {
              ...clone(evaluation.leaning),
              label: "neutral",
              disposition: "confirmed",
            },
          },
        }),
      ),
    ],
  });
  const bundle = await buildLocalReviewBundle(exported, async () => ({
    path: "/private/news/data/example.bg/article-1.json",
    article: {
      title: "Local title",
      content: "Full locally stored article text.",
    },
  }));
  assert.equal(bundle.article_count, 1);
  assert.equal(bundle.submission_count, 2);
  const article = bundle.articles[0];
  assert.equal(
    article.local_article.content,
    "Full locally stored article text.",
  );
  assert.equal(article.local_content_matches_all_submissions, false);
  assert.deepEqual(article.community_distribution.leaning, { progressive: 1 });
  assert.equal(article.submissions.length, 2);
});

test("review commands are strict and cannot name an anonymous actor or duplicate source", () => {
  assert.equal(
    parseReviewCommand(reviewCommand()).action,
    "submission_reviewed",
  );
  assert.throws(
    () =>
      parseReviewCommand(
        reviewCommand({ actor: { kind: "service", id: "bot" } }),
      ),
    /maintainer/,
  );
  assert.throws(
    () =>
      parseReviewCommand(
        acceptanceCommand({
          source_submission_ids: ["submission-0001", "submission-0001"],
        }),
      ),
    /duplicates/,
  );
  assert.throws(
    () => parseReviewCommand(reviewCommand({ unexpected: true })),
    /unexpected fields/,
  );
});

test("submission review and event append are atomic and idempotent", async () => {
  const database = new FakeFirestore([
    ["news_eval_submissions/submission-0001", submission("submission-0001")],
  ]);
  const store = new FirestoreOperatorStore(database);
  const first = await store.apply(reviewCommand());
  assert.deepEqual(first, {
    operationId: "review-operation-0001",
    idempotent: false,
    articleKey: ARTICLE_KEY,
    status: "reviewed",
  });
  const stored = database.documents.get(
    "news_eval_submissions/submission-0001",
  );
  assert.equal(stored.status, "reviewed");
  assert.equal(stored.last_review_operation_id, "review-operation-0001");
  const event = database.documents.get(
    "news_eval_events/review-operation-0001",
  );
  assert.equal(event.action, "submission_reviewed");
  assert.match(event.before_sha256, /^sha256:/);
  assert.match(event.after_sha256, /^sha256:/);

  const second = await store.apply(reviewCommand());
  assert.equal(second.idempotent, true);
  assert.equal(
    [...database.documents.keys()].filter((path) =>
      path.startsWith("news_eval_events/"),
    ).length,
    1,
  );
});

test("an operation ID conflict or stale submission writes nothing", async () => {
  const existingEvent = {
    schema_version: 1,
    event_id: "review-operation-0001",
    occurred_at: NOW,
    actor: { kind: "maintainer", id: "another-editor" },
    action: "submission_reviewed",
    target: {
      kind: "submission",
      id: "submission-0001",
      article_key: ARTICLE_KEY,
    },
    before_sha256: CONTENT_HASH,
    after_sha256: ANALYSIS_HASH,
    reason: null,
  };
  const database = new FakeFirestore([
    ["news_eval_submissions/submission-0001", submission("submission-0001")],
    ["news_eval_events/review-operation-0001", existingEvent],
  ]);
  const before = clone([...database.documents]);
  await assert.rejects(
    () => new FirestoreOperatorStore(database).apply(reviewCommand()),
    /already bound/,
  );
  assert.deepEqual([...database.documents], before);

  await assert.rejects(
    () =>
      new FirestoreOperatorStore(
        new FakeFirestore([
          [
            "news_eval_submissions/submission-0001",
            submission("submission-0001"),
          ],
        ]),
      ).apply(reviewCommand({ content_sha256: OTHER_CONTENT_HASH })),
    /no longer matches/,
  );
});

test("accepted adjudication promotes sources and appends one atomic audit event", async () => {
  const database = new FakeFirestore([
    ["news_eval_tasks/" + TASK_ID, task()],
    ["news_eval_submissions/submission-0001", submission("submission-0001")],
  ]);
  const store = new FirestoreOperatorStore(database);
  const result = await store.apply(acceptanceCommand());
  assert.deepEqual(result, {
    operationId: "accept-operation-0001",
    idempotent: false,
    articleKey: ARTICLE_KEY,
    status: "accepted",
    adjudicationRevision: 1,
    goldEligible: true,
  });
  const adjudication = database.documents.get(
    `news_eval_adjudications/${TASK_ID}`,
  );
  assert.equal(adjudication.revision, 1);
  assert.equal(adjudication.status, "accepted");
  assert.equal(adjudication.content_sha256, CONTENT_HASH);
  assert.equal(adjudication.gold_eligible, true);
  assert.equal(
    database.documents.get("news_eval_submissions/submission-0001").status,
    "promoted",
  );
  assert.equal(
    database.documents.get("news_eval_events/accept-operation-0001").action,
    "adjudication_accepted",
  );

  const retry = await store.apply(acceptanceCommand());
  assert.equal(retry.idempotent, true);
  assert.equal(retry.adjudicationRevision, 1);
  await assert.rejects(
    () =>
      store.apply(
        acceptanceCommand({
          public_explanation:
            "A changed command must not reuse an operation ID.",
        }),
    ),
    /state does not match/,
  );
  await assert.rejects(
    () =>
      store.apply(
        acceptanceCommand({ expected_adjudication_revision: 7 }),
      ),
    /state does not match/,
  );
});

test("stale, conflicting, quarantined, and semantically invalid promotion fail without writes", async () => {
  const cases = [
    {
      command: acceptanceCommand({ content_sha256: OTHER_CONTENT_HASH }),
      task: task(),
      source: submission("submission-0001"),
      error: /content hash is stale/,
    },
    {
      command: acceptanceCommand({ expected_adjudication_revision: 2 }),
      task: task(),
      source: submission("submission-0001"),
      error: /revision conflict/,
    },
    {
      command: acceptanceCommand({ expected_task_revision: 3 }),
      task: task(),
      source: submission("submission-0001"),
      error: /task or analysis revision is stale/,
    },
    {
      command: acceptanceCommand({ analysis_sha256: OTHER_CONTENT_HASH }),
      task: task(),
      source: submission("submission-0001"),
      error: /task or analysis revision is stale/,
    },
    {
      command: acceptanceCommand(),
      task: task({
        revision: 5,
        analysis_sha256: OTHER_CONTENT_HASH,
        model_labels: {
          ...clone(modelLabels),
          leaning: "conservative",
        },
      }),
      source: submission("submission-0001"),
      error: /task or analysis revision is stale/,
    },
    {
      command: acceptanceCommand(),
      task: task(),
      source: submission("submission-0001", { status: "quarantined" }),
      error: /quarantined/,
    },
    {
      command: acceptanceCommand(),
      task: task(),
      source: submission("submission-0001", { status: "invented" }),
      error: /status is invalid/,
    },
    {
      command: acceptanceCommand({
        evaluation: {
          ...clone(evaluation),
          leaning: { ...clone(evaluation.leaning), disposition: "confirmed" },
        },
      }),
      task: task(),
      source: submission("submission-0001"),
      error: /inconsistent/,
    },
  ];
  for (const item of cases) {
    const database = new FakeFirestore([
      ["news_eval_tasks/" + TASK_ID, item.task],
      ["news_eval_submissions/submission-0001", item.source],
    ]);
    const before = clone([...database.documents]);
    await assert.rejects(
      () => new FirestoreOperatorStore(database).apply(item.command),
      item.error,
    );
    assert.deepEqual([...database.documents], before);
  }
});

test("superseding an adjudication increments revision and records supersession", async () => {
  const current = {
    schema_version: 1,
    article_key: ARTICLE_KEY,
    task_revision: 4,
    content_sha256: CONTENT_HASH,
    analysis_sha256: ANALYSIS_HASH,
    source_submission_ids: ["older-submission"],
    operator_actor: { kind: "maintainer", id: "older-editor" },
    adjudicated_at: "2026-08-30T12:00:00.000Z",
    revision: 1,
    evaluation: clone(evaluation),
    public_explanation: null,
    gold_eligible: true,
    status: "accepted",
    last_operation_id: "older-operation-0001",
  };
  const database = new FakeFirestore([
    ["news_eval_tasks/" + TASK_ID, task()],
    ["news_eval_submissions/submission-0001", submission("submission-0001")],
    [`news_eval_adjudications/${TASK_ID}`, current],
  ]);
  const result = await new FirestoreOperatorStore(database).apply(
    acceptanceCommand({
      operation_id: "accept-operation-0002",
      expected_adjudication_revision: 1,
    }),
  );
  assert.equal(result.adjudicationRevision, 2);
  assert.equal(
    database.documents.get("news_eval_events/accept-operation-0002-superseded")
      .action,
    "adjudication_superseded",
  );
  assert.equal(
    database.documents.get("news_eval_events/accept-operation-0002").action,
    "adjudication_accepted",
  );
});
