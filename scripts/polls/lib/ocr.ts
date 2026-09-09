// Image OCR via the system `tesseract` binary, for the three agencies whose
// data is sometimes published ONLY as an image (decision 18): Sova Harris's
// whole bulletin scan, Trend's passport slide, Alpha Research's chart-only
// posts. Same convention as scripts/council/lib/pdf_text.ts's `pdftotext`
// wrapper — a system binary, not an npm dependency, with a clear error when
// it is missing rather than a cryptic ENOENT.
//
// MEASURED live 2026-09-09 against real captures: Trend's passport slide
// (a text-shaped methodology summary — "Период на провеждане: 13-16 април
// 2026 г." came back byte-clean) OCRs reliably; a BAR CHART (Alpha
// Research's `GraphN.jpg`, Trend's own results slide) OCRs row-by-row
// reasonably for a data-labelled chart (each row pairs one party name with
// one number) but reads several rows' numbers as noise — e.g. real output
// included "меч. ДД з зе." for a row tesseract could not resolve at all.
// That is exactly the ≥4-clean-labels-else-Vision-fallback shape decision
// §6.2 already specifies for Sova Harris, generalised here to the other two.

import { spawn } from "node:child_process";

const TESSERACT = "tesseract";

/**
 * OCR one image file through tesseract, Bulgarian language data, page
 * segmentation mode 6 (uniform block of text — decision §6.2's own choice,
 * and the one that reads a labelled bar chart row-by-row rather than
 * column-by-column). Returns the raw transcription; callers decide how
 * much of it they trust.
 *
 * Throws a clear, actionable error when the binary itself is missing
 * (matching `extractPdfText`'s ENOENT handling) rather than a bare
 * "spawn tesseract ENOENT". A genuine OCR failure (a corrupt image, an
 * unsupported format) also throws — callers running this as a fallback
 * should catch it and fall through to a WORSE, not fewer, evidence path
 * (Gemini Vision), never silently treat a thrown error as "no text".
 */
export const ocrImageFile = (imagePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      TESSERACT,
      [imagePath, "-", "-l", "bul", "--psm", "6"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "tesseract not found on PATH — install it (brew install tesseract tesseract-lang) with the Bulgarian language pack",
          ),
        );
      } else reject(err);
    });
    child.on("close", (code: number | null) => {
      // tesseract prints its own progress banner ("Estimating resolution...")
      // to stderr on a clean run — a non-zero exit is the only reliable
      // failure signal, not stderr's mere presence.
      if (code !== 0) {
        reject(new Error(`tesseract exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });

/**
 * How many distinct-looking "<label> ... <number>" rows a block of OCR text
 * plausibly carries — the cheap, pre-gate signal that decides whether this
 * transcription is worth sending to the deterministic extractor at all, or
 * should fall straight through to the Gemini Vision fallback. Deliberately
 * generous (any line with both a letter run and a digit run counts) since
 * the real gate (decision 5) does the actual grounding check later; this is
 * only "does this page look like a table", the same test decision §6.2
 * already applies to Sova Harris ("pages carrying ≥ 4 party labels").
 */
export const looksLikeLabelledTable = (
  ocrText: string,
  minRows = 4,
): boolean => {
  const rows = ocrText
    .split("\n")
    .filter((line) => /[\p{L}]{3,}/u.test(line) && /\d/.test(line));
  return rows.length >= minRows;
};
