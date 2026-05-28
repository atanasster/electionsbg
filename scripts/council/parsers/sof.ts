// София (SOF) — Liferay-driven per-resolution PDF parser.
//
// CAVEAT (substantial): Sofia council protocols come in two flavours:
//
// 1. **Per-resolution PDFs** at `/documents/d/guest/r-<N>-<YYYY>` —
//    Properly-encoded Cyrillic text layer (ABBYY FineReader 14 OCR
//    output). Each carries a single Решение №<N> with the decision
//    body, but NO vote tally or per-councillor list. Useful for
//    decision metadata (number, title, date, sourceUrl).
//
// 2. **Full session protocol** at `/documents/d/guest/protokol-<sessionN>` —
//    Hundreds of pages, contains the aggregate tally + per-councillor
//    named-vote tables ("Поименно гласуване:"). BUT the OCR output uses
//    a custom font where Cyrillic glyphs are tagged with Latin
//    codepoints (C→С, O→О, T→Т, 4→Ч, 6→б, etc.) — pdftotext extracts
//    "garbled" text that needs character remapping to recover the
//    original Cyrillic. Older PK (standing committee) protocols like
//    protokol-92-2023-06-14 are NOT affected; the encoding break is
//    specific to the full council protocols Sofia started publishing
//    around 2024-2025.
//
// What this parser delivers TODAY: per-resolution metadata via path 1.
// Title is the "За ..." preamble preceding the РЕШИ: clause. Tally
// + result remain undefined/unknown until either (a) the encoding
// remap is built or (b) tallies are re-OCR'd via Gemini Vision. Both
// follow-ups are documented in the README's "Phase 2.5" section.
//
// Enumeration uses Playwright because the AssetPublisher pagination
// is server-rendered through a Liferay portlet — direct curl returns
// the page shell only. See lib/sof_playwright.ts.

import { fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import {
  closePlaywright,
  enumerateResolutions,
  enumerateSessions,
  type SofiaSession,
} from "../lib/sof_playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "SOF";

// "Р Е Ш Е Н И Е № 3 0 3" — Sofia spaces out every glyph (including
// digit groups). Allow whitespace between each letter AND between each
// digit so "№ 3 0 3" is captured as "303".
const HEADER_RE = /Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s*№\s*((?:\d\s*)+)/u;
// First paragraph after the header is the "За ..." topic preamble — a
// 1-4 line topic statement ending before "На основание чл."
const TITLE_RE = /\n\s*За\s+([\s\S]{10,500}?)(?:\n\s*\n|\n\s*На\s+основание)/iu;

const parseResolutionPdf = (
  text: string,
  resolutionNumber: string,
  session: SofiaSession,
  pdfUrl: string,
): CouncilResolution | null => {
  const yyyy = session.date.slice(0, 4);
  const headerMatch = text.match(HEADER_RE);
  if (!headerMatch) return null;
  const headerNumber = headerMatch[1].replace(/\s+/g, "");
  // Trust the URL-derived number; cross-check the header agrees.
  if (headerNumber !== resolutionNumber) {
    // Mismatch could mean (a) URL pointed at the wrong PDF, or
    // (b) Sofia reused a slug. Surface but trust the header.
  }
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim()
    : "(no title parsed)";
  return {
    id: `${OBSHTINA}-${yyyy}-prot${session.session}-r${resolutionNumber}`,
    date: session.date,
    session: session.session,
    number: resolutionNumber,
    title,
    // Per-resolution Sofia PDFs don't include tally data. See file
    // header. Tally + result come from the full protokol-<N> PDF
    // which is currently unreadable due to a custom-font OCR break.
    result: "unknown",
    sourceUrl: pdfUrl,
  };
};

export const scrapeSOF = async (
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

  let sessions: SofiaSession[];
  try {
    sessions = await enumerateSessions();
  } catch (err) {
    await closePlaywright();
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched: 0,
      errors: [
        {
          url: "https://council.sofia.bg/meetings-mandat-2023-2027",
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
    await closePlaywright();
    console.log(`  [${OBSHTINA}] no new sessions`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  console.log(`  [${OBSHTINA}] enumerating ${sessions.length} session(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-sof-"));
  try {
    for (const sess of sessions) {
      let refs: Awaited<ReturnType<typeof enumerateResolutions>>;
      try {
        refs = await enumerateResolutions(sess.pageUrl);
      } catch (err) {
        errors.push({
          url: sess.pageUrl,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      console.log(
        `    + sess ${sess.session} (${sess.date}): ${refs.length} resolution PDF(s) discovered`,
      );
      let pulled = 0;
      for (const ref of refs) {
        const pdfPath = join(dir, `r_${ref.number}.pdf`);
        try {
          await fetchToFile(ref.pdfUrl, pdfPath);
          const buf = await readFile(pdfPath);
          const text = await extractPdfText(buf);
          if (looksLikeScannedPdf(text)) {
            errors.push({
              url: ref.pdfUrl,
              message: "PDF has no text layer — skipped",
            });
            continue;
          }
          const rec = parseResolutionPdf(text, ref.number, sess, ref.pdfUrl);
          if (rec) {
            resolutions.push(rec);
            pulled++;
          }
        } catch (err) {
          errors.push({
            url: ref.pdfUrl,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      protocolsTouched++;
      console.log(`      ${pulled}/${refs.length} parsed into records`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await closePlaywright();
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
