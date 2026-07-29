// The budget types are maintained in TWO files — scripts/budget/types.ts (the
// generators' side) and src/data/budget/types.ts (the app's side) — because the
// script package and the app package do not share a tsconfig. Nothing has ever
// checked that the two copies agree, so a field added to one and forgotten in
// the other type-checks on both sides and only fails at runtime, as a missing
// property on served JSON.
//
// This is a text-level gate on purpose. Comparing the two as TypeScript would
// need a compiler pass; comparing the declaration bodies catches the failure
// mode that actually happens — someone edits one file.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = fs.readFileSync(
  path.join(ROOT, "scripts/budget/types.ts"),
  "utf8",
);
const APP = fs.readFileSync(
  path.join(ROOT, "src/data/budget/types.ts"),
  "utf8",
);

/** Extract `export interface <name> { … }` and normalise whitespace/comments so
 *  the comparison is about SHAPE, not formatting. */
const declOf = (src: string, name: string): string | null => {
  const start = src.indexOf(`export interface ${name} {`);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src
    .slice(from, i + 1)
    .replace(/\/\*\*[\s\S]*?\*\//g, "") // JSDoc
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/\s+/g, " ")
    .trim();
};

/** Shapes that MUST exist identically on both sides. Add a name here whenever
 *  a generator writes an artifact the app reads. */
const MIRRORED = [
  "NoiFundPlanLine",
  "NoiFundPlanYear",
  "NoiFundPlanFile",
  "NzokBudgetLine",
  "NzokBudgetYear",
  "NzokBudgetFile",
];

describe("budget type parity across the scripts/src boundary", () => {
  for (const name of MIRRORED) {
    it(`${name} is declared identically in both files`, () => {
      const a = declOf(SCRIPTS, name);
      const b = declOf(APP, name);
      expect(a, `${name} missing from scripts/budget/types.ts`).not.toBeNull();
      expect(b, `${name} missing from src/data/budget/types.ts`).not.toBeNull();
      expect(a).toBe(b);
    });
  }

  it("keeps the basis caveat in BOTH copies, not just one", () => {
    // The "gross sum, not consolidated" rule is what stops a consumer netting
    // the ЗБДОО plan against the B1 actual. It has to survive in whichever
    // copy a reader happens to open.
    for (const [label, src] of [
      ["scripts", SCRIPTS],
      ["app", APP],
    ] as const) {
      const decl = src.slice(
        src.indexOf("export interface NoiFundPlanYear"),
        src.indexOf("export interface NoiFundPlanFile"),
      );
      expect(decl, `${label}: sumOfFunds caveat missing`).toMatch(
        /GROSS SUM[\s\S]*NOT a consolidated total/,
      );
    }
  });
});
