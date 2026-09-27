// The outlet × person grid. ⚠️ The refusals: no row or column total of tone,
// blank cells under five units, and a plain message when no period is dense
// enough to read.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixPeriod, PersonMatrix } from "../data";

const counts = {
  strongly_unfavorable: 0,
  unfavorable: 3,
  neutral: 9,
  favorable: 0,
  strongly_favorable: 0,
};

const grid = (offered: boolean): MatrixPeriod => ({
  offered,
  rows: [
    { id: "mp-1", name_bg: "Илияна Йотова", name_en: null, n: 30 },
    { id: "mp-2", name_bg: "Румен Радев", name_en: null, n: 20 },
  ],
  cols: [
    { domain: "a.bg", n: 40 },
    { domain: "b.bg", n: 35 },
  ],
  cells: {
    "mp-1": {
      "a.bg": {
        n: 12,
        counts,
        mean: -0.8,
        mean_bucket: "unfavorable",
        dev: -0.5,
        dev_sign: -1,
      },
      "b.bg": { n: 3, counts },
    },
    "mp-2": {
      "a.bg": {
        n: 12,
        counts,
        mean: 0,
        mean_bucket: "neutral",
        dev: 0.1,
        dev_sign: 0,
      },
    },
  },
  filled_share: 0.5,
  omitted: { people: 7, outlets: 12 },
});

const matrix = (offered: boolean): PersonMatrix => ({
  generated_at: "2026-09-27T00:00:00Z",
  rules: { cell_min_n: 5, hatch_below_n: 10, coverage_floor: 0.8 },
  periods: { "30": grid(false), "90": grid(offered), all: grid(offered) },
});

const draw = async (m: PersonMatrix | null) => {
  vi.resetModules();
  vi.doMock("../data", async (orig) => ({
    ...(await orig<typeof import("../data")>()),
    usePersonMatrix: () =>
      m
        ? { data: m, error: null, loading: false }
        : { data: null, error: new Error("404"), loading: false },
  }));
  const { PersonsMediaScreen } = await import("./PersonsMediaScreen");
  render(
    <MemoryRouter>
      <PersonsMediaScreen />
    </MemoryRouter>,
  );
};

afterEach(cleanup);

describe("PersonsMediaScreen", () => {
  it("draws cells, blanks the thin ones, and says what was left out", async () => {
    await draw(matrix(true));
    const table = within(screen.getByTestId("matrix-grid"));
    expect(table.getAllByTestId("cell-filled")).toHaveLength(2);
    // mp-1 × b.bg has n 3; mp-2 × b.bg is absent — both blank.
    expect(table.getAllByTestId("cell-blank")).toHaveLength(2);
    // The mobile strip lists only outlets the person has units in.
    expect(
      within(screen.getByTestId("matrix-mobile")).queryAllByTestId(
        "cell-blank",
      ),
    ).toHaveLength(1);
    expect(screen.getByTestId("matrix-omitted").textContent).toContain(
      "7 души и 12 издания не са включени",
    );
  });

  it("carries no row or column average", async () => {
    await draw(matrix(true));
    const text = screen.getByTestId("matrix-grid").textContent!;
    expect(text).not.toMatch(/средн|mean|\d\.\d/i);
  });

  it("deviation mode keeps a straddling gap grey", async () => {
    await draw(matrix(true));
    fireEvent.click(screen.getByRole("button", { name: "спрямо обичайното" }));
    const table = within(screen.getByTestId("matrix-grid"));
    const radev = table.getByRole("link", { name: /a\.bg — Румен Радев/ });
    expect(radev.getAttribute("aria-label")).toContain(
      "в рамките на обичайното",
    );
    const yotova = table.getByRole("link", { name: /a\.bg — Илияна Йотова/ });
    expect(yotova.getAttribute("aria-label")).toContain(
      "по-неблагоприятно от обичайното",
    );
    expect(yotova).toHaveAttribute("href", "/person/mp-1?outlet=a.bg");
  });

  it("says plainly when no period is dense enough", async () => {
    await draw(matrix(false));
    expect(screen.getByTestId("matrix-not-offered")).toBeInTheDocument();
    expect(screen.queryByTestId("matrix-grid")).toBeNull();
  });

  it("and when the grid is not published", async () => {
    await draw(null);
    expect(
      screen.getByText("Мрежата още не е публикувана."),
    ).toBeInTheDocument();
  });
});
