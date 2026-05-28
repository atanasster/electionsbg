// Сливен (SLV01) — per-session PDF parser.
//
// PLEASANT SURPRISE: despite the obs.sliven.bg uploads using opaque hash
// filenames (no readable URL pattern) AND ABBYY-FineReader-15 OCR output
// (Sofia's protokol-N has FineReader 14 with the Cyrillic→Latin mojibake
// — see parsers/sof.ts header), Sliven's PDFs extract CLEAN Cyrillic
// text. The OCR pipeline in lib/gemini_ocr.ts is NOT needed for Sliven.
//
// Source surface:
//   - Decisions index: /decisions — anchors labelled
//     "Взети решения на сесията на Общинския съвет на DD.MM.YYYY г."
//     with hash URLs at /uploads/<HEX32>. Also lists appendices
//     ("Приложение към Решение № NNNN") which are skipped — they're
//     attachments to specific decisions, not session PDFs.
//   - Extraordinary sessions surface as
//     "Взето решение на извънредната сесия на Общинския съвет на DD.MM.YYYY г."
//     (note singular "Взето решение"). Same PDF format, often just one
//     decision per file.
//
// CAVEAT (same as Varna/Burgas/Plovdiv): no vote tally published. The
// PDFs are ПРЕПИС format — decision text only, no councillor votes or
// aggregate counts.
//
// PDF structure: one or more decisions separated by "Препис!" markers.
// Each block carries:
//   Р Е Ш Е Н И Е
//   № <NNNN>
//   <title spanning 1-4 lines>
//   На основание чл. X ...
//   ОБЩИНСКИЯТ СЪВЕТ
//   Р Е Ш И:
//   <decision body>
//   Решението е прието на заседание
//   на ОбС, проведено на DD.MM.YYYYг.

import * as cheerio from "cheerio";
import { fetchHtml, fetchToFile, resolveUrl } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import { ocrPdfWithGemini } from "../lib/gemini_ocr";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "SLV01";
const BASE = "https://obs.sliven.bg/";
const DECISIONS_URL = `${BASE}decisions`;

type SessionRef = {
  pdfUrl: string;
  date: string; // YYYY-MM-DD
  label: string; // human-readable text for diagnostics
};

// Match labels like:
//   "Взети решения на сесията на Общинския съвет на 30.04.2026 г."
//   "Взето решение на извънредната сесия на Общинския съвет на 11.12.2025 г."
// Three Bulgarian forms of the participle "taken":
//   "Взето решение" — neuter singular ("decision was taken")
//   "Взети решения" — plural ("decisions were taken")
//   "Взета..." — feminine singular, vanishingly rare here
// Accept all suffix vowels (о/а/и). The session number is dropped; we
// key on date alone since Sliven does not number sessions visibly.
const SESSION_LABEL_RE =
  /Взет[оаи]?\s+решени[ея]?\s+на\s+(?:извънредната\s+)?сесият?а?\s+на\s+Общинския\s+съвет\s+на\s+(\d{2})\.(\d{2})\.(\d{4})/iu;

const discoverSessions = async (): Promise<SessionRef[]> => {
  const html = await fetchHtml(DECISIONS_URL);
  const $ = cheerio.load(html);
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  $("a[href*='/uploads/']").each((_: number, a) => {
    const $a = $(a);
    const href = $a.attr("href") ?? "";
    const label = $a.text().trim().replace(/\s+/g, " ");
    const m = label.match(SESSION_LABEL_RE);
    if (!m) return;
    const url = href.startsWith("http") ? href : resolveUrl(href, BASE);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      pdfUrl: url,
      date: `${m[3]}-${m[2]}-${m[1]}`,
      label,
    });
  });
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
};

// One decision block. PDF is segmented by "Препис!" markers, each
// followed by the РЕШЕНИЕ header. JS \b is ASCII-only so we anchor
// against newline + leading whitespace instead.
const SEPARATOR = /(?:^|\n)\s*Препис\s*!\s*/gu;
// Tolerant of inline spaces between Cyrillic letters in the header
// ("Р Е Ш Е Н И Е" or "РЕШЕНИЕ"). Number captures from the following line.
const HEADER_RE = /(?:Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е|РЕШЕНИЕ)\s*\n?\s*№\s*(\d+)/u;
// Title sits between the № line and the next "На основание чл." preamble.
const TITLE_RE = /№\s*\d+\s*\n([\s\S]+?)\n\s*На\s+основание/iu;

const parseSessionText = (
  text: string,
  meta: SessionRef,
): CouncilResolution[] => {
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  const seen = new Set<string>();
  const blocks = text.split(SEPARATOR);
  for (const block of blocks) {
    const headerMatch = block.match(HEADER_RE);
    if (!headerMatch) continue;
    const number = headerMatch[1];
    if (seen.has(number)) continue;
    seen.add(number);
    const titleMatch = block.match(TITLE_RE);
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : "(no title parsed)";
    // Sliven doesn't number sessions visibly in the PDF, so the session
    // key is the sitting date compacted (DDMMYYYY) — keeps the ID
    // consistent with the other parsers' "prot{N}" segment.
    const sessionKey = meta.date.replace(/-/g, "");
    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${sessionKey}-r${number}`,
      date: meta.date,
      session: sessionKey,
      number,
      title,
      result: "unknown",
      sourceUrl: meta.pdfUrl,
    });
  }
  return out;
};

export const scrapeSLV = async (
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
          url: DECISIONS_URL,
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

  console.log(
    `  [${OBSHTINA}] processing ${sessions.length} session(s) (OCR=${opts.ocr ? "on" : "off"})`,
  );
  const dir = await mkdtemp(join(tmpdir(), "council-slv-"));
  try {
    for (const sess of sessions) {
      const pdfPath = join(dir, `s_${sess.date}.pdf`);
      try {
        await fetchToFile(sess.pdfUrl, pdfPath);
        const buf = await readFile(pdfPath);
        let text = await extractPdfText(buf);
        if (looksLikeScannedPdf(text)) {
          if (!opts.ocr) {
            errors.push({
              url: sess.pdfUrl,
              message:
                "scanned PDF — pass --ocr to fall back to Gemini Vision (most Sliven PDFs are FineReader 15 text, so this is rare)",
            });
            continue;
          }
          const ocr = await ocrPdfWithGemini(buf);
          if (ocr.usage.input) {
            console.log(
              `    [gemini] ${sess.pdfUrl} — ${ocr.usage.input} in + ${ocr.usage.output} out tokens`,
            );
          }
          text = ocr.text;
        }
        const recs = parseSessionText(text, sess);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(`    + sess ${sess.date}: ${recs.length} decision(s)`);
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
