import type { Leaning, RussiaStance, Tone } from "./data";

export type FeedbackIssueKind =
  | "missing_analysis"
  | "missing_entity"
  | "wrong_entity_link"
  | "missing_topic"
  | "missing_sector"
  | "other";

export interface ArticleFeedbackTask {
  article_key: string;
  revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  public_data_revision: string;
}

export interface ArticleFeedbackRequest {
  schema_version: 1;
  article_key: string;
  base_task_revision: number;
  content_sha256: string;
  analysis_sha256: string | null;
  idempotency_key: string;
  turnstile_token: string;
  browser_nonce: string | null;
  feedback: {
    leaning: { label: Leaning; evidence: string } | null;
    russia_stance: { label: RussiaStance; evidence: string } | null;
    party_tones: Array<{
      party: string;
      party_id: string | null;
      tone: Tone;
      evidence: string;
    }>;
    issue_kinds: FeedbackIssueKind[];
    public_note: string | null;
  };
}

export class ArticleFeedbackError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ArticleFeedbackError";
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requestJson = async (
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<{ response: Response; value: unknown }> => {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new ArticleFeedbackError("network_error", 0);
  }
  const raw = await response.text();
  if (raw.length > 65_536)
    throw new ArticleFeedbackError("invalid_response", response.status);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ArticleFeedbackError("invalid_response", response.status);
  }
  if (!response.ok) {
    const error = object(object(value)?.error);
    throw new ArticleFeedbackError(
      typeof error?.code === "string" ? error.code : "request_failed",
      response.status,
    );
  }
  return { response, value };
};

export const loadArticleFeedbackTask = async (
  domain: string,
  articleId: string,
  fetcher: typeof fetch = fetch,
): Promise<ArticleFeedbackTask> => {
  const { value } = await requestJson(
    `/api/news-evals/feedback-task/${encodeURIComponent(domain)}/${encodeURIComponent(articleId)}`,
    { method: "GET" },
    fetcher,
  );
  const task = object(object(value)?.task);
  if (
    !task ||
    task.article_key !== `${domain}/${articleId}` ||
    !Number.isSafeInteger(task.revision) ||
    typeof task.content_sha256 !== "string" ||
    (task.analysis_sha256 !== null &&
      typeof task.analysis_sha256 !== "string") ||
    typeof task.public_data_revision !== "string"
  )
    throw new ArticleFeedbackError("invalid_response", 200);
  return task as unknown as ArticleFeedbackTask;
};

export const submitArticleFeedback = async (
  request: ArticleFeedbackRequest,
  fetcher: typeof fetch = fetch,
): Promise<string> => {
  const { value } = await requestJson(
    "/api/news-evals/feedback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
    },
    fetcher,
  );
  const submission = object(object(value)?.submission);
  if (
    !submission ||
    typeof submission.submission_id !== "string" ||
    submission.article_key !== request.article_key ||
    submission.task_revision !== request.base_task_revision ||
    submission.status !== "raw"
  )
    throw new ArticleFeedbackError("invalid_response", 200);
  return submission.submission_id;
};
