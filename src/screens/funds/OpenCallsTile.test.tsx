// The open-calls tile's render branching — the four invariants that are only testable here.
//
// Every case below is a false STATEMENT the tile could make, not a layout preference:
//   1. a failed fetch rendering as „няма отворени процедури" + „още не е зареждан"  (inv. 3)
//   2. an indicative ДФЗ forecast rendering a countdown                             (inv. 2)
//   3. a not-yet-open call rendering as open, with time left to apply               (inv. 2)
//   4. a heading count taken from the returned page rather than the group
// Each one renders confidently and correctly, which is why they need a gate rather than a look.

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import type { ReactNode } from "react";
import type {
  OpenCallRow,
  OpenCallsResponse,
} from "@/data/opencalls/useOpenCalls";

const hook = vi.hoisted(() => ({
  mode: "ok" as "ok" | "loading" | "error",
  data: null as OpenCallsResponse | null,
}));

vi.mock("@/data/opencalls/useOpenCalls", async (orig) => ({
  // The pure helpers (newestCrawl / crawlAgeHours / formatSofiaStamp) stay REAL — they have
  // their own unit tests and stubbing them would hide the freshness branch this file checks.
  ...(await orig<typeof import("@/data/opencalls/useOpenCalls")>()),
  useOpenCalls: () => ({
    data: hook.mode === "ok" ? hook.data : undefined,
    isLoading: hook.mode === "loading",
    isError: hook.mode === "error",
  }),
}));

const { OpenCallsTile } = await import("./OpenCallsTile");

// The SHIPPED bg bundle, not a stub. Without it `t()` returns the KEY — which is truthy, so the
// component's `t(k) || "fallback"` never fires and every assertion below would be checking
// „oc_days_left" rather than „остават 37 дни". It also means a renamed `{{when}}` / `{{count}}`
// placeholder fails HERE instead of leaving „{{when}}" on the page.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const row = (over: Partial<OpenCallRow> = {}): OpenCallRow => ({
  id: 1,
  source: "isun",
  sourceKey: `k${over.id ?? 1}`,
  code: "BG16RFPR001-1.011",
  kind: "call",
  title: "Внедряване на иновации",
  programmeName: "Програма „Конкурентоспособност“",
  status: "open",
  opensAt: null,
  closesAt: "2026-09-14T13:30:00.000Z",
  periodLabel: null,
  daysLeft: 37,
  budgetEur: null,
  aidRatePct: null,
  grantMaxEur: null,
  audience: [],
  sourceUrl: "https://eumis2020.government.bg/x",
  enrichment: "none",
  ...over,
});

const payload = (over: Partial<OpenCallsResponse> = {}): OpenCallsResponse => ({
  calls: [row()],
  indicative: [],
  consultations: [],
  // A fresh crawl relative to the frozen clock below.
  crawl: [
    {
      source: "isun",
      crawledAt: "2026-08-08T03:00:00.000Z",
      rowsSeen: 55,
      ok: true,
      note: null,
    },
  ],
  totals: { calls: 1, indicative: 0, consultations: 0 },
  ...over,
});

const mount = () =>
  render(<OpenCallsTile />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/funds"]}>{children}</MemoryRouter>
    ),
  });

beforeEach(() => {
  hook.mode = "ok";
  hook.data = payload();
  // The staleness branch and the year-elision branch both read the clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T09:00:00.000Z"));
});

describe("failure is not emptiness", () => {
  it("renders NOTHING on a fetch error, rather than asserting an empty register", () => {
    // The bug: `data ?? EMPTY` let a 500 render „В момента няма отворени процедури" AND
    // „Списъкът още не е зареждан" — two false statements, on the one page where being wrong
    // costs a reader a deadline.
    hook.mode = "error";
    const { container } = mount();
    expect(container.textContent).toBe("");
  });

  it("renders NOTHING while loading", () => {
    hook.mode = "loading";
    const { container } = mount();
    expect(container.textContent).toBe("");
  });

  it("does name an empty group when the register really is empty", () => {
    // The distinction the error branch protects: zero rows WITH a successful crawl is a fact
    // worth stating, and must still be stated.
    hook.data = payload({
      calls: [],
      totals: { calls: 0, indicative: 0, consultations: 0 },
    });
    mount();
    expect(screen.getByText(/няма отворени процедури/iu)).toBeTruthy();
  });
});

describe("freshness (invariant 3)", () => {
  it("names the check time when a crawl has run", () => {
    mount();
    // 03:00Z is 06:00 in Sofia.
    expect(screen.getByText(/Проверено на .*06:00/u)).toBeTruthy();
  });

  it("SAYS the list may be out of date past the SLA", () => {
    hook.data = payload({
      crawl: [
        {
          source: "isun",
          crawledAt: "2026-08-01T03:00:00.000Z",
          rowsSeen: 55,
          ok: true,
          note: null,
        },
      ],
    });
    mount();
    expect(
      screen.getByText(/може да не е актуален|out of date/iu),
    ).toBeTruthy();
  });

  it("says so when nothing has EVER run, instead of implying currency", () => {
    hook.data = payload({ crawl: [] });
    mount();
    expect(
      screen.getByText(/още не е зареждан|not been loaded/iu),
    ).toBeTruthy();
  });

  it("treats a FAILED crawl as never-checked, not as a check", () => {
    hook.data = payload({
      crawl: [
        {
          source: "isun",
          crawledAt: "2026-08-08T03:00:00.000Z",
          rowsSeen: 0,
          ok: false,
          note: "block",
        },
      ],
    });
    mount();
    expect(screen.queryByText(/Проверено на/u)).toBeNull();
  });
});

describe("an indicative window is not a deadline (invariant 2)", () => {
  it("shows the period and NO countdown", () => {
    hook.data = payload({
      calls: [],
      indicative: [
        row({
          id: 2,
          source: "sp2023",
          code: "II.Г.14",
          title: "Първична преработка на дървесина",
          status: "indicative",
          closesAt: null,
          daysLeft: null,
          periodLabel: "В периода март-май за срок не по-кратък от 60 дни",
          budgetEur: 10_000_000,
          aidRatePct: 65,
          enrichment: "source",
        }),
      ],
      totals: { calls: 0, indicative: 1, consultations: 0 },
    });
    mount();
    expect(screen.getByText(/В периода март-май/u)).toBeTruthy();
    expect(screen.queryByText(/остават/u)).toBeNull();
    // Its money IS shown — the ДФЗ XLSX publishes it structurally, so enrichment is 'source'.
    expect(screen.getByText(/10 000 000/u)).toBeTruthy();
  });
});

describe("a not-yet-open call is not open (invariant 2's sibling case)", () => {
  it("names the start date and shows no time-left", () => {
    // It rides in the calls group by design (one section). Without a marker it reads as open
    // with a countdown, i.e. as time left to APPLY — latent today only because ИСУН publishes
    // no upcoming rows.
    hook.data = payload({
      calls: [
        row({
          id: 3,
          status: "upcoming",
          opensAt: "2026-10-01T07:00:00.000Z",
          closesAt: "2026-12-01T13:30:00.000Z",
          daysLeft: 115,
        }),
      ],
    });
    mount();
    // „1.10" and not „1 окт": bg-BG renders `month: "short"` as a NUMBER. That is also why the
    // formatter spells the year out whenever it is not the current one.
    expect(screen.getByText(/от 1\.10, 10:00/u)).toBeTruthy();
    expect(screen.queryByText(/остават/u)).toBeNull();
  });
});

describe("a consultation deadline is for comments (invariant 7)", () => {
  it("prefixes the chip rather than reusing the application wording", () => {
    hook.data = payload({
      calls: [],
      consultations: [
        row({
          id: 4,
          kind: "consultation",
          status: "consultation",
          daysLeft: 3,
        }),
      ],
      totals: { calls: 0, indicative: 0, consultations: 1 },
    });
    mount();
    expect(screen.getByText(/коментари до/u)).toBeTruthy();
    // And no urgency emphasis: „3 days left to comment" is not the same kind of deadline.
    expect(screen.queryByText(/остават/u)).toBeNull();
  });
});

describe("counts describe the GROUP, not the page", () => {
  it("shows the group total beside the heading and names the remainder", () => {
    // The defect: `rows.length` announced 20 (the fetch limit) beside a /funds/calls page
    // showing 45.
    hook.data = payload({
      calls: [1, 2, 3, 4, 5].map((n) => row({ id: n })),
      totals: { calls: 45, indicative: 0, consultations: 0 },
    });
    mount();
    expect(screen.getByText("45")).toBeTruthy();
    // 45 − 5 rendered.
    expect(screen.getByText("+40")).toBeTruthy();
  });

  it("renders no count for an empty group, rather than a bare 0", () => {
    hook.data = payload({
      calls: [],
      totals: { calls: 0, indicative: 0, consultations: 0 },
    });
    mount();
    expect(screen.queryByText("0")).toBeNull();
  });
});
