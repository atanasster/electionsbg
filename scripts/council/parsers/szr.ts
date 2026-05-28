// Стара Загора (SZR01) — per-decision "prepis" PDF parser.
//
// As of 2026-05 the município publishes native-text PDFs per decision:
//   /uploads/posts/{YYYY}/prepis_{NNNN}.pdf
// — each carries one Решение №NNNN, the ОТНОСНО:/ПО ТОЧКА... headers,
// and an aggregate vote tally in label-first form:
//   "Гласуване: за – 46, против - 0 и въздържали се – 0"
// followed by "Приема се." or "Не се приема.".
//
// Sessions are listed at /bg/resheniya-i-protokoli/ with per-session
// pages at /bg/resheniya-i-protokoli/resheniya-ot-protokol-{N}-ot-{DDMMYYYY}{g?}.
// Each session page links the prepis files for that protocol's decisions.
//
// Older protocols (pre-2024) had per-vote info ONLY in scanned image
// PDFs (skanirani-glasuvaniya-na-obshtsavetnitsi-sesiya-DDMMYY.pdf) —
// when we hit a `looksLikeScannedPdf` we route through Gemini OCR as
// a fallback; the same lib/tally.ts extractors then run unchanged.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import { ocrPdfWithGemini } from "../lib/gemini_ocr";
import { classifyResult, extractTally } from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "SZR01";
const BASE = "https://www.starazagora.bg/";
const INDEX_URL = `${BASE}bg/resheniya-i-protokoli/`;

type Session = {
  date: string; // YYYY-MM-DD
  session: string; // protocol number
  pageUrl: string;
};

type DecisionRef = {
  resolutionNumber: string;
  pdfUrl: string;
};

const SESSION_PATH_RE =
  /bg\/resheniya-i-protokoli\/resheniya-ot-protokol-(\d+)-ot-(\d{2})(\d{2})(\d{4})g?$/u;

const PREPIS_PATH_RE = /uploads\/posts\/\d{4}\/prepis[_-](\d+)/u;

/** Walk the SZR session index. */
const discoverSessions = async (opts: {
  sinceYear?: number;
  sinceDate?: string;
}): Promise<Session[]> => {
  const html = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(html);
  const out: Session[] = [];
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(SESSION_PATH_RE);
    if (!m) return;
    const session = m[1];
    const date = `${m[4]}-${m[3]}-${m[2]}`;
    if (opts.sinceYear && parseInt(m[4], 10) < opts.sinceYear) return;
    if (opts.sinceDate && date <= opts.sinceDate) return;
    out.push({
      session,
      date,
      pageUrl: resolveUrl(href.replace(/^\/+/, ""), BASE),
    });
  });
  // Dedupe by session.
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.date}|${s.session}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Pull the prepis-PDF links from one session page. */
const discoverDecisions = async (
  sessionUrl: string,
): Promise<DecisionRef[]> => {
  const html = await fetchHtml(sessionUrl);
  const $ = cheerio.load(html);
  const out: DecisionRef[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(PREPIS_PATH_RE);
    if (!m) return;
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);
    // SZR uses site-root-relative hrefs like "uploads/posts/2026/prepis_1722.pdf".
    // Resolve against BASE, not the session URL, to avoid prefixing the
    // /bg/resheniya-i-protokoli/ path.
    out.push({
      resolutionNumber: id,
      pdfUrl: resolveUrl(href.replace(/^\/+/, ""), BASE),
    });
  });
  return out;
};

/**
 * Get text out of a decision PDF — native text first, OCR fallback.
 * `ocrEnabled` gates the OCR call (so a fresh checkout can scrape native-
 * text PDFs without a GEMINI_API_KEY).
 */
const decisionText = async (
  pdfPath: string,
  pdfUrl: string,
  ocrEnabled: boolean,
): Promise<{ text: string; viaOcr: boolean }> => {
  const buf = await readFile(pdfPath);
  const text = await extractPdfText(buf);
  if (!looksLikeScannedPdf(text)) return { text, viaOcr: false };
  if (!ocrEnabled) {
    throw new Error(
      `scanned PDF requires Gemini OCR (pass --ocr to enable): ${pdfUrl}`,
    );
  }
  const ocr = await ocrPdfWithGemini(buf);
  if (ocr.usage.input) {
    console.log(
      `    [gemini] ${pdfUrl} — ${ocr.usage.input} in + ${ocr.usage.output} out tokens`,
    );
  }
  return { text: ocr.text, viaOcr: true };
};

const TITLE_RE =
  /ПО\s+ТОЧКА[^\n]*ОТ\s+ДНЕВНИЯ\s+РЕД\s*:\s*([\s\S]+?)(?:\n\s*Вносител|\n\s*Общински\s+съвет|\n\s*РЕШЕНИЕ)/iu;

/** Build one CouncilResolution from a single-decision PDF's text. */
const parseDecisionText = (
  text: string,
  ref: DecisionRef,
  session: Session,
  pdfUrl: string,
): CouncilResolution => {
  const tally = extractTally(text) ?? undefined;
  // For the result, use the post-tally Bulgarian marker. SZR style:
  // "Гласуване: за – N, против – N, въздържали се – N\nПриема се."
  let result: CouncilResolution["result"] = "unknown";
  if (tally) {
    const tallyMatch = text.match(/Гласуване\s*:[^\n]+/iu);
    if (tallyMatch) {
      const offset = text.indexOf(tallyMatch[0]) + tallyMatch[0].length;
      result = classifyResult(text, offset);
    } else {
      result = classifyResult(text, text.indexOf("Гласуване"));
    }
  }
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  const yyyy = session.date.slice(0, 4);
  return {
    id: `${OBSHTINA}-${yyyy}-prot${session.session}-r${ref.resolutionNumber}`,
    date: session.date,
    session: session.session,
    number: ref.resolutionNumber,
    title: title || "(no title parsed)",
    tally,
    result,
    sourceUrl: pdfUrl,
  };
};

export const scrapeSZR = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    ocr?: boolean;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;

  let sessions: Session[];
  try {
    sessions = await discoverSessions(opts);
  } catch (err) {
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched: 0,
      errors: [
        {
          url: INDEX_URL,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (opts.maxProtocols) sessions = sessions.slice(0, opts.maxProtocols);

  if (sessions.length === 0) {
    console.log(`  [${OBSHTINA}] no new sessions`);
    return {
      obshtinaCode: OBSHTINA,
      resolutions,
      protocolsTouched,
      errors,
    };
  }

  console.log(
    `  [${OBSHTINA}] processing ${sessions.length} session(s) (OCR=${opts.ocr ? "on" : "off"})`,
  );
  const dir = await mkdtemp(join(tmpdir(), "council-szr-"));
  try {
    for (const sess of sessions) {
      let refs: DecisionRef[];
      try {
        refs = await discoverDecisions(sess.pageUrl);
      } catch (err) {
        errors.push({
          url: sess.pageUrl,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      let pulled = 0;
      for (const ref of refs) {
        const pdfPath = join(dir, `prepis_${ref.resolutionNumber}.pdf`);
        try {
          await fetchToFile(ref.pdfUrl, pdfPath);
          const { text } = await decisionText(
            pdfPath,
            ref.pdfUrl,
            opts.ocr ?? false,
          );
          resolutions.push(parseDecisionText(text, ref, sess, ref.pdfUrl));
          pulled++;
        } catch (err) {
          errors.push({
            url: ref.pdfUrl,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      protocolsTouched++;
      console.log(
        `    + prot ${sess.session} (${sess.date}): ${pulled}/${refs.length} decision(s)`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
