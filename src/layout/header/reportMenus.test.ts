import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  governanceMenu,
  localMenu,
  type MenuItem,
} from "./reportMenus";

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => [item, ...flatten(item.subMenu ?? [])]);

describe("header report menus", () => {
  test("exposes mayor pay from governance and local elections", () => {
    const governanceLinks = flatten(governanceMenu).filter(
      (item) => item.link === "/governance/mayor-pay",
    );
    const localLinks = flatten(localMenu).filter(
      (item) => item.link === "/governance/mayor-pay",
    );

    assert.deepEqual(
      governanceLinks.map((item) => item.title),
      ["mp_page_title"],
    );
    assert.deepEqual(
      localLinks.map((item) => item.title),
      ["mp_local_menu_title"],
    );
  });

  test("places the canonical mayor-pay link beside the mayor results", () => {
    const resultsGroup = localMenu[0]?.subMenu?.find(
      (item) => item.title === "local_menu_group_results",
    );
    assert.ok(resultsGroup?.subMenu, "local results menu group is missing");

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
