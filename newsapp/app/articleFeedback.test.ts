import { describe, expect, it, vi } from "vitest";
import {
  ArticleFeedbackError,
  loadArticleFeedbackTask,
  submitArticleFeedback,
  type ArticleFeedbackRequest,
} from "./articleFeedback";

const task = {
  article_key: "example.bg/article-1",
  revision: 9,
  content_sha256: `sha256:${"a".repeat(64)}`,
  analysis_sha256: null,
  public_data_revision: "2026-09-01T08:00:00.000Z",
};

const request: ArticleFeedbackRequest = {
  schema_version: 1,
  article_key: task.article_key,
  base_task_revision: task.revision,
  content_sha256: task.content_sha256,
  analysis_sha256: null,
  idempotency_key: "feedback-idempotency-0001",
  turnstile_token: "provider-token",
  browser_nonce: "feedback-browser-0001",
  feedback: {
    leaning: null,
    russia_stance: null,
    party_tones: [],
    issue_kinds: ["missing_analysis"],
    public_note: null,
  },
};

describe("article feedback API client", () => {
  it("loads a task for an article even when analysis is missing", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ task }), { status: 200 }),
    );
    await expect(
      loadArticleFeedbackTask("example.bg", "article-1", fetcher),
    ).resolves.toEqual(task);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/news-evals/feedback-task/example.bg/article-1",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        cache: "no-store",
      }),
    );
  });

  it("submits the exact partial request and validates the raw receipt", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            submission: {
              submission_id: "feedback-submission-1",
              status: "raw",
              article_key: task.article_key,
              task_revision: task.revision,
            },
          }),
          { status: 201 },
        ),
    );
    await expect(submitArticleFeedback(request, fetcher)).resolves.toBe(
      "feedback-submission-1",
    );
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/news-evals/feedback");
    expect(JSON.parse(call[1].body as string)).toEqual(request);
  });

  it("surfaces typed backend failures and rejects malformed success bodies", async () => {
    await expect(
      submitArticleFeedback(
        request,
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code: "stale_task" } }), {
              status: 409,
            }),
        ),
      ),
    ).rejects.toEqual(new ArticleFeedbackError("stale_task", 409));
    await expect(
      loadArticleFeedbackTask(
        "example.bg",
        "article-1",
        vi.fn(async () => new Response(JSON.stringify({ task: {} }))),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
