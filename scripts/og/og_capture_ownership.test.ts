// A card path has ONE producer. capture-screens.ts writes Playwright screenshots into public/og/,
// and generate.ts renders text cards into dist/og/ during postbuild — AFTER vite has copied
// public/ into dist/. So a path both produce ships generate.ts's version, silently, while every
// gate that inspects the committed screenshot in public/og/ passes.
//
// That is not hypothetical: until 2026-10-02 generate.ts queued "home.png", so the homepage's
// share card on the live site was a "Парламентарни избори 19.04.2026" election card from the
// homepage's election era, while ogAndSitemapCoverage's freshness clause checked a re-shot hub
// screenshot that never reached a reader.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../lib/strip_comments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) =>
  stripComments(fs.readFileSync(path.join(HERE, f), "utf8"));

const captured = () =>
  new Set(
    [...read("capture-screens.ts").matchAll(/\bslug:\s*"([^"]+)"/g)].map(
      (m) => `${m[1]}.png`,
    ),
  );

// Every literal `.png` path generate.ts can queue. Template-built paths (`region/${…}.png`)
// carry a directory and cannot collide with a flat capture slug, so literals are the risk.
const generated = () =>
  new Set(
    [...read("generate.ts").matchAll(/"([A-Za-z0-9_/-]+\.png)"/g)].map(
      (m) => m[1],
    ),
  );

describe("og card ownership", () => {
  it("finds producers on both sides (anti-vacuity)", () => {
    expect(captured().size).toBeGreaterThan(50);
    expect(captured().has("home.png")).toBe(true);
    expect(generated().size).toBeGreaterThan(5);
  });

  it("generate.ts never writes a card capture-screens.ts owns", () => {
    const owned = captured();
    expect(
      [...generated()].filter((p) => owned.has(p)),
      "postbuild would overwrite these screenshots in dist/og/ — drop the generate.ts job",
    ).toEqual([]);
  });
});
