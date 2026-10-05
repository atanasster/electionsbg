import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KEYNOTE_EXPORT_SCRIPT,
  PRESENTATION_RE,
  extractPresentationText,
  keynoteArgs,
} from "./ppt_text";

describe("keynoteArgs", () => {
  it("passes both paths as argv, never inside the script text", () => {
    const args = keynoteArgs("/a/2010%20Report (1).ppt", "/b/out.pdf");
    expect(args.slice(-2)).toEqual(["/a/2010%20Report (1).ppt", "/b/out.pdf"]);
    expect(args.filter((a) => a.includes("2010%20"))).toHaveLength(1);
  });

  it("resolves the files before the Keynote tell block", () => {
    // Inside the tell block Keynote coerces `POSIX file` and `open` returns
    // missing value (-1700) — the failure this ordering fixes.
    const tell = KEYNOTE_EXPORT_SCRIPT.findIndex((l) => l.startsWith("tell"));
    const resolves = KEYNOTE_EXPORT_SCRIPT.map((l, i) => [l, i] as const)
      .filter(([l]) => l.includes("POSIX file"))
      .map(([, i]) => i);
    expect(resolves.length).toBe(2);
    expect(resolves.every((i) => i < tell)).toBe(true);
  });
});

describe("PRESENTATION_RE", () => {
  it("matches .ppt and .pptx, not .pdf or .doc", () => {
    expect(["a.ppt", "a.PPTX"].every((f) => PRESENTATION_RE.test(f))).toBe(
      true,
    );
    expect(
      ["a.pdf", "a.doc", "ppt.txt"].some((f) => PRESENTATION_RE.test(f)),
    ).toBe(false);
  });
});

// A real conversion launches Keynote (≈30 s) or LibreOffice, so it runs only
// on request: POLLS_PPT_IT=1 with the 2010 Alpha Research capture present.
const CAPTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../raw_data/polls/alpha_research/838.v2/2010%20Public_opinion_AR_October_2010.ppt",
);
describe.skipIf(!process.env.POLLS_PPT_IT || !fs.existsSync(CAPTURE))(
  "extractPresentationText (real converter)",
  () => {
    it("reads the October 2010 vote-intention slide", async () => {
      const text = await extractPresentationText(CAPTURE);
      expect(text).toMatch(/ГЕРБ/);
      expect(text).toMatch(/27[.,]5/);
    }, 240_000);
  },
);
