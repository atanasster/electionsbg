// The Elections menu's destination and the header's active-section rule.
//
// Both encode the same fact from opposite directions — where the parliamentary country
// result lives, and which pathnames count as "in Elections" — and both were wrong about `/`
// until the country result moved to `/parliamentary`. Neither is covered by a route test:
// a menu pointing at the wrong page still renders and still navigates.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { electionsMenu } from "./reportMenus";
// The REAL rule, not a copy. It used to be restated here — importing Header
// drags Radix, the theme context, i18n and `useLocation` into a test about two
// string comparisons — and the restatement rotted: its GOVERNANCE array held
// four prefixes against the component's ~25, so this file asserted /my-area was
// Governance while the header tinted Elections on it, and asserted /votes was
// Elections while the header tinted Governance. The rule now lives in an
// import-free module both sides read, so there is nothing left to drift.
import {
  CONSUMPTION_PREFIXES,
  GOVERNANCE_PREFIXES,
  inElections,
  isInSection,
} from "./headerSection";

const flatten = (items: typeof electionsMenu): typeof electionsMenu =>
  items.flatMap((i) => [i, ...flatten(i.subMenu ?? [])]);

describe("electionsMenu", () => {
  it("points at /elections — the cross-kind entry, not one system's result", () => {
    // ⚠ IT USED TO POINT AT `/parliamentary`, correctly, because `/elections` was not a route.
    // Phase 3 makes it one, and the top-level item is the ENTRY: `/parliamentary` is still
    // canonical for the parliamentary country result and is the first leaf inside.
    expect(electionsMenu[0].link).toBe("/elections");
    const overview = electionsMenu[0].subMenu?.find(
      (m) => m.title === "menu_overview",
    );
    expect(overview?.link).toBe("/elections");
  });

  it("no entry anywhere in the menu still links to the root", () => {
    // `/` is the global home. A menu entry labelled „Избори" that opens it is a link to the
    // wrong page that navigates perfectly.
    expect(flatten(electionsMenu).filter((m) => m.link === "/")).toEqual([]);
  });

  it("carries BOTH systems, in the hub's own four sections", () => {
    // ⚠ THE MERGE MUST NOT LOSE A DESTINATION. „Местни избори" was a separate top-level menu
    // until Phase 3; every leaf it carried is reachable here, and the group headings are the
    // `/elections` bands' own keys so the menu and the hub cannot disagree about the sections.
    const links = new Set(flatten(electionsMenu).map((m) => m.link));
    for (const l of [
      "/parliamentary",
      "/parliamentary/analysis",
      "/parliamentary/reports",
      "/local/chmi",
      "/sverka",
    ])
      expect(links, l).toContain(l);
    const groups = (electionsMenu[0].subMenu ?? [])
      .filter((m) => m.group)
      .map((m) => m.title);
    // ⚠ THE BANDS' OWN KEYS, IN BAND ORDER. `elections_band_partial` was the fourth until the
    // presidential tile was seated: `chmi` moved into `results` and `sverka` into `analysis`,
    // and the two national leaderboards became `rankings`. Asserting the keys as literals is
    // what stops the menu drifting from the hub — and `menuCopy.test.ts` is what stops those
    // literals naming a key neither corpus has, which this test cannot see.
    expect(groups).toEqual([
      "elections_band_results",
      "elections_band_places",
      "elections_band_rankings",
      "elections_band_analysis",
    ]);
  });
});

describe("the header's active-section rule", () => {
  it("matches whole segments, never substrings", () => {
    // `isInSection` is the half a prefix list cannot state for itself: "/mp" must
    // not swallow "/mparty", and "/person" must not swallow "/persons" into the
    // wrong bucket by accident (both are Governance, but for their own reasons).
    expect(isInSection("/my-area", GOVERNANCE_PREFIXES)).toBe(true);
    expect(isInSection("/my-area/BLG03", GOVERNANCE_PREFIXES)).toBe(true);
    expect(isInSection("/my-areas", GOVERNANCE_PREFIXES)).toBe(false);
    expect(isInSection("/mparty", GOVERNANCE_PREFIXES)).toBe(false);
  });

  it("treats the root and the header's own watchlist as neutral", () => {
    // Neutral is a THIRD answer, not an absence: Elections is the negative
    // default, so a route merely left out of the other worlds is tinted
    // Elections. /following is reachable from every page via the header, so it
    // belongs to whichever world the reader came from — asserting it here is
    // what stops it silently falling back into Избори.
    expect(inElections("/following")).toBe(false);
    for (const p of [GOVERNANCE_PREFIXES, CONSUMPTION_PREFIXES])
      expect(isInSection("/following", p), p[0]).toBe(false);
  });

  it("treats the root as neutral", () => {
    // The whole point of the change: `/` is the global home, so no top-level section owns
    // it. `/en` reaches this as `/` too — BrowserRouter strips the basename — so one
    // comparison covers both roots.
    expect(inElections("/")).toBe(false);
  });

  it("still activates Elections on the country result and its deep routes", () => {
    // The negative default is what covers these without listing them; a positive prefix
    // list would silently de-highlight whichever it forgot.
    for (const p of [
      "/elections",
      "/parliamentary",
      "/parliamentary/analysis",
      "/parliamentary/reports",
      "/elections/2026_04_19",
      // ⚠ THE LOCAL TREE JOINS ELECTIONS with the menu merge (Phase 3 item 6). It was its own
      // top-level world with its own dropdown; there is one Elections menu now, so a reader on
      // a local result must see it tinted rather than nothing.
      "/local/2023_10_29_mi",
      "/local/chmi",
      "/sverka",
      "/municipality/BLG",
      "/settlement/BLG03",
      "/sections/04279",
      "/sofia",
      "/candidate/mp-3643",
      "/polls",
    ]) {
      expect(inElections(p), p).toBe(true);
    }
  });

  it("leaves the other three worlds alone", () => {
    for (const p of [
      "/governance",
      "/governance/sectors",
      // The four-entry copy this file used to carry could not see any of these.
      "/my-area",
      "/my-area/BLG03",
      "/votes",
      "/votes/2025-06-19",
      "/sector/health",
      "/persons",
      "/person/boyko-borisov-1a2b3c",
      "/officials/assets",
      "/declarations/crypto",
      "/companies",
      "/court/rs-sofiya",
      "/budget",
      "/procurement",
      "/consumption",
      "/product/kafe-1kg",
      "/prices",
    ]) {
      expect(inElections(p), p).toBe(false);
    }
  });

  it("is the rule Header.tsx actually runs", () => {
    // Non-vacuity. The predecessor read Header.tsx as SOURCE and asserted the
    // shape of the expression ('location.pathname !== "/"', "!inGovernance" …),
    // which is satisfied by any prefix lists at all — which is exactly how the
    // copy rotted. Header now imports `headerSection` from the same module
    // these assertions call, so the only thing left to check is that it does.
    const src = fs.readFileSync(path.resolve(__dirname, "Header.tsx"), "utf-8");
    expect(src).toContain('from "./headerSection"');
    expect(src).toContain("headerSection(");
    // …and that it no longer keeps prefix lists of its own to drift from.
    expect(src).not.toContain("GOVERNANCE_PREFIXES");
    expect(src).not.toContain("CONSUMPTION_PREFIXES");
  });
});
