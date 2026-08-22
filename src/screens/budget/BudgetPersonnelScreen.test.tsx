// Gates for /budget/personnel.
//
// The whole page exists to keep two numbers apart. FY2025: 133 275 filled posts
// and 98 446 persons employed per НСИ — the SAME document, different
// methodologies, 34 829 apart. The failure this file prevents is arithmetic
// across them: „34 829 posts are paid for and empty" is a fabricated finding,
// and the real vacancy count (12 348) is published directly.
//
// Second: `payrollEur` is NULL on every row, so the page must show no money at
// all rather than €0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict, enCorpus as enDict } from "@/locales/allKeys";
import { BudgetPersonnelScreen } from "./BudgetPersonnelScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: lang },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw =
        ((lang === "bg" ? bgDict : enDict) as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const dict = bgDict as Record<string, string>;
let lang = "bg";
const sp = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** Verbatim from `budget_personnel_series()`. */
const PAYLOAD = {
  positionsBasis: "Щатни бройки по Доклада за състоянието на администрацията",
  headcountBasis:
    "НСИ, наети лица (списъчен брой) към декември — отделна справка в същия доклад",
  points: [
    {
      fiscalYear: 2024,
      positionsTotal: 145802,
      positionsFilled: 132392,
      positionsVacant: 13410,
      nsiHeadcount: 98975,
      payrollEur: null,
    },
    {
      fiscalYear: 2025,
      positionsTotal: 145623,
      positionsFilled: 133275,
      positionsVacant: 12348,
      nsiHeadcount: 98446,
      payrollEur: null,
      // T9.8 — verbatim from budget_personnel_series() on the live corpus.
      positionsCentral: 108387,
      positionsTerritorial: 37236,
      positionsMunicipal: 28663,
      positionsMunicipalOwnRevenue: 5839,
      positionsVacantOverSixMonths: 5729,
      structuresCentral: 114,
      structuresTerritorial: 467,
      structuresTotal: 581,
    },
  ],
  unitBasis:
    "Отчет за изпълнението на програмния бюджет на съответното министерство — изпълнени щатни бройки",
  unitsFiscalYear: 2024,
  unitYears: [2022, 2023, 2024],
  units: [
    {
      nodeId: "admin-ministerstvo-na-zdraveopazvaneto",
      nameBg: "Министерство на здравеопазването",
      nameEn: "Ministry of Health",
      headcount: 12842,
      personnelEur: 278788670,
      avgCostPerFteEur: 21709,
    },
    {
      nodeId: "admin-ministerstvo-na-turizma",
      nameBg: "Министерство на туризма",
      nameEn: "Ministry of Tourism",
      headcount: 105,
      personnelEur: 2819565,
      avgCostPerFteEur: 26853,
    },
  ],
  unitsCoverage: {
    units: 7,
    personnelEur: 659108655,
    unitsExpenditureEur: 2267820590,
    stateExpenditureEur: 24775124952,
  },
};

let payload: unknown = PAYLOAD;

beforeEach(() => {
  lang = "bg";
  payload = PAYLOAD;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
});

const renderIt = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/budget/personnel"]}>
        <BudgetPersonnelScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetPersonnelScreen", () => {
  it("never subtracts the NSI headcount from the filled posts", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_nsi_h);
    const body = sp(document.body.textContent);
    // 133 275 − 98 446 = 34 829. It is not „posts paid for and empty" and must
    // appear nowhere.
    expect(body).not.toContain("34 829");
    expect(body).not.toContain("34829");
  });

  it("takes the vacancy count from the source, not from the gap", async () => {
    renderIt();
    const line = await screen.findByText(/Незаетите са/);
    // 12 348 / 145 623 = 8.5%. Computed against the NSI figure it would be
    // 32.4% — a number four times too large, from two different populations.
    expect(line.textContent).toContain("8.5%");
    expect(line.textContent).not.toContain("32.4%");
    expect(sp(document.body.textContent)).toContain("12 348");
  });

  it("names the basis of each series where it is read", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_nsi_h);
    // Both come from the payload, so a change in the SQL cannot strand a
    // caption. Substring, not exact: the positions caption shares its paragraph
    // with the non-zero-axis note.
    // Query the <p> elements directly: an ancestor-matching text query hits
    // every wrapper up the tree.
    const captions = [...document.querySelectorAll("p")].map(
      (n) => n.textContent ?? "",
    );
    expect(captions.some((c) => c.includes(PAYLOAD.positionsBasis))).toBe(true);
    expect(captions.some((c) => c.includes(PAYLOAD.headcountBasis))).toBe(true);
    // …and the note gives the ACTUAL reason from the source's footnotes —
    // НСИ excludes МВР and МО and includes staff outside the establishment —
    // rather than „a different set", which is true and says nothing.
    const note = screen.getByText(dict.budget_staff_nsi_note);
    expect(note.textContent).toMatch(/МВР и МО/);
    expect(note.textContent).toMatch(/извън утвърдения щат/);
    expect(note.textContent).toMatch(/несъпоставими/);
  });

  it("puts no money on the NATIONAL figures, because the Доклад publishes none", async () => {
    // `payrollEur` is NULL on every national row and „€0" would assert the
    // administration costs nothing.
    //
    // Since T9.8 the page does carry money — on the per-ministry rows, which
    // come from a different publisher that DOES report personnel spend. So
    // this asserts the boundary rather than the absence: every € on the page
    // is inside the unit list.
    renderIt();
    const unitsHeading = await screen.findByText(dict.budget_staff_units_h);
    // Everything ABOVE the ministry heading is the national grain, and none of
    // it may carry a €. Below it, three things legitimately do: the rows, the
    // coverage sentence and the footer that names their source.
    const all = sp(document.body.textContent);
    const cut = all.indexOf(dict.budget_staff_units_h);
    expect(cut, "the ministry heading is not on the page").toBeGreaterThan(0);
    expect(all.slice(0, cut)).not.toContain("€");
    // …and the boundary is not vacuous: money really is below it.
    expect(all.slice(cut)).toContain("€");
    expect(unitsHeading).toBeTruthy();
  });

  it("uses the LATEST year for the headline, not the first", async () => {
    renderIt();
    // `<p>`, not any element: since T9.7 the chart carries a visually-hidden
    // table whose column headers reuse these same labels, so an unscoped
    // `findByText` matches the headline card AND the `<th>`. That table is the
    // accessibility tree the `<ul>` it replaced used to provide, so the fix is
    // to name the card's own element rather than to drop the labels.
    const card = (
      await screen.findByText(dict.budget_staff_total, { selector: "p" })
    ).closest("div")!;
    // Asserted on the CARD. Against the whole body this passed either way: the
    // trend list below renders EVERY year's total, so „145 623" is present even
    // when the headline shows 2024's.
    expect(sp(card.textContent)).toContain("145 623");
    expect(sp(card.textContent)).not.toContain("145 802");
    const filled = (
      await screen.findByText(dict.budget_staff_filled, { selector: "p" })
    ).closest("div")!;
    expect(sp(filled.textContent)).toContain("133 275");
    const line = await screen.findByText(/Незаетите са/);
    expect(line.textContent).toContain("2025");
  });

  it("says nothing rather than zero when the route degrades", async () => {
    payload = { error: "unknown /api/db endpoint" };
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(dict.budget_staff_empty)).toBeTruthy(),
    );
    expect(screen.queryByText(dict.budget_staff_total)).toBeNull();
    expect(screen.queryByText(/Незаетите са/)).toBeNull();
  });

  // ── T9.8 · the detail the loader used to drop ─────────────────────────────
  it("shows where the posts are, with the subsets marked as subsets", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_split_h);
    const body = sp(document.body.textContent);
    expect(body).toContain("108 387");
    expect(body).toContain("37 236");
    // …and the note that stops a reader adding the four together. `municipal`
    // is INSIDE territorial: 108 387 + 37 236 + 28 663 = 174 286, which is
    // 28 663 more than the establishment.
    expect(body).toContain("не трети дял");
    expect(body).not.toContain("174 286");
  });

  it("says how long the vacancies have been open", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_split_h);
    const body = sp(document.body.textContent);
    // 5 729 of 12 348 — a SUBSET, phrased as one.
    // bg-BG groups from FIVE digits, so 5729 renders ungrouped while 12 348
    // does not — the same rule every 4-digit figure on the site follows.
    expect(body).toMatch(/5729 от 12 348/);
  });

  it("labels the structure count as bodies, never as people", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_split_h);
    const body = sp(document.body.textContent);
    expect(body).toContain("581 административни структури");
    expect(body).toContain("114");
    expect(body).toContain("467");
  });

  it("withholds the structure line when the year publishes none", async () => {
    // 2017-2020 publish no structure counts. `structuresTotal` is summed
    // server-side so it is NULL rather than 0 — „0 административни структури"
    // would be a claim about a state that has none.
    payload = {
      ...PAYLOAD,
      points: PAYLOAD.points.map((p) => ({
        ...p,
        structuresCentral: null,
        structuresTerritorial: null,
        structuresTotal: null,
      })),
    };
    renderIt();
    await screen.findByText(dict.budget_staff_split_h);
    expect(sp(document.body.textContent)).not.toContain(
      "административни структури",
    );
  });

  it("ranks the ministries and states how small a slice they are", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_units_h);
    const body = sp(document.body.textContent);
    expect(body).toContain("Министерство на здравеопазването");
    // The coverage sentence is the point: 7 ministries, €2,3 млрд. of
    // €24,8 млрд. — 9.2%. A leaderboard without it reads as a ranking of
    // everything.
    expect(body).toContain("9.2%");
    expect(body).toContain("Само министерствата");
  });

  it("never presents the unit figures on the national basis", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_units_h);
    const body = sp(document.body.textContent);
    // The unit list must carry ITS OWN basis line — the third publisher on
    // this page, and the one most easily read as the establishment.
    // The LOCALISED basis, not the payload's — `unitBasis` comes from SQL and
    // is Bulgarian-only, so asserting that string would pass on /en while the
    // page showed a Bulgarian caption under an English table.
    expect(body).toContain(dict.budget_staff_units_basis);
    // And the two must never be summed: 145 623 + 12 842 = 158 465.
    expect(body).not.toContain("158 465");
  });

  it("says so when no report has been parsed for the year", async () => {
    payload = { ...PAYLOAD, units: [], unitsCoverage: null };
    renderIt();
    await screen.findByText(dict.budget_staff_units_h);
    const body = sp(document.body.textContent);
    expect(body).toContain(dict.budget_staff_units_empty);
    // …and NOT a coverage sentence over an empty list.
    expect(body).not.toContain("Само министерствата");
  });

  it("marks the subset rows as subsets, visually as well as in words", async () => {
    // The note says „not a third share"; the LAYOUT has to agree, or a reader
    // skimming four equal rows adds them and overshoots by 28 663. Asserted on
    // the class because that is the only place the distinction exists — the
    // text of the two subset rows is otherwise a peer of the two above them.
    renderIt();
    await screen.findByText(dict.budget_staff_split_h);
    const row = (label: string) =>
      [...document.querySelectorAll("li")].find((li) =>
        (li.textContent ?? "").includes(label),
      );
    const parent = row(dict.budget_staff_territorial);
    const child = row(dict.budget_staff_municipal);
    expect(parent && child).toBeTruthy();
    expect(child!.className).toMatch(/pl-8/);
    expect(parent!.className).not.toMatch(/pl-8/);
  });

  it("formats the ministry money in the reader's locale", async () => {
    // The hub already shipped this defect once: money formatted bg-BG on /en,
    // so „€278,8 млн." appeared beside English labels.
    //
    // ⚠️ THE COMPACT SUFFIX MAY NOT BE PINNED — it is CLDR-versioned. Every
    // English money string on this site formats `en-GB` (82 files), and CLDR 47
    // flipped that locale's compact suffixes from „k/m/bn" to „K/M/B": the same
    // figure renders „€278.8m" on the ICU in CI's Node 22 and „€278.8M" on the
    // ICU 77 a current macOS ships. A literal „€278.8M" is therefore a gate on
    // the runtime's CLDR rather than on the page — it passed locally and failed
    // on CI, which is exactly the shape it was written to catch, inverted.
    //
    // What actually carries the locale here is the DECIMAL MARK — bg-BG renders
    // „€278,8 млн." — so pin that and leave the suffix to the runtime.
    lang = "en";
    renderIt();
    await screen.findByText(enDict.budget_staff_units_h);
    const body = sp(document.body.textContent);
    expect(body).toMatch(/€278\.8\s?[Mm]/);
    expect(body).not.toContain("млн.");
  });
});
