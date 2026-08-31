import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../lib/eval-contract/canonical.js";
import {
  buildLocalReviewBundle,
  buildRawSubmissionExport,
  deriveTaskRevision,
  FirestoreOperatorStore,
  parseRawSubmissionExport,
  parseReviewCommand,
  serializeRawSubmissionExport,
  writeAtomicPrivateFile,
  verifyLiveTaskRelease,
  verifyProjectTaskRelease,
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
    const query = (predicate = () => true) => ({
      path: name,
      get: async () => {
        const prefix = `${name}/`;
        const docs = [...this.documents.entries()]
          .filter(
            ([path, value]) =>
              path.startsWith(prefix) &&
              !path.slice(prefix.length).includes("/") &&
              predicate(value),
          )
          .map(([path, value]) => snapshot(path.slice(prefix.length), value));
        return { docs, readTime: this.readTime };
      },
    });
    return {
      ...query(),
      doc: (id) => ({ id, path: `${name}/${id}` }),
      where: (fieldPath, operator, value) => {
        assert.equal(operator, "==");
        return query((record) => record?.[fieldPath] === value);
      },
    };
  }

  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) => {
        if ("get" in reference) return reference.get();
        return this.documents.has(reference.path)
          ? snapshot(reference.id, this.documents.get(reference.path))
          : snapshot(reference.id, undefined, false);
      },
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

function syncTask(key = ARTICLE_KEY, overrides = {}) {
  const [domain, articleId] = key.split("/");
  const task = {
    schema_version: 1,
    rubric_version: "news-article-evaluation-v1",
    article_key: key,
    domain,
    article_id: articleId,
    url: `https://${domain}/${articleId}`,
    title: "Публична статия",
    published: "2026-08-31T09:00:00.000Z",
    story_id: "story-1",
    primary_topic: "government",
    outlet: domain,
    content_sha256: CONTENT_HASH,
    public_data_revision: "2026-08-31T11:00:00.000Z",
    analysis_sha256: ANALYSIS_HASH,
    model: "test-model",
    analyzed_at: "2026-08-31T10:00:00.000Z",
    prompt_hashes: {},
    model_labels: clone(modelLabels),
    review_reasons: { leaning: "positioned label needs review" },
    dataset_ids: ["community-pilot-v1"],
    accepts_public_evals: true,
    updated_at: "2026-08-31T11:00:00.000Z",
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "revision"))
    task.revision = deriveTaskRevision(
      task.content_sha256,
      task.analysis_sha256,
      task.model_labels,
    );
  return task;
}

function syncManifest(tasks, overrides = {}) {
  const generatedAt = "2026-08-31T11:00:00.000Z";
  const publicRevision = "2026-08-31T11:00:00.000Z";
  const publicTasks = tasks.map((task) => ({
    article_key: task.article_key,
    domain: task.domain,
    article_id: task.article_id,
    url: task.url,
    title: task.title,
    published: task.published,
    story_id: task.story_id,
    primary_topic: task.primary_topic,
    outlet: task.outlet,
    content_sha256: task.content_sha256,
    analysis_sha256: task.analysis_sha256,
    model_labels: clone(task.model_labels),
    review_fields: Object.keys(task.review_reasons).sort(),
    dataset_ids: clone(task.dataset_ids),
    task_revision: task.revision,
  }));
  const queue = {
    schema_version: 1,
    generated_at: generatedAt,
    public_data_revision: publicRevision,
    rubric_version: "news-article-evaluation-v1",
    task_count: publicTasks.length,
    tasks_sha256: canonicalSha256(publicTasks),
    tasks: publicTasks,
  };
  const manifest = {
    schema_version: 1,
    manifest_kind: "news-eval-task-sync",
    generated_at: generatedAt,
    public_data_revision: publicRevision,
    rubric_version: "news-article-evaluation-v1",
    task_count: tasks.length,
    tasks_sha256: canonicalSha256(tasks),
    queue_sha256: canonicalSha256(queue),
    tasks,
    ...overrides,
  };
  return manifest;
}

function syncQueue(tasks) {
  const manifest = syncManifest(tasks);
  const publicTasks = tasks.map((task) => ({
    article_key: task.article_key,
    domain: task.domain,
    article_id: task.article_id,
    url: task.url,
    title: task.title,
    published: task.published,
    story_id: task.story_id,
    primary_topic: task.primary_topic,
    outlet: task.outlet,
    content_sha256: task.content_sha256,
    analysis_sha256: task.analysis_sha256,
    model_labels: clone(task.model_labels),
    review_fields: Object.keys(task.review_reasons).sort(),
    dataset_ids: clone(task.dataset_ids),
    task_revision: task.revision,
  }));
  return {
    schema_version: 1,
    generated_at: manifest.generated_at,
    public_data_revision: manifest.public_data_revision,
    rubric_version: manifest.rubric_version,
    task_count: publicTasks.length,
    tasks_sha256: canonicalSha256(publicTasks),
    tasks: publicTasks,
  };
}

function releaseProof(manifest, overrides = {}) {
  return {
    publicDataRevision: manifest.public_data_revision,
    queueSha256: manifest.queue_sha256,
    runId: "2026-08-31T110000Z-1234",
    liveManifestUrl:
      "https://storage.googleapis.com/data-electionsbg-com/news/app-data/manifest.json",
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
    () => store.apply(acceptanceCommand({ expected_adjudication_revision: 7 })),
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

test("live release proof binds the active pointer, immutable queue bytes, and manifest", async () => {
  const tasks = [syncTask()];
  const manifest = syncManifest(tasks);
  const queue = syncQueue(tasks);
  assert.equal(canonicalSha256(queue), manifest.queue_sha256);
  const queueBody = `${JSON.stringify(queue, null, 2)}\n`;
  const queueRawHash = createHash("sha256").update(queueBody).digest("hex");
  const live = {
    version: 1,
    run_id: "2026-08-31T110000Z-1234",
    generated_at: manifest.public_data_revision,
    data_base: "versions/2026-08-31T110000Z-1234",
    home_health_ready: true,
    bundle: {
      inventory: [
        { path: "home.json", bytes: 12, sha256: "e".repeat(64) },
        {
          path: "evals/queue.json",
          bytes: Buffer.byteLength(queueBody),
          sha256: queueRawHash,
        },
      ],
    },
  };
  const manifestUrl =
    "https://storage.googleapis.com/data-electionsbg-com/news/app-data/manifest.json";
  const queueUrl =
    "https://storage.googleapis.com/data-electionsbg-com/news/app-data/versions/2026-08-31T110000Z-1234/evals/queue.json";
  const response = (body) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer,
  });
  const fetcher = async (url) => {
    if (url === manifestUrl) return response(JSON.stringify(live));
    if (url === queueUrl) return response(queueBody);
    throw new Error(`unexpected URL ${url}`);
  };
  assert.deepEqual(
    await verifyLiveTaskRelease(manifest, manifestUrl, fetcher),
    releaseProof(manifest),
  );
  await assert.rejects(
    () =>
      verifyLiveTaskRelease(manifest, manifestUrl, async (url) =>
        response(
          url === manifestUrl
            ? JSON.stringify({
                ...live,
                generated_at: "2026-08-30T11:00:00.000Z",
              })
            : queueBody,
        ),
      ),
    /revision does not match/,
  );
  await assert.rejects(
    () =>
      verifyLiveTaskRelease(manifest, manifestUrl, async (url) =>
        response(url === manifestUrl ? JSON.stringify(live) : `${queueBody} `),
      ),
    /bytes do not match/,
  );
});

test("production release verification pins its origin before any fetch", async () => {
  const manifest = syncManifest([syncTask()]);
  let fetches = 0;
  const fetcher = async () => {
    fetches += 1;
    throw new Error("fetch must not run");
  };
  await assert.rejects(
    () =>
      verifyProjectTaskRelease(
        "electionsbg-news",
        manifest,
        "https://attacker.invalid/manifest.json",
        fetcher,
      ),
    /exact production app-data manifest/,
  );
  await assert.rejects(
    () =>
      verifyProjectTaskRelease(
        "wrong-project",
        manifest,
        releaseProof(manifest).liveManifestUrl,
        fetcher,
      ),
    /explicit demo emulator project/,
  );
  assert.equal(fetches, 0);
  await assert.rejects(
    () =>
      verifyProjectTaskRelease(
        "demo-news-evals",
        manifest,
        "https://demo.example/manifest.json",
        fetcher,
        "127.0.0.1:8080",
      ),
    /fetch must not run/,
  );
  assert.equal(fetches, 1);
});

test("Python-generated Unicode task fixture crosses the TypeScript boundary exactly", async () => {
  const pair = JSON.parse(
    readFileSync(
      new URL(
        "../../news/eval_contract/fixtures/task_sync_pair.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(pair.producer, "news/scripts/sync_eval_tasks.py");
  assert.equal(
    canonicalSha256(pair.manifest.tasks),
    pair.manifest.tasks_sha256,
  );
  assert.equal(canonicalSha256(pair.queue), pair.manifest.queue_sha256);
  assert.equal(
    deriveTaskRevision(
      pair.manifest.tasks[0].content_sha256,
      pair.manifest.tasks[0].analysis_sha256,
      pair.manifest.tasks[0].model_labels,
    ),
    pair.manifest.tasks[0].revision,
  );
  const result = await new FirestoreOperatorStore(
    new FakeFirestore(),
  ).syncTasks(pair.manifest, releaseProof(pair.manifest));
  assert.equal(result.activated, 1);
});

test("task sync atomically activates desired tasks and deactivates stale tasks", async () => {
  const staleKey = "old.example/article-9";
  const staleId = Buffer.from(staleKey, "utf8").toString("base64url");
  const database = new FakeFirestore([
    [
      `news_eval_tasks/${staleId}`,
      syncTask(staleKey, {
        public_data_revision: "2026-08-30T11:00:00.000Z",
        updated_at: "2026-08-30T12:00:00.000Z",
      }),
    ],
    ["news_eval_tasks/rogue-id", { accepts_public_evals: true }],
  ]);
  const store = new FirestoreOperatorStore(database);
  const manifest = syncManifest([syncTask()]);
  const proof = releaseProof(manifest);
  const result = await store.syncTasks(manifest, proof);
  assert.deepEqual(result, {
    taskCount: 1,
    activated: 1,
    updated: 0,
    unchanged: 0,
    deactivated: 2,
    tasksSha256: manifest.tasks_sha256,
  });
  assert.equal(
    database.documents.get(`news_eval_tasks/${TASK_ID}`).revision,
    syncTask().revision,
  );
  assert.equal(
    database.documents.get(`news_eval_tasks/${staleId}`).accepts_public_evals,
    false,
  );
  assert.equal(
    database.documents.get("news_eval_tasks/rogue-id").accepts_public_evals,
    false,
  );
  assert.equal(
    database.documents.get("news_eval_sync/task_manifest").tasks_sha256,
    manifest.tasks_sha256,
  );

  const retry = await store.syncTasks(manifest, proof);
  assert.equal(retry.unchanged, 1);
  assert.equal(retry.activated, 0);
  assert.equal(retry.deactivated, 0);
});

test("task sync refuses rollback and same-generation conflicts without writes", async () => {
  const incoming = syncManifest([syncTask()]);
  for (const state of [
    {
      generated_at: "2026-08-31T13:00:00.000Z",
      public_data_revision: "2026-08-31T13:00:00.000Z",
      tasks_sha256: incoming.tasks_sha256,
      queue_sha256: incoming.queue_sha256,
    },
    {
      generated_at: incoming.generated_at,
      public_data_revision: incoming.public_data_revision,
      tasks_sha256: CONTENT_HASH,
      queue_sha256: incoming.queue_sha256,
    },
  ]) {
    const database = new FakeFirestore([
      ["news_eval_sync/task_manifest", state],
    ]);
    const before = clone([...database.documents]);
    await assert.rejects(() =>
      new FirestoreOperatorStore(database).syncTasks(
        incoming,
        releaseProof(incoming),
      ),
    );
    assert.deepEqual([...database.documents], before);
  }
});

test("task sync refuses empty, tampered, and private-field manifests without writes", async () => {
  const database = new FakeFirestore();
  const store = new FirestoreOperatorStore(database);
  for (const manifest of [
    syncManifest([]),
    { ...syncManifest([syncTask()]), tasks_sha256: CONTENT_HASH },
    syncManifest([syncTask(ARTICLE_KEY, { private_excerpt: "never upload" })]),
    syncManifest([syncTask(ARTICLE_KEY, { revision: 7 })]),
    syncManifest([syncTask()], {
      generated_at: "2026-08-31T12:00:00.000Z",
    }),
    syncManifest([
      syncTask(),
      syncTask("example.bg/article-2", {
        public_data_revision: "2026-08-30T11:00:00.000Z",
        updated_at: "2026-08-31T11:00:00.000Z",
      }),
    ]),
    syncManifest(
      Array.from({ length: 201 }, (_, index) =>
        syncTask(`example.bg/article-${String(index).padStart(3, "0")}`),
      ),
    ),
  ]) {
    const before = clone([...database.documents]);
    await assert.rejects(() =>
      store.syncTasks(manifest, releaseProof(manifest)),
    );
    assert.deepEqual([...database.documents], before);
  }
  const manifest = syncManifest([syncTask()]);
  await assert.rejects(() =>
    store.syncTasks(
      manifest,
      releaseProof(manifest, { queueSha256: CONTENT_HASH }),
    ),
  );
  assert.equal(database.documents.size, 0);
});

test("task sync ignores lifetime inactive history while bounding active plus desired", async () => {
  const history = Array.from({ length: 450 }, (_, index) => [
    `news_eval_tasks/inactive-${index}`,
    { accepts_public_evals: false, historical: true },
  ]);
  const database = new FakeFirestore(history);
  const manifest = syncManifest([syncTask()]);
  const result = await new FirestoreOperatorStore(database).syncTasks(
    manifest,
    releaseProof(manifest),
  );
  assert.equal(result.activated, 1);
  assert.equal(result.deactivated, 0);
  assert.equal(database.documents.size, 452);
});
