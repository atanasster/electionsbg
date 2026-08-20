// The gate for the failure this component has ALREADY had: a level surface
// that renders no note is SILENT — there is nothing on the page to be wrong, so
// no rendering test, no type error and no lint rule can see it. The first cut of
// T4 shipped with the „Най-евтини области" board unwired while the component's
// own header quoted that board by name as the reason it exists.
//
// So the header's SURFACES list is treated as an executable declaration rather
// than prose, and checked in BOTH directions:
//
//   list → code   a named surface that stopped rendering the note fails here
//                 rather than going quiet on the page;
//   code → list   a surface that starts rendering it must join the list, so the
//                 header cannot rot into a description of an older wiring.
//
// This is a static gate over the sources on purpose, in the style of
// src/entryGraph.test.ts: mounting seven tiles against seven mock payloads
// tests React, whereas what actually breaks is the WIRING. It is also the only
// shape that can catch the negative case at all.
//
// See docs/plans/prices-chain-absence-v1.md T4.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCREENS = path.resolve(HERE, "../../");
const COMPONENT = path.join(HERE, "PriceCoverageNote.tsx");

/** The component names between "// SURFACES" and the blank comment line that
 *  ends the block. Each entry's first word is the file's basename. */
const declaredSurfaces = (): string[] => {
  const src = fs.readFileSync(COMPONENT, "utf8");
  const start = src.indexOf("// SURFACES");
  expect(
    start,
    "the SURFACES block has been renamed or removed",
  ).toBeGreaterThan(-1);
  const block = src.slice(start).split("\n");
  const names: string[] = [];
  for (const line of block.slice(1)) {
    if (!line.startsWith("//")) break;
    // Entries are indented past the header text; continuation lines start with
    // lowercase prose or punctuation and are skipped.
    const m = /^\/\/\s{3,}([A-Z][A-Za-z]+)\s{2,}/.exec(line);
    if (m) names.push(m[1]);
    if (/^\/\/\s*$/.test(line) && names.length) break;
  }
  return [...new Set(names)];
};

/** Every .tsx under src/screens, excluding tests. */
const allScreenFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test."))
        out.push(p);
    }
  };
  walk(SCREENS);
  return out;
};

const rendersNote = (file: string): boolean =>
  fs.readFileSync(file, "utf8").includes("<PriceCoverageNote");

describe("PriceCoverageNote — every declared surface is actually wired", () => {
  const declared = declaredSurfaces();

  it("the header declares the surfaces it claims to (non-vacuity)", () => {
    // Without this the parse could silently return [] and every assertion below
    // would pass over an empty set — the exact shape of a gate that has stopped
    // gating.
    expect(declared.length).toBeGreaterThanOrEqual(6);
    expect(declared).toContain("PricesScreen");
  });

  it.each(declaredSurfaces())("%s renders the note", (name) => {
    const file = allScreenFiles().find(
      (f) => path.basename(f) === `${name}.tsx`,
    );
    expect(
      file,
      `${name}.tsx is named in SURFACES but does not exist`,
    ).toBeTruthy();
    expect(
      rendersNote(file as string),
      `${name} is declared as a covered surface but renders no <PriceCoverageNote>. ` +
        `An unwired level surface is silent — nothing on the page reports it.`,
    ).toBe(true);
  });

  it("no surface renders the note without being declared", () => {
    const rendering = allScreenFiles()
      .filter(rendersNote)
      .map((f) => path.basename(f, ".tsx"))
      // The component itself is not a surface.
      .filter((n) => n !== "PriceCoverageNote");
    const undeclared = rendering.filter((n) => !declared.includes(n));
    expect(
      undeclared,
      `these render the note but are missing from the SURFACES header: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });
});
