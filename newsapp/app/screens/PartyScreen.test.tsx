// T4.2 — the party page is an ARCHIVE FILTER. These assertions are about
// what it may CLAIM: a distribution with its denominator, one row per
// article with the located evidence, no score anywhere, and no page at all
// for an id the archive does not carry.

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartyPayload } from "../data";

const payload = (patch: Partial<PartyPayload> = {}): PartyPayload => ({
  version: 1,
  generated_at: "2026-09-22T00:00:00Z",
  rubric_version: "news-article-evaluation-v1",
  party_id: "gerb",
  name: "ГЕРБ",
  names_seen: ["ГЕРБ", "ГЕРБ-СДС"],
  counts: { favorable: 1, neutral: 2, unfavorable: 1, mixed: 0 },
  assessed: 4,
  article_count: 4,
  outlet_count: 3,
  first_published: "2026-09-01T00:00:00Z",
  last_published: "2026-09-20T00:00:00Z",
  undated: 0,
  page: 1,
  page_size: 50,
  total_pages: 1,
  articles: [
    {
      url: "https://a.bg/1",
      domain: "a.bg",
      article_id: "a1",
      title: "Заглавие едно",
      published: "2026-09-20T00:00:00Z",
      story_id: "20260920-aaaa1111",
      tone: "unfavorable",
      rationale: "Материалът рамкира партията като отговорна за забавянето.",
      evidence_spans: [
        {
          quote: "партията отложи гласуването",
          field: "body",
          direction: "unfavorable",
          voice: "journalist",
          located: true,
        },
        {
          quote: "този цитат липсва",
          field: "body",
          direction: "unfavorable",
          voice: "quoted_speaker",
          speaker: "опонент",
          located: false,
        },
      ],
    },
  ],
  ...patch,
});

const renderParty = async (
  data: PartyPayload | null,
  error: Error | null = null,
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useParty: () => ({ data, error, loading: false }),
  }));
  const { PartyScreen } = await import("./PartyScreen");
  render(
    <MemoryRouter initialEntries={["/party/gerb"]}>
      <Routes>
        <Route path="/party/:id" element={<PartyScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("PartyScreen", () => {
  afterEach(cleanup);

  it("shows the distribution with its denominators, every article and its located evidence", async () => {
    await renderParty(payload());
    expect(screen.getByRole("heading", { name: "ГЕРБ" })).toBeVisible();
    expect(screen.getByText(/4 оценки в 4 статии от 3 медии/)).toBeVisible();
    // The bar labels every colour in words, with its count.
    expect(screen.getByText(/позитивен 1/)).toBeVisible();
    expect(screen.getByText(/неутрален 2/)).toBeVisible();
    expect(screen.getByText(/негативен 1/)).toBeVisible();
    // The row: the article, the model's rationale, the located quote, and the
    // unlocated one struck through and named as such.
    expect(screen.getByRole("link", { name: "Заглавие едно" })).toHaveAttribute(
      "href",
      "/article/a.bg/a1",
    );
    expect(
      screen.getByText(
        "Материалът рамкира партията като отговорна за забавянето.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("партията отложи гласуването").closest("s"),
    ).toBeNull();
    expect(screen.getByText("този цитат липсва").closest("s")).not.toBeNull();
    expect(
      screen.getByText(/цитиран: опонент · не е намерен в текста/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /историята/ })).toHaveAttribute(
      "href",
      "/story/20260920-aaaa1111",
    );
    // ⚠️ AN ARCHIVE, NOT A SCOREBOARD: the page states that in words and
    // carries no score, average or rank for the party.
    expect(
      screen.getByText(/не оценка на партията и не класация между партии/),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /резултат|рейтинг|класиране|score|rating/i,
    );
  });

  it("says a party with no archive has no page", async () => {
    await renderParty(null, new Error("404"));
    expect(
      screen.getByRole("heading", { name: "Партията не е намерена" }),
    ).toBeVisible();
    // ⚠️ THE MUTATION THIS CATCHES: offering a page for a surface the
    // registry cannot resolve — a name is not an identity.
    expect(
      screen.getByText(/регистърът свързва еднозначно с една самоличност/),
    ).toBeVisible();
  });

  it("says so when a party has no published assessments", async () => {
    await renderParty(
      payload({
        counts: { favorable: 0, neutral: 0, unfavorable: 0, mixed: 0 },
        assessed: 0,
        articles: [],
      }),
    );
    expect(screen.getByText("Няма публикувани оценки.")).toBeVisible();
  });
});

// ⚠️ THE MUTATION THIS CATCHES (the critical finding): the charset guard
// after the error branch, so an id the router cannot serve renders a
// skeleton for ever instead of the „not found" card.
describe("PartyScreen with an unserveable id", () => {
  afterEach(cleanup);

  it("says there is no such party rather than loading for ever", async () => {
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../data")>();
      return {
        ...actual,
        // The real hook's behaviour for a null path: nothing is requested.
        useParty: (id: string | null | undefined, page = 1) =>
          actual.partyPayloadPath(id, page) === null
            ? { data: null, error: null, loading: false }
            : { data: payload(), error: null, loading: false },
      };
    });
    const { PartyScreen } = await import("./PartyScreen");
    render(
      <MemoryRouter initialEntries={["/party/..%2Fetc"]}>
        <Routes>
          <Route path="/party/:id" element={<PartyScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Партията не е намерена" }),
    ).toBeVisible();
  });
});
