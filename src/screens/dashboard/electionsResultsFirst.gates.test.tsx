// Result-surface gates for dashboard-hub SKILL.md §3.0.1 — now on the RENDERED page.
//
// Election fronts are the documented exception to the ordinary tile hub's "no hero chart" rule:
// their first substantive answer is geography paired with a ranked result. This file used to pin
// that by SCANNING the two legacy compositions' source, because the shared canvas did not exist.
//
// ⚠ IT HAD TO CHANGE WHEN THE COUNTRY PAGE MIGRATED, and the change is the point rather than
// an inconvenience: the source scan asserted `<RegionsMapTile` and `<PartyResultsTile` sat in
// `DashboardCards`' first section, which is exactly the pair that BECAME the shell's canvas. A
// source gate can only ever pin the arrangement it was written against; the composed page is
// what a reader gets. §Phase 4 item 7 says so outright: "upgrade from legacy source scanning to
// rendered shell/descriptor assertions; retain a route-level anti-vacuity test".
//
// ⚠ THE LOCAL HALF IS STILL A SOURCE SCAN, deliberately. `LocalCountryDashboardCards` has not
// migrated yet, so its arrangement still lives in its own JSX and a rendered assertion would
// have nothing shared to assert against. It converts with that page.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { stripJsxComments } from "@/ux/infographic/stripJsxComments";
import { sourceSection as section } from "@/ux/infographic/sourceSection";
import { bgCorpus as bg } from "@/locales/allKeys";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { parliamentaryCountry } from "@/data/elections/fixtures/surfaceFixtures";
import { descriptorFor } from "@/screens/elections/electionSurfaceDescriptors";

const read = (path: string): string =>
  stripJsxComments(readFileSync(path, "utf8"));

/** The shell resolves party labels, so it needs a query client. Seeded EMPTY rather than with a
 *  corpus: these gates are about ARRANGEMENT, and a row header that resolves to nothing still
 *  renders — which is the point of `rankedLabel`'s `unresolved` arm. */
const draw = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bg } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

describe("the parliamentary country result is still results-first", () => {
  it("leads with a ranked result and a map, in that DOM order", () => {
    // The same claim the source scan made, made against the composed page: the ranked result
    // and the map are the first substantive thing, and the ranked half comes FIRST in the DOM
    // so the mobile order and the reading order are the same (grid placement, never `order`).
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} scope="header" />,
    );
    const canvas = container.querySelector("[data-outcome-canvas]")!;
    expect(canvas).toBeTruthy();
    expect(
      [...canvas.querySelectorAll("[data-canvas-slot]")].map((n) =>
        n.getAttribute("data-canvas-slot"),
      ),
    ).toEqual(["ranked", "map"]);
    expect(canvas.querySelector("[data-ranked-result]")).toBeTruthy();
  });

  it("puts the outcome facts BEFORE the canvas", () => {
    // §4's grammar: strip, then canvas. A canvas above the strip would make the first thing on
    // the page a map with no figure beside it.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} scope="header" />,
    );
    const html = container.innerHTML;
    expect(html.indexOf('data-surface-region="facts"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-surface-region="facts"')).toBeLessThan(
      html.indexOf("data-outcome-canvas"),
    );
  });

  it("draws the columns the country descriptor declares, not a fixed three", () => {
    // `elected` and `seats` are the substantive ones: a table showing only votes and share
    // leaves the reader to infer who took the mandates, which is what the page is for.
    const d = descriptorFor("parliamentary", "country");
    expect(d.available).toBe(true);
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} scope="header" />,
    );
    expect(
      [...container.querySelectorAll("[data-ranked-col]")].map((n) =>
        n.getAttribute("data-ranked-col"),
      ),
    ).toEqual([...(d.available ? d.rankedColumns : [])]);
  });

  it("ANTI-VACUITY: the screen mounts the shell, and the cards no longer duplicate it", () => {
    // ⚠ THE HALF A RENDERED TEST CANNOT SEE. Every assertion above renders the shell directly,
    // so all of them pass on a screen that stopped mounting it. And the four KPI cards and the
    // map/party pair had to LEAVE `DashboardCards` — §4 item 3 removes only numbers the strip
    // and canvas duplicate, and leaving them would print each of those figures twice.
    const screen = read("src/screens/DashboardScreen.tsx");
    expect(screen).toContain("<ElectionResultsShell");
    expect(screen).toContain("providedSurface={surface}");
    const cards = read("src/screens/dashboard/DashboardCards.tsx");
    for (const gone of [
      "<PartyChangeCard",
      "<TurnoutCard",
      "<PaperMachineCard",
      "<RegionsMapTile",
      "<PartyResultsTile",
    ])
      expect(cards, `${gone} is duplicated by the shell`).not.toContain(gone);
    // …and everything §4 item 3 preserves is still there.
    for (const kept of [
      "<MandatesTile",
      "<TopCandidatesStrip",
      "<WastedVoteTile",
      "<PersistenceTile",
      "<VoteFlowTile",
      "<TopRegionsTile",
    ])
      expect(cards, `${kept} was dropped by the migration`).toContain(kept);
  });
});

describe("local country dashboards remain results-first", () => {
  it("keeps separate mayor/council maps with the local regions result table", () => {
    const source = read(
      "src/screens/dashboard/local/LocalCountryDashboardCards.tsx",
    );
    const maps = section(source, 'id="local-maps"', 'id="local-mayors"');

    expect(maps).toMatch(
      /<LocalRegionsControlMapTile\s+cycle=\{cycle\}\s+metric="mayor"/,
    );
    expect(maps).toMatch(
      /<LocalRegionsControlMapTile\s+cycle=\{cycle\}\s+metric="council"/,
    );
    expect(maps).toContain("<LocalRegionsTable");
    expect(source.indexOf('id="local-mayors"')).toBeLessThan(
      source.indexOf('id="local-councils"'),
    );
  });
});
