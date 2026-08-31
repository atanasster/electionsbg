import { createHash, randomUUID } from "node:crypto";

import {
  assessAbuse,
  requestFingerprintMatches,
  type AbuseContext,
} from "./abuse.js";
import {
  PUBLIC_AGGREGATE_POLICY,
  PUBLIC_LABEL_VOCABULARIES,
  PUBLIC_PARTY_DECISIONS,
} from "./contract.js";
import {
  disagreesWithModel,
  normalizeEvaluation,
  partyKey,
} from "./evaluation.js";
import { validateSubmissionSemantics } from "./eval-contract/validate.js";

type JsonObject = Record<string, unknown>;

export type SubmissionReceipt = Readonly<{
  submission_id: string;
  status: "raw";
  article_key: string;
  task_revision: number;
  submitted_at: string;
  evaluation: JsonObject;
  model_labels: JsonObject;
}>;

export type SubmitOutcome =
  | { kind: "accepted"; created: boolean; receipt: SubmissionReceipt }
  | { kind: "task_not_found" }
  | { kind: "task_unavailable" }
  | { kind: "task_conflict"; currentRevision: number }
  | { kind: "invalid_evaluation" }
  | { kind: "idempotency_conflict" }
  | { kind: "duplicate_article_revision" }
  | {
      kind: "rate_limited";
      scope: "global" | "browser";
      retryAfterSeconds: number;
    };

export type AggregateOutcome =
  | { kind: "task_not_found" }
  | {
      kind: "withheld";
      articleKey: string;
      taskRevision: number;
      validSubmissionCount: number;
    }
  | {
      kind: "released";
      articleKey: string;
      taskRevision: number;
      aggregate: JsonObject;
    };

export interface EvaluationStore {
  submit(input: {
    request: Readonly<JsonObject>;
    abuse: AbuseContext;
    now: Date;
  }): Promise<SubmitOutcome>;
  aggregate(input: {
    articleKey: string;
    now: Date;
  }): Promise<AggregateOutcome>;
}

type DocumentSnapshotLike = {
  exists: boolean;
  data(): JsonObject | undefined;
};

type DocumentReferenceLike = {
  readonly id: string;
  readonly path: string;
  get(): Promise<DocumentSnapshotLike>;
};

type CollectionReferenceLike = {
  doc(id: string): DocumentReferenceLike;
};

type TransactionLike = {
  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  set(
    reference: DocumentReferenceLike,
    data: JsonObject,
    options?: { merge: boolean },
  ): unknown;
};

export type FirestoreLike = {
  collection(name: string): CollectionReferenceLike;
  runTransaction<T>(
    callback: (transaction: TransactionLike) => Promise<T>,
  ): Promise<T>;
};

function object(value: unknown, label = "value"): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function optionalObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
  return value as number;
}

function optionalCount(value: unknown): number {
  return value === undefined ? 0 : count(value, "stored counter");
}

function timestamp(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const converted = (value as { toDate(): Date }).toDate();
    return converted instanceof Date ? converted : null;
  }
  return null;
}

function activeCount(snapshot: DocumentSnapshotLike, now: Date): number {
  if (!snapshot.exists) return 0;
  const data = object(snapshot.data(), "rate document");
  const expiresAt = timestamp(data.expires_at);
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()))
    throw new Error("rate document expiry is invalid");
  if (expiresAt.getTime() <= now.getTime()) return 0;
  return optionalCount(data.submission_count);
}

function encodedArticleKey(articleKey: string): string {
  return Buffer.from(articleKey, "utf8").toString("base64url");
}

function incrementMap(source: unknown, key: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, value] of Object.entries(optionalObject(source)))
    result[name] = count(value, `aggregate counter ${name}`);
  result[key] = optionalCount(result[key]) + 1;
  return result;
}

function aggregateEvaluation(
  current: JsonObject,
  evaluation: JsonObject,
  hasBrowserBucket: boolean,
): JsonObject {
  const leaning = object(evaluation.leaning, "leaning decision");
  const russia = object(evaluation.russia_stance, "Russia decision");
  const partyPairCount = Array.isArray(evaluation.party_tones)
    ? evaluation.party_tones.length
    : 0;
  return {
    valid_submission_count: optionalCount(current.valid_submission_count) + 1,
    distinct_browser_count:
      optionalCount(current.distinct_browser_count) +
      (hasBrowserBucket ? 1 : 0),
    leaning_counts: incrementMap(current.leaning_counts, String(leaning.label)),
    russia_stance_counts: incrementMap(
      current.russia_stance_counts,
      String(russia.label),
    ),
    party_pair_count: optionalCount(current.party_pair_count) + partyPairCount,
    model_disagreement_count:
      optionalCount(current.model_disagreement_count) +
      (disagreesWithModel(evaluation) ? 1 : 0),
  };
}

function partyAggregateId(
  articleKey: string,
  taskRevision: number,
  party: JsonObject,
): string {
  const digest = createHash("sha256")
    .update(partyKey(party), "utf8")
    .digest("hex");
  return `${encodedArticleKey(articleKey)}--r${taskRevision}--${digest}`;
}

function boundedString(
  value: unknown,
  label: string,
  maximumCharacters: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    [...value].length > maximumCharacters
  )
    throw new Error(`${label} must be a bounded non-empty string`);
  return value;
}

function taskModelLabels(value: unknown): JsonObject {
  const raw = object(value, "task model labels");
  const leaning = boundedString(raw.leaning, "task leaning label", 64);
  const russiaStance = boundedString(
    raw.russia_stance,
    "task Russia stance label",
    64,
  );
  if (!PUBLIC_LABEL_VOCABULARIES.leaning.includes(leaning))
    throw new Error("task leaning label is outside the contract vocabulary");
  if (!PUBLIC_LABEL_VOCABULARIES.russiaStance.includes(russiaStance))
    throw new Error(
      "task Russia stance label is outside the contract vocabulary",
    );
  if (
    !Array.isArray(raw.party_tones) ||
    raw.party_tones.length > PUBLIC_PARTY_DECISIONS
  )
    throw new Error("task party labels must be a bounded array");
  const seen = new Set<string>();
  const parties = raw.party_tones.map((entry, index) => {
    const party = object(entry, `task party label ${index}`);
    const surface = boundedString(
      party.party,
      `task party label ${index}.party`,
      160,
    );
    const partyId =
      party.party_id === null
        ? null
        : boundedString(
            party.party_id,
            `task party label ${index}.party_id`,
            160,
          );
    const tone = boundedString(
      party.tone,
      `task party label ${index}.tone`,
      32,
    );
    if (!PUBLIC_LABEL_VOCABULARIES.partyTone.includes(tone))
      throw new Error("task party tone is outside the contract vocabulary");
    const sanitized = { party: surface, party_id: partyId, tone };
    const key = partyKey(sanitized);
    if (seen.has(key)) throw new Error("task party labels contain duplicates");
    seen.add(key);
    return sanitized;
  });
  return {
    leaning,
    russia_stance: russiaStance,
    party_tones: parties,
  };
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function aggregateForTask(
  snapshot: DocumentSnapshotLike,
  articleKey: string,
  taskRevision: number,
): JsonObject {
  if (!snapshot.exists) return {};
  const aggregate = object(snapshot.data(), "aggregate document");
  if (
    aggregate.article_key !== articleKey ||
    !Number.isSafeInteger(aggregate.task_revision)
  )
    throw new Error("aggregate identity is malformed");
  return aggregate.task_revision === taskRevision ? aggregate : {};
}

function taskFrom(snapshot: DocumentSnapshotLike): JsonObject | null {
  if (!snapshot.exists) return null;
  const task = object(snapshot.data(), "task document");
  if (
    typeof task.article_key !== "string" ||
    !Number.isSafeInteger(task.revision) ||
    (task.revision as number) < 1 ||
    typeof task.content_sha256 !== "string" ||
    typeof task.analysis_sha256 !== "string"
  )
    throw new Error("task document is malformed");
  return { ...task, model_labels: taskModelLabels(task.model_labels) };
}

function receiptFromSubmission(value: unknown): SubmissionReceipt {
  const receipt = object(value, "stored submission");
  const submittedAt =
    typeof receipt.submitted_at === "string"
      ? receipt.submitted_at
      : timestamp(receipt.submitted_at)?.toISOString();
  if (
    typeof receipt.submission_id !== "string" ||
    receipt.status !== "raw" ||
    typeof receipt.article_key !== "string" ||
    !Number.isSafeInteger(receipt.task_revision) ||
    typeof submittedAt !== "string"
  )
    throw new Error("stored submission receipt is malformed");
  object(receipt.evaluation, "receipt evaluation");
  object(receipt.model_labels, "receipt model labels");
  return {
    submission_id: receipt.submission_id,
    status: "raw",
    article_key: receipt.article_key,
    task_revision: receipt.task_revision as number,
    submitted_at: submittedAt,
    evaluation: structuredClone(receipt.evaluation as JsonObject),
    model_labels: structuredClone(receipt.model_labels as JsonObject),
  };
}

function releasedAggregate(data: JsonObject): JsonObject | null {
  const valid = optionalCount(data.valid_submission_count);
  const distinct = optionalCount(data.distinct_browser_count);
  if (
    !PUBLIC_AGGREGATE_POLICY.publicDistributionEnabled ||
    valid < PUBLIC_AGGREGATE_POLICY.minimumValidSubmissions ||
    distinct < PUBLIC_AGGREGATE_POLICY.minimumDistinctBrowserBuckets
  )
    return null;
  return {
    valid_submission_count: valid,
    distinct_browser_count: distinct,
    leaning_counts: structuredClone(optionalObject(data.leaning_counts)),
    russia_stance_counts: structuredClone(
      optionalObject(data.russia_stance_counts),
    ),
    party_pair_count: optionalCount(data.party_pair_count),
    model_disagreement_count: optionalCount(data.model_disagreement_count),
    strong_agreement_fraction: PUBLIC_AGGREGATE_POLICY.strongAgreementFraction,
  };
}

export class FirestoreEvaluationStore implements EvaluationStore {
  readonly #database: FirestoreLike;

  constructor(database: FirestoreLike) {
    this.#database = database;
  }

  async submit(input: {
    request: Readonly<JsonObject>;
    abuse: AbuseContext;
    now: Date;
  }): Promise<SubmitOutcome> {
    const submissionId = randomUUID();
    const articleKey = String(input.request.article_key);
    const requestedTaskRevision = Number(input.request.base_task_revision);
    const requestEvaluation = object(
      input.request.evaluation,
      "request evaluation",
    );
    const taskRef = this.#database
      .collection("news_eval_tasks")
      .doc(encodedArticleKey(articleKey));
    const aggregateRef = this.#database
      .collection("news_eval_aggregates")
      .doc(encodedArticleKey(articleKey));
    const submissionRef = this.#database
      .collection("news_eval_submissions")
      .doc(submissionId);
    const abuseRef = this.#database
      .collection("news_eval_abuse")
      .doc(input.abuse.abuseRef);
    const globalRateRef = this.#database
      .collection("news_eval_rate")
      .doc(input.abuse.globalDayKey);
    const idempotencyRefs = input.abuse.idempotencyLookups.map((lookup) => ({
      lookup,
      reference: this.#database.collection("news_eval_dedupe").doc(lookup.key),
    }));
    const browserDedupeRefs = input.abuse.browserArticleRevisionLookupKeys.map(
      (key) => this.#database.collection("news_eval_dedupe").doc(key),
    );
    const browserRateRefs = input.abuse.browserDayLookupKeys.map((key) =>
      this.#database.collection("news_eval_rate").doc(key),
    );

    return this.#database.runTransaction(async (transaction) => {
      const taskSnapshot = await transaction.get(taskRef);
      const idempotencySnapshots = [];
      for (const entry of idempotencyRefs)
        idempotencySnapshots.push(await transaction.get(entry.reference));
      const browserDedupeSnapshots = [];
      for (const reference of browserDedupeRefs)
        browserDedupeSnapshots.push(await transaction.get(reference));
      const globalRateSnapshot = await transaction.get(globalRateRef);
      const browserRateSnapshots = [];
      for (const reference of browserRateRefs)
        browserRateSnapshots.push(await transaction.get(reference));
      const aggregateSnapshot = await transaction.get(aggregateRef);

      for (let index = 0; index < idempotencySnapshots.length; index += 1) {
        const snapshot = idempotencySnapshots[index];
        const lookup = idempotencyRefs[index]?.lookup;
        if (!snapshot?.exists || !lookup) continue;
        const data = object(snapshot.data(), "idempotency document");
        if (typeof data.request_fingerprint !== "string")
          throw new Error("idempotency request fingerprint is malformed");
        if (
          !requestFingerprintMatches(
            data.request_fingerprint,
            lookup.requestFingerprint,
          )
        )
          return { kind: "idempotency_conflict" };
        if (typeof data.submission_id !== "string")
          throw new Error("idempotency submission ID is malformed");
        const storedSubmission = await transaction.get(
          this.#database
            .collection("news_eval_submissions")
            .doc(data.submission_id),
        );
        if (!storedSubmission.exists)
          throw new Error("idempotency submission is missing");
        return {
          kind: "accepted",
          created: false,
          receipt: receiptFromSubmission(storedSubmission.data()),
        };
      }

      const browserArticleRevisionExists = browserDedupeSnapshots.some(
        (snapshot) => snapshot.exists,
      );
      const globalDayCount = activeCount(globalRateSnapshot, input.now);
      const browserDayCount =
        browserRateSnapshots.length === 0
          ? null
          : browserRateSnapshots.reduce(
              (total, snapshot) => total + activeCount(snapshot, input.now),
              0,
            );
      const abuseDecision = assessAbuse({
        idempotentSubmissionId: null,
        idempotentRequestMatches: false,
        browserArticleRevisionExists,
        globalDayCount,
        browserDayCount,
      });
      if (abuseDecision.kind === "idempotency_conflict")
        return { kind: "idempotency_conflict" };
      if (abuseDecision.kind === "duplicate_article_revision")
        return { kind: "duplicate_article_revision" };
      if (abuseDecision.kind === "rate_limited")
        return {
          ...abuseDecision,
          retryAfterSeconds: secondsUntilNextUtcDay(input.now),
        };
      if (abuseDecision.kind === "idempotent")
        throw new Error("unexpected idempotent abuse decision without an ID");

      const task = taskFrom(taskSnapshot);
      if (!task) return { kind: "task_not_found" };
      if (task.accepts_public_evals !== true)
        return { kind: "task_unavailable" };
      const semanticErrors = validateSubmissionSemantics(input.request, task);
      if (
        semanticErrors.some((code) =>
          [
            "article_key_conflict",
            "task_revision_conflict",
            "stale_content",
            "stale_analysis",
          ].includes(code),
        )
      )
        return {
          kind: "task_conflict",
          currentRevision: Number(task.revision),
        };
      if (semanticErrors.length > 0) return { kind: "invalid_evaluation" };

      const modelLabels = object(task.model_labels, "task model labels");
      const evaluation = normalizeEvaluation(requestEvaluation, modelLabels);
      const normalizedParties = Array.isArray(evaluation.party_tones)
        ? evaluation.party_tones
        : [];
      const taskParties = new Map(
        (modelLabels.party_tones as JsonObject[]).map((party) => [
          partyKey(party),
          party,
        ]),
      );
      const aggregatedParties = normalizedParties.flatMap((raw) => {
        const decision = object(raw, "normalized party decision");
        const identity = taskParties.get(partyKey(decision));
        return identity ? [{ decision, identity }] : [];
      });
      const partyAggregateRefs = aggregatedParties.map(({ identity }) =>
        this.#database
          .collection("news_eval_party_aggregates")
          .doc(partyAggregateId(articleKey, requestedTaskRevision, identity)),
      );
      const partyAggregateSnapshots = [];
      for (const reference of partyAggregateRefs)
        partyAggregateSnapshots.push(await transaction.get(reference));
      const submittedAt = input.now.toISOString();
      const receipt: SubmissionReceipt = Object.freeze({
        submission_id: submissionId,
        status: "raw",
        article_key: articleKey,
        task_revision: Number(task.revision),
        submitted_at: submittedAt,
        evaluation,
        model_labels: structuredClone(modelLabels),
      });
      const currentAggregate = aggregateForTask(
        aggregateSnapshot,
        articleKey,
        Number(task.revision),
      );
      const nextAggregate = aggregateEvaluation(
        currentAggregate,
        evaluation,
        input.abuse.activeBrowserArticleRevisionKey !== null,
      );

      transaction.set(submissionRef, {
        schema_version: 1,
        submission_id: submissionId,
        mode: "community",
        article_key: articleKey,
        task_revision: Number(task.revision),
        content_sha256: input.request.content_sha256,
        analysis_sha256: input.request.analysis_sha256,
        abuse_ref: input.abuse.abuseRef,
        submitted_at: input.now,
        evaluation,
        model_labels: structuredClone(modelLabels),
        status: "raw",
      });
      transaction.set(abuseRef, {
        submission_id: submissionId,
        created_at: input.now,
        expires_at: input.abuse.abuseExpiresAt,
      });
      transaction.set(idempotencyRefs[0]!.reference, {
        kind: "idempotency",
        key_version: input.abuse.activeKeyVersion,
        request_fingerprint: input.abuse.activeIdempotency.requestFingerprint,
        submission_id: submissionId,
        created_at: input.now,
      });
      if (input.abuse.activeBrowserArticleRevisionKey && browserDedupeRefs[0]) {
        transaction.set(browserDedupeRefs[0], {
          kind: "browser_article_revision",
          key_version: input.abuse.activeKeyVersion,
          submission_id: submissionId,
          article_key: articleKey,
          task_revision: Number(task.revision),
          created_at: input.now,
        });
      }
      transaction.set(globalRateRef, {
        scope: "global",
        day: input.abuse.day,
        submission_count: globalDayCount + 1,
        expires_at: input.abuse.rateExpiresAt,
      });
      if (input.abuse.activeBrowserDayKey && browserRateRefs[0]) {
        const activeBrowserCount = activeCount(
          browserRateSnapshots[0]!,
          input.now,
        );
        transaction.set(browserRateRefs[0], {
          scope: "browser",
          day: input.abuse.day,
          submission_count: activeBrowserCount + 1,
          expires_at: input.abuse.rateExpiresAt,
        });
      }
      for (let index = 0; index < aggregatedParties.length; index += 1) {
        const { decision, identity } = aggregatedParties[index]!;
        const reference = partyAggregateRefs[index];
        const snapshot = partyAggregateSnapshots[index];
        if (!reference || !snapshot)
          throw new Error("party aggregate transaction state is incomplete");
        const prior = snapshot.exists
          ? object(snapshot.data(), "party aggregate document")
          : {};
        const expectedPartyKey = partyKey(identity);
        if (
          snapshot.exists &&
          (prior.article_key !== articleKey ||
            prior.task_revision !== Number(task.revision) ||
            prior.party_key !== expectedPartyKey)
        )
          throw new Error("party aggregate identity is malformed");
        transaction.set(reference, {
          article_key: articleKey,
          task_revision: Number(task.revision),
          party_key: expectedPartyKey,
          party: identity.party,
          party_id: identity.party_id ?? null,
          tone_counts: incrementMap(prior.tone_counts, String(decision.tone)),
          updated_at: input.now,
        });
      }
      transaction.set(aggregateRef, {
        article_key: articleKey,
        task_revision: Number(task.revision),
        ...nextAggregate,
        updated_at: input.now,
        public_distribution_enabled:
          PUBLIC_AGGREGATE_POLICY.publicDistributionEnabled,
      });
      return { kind: "accepted", created: true, receipt };
    });
  }

  async aggregate(input: {
    articleKey: string;
    now: Date;
  }): Promise<AggregateOutcome> {
    void input.now;
    const encoded = encodedArticleKey(input.articleKey);
    const [taskSnapshot, aggregateSnapshot] = await Promise.all([
      this.#database.collection("news_eval_tasks").doc(encoded).get(),
      this.#database.collection("news_eval_aggregates").doc(encoded).get(),
    ]);
    const task = taskFrom(taskSnapshot);
    if (!task || task.accepts_public_evals !== true)
      return { kind: "task_not_found" };
    if (task.article_key !== input.articleKey)
      throw new Error("task identity does not match its document key");
    const data = aggregateForTask(
      aggregateSnapshot,
      input.articleKey,
      Number(task.revision),
    );
    const released = releasedAggregate(data);
    if (!released)
      return {
        kind: "withheld",
        articleKey: input.articleKey,
        taskRevision: Number(task.revision),
        validSubmissionCount: optionalCount(data.valid_submission_count),
      };
    return {
      kind: "released",
      articleKey: input.articleKey,
      taskRevision: Number(task.revision),
      aggregate: released,
    };
  }
}
