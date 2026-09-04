// The fold has ONE definition, and this is the sweep that keeps it that way.
//
// ⚠ IT LIVES IN `scripts/` RATHER THAN BESIDE THE MODULE because it walks the whole source
// tree, which is a node job — under the jsdom project the same walk takes seconds and times
// out. The behaviour tests stay next to the module; only the tree scan moved.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../lib/strip_comments";

/** The fold, whitespace-collapsed so a Prettier reflow cannot hide a copy. */
const FOLD =
  /normalize\("NFC"\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.toLowerCase\(\)/;
const flat = (s: string) => s.replace(/\s*\n\s*/g, "");

const ROOT = path.join(__dirname, "../../..");
const HOME = path.join(ROOT, "src/data/local/kmetstvoName.ts");

describe("the кметство name fold", () => {
  it("is the ONLY spelling of this fold in the repo", () => {
    // ⚠ SIX COPIES EXISTED — five in `src/` and one in the SCRIPT that BUILDS the index the
    // hooks look names up in, which is the pair the `councilNameKey` precedent is about: a
    // producer and a consumer folding differently do not error, they attribute one village's
    // by-election to another. A seventh would be written the same way, so the sweep is the gate.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "dist") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && p !== HOME) {
          const body = stripComments(fs.readFileSync(p, "utf8"));
          if (FOLD.test(flat(body))) offenders.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "src"));
    walk(path.join(ROOT, "scripts"));
    expect(offenders).toEqual([]);
  });

  it("discriminates — the sweep finds the pattern when it is there", () => {
    // ⚠ WITHOUT THIS, "no offenders" passes on a regex that matches nothing at all, which is
    // exactly what a hand-written multi-line pattern does after one Prettier reflow.
    const sample =
      'const n = (s: string): string =>\n  s.normalize("NFC").replace(/\\s+/g, " ").trim().toLowerCase();';
    expect(FOLD.test(flat(sample))).toBe(true);
  });
});
