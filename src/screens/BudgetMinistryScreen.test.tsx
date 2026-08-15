// Gates for /budget/ministry/:id — the module's largest indexed family.
//
// 54 prerendered pages plus 54 English mirrors, every one of them a sitemap
// <loc>, and until 2026-08-15 no test at all. That combination is what makes it
// worth covering: it is the page a crawler reaches most and the page nothing
// checked.
//
// The invariants below are the ones whose failure is a WRONG NUMBER rendered
// confidently, not a crash:
//
//   * TWO BASES ON ONE PAGE, on purpose. The trend and the hero's YoY read the
//     single-scope figure (`expenditureLaw ?? expenditure`); the per-year
//     reconciliation TABLE reads `expenditure`, because its basis has to match
//     the amended and executed columns beside it. Mixing them makes an отчет's
//     consolidated restatement step above its neighbours and read as growth.
//   * A PUBLISHED ZERO THAT MEANS „UNKNOWN". The budget law prints 0 for a
//     balance where it set no separate self-financing target.
//   * A YoY CHIP WITH NO PRIOR. A ministry's first year, or the 2021 gap.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetMinistryScreen } from "./BudgetMinistryScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const nb = (v: string | null) => (v ?? "").replace(/[\u00a0\u202f]/g, " ");
const m = (amountEur: number | null) =>
  amountEur == null
    ? null
    : { amount: Math.round(amountEur * 1.95583), currency: "BGN", amountEur };

/** МОСВ, VERBATIM from `data/budget/ministries/…okolnata-sreda…json` — every
 *  figure below is in that file, including the ones that are null there.
 *  `programs` is emptied (the real years carry four each) and that is the only
 *  edit; the programme SECTION therefore does not render, which is a stated gap
 *  rather than a claim of coverage.
 *
 *  It is the pair the screen's own basis comment names. FY2024 publishes an
 *  отчет restating the appropriation at a CONSOLIDATED scope (€104,230,071)
 *  beside the law's single-scope €60,325,488; FY2023 has only the single figure
 *  (€58,632,703). Read on one basis the series is +2.9%; mixed, +77.8% — a
 *  ministry that appears to have grown by three quarters. */
const MOSV_ID = "admin-ministerstvo-na-okolnata-sreda-i-vodite";
const MOSV_NAME = "Министерство на околната среда и водите";

const MOSV = {
  nodeId: MOSV_ID,
  nameBg: MOSV_NAME,
  nameEn: "Ministry of Environment and Water",
  eik: "000697371",
  procurement: {
    nodeId: MOSV_ID,
    eik: "000697371",
    awarderName: MOSV_NAME,
    totalEur: 98_545_990.68,
    contractCount: 819,
    mpConnectedContractorCount: 1,
  },
  years: [
    {
      fiscalYear: 2023,
      revenue: m(21_749_845),
      expenditure: m(58_632_703),
      expenditureLaw: null,
      balance: null,
      programs: [],
      execution: null,
    },
    {
      fiscalYear: 2024,
      revenue: m(24_870_720),
      expenditure: m(104_230_071),
      expenditureLaw: m(60_325_488),
      balance: null,
      programs: [],
      execution: {
        expenditure: {
          planned: null,
          amended: m(252_817_539),
          executed: m(327_680_799),
        },
      },
    },
  ],
};

/** The shared personnel artifact `MinistryPersonnelBlock` reads. Minimal, but
 *  SHAPED — it does `Object.keys(data.byMinistry)`, so a stub answering every
 *  URL with the rollup crashes the block and empties the page. */
const PERSONNEL = {
  generatedAt: "2026-08-14",
  national: [],
  // МОСВ 2024, verbatim from `data/budget/personnel.json` with one programme
  // kept. Verbatim because the block reads `totalHeadcount.executed` and
  // `totalPersonnel.executed` — a hand-shaped entry crashes it, and a crash
  // inside a child empties the whole page and fails every assertion here for a
  // reason that has nothing to do with them.
  byMinistry: {
    "2024": [
      {
        adminId: "admin-ministerstvo-na-okolnata-sreda-i-vodite",
        avgAnnualCostPerFte: {
          amount: 35129,
          amountEur: 17961,
          currency: "BGN",
        },
        fiscalYear: 2024,
        nameBg: "Министерство на околната среда и водите",
        nameEn: "Ministry of Environment and Water",
        programmes: [
          {
            avgAnnualCostPerFte: {
              amount: 37119,
              amountEur: 18979,
              currency: "BGN",
            },
            code: "1900.01.01",
            headcount: {
              amended: 246,
              executed: 225,
              law: 243,
            },
            nameBg:
              "“Оценка, управление и опазване на водите на Република България",
            personnel: {
              amended: {
                amount: 8360999,
                amountEur: 4274911,
                currency: "BGN",
              },
              executed: {
                amount: 8351876,
                amountEur: 4270246,
                currency: "BGN",
              },
              law: {
                amount: 6602400,
                amountEur: 3375754,
                currency: "BGN",
              },
            },
          },
        ],
        totalHeadcount: {
          amended: 1841,
          executed: 1615,
          law: 1832,
        },
        totalPersonnel: {
          amended: {
            amount: 56893116,
            amountEur: 29088987,
            currency: "BGN",
          },
          executed: {
            amount: 56733149,
            amountEur: 29007198,
            currency: "BGN",
          },
          law: {
            amount: 52419600,
            amountEur: 26801716,
            currency: "BGN",
          },
        },
      },
    ],
  },
};

let payload: unknown = MOSV;

beforeEach(() => {
  payload = MOSV;
  // ⚠️ ROUTED BY URL. This page makes TWO fetches — its own pre-sliced rollup
  // and the shared personnel artifact — and a stub answering both with the same
  // body throws inside `MinistryPersonnelBlock` (`Object.keys(data.byMinistry)`
  // over a rollup) and blanks the page.
  //
  // Measured, that crash lands ~250 ms AFTER the ministry name, so a naive stub
  // still passes every assertion below — they all settle on the name. The
  // routing is about testing the page in the state it actually serves, not
  // about keeping this file green.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("personnel")
        ? { ok: true, status: 200, json: async () => PERSONNEL }
        : { ok: true, status: 200, json: async () => payload },
    ),
  );
});

const renderIt = (id = MOSV.nodeId) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/ministry/${id}`]}>
        <Routes>
          <Route
            path="/budget/ministry/:id"
            element={<BudgetMinistryScreen />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetMinistryScreen", () => {
  it("names the unit it is showing", async () => {
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
  });

  it("⚠️ reads the SERIES on one scope, so an отчет restatement is not growth", async () => {
    // The defect this page's basis split exists to prevent. FY2024's отчет
    // restates the appropriation at a consolidated scope; on that figure the
    // year-over-year chip would read +77.8% for a ministry whose law money grew
    // 2.9%. The series must use `expenditureLaw ?? expenditure`.
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    const body = nb(document.body.textContent);
    // ⚠️ POSITIVE FIRST. „no +77.8% anywhere" is satisfied by a page that
    // renders no chip at all — measured, deleting every YoY chip passed the
    // absence-only version. What discriminates is the LAW figure being on the
    // page: under the wrong basis €60 325 488 appears nowhere.
    expect(body).toContain("60 325 488");
    // …and the CHIP is present with the true delta. Without this the gate is
    // absence-only: measured, a mutant deleting every YoY chip passed it, since
    // „no +77.8% anywhere" is trivially true of a page with no chips.
    expect(body).toMatch(/\(\+2[.,]9\s?%\)/);
    expect(body).not.toMatch(/\+7[0-9](?:[.,]\d)?\s?%/);
  });

  it("keeps the TABLE on the basis its own columns share", async () => {
    // The other half, and why this is not simply „use one figure everywhere":
    // the per-year row shows amended and executed beside the appropriation, so
    // it must show the consolidated one — €104 230 071, the same basis as the
    // amended column next to it.
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    const body = nb(document.body.textContent);
    expect(body).toContain("104 230 071");
  });

  it("does not render a published balance of 0 as a balanced budget", async () => {
    // The budget law prints 0 where it set no separate self-financing target,
    // so without an ingested отчет a 0 means „unknown". Rendered as a figure it
    // asserts the unit broke exactly even.
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    // Two fixtures, because the hero renders the EXECUTION card when the latest
    // year has one — so the balance card, and the „Бюджетен излишък" headline a
    // rendered 0 would sit under, is unreachable from the default payload.
    for (const years of [MOSV.years, [MOSV.years[0]]]) {
      payload = { ...MOSV, years };
      const view = renderIt();
      await waitFor(() =>
        expect(nb(document.body.textContent)).toContain(MOSV_NAME),
      );
      const body = nb(document.body.textContent);
      // `\b` does not fire between „0" and a following digit, and the table
      // prints „€0" immediately before the next row's year.
      expect(body).not.toMatch(/€0(?!\d)/);
      expect(body).not.toContain("Бюджетен излишък");
      view.unmount();
    }
  });

  it("shows no YoY chip against a prior year of zero", async () => {
    // The third clause of the guard, and the one a single-year fixture cannot
    // reach: a ministry whose prior year is 0 would divide by it. `Math.abs(0)`
    // is 0, so the percentage is Infinity and renders as „∞%" beside a real
    // euro delta.
    payload = {
      ...MOSV,
      years: [
        { ...MOSV.years[0], expenditure: m(0), expenditureLaw: m(0) },
        MOSV.years[1],
      ],
    };
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    const body = nb(document.body.textContent);
    // `Number.POSITIVE_INFINITY.toFixed(1)` is the string „Infinity" — „∞" is
    // never produced by this page, so asserting on it proves nothing.
    expect(body).not.toContain("Infinity");
    expect(body).not.toMatch(/NaN/);
  });

  it("shows no YoY chip for the earliest year", async () => {
    // A ministry's first year has no prior, and the corpus also has a 2021 gap.
    // A chip against a missing baseline is arithmetic on nothing.
    //
    // Covered via the `prior == null` clause. The guard's `priorYear == null`
    // arm is unreachable from this page — the two are derived from the same
    // neighbouring row, so a present `prior` always has its year — and removing
    // it changes nothing here. Stated rather than left as a gap someone re-tests
    // and finds green.
    payload = { ...MOSV, years: [MOSV.years[0]] };
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    expect(nb(document.body.textContent)).not.toMatch(/vs 202\d|спрямо 202\d/);
  });

  it("survives a unit the rollup does not have", async () => {
    // 54 pages are prerendered from Postgres and the shard tree is written
    // separately; a slug present in one and not the other must not throw.
    payload = null;
    renderIt("admin-no-such-unit");
    // ⚠️ WAIT FOR THE QUERY TO SETTLE, not merely for something to be on screen.
    // Asserting as soon as the body is non-empty lands on the loading skeleton,
    // where „no `undefined`" is true of a page that has rendered nothing — a
    // mutant printing a literal `undefined` after load passed that.
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(document.querySelector(".animate-pulse")).toBeNull(),
    );
    const body = nb(document.body.textContent);
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("NaN");
    // …and it does not present another unit's name.
    expect(body).not.toContain(MOSV_NAME);
  });

  it("fetches ONE pre-sliced rollup, not the whole-corpus reconciliation", async () => {
    // The page's stated performance contract. It also pulls the shared
    // personnel artifact, which is one file for all 54 units and cached across
    // them — so the contract is about the RECONCILIATION tree, whose per-year
    // files this page must never touch.
    renderIt();
    await waitFor(() =>
      expect(nb(document.body.textContent)).toContain(MOSV_NAME),
    );
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(
      urls.filter((u) => u.includes(`ministries/${MOSV.nodeId}.json`)),
    ).toHaveLength(1);
    expect(urls.filter((u) => u.includes("reconciliation"))).toEqual([]);
    expect(urls.filter((u) => u.includes("by-admin"))).toEqual([]);
  });
});
