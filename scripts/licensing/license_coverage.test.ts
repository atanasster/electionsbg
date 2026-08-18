// Static gate over LICENSE — does the licence boundary still describe the tree?
//
// WHY: a licence that enumerates paths goes stale the moment a top-level file or
// tree is added, and the failure is silent in the worst direction. Anything the
// file does not place somewhere falls back to "all rights reserved", which is
// exactly the condition LICENSE exists to end — so an incomplete boundary reads
// as a working licence while granting nothing over the new material.
//
// LICENSE closes the general case with a DEFAULT rule ("anything not named in
// sections 2, 3 or 4 is MIT"), so the thing worth gating is not "is every file
// listed" — it is the two ways that default goes wrong:
//
//   1. A carve-out (§2 data, §3 third-party, §4 brand/likeness) names a path
//      that no longer exists → the boundary describes a tree that is gone, and
//      a reader cannot tell a stale rule from a live one.
//   2. Material that MUST NOT be MIT lands somewhere the default sweeps it in →
//      a font binary under src/, a tarball outside vendor/, a photograph in a
//      code tree. Here the default silently makes a false claim over somebody
//      else's work, which is worse than the silence it replaced.
//
// (2) is the load-bearing half and the reason this file exists rather than a
// comment. It is also why the assertions below are about FILE KINDS rather than
// about the exact wording of the licence: the wording may be improved freely;
// what may not change without a decision is which material the MIT default
// reaches.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const tracked = (): string[] =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 << 20 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

const LICENSE = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");

/** Trees LICENSE carves OUT of the MIT default, by section. Each entry is a
 *  prefix or a predicate over a tracked path. Keep in step with LICENSE §2–§4;
 *  the first test below fails when one of these stops matching anything. */
const CARVE_OUTS: Array<{
  section: 2 | 3 | 4;
  label: string;
  match: (p: string) => boolean;
}> = [
  { section: 2, label: "data/**", match: (p) => p.startsWith("data/") },
  { section: 2, label: "raw_data/**", match: (p) => p.startsWith("raw_data/") },
  {
    section: 3,
    label: "public/fonts/** (font binaries)",
    match: (p) => p.startsWith("public/fonts/") && p.endsWith(".woff2"),
  },
  {
    section: 3,
    label: "video/public/fonts/** (font binaries)",
    match: (p) => p.startsWith("video/public/fonts/") && p.endsWith(".woff2"),
  },
  {
    section: 3,
    label: "vendor/*.tgz",
    match: (p) => p.startsWith("vendor/") && p.endsWith(".tgz"),
  },
  { section: 4, label: "brand/**", match: (p) => p.startsWith("brand/") },
  { section: 4, label: "assets/**", match: (p) => p.startsWith("assets/") },
  {
    section: 4,
    label: "public/images/IMG_*.png",
    match: (p) => /^public\/images\/IMG_[^/]+\.png$/.test(p),
  },
];

/** File kinds that must never be reached by the MIT default, with the trees
 *  where they are legitimately carved out. A match outside those trees is the
 *  defect: the default would relicense somebody else's work. */
const MUST_NOT_DEFAULT_TO_MIT: Array<{
  kind: string;
  match: (p: string) => boolean;
  allowedIn: RegExp;
  why: string;
}> = [
  {
    kind: "font binary",
    match: (p) => /\.(woff2?|ttf|otf|eot)$/i.test(p),
    allowedIn: /^(public\/fonts|video\/public\/fonts)\//,
    why: "Inter/Fraunces ship under the SIL OFL, which MIT cannot override (LICENSE §3)",
  },
  {
    kind: "vendored package tarball",
    match: (p) => /\.tgz$/i.test(p),
    allowedIn: /^vendor\//,
    why: "a repacked upstream package keeps its upstream licence (LICENSE §3)",
  },
  {
    kind: "photograph of an identifiable person",
    match: (p) =>
      /(^|\/)(IMG_\d+|atanas_stoyanov|martin_stoyanov)\.(png|jpe?g|webp)$/i.test(
        p,
      ),
    allowedIn: /^(assets|public\/images)\//,
    why: "personality rights are not transferable by a software licence (LICENSE §4)",
  },
];

describe("LICENSE covers the tracked tree", () => {
  test("the MIT default rule is present — without it, unlisted files are all-rights-reserved", () => {
    // The whole boundary rests on this sentence. If it is ever edited away, the
    // enumerations become the boundary again and every new top-level file lands
    // outside the licence.
    expect(LICENSE).toMatch(
      /not\s+named\s+in\s+sections?\s+2,\s*3\s+or\s+4\s+is\s+under\s+the\s+MIT\s+grant/i,
    );
  });

  test("every carve-out still matches at least one tracked file", () => {
    const files = tracked();
    const stale = CARVE_OUTS.filter((c) => !files.some(c.match)).map(
      (c) => `§${c.section} ${c.label}`,
    );
    expect(stale, "carve-outs naming trees that no longer exist").toEqual([]);
  });

  test("no material that cannot be MIT sits where the default would sweep it in", () => {
    const files = tracked();
    const leaked: string[] = [];
    for (const rule of MUST_NOT_DEFAULT_TO_MIT) {
      for (const f of files) {
        if (rule.match(f) && !rule.allowedIn.test(f))
          leaked.push(`${f} — ${rule.kind}: ${rule.why}`);
      }
    }
    expect(
      leaked,
      "these files would fall under the MIT default; carve them out in LICENSE first",
    ).toEqual([]);
  });

  test("the gate is not vacuous — each rule matches real files inside its allowed tree", () => {
    // Guards against a rule whose regex silently stops matching anything: it
    // would then report "no leaks" for ever, including on a real leak.
    const files = tracked();
    for (const rule of MUST_NOT_DEFAULT_TO_MIT) {
      const inside = files.filter(
        (f) => rule.match(f) && rule.allowedIn.test(f),
      );
      expect(
        inside.length,
        `${rule.kind}: rule matches nothing at all`,
      ).toBeGreaterThan(0);
    }
  });

  test("package.json does not claim a bare MIT over a mixed tree", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { license?: string };
    // A bare "MIT" is read by tooling as covering the whole package, which is
    // false here: sections 2–4 are not MIT. SPDX's own encoding for this case is
    // a pointer to the file.
    expect(pkg.license).toBe("SEE LICENSE IN LICENSE");
  });
});
