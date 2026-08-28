// /outlet/:domain — the profile, and specifically its conduct meters.
//
// ⚠️ NEVER a single trust score. Three separate measures with their bases
// shown is a description of an outlet; one number would be a verdict this
// project cannot defend — and the page says so in words, which these tests
// pin.
//
// ⚠️ And never a bare rate. `updated_known` covers 2.7% of the corpus, so an
// "edit rate" over all articles would be a near-zero number that reads as a
// finding about the newsroom rather than about our own coverage.

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SPECTRUM_MIN_ANALYSED, type Outlet } from "../data";

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
    article_count: 100,
    analyzed_count: 0,
    leaning: {},
    russia_stance: {},
    ai_generated: {},
    conduct: {
      articles: 100,
      with_author: 78,
      updated_known: 40,
      edited_after_publication: 4,
    },
    ...over,
  }) as Outlet;

const renderProfile = async (o: Outlet, others: Outlet[] = []) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useOutlets: () => ({
      data: { generated_at: "", outlets: [o, ...others] },
      error: null,
      loading: false,
    }),
    useOutletArticles: () => ({
      data: { domain: o.domain, outlet: o.outlet, articles: [] },
      error: null,
      loading: false,
    }),
    useStories: () => ({
      data: { generated_at: "", stories: [] },
      error: null,
      loading: false,
    }),
  }));
  const { OutletScreen } = await import("./OutletScreen");
  render(
    <MemoryRouter initialEntries={[`/outlet/${o.domain}`]}>
      <Routes>
        <Route path="/outlet/:domain" element={<OutletScreen />} />
      </Routes>
    </MemoryRouter>,
  );
};

const conductCard = async () =>
  (await screen.findByText("Поведение на редакцията")).closest(
    "div",
  ) as HTMLElement;

describe("the conduct meters", () => {
  beforeEach(() => vi.resetModules());

  it("says outright that it is never one number", async () => {
    await renderProfile(outlet());
    const card = await conductCard();
    expect(within(card).getByText(/Никога едно число/)).toBeVisible();
  });

  it("renders a rate with its base", async () => {
    await renderProfile(outlet());
    const card = await conductCard();
    expect(within(card).getByText("78%")).toBeVisible();
    expect(within(card).getByText(/78 от 100/)).toBeVisible();
  });

  it("puts the corpus mean beside the rate", async () => {
    // ⚠️ 78% is good or bad only relative to what these newsrooms do. A rate
    // with nothing to compare it against is a number the reader cannot place.
    // ⚠️ ASYMMETRIC denominators. With both fixtures at articles:100 the
    // article-weighted mean and the mean-of-outlet-rates are BOTH 50%, so the
    // test could not tell which was implemented.
    //   article-weighted: (78 + 2) / (100 + 10) = 72.7% -> 73%
    //   mean of rates:    (78% + 20%) / 2       = 49%
    await renderProfile(outlet(), [
      outlet({
        domain: "b.bg",
        conduct: {
          articles: 10,
          with_author: 2,
          updated_known: 0,
          edited_after_publication: 0,
        },
      }),
    ]);
    const card = await conductCard();
    expect(
      within(card).getByText(/73% за всички събрани материали/),
    ).toBeVisible();
  });

  it("REFUSES a rate whose base is too small, and says the base", async () => {
    // ⚠️ The same lie as a spectrum bar drawn from two articles, one measure
    // over. `updated_known` is 2.7% of the corpus.
    await renderProfile(
      outlet({
        conduct: {
          articles: 100,
          with_author: 78,
          updated_known: 2,
          edited_after_publication: 2,
        },
      }),
    );
    const card = await conductCard();
    expect(
      within(card).getByText(/известно само за 2 материала — твърде малко/),
    ).toBeVisible();
    expect(within(card).queryByText("100%")).not.toBeInTheDocument();
  });

  it("declares the measure it cannot make, rather than omitting it", async () => {
    // ⚠️ Republication is not derivable from this corpus: the „Източник:"
    // marker in practice accompanies PHOTOS. Silently dropping the measure
    // would leave a reader assuming we checked and found none.
    await renderProfile(outlet());
    const card = await conductCard();
    expect(within(card).getByText("Препубликувано съдържание")).toBeVisible();
    expect(within(card).getByText(/Не се измерва/)).toBeVisible();
  });

  it("says 'няма данни' when a measure has no base at all", async () => {
    await renderProfile(
      outlet({
        conduct: {
          articles: 0,
          with_author: 0,
          updated_known: 0,
          edited_after_publication: 0,
        },
      }),
    );
    const card = await conductCard();
    expect(within(card).getAllByText("няма данни").length).toBeGreaterThan(0);
  });
});

describe("the header badges", () => {
  beforeEach(() => vi.resetModules());

  it("agrees in number at n=1", async () => {
    await renderProfile(outlet({ article_count: 1, analyzed_count: 1 }));
    expect(await screen.findByText("1 статия в корпуса")).toBeVisible();
    expect(screen.getByText("1 анализирана")).toBeVisible();
    expect(screen.queryByText("1 статии в корпуса")).not.toBeInTheDocument();
    expect(screen.queryByText("1 анализирани")).not.toBeInTheDocument();
  });

  it("agrees in number above 1", async () => {
    await renderProfile(outlet({ article_count: 100, analyzed_count: 40 }));
    expect(await screen.findByText("100 статии в корпуса")).toBeVisible();
    expect(screen.getByText("40 анализирани")).toBeVisible();
  });
});

describe("source transparency", () => {
  beforeEach(() => vi.resetModules());

  it("shows registry ownership with its source, date and control caveat", async () => {
    await renderProfile(
      outlet({
        owner: {
          name: "Пример Медиа АД",
          category: "company",
          source: "https://registry.example/owner",
          checked: "2026-08-20",
        },
      }),
    );
    expect(
      await screen.findByText(/Вписан собственик: Пример Медиа АД/),
    ).toBeVisible();
    expect(
      screen.getByText(/не твърдение за действителен контрол/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Източник на справката/ }),
    ).toHaveAttribute("href", "https://registry.example/owner");
    expect(screen.getByText(/проверено 20 август 2026/)).toBeVisible();
  });

  it("distinguishes not-yet-checked ownership from unknown ownership", async () => {
    await renderProfile(outlet({ owner: null }));
    expect(
      await screen.findByText(/Собствеността още не е проверена/),
    ).toBeVisible();
    expect(
      screen.getByText(/не означава, че собственикът е неизвестен/),
    ).toBeVisible();
  });

  it("withholds incomplete or unsafe ownership claims", async () => {
    await renderProfile(
      outlet({
        owner: {
          name: "Непроверено дружество",
          category: "company",
          source: "javascript:alert(1)",
          checked: null,
        },
      }),
    );
    expect(screen.queryByText(/Вписан собственик/)).not.toBeInTheDocument();
    expect(
      await screen.findByText(/данните за собствеността са непълни/i),
    ).toBeVisible();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("prints why and when a source was retired", async () => {
    await renderProfile(
      outlet({
        retired: true,
        retired_reason: "bot_refused",
        retired_on: "2026-08-12",
      }),
    );
    expect(await screen.findByText(/Причина за оттегляне/)).toHaveTextContent(
      "изданието отказва автоматизиран достъп · от 12 август 2026",
    );
  });

  it("always states missing retirement metadata", async () => {
    await renderProfile(outlet({ retired: true }));
    expect(
      await screen.findByText(/причината не е записана/),
    ).toHaveTextContent("датата не е записана");
  });
});

describe("the spectrum floor", () => {
  beforeEach(() => vi.resetModules());

  it("is withheld below the floor, with the sample stated", async () => {
    await renderProfile(
      outlet({
        analyzed_count: 40,
        article_count: 96,
        leaning: { not_applicable: 37, neutral: 3 },
      }),
    );
    expect(
      await screen.findByText(
        /От 40 анализирани статии само 3 участват в разпределението/,
      ),
    ).toBeVisible();
  });

  it("says so when nothing takes a position, rather than claiming no data", async () => {
    // ⚠️ not_applicable is the majority verdict. An outlet with 100 analysed
    // articles and none positioned is a real and interesting fact — it is
    // NOT "we have not read anything".
    await renderProfile(
      outlet({ analyzed_count: 100, leaning: { not_applicable: 100 } }),
    );
    expect(
      await screen.findByText(/нито една няма приложима оценка/),
    ).toBeVisible();
    expect(
      screen.queryByText(/Още няма анализирани статии/),
    ).not.toBeInTheDocument();
  });

  it("distinguishes 'none' from 'too few'", async () => {
    await renderProfile(outlet({ analyzed_count: 0 }));
    expect(
      await screen.findByText(/Още няма анализирани статии/),
    ).toBeVisible();
  });

  it("uses singular copy below the spectrum floor", async () => {
    await renderProfile(
      outlet({ analyzed_count: 1, article_count: 1, leaning: { neutral: 1 } }),
    );
    expect(
      await screen.findByText(/От 1 анализирана статия само 1 участва/),
    ).toBeVisible();
  });

  it("draws the distributions above the floor", async () => {
    await renderProfile(
      outlet({
        analyzed_count: 200,
        leaning: { neutral: SPECTRUM_MIN_ANALYSED - 10, progressive: 10 },
      }),
    );
    expect(
      await screen.findByText(/Политическо рамкиране по статии/),
    ).toBeVisible();
  });

  it("survives a bundle built before `conduct` existed", async () => {
    // ⚠️ dist-news carries whatever the last build produced, and newsapp has
    // NO error boundary — a bare outlet.conduct.articles white-screens the
    // whole page.
    const stale = outlet();
    delete (stale as unknown as Record<string, unknown>).conduct;
    await renderProfile(stale);
    expect(await screen.findByText("Поведение на редакцията")).toBeVisible();
  });
});
