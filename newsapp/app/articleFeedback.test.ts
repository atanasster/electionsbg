import { describe, expect, it, vi } from "vitest";
import {
  ArticleFeedbackError,
  loadArticleFeedbackTask,
  parseFeedbackTargetRegistry,
  searchFeedbackTargets,
  submitArticleFeedback,
  type ArticleFeedbackRequest,
} from "./articleFeedback";
import { canonicalEvalSha256 } from "./evals";

const task = {
  article_key: "example.bg/article-1",
  revision: 9,
  content_sha256: `sha256:${"a".repeat(64)}`,
  analysis_sha256: null,
  target_registry_sha256: `sha256:${"d".repeat(64)}`,
  public_data_revision: "2026-09-01T08:00:00.000Z",
};

const request: ArticleFeedbackRequest = {
  schema_version: 1,
  article_key: task.article_key,
  base_task_revision: task.revision,
  content_sha256: task.content_sha256,
  analysis_sha256: null,
  target_registry_sha256: task.target_registry_sha256,
  idempotency_key: "feedback-idempotency-0001",
  turnstile_token: "provider-token",
  browser_nonce: "feedback-browser-0001",
  feedback: {
    leaning: null,
    russia_stance: null,
    party_tones: [],
    link_proposals: [],
    issue_kinds: ["missing_analysis"],
    public_note: null,
  },
};

describe("article feedback API client", () => {
  it("searches only the requested canonical target kind", () => {
    const registry = {
      version: 1 as const,
      generated_at: task.public_data_revision,
      targets_sha256: task.target_registry_sha256,
      target_count: 2,
      targets: [
        {
          kind: "institution" as const,
          id: "123",
          canonical: "Министерство на здравеопазването",
          href: "https://electionsbg.com/awarder/123",
          aliases: ["Министерство на здравеопазването", "МЗ"],
        },
        {
          kind: "sector" as const,
          id: "health",
          canonical: "Здравеопазване",
          href: "https://electionsbg.com/sector/health",
          aliases: ["Здравеопазване"],
        },
      ],
    };
    expect(
      searchFeedbackTargets(registry, "министерство", "institution"),
    ).toEqual([registry.targets[0]]);
    expect(searchFeedbackTargets(registry, "здрав", "sector")).toEqual([
      registry.targets[1],
    ]);
  });
  it("ranks an exact canonical identity ahead of more than twelve substrings", () => {
    const substrings = Array.from({ length: 15 }, (_, index) => ({
      kind: "party" as const,
      id: `substring-${index}`,
      canonical: `Партия НИЕ ${index}`,
      href: `https://electionsbg.com/party/substring-${index}`,
      aliases: [`Партия НИЕ ${index}`],
    }));
    const exact = {
      kind: "party" as const,
      id: "exact",
      canonical: "НИЕ",
      href: "https://electionsbg.com/party/exact",
      aliases: ["НИЕ"],
    };
    const targets = [...substrings, exact];
    const registry = {
      version: 1 as const,
      generated_at: task.public_data_revision,
      targets_sha256: task.target_registry_sha256,
      target_count: targets.length,
      targets,
    };
    expect(searchFeedbackTargets(registry, "ние", "party")[0]).toEqual(exact);
  });
  it("rejects a target row changed without recomputing the registry hash", async () => {
    const targets = [{
      kind: "company" as const,
      id: "123456789",
      canonical: "Проверено дружество",
      href: "https://electionsbg.com/company/123456789",
      aliases: ["Проверено дружество"],
    }];
    const registry = {
      version: 1,
      generated_at: task.public_data_revision,
      targets_sha256: await canonicalEvalSha256(targets),
      target_count: 1,
      targets,
    };
    await expect(parseFeedbackTargetRegistry(registry)).resolves.toEqual(registry);
    await expect(
      parseFeedbackTargetRegistry({
        ...registry,
        targets: [{ ...targets[0], canonical: "Подменено дружество" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_target_registry" });
  });
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
