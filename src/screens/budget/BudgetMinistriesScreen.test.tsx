// Gates for /budget/ministries — the picker.
//
// The claims worth pinning are about NAMING and COVERAGE, not layout:
//
//   * These are първостепенни разпоредители, and 28 of 48 are not ministries.
//     A page that calls them ministries is wrong about more than half its rows.
//   * Most units have a plan and no execution report. Stated up front, that is
//     the ministry's silence; left implicit, a reader assumes the rest spent
//     nothing.
//   * `?q` must be READ. The hub finder's „see all" lands here, and a
//     destination that ignores the param advertises a filtered page and serves
//     an unfiltered one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bg from "@/locales/bg/translation.json";
import { BudgetMinistriesScreen } from "./BudgetMinistriesScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // `i18n` is not decoration: the screen formats the contract count with
    // `toLocaleString(i18n.language)`, so a mock without it throws on render and
    // every test in the file goes red with an empty body.
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const dict = bg as Record<string, string>;
      // Resolve i18next's plural suffixes the way the real runtime does, so a
      // broken plural key fails here instead of silently rendering nothing.
      const key =
        typeof o?.count === "number"
          ? ((dict[`${k}_${o.count === 1 ? "one" : "other"}`] &&
              `${k}_${o.count === 1 ? "one" : "other"}`) ??
            k)
          : k;
      const raw = dict[key] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const ROWS = [
  {
    nodeId: "admin-mo",
    nameBg: "Министерство на отбраната",
    nameEn: "MoD",
    eik: "000695324",
    amount: 2568607900,
    hasExecution: true,
    procurementEur: 165643365.56,
    procurementCount: 115,
    mpContractorCount: 2,
    // A SYNTHETIC carrier for the shared-EIK state, not Земеделието itself —
    // that is the only real instance (EIK 831909905, „Министерство на
    // земеделието" and „…и храните" across a rename) and МО's real count is 1.
    // Put here so one fixture row exercises both the amber chip and the caveat.
    eikNodeCount: 2,
  },
  {
    nodeId: "admin-president",
    nameBg: "Администрация на президента",
    nameEn: "President",
    eik: "000695235",
    amount: 6595100,
    hasExecution: false,
    // Buys, and nothing it bought is politician-linked — the common case, and
    // the one that must not render a „0 politically linked" chip.
    procurementEur: 4127315.12,
    procurementCount: 35,
    mpContractorCount: 0,
    eikNodeCount: 1,
  },
  // Listed so its page stays reachable, but NOT budgeted this year — so it must
  // not enter the denominator of a coverage claim.
  {
    nodeId: "admin-gone",
    nameBg: "Ведомство без бюджет",
    nameEn: "Defunct",
    eik: null,
    amount: null,
    hasExecution: false,
    // UNMATCHED to a procurement buyer — 2 of 48 units. Not „bought nothing".
    procurementEur: null,
    procurementCount: null,
    mpContractorCount: null,
    eikNodeCount: null,
  },
];

const renderAt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/ministries${search}`]}>
        <BudgetMinistriesScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Reset to ROWS in beforeEach; a test that needs a different shape assigns to
 *  it before rendering. */
let payload: unknown[] = ROWS;

beforeEach(() => {
  payload = ROWS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2026,
              yearsAvailable: [2025, 2026],
            }),
          }
        : { ok: true, json: async () => ({ rows: payload }) },
    ),
  );
});

describe("BudgetMinistriesScreen", () => {
  it("does not call the units ministries", async () => {
    renderAt();
    const intro = await screen.findByText(/първостепенните разпоредители/i);
    // The intro must NAME the non-ministries, or the page's own list contradicts
    // its framing on more than half its rows.
    expect(intro.textContent).toMatch(/не само министерства/i);
    expect(intro.textContent).toMatch(/Администрацията на президента/);
  });

  it("states the execution coverage rather than implying it", async () => {
    renderAt();
    // 1 of 2 in the fixture. The sentence has to carry both numbers.
    // The sentence is built from two i18n strings in one <p>, so assert on the
    // paragraph rather than on whichever text node the matcher happens to pick.
    const line = (await screen.findByText(/публикували отчет/i)).closest("p")!;
    // 1 of the 2 that HAVE a plan — not 1 of 3. A unit the year never budgeted
    // must not sit in the denominator of a coverage claim.
    expect(line.textContent).toMatch(/1 от 2/);
    expect(line.textContent).not.toMatch(/1 от 3/);
    expect(line.textContent).toMatch(/само план/i);
    // …and the ones outside the year are accounted for rather than hidden.
    // Singular form at n = 1 — „Още 1 разпоредители" does not agree in Bulgarian.
    expect(line.textContent).toMatch(/Още един разпоредител е в списъка/);
  });

  it("reads ?q and sends it to the server", async () => {
    renderAt("?q=отбрана");
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("budget-ministries"));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[urls.length - 1]).toMatch(
        /q=%D0%BE%D1%82%D0%B1%D1%80%D0%B0%D0%BD%D0%B0/,
      );
    });
  });

  it("chips only the units that actually reported", async () => {
    renderAt();
    // Await the rows: querying synchronously reads an empty container and the
    // assertion passes or fails for reasons unrelated to the chip.
    await screen.findByText("Министерство на отбраната");
    const chips = document.querySelectorAll("span.bg-emerald-100");
    // One of the three fixture rows has hasExecution — inverting the condition
    // must not leave this green.
    expect(chips.length).toBe(1);
    expect(chips[0].closest("a")?.getAttribute("href")).toBe(
      "/budget/ministry/admin-mo",
    );
  });

  it("suppresses the coverage claim while a search is active", async () => {
    // `rows` is server-FILTERED, so a coverage sentence over it is a claim about
    // every spending unit rendered from one hit.
    renderAt("?q=отбрана");
    await screen.findByText("Министерство на отбраната");
    expect(screen.queryByText(/публикували отчет/i)).toBeNull();
  });

  // ── T9.9 · the procurement cross-link ────────────────────────────────────
  it("shows what each unit BOUGHT beside what it was given", async () => {
    // The only path on this page from a spending unit to who received the
    // money. Both figures come from migration 157 and are scoped to the SAME
    // fiscal year as the appropriation on the row above.
    renderAt();
    await screen.findByText("Министерство на отбраната");
    const body = document.body.textContent!;
    expect(body).toContain("115 договора");
    expect(body).toContain("35 договора");
  });

  it("flags a politically linked contractor, and ONLY where there is one", async () => {
    renderAt();
    await screen.findByText("Министерство на отбраната");
    const amber = [...document.querySelectorAll("span")].filter((n) =>
      (n.className || "").includes("text-amber-700"),
    );
    // МО has 2; the presidency has 0 and must render no chip — a „0 politically
    // linked" on every other row turns the signal into furniture.
    expect(amber.length).toBe(1);
    expect(amber[0].textContent).toContain("2");
  });

  it("stays SILENT for a unit unmatched to any awarder — never €0", async () => {
    // 5 of 48 budgeted units carry no EIK. „Bought nothing" is a claim the name
    // match cannot support, and it is the damaging direction: a reader takes it
    // as a ministry that awards no contracts.
    renderAt();
    await screen.findByText("Ведомство без бюджет");
    const row = [...document.querySelectorAll("li")].find((li) =>
      (li.textContent ?? "").includes("Ведомство без бюджет"),
    )!;
    expect(row.textContent).not.toContain("договор");
    expect(row.textContent).not.toMatch(/€0\b/);
    // …and specifically NOT the „no contracts this year" sentence, which would
    // be asserting something about a unit we never matched.
    expect(row.textContent).not.toContain("няма отчетени договори");
  });

  it("SAYS SO for a MATCHED unit with no award in the window", async () => {
    // The other absence, and the reason the two are separated: 3 of the 8 units
    // with no footprint row DO carry an EIK, so „no contracts recorded in 2024"
    // is a fact about the year rather than a gap in the match. Collapsing the
    // two — which the first cut did — renders them identically and throws the
    // distinction away.
    payload = ROWS.map((r) =>
      r.nodeId === "admin-president"
        ? {
            ...r,
            procurementEur: null,
            procurementCount: null,
            mpContractorCount: null,
          }
        : r,
    );
    renderAt();
    await screen.findByText("Администрация на президента");
    const row = [...document.querySelectorAll("li")].find((li) =>
      (li.textContent ?? "").includes("Администрация на президента"),
    )!;
    expect(row.textContent).toContain("няма отчетени договори");
  });

  it("groups the contract count, like the euro figure beside it", async () => {
    // The live max is 5,771 and bg-BG groups only from five digits, so the
    // fixture has to reach 10 000 for this to be visible at all — which is why
    // the raw interpolation („€165 643 366 по 5771 договора": one number grouped,
    // the other not) survived the first cut.
    payload = ROWS.map((r) =>
      r.nodeId === "admin-mo" ? { ...r, procurementCount: 12345 } : r,
    );
    renderAt();
    await screen.findByText("Министерство на отбраната");
    const row = [...document.querySelectorAll("li")].find((li) =>
      (li.textContent ?? "").includes("Министерство на отбраната"),
    )!;
    expect(row.textContent?.replace(/\u00a0/g, " ")).toContain("12 345");
  });

  it("uses the SINGULAR when a unit signed exactly one contract", async () => {
    // 42 rows on the live table have contract_count = 1, and the base key —
    // with no _one/_other pair — rendered the plural form on every one of them.
    payload = ROWS.map((r) =>
      r.nodeId === "admin-president"
        ? { ...r, procurementCount: 1, procurementEur: 12345 }
        : r,
    );
    renderAt();
    await screen.findByText("Администрация на президента");
    const row = [...document.querySelectorAll("li")].find((li) =>
      (li.textContent ?? "").includes("Администрация на президента"),
    )!;
    expect(row.textContent).toContain("1 договор");
    expect(row.textContent).not.toContain("1 договора");
  });

  it("sends the procurement figure to the awarder page that holds it", async () => {
    // The figure is a sum over `contracts` by awarder EIK, and /awarder/:eik is
    // where those contracts are listed — so the number is checkable rather than
    // asserted.
    renderAt();
    await screen.findByText("Министерство на отбраната");
    const href = [...document.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => h.startsWith("/awarder/"));
    expect(href).toBe("/awarder/000695324");
  });

  it("says when a footprint is shared, so nobody sums two rows", async () => {
    // „Министерство на земеделието" and „Министерство на земеделието и храните"
    // are one ministry across a rename: both are in the registry, both carry the
    // SAME appropriation in 2023 and 2024, and — since the footprint belongs to
    // the EIK — both carry the same €107.6m over 886 contracts. Adding them
    // gives €215m. Each figure is right; the risk is arithmetic.
    renderAt();
    await screen.findByText("Министерство на отбраната");
    const shared = [...document.querySelectorAll("span")].filter((n) =>
      (n.textContent ?? "").includes("не ги сумирайте"),
    );
    // Exactly the one fixture row with eikNodeCount > 1.
    expect(shared.length).toBe(1);
    expect(shared[0].closest("li")?.textContent).toContain(
      "Министерство на отбраната",
    );
  });

  it("links every row to its own page", async () => {
    renderAt();
    const link = await screen.findByText("Министерство на отбраната");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/ministry/admin-mo",
    );
  });
});
