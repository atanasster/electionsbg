import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { electionsMenu, governanceMenu, type MenuItem } from "./reportMenus";

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => [item, ...flatten(item.subMenu ?? [])]);

describe("header report menus", () => {
  test("exposes mayor pay from governance and local elections", () => {
    const governanceLinks = flatten(governanceMenu).filter(
      (item) => item.link === "/governance/mayor-pay",
    );
    // ⚠ THE SECOND HOME IS THE MERGED ELECTIONS MENU. It was `localMenu` until Phase 3 folded
    // the two election menus into one; the leaf did not move, its container did.
    const electionLinks = flatten(electionsMenu).filter(
      (item) => item.link === "/governance/mayor-pay",
    );

    assert.deepEqual(
      governanceLinks.map((item) => item.title),
      ["mp_page_title"],
    );
    assert.deepEqual(
      electionLinks.map((item) => item.title),
      ["mp_local_menu_title"],
    );
  });

  test("places the canonical mayor-pay link beside the mayor results", () => {
    // ⚠ THE PLAN WARNS AGAINST ABSORBING THIS GOVERNANCE LEAF INTO ELECTIONS "BY ACCIDENT".
    // It is here on purpose and has been since before the merge: a reader looking at who won a
    // mayoralty is one click from what that office pays. It remains canonical under Governance,
    // where its own `mp_page_title` entry lives — this is the second, contextual route to it.
    const resultsGroup = electionsMenu[0]?.subMenu?.find(
      (item) => item.title === "elections_band_results",
    );
    assert.ok(resultsGroup?.subMenu, "elections results menu group is missing");

    const mayorResultsIndex = resultsGroup.subMenu.findIndex(
      (item) => item.title === "local_leaderboard_mayors_by_party",
    );
    const mayorPayIndex = resultsGroup.subMenu.findIndex(
      (item) => item.title === "mp_local_menu_title",
    );
    assert.equal(mayorPayIndex, mayorResultsIndex + 1);
    assert.equal(
      resultsGroup.subMenu[mayorPayIndex]?.link,
      "/governance/mayor-pay",
    );
    assert.equal(
      resultsGroup.subMenu[mayorPayIndex]?.link?.startsWith("/local/"),
      false,
      "the current-mayor dashboard must not be scoped to an election cycle",
    );
  });
});
