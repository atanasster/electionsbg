import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonIndexRow } from "../data";

const row = (id: string, name: string, cell: number[] | null): PersonIndexRow =>
  ({
    id,
    kind: "person",
    name_bg: name,
    name_en: null,
    n: 50,
    counts: {},
    by_outlet: cell ? { "pik.bg": cell } : {},
  }) as unknown as PersonIndexRow;

const draw = async (persons: PersonIndexRow[], matrix = false) => {
  vi.resetModules();
  vi.doMock("../data", async (orig) => ({
    ...(await orig<typeof import("../data")>()),
    usePersonsIndex: () => ({
      data: { generated_at: "", default_basis: "story", matrix, persons },
      error: null,
      loading: false,
    }),
  }));
  const { OutletPeople } = await import("./OutletPeople");
  render(
    <MemoryRouter>
      <OutletPeople domain="pik.bg" />
    </MemoryRouter>,
  );
};

afterEach(cleanup);

describe("OutletPeople", () => {
  it("lists this outlet's people by ITS coverage, linked to the filtered page", async () => {
    await draw([
      row("mp-1", "Бойко Борисов", [2, 0, 2, 0, 0, 0]),
      row("mp-2", "Илияна Йотова", [5, 0, 1, 4, 0, 0]),
      row("mp-3", "Никой Тук", null),
    ]);
    const list = screen.getByTestId("outlet-people");
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Илияна Йотова",
      "Бойко Борисов",
    ]);
    expect(links[0]).toHaveAttribute("href", "/person/mp-2?outlet=pik.bg");
    // Per person only — no figure for the outlet as a whole.
    expect(list.textContent).not.toMatch(/\d\.\d/);
  });

  it("links the grid only when it is published", async () => {
    await draw([row("mp-1", "Бойко Борисов", [2, 0, 2, 0, 0, 0])], true);
    expect(
      screen.getByRole("link", { name: /Медиите и хората/ }),
    ).toBeInTheDocument();
  });

  it("renders nothing when the outlet covered nobody with a page", async () => {
    await draw([row("mp-3", "Никой Тук", null)]);
    expect(screen.queryByTestId("outlet-people")).toBeNull();
  });
});
