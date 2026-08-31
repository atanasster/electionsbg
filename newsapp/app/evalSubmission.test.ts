import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalTask } from "./evals";
import {
  buildSubmissionRequest,
  createEvalDraft,
  evaluationFingerprint,
  getOrCreateBrowserNonce,
  loadEvalDraft,
  localEvalCompleted,
  markLocalEvalComplete,
  newIdempotencyKey,
  saveEvalDraft,
  submitEvaluation,
  validateEvalDraft,
} from "./evalSubmission";

const task = (): EvalTask => ({
  article_key: "example.bg/article-1",
  domain: "example.bg",
  article_id: "article-1",
  url: "https://example.bg/article-1",
  title: "Статия",
  published: "2026-08-30T10:00:00.000Z",
  story_id: null,
  primary_topic: "government",
  outlet: "Източник",
  content_sha256: `sha256:${"1".repeat(64)}`,
  analysis_sha256: `sha256:${"2".repeat(64)}`,
  model_labels: {
    leaning: "neutral",
    russia_stance: "anti_russia",
    party_tones: [{ party: "Партия А", party_id: "party-a", tone: "neutral" }],
  },
  review_fields: ["leaning"],
  dataset_ids: ["pilot"],
  task_revision: 7,
});

const complete = () => {
  const target = task();
  const draft = createEvalDraft(target);
  draft.leaning = {
    value: "progressive",
    evidence: "Авторският текст подкрепя мярката.",
    reasonCodes: ["model_missed_context"],
  };
  draft.russia = {
    value: "unable",
    evidence: "",
    reasonCodes: [],
  };
  draft.parties[0]!.tone = "unfavorable";
  draft.parties[0]!.evidence = "Партията е критикувана пряко.";
  return { target, draft };
};

beforeEach(() => localStorage.clear());

describe("public evaluation drafts", () => {
  it("round-trips only a task-scoped current-revision draft", () => {
    const target = task();
    const draft = createEvalDraft(target);
    draft.leaning.value = "neutral";
    expect(saveEvalDraft(target, draft)).toBe(true);
    expect(loadEvalDraft(target)?.leaning.value).toBe("neutral");
    expect(loadEvalDraft({ ...target, task_revision: 8 })).toBeNull();
  });

  it("fails safely when storage is unavailable", () => {
    const target = task();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(saveEvalDraft(target, createEvalDraft(target))).toBe(false);
  });

  it("requires evidence and an explicit complete party decision", () => {
    const target = task();
    const draft = createEvalDraft(target);
    draft.leaning.value = "neutral";
    draft.russia.value = "anti_russia";
    const result = validateEvalDraft(target, draft);
    expect(result.evaluation).toBeNull();
    expect(result.errors).toContain(
      "Добавете кратко основание за политическото рамкиране.",
    );
    expect(result.errors).toContain("Изберете тон към Партия А.");
  });

  it("normalizes unable and no-party choices for the backend schema", () => {
    const target = task();
    const draft = createEvalDraft(target);
    draft.leaning.value = "unable";
    draft.russia.value = "unable";
    draft.noParty = true;
    const result = validateEvalDraft(target, draft);
    expect(result.errors).toEqual([]);
    expect(result.evaluation).toMatchObject({
      leaning: {
        label: null,
        reason_codes: ["insufficient_public_context"],
      },
      removed_model_parties: [
        {
          party: "Партия А",
          party_id: "party-a",
          reason_code: "party_not_meaningful",
        },
      ],
    });
  });

  it("keeps a stable browser nonce and local completion marker", () => {
    const first = getOrCreateBrowserNonce();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(getOrCreateBrowserNonce()).toBe(first);
    expect(localEvalCompleted(task())).toBe(false);
    markLocalEvalComplete(task());
    expect(localEvalCompleted(task())).toBe(true);
  });
});

describe("public evaluation submission", () => {
  it("builds the exact request and parses a strict success receipt", async () => {
    const { target, draft } = complete();
    const evaluation = validateEvalDraft(target, draft).evaluation!;
    const idempotency = newIdempotencyKey();
    const request = buildSubmissionRequest(
      target,
      evaluation,
      "turnstile-token",
      idempotency,
      "browser-nonce-1234",
    );
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            submission: {
              submission_id: "submission-id-1234",
              status: "raw",
              article_key: target.article_key,
              task_revision: target.task_revision,
              submitted_at: "2026-08-31T12:00:00.000Z",
              evaluation: {
                schema_version: 1,
                ...evaluation,
                leaning: { ...evaluation.leaning, disposition: "changed" },
                russia_stance: {
                  ...evaluation.russia_stance,
                  disposition: "unable_to_judge",
                },
                party_tones: evaluation.party_tones.map((party) => ({
                  ...party,
                  disposition: "changed",
                })),
              },
              model_labels: target.model_labels,
            },
            idempotent: false,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    const result = await submitEvaluation(target, request, fetcher);
    expect(result.submission.evaluation.leaning.disposition).toBe("changed");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/news-evals/submit",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
      }),
    );
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toEqual(request);
    expect(evaluationFingerprint(evaluation)).toBe(JSON.stringify(evaluation));
  });

  it("surfaces typed API errors and rejects malformed success bodies", async () => {
    const { target, draft } = complete();
    const evaluation = validateEvalDraft(target, draft).evaluation!;
    const request = buildSubmissionRequest(
      target,
      evaluation,
      "turnstile-token",
      newIdempotencyKey(),
      null,
    );
    await expect(
      submitEvaluation(
        target,
        request,
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
              status: 429,
              headers: { "Retry-After": "30" },
            }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 30,
    });
    await expect(
      submitEvaluation(
        target,
        request,
        vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
