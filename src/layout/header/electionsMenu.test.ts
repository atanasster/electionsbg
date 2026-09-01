// The Elections menu's destination and the header's active-section rule.
//
// Both encode the same fact from opposite directions — where the parliamentary country
// result lives, and which pathnames count as "in Elections" — and both were wrong about `/`
// until the country result moved to `/parliamentary`. Neither is covered by a route test:
// a menu pointing at the wrong page still renders and still navigates.

import { describe, expect, it } from "vitest";
import { electionsMenu } from "./reportMenus";

/** The rule under test, copied from Header.tsx. ⚠️ A COPY, deliberately: importing Header
 *  drags Radix, the theme context, i18n and `useLocation` into a test about two string
 *  comparisons. The clause below pins the copy against the source so it cannot rot. */
const isInSection = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const GOVERNANCE = ["/governance", "/my-area", "/budget", "/procurement"];
const LOCAL = ["/local"];
const CONSUMPTION = ["/consumption", "/prices"];

const inElections = (pathname: string): boolean =>
  pathname !== "/" &&
  !isInSection(pathname, GOVERNANCE) &&
  !isInSection(pathname, LOCAL) &&
  !isInSection(pathname, CONSUMPTION);

describe("electionsMenu", () => {
  it("points at /parliamentary, not at the root", () => {
    // `/` is the global home. A menu entry labelled „Избори" that opens it is a link to the
    // wrong page that navigates perfectly.
    expect(electionsMenu[0].link).toBe("/parliamentary");
  });

  it("its mobile-only overview leaf points there too", () => {
    const overview = electionsMenu[0].subMenu?.find(
      (m) => m.title === "menu_overview",
    );
    expect(overview?.link).toBe("/parliamentary");
  });

  it("no entry anywhere in the menu still links to the root", () => {
    const links = [
      electionsMenu[0].link,
      ...(electionsMenu[0].subMenu ?? []).map((m) => m.link),
    ];
    expect(links.filter((l) => l === "/")).toEqual([]);
  });
});

describe("the header's active-section rule", () => {
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
      "/parliamentary",
      "/parliamentary/analysis",
      "/parliamentary/reports",
      "/elections/2026_04_19",
      "/municipality/BLG",
      "/settlement/BLG03",
      "/sections/04279",
      "/sofia",
      "/candidate/mp-3643",
      "/votes/2025-06-19",
      "/polls",
    ]) {
      expect(inElections(p), p).toBe(true);
    }
  });

  it("leaves the other three worlds alone", () => {
    for (const p of [
      "/governance",
      "/governance/sectors",
      "/my-area",
      "/budget",
      "/procurement",
      "/local/2023_10_29_mi",
      "/consumption",
      "/prices",
    ]) {
      expect(inElections(p), p).toBe(false);
    }
  });

  it("the copied rule still matches Header.tsx", async () => {
    // Non-vacuity: without this the assertions above test a local function that may have
    // drifted from the component. Read as source rather than executed, because the real one
    // is a closure over `useLocation()`.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "Header.tsx"), "utf-8");
    expect(src).toContain('location.pathname !== "/"');
    expect(src).toContain("!inGovernance");
    expect(src).toContain("!inLocal");
    expect(src).toContain("!inConsumption");
  });
});
