import { randomUUID } from "node:crypto";

import {
  assessAbuse,
  requestFingerprintMatches,
  type AbuseContext,
} from "./abuse.js";
import type { DocumentSnapshotLike, FirestoreLike } from "./storage.js";

type JsonObject = Record<string, unknown>;

export type PublicFeedbackTask = Readonly<{
  article_key: string;
  revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  target_registry_sha256: string;
  public_data_revision: string;
}>;

export type FeedbackReceipt = Readonly<{
  submission_id: string;
  status: "raw";
  article_key: string;
  task_revision: number;
  submitted_at: string;
}>;

export type FeedbackTaskOutcome =
  | { kind: "available"; task: PublicFeedbackTask }
  | { kind: "task_not_found" }
  | { kind: "task_unavailable" };

export type FeedbackSubmitOutcome =
  | { kind: "accepted"; created: boolean; receipt: FeedbackReceipt }
  | { kind: "task_not_found" }
  | { kind: "task_unavailable" }
  | { kind: "task_conflict"; currentRevision: number }
  | { kind: "idempotency_conflict" }
  | { kind: "duplicate_article_revision" }
  | {
      kind: "rate_limited";
      scope: "global" | "browser";
      retryAfterSeconds: number;
    };

export interface FeedbackStore {
  task(articleKey: string): Promise<FeedbackTaskOutcome>;
  submit(input: {
    request: Readonly<JsonObject>;
    abuse: AbuseContext;
    now: Date;
  }): Promise<FeedbackSubmitOutcome>;
}

const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

const encodedArticleKey = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const secondsUntilNextUtcDay = (now: Date): number => {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1_000));
};

const timestamp = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  const candidate = object(value);
  if (typeof candidate.toDate !== "function") return null;
  const converted = (candidate.toDate as () => Date)();
  return converted instanceof Date ? converted : null;
};

const activeCount = (snapshot: DocumentSnapshotLike, now: Date): number => {
  if (!snapshot.exists) return 0;
  const row = object(snapshot.data());
  const expiry = timestamp(row.expires_at);
  if (!expiry || !Number.isFinite(expiry.getTime()))
    throw new Error("feedback rate document expiry is invalid");
  if (expiry.getTime() <= now.getTime()) return 0;
  if (
    row.submission_count !== undefined &&
    (!Number.isSafeInteger(row.submission_count) ||
      Number(row.submission_count) < 0)
  )
    throw new Error("feedback rate counter is invalid");
  return row.submission_count === undefined ? 0 : Number(row.submission_count);
};

const parseTask = (value: unknown): PublicFeedbackTask | null => {
  const task = object(value);
  if (
    typeof task.article_key !== "string" ||
    !Number.isSafeInteger(task.revision) ||
    Number(task.revision) < 1 ||
    typeof task.content_sha256 !== "string" ||
    (task.analysis_sha256 !== null &&
      typeof task.analysis_sha256 !== "string") ||
    typeof task.target_registry_sha256 !== "string" ||
    typeof task.public_data_revision !== "string"
  )
    return null;
  return {
    article_key: task.article_key,
    revision: Number(task.revision),
    content_sha256: task.content_sha256,
    analysis_sha256: task.analysis_sha256 as string | null,
    target_registry_sha256: task.target_registry_sha256,
    public_data_revision: task.public_data_revision,
  };
};

const taskIsActive = (
  task: PublicFeedbackTask,
  syncState: unknown,
): boolean => {
  const state = object(syncState);
  return (
    typeof state.public_data_revision === "string" &&
    state.public_data_revision === task.public_data_revision &&
    typeof state.tasks_sha256 === "string"
  );
};

const receipt = (value: unknown): FeedbackReceipt | null => {
  const row = object(value);
  const submitted = row.submitted_at;
  const submittedAt =
    submitted instanceof Date
      ? submitted.toISOString()
      : typeof submitted === "string"
        ? submitted
        : typeof object(submitted).toDate === "function"
          ? (object(submitted).toDate as () => Date)().toISOString()
          : null;
  return typeof row.submission_id === "string" &&
    row.status === "raw" &&
    typeof row.article_key === "string" &&
    Number.isSafeInteger(row.task_revision) &&
    submittedAt
    ? {
        submission_id: row.submission_id,
        status: "raw",
        article_key: row.article_key,
        task_revision: Number(row.task_revision),
        submitted_at: submittedAt,
      }
    : null;
};

/** Firestore-backed intake for partial, untrusted feedback on every article. */
export class FirestoreFeedbackStore implements FeedbackStore {
  constructor(private readonly database: FirestoreLike) {}

  async task(articleKey: string): Promise<FeedbackTaskOutcome> {
    const taskRef = this.database
      .collection("news_feedback_tasks")
      .doc(encodedArticleKey(articleKey));
    const stateRef = this.database
      .collection("news_feedback_sync")
      .doc("task_manifest");
    return this.database.runTransaction(async (transaction) => {
      const stateSnapshot = await transaction.get(stateRef);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists) return { kind: "task_not_found" };
      const raw = object(snapshot.data());
      if (raw.accepts_public_feedback !== true)
        return { kind: "task_unavailable" };
      const task = parseTask(raw);
      if (!task || task.article_key !== articleKey)
        throw new Error("feedback task is malformed");
      if (!stateSnapshot.exists || !taskIsActive(task, stateSnapshot.data()))
        return { kind: "task_unavailable" };
      return { kind: "available", task };
    });
  }

  async submit(input: {
    request: Readonly<JsonObject>;
    abuse: AbuseContext;
    now: Date;
  }): Promise<FeedbackSubmitOutcome> {
    const articleKey = String(input.request.article_key);
    const requestedRevision = Number(input.request.base_task_revision);
    const taskRef = this.database
      .collection("news_feedback_tasks")
      .doc(encodedArticleKey(articleKey));
    const submissionId = randomUUID();
    const submissionRef = this.database
      .collection("news_feedback_submissions")
      .doc(submissionId);
    const idempotencyRefs = input.abuse.idempotencyLookups.map((lookup) => ({
      lookup,
      ref: this.database.collection("news_feedback_dedupe").doc(lookup.key),
    }));
    const browserRefs = input.abuse.browserArticleRevisionLookupKeys.map(
      (key) => this.database.collection("news_feedback_dedupe").doc(key),
    );
    const globalRateRef = this.database
      .collection("news_feedback_rate")
      .doc(input.abuse.globalDayKey);
    const browserRateRefs = input.abuse.browserDayLookupKeys.map((key) =>
      this.database.collection("news_feedback_rate").doc(key),
    );
    const abuseRef = this.database
      .collection("news_feedback_abuse")
      .doc(input.abuse.abuseRef);
    const stateRef = this.database
      .collection("news_feedback_sync")
      .doc("task_manifest");

    return this.database.runTransaction(async (transaction) => {
      const stateSnapshot = await transaction.get(stateRef);
      const taskSnapshot = await transaction.get(taskRef);
      const idempotencySnapshots = [];
      for (const item of idempotencyRefs)
        idempotencySnapshots.push(await transaction.get(item.ref));
      for (let index = 0; index < idempotencySnapshots.length; index += 1) {
        const snapshot = idempotencySnapshots[index];
        const lookup = idempotencyRefs[index]?.lookup;
        if (!snapshot?.exists || !lookup) continue;
        const data = object(snapshot.data());
        if (
          typeof data.request_fingerprint !== "string" ||
          !requestFingerprintMatches(
            data.request_fingerprint,
            lookup.requestFingerprint,
          )
        )
          return { kind: "idempotency_conflict" };
        const stored = await transaction.get(
          this.database
            .collection("news_feedback_submissions")
            .doc(String(data.submission_id)),
        );
        const storedReceipt = receipt(stored.data());
        if (!storedReceipt) throw new Error("feedback receipt is missing");
        return { kind: "accepted", created: false, receipt: storedReceipt };
      }

      const browserSnapshots = [];
      for (const ref of browserRefs)
        browserSnapshots.push(await transaction.get(ref));
      const globalRateSnapshot = await transaction.get(globalRateRef);
      const browserRateSnapshots = [];
      for (const ref of browserRateRefs)
        browserRateSnapshots.push(await transaction.get(ref));
      const globalCount = activeCount(globalRateSnapshot, input.now);
      const browserCount = browserRateSnapshots.length
        ? browserRateSnapshots.reduce(
            (total, snapshot) => total + activeCount(snapshot, input.now),
            0,
          )
        : null;
      const decision = assessAbuse({
        idempotentSubmissionId: null,
        idempotentRequestMatches: false,
        browserArticleRevisionExists: browserSnapshots.some(
          (snapshot) => snapshot.exists,
        ),
        globalDayCount: globalCount,
        browserDayCount: browserCount,
      });
      if (decision.kind === "idempotency_conflict")
        return { kind: "idempotency_conflict" };
      if (decision.kind === "duplicate_article_revision")
        return { kind: "duplicate_article_revision" };
      if (decision.kind === "rate_limited")
        return {
          ...decision,
          retryAfterSeconds: secondsUntilNextUtcDay(input.now),
        };

      if (!taskSnapshot.exists) return { kind: "task_not_found" };
      const rawTask = object(taskSnapshot.data());
      if (rawTask.accepts_public_feedback !== true)
        return { kind: "task_unavailable" };
      const task = parseTask(rawTask);
      if (!task || task.article_key !== articleKey)
        throw new Error("feedback task is malformed");
      if (!stateSnapshot.exists || !taskIsActive(task, stateSnapshot.data()))
        return { kind: "task_unavailable" };
      if (
        task.revision !== requestedRevision ||
        task.content_sha256 !== input.request.content_sha256 ||
        task.analysis_sha256 !== input.request.analysis_sha256 ||
        task.target_registry_sha256 !== input.request.target_registry_sha256
      )
        return { kind: "task_conflict", currentRevision: task.revision };

      const submittedAt = input.now.toISOString();
      const stored = {
        schema_version: 1,
        submission_id: submissionId,
        mode: "article_feedback",
        article_key: articleKey,
        task_revision: task.revision,
        content_sha256: task.content_sha256,
        analysis_sha256: task.analysis_sha256,
        target_registry_sha256: task.target_registry_sha256,
        public_data_revision: task.public_data_revision,
        submitted_at: input.now,
        feedback: structuredClone(input.request.feedback),
        status: "raw",
      };
      transaction.set(submissionRef, stored);
      transaction.set(abuseRef, {
        submission_id: submissionId,
        created_at: input.now,
        expires_at: input.abuse.abuseExpiresAt,
      });
      transaction.set(idempotencyRefs[0]!.ref, {
        request_fingerprint: input.abuse.activeIdempotency.requestFingerprint,
        submission_id: submissionId,
        created_at: input.now,
      });
      if (input.abuse.activeBrowserArticleRevisionKey && browserRefs[0])
        transaction.set(browserRefs[0], {
          submission_id: submissionId,
          article_key: articleKey,
          task_revision: task.revision,
          created_at: input.now,
        });
      transaction.set(globalRateRef, {
        scope: "global",
        submission_count: globalCount + 1,
        expires_at: input.abuse.rateExpiresAt,
      });
      if (input.abuse.activeBrowserDayKey && browserRateRefs[0])
        transaction.set(browserRateRefs[0], {
          scope: "browser",
          submission_count: (browserCount ?? 0) + 1,
          expires_at: input.abuse.rateExpiresAt,
        });
      return {
        kind: "accepted",
        created: true,
        receipt: {
          submission_id: submissionId,
          status: "raw",
          article_key: articleKey,
          task_revision: task.revision,
          submitted_at: submittedAt,
        },
      };
    });
  }
}
