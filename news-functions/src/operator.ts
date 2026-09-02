import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import articleEvaluationSchema from "./eval-contract/article_evaluation.schema.json" with { type: "json" };
import articleFeedbackSchema from "./eval-contract/article_feedback_request.schema.json" with { type: "json" };
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

const MAX_EVAL_SOURCE_SUBMISSIONS = 200;
const MAX_FEEDBACK_TASKS = 20_000;

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

type OperatorQueryReference = Readonly<{
  path: string;
  get(): Promise<OperatorQuerySnapshot>;
}>;

type OperatorCollectionReference = OperatorQueryReference &
  Readonly<{
    doc(id: string): OperatorDocumentReference;
    where(
      fieldPath: string,
      operator: "==",
      value: unknown,
    ): OperatorQueryReference;
  }>;

type OperatorTransaction = Readonly<{
  get(reference: OperatorDocumentReference): Promise<OperatorDocumentSnapshot>;
  get(reference: OperatorQueryReference): Promise<OperatorQuerySnapshot>;
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

export type AcceptedAdjudicationRecord = Readonly<{
  schema_version: 1;
  rubric_version: "news-article-evaluation-v1";
  article_key: string;
  url: string;
  task_revision: number;
  content_sha256: string;
  analysis_sha256: string;
  source_submission_ids: readonly string[];
  operator_actor: Readonly<{ kind: "maintainer"; id: string }>;
  adjudicated_at: string;
  revision: number;
  evaluation: JsonObject;
  model_labels: JsonObject;
  public_explanation: string | null;
  gold_eligible: boolean;
  status: "accepted";
  last_operation_id: string;
}>;

export type AcceptedAdjudicationSnapshot = Readonly<{
  manifest: Readonly<{
    schema_version: 1;
    snapshot_kind: "news-eval-accepted-adjudications";
    project_id: string;
    firestore_read_time: string;
    rubric_version: "news-article-evaluation-v1";
    record_count: number;
    records_sha256: string;
  }>;
  records: readonly AcceptedAdjudicationRecord[];
}>;

export type RawFeedbackRecord = Readonly<{
  schema_version: 1;
  contract: "article-feedback-v1";
  submission_id: string;
  mode: "article_feedback";
  article_key: string;
  task_revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  target_registry_sha256: string;
  public_data_revision: string;
  submitted_at: string;
  feedback: JsonObject;
  status: "raw" | "quarantined" | "reviewed" | "promoted";
}>;

export type RawFeedbackExport = Readonly<{
  manifest: Readonly<{
    schema_version: 1;
    export_kind: "news-feedback-community-submissions";
    project_id: string;
    firestore_read_time: string;
    record_count: number;
    records_sha256: string;
  }>;
  records: readonly RawFeedbackRecord[];
}>;

export type AcceptedFeedbackRecord = Readonly<{
  schema_version: 1;
  contract: "article-feedback-v1";
  article_key: string;
  url: string;
  task_revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  target_registry_sha256: string;
  source_submission_ids: readonly string[];
  source_target_registry_sha256s: Readonly<Record<string, string>>;
  operator_actor: Readonly<{ kind: "maintainer"; id: string }>;
  adjudicated_at: string;
  revision: number;
  feedback: JsonObject;
  public_explanation: string | null;
  status: "accepted";
  last_operation_id: string;
}>;

export type AcceptedFeedbackSnapshot = Readonly<{
  manifest: Readonly<{
    schema_version: 1;
    snapshot_kind: "news-feedback-accepted-adjudications";
    project_id: string;
    firestore_read_time: string;
    record_count: number;
    records_sha256: string;
  }>;
  records: readonly AcceptedFeedbackRecord[];
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

export type FeedbackReviewCommand =
  | Readonly<{
      schemaVersion: 1;
      operationId: string;
      occurredAt: string;
      actor: Readonly<{ kind: "maintainer"; id: string }>;
      action: "submission_reviewed" | "submission_quarantined";
      articleKey: string;
      contentSha256: string;
      targetRegistrySha256: string;
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
      analysisSha256: string | null;
      targetRegistrySha256: string;
      sourceSubmissionIds: readonly string[];
      sourceTargetRegistrySha256s: Readonly<Record<string, string>>;
      expectedTaskRevision: number;
      expectedAdjudicationRevision: number;
      feedback: JsonObject;
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

export type TaskSyncResult = Readonly<{
  taskCount: number;
  activated: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  tasksSha256: string;
}>;

export type TaskReleaseProof = Readonly<{
  publicDataRevision: string;
  queueSha256: string;
  runId: string;
  liveManifestUrl: string;
}>;

export type FeedbackTaskReleaseProof = Readonly<{
  publicDataRevision: string;
  runId: string;
  liveManifestUrl: string;
}>;

type LiveFetch = (
  url: string,
  init: Readonly<{ cache: "no-store" }>,
) => Promise<
  Readonly<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>
>;

const ARTICLE_KEY = /^[^/]{1,253}\/[^/]{1,255}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{16,96}$/;
const RUBRIC = "news-article-evaluation-v1" as const;
const ARTICLE_SCHEMA = articleEvaluationSchema as JsonObject;
const FEEDBACK_SCHEMA = articleFeedbackSchema as JsonObject;
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
const PRODUCTION_TASK_MANIFEST_URL =
  "https://storage.googleapis.com/data-electionsbg-com/news/app-data/manifest.json";
const TASK_FIELDS = [
  "schema_version",
  "rubric_version",
  "article_key",
  "domain",
  "article_id",
  "url",
  "title",
  "published",
  "story_id",
  "primary_topic",
  "outlet",
  "content_sha256",
  "public_data_revision",
  "analysis_sha256",
  "model",
  "analyzed_at",
  "prompt_hashes",
  "model_labels",
  "review_reasons",
  "dataset_ids",
  "accepts_public_evals",
  "revision",
  "updated_at",
] as const;
const ADJUDICATION_STORAGE_FIELDS = [
  "schema_version",
  "article_key",
  "url",
  "task_revision",
  "content_sha256",
  "analysis_sha256",
  "source_submission_ids",
  "operator_actor",
  "adjudicated_at",
  "revision",
  "evaluation",
  "model_labels",
  "public_explanation",
  "gold_eligible",
  "status",
  "last_operation_id",
] as const;
const ADJUDICATION_EXPORT_FIELDS = [
  "schema_version",
  "rubric_version",
  ...ADJUDICATION_STORAGE_FIELDS.slice(1),
] as const;
const FEEDBACK_ADJUDICATION_STORAGE_FIELDS = [
  "schema_version",
  "article_key",
  "url",
  "task_revision",
  "content_sha256",
  "analysis_sha256",
  "target_registry_sha256",
  "source_submission_ids",
  "source_target_registry_sha256s",
  "operator_actor",
  "adjudicated_at",
  "revision",
  "feedback",
  "public_explanation",
  "status",
  "last_operation_id",
] as const;
const FEEDBACK_ADJUDICATION_EXPORT_FIELDS = [
  "schema_version",
  "contract",
  ...FEEDBACK_ADJUDICATION_STORAGE_FIELDS.slice(1),
] as const;

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

export function strictHttpsUrl(value: unknown, label = "URL"): string {
  const result = stringValue(value, label, 2048);
  if (/\s/u.test(result))
    throw new Error(`${label} must not contain whitespace`);
  if (!result.startsWith("https://"))
    throw new Error(`${label} must be an absolute HTTPS URL`);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  return result;
}

function nullableString(
  value: unknown,
  label: string,
  maximum = 600,
): string | null {
  if (value === null) return null;
  return stringValue(value, label, maximum);
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : isoTimestamp(value, label);
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

export function deriveTaskRevision(
  contentHash: string,
  analysisHash: string,
  labels: JsonObject,
): number {
  const digest = canonicalSha256({
    rubric_version: RUBRIC,
    content_sha256: contentHash,
    analysis_sha256: analysisHash,
    model_labels: labels,
  }).slice("sha256:".length);
  return Number.parseInt(digest.slice(0, 12), 16) + 1;
}

function normalizedTask(value: unknown, label: string): JsonObject {
  const raw = object(value, label);
  exactKeys(raw, TASK_FIELDS, label);
  if (raw.schema_version !== 1 || raw.rubric_version !== RUBRIC)
    throw new Error(`${label} has an unsupported contract`);
  const key = articleKey(raw.article_key);
  const [domain, ident] = key.split("/");
  if (raw.domain !== domain || raw.article_id !== ident)
    throw new Error(`${label} identity fields disagree`);
  const url = strictHttpsUrl(raw.url, `${label}.url`);
  const promptHashes = object(raw.prompt_hashes, `${label}.prompt_hashes`);
  if (Object.keys(promptHashes).length > 20)
    throw new Error(`${label}.prompt_hashes is too large`);
  const normalizedPromptHashes: JsonObject = {};
  for (const name of Object.keys(promptHashes).sort(compareText)) {
    stringValue(name, `${label} prompt hash name`, 128);
    normalizedPromptHashes[name] = hash(
      promptHashes[name],
      `${label}.prompt_hashes.${name}`,
    );
  }
  const reasons = object(raw.review_reasons, `${label}.review_reasons`);
  if (Object.keys(reasons).length > 10)
    throw new Error(`${label}.review_reasons is too large`);
  const normalizedReasons: JsonObject = {};
  for (const field of Object.keys(reasons).sort(compareText))
    normalizedReasons[stringValue(field, `${label} review field`, 64)] =
      stringValue(reasons[field], `${label}.review_reasons.${field}`, 600);
  if (!Array.isArray(raw.dataset_ids) || raw.dataset_ids.length > 20)
    throw new Error(`${label}.dataset_ids must be a bounded array`);
  const datasetIds = raw.dataset_ids.map((item) =>
    stringValue(item, `${label} dataset ID`, 128),
  );
  if (new Set(datasetIds).size !== datasetIds.length)
    throw new Error(`${label}.dataset_ids contains duplicates`);
  if (raw.accepts_public_evals !== true)
    throw new Error(`${label} must be active`);
  const contentHash = hash(raw.content_sha256, `${label}.content_sha256`);
  const analysisHash = hash(raw.analysis_sha256, `${label}.analysis_sha256`);
  const labels = modelLabels(firestoreJson(raw.model_labels));
  const revision = safeInteger(raw.revision, `${label}.revision`, 1);
  if (revision !== deriveTaskRevision(contentHash, analysisHash, labels))
    throw new Error(`${label}.revision does not match its task inputs`);
  return {
    schema_version: 1,
    rubric_version: RUBRIC,
    article_key: key,
    domain,
    article_id: ident,
    url,
    title: stringValue(raw.title, `${label}.title`, 500),
    published: nullableTimestamp(raw.published, `${label}.published`),
    story_id:
      raw.story_id === null
        ? null
        : stringValue(raw.story_id, `${label}.story_id`, 160),
    primary_topic:
      raw.primary_topic === null
        ? null
        : stringValue(raw.primary_topic, `${label}.primary_topic`, 128),
    outlet: stringValue(raw.outlet, `${label}.outlet`, 160),
    content_sha256: contentHash,
    public_data_revision: isoTimestamp(
      raw.public_data_revision,
      `${label}.public_data_revision`,
    ),
    analysis_sha256: analysisHash,
    model:
      raw.model === null ? null : stringValue(raw.model, `${label}.model`, 160),
    analyzed_at: nullableTimestamp(raw.analyzed_at, `${label}.analyzed_at`),
    prompt_hashes: normalizedPromptHashes,
    model_labels: labels,
    review_reasons: normalizedReasons,
    dataset_ids: [...datasetIds].sort(compareText),
    accepts_public_evals: true,
    revision,
    updated_at: isoTimestamp(raw.updated_at, `${label}.updated_at`),
  };
}

function taskSyncManifest(value: unknown): {
  manifest: JsonObject;
  tasks: JsonObject[];
} {
  const raw = object(value, "task sync manifest");
  exactKeys(
    raw,
    [
      "schema_version",
      "manifest_kind",
      "generated_at",
      "public_data_revision",
      "rubric_version",
      "task_count",
      "tasks_sha256",
      "queue_sha256",
      "tasks",
    ],
    "task sync manifest",
  );
  if (
    raw.schema_version !== 1 ||
    raw.manifest_kind !== "news-eval-task-sync" ||
    raw.rubric_version !== RUBRIC
  )
    throw new Error("task sync manifest contract is unsupported");
  if (!Array.isArray(raw.tasks))
    throw new Error("task sync manifest tasks must be an array");
  if (raw.tasks.length > 200)
    throw new Error("task sync manifest exceeds the 200-task safety cap");
  const generatedAt = isoTimestamp(raw.generated_at, "manifest generated_at");
  const publicRevision = isoTimestamp(
    raw.public_data_revision,
    "manifest public_data_revision",
  );
  if (generatedAt !== publicRevision)
    throw new Error("task sync generation must equal its public revision");
  const tasks = raw.tasks.map((task, index) =>
    normalizedTask(task, `task ${index}`),
  );
  const seen = new Set<string>();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]!;
    const key = task.article_key as string;
    if (seen.has(key))
      throw new Error("task sync manifest has duplicate tasks");
    seen.add(key);
    if (
      task.updated_at !== generatedAt ||
      task.public_data_revision !== publicRevision
    )
      throw new Error(
        "task sync task revision metadata disagrees with manifest",
      );
    if (
      index > 0 &&
      compareText(tasks[index - 1]!.article_key as string, key) >= 0
    )
      throw new Error("task sync tasks are not strictly sorted");
  }
  if (safeInteger(raw.task_count, "task_count") !== tasks.length)
    throw new Error("task sync task_count does not match");
  const tasksHash = hash(raw.tasks_sha256, "tasks_sha256");
  const queueHash = hash(raw.queue_sha256, "queue_sha256");
  if (canonicalSha256(tasks) !== tasksHash)
    throw new Error("task sync tasks hash does not match");
  return {
    manifest: {
      schema_version: 1,
      manifest_kind: "news-eval-task-sync",
      generated_at: generatedAt,
      public_data_revision: publicRevision,
      rubric_version: RUBRIC,
      task_count: tasks.length,
      tasks_sha256: tasksHash,
      queue_sha256: queueHash,
    },
    tasks,
  };
}

const FEEDBACK_TASK_FIELDS = [
  "schema_version",
  "contract",
  "article_key",
  "domain",
  "article_id",
  "url",
  "title",
  "content_sha256",
  "analysis_sha256",
  "target_registry_sha256",
  "public_data_revision",
  "accepts_public_feedback",
  "revision",
  "updated_at",
] as const;

const FEEDBACK_TARGET_KINDS = new Set([
  "person",
  "party",
  "settlement",
  "institution",
  "company",
  "sector",
]);

function feedbackTargetRegistry(value: unknown): {
  generatedAt: string;
  targetsHash: string;
  targets: JsonObject[];
} {
  const raw = object(value, "feedback target registry");
  exactKeys(
    raw,
    ["version", "generated_at", "targets_sha256", "target_count", "targets"],
    "feedback target registry",
  );
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.targets) ||
    raw.targets.length > 20_000
  )
    throw new Error("feedback target registry contract is unsupported");
  const targets = raw.targets.map((value, index) => {
    const target = object(value, `feedback target ${index}`);
    exactKeys(
      target,
      ["kind", "id", "canonical", "href", "aliases"],
      `feedback target ${index}`,
    );
    const kind = stringValue(target.kind, `feedback target ${index}.kind`, 20);
    if (!FEEDBACK_TARGET_KINDS.has(kind))
      throw new Error(`feedback target ${index}.kind is unsupported`);
    if (
      !Array.isArray(target.aliases) ||
      target.aliases.length < 1 ||
      target.aliases.length > 20
    )
      throw new Error(`feedback target ${index}.aliases is invalid`);
    const aliases = target.aliases.map((alias, aliasIndex) =>
      stringValue(
        alias,
        `feedback target ${index}.aliases[${aliasIndex}]`,
        300,
      ),
    );
    if (new Set(aliases).size !== aliases.length)
      throw new Error(`feedback target ${index}.aliases are duplicated`);
    return {
      kind,
      id: stringValue(target.id, `feedback target ${index}.id`, 160),
      canonical: stringValue(
        target.canonical,
        `feedback target ${index}.canonical`,
        300,
      ),
      href: strictHttpsUrl(target.href, `feedback target ${index}.href`),
      aliases,
    };
  });
  if (safeInteger(raw.target_count, "feedback target_count") !== targets.length)
    throw new Error("feedback target registry count does not match");
  const seen = new Set<string>();
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (!(target.href as string).startsWith("https://electionsbg.com/"))
      throw new Error("feedback target href is outside the canonical site");
    const key = `${target.kind as string}\u0000${target.id as string}`;
    if (seen.has(key))
      throw new Error("feedback target registry has duplicate identities");
    seen.add(key);
    if (index > 0) {
      const prior = targets[index - 1]!;
      const order =
        compareText(prior.kind as string, target.kind as string) ||
        compareText(
          (prior.canonical as string).toLocaleLowerCase("bg"),
          (target.canonical as string).toLocaleLowerCase("bg"),
        ) ||
        compareText(prior.id as string, target.id as string);
      if (order >= 0)
        throw new Error("feedback target registry is not strictly sorted");
    }
  }
  const targetsHash = hash(raw.targets_sha256, "feedback targets_sha256");
  if (canonicalSha256(targets) !== targetsHash)
    throw new Error("feedback target registry hash does not match targets");
  return {
    generatedAt: isoTimestamp(raw.generated_at, "feedback target generated_at"),
    targetsHash,
    targets,
  };
}

function feedbackTargetRegistries(
  value: unknown | readonly unknown[],
): Map<string, ReturnType<typeof feedbackTargetRegistry>> {
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 100)
    throw new Error(
      "feedback target registry set must contain 1 to 100 snapshots",
    );
  const registries = new Map<
    string,
    ReturnType<typeof feedbackTargetRegistry>
  >();
  for (const item of values) {
    const registry = feedbackTargetRegistry(item);
    const prior = registries.get(registry.targetsHash);
    if (
      prior &&
      canonicalJson(prior.targets) !== canonicalJson(registry.targets)
    )
      throw new Error("feedback target registry hash collision");
    registries.set(registry.targetsHash, registry);
  }
  return registries;
}

export async function archiveFeedbackTargetRegistry(
  targetRegistryValue: unknown,
  registryDirectory: string,
): Promise<Readonly<{ path: string; targetsSha256: string }>> {
  const registry = feedbackTargetRegistry(targetRegistryValue);
  const directory = stringValue(registryDirectory, "registry directory", 4096);
  const name = `${registry.targetsHash.slice("sha256:".length)}.json`;
  const destination = join(directory, name);
  await writeAtomicPrivateFile(
    destination,
    `${canonicalJson(targetRegistryValue)}\n`,
  );
  return { path: destination, targetsSha256: registry.targetsHash };
}

function validateFeedbackTargetReferences(
  feedbackValue: JsonObject,
  registry: ReturnType<typeof feedbackTargetRegistry>,
): void {
  const keys = new Set(
    registry.targets.map(
      (target) => `${target.kind as string}\u0000${target.id as string}`,
    ),
  );
  for (const rawParty of feedbackValue.party_tones as unknown[]) {
    const party = object(rawParty, "feedback party tone");
    if (
      party.resolution_status === "selected" &&
      !keys.has(`party\u0000${party.party_id as string}`)
    )
      throw new Error("selected feedback party is absent from target registry");
  }
  for (const rawProposal of feedbackValue.link_proposals as unknown[]) {
    const proposal = object(rawProposal, "feedback link proposal");
    if (proposal.resolution_status !== "selected") continue;
    const reference = object(proposal.target_ref, "feedback target reference");
    if (!keys.has(`${reference.kind as string}\u0000${reference.id as string}`))
      throw new Error(
        "selected feedback target is absent from target registry",
      );
  }
}

function feedbackTaskRevision(
  contentHash: string,
  analysisHash: string | null,
  targetRegistryHash: string,
): number {
  const digest = canonicalSha256({
    contract: "article-feedback-v1",
    content_sha256: contentHash,
    analysis_sha256: analysisHash,
    target_registry_sha256: targetRegistryHash,
  }).slice("sha256:".length);
  return Number.parseInt(digest.slice(0, 12), 16) + 1;
}

function normalizedFeedbackTask(value: unknown, label: string): JsonObject {
  const raw = object(value, label);
  exactKeys(raw, FEEDBACK_TASK_FIELDS, label);
  if (
    raw.schema_version !== 1 ||
    raw.contract !== "article-feedback-v1" ||
    raw.accepts_public_feedback !== true
  )
    throw new Error(`${label} has an unsupported contract`);
  const key = articleKey(raw.article_key);
  const [domain, articleId] = key.split("/");
  if (raw.domain !== domain || raw.article_id !== articleId)
    throw new Error(`${label} identity fields disagree`);
  const contentHash = hash(raw.content_sha256, `${label}.content_sha256`);
  const analysisHash =
    raw.analysis_sha256 === null
      ? null
      : hash(raw.analysis_sha256, `${label}.analysis_sha256`);
  const targetRegistryHash = hash(
    raw.target_registry_sha256,
    `${label}.target_registry_sha256`,
  );
  const revision = safeInteger(raw.revision, `${label}.revision`, 1);
  if (
    revision !==
    feedbackTaskRevision(contentHash, analysisHash, targetRegistryHash)
  )
    throw new Error(`${label}.revision does not match its task inputs`);
  return {
    schema_version: 1,
    contract: "article-feedback-v1",
    article_key: key,
    domain,
    article_id: articleId,
    url: strictHttpsUrl(raw.url, `${label}.url`),
    title: stringValue(raw.title, `${label}.title`, 500),
    content_sha256: contentHash,
    analysis_sha256: analysisHash,
    target_registry_sha256: targetRegistryHash,
    public_data_revision: isoTimestamp(
      raw.public_data_revision,
      `${label}.public_data_revision`,
    ),
    accepts_public_feedback: true,
    revision,
    updated_at: isoTimestamp(raw.updated_at, `${label}.updated_at`),
  };
}

export function feedbackTaskSyncManifest(value: unknown): {
  manifest: JsonObject;
  tasks: JsonObject[];
} {
  const raw = object(value, "feedback task sync manifest");
  exactKeys(
    raw,
    [
      "schema_version",
      "manifest_kind",
      "generated_at",
      "public_data_revision",
      "task_count",
      "source_articles_sha256",
      "tasks_sha256",
      "tasks",
    ],
    "feedback task sync manifest",
  );
  if (
    raw.schema_version !== 1 ||
    raw.manifest_kind !== "news-feedback-task-sync"
  )
    throw new Error("feedback task sync manifest contract is unsupported");
  if (!Array.isArray(raw.tasks) || raw.tasks.length > MAX_FEEDBACK_TASKS)
    throw new Error("feedback task sync manifest tasks must be bounded");
  const generatedAt = isoTimestamp(raw.generated_at, "manifest generated_at");
  const publicRevision = isoTimestamp(
    raw.public_data_revision,
    "manifest public_data_revision",
  );
  if (generatedAt !== publicRevision)
    throw new Error("feedback task sync generation must equal public revision");
  const tasks = raw.tasks.map((task, index) =>
    normalizedFeedbackTask(task, `feedback task ${index}`),
  );
  const seen = new Set<string>();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]!;
    const key = task.article_key as string;
    if (seen.has(key)) throw new Error("feedback manifest has duplicate tasks");
    seen.add(key);
    if (
      task.public_data_revision !== publicRevision ||
      task.updated_at !== generatedAt ||
      (index > 0 &&
        compareText(tasks[index - 1]!.article_key as string, key) >= 0)
    )
      throw new Error("feedback tasks are stale or not strictly sorted");
  }
  if (safeInteger(raw.task_count, "task_count") !== tasks.length)
    throw new Error("feedback task_count does not match");
  const tasksHash = hash(raw.tasks_sha256, "tasks_sha256");
  if (canonicalSha256(tasks) !== tasksHash)
    throw new Error("feedback tasks hash does not match");
  const sourceArticlesHash = hash(
    raw.source_articles_sha256,
    "source_articles_sha256",
  );
  if (
    canonicalSha256(
      tasks.map((task) => ({
        article_key: task.article_key,
        analysis_sha256: task.analysis_sha256,
      })),
    ) !== sourceArticlesHash
  )
    throw new Error("feedback source articles hash does not match tasks");
  return {
    manifest: {
      schema_version: 1,
      manifest_kind: "news-feedback-task-sync",
      generated_at: generatedAt,
      public_data_revision: publicRevision,
      task_count: tasks.length,
      source_articles_sha256: sourceArticlesHash,
      tasks_sha256: tasksHash,
    },
    tasks,
  };
}

function taskReleaseProof(value: unknown): TaskReleaseProof {
  const raw = object(value, "task release proof");
  exactKeys(
    raw,
    ["publicDataRevision", "queueSha256", "runId", "liveManifestUrl"],
    "task release proof",
  );
  const liveManifestUrl = stringValue(
    raw.liveManifestUrl,
    "task release proof liveManifestUrl",
    2048,
  );
  const parsedUrl = new URL(liveManifestUrl);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    !parsedUrl.pathname.endsWith("/manifest.json")
  )
    throw new Error("task release proof has an unsafe live manifest URL");
  const runId = stringValue(raw.runId, "task release proof runId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId))
    throw new Error("task release proof runId is invalid");
  return {
    publicDataRevision: isoTimestamp(
      raw.publicDataRevision,
      "task release proof publicDataRevision",
    ),
    queueSha256: hash(raw.queueSha256, "task release proof queueSha256"),
    runId,
    liveManifestUrl: parsedUrl.toString(),
  };
}

async function fetchedBytes(
  fetcher: LiveFetch,
  url: string,
  label: string,
  maximum: number,
): Promise<Buffer> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`${label} returned HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maximum)
    throw new Error(`${label} exceeds its byte limit`);
  return body;
}

function validateLivePublicationManifest(live: JsonObject): void {
  if (
    (live.version !== 1 && live.version !== 2 && live.version !== 3) ||
    live.home_health_ready !== true
  )
    throw new Error(
      "live publication manifest is not a ready supported release",
    );
  if (live.version === 2 || live.version === 3) {
    const acceptedHash = live.accepted_snapshot_records_sha256;
    if (
      acceptedHash !== null &&
      (typeof acceptedHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(acceptedHash))
    )
      throw new Error("live publication accepted snapshot hash is invalid");
  }
  if (live.version === 3) {
    const acceptedFeedbackHash = live.accepted_feedback_records_sha256;
    if (
      acceptedFeedbackHash !== null &&
      (typeof acceptedFeedbackHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(acceptedFeedbackHash))
    )
      throw new Error("live publication accepted feedback hash is invalid");
  }
}

export async function verifyLiveTaskRelease(
  manifestValue: unknown,
  liveManifestUrlValue: string,
  fetcher: LiveFetch,
): Promise<TaskReleaseProof> {
  const parsed = taskSyncManifest(manifestValue);
  const liveUrl = new URL(
    stringValue(liveManifestUrlValue, "live manifest URL", 2048),
  );
  if (
    liveUrl.protocol !== "https:" ||
    liveUrl.username ||
    liveUrl.password ||
    liveUrl.search ||
    liveUrl.hash ||
    !liveUrl.pathname.endsWith("/manifest.json")
  )
    throw new Error(
      "live manifest URL must be a plain HTTPS manifest.json URL",
    );
  const liveBytes = await fetchedBytes(
    fetcher,
    liveUrl.toString(),
    "live publication manifest",
    2_000_000,
  );
  let liveValue: unknown;
  try {
    liveValue = JSON.parse(liveBytes.toString("utf8"));
  } catch {
    throw new Error("live publication manifest is not valid JSON");
  }
  const live = object(liveValue, "live publication manifest");
  validateLivePublicationManifest(live);
  const runId = stringValue(live.run_id, "live publication run_id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId))
    throw new Error("live publication run_id is invalid");
  const liveRevision = isoTimestamp(
    live.generated_at,
    "live publication generated_at",
  );
  if (liveRevision !== parsed.manifest.public_data_revision)
    throw new Error("live publication revision does not match task manifest");
  const dataBase = stringValue(
    live.data_base,
    "live publication data_base",
    256,
  );
  if (dataBase !== `versions/${runId}`)
    throw new Error("live publication data_base is invalid");
  const bundle = object(live.bundle, "live publication bundle");
  if (!Array.isArray(bundle.inventory) || bundle.inventory.length > 20_000)
    throw new Error("live publication inventory is invalid");
  const queueEntries = bundle.inventory.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as JsonObject).path === "evals/queue.json",
  );
  if (queueEntries.length !== 1)
    throw new Error("live publication inventory must contain one eval queue");
  const queueEntry = object(queueEntries[0], "live eval queue inventory entry");
  const rawQueueHash = stringValue(
    queueEntry.sha256,
    "live eval queue inventory SHA-256",
    64,
  );
  if (!/^[a-f0-9]{64}$/u.test(rawQueueHash))
    throw new Error("live eval queue inventory SHA-256 is invalid");
  const baseUrl = new URL("./", liveUrl);
  const queueUrl = new URL(`${dataBase}/evals/queue.json`, baseUrl);
  if (queueUrl.origin !== liveUrl.origin)
    throw new Error("live eval queue URL changes origin");
  const queueBytes = await fetchedBytes(
    fetcher,
    queueUrl.toString(),
    "live eval queue",
    2_000_000,
  );
  if (createHash("sha256").update(queueBytes).digest("hex") !== rawQueueHash)
    throw new Error("live eval queue bytes do not match publication inventory");
  let queueValue: unknown;
  try {
    queueValue = JSON.parse(queueBytes.toString("utf8"));
  } catch {
    throw new Error("live eval queue is not valid JSON");
  }
  const queue = object(queueValue, "live eval queue");
  if (
    queue.schema_version !== 1 ||
    queue.rubric_version !== RUBRIC ||
    isoTimestamp(queue.generated_at, "live eval queue generated_at") !==
      parsed.manifest.generated_at ||
    isoTimestamp(
      queue.public_data_revision,
      "live eval queue public_data_revision",
    ) !== parsed.manifest.public_data_revision ||
    safeInteger(queue.task_count, "live eval queue task_count") !==
      parsed.tasks.length
  )
    throw new Error("live eval queue metadata does not match task manifest");
  const queueHash = canonicalSha256(queue);
  if (queueHash !== parsed.manifest.queue_sha256)
    throw new Error("live eval queue hash does not match task manifest");
  return {
    publicDataRevision: liveRevision,
    queueSha256: queueHash,
    runId,
    liveManifestUrl: liveUrl.toString(),
  };
}

export async function verifyProjectTaskRelease(
  projectId: string,
  manifestValue: unknown,
  liveManifestUrlValue: string,
  fetcher: LiveFetch,
  firestoreEmulatorHost?: string,
): Promise<TaskReleaseProof> {
  const liveUrl = new URL(liveManifestUrlValue).toString();
  if (projectId === "electionsbg-news") {
    if (liveUrl !== PRODUCTION_TASK_MANIFEST_URL)
      throw new Error(
        "production task sync requires the exact production app-data manifest",
      );
  } else if (!firestoreEmulatorHost || !/^demo-[a-z0-9-]+$/u.test(projectId)) {
    throw new Error(
      "task release verification requires electionsbg-news or an explicit demo emulator project",
    );
  }
  return verifyLiveTaskRelease(manifestValue, liveUrl, fetcher);
}

export async function verifyLiveFeedbackTaskRelease(
  manifestValue: unknown,
  liveManifestUrlValue: string,
  fetcher: LiveFetch,
): Promise<FeedbackTaskReleaseProof> {
  const parsed = feedbackTaskSyncManifest(manifestValue);
  const liveUrl = new URL(
    stringValue(liveManifestUrlValue, "live manifest URL", 2048),
  );
  if (
    liveUrl.protocol !== "https:" ||
    liveUrl.username ||
    liveUrl.password ||
    liveUrl.search ||
    liveUrl.hash ||
    !liveUrl.pathname.endsWith("/manifest.json")
  )
    throw new Error(
      "live manifest URL must be a plain HTTPS manifest.json URL",
    );
  const liveBytes = await fetchedBytes(
    fetcher,
    liveUrl.toString(),
    "live publication manifest",
    2_000_000,
  );
  let liveValue: unknown;
  try {
    liveValue = JSON.parse(liveBytes.toString("utf8"));
  } catch {
    throw new Error("live publication manifest is not valid JSON");
  }
  const live = object(liveValue, "live publication manifest");
  validateLivePublicationManifest(live);
  const runId = stringValue(live.run_id, "live publication run_id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId))
    throw new Error("live publication run_id is invalid");
  const liveRevision = isoTimestamp(
    live.generated_at,
    "live publication generated_at",
  );
  if (liveRevision !== parsed.manifest.public_data_revision)
    throw new Error(
      "live publication revision does not match feedback task manifest",
    );
  const dataBase = stringValue(
    live.data_base,
    "live publication data_base",
    256,
  );
  if (dataBase !== `versions/${runId}`)
    throw new Error("live publication data_base is invalid");
  const bundle = object(live.bundle, "live publication bundle");
  if (!Array.isArray(bundle.inventory) || bundle.inventory.length > 20_000)
    throw new Error("live publication inventory is invalid");
  const targetEntries = bundle.inventory.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as JsonObject).path === "feedback-targets.json",
  );
  if (targetEntries.length !== 1)
    throw new Error("live publication feedback target registry is missing");
  const targetEntry = object(
    targetEntries[0],
    "live feedback target inventory entry",
  );
  const targetExpectedHash = stringValue(
    targetEntry.sha256,
    "live feedback target bundle SHA-256",
    64,
  );
  if (!/^[a-f0-9]{64}$/u.test(targetExpectedHash))
    throw new Error("live feedback target bundle SHA-256 is invalid");
  const baseUrl = new URL("./", liveUrl);
  const targetBytes = await fetchedBytes(
    fetcher,
    new URL(`${dataBase}/feedback-targets.json`, baseUrl).toString(),
    "live feedback target registry",
    20_000_000,
  );
  if (
    createHash("sha256").update(targetBytes).digest("hex") !==
    targetExpectedHash
  )
    throw new Error(
      "live feedback target registry bytes do not match inventory",
    );
  let targetValue: unknown;
  try {
    targetValue = JSON.parse(targetBytes.toString("utf8"));
  } catch {
    throw new Error("live feedback target registry is not valid JSON");
  }
  const targetRegistry = feedbackTargetRegistry(targetValue);
  const targetRegistryHash = targetRegistry.targetsHash;
  if (
    targetRegistry.generatedAt !== liveRevision ||
    parsed.tasks.some(
      (task) => task.target_registry_sha256 !== targetRegistryHash,
    )
  )
    throw new Error("feedback tasks do not match the live target registry");
  const articleEntries = bundle.inventory.filter((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return false;
    const path = (entry as JsonObject).path;
    return (
      typeof path === "string" &&
      /^articles\/[^/]+\.json$/u.test(path) &&
      path !== "articles/evals.json" &&
      path !== "articles/gold.json"
    );
  });
  if (articleEntries.length === 0)
    throw new Error("live publication has no article bundles");
  const publishedKeys = new Set<string>();
  const publishedArticles: Array<{
    article_key: string;
    analysis_sha256: string | null;
  }> = [];
  for (const rawEntry of articleEntries) {
    const entry = object(rawEntry, "live article inventory entry");
    const path = stringValue(entry.path, "live article bundle path", 512);
    const expectedHash = stringValue(
      entry.sha256,
      "live article bundle SHA-256",
      64,
    );
    if (!/^[a-f0-9]{64}$/u.test(expectedHash))
      throw new Error("live article bundle SHA-256 is invalid");
    const articleUrl = new URL(`${dataBase}/${path}`, baseUrl);
    if (articleUrl.origin !== liveUrl.origin)
      throw new Error("live article bundle URL changes origin");
    const bytes = await fetchedBytes(
      fetcher,
      articleUrl.toString(),
      `live ${path}`,
      5_000_000,
    );
    if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
      throw new Error(`live ${path} bytes do not match publication inventory`);
    let bundleValue: unknown;
    try {
      bundleValue = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`live ${path} is not valid JSON`);
    }
    const articleBundle = object(bundleValue, `live ${path}`);
    const domain = stringValue(
      articleBundle.domain,
      `live ${path} domain`,
      253,
    );
    if (path !== `articles/${domain}.json`)
      throw new Error(`live ${path} domain does not match its path`);
    if (
      isoTimestamp(articleBundle.generated_at, `live ${path} generated_at`) !==
      liveRevision
    )
      throw new Error(`live ${path} revision does not match publication`);
    if (!Array.isArray(articleBundle.articles))
      throw new Error(`live ${path} articles must be an array`);
    for (const rawArticle of articleBundle.articles) {
      const article = object(rawArticle, `live ${path} article`);
      const articleId = stringValue(article.id, `live ${path} article ID`, 255);
      const key = articleKey(`${domain}/${articleId}`);
      if (publishedKeys.has(key))
        throw new Error(`live publication has duplicate article ${key}`);
      publishedKeys.add(key);
      publishedArticles.push({
        article_key: key,
        analysis_sha256:
          article.analysis !== null &&
          typeof article.analysis === "object" &&
          !Array.isArray(article.analysis)
            ? canonicalSha256(article.analysis)
            : null,
      });
    }
  }
  publishedArticles.sort((left, right) =>
    compareText(left.article_key, right.article_key),
  );
  if (
    canonicalSha256(publishedArticles) !==
    parsed.manifest.source_articles_sha256
  )
    throw new Error(
      "feedback task source hash does not match live public analysis",
    );
  const desiredKeys = new Set(
    parsed.tasks.map((task) => task.article_key as string),
  );
  if (
    desiredKeys.size !== publishedKeys.size ||
    [...desiredKeys].some((key) => !publishedKeys.has(key))
  )
    throw new Error(
      "feedback task manifest does not exactly cover live public articles",
    );
  return {
    publicDataRevision: liveRevision,
    runId,
    liveManifestUrl: liveUrl.toString(),
  };
}

export async function verifyProjectFeedbackTaskRelease(
  projectId: string,
  manifestValue: unknown,
  liveManifestUrlValue: string,
  fetcher: LiveFetch,
  firestoreEmulatorHost?: string,
): Promise<FeedbackTaskReleaseProof> {
  const liveUrl = new URL(liveManifestUrlValue).toString();
  if (projectId === "electionsbg-news") {
    if (liveUrl !== PRODUCTION_TASK_MANIFEST_URL)
      throw new Error(
        "production feedback task sync requires the exact production app-data manifest",
      );
  } else if (!firestoreEmulatorHost || !/^demo-[a-z0-9-]+$/u.test(projectId)) {
    throw new Error(
      "feedback task release verification requires electionsbg-news or an explicit demo emulator project",
    );
  }
  return verifyLiveFeedbackTaskRelease(manifestValue, liveUrl, fetcher);
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

function normalizedFeedbackPayload(
  value: unknown,
  metadata: {
    articleKey: string;
    taskRevision: number;
    contentSha256: string;
    analysisSha256: string | null;
    targetRegistrySha256: string;
  },
): JsonObject {
  const feedback = jsonObject(firestoreJson(value), "feedback");
  const request = {
    schema_version: 1,
    article_key: metadata.articleKey,
    base_task_revision: metadata.taskRevision,
    content_sha256: metadata.contentSha256,
    analysis_sha256: metadata.analysisSha256,
    target_registry_sha256: metadata.targetRegistrySha256,
    idempotency_key: "operator-validation-key",
    turnstile_token: "operator-validation-token",
    browser_nonce: null,
    feedback,
  };
  const errors = validateSchema(FEEDBACK_SCHEMA, request);
  if (errors.length > 0)
    throw new Error(`feedback payload is invalid: ${errors.join("; ")}`);
  return feedback;
}

function feedbackSubmissionRecord(
  snapshot: OperatorDocumentSnapshot,
): RawFeedbackRecord {
  if (!snapshot.exists)
    throw new Error(`feedback submission ${snapshot.id} is missing`);
  const raw = object(snapshot.data(), `feedback submission ${snapshot.id}`);
  if (raw.schema_version !== 1 || raw.mode !== "article_feedback")
    throw new Error("feedback submission contract is unsupported");
  const submissionId = stringValue(raw.submission_id, "submission_id", 128);
  if (submissionId !== snapshot.id)
    throw new Error("feedback submission ID does not match its document key");
  const article = articleKey(raw.article_key);
  const taskRevision = safeInteger(raw.task_revision, "task_revision", 1);
  const contentHash = hash(raw.content_sha256, "content_sha256");
  const analysisHash =
    raw.analysis_sha256 === null
      ? null
      : hash(raw.analysis_sha256, "analysis_sha256");
  const targetHash = hash(raw.target_registry_sha256, "target_registry_sha256");
  const status = stringValue(raw.status, "status", 32);
  if (!STATUS.has(status))
    throw new Error("feedback submission status is invalid");
  return {
    schema_version: 1,
    contract: "article-feedback-v1",
    submission_id: submissionId,
    mode: "article_feedback",
    article_key: article,
    task_revision: taskRevision,
    content_sha256: contentHash,
    analysis_sha256: analysisHash,
    target_registry_sha256: targetHash,
    public_data_revision: isoTimestamp(
      raw.public_data_revision,
      "public_data_revision",
    ),
    submitted_at: isoTimestamp(raw.submitted_at, "submitted_at"),
    feedback: normalizedFeedbackPayload(raw.feedback, {
      articleKey: article,
      taskRevision,
      contentSha256: contentHash,
      analysisSha256: analysisHash,
      targetRegistrySha256: targetHash,
    }),
    status: status as RawFeedbackRecord["status"],
  };
}

export function buildRawFeedbackExport(
  projectId: string,
  snapshot: OperatorQuerySnapshot,
): RawFeedbackExport {
  const records = snapshot.docs
    .map(feedbackSubmissionRecord)
    .sort(
      (left, right) =>
        compareText(left.article_key, right.article_key) ||
        compareText(left.submitted_at, right.submitted_at) ||
        compareText(left.submission_id, right.submission_id),
    );
  if (records.length === 0)
    throw new Error(
      "Firestore returned no feedback; retaining the last known-good export",
    );
  return {
    manifest: {
      schema_version: 1,
      export_kind: "news-feedback-community-submissions",
      project_id: stringValue(projectId, "project ID", 128),
      firestore_read_time: isoTimestamp(
        snapshot.readTime,
        "Firestore read time",
      ),
      record_count: records.length,
      records_sha256: canonicalSha256(records),
    },
    records,
  };
}

export function validateRawFeedbackExport(value: RawFeedbackExport): void {
  const manifest = object(value.manifest, "raw feedback export manifest");
  exactKeys(
    manifest,
    [
      "schema_version",
      "export_kind",
      "project_id",
      "firestore_read_time",
      "record_count",
      "records_sha256",
    ],
    "raw feedback export manifest",
  );
  if (
    manifest.schema_version !== 1 ||
    manifest.export_kind !== "news-feedback-community-submissions"
  )
    throw new Error("raw feedback export contract is unsupported");
  stringValue(manifest.project_id, "project_id", 128);
  isoTimestamp(manifest.firestore_read_time, "firestore_read_time");
  if (
    safeInteger(manifest.record_count, "record_count") !== value.records.length
  )
    throw new Error("raw feedback export record count does not match");
  if (manifest.records_sha256 !== canonicalSha256(value.records))
    throw new Error("raw feedback export records hash does not match");
  let prior: RawFeedbackRecord | null = null;
  const seen = new Set<string>();
  for (const record of value.records) {
    if (seen.has(record.submission_id))
      throw new Error("raw feedback export has duplicate submission IDs");
    seen.add(record.submission_id);
    const normalized = feedbackSubmissionRecord({
      id: record.submission_id,
      exists: true,
      data: () => record as unknown as JsonObject,
    });
    if (canonicalJson(normalized) !== canonicalJson(record))
      throw new Error("raw feedback export record is not normalized");
    if (
      prior &&
      (compareText(prior.article_key, record.article_key) ||
        compareText(prior.submitted_at, record.submitted_at) ||
        compareText(prior.submission_id, record.submission_id)) >= 0
    )
      throw new Error("raw feedback export records are not sorted");
    prior = record;
  }
}

export function serializeRawFeedbackExport(value: RawFeedbackExport): string {
  validateRawFeedbackExport(value);
  return (
    [
      canonicalJson({ kind: "manifest", ...value.manifest }),
      ...value.records.map((record) =>
        canonicalJson({ kind: "feedback", ...record }),
      ),
    ].join("\n") + "\n"
  );
}

export function parseRawFeedbackExport(serialized: string): RawFeedbackExport {
  const lines = serialized.split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) throw new Error("raw feedback export is empty");
  const first = object(JSON.parse(lines[0]!), "raw feedback manifest line");
  if (first.kind !== "manifest")
    throw new Error("first feedback export line is not a manifest");
  const { kind: _manifestKind, ...manifest } = first;
  void _manifestKind;
  const records = lines.slice(1).map((line, index) => {
    const row = object(JSON.parse(line), `raw feedback record ${index}`);
    if (row.kind !== "feedback")
      throw new Error(`raw feedback record ${index} has the wrong kind`);
    const { kind: _recordKind, ...record } = row;
    void _recordKind;
    return record as RawFeedbackRecord;
  });
  const result = { manifest, records } as unknown as RawFeedbackExport;
  validateRawFeedbackExport(result);
  return result;
}

function acceptedAdjudicationRecord(
  value: unknown,
  label: string,
  documentId?: string,
): AcceptedAdjudicationRecord {
  const raw = jsonObject(value, label);
  exactKeys(
    raw,
    documentId ? ADJUDICATION_STORAGE_FIELDS : ADJUDICATION_EXPORT_FIELDS,
    label,
  );
  if (
    raw.schema_version !== 1 ||
    (!documentId && raw.rubric_version !== RUBRIC)
  )
    throw new Error(`${label} has an unsupported contract`);
  const key = articleKey(raw.article_key);
  if (documentId && documentId !== encodedArticleKey(key))
    throw new Error(`${label} document ID does not match article_key`);
  if (
    !Array.isArray(raw.source_submission_ids) ||
    raw.source_submission_ids.length === 0 ||
    raw.source_submission_ids.length > MAX_EVAL_SOURCE_SUBMISSIONS
  )
    throw new Error(`${label}.source_submission_ids must be bounded`);
  const sourceIds = raw.source_submission_ids.map((item) =>
    stringValue(item, `${label} source submission ID`, 128),
  );
  if (new Set(sourceIds).size !== sourceIds.length)
    throw new Error(`${label}.source_submission_ids contains duplicates`);
  const actor = object(raw.operator_actor, `${label}.operator_actor`);
  exactKeys(actor, ["kind", "id"], `${label}.operator_actor`);
  if (actor.kind !== "maintainer")
    throw new Error(`${label}.operator_actor must be a maintainer`);
  const evaluation = jsonObject(raw.evaluation, `${label}.evaluation`);
  const schemaErrors = validateSchema(ARTICLE_SCHEMA, evaluation);
  if (schemaErrors.length > 0)
    throw new Error(
      `${label}.evaluation is invalid: ${schemaErrors.join("; ")}`,
    );
  const trustedModelLabels = modelLabels(
    firestoreJson(raw.model_labels, `${label}.model_labels`),
  );
  const semantics = validateEvaluationSemantics(evaluation, {
    model_labels: trustedModelLabels,
  });
  if (semantics.errorCodes.length > 0)
    throw new Error(
      `${label}.evaluation is semantically invalid: ${semantics.errorCodes.join(", ")}`,
    );
  if (raw.gold_eligible !== semantics.goldEligible)
    throw new Error(`${label}.gold_eligible is inconsistent`);
  if (raw.status !== "accepted")
    throw new Error(`${label}.status is not accepted`);
  const operationId = stringValue(
    raw.last_operation_id,
    `${label}.last_operation_id`,
    96,
  );
  if (!IDENTIFIER.test(operationId))
    throw new Error(`${label}.last_operation_id is invalid`);
  const normalized: AcceptedAdjudicationRecord = {
    schema_version: 1,
    rubric_version: RUBRIC,
    article_key: key,
    url: strictHttpsUrl(raw.url, `${label}.url`),
    task_revision: safeInteger(raw.task_revision, `${label}.task_revision`, 1),
    content_sha256: hash(raw.content_sha256, `${label}.content_sha256`),
    analysis_sha256: hash(raw.analysis_sha256, `${label}.analysis_sha256`),
    source_submission_ids: [...sourceIds].sort(compareText),
    operator_actor: {
      kind: "maintainer",
      id: stringValue(actor.id, `${label}.operator_actor.id`, 128),
    },
    adjudicated_at: isoTimestamp(raw.adjudicated_at, `${label}.adjudicated_at`),
    revision: safeInteger(raw.revision, `${label}.revision`, 1),
    evaluation,
    model_labels: trustedModelLabels,
    public_explanation:
      raw.public_explanation === null
        ? null
        : nullableString(raw.public_explanation, `${label}.public_explanation`),
    gold_eligible: semantics.goldEligible,
    status: "accepted",
    last_operation_id: operationId,
  };
  if (!documentId && canonicalJson(normalized) !== canonicalJson(raw))
    throw new Error(`${label} is not normalized`);
  return normalized;
}

export function buildAcceptedAdjudicationSnapshot(
  projectId: string,
  snapshot: OperatorQuerySnapshot,
): AcceptedAdjudicationSnapshot {
  const records = snapshot.docs
    .map((item) =>
      acceptedAdjudicationRecord(
        item.data(),
        `accepted adjudication ${item.id}`,
        item.id,
      ),
    )
    .sort((left, right) => compareText(left.article_key, right.article_key));
  if (records.length === 0)
    throw new Error(
      "Firestore returned no accepted adjudications; retaining the last known-good snapshot",
    );
  return {
    manifest: {
      schema_version: 1,
      snapshot_kind: "news-eval-accepted-adjudications",
      project_id: stringValue(projectId, "project ID", 128),
      firestore_read_time: isoTimestamp(
        snapshot.readTime,
        "Firestore read time",
      ),
      rubric_version: RUBRIC,
      record_count: records.length,
      records_sha256: canonicalSha256(records),
    },
    records,
  };
}

export function validateAcceptedAdjudicationSnapshot(
  value: AcceptedAdjudicationSnapshot,
): void {
  const root = object(value, "accepted adjudication snapshot");
  exactKeys(root, ["manifest", "records"], "accepted adjudication snapshot");
  const manifest = object(root.manifest, "accepted adjudication manifest");
  exactKeys(
    manifest,
    [
      "schema_version",
      "snapshot_kind",
      "project_id",
      "firestore_read_time",
      "rubric_version",
      "record_count",
      "records_sha256",
    ],
    "accepted adjudication manifest",
  );
  if (
    manifest.schema_version !== 1 ||
    manifest.snapshot_kind !== "news-eval-accepted-adjudications" ||
    manifest.rubric_version !== RUBRIC
  )
    throw new Error("accepted adjudication snapshot contract is unsupported");
  stringValue(manifest.project_id, "project_id", 128);
  isoTimestamp(manifest.firestore_read_time, "firestore_read_time");
  if (!Array.isArray(root.records) || root.records.length === 0)
    throw new Error("accepted adjudication snapshot is empty");
  const records = root.records.map((record, index) =>
    acceptedAdjudicationRecord(record, `accepted adjudication ${index}`),
  );
  if (safeInteger(manifest.record_count, "record_count", 1) !== records.length)
    throw new Error("accepted adjudication record count does not match");
  if (manifest.records_sha256 !== canonicalSha256(records))
    throw new Error("accepted adjudication records hash does not match");
  for (let index = 0; index < records.length; index += 1) {
    if (
      index > 0 &&
      compareText(
        records[index - 1]!.article_key,
        records[index]!.article_key,
      ) >= 0
    )
      throw new Error(
        "accepted adjudication records are duplicated or not sorted",
      );
  }
}

export function serializeAcceptedAdjudicationSnapshot(
  value: AcceptedAdjudicationSnapshot,
): string {
  validateAcceptedAdjudicationSnapshot(value);
  return `${canonicalJson(value)}\n`;
}

export function parseAcceptedAdjudicationSnapshot(
  serialized: string,
): AcceptedAdjudicationSnapshot {
  const value = JSON.parse(serialized) as AcceptedAdjudicationSnapshot;
  validateAcceptedAdjudicationSnapshot(value);
  return value;
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

export async function buildFeedbackReviewBundle(
  exported: RawFeedbackExport,
  targetRegistryValues: unknown | readonly unknown[],
  readArticle: (
    articleKey: string,
  ) => Promise<Readonly<{ path: string; article: JsonObject }>>,
): Promise<JsonObject> {
  validateRawFeedbackExport(exported);
  const registries = feedbackTargetRegistries(targetRegistryValues);
  const groups = new Map<string, RawFeedbackRecord[]>();
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
    const submissions = records.map((record) => {
      const registry = registries.get(record.target_registry_sha256);
      const targets = new Map(
        (registry?.targets ?? []).map((target) => [
          `${target.kind as string}\u0000${target.id as string}`,
          target,
        ]),
      );
      const registryMatches = Boolean(registry);
      const feedback = object(record.feedback, "feedback");
      const references: JsonObject[] = [];
      for (const partyValue of feedback.party_tones as unknown[]) {
        const party = object(partyValue, "feedback party tone");
        if (party.resolution_status === "selected")
          references.push({ kind: "party", id: party.party_id });
      }
      for (const proposalValue of feedback.link_proposals as unknown[]) {
        const proposal = object(proposalValue, "feedback link proposal");
        if (proposal.resolution_status === "selected")
          references.push(object(proposal.target_ref, "feedback target ref"));
      }
      const resolved = references.map((reference) => {
        const target = registryMatches
          ? targets.get(
              `${reference.kind as string}\u0000${reference.id as string}`,
            )
          : undefined;
        return {
          ref: reference,
          target: target ?? null,
          valid_for_registry: Boolean(target),
        };
      });
      return {
        ...record,
        target_registry_matches_review_registry: registryMatches,
        resolved_target_refs: resolved,
        all_selected_targets_valid:
          registryMatches && resolved.every((item) => item.valid_for_registry),
      };
    });
    articles.push({
      article_key: key,
      local_article_path: stringValue(local.path, "local article path", 4096),
      local_content_sha256: contentSha256(content),
      local_content_matches_all_submissions: records.every(
        (record) => record.content_sha256 === contentSha256(content),
      ),
      local_article: firestoreJson(article),
      submissions,
    });
  }
  return {
    schema_version: 1,
    bundle_kind: "news-feedback-local-review",
    source_records_sha256: exported.manifest.records_sha256,
    firestore_read_time: exported.manifest.firestore_read_time,
    target_registry_sha256s: [...registries.keys()].sort(compareText),
    article_count: articles.length,
    submission_count: exported.records.length,
    articles,
  };
}

function acceptedFeedbackRecord(
  value: unknown,
  label: string,
  documentId?: string,
): AcceptedFeedbackRecord {
  const raw = object(value, label);
  exactKeys(
    raw,
    documentId
      ? FEEDBACK_ADJUDICATION_STORAGE_FIELDS
      : FEEDBACK_ADJUDICATION_EXPORT_FIELDS,
    label,
  );
  const article = articleKey(raw.article_key);
  if (documentId && documentId !== encodedArticleKey(article))
    throw new Error(`${label} document identity does not match article`);
  if (raw.schema_version !== 1 || raw.status !== "accepted")
    throw new Error(`${label} contract is unsupported`);
  const taskRevision = safeInteger(
    raw.task_revision,
    `${label}.task_revision`,
    1,
  );
  const contentHash = hash(raw.content_sha256, `${label}.content_sha256`);
  const analysisHash =
    raw.analysis_sha256 === null
      ? null
      : hash(raw.analysis_sha256, `${label}.analysis_sha256`);
  const targetHash = hash(
    raw.target_registry_sha256,
    `${label}.target_registry_sha256`,
  );
  const actor = object(raw.operator_actor, `${label}.operator_actor`);
  exactKeys(actor, ["kind", "id"], `${label}.operator_actor`);
  if (actor.kind !== "maintainer")
    throw new Error(`${label}.operator_actor must be a maintainer`);
  if (
    !Array.isArray(raw.source_submission_ids) ||
    raw.source_submission_ids.length < 1 ||
    raw.source_submission_ids.length > 100
  )
    throw new Error(`${label}.source_submission_ids is invalid`);
  const sourceIds = raw.source_submission_ids
    .map((id) => stringValue(id, `${label}.source_submission_id`, 128))
    .sort(compareText);
  if (new Set(sourceIds).size !== sourceIds.length)
    throw new Error(`${label}.source_submission_ids are duplicated`);
  const sourceRegistryRaw = object(
    raw.source_target_registry_sha256s,
    `${label}.source_target_registry_sha256s`,
  );
  if (
    Object.keys(sourceRegistryRaw).length !== sourceIds.length ||
    sourceIds.some((id) => !Object.hasOwn(sourceRegistryRaw, id))
  )
    throw new Error(`${label}.source registry provenance is incomplete`);
  const sourceRegistryHashes = Object.fromEntries(
    sourceIds.map((id) => [
      id,
      hash(
        sourceRegistryRaw[id],
        `${label}.source_target_registry_sha256s.${id}`,
      ),
    ]),
  );
  const operationId = stringValue(
    raw.last_operation_id,
    `${label}.last_operation_id`,
    96,
  );
  if (!IDENTIFIER.test(operationId))
    throw new Error(`${label}.last_operation_id is invalid`);
  return {
    schema_version: 1,
    contract: "article-feedback-v1",
    article_key: article,
    url: strictHttpsUrl(raw.url, `${label}.url`),
    task_revision: taskRevision,
    content_sha256: contentHash,
    analysis_sha256: analysisHash,
    target_registry_sha256: targetHash,
    source_submission_ids: sourceIds,
    source_target_registry_sha256s: sourceRegistryHashes,
    operator_actor: {
      kind: "maintainer",
      id: stringValue(actor.id, `${label}.operator_actor.id`, 128),
    },
    adjudicated_at: isoTimestamp(raw.adjudicated_at, `${label}.adjudicated_at`),
    revision: safeInteger(raw.revision, `${label}.revision`, 1),
    feedback: normalizedFeedbackPayload(raw.feedback, {
      articleKey: article,
      taskRevision,
      contentSha256: contentHash,
      analysisSha256: analysisHash,
      targetRegistrySha256: targetHash,
    }),
    public_explanation:
      raw.public_explanation === null
        ? null
        : nullableString(raw.public_explanation, `${label}.public_explanation`),
    status: "accepted",
    last_operation_id: operationId,
  };
}

export function buildAcceptedFeedbackSnapshot(
  projectId: string,
  snapshot: OperatorQuerySnapshot,
): AcceptedFeedbackSnapshot {
  const records = snapshot.docs
    .map((document) =>
      acceptedFeedbackRecord(
        document.data(),
        `accepted feedback ${document.id}`,
        document.id,
      ),
    )
    .sort((left, right) => compareText(left.article_key, right.article_key));
  if (records.length === 0)
    throw new Error(
      "Firestore returned no accepted feedback; retaining the last known-good snapshot",
    );
  return {
    manifest: {
      schema_version: 1,
      snapshot_kind: "news-feedback-accepted-adjudications",
      project_id: stringValue(projectId, "project ID", 128),
      firestore_read_time: isoTimestamp(
        snapshot.readTime,
        "Firestore read time",
      ),
      record_count: records.length,
      records_sha256: canonicalSha256(records),
    },
    records,
  };
}

export function validateAcceptedFeedbackSnapshot(
  value: AcceptedFeedbackSnapshot,
): void {
  const root = object(value, "accepted feedback snapshot");
  exactKeys(root, ["manifest", "records"], "accepted feedback snapshot");
  const manifest = object(root.manifest, "accepted feedback manifest");
  exactKeys(
    manifest,
    [
      "schema_version",
      "snapshot_kind",
      "project_id",
      "firestore_read_time",
      "record_count",
      "records_sha256",
    ],
    "accepted feedback manifest",
  );
  if (
    manifest.schema_version !== 1 ||
    manifest.snapshot_kind !== "news-feedback-accepted-adjudications"
  )
    throw new Error("accepted feedback snapshot contract is unsupported");
  stringValue(manifest.project_id, "project_id", 128);
  isoTimestamp(manifest.firestore_read_time, "firestore_read_time");
  if (!Array.isArray(root.records) || root.records.length === 0)
    throw new Error("accepted feedback snapshot is empty");
  const records = root.records.map((record, index) =>
    acceptedFeedbackRecord(record, `accepted feedback ${index}`),
  );
  if (safeInteger(manifest.record_count, "record_count", 1) !== records.length)
    throw new Error("accepted feedback record count does not match");
  if (manifest.records_sha256 !== canonicalSha256(records))
    throw new Error("accepted feedback records hash does not match");
  let prior = "";
  for (const record of records) {
    if (prior && compareText(prior, record.article_key) >= 0)
      throw new Error("accepted feedback records are not strictly sorted");
    prior = record.article_key;
  }
}

export function serializeAcceptedFeedbackSnapshot(
  value: AcceptedFeedbackSnapshot,
): string {
  validateAcceptedFeedbackSnapshot(value);
  return `${canonicalJson(value)}\n`;
}

export function parseAcceptedFeedbackSnapshot(
  serialized: string,
): AcceptedFeedbackSnapshot {
  const value = JSON.parse(serialized) as AcceptedFeedbackSnapshot;
  validateAcceptedFeedbackSnapshot(value);
  return value;
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
  if (ids.length === 0 || ids.length > MAX_EVAL_SOURCE_SUBMISSIONS)
    throw new Error("accepted adjudication source submissions must be bounded");
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

export function parseFeedbackReviewCommand(
  value: unknown,
  targetRegistryValues: unknown | readonly unknown[],
): FeedbackReviewCommand {
  const raw = object(value, "feedback review command");
  const action = stringValue(raw.action, "action", 64);
  const accepted = action === "adjudication_accepted";
  if (
    !accepted &&
    action !== "submission_reviewed" &&
    action !== "submission_quarantined"
  )
    throw new Error("feedback review command action is unsupported");
  const common = [
    "schema_version",
    "operation_id",
    "occurred_at",
    "actor",
    "action",
    "article_key",
    "content_sha256",
    "target_registry_sha256",
    "source_submission_ids",
    "reason",
  ];
  exactKeys(
    raw,
    accepted
      ? [
          ...common,
          "analysis_sha256",
          "expected_task_revision",
          "expected_adjudication_revision",
          "source_target_registry_sha256s",
          "feedback",
          "public_explanation",
        ]
      : common,
    "feedback review command",
  );
  if (raw.schema_version !== 1)
    throw new Error("feedback review command schema is unsupported");
  const operationId = stringValue(raw.operation_id, "operation_id", 96);
  if (!IDENTIFIER.test(operationId)) throw new Error("operation_id is invalid");
  const actorRaw = object(raw.actor, "actor");
  exactKeys(actorRaw, ["kind", "id"], "actor");
  if (actorRaw.kind !== "maintainer")
    throw new Error("only a maintainer actor may apply feedback reviews");
  const actor = {
    kind: "maintainer" as const,
    id: stringValue(actorRaw.id, "actor.id", 128),
  };
  if (!Array.isArray(raw.source_submission_ids))
    throw new Error("source_submission_ids must be an array");
  const sourceIds = raw.source_submission_ids.map((id) =>
    stringValue(id, "source submission ID", 128),
  );
  if (new Set(sourceIds).size !== sourceIds.length)
    throw new Error("source_submission_ids contains duplicates");
  const base = {
    schemaVersion: 1 as const,
    operationId,
    occurredAt: isoTimestamp(raw.occurred_at, "occurred_at"),
    actor,
    articleKey: articleKey(raw.article_key),
    contentSha256: hash(raw.content_sha256, "content_sha256"),
    targetRegistrySha256: hash(
      raw.target_registry_sha256,
      "target_registry_sha256",
    ),
    reason: raw.reason === null ? null : nullableString(raw.reason, "reason"),
  };
  const registries = feedbackTargetRegistries(targetRegistryValues);
  const registry = registries.get(base.targetRegistrySha256);
  if (!registry)
    throw new Error("feedback command does not match target registry");
  if (!accepted) {
    if (sourceIds.length !== 1)
      throw new Error("feedback review requires exactly one source submission");
    return {
      ...base,
      action,
      sourceSubmissionIds: [sourceIds[0]!] as const,
    };
  }
  if (sourceIds.length < 1)
    throw new Error("accepted feedback requires source submissions");
  if (sourceIds.length > 100)
    throw new Error("accepted feedback exceeds the 100-source transaction cap");
  const sourceRegistryRaw = object(
    raw.source_target_registry_sha256s,
    "source_target_registry_sha256s",
  );
  if (
    Object.keys(sourceRegistryRaw).length !== sourceIds.length ||
    sourceIds.some((id) => !Object.hasOwn(sourceRegistryRaw, id))
  )
    throw new Error("source target-registry provenance is incomplete");
  const sourceTargetRegistrySha256s = Object.fromEntries(
    sourceIds.map((id) => {
      const sourceHash = hash(
        sourceRegistryRaw[id],
        `source_target_registry_sha256s.${id}`,
      );
      if (!registries.has(sourceHash))
        throw new Error(`source registry for ${id} was not provided`);
      return [id, sourceHash];
    }),
  );
  const taskRevision = safeInteger(
    raw.expected_task_revision,
    "expected_task_revision",
    1,
  );
  const analysisHash =
    raw.analysis_sha256 === null
      ? null
      : hash(raw.analysis_sha256, "analysis_sha256");
  const feedback = normalizedFeedbackPayload(raw.feedback, {
    articleKey: base.articleKey,
    taskRevision,
    contentSha256: base.contentSha256,
    analysisSha256: analysisHash,
    targetRegistrySha256: base.targetRegistrySha256,
  });
  validateFeedbackTargetReferences(feedback, registry);
  return {
    ...base,
    action: "adjudication_accepted",
    sourceSubmissionIds: [...sourceIds].sort(compareText),
    sourceTargetRegistrySha256s,
    analysisSha256: analysisHash,
    expectedTaskRevision: taskRevision,
    expectedAdjudicationRevision: safeInteger(
      raw.expected_adjudication_revision,
      "expected_adjudication_revision",
    ),
    feedback,
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
  command: ReviewCommand | FeedbackReviewCommand,
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
  command: ReviewCommand | FeedbackReviewCommand;
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

  async exportAcceptedAdjudications(
    projectId: string,
  ): Promise<AcceptedAdjudicationSnapshot> {
    const snapshot = await this.#database
      .collection("news_eval_adjudications")
      .get();
    return buildAcceptedAdjudicationSnapshot(projectId, snapshot);
  }

  async exportFeedbackSubmissions(
    projectId: string,
  ): Promise<RawFeedbackExport> {
    const snapshot = await this.#database
      .collection("news_feedback_submissions")
      .get();
    return buildRawFeedbackExport(projectId, snapshot);
  }

  async exportAcceptedFeedback(
    projectId: string,
  ): Promise<AcceptedFeedbackSnapshot> {
    const snapshot = await this.#database
      .collection("news_feedback_adjudications")
      .get();
    return buildAcceptedFeedbackSnapshot(projectId, snapshot);
  }

  async apply(commandValue: unknown): Promise<ApplyReviewResult> {
    const command = parseReviewCommand(commandValue);
    if (command.action === "adjudication_accepted")
      return this.#acceptAdjudication(command);
    return this.#reviewSubmission(command);
  }

  async applyFeedback(
    commandValue: unknown,
    targetRegistryValues: unknown | readonly unknown[],
  ): Promise<ApplyReviewResult> {
    const command = parseFeedbackReviewCommand(
      commandValue,
      targetRegistryValues,
    );
    if (command.action === "adjudication_accepted")
      return this.#acceptFeedbackAdjudication(command);
    return this.#reviewFeedbackSubmission(command);
  }

  async syncTasks(
    manifestValue: unknown,
    releaseProofValue: unknown,
  ): Promise<TaskSyncResult> {
    const parsed = taskSyncManifest(manifestValue);
    const releaseProof = taskReleaseProof(releaseProofValue);
    if (
      releaseProof.publicDataRevision !==
        parsed.manifest.public_data_revision ||
      releaseProof.queueSha256 !== parsed.manifest.queue_sha256
    )
      throw new Error("task release proof does not match task manifest");
    const desired = new Map(
      parsed.tasks.map((task) => [task.article_key as string, task]),
    );
    const desiredIds = new Set(
      [...desired.keys()].map((key) => encodedArticleKey(key)),
    );
    const taskCollection = this.#database.collection("news_eval_tasks");
    const stateRef = this.#database
      .collection("news_eval_sync")
      .doc("task_manifest");
    return this.#database.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(
        taskCollection.where("accepts_public_evals", "==", true),
      );
      const references = new Map<string, OperatorDocumentReference>();
      const snapshots = new Map<string, OperatorDocumentSnapshot>();
      for (const snapshot of currentSnapshot.docs) {
        references.set(snapshot.id, taskCollection.doc(snapshot.id));
        snapshots.set(snapshot.id, snapshot);
      }
      for (const key of desired.keys()) {
        const id = encodedArticleKey(key);
        references.set(id, taskCollection.doc(id));
      }
      if (references.size > 400)
        throw new Error("task sync touches more than 400 task documents");
      for (const [id, reference] of [...references].sort(([left], [right]) =>
        compareText(left, right),
      )) {
        if (!snapshots.has(id))
          snapshots.set(id, await transaction.get(reference));
      }
      const stateSnapshot = await transaction.get(stateRef);
      if (stateSnapshot.exists) {
        const currentState = jsonObject(
          stateSnapshot.data(),
          "existing task manifest state",
        );
        const currentGeneratedAt = isoTimestamp(
          currentState.generated_at,
          "existing task manifest generated_at",
        );
        const currentHash = hash(
          currentState.tasks_sha256,
          "existing task manifest tasks_sha256",
        );
        const currentQueueHash = hash(
          currentState.queue_sha256,
          "existing task manifest queue_sha256",
        );
        const currentPublicRevision = isoTimestamp(
          currentState.public_data_revision,
          "existing task manifest public_data_revision",
        );
        const incomingGeneratedAt = parsed.manifest.generated_at as string;
        const incomingPublicRevision = parsed.manifest
          .public_data_revision as string;
        const incomingHash = parsed.manifest.tasks_sha256 as string;
        if (
          currentPublicRevision > incomingPublicRevision ||
          currentGeneratedAt > incomingGeneratedAt
        )
          throw new Error("task sync refuses rollback to an older manifest");
        if (
          (currentPublicRevision === incomingPublicRevision ||
            currentGeneratedAt === incomingGeneratedAt) &&
          (currentHash !== incomingHash ||
            currentQueueHash !== parsed.manifest.queue_sha256)
        )
          throw new Error(
            "task sync manifest conflicts with the existing generation",
          );
      }
      let activated = 0;
      let updated = 0;
      let unchanged = 0;
      let deactivated = 0;
      for (const [key, task] of desired) {
        const id = encodedArticleKey(key);
        const snapshot = snapshots.get(id)!;
        const current = snapshot.exists
          ? jsonObject(snapshot.data(), `existing task ${key}`)
          : null;
        if (current && canonicalJson(current) === canonicalJson(task)) {
          unchanged += 1;
          continue;
        }
        if (!current || current.accepts_public_evals !== true) activated += 1;
        else updated += 1;
        transaction.set(references.get(id)!, task);
      }
      for (const [id, snapshot] of snapshots) {
        if (!snapshot.exists) continue;
        const current = jsonObject(snapshot.data(), `existing task ${id}`);
        if (desiredIds.has(id)) continue;
        if (current.accepts_public_evals === true) {
          transaction.set(
            references.get(id)!,
            {
              accepts_public_evals: false,
              updated_at: parsed.manifest.generated_at,
              deactivated_by_manifest_sha256: parsed.manifest.tasks_sha256,
            },
            { merge: true },
          );
          deactivated += 1;
        }
      }
      transaction.set(stateRef, {
        ...parsed.manifest,
        live_release: {
          public_data_revision: releaseProof.publicDataRevision,
          queue_sha256: releaseProof.queueSha256,
          run_id: releaseProof.runId,
          manifest_url: releaseProof.liveManifestUrl,
        },
      });
      return {
        taskCount: parsed.tasks.length,
        activated,
        updated,
        unchanged,
        deactivated,
        tasksSha256: parsed.manifest.tasks_sha256 as string,
      };
    });
  }

  /**
   * Synchronize the larger all-article feedback registry in retry-safe chunks.
   * Individual task writes are inert unless `accepts_public_feedback` is true;
   * the final state document is written only after every chunk succeeds.
   */
  async syncFeedbackTasks(
    manifestValue: unknown,
    releaseProofValue: FeedbackTaskReleaseProof,
  ): Promise<JsonObject> {
    const parsed = feedbackTaskSyncManifest(manifestValue);
    if (
      releaseProofValue.publicDataRevision !==
      parsed.manifest.public_data_revision
    )
      throw new Error(
        "feedback release proof revision does not match manifest",
      );
    const desired = new Map(
      parsed.tasks.map((task) => [task.article_key as string, task]),
    );
    const collection = this.#database.collection("news_feedback_tasks");
    const stateRef = this.#database
      .collection("news_feedback_sync")
      .doc("task_manifest");
    const assertTransition = (snapshot: OperatorDocumentSnapshot): void => {
      if (!snapshot.exists) return;
      const before = jsonObject(snapshot.data(), "feedback sync state");
      const beforeRevision = isoTimestamp(
        before.public_data_revision,
        "feedback state revision",
      );
      const incomingRevision = parsed.manifest.public_data_revision as string;
      if (beforeRevision > incomingRevision)
        throw new Error("feedback task sync refuses revision rollback");
      if (
        beforeRevision === incomingRevision &&
        before.tasks_sha256 !== parsed.manifest.tasks_sha256
      )
        throw new Error("feedback task sync refuses same-revision drift");
    };
    await this.#database.runTransaction(async (transaction) => {
      assertTransition(await transaction.get(stateRef));
    });
    const current = await collection
      .where("accepts_public_feedback", "==", true)
      .get();
    if (current.docs.length > MAX_FEEDBACK_TASKS)
      throw new Error("active feedback task registry exceeds its safety cap");
    const currentById = new Map(current.docs.map((doc) => [doc.id, doc]));
    const operations: Array<{
      id: string;
      task: JsonObject | null;
    }> = parsed.tasks.map((task) => ({
      id: encodedArticleKey(task.article_key as string),
      task,
    }));
    const desiredIds = new Set(operations.map(({ id }) => id));
    for (const document of current.docs)
      if (!desiredIds.has(document.id))
        operations.push({ id: document.id, task: null });

    let written = 0;
    let deactivated = 0;
    const chunkSize = 300;
    for (let offset = 0; offset < operations.length; offset += chunkSize) {
      const chunk = operations.slice(offset, offset + chunkSize);
      const outcome = await this.#database.runTransaction(
        async (transaction) => {
          let chunkWritten = 0;
          let chunkDeactivated = 0;
          const references = chunk.map((operation) =>
            collection.doc(operation.id),
          );
          const snapshots = await Promise.all(
            references.map((reference) => transaction.get(reference)),
          );
          for (let index = 0; index < chunk.length; index += 1) {
            const operation = chunk[index]!;
            const reference = references[index]!;
            const snapshot = snapshots[index]!;
            if (operation.task) {
              if (
                !snapshot.exists ||
                canonicalJson(snapshot.data()) !== canonicalJson(operation.task)
              ) {
                transaction.set(reference, operation.task);
                chunkWritten += 1;
              }
            } else if (
              snapshot.exists &&
              jsonObject(snapshot.data(), "feedback task")
                .accepts_public_feedback === true
            ) {
              transaction.set(
                reference,
                {
                  accepts_public_feedback: false,
                  updated_at: parsed.manifest.generated_at,
                  deactivated_by_manifest_sha256: parsed.manifest.tasks_sha256,
                },
                { merge: true },
              );
              chunkDeactivated += 1;
            }
          }
          return { written: chunkWritten, deactivated: chunkDeactivated };
        },
      );
      written += outcome.written;
      deactivated += outcome.deactivated;
    }
    await this.#database.runTransaction(async (transaction) => {
      const state = await transaction.get(stateRef);
      assertTransition(state);
      transaction.set(stateRef, {
        ...parsed.manifest,
        live_release: {
          public_data_revision: releaseProofValue.publicDataRevision,
          run_id: releaseProofValue.runId,
          manifest_url: releaseProofValue.liveManifestUrl,
        },
      });
    });
    return {
      status: "synced",
      task_count: desired.size,
      written,
      unchanged: desired.size - written,
      deactivated,
      previous_active_count: currentById.size,
      tasks_sha256: parsed.manifest.tasks_sha256,
      public_data_revision: parsed.manifest.public_data_revision,
    };
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
        const event = jsonObject(eventSnapshot.data(), "operator review event");
        validateEvent(event);
        if (
          before.status !== desiredStatus ||
          before.reviewed_at !== command.occurredAt ||
          canonicalJson(before.reviewed_by) !== canonicalJson(command.actor) ||
          before.last_review_operation_id !== command.operationId ||
          event.after_sha256 !== stateHash(before)
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
        try {
          acceptedAdjudicationRecord(current, "current adjudication", encoded);
          const event = jsonObject(
            eventSnapshot.data(),
            "existing operator event",
          );
          if (event.after_sha256 !== stateHash(current))
            throw new Error("event state hash does not match");
        } catch {
          throw new Error(
            "operator event exists but adjudication state does not match",
          );
        }
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
      const taskUrl = strictHttpsUrl(task.url, "evaluation task URL");
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
        url: taskUrl,
        task_revision: command.expectedTaskRevision,
        content_sha256: command.contentSha256,
        analysis_sha256: command.analysisSha256,
        source_submission_ids: command.sourceSubmissionIds,
        operator_actor: command.actor,
        adjudicated_at: command.occurredAt,
        revision: nextRevision,
        evaluation: command.evaluation,
        model_labels: trustedModelLabels,
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

  async #reviewFeedbackSubmission(
    command: Extract<
      FeedbackReviewCommand,
      { action: "submission_reviewed" | "submission_quarantined" }
    >,
  ): Promise<ApplyReviewResult> {
    const submissionId = command.sourceSubmissionIds[0];
    const submissionRef = this.#database
      .collection("news_feedback_submissions")
      .doc(submissionId);
    const eventRef = this.#database
      .collection("news_feedback_events")
      .doc(command.operationId);
    return this.#database.runTransaction(async (transaction) => {
      const [submissionSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(submissionRef),
        transaction.get(eventRef),
      ]);
      if (!submissionSnapshot.exists)
        throw new Error(`feedback submission ${submissionId} was not found`);
      const before = jsonObject(
        submissionSnapshot.data(),
        "feedback submission",
      );
      if (
        before.article_key !== command.articleKey ||
        before.content_sha256 !== command.contentSha256 ||
        before.target_registry_sha256 !== command.targetRegistrySha256
      )
        throw new Error(
          "feedback submission no longer matches the review command",
        );
      const desiredStatus =
        command.action === "submission_reviewed" ? "reviewed" : "quarantined";
      if (matchingEvent(eventSnapshot, command, "submission", submissionId)) {
        const event = jsonObject(eventSnapshot.data(), "feedback review event");
        validateEvent(event);
        if (
          before.status !== desiredStatus ||
          before.reviewed_at !== command.occurredAt ||
          canonicalJson(before.reviewed_by) !== canonicalJson(command.actor) ||
          before.last_review_operation_id !== command.operationId ||
          event.after_sha256 !== stateHash(before)
        )
          throw new Error("feedback event exists but submission state differs");
        return {
          operationId: command.operationId,
          idempotent: true,
          articleKey: command.articleKey,
          status: desiredStatus,
        };
      }
      if (before.status === "promoted")
        throw new Error("promoted feedback cannot be reclassified");
      const patch: JsonObject = {
        status: desiredStatus,
        reviewed_at: command.occurredAt,
        reviewed_by: command.actor,
        last_review_operation_id: command.operationId,
      };
      const after = { ...before, ...patch };
      transaction.set(submissionRef, patch, { merge: true });
      transaction.set(
        eventRef,
        eventFor({
          command,
          action: command.action,
          targetKind: "submission",
          targetId: submissionId,
          before,
          after,
        }),
      );
      return {
        operationId: command.operationId,
        idempotent: false,
        articleKey: command.articleKey,
        status: desiredStatus,
      };
    });
  }

  async #acceptFeedbackAdjudication(
    command: Extract<
      FeedbackReviewCommand,
      { action: "adjudication_accepted" }
    >,
  ): Promise<ApplyReviewResult> {
    const encoded = encodedArticleKey(command.articleKey);
    const taskRef = this.#database
      .collection("news_feedback_tasks")
      .doc(encoded);
    const syncStateRef = this.#database
      .collection("news_feedback_sync")
      .doc("task_manifest");
    const adjudicationRef = this.#database
      .collection("news_feedback_adjudications")
      .doc(encoded);
    const eventRef = this.#database
      .collection("news_feedback_events")
      .doc(command.operationId);
    const supersededEventRef = this.#database
      .collection("news_feedback_events")
      .doc(`${command.operationId}-superseded`);
    const sourceRefs = command.sourceSubmissionIds.map((id) =>
      this.#database.collection("news_feedback_submissions").doc(id),
    );
    return this.#database.runTransaction(async (transaction) => {
      const [
        taskSnapshot,
        syncStateSnapshot,
        currentSnapshot,
        eventSnapshot,
        supersededSnapshot,
      ] = await Promise.all([
        transaction.get(taskRef),
        transaction.get(syncStateRef),
        transaction.get(adjudicationRef),
        transaction.get(eventRef),
        transaction.get(supersededEventRef),
      ]);
      const sourceSnapshots: OperatorDocumentSnapshot[] = [];
      for (const reference of sourceRefs)
        sourceSnapshots.push(await transaction.get(reference));
      const current = currentSnapshot.exists
        ? jsonObject(currentSnapshot.data(), "current feedback adjudication")
        : null;
      if (matchingEvent(eventSnapshot, command, "adjudication", encoded)) {
        try {
          acceptedFeedbackRecord(
            current,
            "current feedback adjudication",
            encoded,
          );
          const event = jsonObject(
            eventSnapshot.data(),
            "feedback acceptance event",
          );
          if (event.after_sha256 !== stateHash(current))
            throw new Error("feedback event after hash does not match");
        } catch {
          throw new Error(
            "feedback event exists but adjudication state differs",
          );
        }
        if (
          !current ||
          current.last_operation_id !== command.operationId ||
          current.status !== "accepted" ||
          current.revision !== command.expectedAdjudicationRevision + 1 ||
          current.task_revision !== command.expectedTaskRevision ||
          current.content_sha256 !== command.contentSha256 ||
          current.analysis_sha256 !== command.analysisSha256 ||
          current.target_registry_sha256 !== command.targetRegistrySha256 ||
          current.adjudicated_at !== command.occurredAt ||
          canonicalJson(current.operator_actor) !==
            canonicalJson(command.actor) ||
          canonicalJson(current.feedback) !== canonicalJson(command.feedback) ||
          canonicalJson(current.source_submission_ids) !==
            canonicalJson(command.sourceSubmissionIds) ||
          canonicalJson(current.source_target_registry_sha256s) !==
            canonicalJson(command.sourceTargetRegistrySha256s) ||
          (current.public_explanation ?? null) !== command.publicExplanation
        )
          throw new Error(
            "feedback event exists but adjudication state differs",
          );
        return {
          operationId: command.operationId,
          idempotent: true,
          articleKey: command.articleKey,
          status: "accepted",
          adjudicationRevision: safeInteger(current.revision, "revision", 1),
        };
      }
      if (supersededSnapshot.exists)
        throw new Error(
          "feedback supersession exists without acceptance event",
        );
      if (!taskSnapshot.exists) throw new Error("feedback task was not found");
      const task = normalizedFeedbackTask(taskSnapshot.data(), "feedback task");
      if (
        task.article_key !== command.articleKey ||
        task.revision !== command.expectedTaskRevision ||
        task.content_sha256 !== command.contentSha256 ||
        task.analysis_sha256 !== command.analysisSha256 ||
        task.target_registry_sha256 !== command.targetRegistrySha256 ||
        task.accepts_public_feedback !== true
      )
        throw new Error("feedback adjudication task is stale");
      if (!syncStateSnapshot.exists)
        throw new Error("feedback task manifest is not active");
      const syncState = jsonObject(
        syncStateSnapshot.data(),
        "active feedback task manifest",
      );
      if (
        syncState.public_data_revision !== task.public_data_revision ||
        typeof syncState.tasks_sha256 !== "string" ||
        !SHA256.test(syncState.tasks_sha256)
      )
        throw new Error("feedback task is not part of the active manifest");
      const currentRevision = current
        ? safeInteger(current.revision, "feedback adjudication revision", 1)
        : 0;
      if (currentRevision !== command.expectedAdjudicationRevision)
        throw new Error(
          `feedback adjudication revision conflict: expected ${command.expectedAdjudicationRevision}, current ${currentRevision}`,
        );
      for (let index = 0; index < sourceSnapshots.length; index += 1) {
        const snapshot = sourceSnapshots[index]!;
        const source = feedbackSubmissionRecord(snapshot);
        if (
          source.submission_id !== command.sourceSubmissionIds[index] ||
          source.article_key !== command.articleKey ||
          source.content_sha256 !== command.contentSha256 ||
          source.analysis_sha256 !== command.analysisSha256 ||
          source.target_registry_sha256 !==
            command.sourceTargetRegistrySha256s[source.submission_id]
        )
          throw new Error(`feedback source ${source.submission_id} is stale`);
        if (source.status === "quarantined")
          throw new Error(
            `feedback source ${source.submission_id} is quarantined`,
          );
      }
      const nextRevision = currentRevision + 1;
      const after: JsonObject = {
        schema_version: 1,
        article_key: command.articleKey,
        url: task.url,
        task_revision: command.expectedTaskRevision,
        content_sha256: command.contentSha256,
        analysis_sha256: command.analysisSha256,
        target_registry_sha256: command.targetRegistrySha256,
        source_submission_ids: command.sourceSubmissionIds,
        source_target_registry_sha256s: command.sourceTargetRegistrySha256s,
        operator_actor: command.actor,
        adjudicated_at: command.occurredAt,
        revision: nextRevision,
        feedback: command.feedback,
        public_explanation: command.publicExplanation,
        status: "accepted",
        last_operation_id: command.operationId,
      };
      transaction.set(
        eventRef,
        eventFor({
          command,
          action: "adjudication_accepted",
          targetKind: "adjudication",
          targetId: encoded,
          before: current,
          after,
        }),
      );
      if (current)
        transaction.set(
          supersededEventRef,
          eventFor({
            command,
            action: "adjudication_superseded",
            targetKind: "adjudication",
            targetId: encoded,
            before: current,
            after,
            eventId: `${command.operationId}-superseded`,
            reason:
              "Replaced atomically by a newer accepted feedback adjudication.",
          }),
        );
      for (const reference of sourceRefs)
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
      transaction.set(adjudicationRef, after);
      return {
        operationId: command.operationId,
        idempotent: false,
        articleKey: command.articleKey,
        status: "accepted",
        adjudicationRevision: nextRevision,
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

export async function readRawFeedbackExport(
  source: string,
): Promise<RawFeedbackExport> {
  return parseRawFeedbackExport(await readFile(source, "utf8"));
}
