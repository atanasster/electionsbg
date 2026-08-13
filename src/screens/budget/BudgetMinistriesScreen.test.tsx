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
    eik: "1",
    amount: 2568607900,
    hasExecution: true,
  },
  {
    nodeId: "admin-president",
    nameBg: "Администрация на президента",
    nameEn: "President",
    eik: null,
    amount: 6595100,
    hasExecution: false,
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

beforeEach(() => {
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
        : { ok: true, json: async () => ({ rows: ROWS }) },
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

  it("links every row to its own page", async () => {
    renderAt();
    const link = await screen.findByText("Министерство на отбраната");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/ministry/admin-mo",
    );
  });
});
