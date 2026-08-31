import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord } from "../data";
import type { EvalQueue, EvalTask } from "../evals";
import type { EvaluationSubmissionRequest } from "../evalSubmission";

const submitMock =
  vi.fn<
    (task: EvalTask, request: EvaluationSubmissionRequest) => Promise<unknown>
  >();

const task = (over: Partial<EvalTask> = {}): EvalTask => ({
  article_key: "ex.bg/a1",
  domain: "ex.bg",
  article_id: "a1",
  url: "https://ex.bg/a1",
  title: "Статия за обществена проверка",
  published: "2026-08-30T10:00:00.000Z",
  story_id: "story-1",
  primary_topic: "government",
  outlet: "Примерен вестник",
  content_sha256: `sha256:${"1".repeat(64)}`,
  analysis_sha256: `sha256:${"2".repeat(64)}`,
  model_labels: {
    leaning: "strong_progressive",
    russia_stance: "neutral",
    party_tones: [],
  },
  review_fields: ["leaning"],
  dataset_ids: ["community-pilot-v1"],
  task_revision: 123,
  ...over,
});

const queue = (tasks: EvalTask[]): EvalQueue => ({
  schema_version: 1,
  generated_at: "2026-08-31T10:00:00.000Z",
  public_data_revision: "2026-08-31T10:00:00.000Z",
  rubric_version: "news-article-evaluation-v1",
  task_count: tasks.length,
  tasks_sha256: `sha256:${"3".repeat(64)}`,
  tasks,
});

const queueState = (tasks: EvalTask[]) => ({
  data: queue(tasks),
  error: null,
  loading: false,
});

const renderQueue = async (tasks: EvalTask[]) => {
  vi.resetModules();
  vi.doMock("../evals", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../evals")>()),
    useEvalQueue: () => queueState(tasks),
  }));
  const { EvalsScreen } = await import("./EvalsScreen");
  render(
    <MemoryRouter initialEntries={["/evals"]}>
      <Routes>
        <Route path="/evals" element={<EvalsScreen />} />
        <Route
          path="/evals/article/:domain/:id"
          element={<p>Избрана задача</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
};

const article = (): ArticleRecord =>
  ({
    id: "a1",
    domain: "ex.bg",
    title: "Статия за обществена проверка",
    url: "https://ex.bg/a1",
    published: "2026-08-30T10:00:00.000Z",
    author: null,
    topic: null,
    keywords: null,
    excerpt: "Публичен откъс от материала.",
    content_chars: 900,
    image: null,
    image_alt: null,
    canonical: "https://ex.bg/a1",
    language: "bg",
    updated: null,
    story_id: "story-1",
  }) as ArticleRecord;

const accepted = (target: EvalTask, request: EvaluationSubmissionRequest) => ({
  idempotent: false,
  submission: {
    submission_id: "submission-id-1234",
    status: "raw" as const,
    article_key: target.article_key,
    task_revision: target.task_revision,
    submitted_at: "2026-08-31T12:00:00.000Z",
    evaluation: {
      schema_version: 1,
      ...request.evaluation,
      leaning: {
        ...request.evaluation.leaning,
        disposition: "changed" as const,
      },
      russia_stance: {
        ...request.evaluation.russia_stance,
        disposition: "unable_to_judge" as const,
      },
    },
    model_labels: target.model_labels,
  },
});

const completeNoPartyForm = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.click(
    screen.getByRole("radio", { name: "Прогресивно рамкиране" }),
  );
  await user.type(
    screen.getAllByLabelText(/Кратко основание \(задължително\)/i)[0]!,
    "Авторът защитава мярката.",
  );
  await user.click(
    screen.getAllByRole("radio", { name: "Не мога да преценя" })[1]!,
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Няма съществено спомената политическа партия",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Завърши тестова проверка" }),
  );
};

const renderWorkspace = async (tasks: EvalTask[]) => {
  vi.resetModules();
  vi.doMock("../evals", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../evals")>()),
    useEvalQueue: () => queueState(tasks),
  }));
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useOutletArticles: () => ({
      data: {
        domain: "ex.bg",
        outlet: "Примерен вестник",
        articles: [article()],
      },
      error: null,
      loading: false,
    }),
  }));
  vi.doMock("../evalSubmission", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../evalSubmission")>()),
    TURNSTILE_SITE_KEY: "test-public-key",
    submitEvaluation: submitMock,
  }));
  vi.doMock("../components/TurnstileWidget", () => ({
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
          onToken("test-turnstile-token");
          onStateChange("verified");
        }}
      >
        Завърши тестова проверка
      </button>
    ),
  }));
  const { EvalArticleScreen } = await import("./EvalArticleScreen");
  render(
    <MemoryRouter initialEntries={["/evals/article/ex.bg/a1"]}>
      <Routes>
        <Route
          path="/evals/article/:domain/:id"
          element={<EvalArticleScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
};

describe("public evaluation queue", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders without account UI and filters by party coverage", async () => {
    await renderQueue([
      task(),
      task({
        article_key: "two.bg/a2",
        domain: "two.bg",
        article_id: "a2",
        title: "Материал с партия",
        outlet: "Втори източник",
        model_labels: {
          leaning: "neutral",
          russia_stance: "anti_russia",
          party_tones: [{ party: "Партия А", party_id: "a", tone: "mixed" }],
        },
      }),
    ]);
    expect(
      screen.getByRole("heading", { name: "Помогнете да проверим анализите" }),
    ).toBeVisible();
    expect(screen.getByText("2 от 2 статии")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /вход|регистрация/i }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Партийно покритие"), {
      target: { value: "with_party" },
    });
    expect(screen.getByText("1 от 2 статии")).toBeVisible();
    expect(screen.getByText("Материал с партия")).toBeVisible();
    expect(screen.queryByText("Статия за обществена проверка")).toBeNull();
  });

  it("opens a random task from the current filtered set", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await renderQueue([task()]);
    await userEvent.click(
      screen.getByRole("button", { name: /Случайна статия/ }),
    );
    expect(screen.getByText("Избрана задача")).toBeVisible();
  });

  it("shows only a browser-local completion marker", async () => {
    const target = task();
    const { markLocalEvalComplete } = await import("../evalSubmission");
    markLocalEvalComplete(target);
    await renderQueue([target]);
    expect(screen.getByText("изпратена от този браузър")).toBeVisible();
  });
});

describe("public article evaluation workspace", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    submitMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses public context and starts with no model choice selected", async () => {
    await renderWorkspace([
      task({
        model_labels: {
          leaning: "strong_progressive",
          russia_stance: "strong_anti_russia",
          party_tones: [
            { party: "Партия А", party_id: "party-a", tone: "favorable" },
          ],
        },
      }),
    ]);
    expect(screen.getByText("Публичен откъс от материала.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Прочети оригинала/ }),
    ).toHaveAttribute("href", "https://ex.bg/a1");
    expect(screen.getByText("моделът е скрит")).toBeVisible();
    expect(
      screen.getByText(
        "Представянето е фактическо или балансирано без ясна посока.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Русия няма съдържателна роля в материала."),
    ).toBeVisible();
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ].filter((input) => input.checked),
    ).toHaveLength(0);
    const party = screen.getByRole("group", { name: "Партия А" });
    expect(within(party).getByText("позитивен")).toBeVisible();
    expect(
      within(party).getByRole("radio", { name: "позитивен" }),
    ).not.toBeChecked();
    expect(
      within(party).getByText(
        "Има едновременно благоприятни и критични сигнали.",
      ),
    ).toBeVisible();
  });

  it("names each party group and preserves canonical drafts through no-party", async () => {
    const user = userEvent.setup();
    await renderWorkspace([
      task({
        model_labels: {
          leaning: "neutral",
          russia_stance: "neutral",
          party_tones: [
            { party: "Партия А", party_id: "party-a", tone: "favorable" },
            { party: "Партия Б", party_id: "party-b", tone: "mixed" },
          ],
        },
      }),
    ]);
    const partyA = screen.getByRole("group", { name: "Партия А" });
    const partyB = screen.getByRole("group", { name: "Партия Б" });
    const favorableA = within(partyA).getByRole("radio", { name: "позитивен" });
    favorableA.focus();
    await user.keyboard(" ");
    expect(favorableA).toBeChecked();
    expect(
      within(partyB).getByRole("radio", { name: "смесен" }),
    ).not.toBeChecked();

    const noParty = screen.getByRole("checkbox", {
      name: "Няма съществено спомената политическа партия",
    });
    await user.click(noParty);
    expect(screen.queryByRole("group", { name: "Партия А" })).toBeNull();
    await user.click(noParty);
    const restored = within(
      screen.getByRole("group", { name: "Партия А" }),
    ).getByRole("radio", { name: "позитивен" });
    expect(restored).toBeChecked();
    expect(restored).toHaveAttribute("name", "party-party-a");
  });

  it("supports changing both axes and adding or removing a party locally", async () => {
    const user = userEvent.setup();
    await renderWorkspace([task()]);
    await user.click(
      screen.getByRole("radio", { name: "Прогресивно рамкиране" }),
    );
    await user.click(
      screen.getAllByRole("radio", { name: "Не мога да преценя" })[1],
    );
    expect(screen.getByText("Избрани раздели: 2 от 3")).toBeVisible();

    await user.type(
      screen.getByLabelText("Име на пропусната партия"),
      "Партия Б",
    );
    await user.click(screen.getByRole("button", { name: "Добави" }));
    expect(screen.getByText("Партия Б")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Премахни Партия Б" }));
    expect(screen.queryByText("Партия Б")).toBeNull();
  });

  it("submits anonymously and reveals the model comparison only after acceptance", async () => {
    const user = userEvent.setup();
    const target = task();
    submitMock.mockImplementation(async (_task, request) =>
      accepted(target, request),
    );
    await renderWorkspace([target]);
    expect(
      screen.queryByRole("heading", { name: "Сравнение с модела" }),
    ).toBeNull();
    await completeNoPartyForm(user);
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "Сравнение с модела" }),
    ).toBeVisible();
    expect(screen.getByText(/Моделните оценки бяха скрити/)).toBeVisible();
    expect(
      screen.getByText(/Силно прогресивно рамкиране/, { selector: "dd" }),
    ).toBeVisible();
  });

  it("rotates a rejected idempotency key before a recoverable retry", async () => {
    const user = userEvent.setup();
    const target = task();
    await renderWorkspace([target]);
    const { EvaluationSubmissionError } = await import("../evalSubmission");
    submitMock
      .mockRejectedValueOnce(
        new EvaluationSubmissionError("idempotency_conflict", 409),
      )
      .mockImplementationOnce(async (_task, request) =>
        accepted(target, request),
      );
    await completeNoPartyForm(user);
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Формата е променена",
    );
    const firstKey = submitMock.mock.calls[0]![1].idempotency_key;
    await user.click(
      screen.getByRole("button", { name: "Завърши тестова проверка" }),
    );
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(
      await screen.findByRole("heading", { name: "Сравнение с модела" }),
    ).toBeVisible();
    expect(submitMock.mock.calls[1]![1].idempotency_key).not.toBe(firstKey);
  });

  it("reuses the key after an ambiguous network failure and keeps the draft", async () => {
    const user = userEvent.setup();
    const target = task();
    await renderWorkspace([target]);
    const { EvaluationSubmissionError } = await import("../evalSubmission");
    submitMock
      .mockRejectedValueOnce(new EvaluationSubmissionError("network_error", 0))
      .mockImplementationOnce(async (_task, request) =>
        accepted(target, request),
      );
    await completeNoPartyForm(user);
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Черновата е запазена",
    );
    const firstKey = submitMock.mock.calls[0]![1].idempotency_key;
    await user.click(
      screen.getByRole("button", { name: "Завърши тестова проверка" }),
    );
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(submitMock.mock.calls[1]![1].idempotency_key).toBe(firstKey);
  });

  it("keeps model comparison hidden and offers reload for a stale task", async () => {
    const user = userEvent.setup();
    await renderWorkspace([task()]);
    const { EvaluationSubmissionError } = await import("../evalSubmission");
    submitMock.mockRejectedValueOnce(
      new EvaluationSubmissionError("stale_task", 409, 124),
    );
    await completeNoPartyForm(user);
    await user.click(screen.getByRole("button", { name: "Изпрати оценката" }));
    expect(
      await screen.findByRole("button", { name: "Презареди задачата" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Сравнение с модела" }),
    ).toBeNull();
  });

  it("refuses an article outside the current public queue", async () => {
    await renderWorkspace([]);
    expect(
      screen.getByRole("heading", { name: "Статията не е в текущата опашка" }),
    ).toBeVisible();
  });
});
