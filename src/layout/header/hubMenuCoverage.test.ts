// Every hub tile has a header-menu leaf, and every menu leaf has a hub tile.
//
// ⚠ THE MENUS AND THE REGISTRIES ARE TWO HAND-KEPT LISTS OF THE SAME THING, and nothing
// compared them until 2026-09-07. What that allowed, measured on that day:
//
//   • FOURTEEN of `/governance`'s twenty-five tiles had no menu entry — /council,
//     /governments, /persons, /connections, /companies, all six /indicators domains,
//     /demographics, the tax calculator and the simulator.
//   • The consumption menu's „Карта на цените" leaf opened `/prices`, which is the BASKET
//     hub and another tile's destination, while the real map (`/prices/map`) and
//     `/consumption/unit-prices` had no leaf at all. One label named the wrong page.
//
// None of it was UNREACHABLE — every destination had some surface — which is exactly why no
// existing gate saw it: `menuCopy.test.ts` checks that a leaf's title resolves, and the hub
// screens' own tests check that their tiles render. Neither can ask whether the two agree.
//
// ⚠ THE COMPARISON IS ON PATHNAME, not on the raw `to`. Three consumption tiles are `#hash`
// anchors into `/consumption/overview` — distinct questions on one page — and a leaf per
// anchor would be four menu entries opening the same page. A `?query` is dropped for the same
// reason. That means this gate cannot see a menu leaf that lost a needed hash or scope; those
// belong to the hub's own tests, which read the full destination.
//
// ⚠ THE TWO SETS ARE EQUAL, not merely overlapping. `MENU_ONLY` below is the seam for a
// deliberate cross-link and it is EMPTY, which is the correct state rather than a leftover:
// the elections menu carried two extras until 2026-09-07 (`independents`, and
// `/governance/mayor-pay` beside the mayor leaderboard) and both were pruned once their other
// surfaces were verified. The map stays because a future cross-link needs somewhere to be
// declared WITH ITS REASON, and because the „no stale entry" arm re-checks each listed path is
// still tile-less — so an exception cannot outlive the tile that made it unnecessary.
import { describe, expect, it } from "vitest";
import { balanceGroups } from "./headerSection";
import {
  consumptionMenu,
  electionsMenu,
  governanceMenu,
  type MenuItem,
} from "./reportMenus";
import { ELECTIONS_TILES } from "@/screens/elections/electionsRegistry";
import { GOV_HUB_CLUSTERS } from "@/screens/governance/governanceRegistry";
import { CONSUMPTION_TILES } from "@/screens/consumption/consumptionRegistry";

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((i) => [i, ...flatten(i.subMenu ?? [])]);

/** `to` reduced to the page it opens — see the header for why the hash and query go. */
const page = (to: string) => to.split("#")[0].split("?")[0];

/** The links a reader can actually reach in the section's dropdown. */
const menuPages = (menu: MenuItem[]) =>
  new Set(
    flatten(menu)
      .filter((i) => i.link && i.title !== "-")
      .map((i) => page(i.link as string)),
  );

const GOV_TILES = GOV_HUB_CLUSTERS.flatMap((c) => c.tiles);

/**
 * Destinations a menu carries that its own hub does not.
 *
 * ⚠ EVERY ENTRY IS RE-CHECKED as still menu-only, so a tile that has since been added turns
 * this file RED rather than leaving a stale excuse behind.
 */
const MENU_ONLY: Record<string, Record<string, string>> = {
  elections: {},
  governance: {},
  consumption: {},
};

describe.each([
  ["elections", electionsMenu, ELECTIONS_TILES.map((t) => t.to)],
  ["governance", governanceMenu, GOV_TILES.map((t) => t.to)],
  ["consumption", consumptionMenu, CONSUMPTION_TILES.map((t) => t.to)],
])("%s: the dropdown and the hub tiles", (name, menu, tiles) => {
  const links = menuPages(menu);
  const tilePages = new Set(tiles.map(page));

  it("is not vacuous", () => {
    // A flatten that stopped recursing, or a registry import that came back empty, would make
    // both assertions below pass over nothing.
    expect(tilePages.size).toBeGreaterThan(10);
    expect(links.size).toBeGreaterThan(10);
  });

  it("offers every hub tile as a menu leaf", () => {
    const missing = [...tilePages].filter((p) => !links.has(p));
    expect(
      missing,
      `${name}: hub tiles with no menu leaf — ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("carries no menu leaf without a tile, beyond the declared exceptions", () => {
    const allow = MENU_ONLY[name];
    const extra = [...links].filter(
      (p) =>
        !tilePages.has(p) &&
        // The section's own home is the split-button's destination, not a tile.
        p !== (menu[0].link ?? "") &&
        !Object.keys(allow).some((k) => p.endsWith(k)),
    );
    expect(
      extra,
      `${name}: menu leaves with no hub tile — ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("has no stale entry in MENU_ONLY", () => {
    const stale = Object.keys(MENU_ONLY[name]).filter((k) =>
      [...tilePages].some((p) => p.endsWith(k)),
    );
    expect(
      stale,
      `${name}: MENU_ONLY names a destination that now HAS a tile — ${stale.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the group headings", () => {
  const headings = (menu: MenuItem[]) =>
    (menu[0].subMenu ?? []).filter((i) => i.group).map((i) => i.title);

  it("are the hubs' own section keys, in section order", () => {
    // ⚠ THE KEYS, NOT THE LABELS. Reading the registry's own `labelKey` is what stops the
    // menu and the hub describing the same page under two different section names — the rule
    // `electionsMenu.test.ts` already states for the `/elections` bands, extended to the two
    // dropdowns that had no groups at all.
    expect(headings(governanceMenu)).toEqual(
      GOV_HUB_CLUSTERS.map((c) => c.labelKey),
    );
  });

  it("cover consumption too", async () => {
    const { CONSUMPTION_SECTIONS } =
      await import("@/screens/consumption/consumptionRegistry");
    expect(headings(consumptionMenu)).toEqual(
      CONSUMPTION_SECTIONS.map((s) => s.labelKey),
    );
  });
});

describe("the two-column layout", () => {
  const groupsOf = (menu: MenuItem[]) =>
    (menu[0].subMenu ?? []).filter((i) => i.group);
  const rowsOf = (g: MenuItem) => (g.subMenu?.length ?? 0) + 1;

  it("is on every top menu, or on none of them", () => {
    // ⚠ THE AUDIT THAT ADDED IT TO ИЗБОРИ. Потребление carried `columns: 2` for 13 leaves
    // while Избори rendered 16 in ONE column — the menu with the most leaves and the longest
    // labels was the only single-column one, and it measured 677px tall at a 900px viewport,
    // i.e. already scrolling inside its own panel. Asserting the CLASS rather than each menu
    // is what stops the next dropdown picking a layout by accident.
    const cols = [electionsMenu, governanceMenu, consumptionMenu].map(
      (m) => m[0].columns,
    );
    expect(new Set(cols).size, `mixed layouts: ${cols.join(", ")}`).toBe(1);
    expect(cols[0]).toBe(2);
  });

  it("puts each menu's first section top-left", () => {
    // The property `balanceGroups` gives up balance for — see its header. A reader opening a
    // dropdown must find the section the hub declares first in the first column.
    for (const menu of [electionsMenu, governanceMenu, consumptionMenu]) {
      const groups = groupsOf(menu);
      expect(balanceGroups(groups)[0][0].title).toBe(groups[0].title);
    }
  });

  it("splits every menu without stranding a column", () => {
    for (const menu of [electionsMenu, governanceMenu, consumptionMenu]) {
      const groups = groupsOf(menu);
      const cols = balanceGroups(groups);
      expect(cols.length, "a column came back empty").toBe(2);
      // Every group lands exactly once, in declaration order within its column.
      expect(
        cols
          .flat()
          .map((g) => g.title)
          .sort(),
      ).toEqual(groups.map((g) => g.title).sort());
      for (const col of cols) {
        const order = col.map((g) => groups.indexOf(g));
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }
      // ⚠ A CEILING ON THE TALLER COLUMN, not an equality. Declaration order caps how even
      // the split can be — Потребление's first section is 7 of its 17 rows — so the check is
      // that no column runs away with the panel, which is what a scrolling menu looks like.
      const heights = cols.map((c) => c.reduce((n, g) => n + rowsOf(g), 0));
      expect(Math.max(...heights)).toBeLessThanOrEqual(
        Math.ceil(groups.reduce((n, g) => n + rowsOf(g), 0) * 0.65),
      );
    }
  });
});
