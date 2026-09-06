import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTION_ROW_CLASS,
  FLYOVER_ASPECT,
  FLYOVER_H,
  FLYOVER_W,
  SWITCH_DOT_CLASS,
  SWITCH_ROW_CLASS,
} from "./box";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

describe("the reserved box", () => {
  it("is one aspect ratio, matching the artifact's frame", () => {
    expect(FLYOVER_ASPECT).toBe(`${FLYOVER_W} / ${FLYOVER_H}`);
    expect(FLYOVER_W / FLYOVER_H).toBeCloseTo(1000 / 625, 6);
  });

  it("is shared by the band and its fallback, never re-typed", () => {
    // ⚠️ THIS IS THE GATE THE „must not drift" COMMENT USED TO BE. These values are what make
    // the Suspense fallback and the real band the SAME box, across a lazy boundary the code
    // cannot cross — and drift is not cosmetic here: it is a layout shift above the eight
    // destination tiles, on the page budgeted at CLS < 0.1, invisible to every other test.
    for (const file of ["HomeFlyover.tsx", "HomeFlyoverSlot.tsx"]) {
      const src = read(file);
      expect(src, `${file} must import the box`).toMatch(
        /from "\.\/box"|from "\.\/box";/,
      );
      // The literals themselves must appear in neither.
      expect(src, `${file} re-types the aspect ratio`).not.toContain(
        `"${FLYOVER_ASPECT}"`,
      );
      expect(src, `${file} re-types the caption row`).not.toContain(
        "min-h-[3.25rem]",
      );
    }
    expect(read("FlyoverCaptions.tsx")).not.toContain("min-h-[3.25rem]");
    // …and the shared value is the one every row actually reserves.
    expect(CAPTION_ROW_CLASS).toContain("min-h-[3.25rem]");
    expect(read("FlyoverCaptions.tsx")).toContain("CAPTION_ROW_CLASS");
    expect(read("HomeFlyoverSlot.tsx")).toContain("CAPTION_ROW_CLASS");
  });

  it("reserves a switch row tall enough for a WCAG target", () => {
    // The dot is 10 px and the target is 24. If the row shrank back to the dot's height, the
    // fallback and the band would differ by 14 px — which is the layout shift the split
    // exists to prevent, introduced by the accessibility fix.
    expect(SWITCH_ROW_CLASS).toContain("h-6");
    expect(SWITCH_DOT_CLASS).toContain("h-2.5");
    expect(read("HomeFlyover.tsx")).toContain("h-6 w-6");
  });
});
