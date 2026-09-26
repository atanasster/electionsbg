// `/persons` — a table, not a leaderboard. ⚠️ The assertions here are the
// refusals: no mean anywhere, no sort by tone, and an outlet filter that
// redraws each row for that outlet alone.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonIndexRow } from "../data";

const counts = (u: number, n: number, f: number) => ({
  strongly_unfavorable: 0,
  unfavorable: u,
  neutral: n,
  favorable: f,
  strongly_favorable: 0,
});

const row = (
  id: string,
  name: string,
  n: number,
  patch: Partial<PersonIndexRow> = {},
): PersonIndexRow => ({
  id,
  kind: "person",
  name_bg: name,
  name_en: null,
  role: "mp",
  role_label: { bg: "Народен представител", en: "Member of Parliament" },
  party: null,
  n,
  counts: counts(1, n - 1, 0),
  eligible: n,
  outlet_count: 2,
  last_published: "2026-09-20T00:00:00Z",
  by_outlet: { "pik.bg": [1, 0, 1, 0, 0, 0] },
  ...patch,
});

const draw = async (persons: PersonIndexRow[] | null) => {
  vi.resetModules();
  vi.doMock("../data", async (orig) => ({
    ...(await orig<typeof import("../data")>()),
    usePersonsIndex: () =>
      persons
        ? {
            data: {
              generated_at: "2026-09-27T00:00:00Z",
              default_basis: "story",
              persons,
              retired_ids: {},
            },
            error: null,
            loading: false,
          }
        : { data: null, error: new Error("404"), loading: false },
    useParties: () => ({ data: { parties: [] }, error: null, loading: false }),
  }));
  const { PersonsScreen } = await import("./PersonsScreen");
  render(
    <MemoryRouter>
      <PersonsScreen />
    </MemoryRouter>,
  );
};

afterEach(cleanup);

describe("PersonsScreen", () => {
  it("lists people by coverage with their office, and no mean anywhere", async () => {
    await draw([
      row("mp-1", "Бойко Борисов", 3),
      row("mp-2", "Илияна Йотова", 9),
    ]);
    const table = screen.getByTestId("persons-table");
    const names = within(table)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["Илияна Йотова", "Бойко Борисов"]);
    expect(table.textContent).toContain("Народен представител");
    expect(table.textContent).not.toMatch(/средн|mean|\d\.\d/i);
  });

  it("offers no sort by tone", async () => {
    await draw([row("mp-1", "Бойко Борисов", 3)]);
    const sort = screen.getByRole("button", { name: "Подреждане" });
    expect(sort.textContent).toContain("по обем");
    // The header says why there is none.
    expect(document.body.textContent).toContain("никога по тон");
    expect(sort.textContent).not.toMatch(/тон|tone/);
  });

  it("finds a person typed in Latin", async () => {
    await draw([
      row("mp-1", "Бойко Борисов", 3),
      row("mp-2", "Илияна Йотова", 9),
    ]);
    fireEvent.change(screen.getByRole("textbox", { name: "Търсене по име" }), {
      target: { value: "yotova" },
    });
    const links = within(screen.getByTestId("persons-table")).getAllByRole(
      "link",
    );
    expect(links.map((a) => a.textContent)).toEqual(["Илияна Йотова"]);
  });

  it("the outlet filter redraws each row for that outlet alone", async () => {
    vi.resetModules();
    const { rowFigures } = await import("../personPage");
    const r = row("mp-1", "Бойко Борисов", 9, {
      by_outlet: { "pik.bg": [2, 0, 2, 0, 0, 0] },
    });
    expect(rowFigures(r, "pik.bg").n).toBe(2);
    expect(rowFigures(r, "pik.bg").counts.unfavorable).toBe(2);
  });

  it("says plainly when the pages are not published", async () => {
    await draw(null);
    expect(
      screen.getByText("Страниците за хора още не са публикувани."),
    ).toBeInTheDocument();
  });
});
