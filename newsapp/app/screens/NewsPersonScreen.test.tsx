// T4.4 — the person page. ⚠️ These assertions are about the ACCOUNTING and
// the refusals: N of M with every unassessed category beside it, incidental
// mentions outside M, each row's own status in words, no bridge without a
// verified slug, and no page for an identity nobody activated.

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonPayload } from "../data";

const scope = "full" as const;

const payload = (patch: Partial<PersonPayload> = {}): PersonPayload => ({
  version: 1,
  generated_at: "2026-09-22T00:00:00Z",
  rubric_version: "person-treatment-v1",
  news_person_id: "np_7f3c1a94",
  name_bg: "Ивайло Калушев",
  name_en: "Ivaylo Kalushev",
  disambiguation_bg: "Ръководител на неправителствена организация.",
  disambiguation_en: "Head of a non-governmental organisation.",
  identity_version: "2026-09-22.1:abc",
  reviewed_by: "plan author",
  reviewed_at: "2026-09-22",
  verified_main_site_slug: null,
  counts: { unfavorable: 2, neutral: 1 },
  assessed: 3,
  insufficient_text: 1,
  partial_scope: 1,
  pending: 1,
  refused: 1,
  eligible: 6,
  eligible_deduplicated: 5,
  same_headline_copies: 1,
  incidental: 2,
  unreadable_role: 0,
  outlet_count: 3,
  story_count: 4,
  undated: 1,
  page: 1,
  page_size: 50,
  total_pages: 1,
  first_published: "2026-09-01T00:00:00Z",
  last_published: "2026-09-20T00:00:00Z",
  per_outlet: [
    { domain: "a.bg", counts: { unfavorable: 2 }, assessed: 2, eligible: 3 },
    { domain: "b.bg", counts: { neutral: 1 }, assessed: 1, eligible: 3 },
  ],
  articles: [
    {
      url: "https://a.bg/1",
      domain: "a.bg",
      article_id: "a1",
      title: "Обвинение по Петрохан",
      published: "2026-09-20T00:00:00Z",
      story_id: "s1",
      eligible: true,
      subject_role: "primary",
      assessment_status: "assessed",
      tone: "unfavorable",
      rationale: "Материалът го представя като обвиняем без отговор.",
      evidence_spans: [
        {
          quote: "обвини Калушев",
          field: "body",
          direction: "unfavorable",
          voice: "journalist",
          located: true,
        },
      ],
      text_scope: scope,
      rubric_version: "person-treatment-v1",
      identity_version: "2026-09-22.1:abc",
    },
    {
      url: "https://b.bg/2",
      domain: "b.bg",
      article_id: "b2",
      title: "Фестивал в Кюстендил",
      published: "2026-09-10T00:00:00Z",
      story_id: "s2",
      eligible: false,
      subject_role: "incidental",
      assessment_status: "not_assessed",
      tone: null,
      rationale: null,
      evidence_spans: [],
      text_scope: scope,
      rubric_version: "person-treatment-v1",
      identity_version: "2026-09-22.1:abc",
    },
    {
      url: "https://c.bg/3",
      domain: "c.bg",
      article_id: "c3",
      title: "Дълъг анализ",
      published: "2026-09-05T00:00:00Z",
      story_id: "s3",
      eligible: true,
      subject_role: "secondary",
      assessment_status: "insufficient_text",
      tone: null,
      rationale: "Материалът не е прочетен изцяло.",
      evidence_spans: [],
      text_scope: "prefix",
      rubric_version: "person-treatment-v1",
      identity_version: "2026-09-22.1:abc",
    },
  ],
  ...patch,
});

// `vi.doMock`'s factory is hoisted, so the map it reads must be too.
const { retired } = vi.hoisted(() => ({
  retired: { current: {} as Record<string, string> },
}));

const renderPerson = async (
  data: PersonPayload | null,
  error: Error | null = null,
  path = "/person/np_7f3c1a94",
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useNewsPerson: () => ({ data, error, loading: false }),
    useNewsPersons: () => ({
      data: { generated_at: "", persons: [], retired_ids: retired.current },
      error: null,
      loading: false,
    }),
  }));
  const { NewsPersonScreen } = await import("./NewsPersonScreen");
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/person/:newsPersonId" element={<NewsPersonScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("NewsPersonScreen", () => {
  afterEach(() => {
    cleanup();
    retired.current = {};
  });

  it("states N of M with every unassessed category, and keeps incidental mentions outside M", async () => {
    await renderPerson(payload());
    const accounting = screen.getByTestId("person-accounting");
    expect(accounting).toHaveTextContent(
      "Оценени 3 от 6 двойки (лице, материал)",
    );
    // ⚠️ The parts must be visible and must add up: 3 + 1 + 1 + 1 = 6.
    expect(accounting).toHaveTextContent(
      "1 без преценка, защото материалът не е прочетен изцяло",
    );
    expect(accounting).toHaveTextContent("1 още не са оценявани");
    expect(accounting).toHaveTextContent(
      "1 без достатъчно доказателство в текста",
    );
    // ⚠️ THE MUTATION THIS CATCHES: incidental mentions folded into the
    // denominator instead of reported beside it.
    expect(accounting).toHaveTextContent(
      "2 споменавания мимоходом — извън знаменателя",
    );
    expect(accounting).toHaveTextContent("3 медии");
    expect(accounting).toHaveTextContent("4 събития");
    // ⚠️ Rows with no date are counted, so the window beside them cannot read
    // as covering every row.
    expect(screen.getByTestId("person-undated")).toHaveTextContent(
      "1 материала без дата — извън прозореца по-горе.",
    );
    // Raw AND deduplicated, neither replacing the other.
    expect(screen.getByTestId("person-dedup")).toHaveTextContent(
      "1 от тях са същото заглавие в друга медия; без тях знаменателят е 5.",
    );
    // Each outlet with its own distribution, never one inferred tone.
    const outlets = screen.getByTestId("person-per-outlet");
    expect(outlets).toHaveTextContent("2 оценени от 3");
    expect(outlets).toHaveTextContent(
      "Всяко издание със собственото си разпределение",
    );
  });

  it("says each row's own status, and never a forced sentiment for an incidental mention", async () => {
    await renderPerson(payload());
    const incidental = screen
      .getByText("Фестивал в Кюстендил")
      .closest("article")!;
    expect(incidental).toHaveTextContent(
      "само споменаване — без наложена оценка",
    );
    expect(incidental).not.toHaveTextContent(/негативен|позитивен|неутрален/);
    const partial = screen.getByText("Дълъг анализ").closest("article")!;
    expect(partial).toHaveTextContent(
      "материалът не е прочетен изцяло — няма преценка",
    );
    const assessed = screen
      .getByText("Обвинение по Петрохан")
      .closest("article")!;
    expect(assessed).toHaveTextContent("представяне в материала: негативен");
    expect(within(assessed).getByText("обвини Калушев")).toBeVisible();
    expect(
      within(assessed).getByRole("link", { name: /оригиналът/ }),
    ).toHaveAttribute("href", "https://a.bg/1");
  });

  it("refuses a tone that arrives beside a non-assessed status", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: keying the label on `row.tone` alone. The
    // producer drops this shape, which is precisely why the client must not
    // depend on it having done so — the result would be a negative framing
    // label about a named person, in no count, resting on no evidence.
    const rows = payload().articles.map((r) =>
      r.eligible ? r : { ...r, tone: "unfavorable" as const },
    );
    await renderPerson(payload({ articles: rows }));
    const incidental = screen
      .getByText("Фестивал в Кюстендил")
      .closest("article")!;
    expect(incidental).toHaveTextContent(
      "само споменаване — без наложена оценка",
    );
    expect(incidental).not.toHaveTextContent("представяне в материала");
  });

  it("splits partial-scope from insufficient text and counts the pages", async () => {
    await renderPerson(
      payload({
        insufficient_text: 3,
        partial_scope: 1,
        assessed: 3,
        pending: 1,
        refused: 1,
        eligible: 8,
        total_pages: 2,
      }),
    );
    const accounting = screen.getByTestId("person-accounting");
    // 3 assessed + 1 partial + 2 insufficient + 1 pending + 1 refused = 8.
    expect(accounting).toHaveTextContent(
      "1 без преценка, защото материалът не е прочетен изцяло",
    );
    expect(accounting).toHaveTextContent(
      "2 без преценка, защото в текста няма достатъчно за оценка",
    );
    // ⚠️ The accounting is over ALL pages, and the pager says so — a page
    // must never read as the whole denominator.
    expect(screen.getByTestId("person-pages")).toHaveTextContent(
      "Страница 1 от 2 · всички 8 двойки са в отчета по-горе",
    );
  });

  it("carries the versions, the reviewer, the policy and a correction link — and no unverified bridge", async () => {
    await renderPerson(payload());
    expect(screen.getByText(/person-treatment-v1/)).toBeVisible();
    expect(screen.getByText(/самоличност: 2026-09-22.1:abc/)).toBeVisible();
    expect(screen.getByText(/прегледал: plan author/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Сигнал за поправка за това лице/ }),
    ).toHaveAttribute("href", expect.stringContaining("person%2Fnp_7f3c1a94"));
    // The policy the page says it follows is one click away FROM the page.
    expect(
      screen.getByRole("link", { name: "news-person-policy-v1" }),
    ).toHaveAttribute("href", "/methodology#person-pages");
    // ⚠️ THE MUTATION THIS CATCHES: a guessed main-site link for a generic
    // news person — a dead link on another origin.
    expect(screen.queryByRole("link", { name: /Профил в Наясно/ })).toBeNull();
    expect(
      screen.getByText(/Няма проверена връзка към профил в основния сайт/),
    ).toBeVisible();
    cleanup();
    await renderPerson(
      payload({ verified_main_site_slug: "ivaylo-kalushev-ab12" }),
    );
    expect(
      screen.getByRole("link", { name: /Профил в Наясно/ }),
    ).toHaveAttribute("href", "https://naiasno.bg/person/ivaylo-kalushev-ab12");
    // ⚠️ THE MUTATION THIS CATCHES: a slug interpolated into a URL path with
    // no charset check — „../x" or „a?b" silently retargets the link.
    cleanup();
    await renderPerson(payload({ verified_main_site_slug: "../evil" }));
    expect(screen.queryByRole("link", { name: /Профил в Наясно/ })).toBeNull();
  });

  it("says an unactivated or unknown identity has no page", async () => {
    await renderPerson(null, new Error("404"));
    expect(
      screen.getByRole("heading", { name: "Лицето не е намерено" }),
    ).toBeVisible();
    expect(screen.getByText(/Споменаването не създава страница/)).toBeVisible();
    cleanup();
    // An id the charset refuses must not load for ever either.
    await renderPerson(payload(), null, "/person/..%2Fetc");
    expect(
      screen.getByRole("heading", { name: "Лицето не е намерено" }),
    ).toBeVisible();
  });
});
