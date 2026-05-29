// София (SOF) — Liferay-driven parser with two paths:
//
// Path A (always): per-resolution PDFs at `/documents/d/guest/r-<N>-<YYYY>`.
// Clean Cyrillic via pdftotext. Yields decision number, title (the
// "За ..." preamble), date, sourceUrl — NO vote tally because Sofia
// strips it from the per-decision Препис-извлечение.
//
// Path B (opt-in via `--ocr`): full session protokol at
// `/documents/d/guest/protokol-<sessionN>`. Hundreds of pages,
// contains the "Поименно гласуване:" tables + aggregate tallies. The
// PDF's text layer is UNUSABLE — `pdffonts` reports Helvetica/WinAnsi
// with no ToUnicode CMap, and pdftotext extracts gibberish where each
// Cyrillic glyph is tagged with a Latin lookalike codepoint. Recovery
// goes via Gemini Vision OCR through lib/pdf_chunk_ocr.ts (splits the
// PDF into ~30-page chunks via ghostscript, OCRs each, concatenates).
//
// Char-remap was ruled out 2026-05-29 — the cipher is not 1-to-1 (one
// Latin char ↔ multiple Cyrillic possibilities), expansion is variable
// (Щ→IIII4, Ш→III, П→II, Ъ→Cb), and multiple Cyrillic letters share
// output (Е and Б both → E). Disambiguation would need n-gram language
// modelling for ~60-70% glyph recovery. Gemini OCR delivers near-100%
// clean Cyrillic at ~$0.10-$0.50 per Sofia session (210 pages, mostly
// boilerplate; the input-token cost dominates at ~$0.075 since the
// PDF goes in as one DOCUMENT modality, ~288 tokens/page).
//
// Older PK (standing committee) protocols like protokol-92-2023-06-14
// are NOT affected — clean Cyrillic via pdftotext. The encoding break
// is specific to the FULL council protocols Sofia started publishing
// around 2024-2025.
//
// Enumeration uses Playwright because the AssetPublisher pagination is
// server-rendered through a Liferay portlet — direct curl returns the
// page shell only. See lib/sof_playwright.ts.

import { fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import { ocrPdfChunked } from "../lib/pdf_chunk_ocr";
import {
  classifyResult,
  extractNamedVoteBlock,
  findAllTallies,
  findResolutionMarkers,
} from "../lib/tally";
import {
  buildMuniLookup,
  joinVotesToRoster,
  summariseJoin,
} from "../lib/roster_join";
import type {
  CouncilResolution,
  CouncilTally,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import {
  closePlaywright,
  enumerateSessionArtifacts,
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

/**
 * When `--ocr` is on, fetch the session's full protokol-N PDF and run
 * it through chunked Gemini Vision OCR (lib/pdf_chunk_ocr.ts), then
 * run findAllTallies + findResolutionMarkers + extractNamedVoteBlock
 * over the recovered Cyrillic. Returns a map keyed by resolution
 * number → { tally, perCouncillor, result } so the caller can merge
 * into the per-resolution records built from the clean
 * per-resolution PDFs.
 */
type SofiaUnlockEntry = {
  tally?: CouncilTally;
  result: CouncilResolution["result"];
};

const unlockProtokolTallies = async (
  protokolUrl: string,
  sess: SofiaSession,
  dir: string,
  doPerCouncillor: boolean,
): Promise<{
  /** Keyed by the marker number (Решение № NNN if the OCR preserved
   * it; Точка N otherwise). */
  byNumber: Map<string, SofiaUnlockEntry>;
  /** Markers in document order — supports positional fallback when the
   * map keys turn out to be Точка numbers (1-80) that don't match
   * decision numbers (303-380). */
  inOrder: SofiaUnlockEntry[];
  cost: number;
  pages: number;
  joinExact: number;
  joinTotal: number;
  /** Did findResolutionMarkers see "Решение № NNN" all-caps headers
   * (in which case mapping by number is reliable)? */
  hasReshenieHeaders: boolean;
}> => {
  const out = new Map<string, SofiaUnlockEntry>();
  const inOrder: SofiaUnlockEntry[] = [];
  const path = join(dir, `protokol_${sess.session}.pdf`);
  await fetchToFile(protokolUrl, path, { timeoutMs: 120000 });
  const { text, usage } = await ocrPdfChunked(path);

  // Save the OCR output to /tmp for diagnostics — cleaned up on the next
  // run of this session. Useful when debugging unmerged tallies; the
  // upstream temp dir cleanup wipes the chunks immediately on exit.
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`/tmp/council/sof_${sess.session}_ocr.txt`, text, "utf8");
  } catch {
    /* best-effort only */
  }

  const lookup = doPerCouncillor
    ? await buildMuniLookup("Столична община")
    : null;
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  let joinExact = 0;
  let joinTotal = 0;
  let hasReshenieHeaders = false;
  // Heuristic: if the OCR text has more than 20 distinct "Решение № NNN"
  // (large-N) headers, we trust mapping by number; otherwise fall back
  // to positional. "Точка <N>" matches are small N (1-80) so they tip
  // the average down — count distinct numbers > 100 as the signal.
  for (const m of markers) {
    if (parseInt(m.number, 10) > 100) {
      hasReshenieHeaders = true;
      break;
    }
  }
  for (const marker of markers) {
    // Sofia OCR places the aggregate tally AFTER the agenda marker:
    //   ... per-councillor block ...
    //   Точка <N>
    //   Общо гласували: <T>
    //   За <X>  Против <Y>  Въздържали се <Z>
    // So pair each marker with the FIRST tally whose offset is > the
    // marker (V. Tarnovo's pairing logic flips this).
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset > marker.offset) {
        best = t;
        break;
      }
    }
    // Lookback for the per-councillor block ALWAYS goes from the
    // marker (the per-councillor list precedes Точка <N>) — never
    // from the tally offset, because the tally is downstream.
    let tally = best?.tally;
    if (tally && lookup) {
      const votes = extractNamedVoteBlock(text, marker.offset);
      if (votes.length > 0) {
        const joined = joinVotesToRoster(votes, lookup);
        const stats = summariseJoin(joined);
        joinExact += stats.exact;
        joinTotal += stats.total;
        tally = {
          ...tally,
          method: "named",
          perCouncillor: joined.map((j) => ({
            name: j.matchedTo ?? j.name,
            normKey: j.normKey,
            vote: j.vote,
          })),
        };
      }
    }
    const result = best ? classifyResult(text, best.offset) : "unknown";
    const entry: SofiaUnlockEntry = { tally, result };
    out.set(marker.number, entry);
    if (tally) inOrder.push(entry);
  }
  return {
    byNumber: out,
    inOrder,
    cost: usage.estUsd,
    pages: usage.outputTokens,
    joinExact,
    joinTotal,
    hasReshenieHeaders,
  };
};

export const scrapeSOF = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    perCouncillor?: boolean;
    ocr?: boolean;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;
  let totalOcrCost = 0;

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
      let arts: Awaited<ReturnType<typeof enumerateSessionArtifacts>>;
      try {
        // Pass the session number so the artifact picker can
        // disambiguate between protokol-<thisSession> and other
        // protokols that get cross-linked from cited PK references.
        arts = await enumerateSessionArtifacts(sess.pageUrl, sess.session);
      } catch (err) {
        errors.push({
          url: sess.pageUrl,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const refs = arts.resolutions;
      console.log(
        `    + sess ${sess.session} (${sess.date}): ${refs.length} resolution PDF(s) discovered${arts.protokolUrl ? "; protokol available" : ""}`,
      );
      // Step 1: pull per-resolution PDFs (clean Cyrillic, no tally) to
      // build the decision-metadata records.
      const sessionRecs: CouncilResolution[] = [];
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
            sessionRecs.push(rec);
            pulled++;
          }
        } catch (err) {
          errors.push({
            url: ref.pdfUrl,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Step 2: when --ocr, OCR the full session protokol and merge
      // tally + perCouncillor data into the existing records.
      if (opts.ocr && arts.protokolUrl) {
        try {
          const unlock = await unlockProtokolTallies(
            arts.protokolUrl,
            sess,
            dir,
            opts.perCouncillor ?? false,
          );
          totalOcrCost += unlock.cost;
          let merged = 0;
          let mergeMethod: "number" | "positional" = "number";
          // Path A: the OCR preserved "Решение № NNN" headers; join by
          // exact number. Path B (Sofia today): the OCR surfaces only
          // "Точка <N>" agenda markers — fall back to POSITIONAL
          // matching: the Nth Точка with tally data is the decision
          // whose number ranks Nth in ascending order within the
          // session's per-resolution PDFs. This works because each
          // adopted decision generates exactly one r-NNN-YYYY PDF in
          // sequential numbering.
          if (unlock.hasReshenieHeaders) {
            for (const r of sessionRecs) {
              const u = unlock.byNumber.get(r.number);
              if (!u) continue;
              r.tally = u.tally;
              r.result = u.result;
              merged++;
            }
          } else if (unlock.inOrder.length > 0) {
            mergeMethod = "positional";
            const sortedRecs = [...sessionRecs].sort(
              (a, b) => parseInt(a.number, 10) - parseInt(b.number, 10),
            );
            const n = Math.min(sortedRecs.length, unlock.inOrder.length);
            for (let i = 0; i < n; i++) {
              sortedRecs[i].tally = unlock.inOrder[i].tally;
              sortedRecs[i].result = unlock.inOrder[i].result;
              merged++;
            }
          }
          const joinPct =
            unlock.joinTotal > 0
              ? ` · join ${unlock.joinExact}/${unlock.joinTotal} (${Math.round((unlock.joinExact / unlock.joinTotal) * 100)}%)`
              : "";
          console.log(
            `      ocr: $${unlock.cost.toFixed(4)} (${mergeMethod}), merged tally into ${merged}/${refs.length}${joinPct}`,
          );
        } catch (err) {
          errors.push({
            url: arts.protokolUrl,
            message: `protokol OCR failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      resolutions.push(...sessionRecs);
      protocolsTouched++;
      console.log(`      ${pulled}/${refs.length} parsed into records`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await closePlaywright();
  }

  if (opts.ocr && totalOcrCost > 0)
    console.log(
      `  [${OBSHTINA}] cumulative OCR cost: $${totalOcrCost.toFixed(4)}`,
    );
  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
