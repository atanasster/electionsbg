// The person page (news-person-sentiment-v1 §6.1). ⚠️ These assertions are
// about the BASIS and the refusals: every figure carries its n and switching
// the basis moves it; the accounting adds up; a former office is never shown
// as current; a filter covers every article, not one page; a retired slug
// redirects; and there is no page for someone the guard did not publish.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PersonArticleRow,
  PersonBasisSummary,
  PersonPayload,
} from "../data";

const counts = (u = 0, n = 0, f = 0) => ({
  strongly_unfavorable: 0,
  unfavorable: u,
  neutral: n,
  favorable: f,
  strongly_favorable: 0,
});

const summary = (
  n: number,
  mean: number,
  patch: Partial<PersonBasisSummary> = {},
): PersonBasisSummary => ({
  n,
  counts: counts(Math.round(n / 3), n - Math.round(n / 3)),
  mean,
  se: 0.1,
  ci_low: mean - 0.2,
  ci_high: mean + 0.2,
  mean_bucket: "neutral",
  ...patch,
});

const row = (
  i: number,
  patch: Partial<PersonArticleRow> = {},
): PersonArticleRow => ({
  url: `https://a.bg/${i}`,
  domain: i % 2 ? "a.bg" : "b.bg",
  article_id: `x${i}`,
  title: `Материал ${i}`,
  published: "2026-09-10T10:00:00+00:00",
  story_id: `s${i}`,
  surface: "Радев",
  merged_surfaces: [],
  subject_role: "primary",
  status: "assessed",
  value: -0.8,
  levels: 5,
  bucket: "unfavorable",
  basis: "exact",
  form_kind: "two_part",
  identity_version: "iv",
  ...patch,
});

const payload = (patch: Partial<PersonPayload> = {}): PersonPayload => ({
  version: 2,
  generated_at: "2026-09-27T00:00:00Z",
  rubric_version: "jev-sentiment-v1",
  id: "mp-5142",
  kind: "person",
  name_bg: "Румен Георгиев Радев",
  name_en: "Rumen Georgiev Radev",
  main_site_slug: "mp-5142",
  roles: [
    {
      role: "president",
      start: "2022-03-17",
      end: "2026-02-09",
      current: false,
    },
  ],
  role_labels: {
    president: { bg: "Президент / вицепрезидент", en: "President" },
  },
  current_role: null,
  party: null,
  identity_version: "iv",
  accounting: {
    eligible: 12,
    assessed: 10,
    insufficient_text: 1,
    pending: 0,
    unplaceable: 0,
    conflict: 1,
    incidental: 4,
    unreadable_role: 0,
    unscored_mentions: 2,
    undated: 0,
  },
  default_basis: "story",
  bases: {
    story: summary(8, -0.2),
    same_headline: summary(9, -0.25),
    raw: summary(10, -0.3),
  },
  raw_counts: counts(3, 7),
  by_outlet: [
    { domain: "a.bg", rows: 6, ...summary(5, -0.1) },
    {
      domain: "b.bg",
      rows: 4,
      ...summary(3, -0.4, {
        mean: null,
        se: null,
        ci_low: null,
        ci_high: null,
        mean_bucket: null,
      }),
      mean_withheld: true,
    },
  ],
  by_role: { primary: summary(6, -0.2), secondary: summary(2, 0.1) },
  series: {
    granularity: "day",
    coverage_floor: 0.8,
    undated: 0,
    points: [
      {
        period: "2026-09-01",
        coverage: 0.6,
        below_floor: true,
        ...summary(3, -0.1),
      },
      {
        period: "2026-09-10",
        coverage: 0.95,
        below_floor: false,
        ...summary(5, -0.3),
      },
    ],
  },
  co_subjects: [{ kind: "person", id: "mp-1588", count: 7 }],
  outlet_count: 2,
  story_count: 8,
  first_published: "2026-09-01T00:00:00Z",
  last_published: "2026-09-26T00:00:00Z",
  page: 1,
  page_size: 50,
  total_pages: 2,
  articles: [row(1), row(2, { status: "conflict", bucket: null, value: null })],
  ...patch,
});

const { retired, allRows } = vi.hoisted(() => ({
  retired: { current: {} as Record<string, string> },
  allRows: {
    current: [] as PersonArticleRow[],
    requested: false,
    fail: false,
  },
}));

const renderPerson = async (
  data: PersonPayload | null,
  error: Error | null = null,
  path = "/person/mp-5142",
) => {
  vi.resetModules();
  allRows.requested = false;
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useNewsPerson: () => ({ data, error, loading: false }),
    useNewsPersons: () => ({
      data: { generated_at: "", persons: [], retired_ids: {} },
      error: null,
      loading: false,
    }),
    usePersonsIndex: () => ({
      data: {
        generated_at: "",
        default_basis: "story",
        persons: [
          {
            id: "mp-1588",
            kind: "person",
            name_bg: "Илияна Малинова Йотова",
            name_en: null,
            role: null,
            party: null,
            n: 1,
            counts: counts(),
            eligible: 1,
            outlet_count: 1,
            last_published: null,
            by_outlet: {},
          },
        ],
        retired_ids: retired.current,
      },
      error: null,
      loading: false,
    }),
    useParties: () => ({
      data: { parties: [{ party_id: "p_20", name: "Прогресивна България" }] },
      error: null,
      loading: false,
    }),
    usePersonAllRows: (_id: string, enabled: boolean) => {
      if (enabled) allRows.requested = true;
      return {
        data:
          enabled && !allRows.fail
            ? { version: 1, id: "mp-5142", articles: allRows.current }
            : null,
        error: enabled && allRows.fail ? new Error("404") : null,
        loading: false,
      };
    },
  }));
  const { NewsPersonScreen } = await import("./NewsPersonScreen");
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/person/:newsPersonId" element={<NewsPersonScreen />} />
        <Route path="/person/mp-5142-live" element={<p>live page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(cleanup);

describe("NewsPersonScreen", () => {
  it("states the basis, and switching it moves n", async () => {
    await renderPerson(payload());
    const kpis = screen.getByTestId("person-kpis");
    expect(within(kpis).getByText("8")).toBeInTheDocument();
    expect(kpis.textContent).toContain(
      "по (издание, история) · 10 от 12 двойки",
    );
    fireEvent.click(screen.getByRole("button", { name: /по материал/ }));
    expect(within(kpis).getByText("10")).toBeInTheDocument();
  });

  it("never calls a former office current", async () => {
    await renderPerson(payload());
    expect(screen.getByTestId("person-office").textContent).toBe(
      "бивш: Президент / вицепрезидент (2022–2026)",
    );
  });

  it("names the party beside the office", async () => {
    await renderPerson(payload({ party: "p_20" }));
    expect(screen.getByTestId("person-office").textContent).toContain(
      "Прогресивна България",
    );
  });

  it("a hand-edited ?tone= is ignored, not an empty archive", async () => {
    await renderPerson(payload(), null, "/person/mp-5142?tone=nonsense");
    expect(screen.queryByTestId("person-filter-count")).toBeNull();
    expect(screen.getByText("Материал 1")).toBeInTheDocument();
  });

  it("says so when every article could not be loaded for a filter", async () => {
    allRows.current = [];
    allRows.fail = true;
    await renderPerson(payload(), null, "/person/mp-5142?outlet=a.bg");
    expect(screen.getByTestId("person-filter-count").textContent).toContain(
      "не можаха да се заредят",
    );
    expect(screen.queryByText("Няма материали.")).toBeNull();
    allRows.fail = false;
  });

  it("the accounting adds up and names everything outside it", async () => {
    await renderPerson(payload());
    const text = screen.getByTestId("person-accounting").textContent!;
    expect(text).toContain("12 двойки");
    expect(text).toContain("10 оценени");
    expect(text).toContain("1 прочетени частично");
    expect(text).toContain("1 с разминаващи се прочитания");
    expect(text).toContain("4 споменавания мимоходом");
    expect(text).toContain("2 в още неоценени статии");
  });

  it("an outlet under five has no mean, and the table is ordered by coverage", async () => {
    await renderPerson(payload());
    const table = screen.getByTestId("person-outlets");
    const cells = within(table).getAllByRole("row").slice(1);
    expect(cells[0].textContent).toContain("a.bg");
    expect(cells[1].textContent).toContain("под 5");
  });

  it("hatches an under-covered period instead of plotting its mean", async () => {
    await renderPerson(payload());
    expect(screen.getAllByTestId("series-hatched")).toHaveLength(1);
    expect(screen.getAllByTestId("series-column")).toHaveLength(1);
  });

  it("a row without a score says why, never a neutral", async () => {
    await renderPerson(payload());
    expect(screen.getByText("разминаващи се прочитания")).toBeInTheDocument();
  });

  it("a filter covers EVERY article, loaded on demand", async () => {
    allRows.current = [row(1), row(3), row(5, { domain: "b.bg" })];
    await renderPerson(payload(), null, "/person/mp-5142?outlet=a.bg");
    expect(allRows.requested).toBe(true);
    expect(screen.getByTestId("person-filter-count").textContent).toContain(
      "2 материала отговарят на филтъра — от всички",
    );
    expect(screen.queryByTestId("person-pages")).toBeNull();
  });

  it("links a co-subject who has a page", async () => {
    await renderPerson(payload());
    expect(
      screen.getByRole("link", { name: "Илияна Малинова Йотова" }),
    ).toHaveAttribute("href", "/person/mp-1588");
  });

  it("a retired slug redirects to its live page", async () => {
    retired.current = { "rumen-georgiev-radev-old": "mp-5142-live" };
    await renderPerson(
      null,
      new Error("404"),
      "/person/rumen-georgiev-radev-old",
    );
    expect(screen.getByText("live page")).toBeInTheDocument();
    retired.current = {};
  });

  it("no page, and says why, for someone the guard did not publish", async () => {
    await renderPerson(null, new Error("404"), "/person/nobody");
    expect(screen.getByText("Няма страница за това лице")).toBeInTheDocument();
  });
});
