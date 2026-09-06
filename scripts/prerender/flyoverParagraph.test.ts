// The prerendered counterpart of the home flyover band — `docs/plans/home-flyover-v1.md` §8.3.
//
// One paragraph and one poster is the whole of what a non-JS crawler gets from a scene that
// costs 34 KB of geometry to draw, so the three things that can go wrong with it are all
// invisible in a build log: the poster it names is not shipped (a 404 in indexed markup), its
// declared box drifts from the band's own (`box.ts`), or its `alt` drifts from the sentence a
// screen reader is given for the same picture. Each is asserted here rather than left to a
// reviewer noticing a literal.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { flyoverParagraph } from "./routes";
import {
  FLYOVER_ASPECT,
  FLYOVER_H,
  FLYOVER_W,
} from "@/screens/home/flyover/box";
import bg from "../../src/locales/bg/translation.json";
import en from "../../src/locales/en/translation.json";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const LANGS = ["bg", "en"] as const;

describe("the prerendered flyover paragraph", () => {
  it("declares the box's own intrinsic size, never a re-typed literal", () => {
    // ⚠️ `box.test.ts`'s „never re-typed" list covers HomeFlyover.tsx and HomeFlyoverSlot.tsx
    // only, because those were the two copies that existed when it was written. This is the
    // third consumer and it lives on the other side of a boundary the browser code cannot
    // cross, which is exactly the shape that drifted before.
    for (const lang of LANGS) {
      const html = flyoverParagraph(lang);
      expect(html).toContain(`width="${FLYOVER_W}"`);
      expect(html).toContain(`height="${FLYOVER_H}"`);
    }
    // The aspect the band reserves its box with must be the one the poster actually has, or
    // the static and the animated states are two different rectangles.
    expect(FLYOVER_ASPECT).toBe(`${FLYOVER_W} / ${FLYOVER_H}`);
  });

  it("points at a poster that ships", () => {
    // The src is absolute and the file is committed under public/; a rename would otherwise
    // put a 404 into the one image a crawler is offered.
    const src = flyoverParagraph("bg").match(
      /src="[^"]*?(\/flyover\/[^"]+)"/,
    )?.[1];
    expect(src, "no /flyover/ poster in the emitted paragraph").toBeTruthy();
    expect(fs.existsSync(path.join(REPO, "public", src!))).toBe(true);
  });

  it("says the same thing as the band's own alt text, character for character", () => {
    // Two independently maintained descriptions of one picture is the defect; they had
    // already diverged on the full stop by the time this was written.
    expect(flyoverParagraph("bg")).toContain(`alt="${bg.flyover_alt_columns}"`);
    expect(flyoverParagraph("en")).toContain(`alt="${en.flyover_alt_columns}"`);
    // Non-vacuity: `toContain` on an empty or missing key passes against anything.
    expect(bg.flyover_alt_columns.length).toBeGreaterThan(10);
    expect(en.flyover_alt_columns).not.toBe(bg.flyover_alt_columns);
  });

  it("emits one paragraph per language, and they differ", () => {
    for (const lang of LANGS) {
      const html = flyoverParagraph(lang);
      expect(html.match(/<p>/g)).toHaveLength(1);
      expect(html.match(/<img /g)).toHaveLength(1);
      // Deferred and off the critical path: this poster is never the LCP candidate, and on a
      // hidden `#ssg-content` block it is never fetched at all.
      expect(html).toContain('loading="lazy"');
    }
    expect(flyoverParagraph("bg")).not.toBe(flyoverParagraph("en"));
  });

  it("names each money layer as its own measure, never a total", () => {
    // ⚠️ THE ONE CLAIM IN THIS COPY THAT COULD BE FALSE. The three layers are taps over
    // OVERLAPPING corpora — an ИСУН-funded contract is in both `fund_projects` and
    // `contracts` — so a sentence that added them would publish a number nobody measured.
    expect(flyoverParagraph("bg")).toContain("не сбор");
    expect(flyoverParagraph("en")).toContain("never a sum");
  });
});
