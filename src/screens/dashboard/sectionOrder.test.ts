// Every place page arranges its deeper sections the same way (§Phase 7 item 4).
//
// ⚠ THE ORDER WAS SEVEN HAND-WRITTEN LISTS THAT HAPPENED TO AGREE, and each file carried TWO of
// them — a `SECTION_TOPICS` array and a separate sequence of `<DashboardSection>` elements —
// with nothing comparing any pair. A reader who learns the shape of one place page and finds the
// next arranged differently is the failure, and it renders perfectly.
//
// ⚠ AND IT IS A SOURCE SCAN ON PURPOSE. The property is about the ORDER OF JSX in a file, which
// no rendered DOM assertion can see without mounting five screens with five sets of data hooks —
// and which would then be asserted per screen, i.e. five more hand-written lists.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { orderSections, sectionRank } from "./sectionOrder";

const DIR = path.join(process.cwd(), "src/screens/dashboard");

/** The place-result pages §Phase 7 covers. Party and candidate pages are a different family
 *  whose ordering the plan does not touch — listing them here would assert an order nobody
 *  designed. */
const PLACE_CARDS = [
  "DashboardCards.tsx",
  "RegionDashboardCards.tsx",
  "MunicipalityDashboardCards.tsx",
  "SettlementDashboardCards.tsx",
  "SectionDashboardCards.tsx",
];

const renderedIds = (file: string): string[] => {
  const src = stripComments(fs.readFileSync(path.join(DIR, file), "utf8"));
  return [...src.matchAll(/<DashboardSection\b[^>]*?id="([a-z0-9_-]+)"/gs)].map(
    (m) => m[1],
  );
};

describe("the canonical section order", () => {
  it("places every section these pages actually render", () => {
    // ⚠ THE COVERAGE CHECK, and the reason it is not a list of ids: an unplaced section sorts to
    // the END silently, so a new one would drift to the bottom of every page with nothing said.
    const unplaced = new Set<string>();
    for (const f of PLACE_CARDS)
      for (const id of renderedIds(f))
        if (sectionRank(id) === null) unplaced.add(id);
    expect([...unplaced]).toEqual([]);
  });

  it("is what every place page renders", () => {
    for (const f of PLACE_CARDS) {
      const ids = renderedIds(f);
      expect(ids.length, `${f} renders no sections`).toBeGreaterThan(0);
      expect(ids, f).toEqual(orderSections(ids));
    }
  });

  it("puts the review sections LAST on every page that renders them", () => {
    // ⚠ THE ONE THING ITEM 4 ACTUALLY CHANGED. The pages led with „Аномалии" and „Рискови
    // гласове" in third and fourth place, ahead of everything about who was elected or how the
    // campaign was funded. A page leads with what a reader came for; review flags are what to
    // check afterwards.
    //
    // ⚠ ASSERTED ON REAL PAGES, NOT ON THE CONSTANT. An earlier version compared two indices
    // inside one `orderSections` call and passed even when `polling` and `financing` were
    // RE-CLASSIFIED as review — because within a slot the ids keep their declaration order, so
    // the two indices never crossed. Anchoring on the review sections themselves cannot be
    // satisfied that way.
    const REVIEW = ["anomalies", "neighborhoods"];
    for (const f of PLACE_CARDS) {
      const ids = renderedIds(f);
      const review = ids.filter((i) => REVIEW.includes(i));
      if (review.length === 0) continue;
      const others = ids.filter(
        (i) => !REVIEW.includes(i) && i !== "diaspora_faq",
      );
      const firstReview = Math.min(...review.map((i) => ids.indexOf(i)));
      for (const o of others)
        expect(
          ids.indexOf(o),
          `${f}: ${o} must precede review signals`,
        ).toBeLessThan(firstReview);
    }
  });

  it("keeps an unplaced id rather than dropping it", () => {
    // A page must not lose a section because this module has not placed it — losing content is
    // a worse failure than ordering it badly.
    const out = orderSections(["anomalies", "budget", "votes"]);
    expect(out).toContain("budget");
    expect(out.indexOf("votes")).toBeLessThan(out.indexOf("anomalies"));
    expect(out.at(-1)).toBe("budget");
  });
});

describe("each file's two orderings agree", () => {
  it("SECTION_TOPICS is derived, not restated", () => {
    // ⚠ THE SECOND LIST IS THE ONE THAT DRIFTS. It feeds `SectionArticlesProvider`, so a
    // disagreement shows up as articles ranked against a section order the page no longer uses
    // — visible to nobody, wrong for everybody.
    for (const f of PLACE_CARDS) {
      const src = stripComments(fs.readFileSync(path.join(DIR, f), "utf8"));
      if (!src.includes("SECTION_TOPICS")) continue;
      expect(src, `${f} hand-orders SECTION_TOPICS`).toMatch(
        /SECTION_TOPICS[^=]*=\s*orderSections\(/,
      );
    }
  });
});
