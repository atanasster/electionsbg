// ArticleScreen — the page that publishes a judgment about a named outlet's
// specific piece of work.
//
// ⚠️ Four of these assertions are about the CLAIM, not the layout:
//   - the quoted evidence renders beside every label (the one thing no
//     competitor does, and the only thing that makes an article-level rating
//     checkable);
//   - the outbound link goes to the OUTLET, prominently;
//   - the model and date are printed (a judgment with no attribution is not
//     checkable);
//   - an unanalysed article renders NO badges, because at 8.4% analysed
//     "not yet judged" must never read as "judged neutral".

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArticleRecord,
  EditorialFeedbackProvenance,
  Outlet,
  Story,
} from "../data";
import type { EvalTask } from "../evals";

const analysed = (): NonNullable<ArticleRecord["analysis"]> => ({
  summary_bg: "Кабинетът отложи решението.",
  summary_en: "Cabinet delayed the decision.",
  leaning: {
    label: "neutral" as const,
    confidence: 0.7,
    evidence: "Материалът представя и двете страни с равен обем.",
  },
  russia_stance: {
    label: "not_applicable" as const,
    confidence: 0.9,
    evidence: "В текста няма позоваване на Русия.",
  },
  ai_generated: {
    verdict: "likely_human" as const,
    confidence: 0.6,
    signals: [],
  },
  entities: {
    people: ["Делян Пеевски", "Радев"],
    parties: [],
    institutions: ["МТСП"],
    companies: [],
    places: [],
  },
  party_tones: [],
  topics: [{ category: "politics", subcategory: null, primary: true }],
  quality: { verdict: "ok" as const, notes: "" },
  site_relevant: true,
  model: "GLM-5.3",
  analyzed_at: "2026-08-23T18:40:00+00:00",
});

const article = (over: Partial<ArticleRecord> = {}): ArticleRecord =>
  ({
    id: "a1",
    domain: "ex.bg",
    title: "Правителството отложи решението",
    url: "https://ex.bg/a/1",
    published: "2026-08-22T09:00:00+00:00",
    author: "Мария Иванова",
    topic: null,
    keywords: null,
    excerpt: "Кабинетът върна проекта за преразглеждане.",
    content_chars: 900,
    image: "https://cdn.ex.bg/lead.jpg",
    image_alt: null,
    canonical: "https://ex.bg/a/1",
    language: "bg",
    updated: null,
    story_id: null,
    ...over,
  }) as ArticleRecord;

const outlet = (over: Partial<Outlet> = {}): Outlet =>
  ({
    domain: "ex.bg",
    outlet: "Примерен вестник",
    logo: null,
    owner: null,
    hotlink_ok: null,
    retired: false,
    retired_reason: null,
    retired_on: null,
    rank: 1,
    tier: "mass",
    type: "news",
    scope: "national",
    visits: null,
    article_count: 1,
    analyzed_count: 1,
    leaning: {},
    russia_stance: {},
    ai_generated: {},
    conduct: {
      articles: 1,
      with_author: 1,
      updated_known: 0,
      edited_after_publication: 0,
    },
    ...over,
  }) as Outlet;

const evalTask = (over: Partial<EvalTask> = {}): EvalTask => ({
  article_key: "ex.bg/a1",
  domain: "ex.bg",
  article_id: "a1",
  url: "https://ex.bg/a/1",
  title: "Правителството отложи решението",
  published: "2026-08-22T09:00:00+00:00",
  story_id: null,
  primary_topic: "politics",
  outlet: "Примерен вестник",
  content_sha256: `sha256:${"1".repeat(64)}`,
  analysis_sha256: `sha256:${"2".repeat(64)}`,
  model_labels: {
    leaning: "neutral",
    russia_stance: "not_applicable",
    party_tones: [],
  },
  review_fields: ["leaning", "russia_stance", "party_tones"],
  dataset_ids: ["public-pilot-v1"],
  task_revision: 1,
  ...over,
});

const renderAt = async (
  articles: ArticleRecord[],
  opts: {
    outlets?: Outlet[];
    stories?: Story[];
    id?: string;
    evalTasks?: EvalTask[] | null;
    evalLoading?: boolean;
    evalError?: Error | null;
    bundleError?: Error | null;
  } = {},
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useOutletArticles: () => ({
      data: { domain: "ex.bg", outlet: "Примерен вестник", articles },
      error: opts.bundleError ?? null,
      loading: false,
    }),
    useOutlets: () => ({
      data: { generated_at: "", outlets: opts.outlets ?? [outlet()] },
      error: null,
      loading: false,
    }),
    useStoryDetail: (storyId: string | null) => ({
      // Mirrors the real hook: a null id is no request and no data, which
      // is what an article in no story looks like.
      data: storyId
        ? {
            generated_at: "",
            story: (opts.stories ?? []).find((s) => s.id === storyId) ?? null,
            related: [],
          }
        : null,
      error: null,
      loading: false,
    }),
    useTaxonomy: () => ({
      data: { version: 1, categories: [] },
      error: null,
      loading: false,
    }),
  }));
  vi.doMock("../evals", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../evals")>()),
    useEvalQueue: () => ({
      data:
        opts.evalTasks === null
          ? null
          : {
              schema_version: 1,
              generated_at: "2026-08-31T00:00:00.000Z",
              public_data_revision: "2026-08-31T00:00:00.000Z",
              rubric_version: "news-article-evaluation-v1",
              task_count: opts.evalTasks?.length ?? 0,
              tasks_sha256: `sha256:${"0".repeat(64)}`,
              tasks: opts.evalTasks ?? [],
            },
      error:
        opts.evalError ??
        (opts.evalTasks === null ? new Error("invalid queue") : null),
      loading: opts.evalLoading ?? false,
    }),
  }));
  const { ArticleScreen } = await import("./ArticleScreen");
  render(
    <MemoryRouter initialEntries={[`/article/ex.bg/${opts.id ?? "a1"}`]}>
      <Routes>
        <Route path="/article/:domain/:id" element={<ArticleScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));

describe("the evidence", () => {
  beforeEach(() => vi.resetModules());

  it("renders the quoted sentence beside EVERY axis", async () => {
    // ⚠️ The one thing no competitor does. Ground News, AllSides and Improve
    // The News all rate the OUTLET and attribute it to every article.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(
      await screen.findByText(/Материалът представя и двете страни/),
    ).toBeVisible();
    expect(screen.getByText(/няма позоваване на Русия/)).toBeVisible();
  });

  it("leads with model provenance and keeps raw confidence behind a caveat", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(await screen.findAllByText("Моделна оценка")).toHaveLength(2);
    const details = screen.getAllByText("Технически данни за модела");
    expect(details).toHaveLength(2);
    fireEvent.click(details[0]);
    expect(screen.getByText(/Необработена увереност 70%/)).toBeVisible();
    expect(screen.getAllByText(/не калибрирана вероятност/)[0]).toBeVisible();
    expect(
      screen.getByLabelText("Увереност на модела: 70 процента"),
    ).toBeVisible();
  });

  it("SAYS SO when an axis carries no quoted sentence", async () => {
    // A verdict whose evidence silently vanishes is the unsupported claim
    // this page exists to avoid making.
    const a = analysed();
    a.leaning!.evidence = "";
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    expect(await screen.findByText(/не е посочил обосновка/)).toBeVisible();
  });

  it("renders a v2 axis as rationale + LOCATED spans, and a withheld label as withheld — never neutral (T4.1b)", async () => {
    const a = analysed();
    a.leaning = {
      label: null,
      confidence: null,
      rationale: "Материалът рамкира реформата като необходима.",
      evidence_spans: [
        {
          quote: "тази фраза липсва",
          field: "body",
          direction: "conservative",
          voice: "journalist",
          located: false,
        },
        // A located span on the OTHER side: the label is still withheld, and
        // the sentence must not claim that nothing was found.
        {
          quote: "протестите бяха масови",
          field: "body",
          direction: "progressive",
          voice: "journalist",
          located: true,
          start: 40,
          end: 62,
        },
      ],
      evidence_grounded: false,
      withheld_reason: "unsupported_evidence",
    };
    a.russia_stance = {
      label: "anti_russia",
      confidence: 0.8,
      rationale: "Русия е представена като заплаха.",
      evidence_spans: [
        {
          quote: "Русия е заплаха за региона",
          field: "title",
          direction: "anti_russia",
          voice: "quoted_speaker",
          speaker: "министърът",
          located: true,
          start: 0,
          end: 26,
        },
      ],
      evidence_grounded: true,
    };
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    // ⚠️ THE MUTATION THIS CATCHES: rendering the withheld label as
    // „неутрално" or silently as „Оценката не е налична" with no reason.
    const withheld = await screen.findByTestId("axis-withheld");
    expect(withheld).toHaveTextContent("Етикетът е задържан");
    expect(withheld).toHaveTextContent("Не е заменен с „неутрално“");
    expect(withheld).toHaveTextContent(
      "нито един намерен в текста откъс не подкрепя тази страна",
    );
    expect(withheld).not.toHaveTextContent(
      "нито един от цитираните откъси не е намерен",
    );
    expect(
      screen.getByText("Материалът рамкира реформата като необходима."),
    ).toBeVisible();
    const unlocated = screen.getByText("тази фраза липсва");
    expect(unlocated.closest("s")).not.toBeNull();
    expect(
      screen.getByText(/текст · авторски текст · не е намерен в текста/),
    ).toBeVisible();
    // The located, attributed span: quote, field, speaker, found.
    const located = screen.getByText("Русия е заплаха за региона");
    expect(located.closest("s")).toBeNull();
    expect(
      screen.getByText(/заглавие · цитиран: министърът · намерен в текста/),
    ).toBeVisible();
    expect(
      screen.getAllByText(/свободен текст, не се сверява със статията/),
    ).toHaveLength(2);
    // Nothing says „verified": grounded is provenance only.
    expect(document.body.textContent).not.toMatch(
      /провер[её]н[ао]? от модела|verified/i,
    );
  });

  it("says when the ratings were made on a prefix, and stays silent on a full read (T4.1c)", async () => {
    const a = analysed();
    a.text_scope = {
      version: 1,
      kind: "prefix",
      chars_seen: 6000,
      chars_total: 9400,
      coverage: 0.6383,
      basis: "provenance",
    };
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    const note = await screen.findByTestId("text-scope-note");
    // Grouping separators depend on the runtime's ICU data; the figures do not.
    expect(note).toHaveTextContent(
      /първите 6[\s\u00a0]?000 от 9[\s\u00a0]?400 знака/,
    );
    expect(note).toHaveTextContent("не влизат в разпределенията");
    cleanup();
    vi.resetModules();
    // ⚠️ THE MUTATION THIS CATCHES: „първите 0 от 0 знака" — a figure nobody
    // measured — on the fail-closed / unrecorded scope.
    const unrecorded = analysed();
    unrecorded.text_scope = {
      version: 1,
      kind: "unrecorded",
      chars_seen: null,
      chars_total: null,
      coverage: null,
      basis: "unrecorded",
    };
    await renderAt([
      article({ analysis: unrecorded } as Partial<ArticleRecord>),
    ]);
    const unrecordedNote = await screen.findByTestId("text-scope-note");
    expect(unrecordedNote).toHaveTextContent("не е записан");
    expect(unrecordedNote.textContent).not.toMatch(/\d/);
    cleanup();
    vi.resetModules();
    const full = analysed();
    full.text_scope = {
      ...a.text_scope,
      kind: "full",
      chars_seen: 9400,
      coverage: 1,
    };
    await renderAt([article({ analysis: full } as Partial<ArticleRecord>)]);
    await screen.findAllByText("Моделна оценка");
    expect(screen.queryByTestId("text-scope-note")).toBeNull();
  });

  it("does not claim that untyped evidence is a verbatim source quotation", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(
      await screen.findAllByText(
        "Обосновка, посочена от модела — може да е цитат или перифраза",
      ),
    ).toHaveLength(2);
    expect(screen.queryByText(/Цитат от материала/)).not.toBeInTheDocument();
    expect(screen.getByText(/Материалът представя/)).toHaveTextContent(
      "Материалът представя и двете страни с равен обем.",
    );
  });
});

describe("the outbound link", () => {
  beforeEach(() => vi.resetModules());

  it("prefills the canonical analysis path without article text or query data", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const href = screen
      .getByRole("link", { name: /Сигнализирай проблем/ })
      .getAttribute("href")!;
    const body = new URL(href).searchParams.get("body");
    expect(body).toContain("https://news.electionsbg.com/article/ex.bg/a1");
    expect(body).not.toMatch(/Правителството|Кабинетът|\?/);
  });

  it("points at the outlet and opens externally", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const link = (
      await screen.findByText(/Прочети в Примерен вестник/)
    ).closest("a");
    expect(link).toHaveAttribute("href", "https://ex.bg/a/1");
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(link!);
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "source_open",
        surface: "article",
      }),
    );
    expect(sink).toHaveBeenCalledWith({
      name: "reader_task",
      task: "open_original",
      signal: "completed",
    });
  });

  it("says the full text stays at the source", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(
      await screen.findByText(/Пълният текст остава при източника/),
    ).toBeVisible();
  });
});

describe("the experimental evaluation entry point", () => {
  beforeEach(() => vi.resetModules());

  it("links an eligible article to its public evaluation workspace", async () => {
    await renderAt([article({ analysis: analysed() })], {
      evalTasks: [evalTask()],
    });

    expect(
      await screen.findByRole("link", {
        name: "Помогнете да подобрим анализа — експериментално",
      }),
    ).toHaveAttribute("href", "/evals/article/ex.bg/a1");
    expect(
      screen.getByRole("link", { name: "Оценете тази статия" }),
    ).toHaveAttribute("href", "/evals/article/ex.bg/a1");
  });

  it("does not invite evaluation when the article is outside the queue", async () => {
    await renderAt([article({ analysis: analysed() })], {
      evalTasks: [evalTask({ article_id: "a2", article_key: "ex.bg/a2" })],
    });

    expect(
      screen.queryByRole("link", { name: /Помогнете да подобрим анализа/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Допълнете анализа или връзките/ }),
    ).toHaveAttribute("href", "/evals/article/ex.bg/a1?mode=feedback");
    expect(
      screen.getByRole("link", { name: /Добавете липсващ анализ или връзка/ }),
    ).toBeVisible();
  });

  it("fails closed when the public queue is unavailable or invalid", async () => {
    await renderAt([article({ analysis: analysed() })], { evalTasks: null });

    expect(
      screen.queryByRole("link", { name: /Помогнете да подобрим анализа/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Сигнализирай проблем/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Допълнете анализа или връзките/ }),
    ).toHaveAttribute("href", "/evals/article/ex.bg/a1?mode=feedback");
  });

  it.each([
    { evalLoading: true, evalError: null, state: "refreshing" },
    {
      evalLoading: false,
      evalError: new Error("refresh failed"),
      state: "errored",
    },
  ])("fails closed with retained queue data while $state", async (state) => {
    await renderAt([article({ analysis: analysed() })], {
      evalTasks: [evalTask()],
      evalLoading: state.evalLoading,
      evalError: state.evalError,
    });

    expect(
      screen.queryByRole("link", { name: /Помогнете да подобрим анализа/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Допълнете анализа или връзките/ }),
    ).toHaveAttribute("href", "/evals/article/ex.bg/a1?mode=feedback");
  });
});

describe("attribution", () => {
  beforeEach(() => vi.resetModules());

  it("prints the model and the date", async () => {
    // ⚠️ A judgment with no attribution is not checkable, and the model will
    // change.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const line = await screen.findByText(/Анализирано/);
    expect(line).toHaveTextContent("GLM-5.3");
    expect(line).toHaveTextContent("2026");
    expect(
      screen.getByRole("heading", { name: "Анализ с помощта на ИИ" }),
    ).toBeVisible();
    expect(screen.getByText("Само модел")).toBeVisible();
    expect(
      screen.getByText(/Няма приложено редакционно решение/),
    ).toBeVisible();
  });

  it("places provenance before the verdict evidence in reading order", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const provenance = await screen.findByText(/Анализирано/);
    const evidence = screen.getByText(/Материалът представя и двете страни/);
    expect(
      provenance.compareDocumentPosition(evidence) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses axis names—not verdicts—as the card headings", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Политическо рамкиране на материала",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Отношение към Русия" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Без ясно идеологическо рамкиране",
      }),
    ).not.toBeInTheDocument();
  });

  it("states when model provenance is missing", async () => {
    const a = analysed();
    a.model = null;
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    expect(await screen.findByText("Непълна следа на анализа")).toBeVisible();
    expect(screen.getByText(/моделът не е записан/)).toBeVisible();
    expect(screen.getByText("Непълна следа")).toBeVisible();
    expect(screen.queryByText("Само модел")).not.toBeInTheDocument();
  });

  it("omits malformed confidence while retaining zero and one", async () => {
    const a = analysed();
    a.leaning!.confidence = 0;
    a.russia_stance!.confidence = 1;
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    expect(screen.getByText(/Необработена увереност 0%/)).toBeInTheDocument();
    expect(screen.getByText(/Необработена увереност 100%/)).toBeInTheDocument();

    const bad = analysed();
    bad.leaning!.confidence = 1.4;
    await renderAt(
      [article({ id: "a2", analysis: bad } as Partial<ArticleRecord>)],
      {
        id: "a2",
      },
    );
    expect(
      screen.queryByText(/Необработена увереност 140%/),
    ).not.toBeInTheDocument();
  });
});

describe("human review provenance", () => {
  beforeEach(() => vi.resetModules());

  it("labels accepted fields as editorial, omits model confidence, and links policy", async () => {
    const a = analysed();
    a.leaning = {
      label: "conservative",
      confidence: null,
      evidence: "Редакционната проверка отчита ясно консервативно рамкиране.",
    };
    a.russia_stance = {
      label: "anti_russia",
      confidence: null,
      evidence: "Редакционната проверка отчита критично отношение към Русия.",
    };
    a.human_review = {
      status: "accepted",
      adjudicated_at: "2026-08-31T12:00:00.000Z",
      revision: 2,
      fields: {
        leaning: "changed",
        russia_stance: "confirmed",
        party_tones: "accepted",
      },
      public_explanation: "Проверено спрямо целия оригинален материал.",
    };

    await renderAt([article({ analysis: a })]);

    expect(
      await screen.findByText("Проверено от редакционния екип"),
    ).toBeVisible();
    expect(screen.getByText("Редакционно проверено")).toBeVisible();
    expect(
      screen.getByText(/Проверено спрямо целия оригинален материал/),
    ).toBeVisible();
    expect(
      screen.getAllByText(/Обосновка от редакционната проверка/),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/Необработена увереност \d+%/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Увереност на модела/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "методологията" })).toHaveAttribute(
      "href",
      "/methodology",
    );
    expect(
      screen.getByRole("link", { name: "регистъра на поправките" }),
    ).toHaveAttribute("href", "/corrections");
  });

  it("marks stale decisions as excluded and keeps current model provenance", async () => {
    const a = analysed();
    a.human_review = {
      status: "needs_revalidation",
      adjudicated_at: "2026-08-31T12:00:00.000Z",
      revision: 1,
      fields: {
        leaning: "changed",
        russia_stance: "confirmed",
        party_tones: "accepted",
      },
      public_explanation: "Старо обяснение, което вече не се прилага.",
    };

    await renderAt([article({ analysis: a })]);

    expect(
      await screen.findByText("Оценката е в повторна проверка"),
    ).toBeVisible();
    expect(screen.getByText("Повторна проверка")).toBeVisible();
    expect(screen.getByText(/Предишното решение е изключено/)).toBeVisible();
    expect(screen.getByText(/Необработена увереност 70%/)).toBeInTheDocument();
    expect(screen.getAllByText(/Обосновка, посочена от модела/)).toHaveLength(
      2,
    );
    expect(screen.queryByText(/Старо обяснение/)).not.toBeInTheDocument();
  });

  it("describes a queued public task as non-authoritative experimental review", async () => {
    await renderAt([article({ analysis: analysed() })], {
      evalTasks: [evalTask()],
    });

    expect(
      await screen.findByText("Анализът е включен в обществена проверка"),
    ).toBeVisible();
    expect(screen.getByText(/Отделен отговор не променя/)).toBeVisible();
  });

  it("keeps an unable-to-judge axis model-sourced beside an editorial axis", async () => {
    const a = analysed();
    a.leaning = {
      label: "conservative",
      confidence: null,
      evidence: "Редакционно основание за политическата ос.",
    };
    a.human_review = {
      status: "accepted",
      adjudicated_at: "2026-08-31T12:00:00.000Z",
      revision: 1,
      fields: {
        leaning: "changed",
        russia_stance: "unable_to_judge",
        party_tones: "accepted",
      },
      public_explanation: null,
    };

    await renderAt([article({ analysis: a })]);

    expect(
      screen.getAllByText(/Обосновка от редакционната проверка/),
    ).toHaveLength(1);
    expect(screen.getAllByText(/Обосновка, посочена от модела/)).toHaveLength(
      1,
    );
    expect(screen.getByText(/Необработена увереност 90%/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Необработена увереност 70%/),
    ).not.toBeInTheDocument();
  });

  it("does not crash or claim editorial provenance for a malformed block", async () => {
    const a = analysed();
    a.human_review = { status: "accepted" } as unknown as NonNullable<
      ArticleRecord["analysis"]
    >["human_review"];

    await renderAt([article({ analysis: a })]);

    expect(await screen.findByText("Анализ с помощта на ИИ")).toBeVisible();
    expect(screen.queryByText("Проверено от редакционния екип")).toBeNull();
    expect(screen.getByText(/Необработена увереност 70%/)).toBeInTheDocument();
  });

  it("keeps rendering the last valid article when a refresh is rejected", async () => {
    await renderAt([article({ analysis: analysed() })], {
      bundleError: new Error("invalid refreshed provenance"),
    });

    expect(await screen.findByText("Анализ с помощта на ИИ")).toBeVisible();
    expect(screen.queryByText(/Материалът не се зареди/)).toBeNull();
  });
});

describe("accepted all-article feedback", () => {
  beforeEach(() => vi.resetModules());

  it("shows only editorial provenance and reviewed canonical links", async () => {
    const a = analysed();
    a.leaning = {
      label: "conservative",
      confidence: null,
      evidence: "Редакционно проверено основание.",
    };
    const editorialFeedback: EditorialFeedbackProvenance = {
      status: "accepted",
      adjudicated_at: "2026-09-01T10:00:00.000Z",
      revision: 1,
      fields: ["leaning", "entity_links", "issue_kinds"],
      needs_revalidation_fields: [],
      issue_kinds: ["missing_entity", "missing_sector"],
      public_explanation: "Проверено спрямо оригиналния материал.",
    };
    a.reviewed_links = [
      {
        surface: "Енергетика",
        kind: "sector",
        id: "energy",
        canonical: "Енергетика",
        href: "https://naiasno.bg/sector/energy",
      },
    ];

    await renderAt([
      article({
        analysis: a,
        editorial_feedback: editorialFeedback,
      }),
    ]);

    expect(
      await screen.findByText(
        "Приета редакционна проверка по обществен сигнал",
      ),
    ).toBeVisible();
    expect(screen.getByText("Липсва сектор")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Енергетика → Енергетика",
      }),
    ).toHaveAttribute("href", "https://naiasno.bg/sector/energy");
    expect(screen.queryByText(/feedback-submission/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Необработена увереност 70%/),
    ).not.toBeInTheDocument();
  });

  it("shows an accepted missing-analysis finding without fake axis labels", async () => {
    await renderAt([
      article({
        editorial_feedback: {
          status: "accepted",
          adjudicated_at: "2026-09-01T10:00:00.000Z",
          revision: 1,
          fields: ["issue_kinds"],
          needs_revalidation_fields: [],
          issue_kinds: ["missing_analysis"],
          public_explanation: null,
        },
      }),
    ]);

    expect(await screen.findByText("Липсва анализ")).toBeVisible();
    expect(screen.getByText(/още не е анализирана/)).toBeVisible();
    expect(screen.queryByText("Неутрално")).not.toBeInTheDocument();
  });

  it("does not relabel model analysis for issue-only editorial feedback", async () => {
    await renderAt([
      article({
        analysis: analysed(),
        editorial_feedback: {
          status: "accepted",
          adjudicated_at: "2026-09-01T10:00:00.000Z",
          revision: 1,
          fields: ["issue_kinds"],
          needs_revalidation_fields: [],
          issue_kinds: ["missing_sector"],
          public_explanation: null,
        },
      }),
    ]);

    expect(await screen.findByText("Само модел")).toBeVisible();
    expect(screen.queryByText("Редакционно проверено")).not.toBeInTheDocument();
    expect(screen.getAllByText("Моделна оценка")).toHaveLength(2);
  });

  it("prioritizes revalidation when one analysis field is stale", async () => {
    await renderAt([
      article({
        analysis: analysed(),
        editorial_feedback: {
          status: "accepted",
          adjudicated_at: "2026-09-01T10:00:00.000Z",
          revision: 2,
          fields: ["leaning"],
          needs_revalidation_fields: ["russia_stance"],
          issue_kinds: [],
          public_explanation: null,
        },
      }),
    ]);

    expect(await screen.findByText("Повторна проверка")).toBeVisible();
    expect(screen.getAllByText("Редакционна проверка")).toHaveLength(1);
    expect(screen.getAllByText("Моделна оценка")).toHaveLength(1);
  });

  it("does not render stale issue claims or explanations as current", async () => {
    await renderAt([
      article({
        editorial_feedback: {
          status: "needs_revalidation",
          adjudicated_at: "2026-09-01T10:00:00.000Z",
          revision: 2,
          fields: [],
          needs_revalidation_fields: ["issue_kinds"],
          issue_kinds: [],
          public_explanation: null,
        },
      }),
    ]);

    expect(await screen.findByText(/повторна проверка/)).toBeVisible();
    expect(
      screen.getByText(/не се показва като текущо заключение/),
    ).toBeVisible();
    expect(screen.queryByText("Липсва анализ")).not.toBeInTheDocument();
  });
});

describe("the unanalysed state", () => {
  beforeEach(() => vi.resetModules());

  it("renders NO axis badges", async () => {
    // ⚠️ At 8.4% analysed this is the common case, and it must read as "not
    // yet judged" — never as "judged neutral", which an empty badge row says.
    await renderAt([article()]);
    expect(await screen.findByText(/още не е анализирана/)).toBeVisible();
    expect(
      screen.queryByText(/Необработена увереност 70%/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Политическо рамкиране на материала/),
    ).not.toBeInTheDocument();
  });

  it("says explicitly that absence is not neutrality", async () => {
    await renderAt([article()]);
    expect(await screen.findByText(/не означава „неутрална"/)).toBeVisible();
  });

  it("still shows the headline and the way out to the source", async () => {
    await renderAt([article()]);
    expect(screen.getByText("Правителството отложи решението")).toBeVisible();
    expect(screen.getByText(/Прочети в/)).toBeVisible();
  });
});

describe("mentions", () => {
  beforeEach(() => vi.resetModules());

  it("renders names as plain chips, NOT links", async () => {
    // ⚠️ The identity layer keys on three-part Bulgarian names while
    // newsrooms write two; „Радев" is 15 different people. A link would name
    // the wrong individual.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const chip = await screen.findByText("Делян Пеевски");
    expect(chip.closest("a")).toBeNull();
    expect(screen.getByText("Радев").closest("a")).toBeNull();
  });

  it("explains why there is no link", async () => {
    // An unexplained chip invites the reader to assume we checked.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(
      await screen.findByText(/грешната връзка е по-лоша от липсващата/),
    ).toBeVisible();
  });

  it("does not state a specific number it cannot support", async () => {
    // ⚠️ The copy said „Радев съвпада с петнайсет души". The register holds
    // ~108 active public figures with that family name — a made-up figure on
    // a page whose whole argument is that we do not publish unsupported
    // claims about named people. Asserted on the caption's OWN text: a
    // substring query over the whole document also matched the mutated copy.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const caption = await screen.findByText(/грешната връзка/);
    // ⚠️ Asserted as INTENT, not as a phrase. The first version pinned the
    // literal „десетки различни хора", which broke the day the caption was
    // rewritten to count the unlinked names — a real number, from the data
    // — while the rule it guards never changed: no invented figure about
    // how many people share a name.
    expect(caption.textContent).not.toMatch(/петнайсет|15 души|108/);
    expect(caption.textContent).toMatch(/три части/);
  });

  it("counts the unlinked names rather than asserting a share", async () => {
    // ⚠️ The number the caption DOES state must come from the data. The
    // fixture resolves nothing, so every name is unlinked — and „нито едно"
    // is the honest way to say that, not a percentage of a denominator the
    // reader cannot see.
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const caption = await screen.findByText(/грешната връзка/);
    expect(caption.textContent).toMatch(/Нито едно/);
  });

  it("links a name the gazetteer resolved, and shows who it resolved to", async () => {
    // ⚠️ The canonical name must be reachable: all eight people this
    // resolves matched on a TWO-PART form („Иван Христанов" → Иван Маркос
    // Христанов), and the reader is the last check on whether we picked the
    // right person.
    const a = analysed();
    a.entities = {
      people: ["Иван Христанов"],
      parties: [],
      institutions: [],
      companies: [],
      places: [],
    };
    a.entity_links = {
      "Иван Христанов": {
        kind: "person",
        id: "mp-3931",
        canonical: "Иван Маркос Христанов",
        form_kind: "two_part",
        href: "https://naiasno.bg/person/mp-3931",
      },
    };
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    const link = await screen.findByRole("link", { name: /Иван Христанов/ });
    expect(link).toHaveAttribute("href", "https://naiasno.bg/person/mp-3931");
    expect(link.getAttribute("title")).toContain("Иван Маркос Христанов");
    // …and with everything linked, the caveat does not appear at all.
    expect(screen.queryByText(/грешната връзка/)).toBeNull();
  });

  it("renders nothing when no entity was found", async () => {
    const a = analysed();
    a.entities = {
      people: [],
      parties: [],
      institutions: [],
      companies: [],
      places: [],
    };
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    await screen.findByText(/Прочети в/);
    expect(screen.queryByText("Споменати")).not.toBeInTheDocument();
  });
});

describe("news-person identity (T4.0)", () => {
  beforeEach(() => vi.resetModules());

  const withIdentities = () => ({
    ...analysed(),
    news_persons: [
      {
        surface: "Ивайло Калушев",
        basis: "registry_alias",
        news_person_id: "np_7f3c1a94",
        alias_scope: "global",
        identity_version: "2026-09-22.1:abc",
        name_bg: "Ивайло Калушев",
        name_en: "Ivaylo Kalushev",
        verified_main_site_slug: null,
        assessment: "not_assessed",
      },
      {
        surface: "Радев",
        basis: "not_in_registry",
        news_person_id: null,
        assessment: "not_assessed",
      },
      {
        surface: "Огнян Атанасов",
        basis: "ambiguous_registry",
        news_person_id: null,
        candidates: ["np_1", "np_2"],
        assessment: "not_assessed",
      },
    ],
  });

  it("marks a reviewed identity and keeps the rest visible as not assessed", async () => {
    await renderAt([
      article({ analysis: withIdentities() } as Partial<ArticleRecord>),
    ]);
    const block = await screen.findByTestId("news-persons");
    expect(within(block).getByText("Ивайло Калушев")).toBeVisible();
    expect(within(block).getByText(/идентичност: проверена/)).toBeVisible();
    // Unlinked names stay as written, and say so — never as a judgement.
    expect(within(block).getByText("Радев")).toBeVisible();
    expect(within(block).getByText(/без проверена идентичност/)).toBeVisible();
    expect(
      within(block).getByText(/повече от една проверена идентичност/),
    ).toBeVisible();
    // Every row carries the „not assessed" state, and the footnote explains it.
    const rows = within(block).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveTextContent(/не е оценено/);
    // ⚠️ Nothing links anywhere: there is no profile page and no main-site slug.
    expect(within(block).queryAllByRole("link")).toHaveLength(0);
  });

  it("says a scoped alias in words, never as a raw scope string", async () => {
    const a = withIdentities();
    a.news_persons![0].alias_scope = "case:petrohan";
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    const block = await screen.findByTestId("news-persons");
    expect(
      within(block).getByText(/в рамките на казуса petrohan/),
    ).toBeVisible();
    expect(block.textContent).not.toMatch(/case:petrohan/);
    cleanup();
    a.news_persons![0].alias_scope = "article:https://a.bg/x";
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    const again = await screen.findByTestId("news-persons");
    expect(within(again).getByText(/прегледано изключение/)).toBeVisible();
    expect(again.textContent).not.toMatch(/https:\/\/a\.bg\/x/);
  });

  it("renders nothing for a record with no identity decisions", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    await screen.findByText("Делян Пеевски");
    expect(screen.queryByTestId("news-persons")).toBeNull();
  });
});

describe("failure and edges", () => {
  beforeEach(() => vi.resetModules());

  it("does not manufacture a not-applicable verdict when the value is null", async () => {
    const a = analysed() as unknown as Record<string, unknown>;
    (a.leaning as Record<string, unknown>).label = null;
    await renderAt([
      article({ analysis: a } as unknown as Partial<ArticleRecord>),
    ]);
    expect(await screen.findByText("Оценката не е налична")).toBeVisible();
    expect(
      screen.queryByText("Извън политическата ос"),
    ).not.toBeInTheDocument();
  });

  it("survives a label the app has never seen", async () => {
    // ⚠️ The bundle passes rubric labels through VERBATIM, so an
    // unrecognised one is a JSON value away — and a bare META[label].label
    // throws, which in a component with no error boundary WHITE-SCREENS the
    // whole app.
    const a = analysed() as unknown as Record<string, unknown>;
    (a.leaning as Record<string, unknown>).label = "wildly_unexpected";
    (a.ai_generated as Record<string, unknown>).verdict = "who_knows";
    (a.quality as Record<string, unknown>).verdict = "brand_new_verdict";
    await renderAt([
      article({ analysis: a } as unknown as Partial<ArticleRecord>),
    ]);
    // renders, and still shows the evidence rather than blowing up
    expect(
      await screen.findByText(/Материалът представя и двете страни/),
    ).toBeVisible();
    expect(screen.getByText("Оценката не е налична")).toBeVisible();
  });

  it("says so when the article is not in the corpus", async () => {
    await renderAt([article()], { id: "missing" });
    expect(await screen.findByText(/не е намерена/)).toBeVisible();
  });

  it("marks a retired outlet as retired", async () => {
    await renderAt(
      [article({ analysis: analysed() } as Partial<ArticleRecord>)],
      {
        outlets: [outlet({ retired: true, retired_reason: "bot_refused" })],
      },
    );
    expect(await screen.findByText("оттеглен източник")).toBeVisible();
  });

  it("shows an edit after publication", async () => {
    await renderAt([article({ updated: "2026-08-22T16:40:00+00:00" })]);
    expect(await screen.findByText(/редактирана/)).toBeVisible();
  });

  it("does not claim an edit when updated equals published", async () => {
    await renderAt([article({ updated: "2026-08-22T09:00:00+00:00" })]);
    await screen.findByText(/Прочети в/);
    expect(screen.queryByText(/редактирана/)).not.toBeInTheDocument();
  });

  it("says 'без дата' rather than rendering an empty time", async () => {
    await renderAt([article({ published: null })]);
    expect(await screen.findByText("без дата")).toBeVisible();
  });
});

describe("ArticleScreen story siblings", () => {
  // ⚠️ THIS PATH HAD NO COVERAGE AT ALL. The suite mocked `useStories` and
  // fed it `opts.stories`, but every fixture article carried
  // `story_id: null`, so the sibling list never rendered and the mock was
  // inert — it kept passing when the component stopped calling that hook
  // entirely, which is exactly how a fetch change can go unnoticed.
  it("lists the other articles in the story, from the detail file", async () => {
    const story = {
      id: "s1",
      title_bg: "Историята",
      aggregates: { outlet_count: 2, article_count: 2 },
      members: [
        {
          article_id: "a1",
          domain: "ex.bg",
          url: "https://ex.bg/a/1",
          title: "Правителството отложи решението",
        },
        {
          article_id: "a2",
          domain: "two.bg",
          url: "https://two.bg/a/2",
          title: "Съседна публикация",
        },
      ],
    } as unknown as Story;
    await renderAt([article({ story_id: "s1" } as Partial<ArticleRecord>)], {
      stories: [story],
    });
    expect(await screen.findByText("Съседна публикация")).toBeVisible();
  });

  it("asks for nothing when the article is in no story", async () => {
    await renderAt([article()], { stories: [] });
    expect(await screen.findByRole("heading", { level: 1 })).toBeVisible();
    expect(screen.queryByText("Съседна публикация")).toBeNull();
  });
});
