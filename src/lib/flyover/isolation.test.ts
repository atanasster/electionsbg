import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The engine's import isolation, enforced rather than asserted in a header comment.
//
// ⚠️ THREE CALLERS, THREE RESOLVERS, AND `npm run build` SEES NONE OF THIS. The browser has
// Vite and the `@/` alias; Node under `@napi-rs/canvas` renders the posters; Remotion's
// `video/tsconfig.json` deliberately excludes the app's alias map and reaches the engine by
// RELATIVE path. So the two halves of the rule fail differently:
//
//   · a `@/` import is caught by `npm run video:check` — a separate command from the build;
//   · a bare `react` or `node:fs` import is caught by NOTHING. Both resolve under Vite AND
//     under video/tsconfig.json, `tsc -b` passes, and the failure surfaces as a Remotion
//     render bundling React twice, or a poster script dying at runtime where nobody watches.
//
// Requiring `./` rather than denying a list is the stronger form: it fails on `@/`, on
// `react`, on `node:fs` and on whatever nobody has thought of. A future step that genuinely
// needs a bare package makes the allowance one explicit line with a reason, which is the point.

const DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bare specifiers the engine may import. EMPTY, deliberately — every entry is a package that
 * must resolve identically under Vite, Node and Remotion, and each one is a decision.
 */
const ALLOWED_BARE: string[] = [];

describe("the flyover engine's import isolation", () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();

  it("scans the files it thinks it scans", () => {
    // Non-vacuity: every assertion below is „X is absent", which an empty file list satisfies
    // perfectly, so a readdir that stopped matching would turn this gate green rather than red.
    expect(files.length).toBeGreaterThan(2);
    expect(files).toContain("camera.ts");
    expect(files).toContain("state.ts");
  });

  it.each(files)("%s imports nothing outside the engine", (f) => {
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    const specs = [
      ...src.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm),
      ...src.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      if (ALLOWED_BARE.includes(spec)) continue;
      expect(
        spec.startsWith("./"),
        `${f} imports ${spec} — the engine may only import its own siblings. ` +
          `React, the DOM beyond CanvasRenderingContext2D, node: builtins and @/ are all out; ` +
          `see this file's header for which resolver each one breaks.`,
      ).toBe(true);
    }
  });

  it("names no browser-only global that Node and Remotion do not have", () => {
    // `document` and `window` exist in the browser and in Remotion's DOM, and in neither the
    // poster renderer nor a Vitest node project — so the engine takes its clock and its
    // context as ARGUMENTS. `Date.now()`/`performance.now()` are banned for a different
    // reason: plan §0.2 makes the clock explicit so two rebuilds of one frame are identical.
    for (const f of files) {
      const src = fs.readFileSync(path.join(DIR, f), "utf8");
      for (const bad of [
        /\bdocument\./,
        /\bwindow\./,
        /\bDate\.now\(/,
        /\bperformance\.now\(/,
        /\brequestAnimationFrame\(/,
      ]) {
        expect(bad.test(src), `${f} uses ${bad}`).toBe(false);
      }
    }
  });
});
