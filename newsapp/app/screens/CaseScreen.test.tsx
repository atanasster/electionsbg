import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CasePayload } from "../data";

const payload = (patch: Partial<CasePayload> = {}): CasePayload => ({
  generated_at: "2026-09-22T00:00:00Z",
  slug: "petrohan",
  name: { bg: "Казусът „Петрохан“", en: "The Petrohan case" },
  opened_on: "2026-02-13",
  membership: "attached",
  story_count: 1,
  article_count: 2,
  first_published: "2026-09-20T00:00:00Z",
  last_published: "2026-09-21T00:00:00Z",
  outlets: { "a.bg": 2 },
  rule_version: 1,
  reviewer: "plan author",
  reviewed_on: "2026-09-22",
  description: { bg: "Описание на казуса.", en: "Case description." },
  sources: [
    {
      claim: { bg: "Твърдение.", en: "A claim." },
      url: "https://a.bg/src",
      domain: "a.bg",
      published: "2026-09-20",
    },
  ],
  contested: [
    {
      claim: { bg: "Сандов е обвинен.", en: "Sandov is charged." },
      speaker: { bg: "прокуратурата", en: "the prosecution" },
      date: "2026-09-19",
      source_url: "https://a.bg/c",
      response: {
        bg: "Сандов: няма връчена призовка.",
        en: "Sandov: no summons served.",
      },
      response_source_url: "https://a.bg/r",
    },
  ],
  rule: {
    basis: { bg: "основа", en: "basis" },
    required_terms: ["петрохан"],
    context_terms: ["прокуратур"],
    excluded_terms: [],
  },
  namesakes: [
    {
      name: "Калушев",
      note: { bg: "Повече от едно лице.", en: "More than one." },
    },
  ],
  ambiguous_match: "review",
  history: [],
  editorial_note: {
    bg: "Включването е редакционен подбор.",
    en: "Inclusion is an editorial selection.",
  },
  verification: { ok: true, reason: null, checked: 8, failed: [] },
  timeline: [
    {
      story_id: "20260920-aaaa1111",
      title_bg: "Делото Петрохан",
      title_en: "The Petrohan case file",
      first_published: "2026-09-20T00:00:00Z",
      last_published: "2026-09-21T00:00:00Z",
      topics: [{ category: "judiciary", subcategory: null, primary: true }],
      outlets: ["a.bg"],
      supporting: [
        {
          article_id: "x",
          domain: "a.bg",
          url: "https://a.bg/x",
          published: "2026-09-20T00:00:00Z",
          evidence: {
            basis: "rule",
            rule_version: 1,
            terms: ["петрохан"],
            context: ["прокуратур"],
            hits: 3,
          },
        },
      ],
      member_count: 2,
    },
  ],
  framing: {
    by_leaning: { neutral: 2 },
    by_russia_stance: { not_applicable: 2 },
    rated: 2,
    articles: 2,
  },
  ...patch,
});

const renderCase = async (
  data: CasePayload | null,
  error: Error | null = null,
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useCase: () => ({ data, error, loading: false }),
    useOutlets: () => ({
      data: { generated_at: "", outlets: [{ domain: "a.bg", outlet: "А" }] },
      error: null,
      loading: false,
    }),
    useTaxonomy: () => ({
      data: { version: 2, categories: [] },
      error: null,
      loading: false,
    }),
  }));
  const { CaseScreen } = await import("./CaseScreen");
  render(
    <MemoryRouter initialEntries={["/case/petrohan"]}>
      <Routes>
        <Route path="/case/:slug" element={<CaseScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => vi.resetModules());

describe("a case page", () => {
  it("states that inclusion is editorial before anything else, and sources every claim", async () => {
    await renderCase(payload());
    expect(
      screen.getByRole("heading", { level: 1, name: "Казусът „Петрохан“" }),
    ).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("редакционен подбор");
    expect(screen.getByText("Твърдение.")).toBeVisible();
    expect(screen.getByRole("link", { name: "a.bg" })).toHaveAttribute(
      "href",
      "https://a.bg/src",
    );
    // The contested claim carries speaker, date, source AND the response.
    expect(screen.getByText(/Сандов е обвинен\./)).toBeVisible();
    expect(screen.getByText(/Сандов: няма връчена призовка\./)).toBeVisible();
  });

  it("renders the timeline with the evidence and denominators beside the framing", async () => {
    await renderCase(payload());
    expect(
      screen.getByRole("link", { name: "Делото Петрохан" }),
    ).toHaveAttribute("href", "/story/20260920-aaaa1111");
    expect(screen.getByText(/основание: петрохан, прокуратур/)).toBeVisible();
    expect(screen.getByText(/1 от 2 материала/)).toBeVisible();
    expect(screen.getByText(/2 оценени от 2 статии в казуса/)).toBeVisible();
    expect(screen.getByRole("link", { name: "А" })).toHaveAttribute(
      "href",
      "/outlet/a.bg",
    );
  });

  it("says a withheld timeline is not published — never that there is no coverage", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: rendering the empty-timeline copy for
    // a case under review — „no stories" is a claim about the corpus.
    await renderCase(
      payload({
        membership: "review",
        timeline: [],
        story_count: 0,
        verification: {
          ok: false,
          reason: "no_fixtures",
          checked: 0,
          failed: [],
        },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("не се публикува");
    // The reason in words; the enum stays in `title` for a reviewer.
    expect(screen.getByRole("status")).toHaveTextContent(
      "няма проверени примери",
    );
    expect(screen.getByTitle("no_fixtures")).toBeInTheDocument();
    expect(screen.queryByText(/не е намерило истории/)).toBeNull();
    // The description still renders: the registry entry is the page.
    expect(screen.getByText("Описание на казуса.")).toBeVisible();
  });

  it("distinguishes an unregistered slug from a failed load", async () => {
    await renderCase(null);
    expect(screen.getByText(/не отговаря на казус/)).toBeVisible();
    cleanup();
    await renderCase(null, new Error("offline"));
    expect(screen.getByText(/не се зареди: offline/)).toBeVisible();
  });

  it("renders the registry prose in the page language, never English under a Bulgarian heading", async () => {
    await renderCase(payload());
    expect(screen.getByText("Твърдение.")).toBeVisible();
    expect(screen.queryByText("A claim.")).toBeNull();
    expect(screen.getByText(/прокуратурата/)).toBeVisible();
    expect(screen.queryByText(/the prosecution/)).toBeNull();
    // The rule sits in a closed <details>: present, in Bulgarian.
    expect(screen.getByText("основа")).toBeInTheDocument();
    expect(screen.queryByText("basis")).toBeNull();
    expect(screen.getByText(/Повече от едно лице\./)).toBeInTheDocument();
  });

  it("labels a hand-included story rather than printing an empty basis", async () => {
    const p = payload();
    p.timeline[0].supporting[0].evidence = {
      basis: "override",
      rule_version: 1,
      terms: [],
      context: [],
      hits: null,
    };
    await renderCase(p);
    expect(screen.getByText(/основание: ръчно включване/)).toBeVisible();
  });

  it("keeps the term list one click down, behind its own caveat", async () => {
    await renderCase(payload());
    const caveat = screen.getByText(/не са характеристика на лицата/);
    expect(caveat.closest("details")).not.toBeNull();
    expect(caveat.closest("details")).toHaveTextContent("контекст: прокуратур");
  });
});
