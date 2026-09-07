// Where `/governance/mayor-pay` lives in the header, and why it lives there exactly once.
//
// ⚠ THIS FILE USED TO ASSERT THE OPPOSITE, and the change is deliberate. The leaf had TWO
// homes — canonical under Governance, plus a contextual copy in the elections menu directly
// after the mayor leaderboard („a reader looking at who won a mayoralty is one click from what
// that office pays") — and this test pinned that adjacency. The dropdowns are now the hub tile
// registries' own contents, one leaf per tile and no others (`hubMenuCoverage.test.ts`), so a
// GOVERNANCE destination sitting in the elections menu is the one thing that rule forbids.
//
// ⚠ NOTHING WAS STRANDED BY THE PRUNE, which is the only reason it could happen: the page
// keeps its `/governance` hub tile (`hubRegistry.test.ts` holds it), its own `mp_page_title`
// leaf under Власт и отчетност, its prerendered page and its sitemap `<loc>`. If the
// contextual cross-link is ever wanted back, it goes in `MENU_ONLY` in
// `hubMenuCoverage.test.ts` with its reason — not silently.
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { electionsMenu, governanceMenu, type MenuItem } from "./reportMenus";

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => [item, ...flatten(item.subMenu ?? [])]);

describe("header report menus", () => {
  test("gives mayor pay exactly one home, under Governance", () => {
    const governanceLinks = flatten(governanceMenu).filter(
      (item) => item.link === "/governance/mayor-pay",
    );
    assert.deepEqual(
      governanceLinks.map((item) => item.title),
      ["mp_page_title"],
    );
  });

  test("keeps the governance leaf out of the elections menu", () => {
    // ⚠ BY DESTINATION, NOT BY KEY. The copy that used to sit here carried a DIFFERENT title
    // (`mp_local_menu_title`), so a test asserting the key's absence would pass on a
    // reintroduction under the canonical one.
    const strays = flatten(electionsMenu).filter((item) =>
      item.link?.startsWith("/governance/"),
    );
    assert.deepEqual(
      strays.map((item) => item.link),
      [],
      "a Governance destination is back in the Elections dropdown",
    );
  });

  test("every elections leaf is scoped to an election surface", () => {
    // The positive half of the rule above: what the merged menu may contain. Without it,
    // „no /governance/*" is satisfied by a leaf pointing anywhere else off-section.
    const leaves = flatten(electionsMenu).filter(
      (item) => item.link && item.title !== "-",
    );
    assert.ok(leaves.length > 10, "the elections menu came back empty");
    const off = leaves
      .map((item) => item.link as string)
      .filter(
        (link) =>
          !/^\/(elections|parliamentary|presidential|local|sverka)(\/|$)/.test(
            link,
          ),
      );
    assert.deepEqual(off, []);
  });
});
