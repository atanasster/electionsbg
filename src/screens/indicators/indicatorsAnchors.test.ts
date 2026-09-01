// Do the indicator deep links land on a section that exists?
//
// ⚠️ THIS IS THE GATE THE WHOLE „scroll to the number" CHANGE RESTS ON, and the failure it
// catches is silent in every other way. A hash that matches no element does not 404 and does
// not error: react-router loads the page, `useHashScroll` finds nothing, and the reader lands
// at the top — which is exactly the state this work set out to fix, restored by a rename
// nobody connected to a link.
//
// It is a STATIC scan over the destination screens' source rather than a render test, because
// the thing being checked is that two files agree about a string. Rendering /indicators/economy
// in jsdom would need the macro payload, the peers payload, Recharts and a viewport, and would
// still only prove the anchor exists on the branch the fixtures happen to take.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_PATHS,
  KPI_REGISTRY,
  type IndicatorDomain,
} from "./indicatorsRegistry";
import {
  HOME_FIGURE_INDICATOR,
  homeFigureHref,
} from "@/screens/home/homeFigures";
import { HOME_FIGURE_IDS } from "@/data/home/homeTypes";

const REPO = path.resolve(__dirname, "../../..");

/** The screen file that serves each domain path. */
const SCREEN: Record<IndicatorDomain, string> = {
  economy: "src/screens/indicators/IndicatorsEconomyScreen.tsx",
  fiscal: "src/screens/indicators/IndicatorsFiscalScreen.tsx",
  governance: "src/screens/indicators/IndicatorsGovernanceScreen.tsx",
  society: "src/screens/indicators/IndicatorsSocietyScreen.tsx",
};

const source = (domain: IndicatorDomain): string =>
  readFileSync(path.join(REPO, SCREEN[domain]), "utf-8");

/** Every `id="…"` literal in a screen. */
const idsIn = (src: string): Set<string> =>
  new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

describe("every declared indicator anchor exists on its destination page", () => {
  it("resolves, and is not the page top in disguise", () => {
    const anchored = Object.values(KPI_REGISTRY).filter((e) => e.anchor);
    // Non-vacuity: with no anchors declared the loop below would pass over nothing while every
    // KPI link landed at the top of its page — the state this change exists to end.
    expect(anchored.length).toBeGreaterThanOrEqual(4);
    for (const entry of anchored) {
      const ids = idsIn(source(entry.domain));
      expect(
        ids.has(entry.anchor!),
        `${entry.key} → ${DOMAIN_PATHS[entry.domain]}#${entry.anchor} — no element carries ` +
          `that id in ${SCREEN[entry.domain]}`,
      ).toBe(true);
    }
  });

  it("every anchored section also offsets itself from the sticky nav", () => {
    // ⚠️ `scroll-mt-20` IS NOT DECORATION. Without it `scrollIntoView({ block: "start" })` puts
    // the heading under the fixed header, so the reader arrives at a section whose title is
    // hidden — indistinguishable from landing in the wrong place.
    for (const entry of Object.values(KPI_REGISTRY)) {
      if (!entry.anchor) continue;
      const src = source(entry.domain);
      const at = src.indexOf(`id="${entry.anchor}"`);
      // The class sits on the same element, so it is within the same tag as the id.
      const tag = src.slice(at, src.indexOf(">", at));
      expect(
        tag.includes("scroll-mt-"),
        `${entry.key}: #${entry.anchor} has no scroll-mt-* — it will land under the nav`,
      ).toBe(true);
    }
  });

  it("a screen that owns an anchor also runs the scroll hook", () => {
    // The id alone does nothing on an SPA route change: `useLocation()` updates `hash` and the
    // browser does not scroll. `/indicators/economy` carried three of the four home KPI links
    // and did not call the hook at all.
    const domains = new Set(
      Object.values(KPI_REGISTRY)
        .filter((e) => e.anchor)
        .map((e) => e.domain),
    );
    expect(domains.size).toBeGreaterThan(0);
    for (const domain of domains)
      expect(
        source(domain).includes("useHashScroll("),
        `${SCREEN[domain]} owns an anchor but never calls useHashScroll`,
      ).toBe(true);
  });
});

describe("every home head figure links to its own number", () => {
  it("resolves to a domain path AND an anchor, never a bare page", () => {
    // ⚠️ THE REGRESSION THIS REPLACES. The generator wrote a hardcoded
    // `to: "/indicators/economy"` into the artifact — a fourth copy of `DOMAIN_PATHS`, with no
    // anchor — so all four cells landed at the top of a 500-line page.
    for (const id of HOME_FIGURE_IDS) {
      const href = homeFigureHref(id);
      expect(href, id).toMatch(/^\/indicators\/[a-z]+#[a-z-]+$/);
    }
  });

  it("names a real registry entry for every figure", () => {
    for (const id of HOME_FIGURE_IDS) {
      const key = HOME_FIGURE_INDICATOR[id];
      expect(key, `${id} has no indicator mapping`).toBeTruthy();
      expect(
        KPI_REGISTRY[key],
        `${id} → ${key} is not in the registry`,
      ).toBeTruthy();
    }
  });

  it("sends the debt figure to the %-of-GDP section, not the nominal one", () => {
    // ⚠️ THE ONE THAT IS EASY TO GET WRONG AND LOOKS RIGHT. The head's figure is debt as a
    // SHARE OF GDP; `governments_chart_fiscal_nominal_stock` plots the same debt in EUR
    // billions. Anchoring there lands a „28,5%" click on a chart whose axis reads „€45B".
    const src = source("fiscal");
    const anchorAt = src.indexOf('id="government-debt"');
    expect(anchorAt).toBeGreaterThan(-1);
    expect(
      src.indexOf("governments_chart_fiscal_nominal_stock"),
    ).toBeGreaterThan(anchorAt);
    // …and the section it opens is the one whose heading is the plain fiscal chart.
    expect(src.slice(anchorAt, anchorAt + 400)).toContain(
      "governments_chart_fiscal",
    );
  });
});

describe("the head's figure and the series its destination plots are the same reading", () => {
  const macro = JSON.parse(
    readFileSync(path.join(REPO, "data/macro.json"), "utf-8"),
  ) as {
    series: Record<string, { period?: string; value: number }[]>;
    latestMonthly: Record<string, { period: string; value: number }>;
  };

  it("inflation: the page plots a MONTHLY series whose last point is the head's figure", () => {
    // ⚠️ THE WHOLE OF C3. The head quotes the monthly HICP print; the overview chart plots the
    // QUARTERLY mean, which is the mean of a quarter's three months and cannot move until all
    // three land. Measured before this existed: 4.4% (July) on the head against 5.83% (Q2) on
    // the page — both true, 1.4 points apart, nothing saying why. `inflationMonthly` is that
    // series, built from the identical query the monthly-latest spec uses, so the two cannot
    // disagree by construction. This asserts they do not.
    const monthly = macro.series.inflationMonthly;
    expect(
      monthly?.length,
      "inflationMonthly is missing from macro.json",
    ).toBeGreaterThan(100);
    const last = monthly[monthly.length - 1];
    const head = macro.latestMonthly.inflation;
    expect(last.period).toBe(head.period);
    expect(last.value).toBe(head.value);
  });

  it("…and the quarterly series is still there as the reference line", () => {
    // Not replaced. The quarterly mean is what makes the series cabinet-comparable and it is
    // still what the overview chart plots; monthly is the headline panel's line.
    expect(macro.series.inflation?.length).toBeGreaterThan(50);
  });

  it("unemployment: the same pairing, which is where the shape came from", () => {
    // The precedent — `unemploymentMonthly` already worked this way, and inflation not having
    // an equivalent was the asymmetry rather than a judgement call.
    const monthly = macro.series.unemploymentMonthly;
    const last = monthly[monthly.length - 1];
    expect(last.period).toBe(macro.latestMonthly.unemployment.period);
    expect(last.value).toBe(macro.latestMonthly.unemployment.value);
  });

  it("every monthly series a head figure quotes is actually plotted somewhere", () => {
    // ⚠️ A SERIES NOBODY DRAWS IS NOT A FIX. `inflationMonthly` exists to be the last point of
    // a line the reader can see; if no screen names it in an `indicatorKeys`, the head is back
    // to quoting a number the page cannot reach.
    const econ = source("economy");
    for (const key of ["inflationMonthly", "unemploymentMonthly"])
      expect(
        econ.includes(`"${key}"`),
        `${key} is in macro.json but no chart plots it`,
      ).toBe(true);
  });
});
