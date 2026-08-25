// What a READER sees under each tile number on /funds.
//
// `fundsHubCoverage.test.ts` proves the CORPUS strings are honest — that no caption restates
// its tile's title, that none words a link as an allegation, that every percentage names its
// denominator. It cannot prove the screen renders them, and on the sibling hub it did not need
// to: deleting `metricCaption` from ProcurementScreen left every static gate green. A number
// with no basis under it, or with the wrong one, is the §0 defect the captions exist to
// prevent — so the rendered half needs its own gate.
//
// This mounts the real screen against a stubbed /api/db/funds-hub-stats, so the assertions are
// on the DOM a reader gets.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FundsScreen } from "../FundsScreen";

import { FUNDS_STATS_FIXTURE as STATS } from "./fundsHubStats.fixture";

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/funds"]}>
        <FundsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("funds-hub-stats"))
        return new Response(JSON.stringify(STATS), { status: 200 });
      // Everything else the hub reaches for (the index payload, the wire, open calls, the
      // resolver) may 404. That is deliberate: the tiles must caption their own figures with
      // the rest of the page degraded, which is also the first-paint state.
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** ⚠ i18n RESOLVES TO NOTHING HERE, so every assertion below is on the KEY. The harness loads
 *  no resource bundle — measured, this screen renders the literal `funds_tile_programmes` — and
 *  a first draft asserting the Bulgarian strings failed against a page that was rendering the
 *  captions correctly. That is the false red that gets a gate deleted rather than fixed.
 *
 *  The division of labour that follows is deliberate. THIS file proves the caption SLOT is
 *  populated and that the right key sits beside the right figure — the half `fundsHubCoverage`
 *  cannot see, and the half that stayed broken on the sibling hub when `metricCaption` was
 *  deleted. WORDING is `fundsHubCoverage.test.ts`'s job, over the corpus, where the strings are.
 */
const shows = (text: string) =>
  (document.body.textContent ?? "").includes(text);

/** The tiles paint before the stub resolves, so every assertion has to wait for it. Without
 *  this the file asserts against the first render and passes on nothing. */
const untilLoaded = () => waitFor(() => expect(shows("47")).toBe(true));

/** Both lookups are SCOPED TO THE TILE GRID. An unscoped `a[href]` query also sees the head:
 *  its first KPI cell links to /funds/beneficiaries and renders the same 53 122 the tile must
 *  not, so the duplication clause below would have been asserting against the wrong element —
 *  and passing only because `useFundsIndex` happens to 404 in this harness, i.e. for a reason
 *  that has nothing to do with what it checks. `ProcurementHubCaptions.test.tsx` carries the
 *  same scoping with a comment recording the same silent failure. */
const grid = (): Element => {
  const g = document.querySelector("[data-hub-grid]");
  if (!g) throw new Error("tile grid not rendered");
  return g;
};
const tileCarrying = (key: string): HTMLElement | undefined =>
  [...grid().querySelectorAll("a[href]")].find((a) =>
    (a.textContent ?? "").includes(key),
  ) as HTMLElement | undefined;
const tileHref = (to: string): HTMLElement | undefined =>
  [...grid().querySelectorAll("a[href]")].find(
    (a) => (a.getAttribute("href") ?? "").split("?")[0] === to,
  ) as HTMLElement | undefined;

describe("/funds tile captions", () => {
  it("gives every figure a caption slot, populated", async () => {
    mount();
    await untilLoaded();

    // Deleting `metricCaption` from the tile mapping removes exactly these.
    for (const key of [
      "funds_m_programmes",
      "funds_m_flagged",
      "funds_m_dossiers",
      "funds_m_both_corpora",
      "funds_m_concentrated",
      "funds_m_placed",
      "funds_m_paid_of_grant",
      "funds_m_rrf_contracted",
      "funds_m_bg_projects",
    ])
      expect(
        shows(key),
        `${key} never reaches the DOM — that tile's figure renders with no basis`,
      ).toBe(true);
  });

  it("prints the figure each caption belongs to", async () => {
    mount();
    await untilLoaded();

    // 47 and 18 are both programme counts and mean different things („оперативни програми в
    // ИСУН" against „програми с висока концентрация"), which is why the PAIR is the assertion
    // and the number alone is not. Located by walking up from the caption to the tile.
    for (const [figure, key] of [
      ["47", "funds_m_programmes"],
      ["279", "funds_m_flagged"],
      ["5", "funds_m_dossiers"],
      ["18", "funds_m_concentrated"],
      ["5693", "funds_m_both_corpora"],
    ] as const) {
      const tile = tileCarrying(key);
      expect(tile, `no tile carries ${key}`).toBeTruthy();
      // WHOLE digit runs, compared as a SET — never substring containment over the stripped
      // text. „47" is a substring of „47617", so a programmes tile wrongly wired to
      // `beneficiaryCount` satisfied the old form and this file stayed green through exactly
      // the defect its fixture comment claims to catch. „5" was satisfiable by ten of them.
      //
      // The group separator is whatever the unresolved i18n language picks („5,693"), and on
      // the live page it is a Bulgarian U+00A0 („5 693"), so the runs are taken after the
      // separators are removed rather than from the formatted string.
      const runs = new Set(
        ((tile!.textContent ?? "")
          .replace(/[\s,\u00a0\u202f]/g, "")
          .match(/\d+/g) ?? []) as string[],
      );
      expect(
        [...runs],
        `the tile captioned ${key} does not print ${figure}`,
      ).toContain(figure);
    }
  });

  it("gives the beneficiaries tile no figure, because the head already has it", async () => {
    mount();
    await untilLoaded();
    // §3.1 rule 5, in the DOM. `tiles.registerBeneficiaries` and the head's first KPI cell are
    // the same 53 122; the resolution was to drop it from the TILE.
    const tile = tileHref("/funds/beneficiaries");
    expect(tile, "no beneficiaries tile").toBeTruthy();
    expect(
      (tile!.textContent ?? "").replace(/\D/g, ""),
      "the beneficiaries tile prints the figure the KPI band already shows",
    ).not.toContain("53122");
  });
});
