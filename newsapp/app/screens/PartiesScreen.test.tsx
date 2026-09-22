// T4.2 — the party index. ⚠️ Assertions about what it may CLAIM: an archive
// ordered by coverage with a denominator per row, the two omissions printed
// rather than implied, and never a link to an id the router cannot serve.

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartyIndex } from "../data";

const index = (patch: Partial<PartyIndex> = {}): PartyIndex => ({
  version: 1,
  generated_at: "2026-09-22T00:00:00Z",
  rubric_version: "news-article-evaluation-v1",
  parties: [
    {
      party_id: "gerb",
      name: "ГЕРБ",
      counts: { favorable: 0, neutral: 3, unfavorable: 1, mixed: 0 },
      assessed: 4,
      article_count: 4,
      outlet_count: 2,
      first_published: "2026-09-01T00:00:00Z",
      last_published: "2026-09-20T00:00:00Z",
      undated: 1,
    },
    {
      party_id: "bsp",
      name: "БСП",
      counts: { favorable: 1, neutral: 0, unfavorable: 0, mixed: 0 },
      assessed: 1,
      article_count: 1,
      outlet_count: 1,
      first_published: null,
      last_published: null,
      undated: 1,
    },
  ],
  unresolved_surfaces: [
    { surface: "Възраждане", pairs: 9, basis: "refused" },
    { surface: "ХДС", pairs: 4, basis: "unknown" },
  ],
  unresolved_surface_count: 2,
  unresolved_pairs: 13,
  unresolved_refused_pairs: 9,
  unresolved_unknown_pairs: 4,
  refused_id_pairs: 0,
  duplicate_pairs: 2,
  scoped_out_pairs: 7,
  ...patch,
});

const renderIndex = async (
  data: PartyIndex | null,
  error: Error | null = null,
) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useParties: () => ({ data, error, loading: false }),
  }));
  const { PartiesScreen } = await import("./PartiesScreen");
  render(
    <MemoryRouter>
      <PartiesScreen />
    </MemoryRouter>,
  );
};

describe("PartiesScreen", () => {
  afterEach(cleanup);

  it("orders by coverage, prints each denominator, and states both omissions", async () => {
    await renderIndex(index());
    const links = screen.getAllByRole("link");
    // ⚠️ COVERAGE ORDER, never favourability: БСП is the only favourable
    // party and is second, because it has one assessment against four.
    expect(links.map((l) => l.textContent)).toEqual(["ГЕРБ", "БСП"]);
    expect(links[0]).toHaveAttribute("href", "/party/gerb");
    expect(screen.getByText(/4 оценки · 4 статии · 2 медии/)).toBeVisible();
    // Plural forms, not „1 оценки".
    expect(screen.getByText(/1 оценка · 1 статия · 1 медия/)).toBeVisible();
    // A party with no dated article says so rather than rendering „— – —".
    expect(
      screen.getByText(/без дати на публикуване · 1 без дата/),
    ).toBeVisible();
    // The omissions, split by what the registry actually knows.
    const unresolved = screen.getByTestId("parties-unresolved");
    expect(unresolved).toHaveTextContent(
      "13 оценки са за имена без самоличност",
    );
    expect(unresolved).toHaveTextContent("9 за имена, които регистърът знае");
    expect(unresolved).toHaveTextContent("4 за партии извън обхвата му");
    expect(screen.getByText(/2 оценки са втори изписвания/)).toBeVisible();
    expect(
      screen.getByText(
        /7 оценки са от материали, които моделът не е прочел изцяло/,
      ),
    ).toBeVisible();
    // An archive, not a ranking — and no score anywhere.
    expect(
      screen.getByText(/не по благоприятност, и никоя не получава оценка/),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /рейтинг|класация на|score|rating/i,
    );
  });

  it("never links an id the router cannot serve", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: the writer's id refusal not mirrored on
    // the client — a row whose link 404s.
    await renderIndex(
      index({
        parties: [
          {
            ...index().parties[0],
            party_id: "../etc",
          },
        ],
      }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("ГЕРБ")).toBeVisible();
  });

  it("says so when nothing is published, and when the archive fails", async () => {
    await renderIndex(index({ parties: [] }));
    expect(
      screen.getByText("Няма публикувани оценки за партии."),
    ).toBeVisible();
    cleanup();
    await renderIndex(null, new Error("offline"));
    expect(screen.getByText(/Архивът не се зареди/)).toBeVisible();
  });
});
