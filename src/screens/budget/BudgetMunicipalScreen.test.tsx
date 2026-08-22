// Gates for /budget/municipal.
//
// Four failures this page invites, all of which produce a table that looks fine:
//
//   * SUMMING A FILTERED LIST AS THE NATIONAL ENVELOPE. The heading must say
//     which it is.
//   * RANKING BY TOTAL AND CALLING IT FAIRNESS. Столична €718m / €564 per
//     resident; Трекляно €2.2m / €5 028. The inversion is real and neither
//     figure explains itself.
//   * DROPPING СТОЛИЧНА FROM THE PER-RESIDENT VIEW. Its key differs between
//     `budget_muni_transfer` (SFO_CITY) and `obshtina_population` (SOF00), so a
//     naive join loses exactly the row every reader checks first.
//   * RENDERING A NULL EQUALISATION GRANT AS €0. ~19 municipalities receive
//     none, and „€0" asserts they were given nothing rather than that the line
//     does not apply.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import { BudgetMunicipalScreen } from "./BudgetMunicipalScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const dict = bgDict as Record<string, string>;
const nb = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** Столична and Трекляно, verbatim from `budget_muni_list(2026, …)`. */
const SOFIA = {
  obshtina: "SFO_CITY",
  nameBg: "Столична община",
  nameEn: "Sofia (capital municipality)",
  fiscalYear: 2026,
  delegatedEur: 699239800,
  equalizationEur: null,
  capitalEur: 14246200,
  winterEur: 528500,
  otherTargetedEur: 4246700,
  totalEur: 718261200,
  population: 1274290,
  censusYear: 2021,
  totalPerCapitaEur: 563.6559966726569,
};

const TREKLYANO = {
  obshtina: "PER36",
  nameBg: "Трекляно",
  nameEn: "Treklyano",
  fiscalYear: 2026,
  delegatedEur: 1500000,
  equalizationEur: 600000,
  capitalEur: 82000,
  winterEur: 0,
  otherTargetedEur: 0,
  totalEur: 2182000,
  population: 434,
  censusYear: 2021,
  totalPerCapitaEur: 5027.649769585253,
};

let payload: unknown = { fiscalYear: 2026, rows: [SOFIA, TREKLYANO] };

beforeEach(() => {
  payload = { fiscalYear: 2026, rows: [SOFIA, TREKLYANO] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2026,
              // The КФП feed's years…
              yearsAvailable: [2025, 2026],
              // …and the transfer table's own, which are wider.
              muniYears: [2018, 2025, 2026],
            }),
          }
        : { ok: true, json: async () => payload },
    ),
  );
});

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/municipal${search}`]}>
        <BudgetMunicipalScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetMunicipalScreen", () => {
  it("ranks by total by default", async () => {
    // The server order is deliberately INVERTED here: with the fixture already
    // sorted, deleting the client sort left this green.
    payload = { fiscalYear: 2026, rows: [TREKLYANO, SOFIA] };
    renderIt();
    await screen.findByText(/Столична община/);
    const first = document.querySelectorAll("ul.divide-y > li")[0];
    expect(first.textContent).toContain("Столична община");
  });

  it("ranks by resident when asked, inverting the order", async () => {
    // Two renders in ONE test share a container, so the second list appends to
    // the first and `[0]` is still the earlier render's row — which is how this
    // gate first reported a failure that was not there.
    renderIt("?basis=capita");
    // Anchored on the LIST, not on the name: the per-resident caption itself
    // names Трекляно, so `findByText(/Трекляно/)` resolves against the caption
    // before a single row has rendered.
    await waitFor(() =>
      expect(document.querySelectorAll("ul.divide-y > li").length).toBe(2),
    );
    const first = document.querySelectorAll("ul.divide-y > li")[0];
    // 434 residents at €5 028 outrank 1.27m at €564.
    expect(first.textContent).toContain("Трекляно");
  });

  it("keeps Столична in the per-resident view", async () => {
    // Its key is SFO_CITY here and SOF00 in `obshtina_population`; a naive join
    // drops the largest municipality — and the one every reader checks first.
    renderIt("?basis=capita");
    const row = (await screen.findByText(/Столична община/)).closest("li")!;
    expect(nb(row.textContent)).toContain("1 274 290");
    expect(row.textContent).not.toContain("—");
  });

  // ── §11 · the declared-basis clauses ──────────────────────────────────────
  it("defaults to the TOTAL basis, never to per-resident", async () => {
    // ⚠️ THE `08bd7a6185` CLASS. A per-resident default ranks 265 municipalities
    // by a figure whose denominator most readers never see, and the smallest
    // places win — which reads as privilege and is mostly arithmetic. The page
    // says exactly that in `budget_muni_capita_note`, and it only says it
    // because the reader ASKED for the basis.
    renderIt();
    await screen.findByText(/Столична община/);
    const body = nb(document.body.textContent);
    // The per-resident explainer is the tell: it renders only on that basis.
    expect(body).not.toContain("Подредено на жител");
    // …and the largest município leads, which per-resident inverts.
    const first = document.querySelectorAll("ul.divide-y > li")[0];
    expect(first.textContent).toContain("Столична община");
  });

  it("renders no per-resident figure with no census vintage to name", async () => {
    // The caption is gated on `censusYear`, which is recovered from the rows —
    // so a payload without one previously rendered the DIVIDED figures with the
    // denominator's vintage nowhere on the page. That is precisely the
    // uncaptioned-denominator state §11 forbids, and every other fixture here
    // sets censusYear: 2021, so the null branch was untested.
    payload = {
      fiscalYear: 2026,
      rows: [SOFIA, TREKLYANO].map((r) => ({ ...r, censusYear: null })),
    };
    renderIt("?basis=capita");
    await waitFor(() =>
      expect(document.querySelectorAll("ul.divide-y > li").length).toBe(2),
    );
    const body = nb(document.body.textContent);
    expect(body).toContain("Подредено на жител");
    // ⚠️ NOT `/Преброяване/` — `budget_muni_source`, the line at the foot,
    // contains that word on every basis, so matching it made this gate vacuous
    // and it passed against the very state it was written for. The caption slot
    // has to say something SPECIFIC about the vintage: either the year, or that
    // the year is unknown.
    expect(body).toMatch(/годината му не е публикувана/);
  });

  it("names the census YEAR beside the ranking when it has one", async () => {
    // The counterpart: with a vintage, the year itself is on the page next to
    // the division rather than only in the source line at the foot. A 2026
    // transfer over a 2021 census is a real approximation and the reader is the
    // one doing the comparing.
    renderIt("?basis=capita");
    await waitFor(() =>
      expect(document.querySelectorAll("ul.divide-y > li").length).toBe(2),
    );
    expect(nb(document.body.textContent)).toMatch(/Преброяване 2021/);
  });

  it("says when the envelope is a filtered sum, not the national one", async () => {
    payload = { fiscalYear: 2026, rows: [TREKLYANO] };
    renderIt("?q=Трек");
    const h = await screen.findByText(/не е националната сума/);
    expect(h).toBeTruthy();
    // …and the unfiltered heading is not also present.
    expect(screen.queryByText(/^Общо за 1 общини през 2026 г\.$/)).toBeNull();
  });

  it("explains the per-resident inversion instead of implying privilege", async () => {
    renderIt("?basis=capita");
    await waitFor(() =>
      expect(document.querySelectorAll("ul.divide-y > li").length).toBe(2),
    );
    const note = [...document.querySelectorAll("p")].find((n) =>
      n.textContent?.includes("Подредено на жител"),
    )!;
    expect(note.textContent).toMatch(/не значи привилегия/);
    expect(note.textContent).toMatch(/кметство и училище/);
    // …and the redistribution half, which is 44.8% of Трекляно's transfer and
    // the stronger of the two explanations.
    expect(note.textContent).toMatch(/изравнителната субсидия/);
  });

  it("omits a component no municipality received, rather than showing €0", async () => {
    // Every row NULL on the equalisation grant — the real shape for
    // other_targeted_eur in 2018-2022. „€0" would assert the grant was paid at
    // zero; absent says the line does not apply.
    payload = {
      fiscalYear: 2026,
      rows: [SOFIA, { ...TREKLYANO, equalizationEur: null }],
    };
    renderIt();
    await screen.findByText(/Столична община/);
    expect(screen.queryByText(dict.budget_muni_equalization)).toBeNull();
    // …and a component that IS paid still shows.
    expect(screen.getByText(dict.budget_muni_delegated)).toBeTruthy();
  });

  it("keeps the state-sends corpus apart from what municipalities owe", async () => {
    renderIt();
    await screen.findByText(/Столична община/);
    const note = screen.getByText(dict.budget_muni_not_liabilities);
    expect(note.textContent).toMatch(/двете не се събират/);
  });

  it("offers the transfer table's own years, not the КФП feed's", async () => {
    // `budget_muni_transfer` runs 2018-2026; the КФП feed starts at 2021. Built
    // from the wrong list the picker omitted three years the corpus HAS, and
    // ?fy=2018 rendered with no chip selected.
    renderIt();
    await screen.findByText(/Столична община/);
    const chips = [...document.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((v) => /^\d{4}$/.test(v ?? ""));
    expect(chips).toContain("2018");
  });

  it("states the census vintage where the division happens", async () => {
    renderIt("?basis=capita");
    await waitFor(() =>
      expect(document.querySelectorAll("ul.divide-y > li").length).toBe(2),
    );
    // Not only in the source line at the foot: a 2026 transfer over a 2021
    // census is an approximation, and the reader is doing the comparing.
    // Scoped to the basis note's own paragraph. The source line at the foot
    // ALSO names the census, so a page-wide match passes with the sentence
    // deleted; and the note now SHARES its paragraph with that sentence, so an
    // exact-text lookup for the note alone no longer resolves.
    const note = [...document.querySelectorAll("p")].find((n) =>
      n.textContent?.includes("Подредено на жител"),
    )!;
    expect(note.textContent).toMatch(/Преброяване 2021/);
  });

  it("agrees in Bulgarian when exactly one municipality matches", async () => {
    // „Сбор за 1 намерени общини" is the most common filtered state.
    payload = { fiscalYear: 2026, rows: [TREKLYANO] };
    renderIt("?q=Трек");
    const h = await screen.findByText(/не е националната сума/);
    expect(h.textContent).toMatch(/1 намерена община/);
    expect(h.textContent).not.toMatch(/1 намерени общини/);
  });

  it("reads ?q and sends it to the server", async () => {
    renderIt("?q=Трекляно");
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("budget-municipal"));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[urls.length - 1]).toContain("q=");
    });
  });
});
