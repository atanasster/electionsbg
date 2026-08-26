// /outlets — the directory, and the one rule these two screens exist to
// enforce.
//
// ⚠️ A spectrum bar drawn from 2 analysed articles carries exactly the same
// visual weight as one drawn from 100, and says nothing. Blitz.bg is 2 of 96.
// So coverage is a COLUMN and the bar is withheld below a floor — replaced by
// a sentence, never by an empty strip, because an empty strip reads as "this
// outlet has no leaning" rather than "we have not measured it".

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPECTRUM_MIN_ANALYSED,
  hasSpectrum,
  positionedCount,
  type Outlet,
} from "../data";

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
    visits: 1_000_000,
    article_count: 100,
    analyzed_count: 0,
    leaning: {},
    russia_stance: {},
    ai_generated: {},
    conduct: {
      articles: 100,
      with_author: 65,
      updated_known: 0,
      edited_after_publication: 0,
    },
    ...over,
  }) as Outlet;

const renderList = async (outlets: Outlet[]) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useOutlets: () => ({
      data: { generated_at: "", outlets },
      error: null,
      loading: false,
    }),
  }));
  const { OutletsScreen } = await import("./OutletsScreen");
  render(
    <MemoryRouter>
      <OutletsScreen />
    </MemoryRouter>,
  );
};

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

describe("the sample floor", () => {
  beforeEach(() => vi.resetModules());

  it("draws no bar below the floor, and says why", async () => {
    await renderList([
      outlet({
        outlet: "Блиц",
        analyzed_count: 2,
        article_count: 96,
        leaning: { neutral: 2 },
      }),
    ]);
    const row = rowFor("Блиц");
    expect(
      within(row).getByText(/от 2 анализирани само 2 заемат позиция/),
    ).toBeVisible();
    expect(row.querySelector('span[style*="background"]')).toBeNull();
  });

  it("draws the bar above the floor", async () => {
    await renderList([
      outlet({
        outlet: "Голям",
        analyzed_count: 200,
        leaning: { neutral: SPECTRUM_MIN_ANALYSED - 10, progressive: 10 },
      }),
    ]);
    const row = rowFor("Голям");
    expect(row.querySelector('span[style*="background"]')).not.toBeNull();
  });

  it("distinguishes 'none analysed' from 'too few analysed'", async () => {
    // ⚠️ Different statements. "Nothing has been read" and "we read a couple"
    // are not the same claim about an outlet.
    await renderList([
      outlet({ outlet: "Нула", analyzed_count: 0 }),
      outlet({
        domain: "b.bg",
        outlet: "Малко",
        analyzed_count: 3,
        leaning: { neutral: 3 },
      }),
    ]);
    expect(
      within(rowFor("Нула")).getByText("няма анализирани статии"),
    ).toBeVisible();
    expect(
      within(rowFor("Малко")).getByText(/от 3 анализирани само 3 заемат/),
    ).toBeVisible();
  });

  it("agrees in number at n=1", async () => {
    await renderList([
      outlet({
        outlet: "Един",
        analyzed_count: 9,
        leaning: { neutral: 1, not_applicable: 8 },
      }),
    ]);
    expect(
      within(rowFor("Един")).getByText(/само 1 заема позиция/),
    ).toBeVisible();
  });

  it("shows coverage as analysed-of-collected", async () => {
    await renderList([
      outlet({ outlet: "Блиц", analyzed_count: 2, article_count: 96 }),
    ]);
    // The two halves live in one cell ("2" then "/96"), so assert on the
    // cell's text rather than on two separate matches.
    const cells = [...rowFor("Блиц").querySelectorAll("td")];
    const coverage = cells.find((c) => c.textContent?.includes("/96"));
    expect(coverage?.textContent).toBe("2/96");
  });

  it("keeps the header and every body row at the same width", async () => {
    // A cell added for one breakpoint only put more cells in every body row
    // than in the header — invisible exactly while the CSS is applied.
    await renderList([outlet(), outlet({ domain: "b.bg", outlet: "Втори" })]);
    const heads = document.querySelectorAll("thead th").length;
    for (const tr of document.querySelectorAll("tbody tr")) {
      expect(tr.querySelectorAll("td").length).toBe(heads);
    }
  });
});

describe("retired outlets", () => {
  beforeEach(() => vi.resetModules());

  it("sort last whatever their catalogue rank", async () => {
    // ⚠️ Their articles were collected in good faith and stay — but a retired
    // outlet interleaved with live ones by rank reads as a live source, and
    // two of them asked not to be crawled at all.
    await renderList([
      outlet({
        domain: "gone.bg",
        outlet: "Оттеглен",
        rank: 1,
        retired: true,
        retired_reason: "bot_refused",
      }),
      outlet({ domain: "live.bg", outlet: "Жив", rank: 50 }),
    ]);
    const names = [...document.querySelectorAll("tbody tr")].map(
      (r) => r.querySelectorAll("td")[1].textContent,
    );
    expect(names[0]).toContain("Жив");
    expect(names[1]).toContain("Оттеглен");
  });

  it("are named as retired, not merely dimmed", async () => {
    await renderList([
      outlet({
        outlet: "Оттеглен",
        retired: true,
        retired_reason: "bot_refused",
      }),
    ]);
    expect(within(rowFor("Оттеглен")).getByText("оттеглен")).toBeVisible();
  });
});

describe("hasSpectrum", () => {
  it("is one definition shared by both screens", () => {
    // Two copies is how a directory comes to draw a bar for an outlet whose
    // own page refuses to.
    //
    // ⚠️ It takes the COUNTS, not the outlet. An earlier version of this test
    // passed `{ analyzed_count: 30 }` and still went green — because after
    // the signature changed that object reads as a label literally named
    // "analyzed_count" with a count of 30, which is not not_applicable and so
    // clears the floor. A vacuous pass, in the one test naming the rule.
    expect(hasSpectrum({ neutral: SPECTRUM_MIN_ANALYSED })).toBe(true);
    expect(hasSpectrum({ neutral: SPECTRUM_MIN_ANALYSED - 1 })).toBe(false);
    expect(hasSpectrum({})).toBe(false);
  });

  it("counts only the labels the BAR draws", () => {
    // not_applicable is excluded from LEANING_ORDER and is the majority
    // verdict, so counting it makes the floor meaningless.
    expect(hasSpectrum({ not_applicable: 1000 })).toBe(false);
    expect(positionedCount({ not_applicable: 100, neutral: 2 })).toBe(2);
    expect(positionedCount({})).toBe(0);
  });
});
