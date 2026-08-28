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

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord, Outlet, Story } from "../data";

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

const renderAt = async (
  articles: ArticleRecord[],
  opts: { outlets?: Outlet[]; stories?: Story[]; id?: string } = {},
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useOutletArticles: () => ({
      data: { domain: "ex.bg", outlet: "Примерен вестник", articles },
      error: null,
      loading: false,
    }),
    useOutlets: () => ({
      data: { generated_at: "", outlets: opts.outlets ?? [outlet()] },
      error: null,
      loading: false,
    }),
    useStories: () => ({
      data: { generated_at: "", stories: opts.stories ?? [] },
      error: null,
      loading: false,
    }),
    useTaxonomy: () => ({
      data: { version: 1, categories: [] },
      error: null,
      loading: false,
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

  it("renders the confidence beside the verdict", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    expect(await screen.findByText("увереност 0.7")).toBeVisible();
    expect(screen.getByText("увереност 0.9")).toBeVisible();
  });

  it("SAYS SO when an axis carries no quoted sentence", async () => {
    // A verdict whose evidence silently vanishes is the unsupported claim
    // this page exists to avoid making.
    const a = analysed();
    a.leaning!.evidence = "";
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    expect(await screen.findByText(/не е цитирал изречение/)).toBeVisible();
  });
});

describe("the outbound link", () => {
  beforeEach(() => vi.resetModules());

  it("points at the outlet and opens externally", async () => {
    await renderAt([
      article({ analysis: analysed() } as Partial<ArticleRecord>),
    ]);
    const link = (
      await screen.findByText(/Прочети в Примерен вестник/)
    ).closest("a");
    expect(link).toHaveAttribute("href", "https://ex.bg/a/1");
    expect(link).toHaveAttribute("target", "_blank");
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
  });
});

describe("the unanalysed state", () => {
  beforeEach(() => vi.resetModules());

  it("renders NO axis badges", async () => {
    // ⚠️ At 8.4% analysed this is the common case, and it must read as "not
    // yet judged" — never as "judged neutral", which an empty badge row says.
    await renderAt([article()]);
    expect(await screen.findByText(/още не е анализирана/)).toBeVisible();
    expect(screen.queryByText("увереност 0.7")).not.toBeInTheDocument();
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
        href: "https://electionsbg.com/person/mp-3931",
      },
    };
    await renderAt([article({ analysis: a } as Partial<ArticleRecord>)]);
    const link = await screen.findByRole("link", { name: /Иван Христанов/ });
    expect(link).toHaveAttribute(
      "href",
      "https://electionsbg.com/person/mp-3931",
    );
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
