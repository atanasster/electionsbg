// MethodologyScreen — the page that makes the rest publishable.
//
// ⚠️ Every assertion here is about a CLAIM, not a layout. Ground News can
// point at three third-party raters when challenged; this project cannot. Its
// only authority is that the method is written down and the evidence is
// attached — so a page that silently loses a limitation, or states a figure
// that has gone stale, is a credibility failure rather than a cosmetic one.

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// ⚠️ No static import of the screen: each render re-imports it AFTER
// vi.doMock, so the data hooks are stubbed. A top-level import would be
// bound to the real hooks and every test would hit the network stub.
import type { Outlet, Stats } from "../data";

const stats = (over: Partial<Stats> = {}): Stats => ({
  generated_at: "2026-08-26T00:00:00+00:00",
  taxonomy_version: 1,
  accepted_snapshot_records_sha256: null,
  total_articles: 4366,
  analyzed_articles: 365,
  analyzed_pct: 8.4,
  stories: 86,
  domains: 55,
  outlets_catalogued: 59,
  first_published: "2007-06-13T21:07:26+00:00",
  last_published: "2026-08-26T00:01:00+00:00",
  articles_by_domain: {},
  ...over,
});

const outlet = (over: Partial<Outlet> = {}): Outlet => ({
  domain: "ex.bg",
  outlet: "Примерен вестник",
  logo: null,
  owner: null,
  hotlink_ok: null,
  retired: false,
  retired_reason: null,
  retired_on: null,
  rank: null,
  tier: null,
  type: null,
  scope: null,
  visits: null,
  article_count: 0,
  analyzed_count: 0,
  leaning: {},
  russia_stance: {},
  ai_generated: {},
  conduct: {
    articles: 0,
    with_author: 0,
    updated_known: 0,
    edited_after_publication: 0,
  },
  ...over,
});

const mockData = (s: Stats | null, outlets: Outlet[], error?: Error) => {
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useStats: () => ({ data: s, error: error ?? null, loading: !s && !error }),
    useOutlets: () => ({
      data: { generated_at: "", outlets },
      error: null,
      loading: false,
    }),
  }));
};

const renderPage = async (
  s: Stats | null,
  outlets: Outlet[],
  error?: Error,
) => {
  vi.resetModules();
  mockData(s, outlets, error);
  const { MethodologyScreen: Screen } = await import("./MethodologyScreen");
  render(<Screen />);
};

describe("the limitations block", () => {
  beforeEach(() => vi.resetModules());

  it("is the FIRST heading on the page", async () => {
    // ⚠️ A reader who meets the 8.4% after the figures has already read them
    // as complete. Order is the claim here, not styling.
    await renderPage(stats(), []);
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent(
        "Какво този корпус не покрива",
      ),
    );
  });

  it("comes before the figure grid in the DOM", async () => {
    // ⚠️ The heading check above is NOT enough: the four-figure grid carries
    // no heading, so moving it ABOVE the limitations card — the precise
    // defect this section exists to prevent — passed the whole suite.
    await renderPage(stats(), []);
    const card = (
      await screen.findByText("Какво този корпус не покрива")
    ).closest("div")!;
    const figure = screen.getByText("събрани статии").closest("div")!;
    expect(
      card.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("never rounds an incomplete corpus up to 100%", async () => {
    // ⚠️ Math.round printed „100% от събраното е анализирано" beside
    // „(4349 от 4366 статии)" — a limitation stated as its own opposite, on
    // the one card whose job is to under-promise.
    await renderPage(
      stats({
        analyzed_pct: 99.6,
        analyzed_articles: 4349,
        total_articles: 4366,
      }),
      [],
    );
    expect(await screen.findByText(/99% от събраното/)).toBeVisible();
    expect(screen.queryByText(/100% от събраното/)).not.toBeInTheDocument();
  });

  it("does say 100% when the corpus really is fully analysed", async () => {
    await renderPage(
      stats({
        analyzed_pct: 100,
        analyzed_articles: 4366,
        total_articles: 4366,
      }),
      [],
    );
    expect(await screen.findByText(/100% от събраното/)).toBeVisible();
  });

  it("says so when the outlets list fails, instead of dropping limitations", async () => {
    // ⚠️ Without this the bot-refusal and CAPTCHA bullets simply vanish and
    // the retired list disappears — the page then UNDERSTATES its own
    // limitations, the one direction this card must never fail in.
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../data")>()),
      useStats: () => ({ data: stats(), error: null, loading: false }),
      useOutlets: () => ({
        data: null,
        error: new Error("boom"),
        loading: false,
      }),
    }));
    const { MethodologyScreen: Screen } = await import("./MethodologyScreen");
    render(<Screen />);
    expect(
      await screen.findByText(/Списъкът с източници не се зареди/),
    ).toBeVisible();
  });

  it("states the analysed share against the collected total", async () => {
    await renderPage(stats(), []);
    const card = (
      await screen.findByText("Какво този корпус не покрива")
    ).closest("div");
    expect(
      within(card!).getByText(/8% от събраното е анализирано/),
    ).toBeVisible();
    expect(within(card!).getByText(/365/)).toBeVisible();
    expect(within(card!).getByText(/4366|4 366/)).toBeVisible();
  });

  it("derives the analysed share rather than hard-coding it", async () => {
    // The one page where a stale figure is a credibility failure.
    await renderPage(
      stats({ analyzed_pct: 61.2, analyzed_articles: 2672 }),
      [],
    );
    expect(await screen.findByText(/61% от събраното/)).toBeVisible();
  });

  it("counts the bot-refusing outlets from the data", async () => {
    await renderPage(stats(), [
      outlet({ domain: "a.bg", retired: true, retired_reason: "bot_refused" }),
      outlet({ domain: "b.bg", retired: true, retired_reason: "bot_refused" }),
      outlet({
        domain: "c.bg",
        retired: true,
        retired_reason: "broken_sitemaps",
      }),
    ]);
    expect(await screen.findByText(/2 издания отказват/)).toBeVisible();
  });

  it("says nothing about bot refusals when there are none", async () => {
    // ⚠️ "0 издания отказват обхождане" is a sentence nobody should read.
    await renderPage(stats(), [outlet()]);
    await screen.findByText("Какво този корпус не покрива");
    expect(screen.queryByText(/отказват обхождане/)).not.toBeInTheDocument();
  });

  it("counts CAPTCHA-blocked outlets separately from bot refusals", async () => {
    // Two DIFFERENT policy positions: one respects a refusal, the other
    // refuses to solve a challenge. Collapsing them would misdescribe both.
    // ⚠️ ASYMMETRIC counts. With one of each, a mutation that counted
    // bot_refused for BOTH produced identical copy and passed.
    await renderPage(stats(), [
      outlet({
        domain: "a.bg",
        retired: true,
        retired_reason: "blocked_captcha",
      }),
      outlet({
        domain: "b.bg",
        retired: true,
        retired_reason: "blocked_captcha",
      }),
      outlet({ domain: "c.bg", retired: true, retired_reason: "bot_refused" }),
    ]);
    expect(await screen.findByText(/2 издания изискват/)).toBeVisible();
    expect(screen.getByText(/Едно издание отказва/)).toBeVisible();
  });
});

describe("the refusals", () => {
  beforeEach(() => vi.resetModules());

  it("lists every thing the project will not do", async () => {
    await renderPage(stats(), []);
    await screen.findByText("Кое НЕ правим");
    for (const claim of [
      /Не оценяваме верността/,
      /Не даваме единна оценка на медия/,
      /Не свързваме име с човек/,
      /Не заобикаляме CAPTCHA/,
      /Доставянето и правото за показване са различни/,
    ]) {
      expect(screen.getByText(claim)).toBeVisible();
    }
  });
});

describe("the accuracy section", () => {
  beforeEach(() => vi.resetModules());

  it("ships EMPTY and says so", async () => {
    // ⚠️ Until the gold-set evaluation exists, "предстои" is the honest
    // content. A placeholder implying a number would be worse than a blank —
    // and a future author must not be able to delete this sentence without
    // replacing it with a real measurement.
    await renderPage(stats(), []);
    expect(await screen.findByText("Точност на модела")).toBeVisible();
    expect(screen.getByText(/още не е направена/)).toBeVisible();
  });
});

describe("the retired outlets", () => {
  beforeEach(() => vi.resetModules());

  it("names the OUTLET, not the domain", async () => {
    // A retired row that renders as "btvnovinite.bg" where "bTV Новините"
    // belongs is the shape this caught in the bundle.
    await renderPage(stats(), [
      outlet({
        domain: "btvnovinite.bg",
        outlet: "bTV Новините",
        retired: true,
        retired_reason: "blocked_captcha",
      }),
    ]);
    expect(await screen.findByText("bTV Новините")).toBeVisible();
  });

  it("translates the reason into the app's own words", async () => {
    await renderPage(stats(), [
      outlet({ retired: true, retired_reason: "broken_sitemaps" }),
    ]);
    expect(
      await screen.findByText(/неизползваеми карти на сайта/),
    ).toBeVisible();
  });

  it("agrees in number at n=1, not just in the subject", async () => {
    // ⚠️ Four strings got this wrong, two of them ONE CLAUSE after an n===1
    // branch written for exactly this — the branch fixed the subject and left
    // the rest of the sentence plural.
    await renderPage(stats(), [
      outlet({
        retired: true,
        retired_reason: "bot_refused",
        article_count: 1,
      }),
    ]);
    expect(await screen.findByText(/новите му материали/)).toBeVisible();
    expect(screen.getByText(/Едно издание е извадено/)).toBeVisible();
    expect(screen.getByText(/1 запазена статия/)).toBeVisible();
    expect(screen.queryByText(/1 запазени статии/)).not.toBeInTheDocument();
  });

  it("agrees in number at n>1 too", async () => {
    await renderPage(stats(), [
      outlet({
        domain: "a.bg",
        retired: true,
        retired_reason: "blocked_captcha",
      }),
      outlet({
        domain: "b.bg",
        retired: true,
        retired_reason: "blocked_captcha",
        article_count: 104,
      }),
    ]);
    expect(await screen.findByText(/2 издания са извадени/)).toBeVisible();
    expect(screen.getByText(/тези издания липсват/)).toBeVisible();
    expect(screen.getByText(/104 запазени статии/)).toBeVisible();
  });

  it("counts only RETIRED outlets, not every outlet with that reason", async () => {
    // countBy's `o.retired` guard: dropping it passed the whole suite.
    await renderPage(stats(), [
      outlet({ domain: "a.bg", retired: false, retired_reason: "bot_refused" }),
      outlet({ domain: "b.bg", retired: true, retired_reason: "bot_refused" }),
    ]);
    expect(await screen.findByText(/Едно издание отказва/)).toBeVisible();
    expect(screen.queryByText(/2 издания отказват/)).not.toBeInTheDocument();
  });

  it("says how many articles a retired outlet still contributes", async () => {
    // They were collected in good faith and they stay; the page must not
    // imply the outlet has been erased.
    await renderPage(stats(), [
      outlet({
        retired: true,
        retired_reason: "bot_refused",
        article_count: 104,
      }),
    ]);
    expect(await screen.findByText(/104 запазени статии/)).toBeVisible();
  });

  it("falls back to the raw reason rather than dropping the row", async () => {
    // An unmapped reason must still appear: a silently missing outlet is the
    // opposite of what this section is for.
    await renderPage(stats(), [
      outlet({ retired: true, retired_reason: "some_new_reason" }),
    ]);
    expect(await screen.findByText(/some_new_reason/)).toBeVisible();
  });
});

describe("loading and failure", () => {
  beforeEach(() => vi.resetModules());

  it("says the data failed rather than rendering an empty method", async () => {
    // ⚠️ A methodology page that renders its headings with no figures reads
    // as "we measure nothing".
    await renderPage(null, [], new Error("boom"));
    expect(await screen.findByText(/не се заредиха/)).toBeVisible();
    expect(screen.queryByText("Кое НЕ правим")).not.toBeInTheDocument();
  });
});
