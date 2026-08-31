import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import articleEvaluationSchema from "./eval-contract/article_evaluation.schema.json" with { type: "json" };
import eventSchema from "./eval-contract/event.schema.json" with { type: "json" };
import {
  canonicalJson,
  canonicalSha256,
  contentSha256,
} from "./eval-contract/canonical.js";
import {
  validateEvaluationSemantics,
  validateSchema,
} from "./eval-contract/validate.js";

type JsonObject = Record<string, unknown>;

export type OperatorDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data(): JsonObject | undefined;
}>;

export type OperatorDocumentReference = Readonly<{
  id: string;
  path: string;
}>;

export type OperatorQuerySnapshot = Readonly<{
  docs: readonly OperatorDocumentSnapshot[];
  readTime?: unknown;
}>;

type OperatorCollectionReference = Readonly<{
  doc(id: string): OperatorDocumentReference;
  get(): Promise<OperatorQuerySnapshot>;
}>;

type OperatorTransaction = Readonly<{
  get(reference: OperatorDocumentReference): Promise<OperatorDocumentSnapshot>;
  set(
    reference: OperatorDocumentReference,
    data: JsonObject,
    options?: { merge: boolean },
  ): unknown;
}>;

export type OperatorFirestore = Readonly<{
  collection(name: string): OperatorCollectionReference;
  runTransaction<T>(
    callback: (transaction: OperatorTransaction) => Promise<T>,
  ): Promise<T>;
}>;

export type RawSubmissionRecord = Readonly<{
  schema_version: 1;
  rubric_version: "news-article-evaluation-v1";
  submission_id: string;
  mode: "community";
  article_key: string;
  task_revision: number;
  content_sha256: string;
  analysis_sha256: string;
  submitted_at: string;
  evaluation: JsonObject;
  model_labels: JsonObject;
  status: "raw" | "quarantined" | "reviewed" | "promoted";
}>;

export type RawSubmissionExport = Readonly<{
  manifest: Readonly<{
    schema_version: 1;
    export_kind: "news-eval-community-submissions";
    project_id: string;
    firestore_read_time: string;
    rubric_version: "news-article-evaluation-v1";
    record_count: number;
    records_sha256: string;
  }>;
  records: readonly RawSubmissionRecord[];
}>;

export type ReviewCommand =
  | Readonly<{
      schemaVersion: 1;
      operationId: string;
      occurredAt: string;
      actor: Readonly<{ kind: "maintainer"; id: string }>;
      action: "submission_reviewed" | "submission_quarantined";
      articleKey: string;
      contentSha256: string;
      sourceSubmissionIds: readonly [string];
      reason: string | null;
    }>
  | Readonly<{
      schemaVersion: 1;
      operationId: string;
      occurredAt: string;
      actor: Readonly<{ kind: "maintainer"; id: string }>;
      action: "adjudication_accepted";
      articleKey: string;
      contentSha256: string;
      sourceSubmissionIds: readonly string[];
      expectedTaskRevision: number;
      analysisSha256: string;
      expectedAdjudicationRevision: number;
      evaluation: JsonObject;
      publicExplanation: string | null;
      reason: string | null;
    }>;

export type ApplyReviewResult = Readonly<{
  operationId: string;
  idempotent: boolean;
  articleKey: string;
  status: "reviewed" | "quarantined" | "accepted";
  adjudicationRevision?: number;
  goldEligible?: boolean;
}>;

const ARTICLE_KEY = /^[^/]{1,253}\/[^/]{1,255}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{16,96}$/;
const RUBRIC = "news-article-evaluation-v1" as const;
const ARTICLE_SCHEMA = articleEvaluationSchema as JsonObject;
const EVENT_SCHEMA = eventSchema as JsonObject;
const STATUS = new Set(["raw", "quarantined", "reviewed", "promoted"]);
const LEANING = new Set([
  "strong_progressive",
  "progressive",
  "neutral",
  "conservative",
  "strong_conservative",
  "not_applicable",
]);
const RUSSIA = new Set([
  "strong_pro_russia",
  "pro_russia",
  "neutral",
  "anti_russia",
  "strong_anti_russia",
  "not_applicable",
]);
const PARTY_TONE = new Set(["favorable", "unfavorable", "neutral", "mixed"]);

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  allowed: readonly string[],
  label: string,
): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allow.has(key));
  if (unexpected.length > 0)
    throw new Error(
      `${label} has unexpected fields: ${unexpected.sort().join(", ")}`,
    );
}

function stringValue(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    [...value].length > maximum
  )
    throw new Error(`${label} must be a bounded non-empty string`);
  return value;
}

function nullableString(
  value: unknown,
  label: string,
  maximum = 600,
): string | null {
  if (value === null) return null;
  return stringValue(value, label, maximum);
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  return value as number;
}

function isoTimestamp(value: unknown, label: string): string {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  )
    date = (value as { toDate(): Date }).toDate();
  else if (typeof value === "string") date = new Date(value);
  else throw new Error(`${label} must be a timestamp`);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

function firestoreJson(value: unknown, label = "Firestore value"): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (value instanceof Date) return isoTimestamp(value, label);
  if (Array.isArray(value))
    return value.map((item, index) =>
      firestoreJson(item, `${label}[${index}]`),
    );
  if (typeof value === "object") {
    if (
      "toDate" in value &&
      typeof (value as { toDate?: unknown }).toDate === "function"
    )
      return isoTimestamp(value, label);
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value))
      result[key] = firestoreJson(item, `${label}.${key}`);
    return result;
  }
  throw new Error(`${label} is not JSON-compatible`);
}

function jsonObject(value: unknown, label: string): JsonObject {
  return object(firestoreJson(value, label), label);
}

function hash(value: unknown, label: string): string {
  const result = stringValue(value, label, 71);
  if (!SHA256.test(result)) throw new Error(`${label} is not a SHA-256 value`);
  return result;
}

function articleKey(value: unknown): string {
  const result = stringValue(value, "article_key", 509);
  if (!ARTICLE_KEY.test(result) || /%2f|%5c|\\|\.\./i.test(result))
    throw new Error("article_key is invalid");
  return result;
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function modelLabels(value: unknown): JsonObject {
  const labels = object(value, "model_labels");
  exactKeys(
    labels,
    ["leaning", "russia_stance", "party_tones"],
    "model_labels",
  );
  const leaning = stringValue(labels.leaning, "model_labels.leaning", 64);
  const russia = stringValue(
    labels.russia_stance,
    "model_labels.russia_stance",
    64,
  );
  if (!LEANING.has(leaning) || !RUSSIA.has(russia))
    throw new Error("model_labels contains an unknown scalar label");
  if (!Array.isArray(labels.party_tones) || labels.party_tones.length > 30)
    throw new Error("model_labels.party_tones must be a bounded array");
  const parties = labels.party_tones.map((raw, index) => {
    const party = object(raw, `model_labels.party_tones[${index}]`);
    exactKeys(
      party,
      ["party", "party_id", "tone"],
      `model_labels.party_tones[${index}]`,
    );
    const tone = stringValue(party.tone, "model party tone", 32);
    if (!PARTY_TONE.has(tone)) throw new Error("model party tone is invalid");
    return {
      party: stringValue(party.party, "model party", 160),
      party_id:
        party.party_id === null
          ? null
          : stringValue(party.party_id, "model party ID", 160),
      tone,
    };
  });
  return { leaning, russia_stance: russia, party_tones: parties };
}

function submissionRecord(
  snapshot: OperatorDocumentSnapshot,
): RawSubmissionRecord {
  if (!snapshot.exists) throw new Error(`submission ${snapshot.id} is missing`);
  const raw = object(snapshot.data(), `submission ${snapshot.id}`);
  const schemaVersion = safeInteger(raw.schema_version, "schema_version", 1);
  if (schemaVersion !== 1)
    throw new Error("submission schema_version is unsupported");
  if (raw.mode !== "community")
    throw new Error("submission mode is not community");
  const submissionId = stringValue(raw.submission_id, "submission_id", 128);
  if (submissionId !== snapshot.id)
    throw new Error("submission ID does not match its document key");
  const evaluation = jsonObject(raw.evaluation, "evaluation");
  const schemaErrors = validateSchema(ARTICLE_SCHEMA, evaluation);
  if (schemaErrors.length > 0)
    throw new Error(
      `submission evaluation is invalid: ${schemaErrors.join("; ")}`,
    );
  const status = stringValue(raw.status, "status", 32);
  if (!STATUS.has(status)) throw new Error("submission status is invalid");
  return {
    schema_version: 1,
    rubric_version: RUBRIC,
    submission_id: submissionId,
    mode: "community",
    article_key: articleKey(raw.article_key),
    task_revision: safeInteger(raw.task_revision, "task_revision", 1),
    content_sha256: hash(raw.content_sha256, "content_sha256"),
    analysis_sha256: hash(raw.analysis_sha256, "analysis_sha256"),
    submitted_at: isoTimestamp(raw.submitted_at, "submitted_at"),
    evaluation,
    model_labels: modelLabels(firestoreJson(raw.model_labels)),
    status: status as RawSubmissionRecord["status"],
  };
}

export function buildRawSubmissionExport(
  projectId: string,
  snapshot: OperatorQuerySnapshot,
): RawSubmissionExport {
  const project = stringValue(projectId, "project ID", 128);
  const records = snapshot.docs.map(submissionRecord).sort((left, right) => {
    for (const key of [
      "article_key",
      "submitted_at",
      "submission_id",
    ] as const) {
      const order = compareText(left[key], right[key]);
      if (order !== 0) return order;
    }
    return 0;
  });
  if (records.length === 0)
    throw new Error(
      "Firestore returned no submissions; retaining the last known-good export",
    );
  const firestoreReadTime = isoTimestamp(
    snapshot.readTime,
    "Firestore read time",
  );
  return {
    manifest: {
      schema_version: 1,
      export_kind: "news-eval-community-submissions",
      project_id: project,
      firestore_read_time: firestoreReadTime,
      rubric_version: RUBRIC,
      record_count: records.length,
      records_sha256: canonicalSha256(records),
    },
    records,
  };
}

export function serializeRawSubmissionExport(
  value: RawSubmissionExport,
): string {
  validateRawSubmissionExport(value);
  return (
    [
      canonicalJson({ kind: "manifest", ...value.manifest }),
      ...value.records.map((record) =>
        canonicalJson({ kind: "submission", ...record }),
      ),
    ].join("\n") + "\n"
  );
}

export function parseRawSubmissionExport(
  serialized: string,
): RawSubmissionExport {
  const lines = serialized.split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) throw new Error("raw export is empty");
  const first = object(JSON.parse(lines[0]!), "raw export manifest line");
  if (first.kind !== "manifest")
    throw new Error("first export line is not a manifest");
  const { kind: _manifestKind, ...manifest } = first;
  void _manifestKind;
  const records = lines.slice(1).map((line, index) => {
    const row = object(JSON.parse(line), `raw export record ${index}`);
    if (row.kind !== "submission")
      throw new Error(`raw export record ${index} has the wrong kind`);
    const { kind: _recordKind, ...record } = row;
    void _recordKind;
    return record as RawSubmissionRecord;
  });
  const result = { manifest, records } as unknown as RawSubmissionExport;
  validateRawSubmissionExport(result);
  return result;
}

export function validateRawSubmissionExport(value: RawSubmissionExport): void {
  const manifest = object(value.manifest, "raw export manifest");
  exactKeys(
    manifest,
    [
      "schema_version",
      "export_kind",
      "project_id",
      "firestore_read_time",
      "rubric_version",
      "record_count",
      "records_sha256",
    ],
    "raw export manifest",
  );
  if (
    manifest.schema_version !== 1 ||
    manifest.export_kind !== "news-eval-community-submissions" ||
    manifest.rubric_version !== RUBRIC
  )
    throw new Error("raw export manifest contract is unsupported");
  stringValue(manifest.project_id, "project_id", 128);
  isoTimestamp(manifest.firestore_read_time, "firestore_read_time");
  if (
    safeInteger(manifest.record_count, "record_count") !== value.records.length
  )
    throw new Error("raw export record count does not match");
  const expected = canonicalSha256(value.records);
  if (manifest.records_sha256 !== expected)
    throw new Error("raw export records hash does not match");
  let prior: RawSubmissionRecord | null = null;
  const seen = new Set<string>();
  for (const record of value.records) {
    if (seen.has(record.submission_id))
      throw new Error("raw export contains duplicate submission IDs");
    seen.add(record.submission_id);
    const normalized = submissionRecord({
      id: record.submission_id,
      exists: true,
      data: () => record as unknown as JsonObject,
    });
    if (canonicalJson(normalized) !== canonicalJson(record))
      throw new Error("raw export record is not normalized");
    if (prior) {
      const ordered = [prior, record].sort((left, right) => {
        for (const key of [
          "article_key",
          "submitted_at",
          "submission_id",
        ] as const) {
          const order = compareText(left[key], right[key]);
          if (order !== 0) return order;
        }
        return 0;
      });
      if (ordered[0] !== prior)
        throw new Error("raw export records are not sorted");
    }
    prior = record;
  }
}

function increment(target: JsonObject, label: string): void {
  target[label] = safeInteger(target[label] ?? 0, `count ${label}`) + 1;
}

function communityDistribution(
  records: readonly RawSubmissionRecord[],
): JsonObject {
  const leaning: JsonObject = {};
  const russia: JsonObject = {};
  const partyTones: JsonObject = {};
  for (const record of records.filter(
    (item) => item.status !== "quarantined",
  )) {
    const evaluation = object(record.evaluation, "evaluation");
    const leaningDecision = object(evaluation.leaning, "leaning");
    const russiaDecision = object(evaluation.russia_stance, "russia_stance");
    increment(leaning, String(leaningDecision.label));
    increment(russia, String(russiaDecision.label));
    for (const rawParty of evaluation.party_tones as JsonObject[]) {
      const party = object(rawParty, "party tone");
      const key =
        typeof party.party_id === "string"
          ? `id:${party.party_id}`
          : `surface:${String(party.party).normalize("NFC").toLowerCase()}`;
      const counts = object(partyTones[key] ?? {}, "party counts");
      increment(counts, String(party.tone));
      partyTones[key] = counts;
    }
  }
  return { leaning, russia_stance: russia, party_tones: partyTones };
}

export async function buildLocalReviewBundle(
  exported: RawSubmissionExport,
  readArticle: (
    articleKey: string,
  ) => Promise<Readonly<{ path: string; article: JsonObject }>>,
): Promise<JsonObject> {
  validateRawSubmissionExport(exported);
  const groups = new Map<string, RawSubmissionRecord[]>();
  for (const record of exported.records) {
    const group = groups.get(record.article_key) ?? [];
    group.push(record);
    groups.set(record.article_key, group);
  }
  const articles: JsonObject[] = [];
  for (const key of [...groups.keys()].sort(compareText)) {
    const records = groups.get(key)!;
    const local = await readArticle(key);
    const article = object(local.article, `local article ${key}`);
    const content = stringValue(
      article.content,
      `local article ${key}.content`,
      2_000_000,
    );
    const localHash = contentSha256(content);
    articles.push({
      article_key: key,
      source_content_hashes: [
        ...new Set(records.map((record) => record.content_sha256)),
      ].sort(compareText),
      local_content_sha256: localHash,
      local_content_matches_all_submissions: records.every(
        (record) => record.content_sha256 === localHash,
      ),
      local_article_path: stringValue(local.path, "local article path", 4096),
      local_article: firestoreJson(article),
      community_distribution: communityDistribution(records),
      submissions: records,
    });
  }
  return {
    schema_version: 1,
    bundle_kind: "news-eval-local-review",
    source_records_sha256: exported.manifest.records_sha256,
    firestore_read_time: exported.manifest.firestore_read_time,
    article_count: articles.length,
    submission_count: exported.records.length,
    articles,
  };
}

export function parseReviewCommand(value: unknown): ReviewCommand {
  const raw = object(value, "review command");
  const common = [
    "schema_version",
    "operation_id",
    "occurred_at",
    "actor",
    "action",
    "article_key",
    "content_sha256",
    "source_submission_ids",
    "reason",
  ];
  const action = stringValue(raw.action, "action", 64);
  const accepted = action === "adjudication_accepted";
  if (
    !accepted &&
    action !== "submission_reviewed" &&
    action !== "submission_quarantined"
  )
    throw new Error("review command action is unsupported");
  exactKeys(
    raw,
    accepted
      ? [
          ...common,
          "expected_task_revision",
          "analysis_sha256",
          "expected_adjudication_revision",
          "evaluation",
          "public_explanation",
        ]
      : common,
    "review command",
  );
  if (raw.schema_version !== 1)
    throw new Error("review command schema is unsupported");
  const operationId = stringValue(raw.operation_id, "operation_id", 96);
  if (!IDENTIFIER.test(operationId)) throw new Error("operation_id is invalid");
  const actorRaw = object(raw.actor, "actor");
  exactKeys(actorRaw, ["kind", "id"], "actor");
  if (actorRaw.kind !== "maintainer")
    throw new Error("only a maintainer actor may apply reviews");
  const actor = {
    kind: "maintainer" as const,
    id: stringValue(actorRaw.id, "actor.id", 128),
  };
  if (!Array.isArray(raw.source_submission_ids))
    throw new Error("source_submission_ids must be an array");
  const ids = raw.source_submission_ids.map((id) =>
    stringValue(id, "source submission ID", 128),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("source_submission_ids contains duplicates");
  const base = {
    schemaVersion: 1 as const,
    operationId,
    occurredAt: isoTimestamp(raw.occurred_at, "occurred_at"),
    actor,
    articleKey: articleKey(raw.article_key),
    contentSha256: hash(raw.content_sha256, "content_sha256"),
    reason: raw.reason === null ? null : nullableString(raw.reason, "reason"),
  };
  if (!accepted) {
    if (ids.length !== 1)
      throw new Error(
        "submission review commands require exactly one source submission",
      );
    return {
      ...base,
      action,
      sourceSubmissionIds: [ids[0]!] as const,
    };
  }
  if (ids.length === 0)
    throw new Error("accepted adjudication requires source submissions");
  const evaluation = jsonObject(raw.evaluation, "evaluation");
  const schemaErrors = validateSchema(ARTICLE_SCHEMA, evaluation);
  if (schemaErrors.length > 0)
    throw new Error(
      `adjudication evaluation is invalid: ${schemaErrors.join("; ")}`,
    );
  return {
    ...base,
    action: "adjudication_accepted",
    sourceSubmissionIds: [...ids].sort(compareText),
    expectedTaskRevision: safeInteger(
      raw.expected_task_revision,
      "expected_task_revision",
      1,
    ),
    analysisSha256: hash(raw.analysis_sha256, "analysis_sha256"),
    expectedAdjudicationRevision: safeInteger(
      raw.expected_adjudication_revision,
      "expected_adjudication_revision",
    ),
    evaluation,
    publicExplanation:
      raw.public_explanation === null
        ? null
        : nullableString(raw.public_explanation, "public_explanation"),
  };
}

function encodedArticleKey(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function stateHash(value: JsonObject | null): string | null {
  return value === null ? null : canonicalSha256(value);
}

function validateEvent(value: JsonObject): void {
  const errors = validateSchema(EVENT_SCHEMA, value);
  if (errors.length > 0)
    throw new Error(`operator event is invalid: ${errors.join("; ")}`);
}

function matchingEvent(
  snapshot: OperatorDocumentSnapshot,
  command: ReviewCommand,
  targetKind: "submission" | "adjudication",
  targetId: string,
): boolean {
  if (!snapshot.exists) return false;
  const event = jsonObject(snapshot.data(), "existing operator event");
  const target = object(event.target, "existing event target");
  if (
    event.event_id !== command.operationId ||
    event.action !== command.action ||
    event.occurred_at !== command.occurredAt ||
    canonicalJson(event.actor) !== canonicalJson(command.actor) ||
    target.kind !== targetKind ||
    target.id !== targetId ||
    target.article_key !== command.articleKey ||
    (event.reason ?? null) !== command.reason
  )
    throw new Error("operation_id is already bound to another operator event");
  return true;
}

function eventFor(input: {
  command: ReviewCommand;
  action: string;
  targetKind: "submission" | "adjudication";
  targetId: string;
  before: JsonObject | null;
  after: JsonObject | null;
  eventId?: string;
  reason?: string | null;
}): JsonObject {
  const event = {
    schema_version: 1,
    event_id: input.eventId ?? input.command.operationId,
    occurred_at: input.command.occurredAt,
    actor: input.command.actor,
    action: input.action,
    target: {
      kind: input.targetKind,
      id: input.targetId,
      article_key: input.command.articleKey,
    },
    before_sha256: stateHash(input.before),
    after_sha256: stateHash(input.after),
    reason: input.reason === undefined ? input.command.reason : input.reason,
  };
  validateEvent(event);
  return event;
}

export class FirestoreOperatorStore {
  readonly #database: OperatorFirestore;

  constructor(database: OperatorFirestore) {
    this.#database = database;
  }

  async exportSubmissions(projectId: string): Promise<RawSubmissionExport> {
    const snapshot = await this.#database
      .collection("news_eval_submissions")
      .get();
    return buildRawSubmissionExport(projectId, snapshot);
  }

  async apply(commandValue: unknown): Promise<ApplyReviewResult> {
    const command = parseReviewCommand(commandValue);
    if (command.action === "adjudication_accepted")
      return this.#acceptAdjudication(command);
    return this.#reviewSubmission(command);
  }

  async #reviewSubmission(
    command: Extract<
      ReviewCommand,
      { action: "submission_reviewed" | "submission_quarantined" }
    >,
  ): Promise<ApplyReviewResult> {
    const submissionId = command.sourceSubmissionIds[0];
    const submissionRef = this.#database
      .collection("news_eval_submissions")
      .doc(submissionId);
    const eventRef = this.#database
      .collection("news_eval_events")
      .doc(command.operationId);
    return this.#database.runTransaction(async (transaction) => {
      const [submissionSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(submissionRef),
        transaction.get(eventRef),
      ]);
      if (!submissionSnapshot.exists)
        throw new Error(`source submission ${submissionId} was not found`);
      const before = jsonObject(submissionSnapshot.data(), "source submission");
      if (
        before.article_key !== command.articleKey ||
        before.content_sha256 !== command.contentSha256
      )
        throw new Error(
          "source submission no longer matches the review command",
        );
      const desiredStatus =
        command.action === "submission_reviewed" ? "reviewed" : "quarantined";
      if (matchingEvent(eventSnapshot, command, "submission", submissionId)) {
        if (
          before.status !== desiredStatus ||
          before.last_review_operation_id !== command.operationId
        )
          throw new Error(
            "operator event exists but submission state does not match",
          );
        return {
          operationId: command.operationId,
          idempotent: true,
          articleKey: command.articleKey,
          status: desiredStatus,
        };
      }
      if (before.status === "promoted")
        throw new Error("a promoted source submission cannot be reclassified");
      const patch: JsonObject = {
        status: desiredStatus,
        reviewed_at: command.occurredAt,
        reviewed_by: command.actor,
        last_review_operation_id: command.operationId,
      };
      const after = { ...before, ...patch };
      const event = eventFor({
        command,
        action: command.action,
        targetKind: "submission",
        targetId: submissionId,
        before,
        after,
      });
      transaction.set(submissionRef, patch, { merge: true });
      transaction.set(eventRef, event);
      return {
        operationId: command.operationId,
        idempotent: false,
        articleKey: command.articleKey,
        status: desiredStatus,
      };
    });
  }

  async #acceptAdjudication(
    command: Extract<ReviewCommand, { action: "adjudication_accepted" }>,
  ): Promise<ApplyReviewResult> {
    const encoded = encodedArticleKey(command.articleKey);
    const taskRef = this.#database.collection("news_eval_tasks").doc(encoded);
    const adjudicationRef = this.#database
      .collection("news_eval_adjudications")
      .doc(encoded);
    const eventRef = this.#database
      .collection("news_eval_events")
      .doc(command.operationId);
    const supersededEventRef = this.#database
      .collection("news_eval_events")
      .doc(`${command.operationId}-superseded`);
    const sourceRefs = command.sourceSubmissionIds.map((id) =>
      this.#database.collection("news_eval_submissions").doc(id),
    );
    return this.#database.runTransaction(async (transaction) => {
      const [taskSnapshot, currentSnapshot, eventSnapshot, supersededSnapshot] =
        await Promise.all([
          transaction.get(taskRef),
          transaction.get(adjudicationRef),
          transaction.get(eventRef),
          transaction.get(supersededEventRef),
        ]);
      const sourceSnapshots = [];
      for (const reference of sourceRefs)
        sourceSnapshots.push(await transaction.get(reference));
      const current = currentSnapshot.exists
        ? jsonObject(currentSnapshot.data(), "current adjudication")
        : null;
      if (matchingEvent(eventSnapshot, command, "adjudication", encoded)) {
        if (
          !current ||
          current.last_operation_id !== command.operationId ||
          current.status !== "accepted" ||
          current.task_revision !== command.expectedTaskRevision ||
          current.content_sha256 !== command.contentSha256 ||
          current.analysis_sha256 !== command.analysisSha256 ||
          current.revision !== command.expectedAdjudicationRevision + 1 ||
          current.adjudicated_at !== command.occurredAt ||
          canonicalJson(current.operator_actor) !==
            canonicalJson(command.actor) ||
          canonicalJson(current.source_submission_ids) !==
            canonicalJson(command.sourceSubmissionIds) ||
          canonicalJson(current.evaluation) !==
            canonicalJson(command.evaluation) ||
          (current.public_explanation ?? null) !== command.publicExplanation
        )
          throw new Error(
            "operator event exists but adjudication state does not match",
          );
        return {
          operationId: command.operationId,
          idempotent: true,
          articleKey: command.articleKey,
          status: "accepted",
          adjudicationRevision: safeInteger(current.revision, "revision", 1),
          goldEligible: current.gold_eligible === true,
        };
      }
      if (supersededSnapshot.exists)
        throw new Error(
          "supersession event exists without its acceptance event",
        );
      if (!taskSnapshot.exists)
        throw new Error("evaluation task was not found");
      const task = jsonObject(taskSnapshot.data(), "evaluation task");
      if (
        task.article_key !== command.articleKey ||
        task.content_sha256 !== command.contentSha256
      )
        throw new Error("adjudication content hash is stale");
      if (
        task.revision !== command.expectedTaskRevision ||
        task.analysis_sha256 !== command.analysisSha256
      )
        throw new Error("adjudication task or analysis revision is stale");
      const currentRevision = current
        ? safeInteger(current.revision, "current adjudication revision", 1)
        : 0;
      if (currentRevision !== command.expectedAdjudicationRevision)
        throw new Error(
          `adjudication revision conflict: expected ${command.expectedAdjudicationRevision}, current ${currentRevision}`,
        );
      const trustedModelLabels = modelLabels(firestoreJson(task.model_labels));
      const semantics = validateEvaluationSemantics(command.evaluation, {
        model_labels: trustedModelLabels,
      });
      if (semantics.errorCodes.length > 0)
        throw new Error(
          `adjudication evaluation is inconsistent with the current task: ${semantics.errorCodes.join(", ")}`,
        );
      for (let index = 0; index < sourceSnapshots.length; index += 1) {
        const snapshot = sourceSnapshots[index];
        const expectedId = command.sourceSubmissionIds[index];
        if (!snapshot?.exists)
          throw new Error(`source submission ${expectedId} was not found`);
        const source = submissionRecord(snapshot);
        if (
          source.submission_id !== expectedId ||
          source.article_key !== command.articleKey ||
          source.content_sha256 !== command.contentSha256
        )
          throw new Error(
            `source submission ${expectedId} is stale or mismatched`,
          );
        if (source.status === "quarantined")
          throw new Error(`source submission ${expectedId} is quarantined`);
      }
      const nextRevision = currentRevision + 1;
      const after: JsonObject = {
        schema_version: 1,
        article_key: command.articleKey,
        task_revision: command.expectedTaskRevision,
        content_sha256: command.contentSha256,
        analysis_sha256: command.analysisSha256,
        source_submission_ids: command.sourceSubmissionIds,
        operator_actor: command.actor,
        adjudicated_at: command.occurredAt,
        revision: nextRevision,
        evaluation: command.evaluation,
        public_explanation: command.publicExplanation,
        gold_eligible: semantics.goldEligible,
        status: "accepted",
        last_operation_id: command.operationId,
      };
      const acceptedEvent = eventFor({
        command,
        action: "adjudication_accepted",
        targetKind: "adjudication",
        targetId: encoded,
        before: current,
        after,
      });
      if (current) {
        const supersededEvent = eventFor({
          command,
          action: "adjudication_superseded",
          targetKind: "adjudication",
          targetId: encoded,
          before: current,
          after,
          eventId: `${command.operationId}-superseded`,
          reason: "Replaced atomically by a newer accepted adjudication.",
        });
        transaction.set(supersededEventRef, supersededEvent);
      }
      for (const reference of sourceRefs) {
        transaction.set(
          reference,
          {
            status: "promoted",
            promoted_at: command.occurredAt,
            promoted_by: command.actor,
            last_review_operation_id: command.operationId,
          },
          { merge: true },
        );
      }
      transaction.set(adjudicationRef, after);
      transaction.set(eventRef, acceptedEvent);
      return {
        operationId: command.operationId,
        idempotent: false,
        articleKey: command.articleKey,
        status: "accepted",
        adjudicationRevision: nextRevision,
        goldEligible: semantics.goldEligible,
      };
    });
  }
}

export async function writeAtomicPrivateFile(
  destination: string,
  contents: string,
): Promise<void> {
  if (!destination) throw new Error("output path is required");
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readRawSubmissionExport(
  source: string,
): Promise<RawSubmissionExport> {
  return parseRawSubmissionExport(await readFile(source, "utf8"));
}
