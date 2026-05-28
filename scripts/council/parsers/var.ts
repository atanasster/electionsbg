// Варна (VAR01) — per-session "Препис-извлечение" PDF parser.
//
// CRITICAL CAVEAT: as of 2026-05, varnacouncil.bg publishes ONLY the
// "Препис-извлечение" extract format for council decisions. These
// extracts carry the decision text (ОТНОСНО header + Р Е Ш Е Н И Е body
// + resolution number in body as "<N>-<N>." prefix), but DO NOT carry
// the vote tally or any adopted/rejected marker — Varna strips that
// before publication. Per-decision votes presumably exist in the full
// session protocol, but that isn't on this site (the "Заседания" page
// links nothing public).
//
// What this parser delivers: decision metadata (number, title, date,
// sourceUrl) so the My-Area council tile can surface "what did the
// council decide" for Varna residents. Tally is undefined; result is
// "unknown". Filling those fields requires either a new source or a
// council policy change.
//
// Source surface:
//   - Mandate index:  /reshenija-na-obshtinski-savet-varna-mandat-2023-2027/
//   - Per-session PDF: /wp-content/uploads/{YYYY}/{MM}/РЕШЕНИЯ-№<N>-от-{DD.MM.YYYY}-г..pdf
//     (one PDF per session, can carry multiple decisions OR be a stub
//      like "Питания и отговори" with "Общински съвет – Варна няма решения")
//   - Per-decision attachments: /wp-content/uploads/.../Приложение-към-решение-* — skipped.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "VAR01";
const BASE = "https://varnacouncil.bg/";
const INDEX_URL = `${BASE}reshenija-na-obshtinski-savet-varna-mandat-2023-2027/`;

type SessionRef = {
  pdfUrl: string;
  session: string;
  date: string; // YYYY-MM-DD
};

/**
 * Match РЕШЕНИЯ-№NN-от-DD.MM.YYYY-г.pdf (URL-encoded Cyrillic). The Cyrillic
 * "РЕШЕНИЯ" word and "от" particle anchor the pattern; the date carries
 * DD.MM.YYYY with optional " г." suffix and trailing dot variants.
 *
 * Also accept the "Г." capitalized variant ("…-Г..pdf") that some early
 * session files use.
 */
// Varna's URL conventions drift between sessions:
//   №27-от-17.09.2025-г..pdf         (compact, lowercase, double-dot)
//   №-3-от-07.12.2023.pdf            (dash before digit, no suffix)
//   №-6-ОТ-21.02.2024-г..pdf         (uppercase ОТ, dash before digit)
//   №-8-ОТ-11.03.12.03.2024-г..pdf   (typo'd double date — we match the LAST one)
// So: allow dashes/whitespace between № and the digit, and rely on the
// case-insensitive flag for ОТ. Anchor the date on the first DD.MM.YYYY.
const SESSION_HREF_RE =
  /РЕШЕНИЯ-№[\s-]*(\d+)[\s-]*(?:от|ОТ)[\s-]*(\d{2})\.(\d{2})\.(\d{4})[^"]*\.pdf/iu;

const discoverSessions = async (): Promise<SessionRef[]> => {
  const html = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(html);
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    // URL-decode for matching since cheerio gives us the raw href.
    const decoded = decodeURIComponent(href);
    const m = decoded.match(SESSION_HREF_RE);
    if (!m) return;
    const pdfUrl = href.startsWith("http") ? href : resolveUrl(href, BASE);
    if (seen.has(pdfUrl)) return;
    seen.add(pdfUrl);
    out.push({
      pdfUrl,
      session: m[1],
      date: `${m[4]}-${m[3]}-${m[2]}`,
    });
  });
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
};

/**
 * Pull each decision from a session PDF.
 *
 * Anchor on "Р Е Ш Е Н И Е" (or plural "Р Е Ш Е Н И Я") headers with a
 * trailing colon. Resolution number is the FIRST "<NNN>-<N>." token in
 * the body following the header. ОТНОСНО: clause above the header
 * supplies the title.
 *
 * A "Питания и отговори" session can carry the disclaimer "Общински съвет
 * – Варна няма решения" — we emit no records in that case.
 */
// `g` flag here is needed for matchAll but we MUST NOT use this regex with
// `.exec()` at module scope — the persistent lastIndex would corrupt
// subsequent session parses. matchAll() returns a fresh iterator each call.
const RE_DECISION_HEADER = /Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+[ЕЯ]\s*:?/gu;
const RE_RESOLUTION_NUMBER = /\s(\d{2,4})\s*-\s*\d{1,3}\s*\./u;
const RE_OTNOSNO =
  /ОТНОСНО\s*:\s*([\s\S]{5,400}?)(?:\n\s*\n|\n\s*Докл\.|\n\s*Общински)/iu;

const parseSessionText = (
  text: string,
  meta: SessionRef,
): CouncilResolution[] => {
  // NOTE: do NOT early-return on "Общински съвет – Варна няма решения".
  // That phrase legitimately appears on the FIRST agenda page of a multi-
  // item session (typically "Питания и отговори" — questions & answers,
  // no votes taken). The header-driven scan below correctly returns 0
  // records for those, while still picking up the decisions on later pages.
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  const seen = new Set<string>();
  for (const match of text.matchAll(RE_DECISION_HEADER)) {
    const headerEnd = match.index! + match[0].length;
    const after = text.slice(headerEnd, headerEnd + 4000);
    const nMatch = after.match(RE_RESOLUTION_NUMBER);
    if (!nMatch) continue;
    const number = nMatch[1];
    if (seen.has(number)) continue;
    seen.add(number);
    // Title from preceding ОТНОСНО:.
    const back = text.slice(Math.max(0, match.index! - 4000), match.index!);
    const titleMatches = back.match(
      /ОТНОСНО\s*:\s*([\s\S]+?)(?:\n\s*\n|\n\s*Докл\.|\n\s*Общински)/giu,
    );
    let title = "";
    if (titleMatches && titleMatches.length > 0) {
      const last = titleMatches[titleMatches.length - 1];
      const t2 = last.match(RE_OTNOSNO);
      if (t2) title = t2[1].replace(/\s+/g, " ").trim();
    }
    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${number}`,
      date: meta.date,
      session: meta.session,
      number,
      title: title || "(no title parsed)",
      // Varna publishes Препис-извлечение without tallies — leave
      // tally undefined + result "unknown" rather than fabricating.
      result: "unknown",
      sourceUrl: meta.pdfUrl,
    });
  }
  return out;
};

export const scrapeVAR = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;

  let sessions: SessionRef[];
  try {
    sessions = await discoverSessions();
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

  if (opts.sinceYear)
    sessions = sessions.filter(
      (s) => parseInt(s.date.slice(0, 4), 10) >= opts.sinceYear!,
    );
  if (opts.sinceDate)
    sessions = sessions.filter((s) => s.date > opts.sinceDate!);
  if (opts.maxProtocols) sessions = sessions.slice(0, opts.maxProtocols);

  if (sessions.length === 0) {
    console.log(`  [${OBSHTINA}] no new sessions`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  console.log(`  [${OBSHTINA}] fetching ${sessions.length} session(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-var-"));
  try {
    for (const sess of sessions) {
      const pdfPath = join(dir, `s_${sess.session}_${sess.date}.pdf`);
      try {
        await fetchToFile(sess.pdfUrl, pdfPath);
        const buf = await readFile(pdfPath);
        const text = await extractPdfText(buf);
        if (looksLikeScannedPdf(text)) {
          errors.push({
            url: sess.pdfUrl,
            message: "scanned PDF — route to Phase 3 OCR",
          });
          continue;
        }
        const recs = parseSessionText(text, sess);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + sess ${sess.session} (${sess.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: sess.pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
