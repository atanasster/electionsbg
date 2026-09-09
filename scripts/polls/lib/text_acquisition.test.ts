import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { acquireText, extractArticleText } from "./text_acquisition";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const rawCapture = (agencyDir: string, pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls", agencyDir, pubId);

const hasBinary = (cmd: string, versionFlag: string): boolean => {
  try {
    execFileSync(cmd, [versionFlag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// `acquireText` spawns the real `tesseract`/`pdftotext` binaries (via
// `ocrImageFile`/`extractPdfText`) — unlike `ocr.test.ts`, whose header
// notes it deliberately tests only the pure post-processing function for
// this exact reason, the tests below exercise the binaries themselves
// against real fixtures. Skip rather than fail when either is missing
// (e.g. a bare CI runner with no `tesseract-ocr`/`poppler-utils` step),
// matching `scripts/nzok/hospital_payments_corpus.test.ts`'s precedent for
// a real-binary/real-fixture test — a missing tool must read as "not run
// here", never as a code defect.
const HAS_OCR_BINARIES =
  hasBinary("tesseract", "--version") && hasBinary("pdftotext", "-v");
if (!HAS_OCR_BINARIES) {
  console.warn(
    "[text_acquisition.test] tesseract/pdftotext not found on PATH — skipping the real-binary acquireText tests.",
  );
}
const runWithBinaries = HAS_OCR_BINARIES ? it : it.skip;

describe("extractArticleText", () => {
  it("TR: reads the real narrative text via .et_pb_text_inner, not .et_pb_post_content", () => {
    const html = fs.readFileSync(
      path.join(rawCapture("trend", "212750"), "page.html"),
      "utf8",
    );
    const text = extractArticleText("TR", html);
    // The real party-share sentence measured 2026-09-09.
    expect(text).toContain("Прогресивна България");
    expect(text).toContain("33,2%");
    expect(text).toContain("ГЕРБ-СДС");
  });

  it("AR: reads the real narrative text via #content on a full-narrative post", () => {
    const html = fs.readFileSync(
      path.join(rawCapture("alpha_research", "1043"), "page.html"),
      "utf8",
    );
    const text = extractArticleText("AR", html);
    expect(text).toContain("32.6%");
    expect(text).toContain("ГЕРБ");
  });

  it("AR: a chart-only post yields only the passport paragraph, no party shares", () => {
    const html = fs.readFileSync(
      path.join(rawCapture("alpha_research", "1044"), "page.html"),
      "utf8",
    );
    const text = extractArticleText("AR", html);
    // The real passport text measured 2026-09-09 — present.
    expect(text).toContain("Период на провеждане");
    // No party name/percentage anywhere — everything is in the GraphN.jpg
    // images instead (decision 18).
    expect(text).not.toMatch(/\d+[.,]\d+\s*%/);
  });

  it("strips a bare URL out of the extracted text", () => {
    const html = `<html><body><article>Виж https://spam.example.com/x тук.</article></body></html>`;
    expect(extractArticleText("MY", html)).toBe("Виж тук.");
  });

  it("falls through the generic selector cascade for an agency with no confirmed selector", () => {
    const html = `<html><body><div id="content">Генерично съдържание.</div></body></html>`;
    expect(extractArticleText("GIB", html)).toBe("Генерично съдържание.");
  });

  it("returns an empty string when nothing in the cascade matches", () => {
    const html = `<html><body><div class="unrelated">x</div></body></html>`;
    expect(extractArticleText("MY", html)).toBe("");
  });
});

describe("acquireText (real capture directories, real tesseract/pdftotext)", () => {
  runWithBinaries(
    "TR: OCRs the real passport slide and reports it as a labelled table",
    async () => {
      const dir = rawCapture("trend", "212750");
      const acquired = await acquireText(dir, "TR");
      expect(acquired.articleText).toContain("Прогресивна България");
      expect(acquired.pdfTexts).toEqual([]);
      expect(acquired.imageTexts).toHaveLength(2); // Slide2.png, Slide3.png
      const passport = acquired.imageTexts.find((t) =>
        t.text.includes("Период на провеждане"),
      );
      expect(passport).toBeDefined();
    },
    30_000,
  );

  runWithBinaries(
    "AR: OCRs a chart-only post's GraphN.jpg images",
    async () => {
      const dir = rawCapture("alpha_research", "1044");
      const acquired = await acquireText(dir, "AR");
      expect(acquired.imageTexts).toHaveLength(2); // Graph01.jpg, Graph02.jpg
      // At least one image transcribes SOME text (real OCR, real image).
      expect(acquired.imageTexts.some((t) => t.text.trim().length > 0)).toBe(
        true,
      );
    },
    30_000,
  );

  it("returns [] for pdfTexts/imageTexts when a capture has neither", async () => {
    // Market Links' PDF is blocked (403) — this capture has only page.html.
    const dir = rawCapture("market_links", "118");
    const acquired = await acquireText(dir, "ML");
    expect(acquired.pdfTexts).toEqual([]);
    expect(acquired.imageTexts).toEqual([]);
  });
});
