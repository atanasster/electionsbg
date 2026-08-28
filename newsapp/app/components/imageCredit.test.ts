// A static gate over the newsapp sources: no image may be rendered except
// through ArticleImage, which is the only component that attaches a credit.
//
// ⚠️ THIS IS AN ATTRIBUTION INVARIANT, NOT A RIGHTS DECISION. Rights are
// recorded per article; this gate ensures an eligible rendered photo cannot
// lose its visible credit during a component refactor — a review
// proved that replacing <ArticleImage> with a bare <img> inside ArticleCard
// left all 19 component tests passing, `tsc --noEmit` at exit 0 and eslint
// clean, because ArticleCard has no test file of its own.
//
// The same shape as src/entryGraph.test.ts: a cheap static assertion over the
// sources, catching a class of mistake that is invisible in review and
// expensive to catch any other way. Seconds, against a defect whose only
// other detection route is somebody noticing an uncredited photo in
// production.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolved from THIS file rather than from the working directory: vitest
// can be invoked from anywhere, and a cwd-relative path would silently
// find nothing and pass the whole gate vacuously.
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The ONE component allowed to render a raw <img>. */
const CREDITED_IMAGE = join("components", "ArticleImage.tsx");

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

/** Strip comments so a file DISCUSSING <img> is not an occurrence of one. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

describe("every rendered image carries a credit", () => {
  const files = sourceFiles(APP_DIR);

  it("finds the app sources at all", () => {
    // Without this the whole gate passes vacuously on a path change.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(CREDITED_IMAGE))).toBe(true);
  });

  it("renders a raw <img> in ArticleImage and nowhere else", () => {
    const offenders = files
      .filter((f) => !f.endsWith(CREDITED_IMAGE))
      .filter((f) => /<img[\s/>]/.test(stripComments(readFileSync(f, "utf-8"))))
      .map((f) => relative(APP_DIR, f));
    expect(offenders).toEqual([]);
  });

  it("never sets a background-image either", () => {
    // The other way to put somebody's photograph on the page without an
    // <img> tag, and therefore without tripping the assertion above.
    const offenders = files
      .filter((f) =>
        /backgroundImage\s*:/.test(stripComments(readFileSync(f, "utf-8"))),
      )
      .map((f) => relative(APP_DIR, f));
    expect(offenders).toEqual([]);
  });

  it("keeps the credit unconditional inside ArticleImage", () => {
    // The credit anchor must not sit behind a prop, a ternary or a guard.
    // Checked structurally rather than by rendering, because a prop that
    // hides it would need a test that thinks to pass it.
    const src = stripComments(
      readFileSync(join(APP_DIR, CREDITED_IMAGE), "utf-8"),
    );
    expect(src).toContain("{creditText}");
    // no prop named like a switch for it
    expect(src).not.toMatch(/\b(hideCredit|showCredit|noCredit)\b/);
    // ⚠️ The check is on what PRECEDES the anchor, not what is inside it: the
    // href legitimately uses `??`, so scanning the element's own attributes
    // for a `?` flags the wrong thing. What matters is that nothing gates the
    // anchor's RENDER — no `{cond &&` and no `{cond ? (` opening just before
    // it.
    const beforeAnchor = src.slice(0, src.indexOf("<a\n"));
    const lastLines = beforeAnchor.split("\n").slice(-4).join("\n");
    expect(lastLines).not.toMatch(/\{[^}]*&&\s*\(?\s*$/);
    expect(lastLines).not.toMatch(/\{[^}]*\?\s*\(\s*$/);
  });
});
