// The right-of-reply section must exist wherever the person pages send readers. It existed only in
// the /about prerender until 2026-10-01, so the anchor vanished as soon as AboutScreen rendered.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ACCUMULATION_GAP,
  ACCUMULATION_GAP_ID,
  accumulationGapHtml,
} from "./accumulationGapContent";

const REPO = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

describe("the /about#accumulation-gap section", () => {
  it("is the anchor the person pages link to", () => {
    expect(read("src/screens/person/PersonAccumulationGap.tsx")).toContain(
      `/about#${ACCUMULATION_GAP_ID}`,
    );
  });

  it("is rendered by BOTH the React screen and the prerender, from this module", () => {
    const screen = read("src/screens/AboutScreen.tsx");
    expect(screen).toContain("id={ACCUMULATION_GAP_ID}");
    expect(screen).toContain("ACCUMULATION_GAP[");
    const prerender = read("scripts/prerender/routes.ts");
    expect(prerender).toContain('accumulationGapHtml("bg")');
    expect(prerender).toContain('accumulationGapHtml("en")');
    // No hand-written copy left to drift from this one.
    expect(prerender).not.toContain('<h2 id="accumulation-gap">');
  });

  it("carries a right of reply with a working contact in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const html = accumulationGapHtml(lang);
      expect(html).toContain(`<h2 id="${ACCUMULATION_GAP_ID}">`);
      expect(html).toContain('href="mailto:support@electionsbg.com"');
    }
    expect(ACCUMULATION_GAP.bg.paragraphs.length).toBe(
      ACCUMULATION_GAP.en.paragraphs.length,
    );
  });
});
