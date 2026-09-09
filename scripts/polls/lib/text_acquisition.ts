// Tier 2, T2b — text acquisition (docs/plans/polls-agency-watchers-v1.md
// §6.2). Turns one capture directory (`raw_data/polls/<agency>/<pubId>/`,
// written by `polls:fetch`) into plain text an extractor can run the
// evidence gate (decision 5) against: the article's own narrative text,
// every PDF attachment's `pdftotext -layout` output, and every discovered
// image's OCR transcription.
//
// Deliberately returns raw, ungated material — the DETERMINISTIC EXTRACTOR
// (Tier 2c, per agency) decides which of these sources actually carries the
// party shares for a given publication, and every number it lifts from any
// of them still has to survive the evidence gate before it is trusted.

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { extractPdfText } from "../../council/lib/pdf_text";
import { looksLikeLabelledTable, ocrImageFile } from "./ocr";

/**
 * The article-body container, per agency — ONLY where a real capture has
 * confirmed it (decision 18's own methodology: measure, don't assume).
 *
 *  - TR: `.et_pb_text_inner` — NOT `.et_pb_post_content` as §6.2 originally
 *    assumed; that selector matches nothing on a real Trend page (measured
 *    2026-09-09). Trend's Divi theme renders every text block through a
 *    generic "text module" wrapper, and a post's own narrative is the
 *    concatenation of every one of those on the page.
 *  - AR: `#content` — as documented, and confirmed live.
 *
 * Every other fetchable agency (ML, GM: pdftotext only; SH: OCR only; MY,
 * GIB: "article text" per §6.2 but UNVERIFIED — no real capture exists yet
 * to measure against) falls through to `GENERIC_CONTENT_SELECTORS` below.
 */
const AGENCY_TEXT_SELECTOR: Record<string, string> = {
  TR: ".et_pb_text_inner",
  AR: "#content",
};

/** Common WordPress content-container shapes, tried in order, first
 *  non-empty result wins — a reasonable default for an agency with no real
 *  capture to verify a specific selector against (MY, GIB today). Verify
 *  and add a confirmed entry to `AGENCY_TEXT_SELECTOR` before trusting this
 *  for either. */
const GENERIC_CONTENT_SELECTORS = [
  "article",
  ".entry-content",
  "#content",
  ".et_pb_text_inner",
];

// Alpha Research's LISTING page carries injected SEO spam (foreign-domain
// links — alpha_research.ts's own header); nothing measured so far shows it
// leaking into a POST BODY's text, but stripping a bare URL is a cheap,
// general hygiene step regardless of agency, so a stray link never gets
// treated as a quote-worthy sentence by an extractor.
const stripUrls = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// cheerio's own multi-element `.text()` concatenates every matched
// element's text with NO separator — verified against the real 212750
// capture, whose Divi "text module" blocks join as
// "...office@rctrend.bg" + "Последвайте ни..." with zero characters
// between "bg" and "Последвайте", gluing the end of one block's last
// word to the start of the next block's first word. Joining with "\n"
// first (later collapsed to a single space by the whitespace-normalising
// step below, same as every other run of whitespace) guarantees at least
// a WORD boundary between two blocks. It does not, and cannot, guarantee
// a SENTENCE boundary — if a real post ever splits one sentence across
// two adjacent blocks, `sentence_rule.ts`'s window would still run past
// it, which is the safer of the two directions (a window running too
// far risks the "more than one % found" refusal, not a wrong value).
const blockText = ($: cheerio.CheerioAPI, selector: string): string =>
  $(selector)
    .toArray()
    .map((el) => $(el).text())
    .join("\n");

export const extractArticleText = (agencyId: string, html: string): string => {
  const $ = cheerio.load(html);
  const selector = AGENCY_TEXT_SELECTOR[agencyId];
  if (selector)
    return stripUrls(blockText($, selector).replace(/\s+/g, " ").trim());
  for (const sel of GENERIC_CONTENT_SELECTORS) {
    const text = stripUrls(blockText($, sel).replace(/\s+/g, " ").trim());
    if (text.length > 0) return text;
  }
  return "";
};

/**
 * The page's own `<title>` text (cheerio decodes entities like `&mdash;`
 * automatically), agency-name suffix and all — a self-contained source for
 * `classifyRace`'s title argument, rather than depending on the watcher's
 * separately-tracked `Publication.title` (which `polls:fetch` does not
 * persist into the capture directory at all). The agency-name suffix
 * ("... — ТРЕНД") is harmless noise for a race classifier and left in
 * rather than parsed out with an agency-specific rule.
 */
export const extractPageTitle = (html: string): string =>
  cheerio.load(html)("title").text().trim();

export interface AcquiredAttachmentText {
  file: string;
  text: string;
}

export interface AcquiredImageText extends AcquiredAttachmentText {
  /** The cheap pre-gate signal (ocr.ts) — whether this transcription looks
   *  like a labelled table worth running the deterministic extractor
   *  against, or should fall straight through to the Gemini Vision
   *  fallback (decision 18, generalising Sova Harris's own "≥4 party
   *  labels, else Vision" rule to Trend/Alpha Research). */
  looksLikeTable: boolean;
}

export interface AcquiredText {
  articleText: string;
  /** `pdftotext -layout` output per PDF, filename-sorted (stable order —
   *  `discoverPdfLinks` already dedupes, but a capture directory's own
   *  `fs.readdirSync` order is not guaranteed across platforms). */
  pdfTexts: AcquiredAttachmentText[];
  /** OCR transcription per image, filename-sorted. Only ever non-empty for
   *  the three agencies `discoverAgencyImages` (capture.ts) knows an
   *  image pattern for — every other agency's captures carry no images at
   *  all, so this is `[]` for them by construction, not by a check here. */
  imageTexts: AcquiredImageText[];
}

const listAttachments = (captureDir: string, test: RegExp): string[] =>
  fs
    .readdirSync(captureDir)
    .filter((f) => test.test(f))
    .sort();

/**
 * Acquire every text source a capture directory can offer. Reads
 * `page.html` (required — throws if absent, since `polls:fetch` always
 * writes one) and OCRs/extracts whatever attachments are present; never
 * throws on a missing tesseract/pdftotext binary or a bad attachment — a
 * failed attachment's text comes back as `""` so one broken PDF cannot
 * abort acquisition for every other source in the same capture (the same
 * per-item isolation `polls:fetch` already applies to fetching them).
 */
export const acquireText = async (
  captureDir: string,
  agencyId: string,
): Promise<AcquiredText> => {
  const html = fs.readFileSync(path.join(captureDir, "page.html"), "utf8");
  const articleText = extractArticleText(agencyId, html);

  const pdfFiles = listAttachments(captureDir, /\.pdf$/i);
  const imageFiles = listAttachments(captureDir, /\.(png|jpe?g)$/i);

  const pdfTexts = await Promise.all(
    pdfFiles.map(async (file): Promise<AcquiredAttachmentText> => {
      try {
        const text = await extractPdfText(
          fs.readFileSync(path.join(captureDir, file)),
        );
        return { file, text };
      } catch {
        return { file, text: "" };
      }
    }),
  );

  const imageTexts = await Promise.all(
    imageFiles.map(async (file): Promise<AcquiredImageText> => {
      try {
        const text = await ocrImageFile(path.join(captureDir, file));
        return { file, text, looksLikeTable: looksLikeLabelledTable(text) };
      } catch {
        return { file, text: "", looksLikeTable: false };
      }
    }),
  );

  return { articleText, pdfTexts, imageTexts };
};
