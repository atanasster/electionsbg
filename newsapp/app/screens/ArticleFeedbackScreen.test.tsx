import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock, submitMock, browserNonceMock, idempotencyMock } = vi.hoisted(
  () => ({
    loadMock: vi.fn(),
    submitMock: vi.fn(),
    browserNonceMock: vi.fn(),
    idempotencyMock: vi.fn(),
  }),
);

vi.mock("../articleFeedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../articleFeedback")>()),
  loadArticleFeedbackTask: loadMock,
  submitArticleFeedback: submitMock,
}));

vi.mock("../evalSubmission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../evalSubmission")>()),
  TURNSTILE_SITE_KEY: "test-site-key",
  getOrCreateBrowserNonce: browserNonceMock,
  newIdempotencyKey: idempotencyMock,
}));

vi.mock("../components/TurnstileWidget", () => ({
  TurnstileWidget: ({
    onToken,
    onStateChange,
  }: {
    onToken: (token: string | null) => void;
    onStateChange: (state: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onToken("feedback-provider-token");
        onStateChange("verified");
      }}
    >
      Завърши проверката
    </button>
  ),
}));

describe("ArticleFeedbackScreen", () => {
  beforeEach(() => {
    loadMock.mockReset();
    submitMock.mockReset();
    browserNonceMock.mockReset();
    idempotencyMock.mockReset();
    loadMock.mockResolvedValue({
      article_key: "example.bg/article-1",
      revision: 9,
      content_sha256: `sha256:${"a".repeat(64)}`,
      analysis_sha256: null,
      public_data_revision: "2026-09-01T08:00:00.000Z",
    });
    submitMock.mockResolvedValue("feedback-submission-1");
    browserNonceMock.mockReturnValue("feedback-browser-0001");
    idempotencyMock
      .mockReturnValueOnce("feedback-idempotency-0001")
      .mockReturnValueOnce("feedback-idempotency-0002");
  });

  it("accepts a missing-analysis/entity report for an article outside the eval dataset", async () => {
    const user = userEvent.setup();
    const { ArticleFeedbackScreen } = await import("./ArticleFeedbackScreen");
    render(
      <MemoryRouter>
        <ArticleFeedbackScreen domain="example.bg" articleId="article-1" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Допълнете анализа" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/без регистрация/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Липсва анализ/ }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /Липсва лице, партия, място или институция/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Добави партия" }));
    await user.type(screen.getByLabelText("Партия"), "Примерна партия");
    await user.selectOptions(screen.getByLabelText("Тон"), "unfavorable");
    await user.type(
      screen.getByLabelText("Основание за партията"),
      "Партията е критикувана пряко в третия абзац.",
    );
    await user.type(
      screen.getByLabelText("Общо проверимо основание"),
      "В текста е посочено министерство, но няма анализ или профилна връзка.",
    );
    await user.click(
      screen.getByRole("button", { name: "Завърши проверката" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Изпратете предложението" }),
    );

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        article_key: "example.bg/article-1",
        analysis_sha256: null,
        feedback: expect.objectContaining({
          issue_kinds: ["missing_analysis", "missing_entity"],
          party_tones: [
            expect.objectContaining({
              party: "Примерна партия",
              tone: "unfavorable",
              evidence: "Партията е критикувана пряко в третия абзац.",
            }),
          ],
        }),
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Благодарим за предложението",
      }),
    ).toBeInTheDocument();
  });

  it("reuses the idempotency key after an uncertain response without a browser nonce", async () => {
    const user = userEvent.setup();
    const { ArticleFeedbackScreen } = await import("./ArticleFeedbackScreen");
    browserNonceMock.mockReturnValue(null);
    submitMock
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce("feedback-submission-1");
    render(
      <MemoryRouter>
        <ArticleFeedbackScreen domain="example.bg" articleId="article-1" />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Добави партия" });
    await user.click(screen.getByRole("button", { name: "Добави партия" }));
    await user.type(screen.getByLabelText("Партия"), "Примерна партия");
    await user.selectOptions(screen.getByLabelText("Тон"), "neutral");
    await user.type(
      screen.getByLabelText("Основание за партията"),
      "Партията е цитирана без оценъчен език.",
    );
    await user.click(
      screen.getByRole("button", { name: "Завърши проверката" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Изпратете предложението" }),
    );
    await screen.findByRole("alert");

    await user.click(
      screen.getByRole("button", { name: "Завърши проверката" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Изпратете предложението" }),
    );
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(2));
    expect(submitMock.mock.calls[0]?.[0].idempotency_key).toBe(
      submitMock.mock.calls[1]?.[0].idempotency_key,
    );
    expect(idempotencyMock).toHaveBeenCalledTimes(1);
  });

  it("clears article-local state before loading a different article", async () => {
    const user = userEvent.setup();
    const { ArticleFeedbackScreen } = await import("./ArticleFeedbackScreen");
    loadMock
      .mockReset()
      .mockResolvedValueOnce({
        article_key: "example.bg/article-1",
        revision: 9,
        content_sha256: `sha256:${"a".repeat(64)}`,
        analysis_sha256: null,
        public_data_revision: "2026-09-01T08:00:00.000Z",
      })
      .mockResolvedValueOnce({
        article_key: "example.bg/article-2",
        revision: 10,
        content_sha256: `sha256:${"b".repeat(64)}`,
        analysis_sha256: `sha256:${"c".repeat(64)}`,
        public_data_revision: "2026-09-01T09:00:00.000Z",
      });
    const view = render(
      <MemoryRouter>
        <ArticleFeedbackScreen domain="example.bg" articleId="article-1" />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Добави партия" });
    await user.selectOptions(
      screen.getByLabelText(/Политическо рамкиране/),
      "progressive",
    );

    view.rerender(
      <MemoryRouter>
        <ArticleFeedbackScreen domain="example.bg" articleId="article-2" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Зареждане на формуляра…")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Добави партия" });
    expect(screen.getByLabelText(/Политическо рамкиране/)).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Добави партия" }));
    await user.type(screen.getByLabelText("Партия"), "Втора партия");
    await user.selectOptions(screen.getByLabelText("Тон"), "favorable");
    await user.type(
      screen.getByLabelText("Основание за партията"),
      "Партията е представена положително.",
    );
    await user.click(
      screen.getByRole("button", { name: "Завърши проверката" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Изпратете предложението" }),
    );
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        article_key: "example.bg/article-2",
        base_task_revision: 10,
      }),
    );
  });
});
