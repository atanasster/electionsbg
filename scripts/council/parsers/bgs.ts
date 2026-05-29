// Бургас (BGS01) — drill-in parser over Drupal /node/{id} session pages.
//
// The Burgas council site has TWO parallel /node/<id> page trees per
// session:
//
//   /reshenia (decision index) →
//     /node/<id> with H1 "ВЗЕТИ РЕШЕНИЯ НА ЗАСЕДАНИЕ №N ..." →
//       /sites/default/files/{YYYY-MM}/za-sayta-N-sayt.pdf
//       (ПРЕПИС-ИЗВЛЕЧЕНИЕ — decision text only, NO tallies, NO votes)
//
//   /video (video archive) →
//     /node/<id> with title "ВИДЕОАРХИВ И ПРОТОКОЛ НА ЗАСЕДАНИЕ №N ..." →
//       /sites/default/files/{YYYY-MM}/protokol-N-sayt.pdf
//       (born-digital full session protokol with per-councillor named
//        vote blocks + aggregate "поименно гласуване" tallies)
//
// Phase 1 path: enumerate /reshenia, pull za-sayta, emit decisions with
// ОбС docket id as the resolution number, no tally.
//
// Phase 2 path (--per-councillor): ALSO enumerate /video → map each
// session number to its protokol-N-sayt.pdf, fetch + extractPdfText
// (born-digital, no OCR needed), run findAllTallies +
// findResolutionMarkers (which accepts "Точка N" as a fallback marker,
// added during the Sofia OCR work) + extractNamedVoteBlock, then merge
// the tally + perCouncillor onto each za-sayta-emitted record by
// AGENDA POSITION — Burgas's protokol Точка N aligns with the za-sayta
// agenda's position N. (We use position rather than ОбС docket id
// because the protokol body sometimes paraphrases the dnevenred header
// and the docket isn't always restated literally.)
//
// Decision ID is built from the ОбС docket id ("08-00-17953" → "17953"
// for the trailing number, normalised) — stable across the entire
// mandate so the same docket re-ingest is idempotent.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "BGS01";
const BASE = "https://burgascouncil.org/";
const INDEX_URL = `${BASE}reshenia`;
const VIDEO_INDEX_URL = `${BASE}video`;

type SessionRef = {
  pageUrl: string;
  pdfUrl: string;
  /** Optional protokol-N-sayt.pdf URL — filled in by discoverProtokols
   *  when the matching /video/<id> page is found. Phase-2 only. */
  protokolUrl?: string;
  session: string;
  date: string;
};

const NODE_HREF_RE = /^\/node\/(\d+)$/u;
const TITLE_RE =
  /ВЗЕТИ\s+РЕШЕНИЯ\s+НА\s+ЗАСЕДАНИЕ\s+№\s*(\d+)\s+ОТ\s+ДАТА\s+(\d{2})\.(\d{2})\.(\d{4})/iu;
const PDF_HREF_RE = /\/sites\/default\/files\/[\d-]+\/za-sayta-\d+\.pdf/u;

// /video tree: title is "ВИДЕОАРХИВ И ПРОТОКОЛ НА ЗАСЕДАНИЕ №<N> ..." and
// the protokol PDF is href="/sites/default/files/{YYYY-MM}/protokol-<N>-sayt.pdf"
// (sometimes also /protokol-<N>.pdf — accept both forms).
const VIDEO_TITLE_RE =
  /ВИДЕОАРХИВ\s+И\s+ПРОТОКОЛ\s+НА\s+ЗАСЕДАНИЕ\s+№\s*(\d+)/iu;
const PROTOKOL_HREF_RE =
  /\/sites\/default\/files\/[\d-]+\/protokol-\d+(?:-sayt)?\.pdf/u;

/**
 * Walk the /video index → per-session /node/<id> pages to build a
 * map of session number → protokol PDF URL. Used only when
 * --per-councillor is set; cheap once-per-run lookup, ~30 HTTP gets.
 */
const discoverProtokols = async (): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  let indexHtml: string;
  try {
    indexHtml = await fetchHtml(VIDEO_INDEX_URL);
  } catch {
    return out;
  }
  const $ = cheerio.load(indexHtml);
  const nodeIds = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(NODE_HREF_RE);
    if (m) nodeIds.add(m[1]);
  });
  for (const nodeId of nodeIds) {
    let html: string;
    try {
      html = await fetchHtml(`${BASE}node/${nodeId}`);
    } catch {
      continue;
    }
    const titleMatch = html.match(VIDEO_TITLE_RE);
    if (!titleMatch) continue;
    const pdfMatch = html.match(PROTOKOL_HREF_RE);
    if (!pdfMatch) continue;
    // First-wins: the index page also surfaces older entries that share
    // a session number with newer cycles; the freshest one on the index
    // is processed first by the iterator, but session numbers here cover
    // a single mandate so collisions are vanishingly rare.
    if (!out.has(titleMatch[1])) {
      out.set(titleMatch[1], resolveUrl(pdfMatch[0], BASE));
    }
  }
  return out;
};

const discoverSessions = async (): Promise<SessionRef[]> => {
  const indexHtml = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(indexHtml);
  const nodeIds = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(NODE_HREF_RE);
    if (m) nodeIds.add(m[1]);
  });
  // Drupal navigation throws lots of unrelated /node/<id> hrefs onto every
  // page (menus, news teasers etc). We can't filter on the index page
  // alone — drill into each and keep the ones whose H1 matches the
  // ВЗЕТИ РЕШЕНИЯ pattern.
  const sessions: SessionRef[] = [];
  for (const nodeId of nodeIds) {
    const pageUrl = `${BASE}node/${nodeId}`;
    let html: string;
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }
    const titleMatch = html.match(TITLE_RE);
    if (!titleMatch) continue;
    const pdfMatch = html.match(PDF_HREF_RE);
    if (!pdfMatch) continue;
    sessions.push({
      pageUrl,
      pdfUrl: resolveUrl(pdfMatch[0], BASE),
      session: titleMatch[1],
      date: `${titleMatch[4]}-${titleMatch[3]}-${titleMatch[2]}`,
    });
  }
  // Dedupe + newest-first.
  const seen = new Set<string>();
  return sessions
    .filter((s) => {
      const k = `${s.date}|${s.session}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

// Agenda-item header: "<position>. ОбС <prefix>-<dept>-<docId> Докладна
// записка от <author>, относно: <title until next agenda or РЕШЕНИЕ>".
// The position is reused inside the document body in cross-references, so
// we identify items by their full "ОбС N-N-NNNNN" docket id, not by
// position.
const AGENDA_ITEM_RE =
  /^\s*(\d+)\.\s+ОбС\s+(\d+-\d+-\d+)\s+([\s\S]+?)(?=\n\s*\d+\.\s+ОбС\s+\d+-\d+-\d+|\n\s+РЕШЕНИЕ\s*:)/gmu;
const OTNOSNO_RE = /относно\s*:\s*([\s\S]+?)(?:\n\s*$|$)/iu;

type ParsedDecision = {
  record: CouncilResolution;
  /** 1-based agenda position parsed from "<N>. ОбС ..." — used to align
   *  this decision with the protokol's "Точка N" markers in the Phase-2
   *  per-councillor merge. */
  agendaPos: number;
};

const parseSessionText = (text: string, meta: SessionRef): ParsedDecision[] => {
  const out: ParsedDecision[] = [];
  const yyyy = meta.date.slice(0, 4);
  const seen = new Set<string>();
  for (const match of text.matchAll(AGENDA_ITEM_RE)) {
    const agendaPos = parseInt(match[1], 10);
    const docket = match[2]; // e.g., "08-00-17953"
    const number = docket.split("-").pop()!; // "17953"
    if (seen.has(number)) continue;
    seen.add(number);
    // Title pulled from the body of the agenda item — the "относно:" clause.
    const itemBody = match[3].replace(/\s+/g, " ").trim();
    const titleMatch = itemBody.match(OTNOSNO_RE);
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : itemBody.slice(0, 200);
    out.push({
      record: {
        id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${number}`,
        date: meta.date,
        session: meta.session,
        number,
        title: title || "(no title parsed)",
        // Phase 1: no tally. Phase 2 fills these from the protokol.
        result: "unknown",
        sourceUrl: meta.pdfUrl,
      },
      agendaPos,
    });
  }
  return out;
};

/**
 * Phase 2: parse the full session protokol PDF and merge tally +
 * perCouncillor onto each ParsedDecision in `decisions` by aligning
 * the protokol's "Точка N" markers with the za-sayta agenda position.
 *
 * Returns merge stats so the per-session log line can report
 * "+ X tallies, Y per-councillor blocks merged".
 */
type ProtokolMergeStats = {
  tallies: number;
  perCouncillor: number;
  exact: number;
  ambiguous: number;
  unmatched: number;
  total: number;
};

const mergeProtokol = async (
  text: string,
  decisions: ParsedDecision[],
  meta: SessionRef,
  opts: { perCouncillor: boolean },
): Promise<ProtokolMergeStats> => {
  const stats: ProtokolMergeStats = {
    tallies: 0,
    perCouncillor: 0,
    exact: 0,
    ambiguous: 0,
    unmatched: 0,
    total: 0,
  };
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  if (markers.length === 0 || tallies.length === 0) return stats;

  // Burgas protokol: Точка N anchors PRECEDE the tally, like Sofia.
  // Pair with the FIRST tally whose offset is > marker.offset.
  let lookup: Awaited<ReturnType<typeof buildMuniLookup>> | null = null;
  if (opts.perCouncillor) {
    lookup = await buildMuniLookup("Бургас");
  }

  // Index decisions by agenda position for the merge.
  const byPos = new Map<number, ParsedDecision>();
  for (const d of decisions) byPos.set(d.agendaPos, d);

  for (const marker of markers) {
    const tochkaPos = parseInt(marker.number, 10);
    if (!Number.isFinite(tochkaPos)) continue;
    const target = byPos.get(tochkaPos);
    if (!target) continue;

    // First tally after this marker.
    const firstTally = tallies.find((t) => t.offset > marker.offset);
    if (!firstTally) continue;

    let tally: CouncilTally = firstTally.tally;
    stats.tallies++;

    if (lookup && tally.method === "named") {
      const votes = extractNamedVoteBlock(text, firstTally.offset);
      if (votes.length > 0) {
        const joined = joinVotesToRoster(votes, lookup);
        const summary = summariseJoin(joined);
        stats.exact += summary.exact;
        stats.ambiguous += summary.ambiguous;
        stats.unmatched += summary.unmatched;
        stats.total += summary.total;
        stats.perCouncillor++;
        tally = {
          ...tally,
          perCouncillor: joined.map((j) => ({
            name: j.matchedTo ?? j.name,
            normKey: j.normKey,
            vote: j.vote,
          })),
        };
      }
    }

    target.record.tally = tally;
    target.record.result = classifyResult(text, firstTally.offset);
    // Re-source the URL to the full protokol — that's the document the
    // tally + per-councillor data came from, and operators will want to
    // click through to it rather than the ПРЕПИС extract that has no
    // votes.
    if (meta.protokolUrl) {
      target.record.sourceUrl = meta.protokolUrl;
    }
  }
  return stats;
};

export const scrapeBGS = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    perCouncillor?: boolean;
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

  // Phase 2: walk /video once and attach protokol URLs to sessions
  // by session number. Only when --per-councillor is on — cuts ~30 GET
  // requests off the Phase 1 path.
  if (opts.perCouncillor) {
    try {
      const protokols = await discoverProtokols();
      for (const sess of sessions) {
        const url = protokols.get(sess.session);
        if (url) sess.protokolUrl = url;
      }
      const matched = sessions.filter((s) => s.protokolUrl).length;
      console.log(
        `  [${OBSHTINA}] discovered ${protokols.size} protokol(s); ${matched}/${sessions.length} of in-window sessions matched`,
      );
    } catch (err) {
      errors.push({
        url: VIDEO_INDEX_URL,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`  [${OBSHTINA}] processing ${sessions.length} session(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-bgs-"));
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
        const parsed = parseSessionText(text, sess);

        // Phase 2: if we have a protokol URL for this session, fetch +
        // extract + merge tally / perCouncillor onto each ParsedDecision.
        let mergeLog = "";
        if (opts.perCouncillor && sess.protokolUrl) {
          const protokolPath = join(
            dir,
            `protokol_${sess.session}_${sess.date}.pdf`,
          );
          try {
            await fetchToFile(sess.protokolUrl, protokolPath);
            const protokolBuf = await readFile(protokolPath);
            const protokolText = await extractPdfText(protokolBuf);
            if (looksLikeScannedPdf(protokolText)) {
              errors.push({
                url: sess.protokolUrl,
                message:
                  "protokol PDF looks scanned — skipped (would need OCR)",
              });
            } else {
              const stats = await mergeProtokol(protokolText, parsed, sess, {
                perCouncillor: true,
              });
              const joinFrag =
                stats.total > 0
                  ? ` · roster ${stats.exact}/${stats.total}`
                  : "";
              mergeLog = ` · protokol ${stats.tallies} tallies, ${stats.perCouncillor} per-councillor${joinFrag}`;
            }
          } catch (err) {
            errors.push({
              url: sess.protokolUrl,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }

        resolutions.push(...parsed.map((p) => p.record));
        protocolsTouched++;
        console.log(
          `    + sess ${sess.session} (${sess.date}): ${parsed.length} decision(s)${mergeLog}`,
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
