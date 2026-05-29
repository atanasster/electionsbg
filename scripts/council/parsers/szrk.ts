// Казанлък (SZR12) — full-protokol PDF parser.
//
// Source: obs.kazanlak.bg/common/docs/{YYYY-MM}/Protokol_{N}_SAIT.pdf
// (Sait = "за сайта", i.e. the public-facing version; older protokols
// also use Protokol_{N}.pdf, Protokol_{N}_{DD}_{MM}_{YYYY}.pdf, and the
// occasional {N}_Protokol.pdf inversion).
//
// Discovery: Wayback Machine CDX index for everything snapshotted +
// a focused brute-force HEAD probe for the current year's session
// numbers across month subdirectories. The site is Nuxt-rendered so
// the categories page (cat-3.html) doesn't expose protokol links in
// curl-visible HTML.
//
// Tally form (per memory project_sofia… style — verified on Protokol_10):
//   "Общинският съвет гласува поименно и със 'за' - 26, 'против' - 0
//    и 'въздържали се' - 0"
// Matches SUMMARY_RE_LABEL_FIRST (label-dash-digit comma-separated).
//
// Per-councillor block format (verified):
//   "  1. Аксения Бориславова Тилева: За
//      2. Анна Василева Кожухарова: За
//      ..."
// Standard "<N>. <Name>: <vote>" — extractNamedVoteBlock handles it
// out of the box.
//
// Resolution markers: РЕШЕНИЕ № N on its own line. Title precedes via
// ОТНОСНО clauses inside docket descriptions ("ОС_NNN/DD.MM.YYYY г. -
// <title>"). findResolutionMarkers's ОТНОСНО fallback catches these.

import { fetchToFile } from "../lib/fetch";
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
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "SZR12";
const BASE = "https://obs.kazanlak.bg/";
const DOCS_PREFIX = "common/docs/";

type SessionRef = {
  pdfUrl: string;
  session: string;
  date: string; // ISO; may be the first of the month when only YYYY-MM is known
};

const WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx";
const cdxUrl = `${WAYBACK_CDX}?url=obs.kazanlak.bg/&matchType=prefix&output=json&limit=200&filter=mimetype:application/pdf&filter=statuscode:200&filter=urlkey:.*protokol.*&collapse=urlkey`;

// Recognise the various naming patterns:
//   /common/docs/{YYYY-MM}/Protokol_{N}_SAIT.pdf      (2024+ canonical)
//   /common/docs/{YYYY-MM}/Protokol_{N}.pdf            (some 2025)
//   /common/docs/{YYYY-MM}/Protokol_{N}_DD_MM_YYYY.pdf (2020)
//   /common/docs/{YYYY-MM}/{N}_Protokol.pdf            (2020 inverted)
const URL_PATTERN_RE =
  /\/common\/docs\/(\d{4})-(\d{2})\/(?:Protokol_(\d+)(?:_[A-Za-z]+|_(\d{2})_(\d{2})_(\d{4}))?|(\d+)_Protokol)\.pdf$/i;

const parseSessionRef = (rawUrl: string): SessionRef | null => {
  const url = rawUrl.replace(/^http:\/\//, "https://");
  const m = url.match(URL_PATTERN_RE);
  if (!m) return null;
  const dirYear = m[1];
  const dirMonth = m[2];
  const session = m[3] || m[7];
  if (!session) return null;
  let date: string;
  if (m[4] && m[5] && m[6]) {
    // Pre-2024 dated filename — use the embedded date for precision.
    date = `${m[6]}-${m[5]}-${m[4]}`;
  } else {
    // Newer filenames carry no date; use the directory year-month +
    // first-of-month as a best-effort approximation.
    date = `${dirYear}-${dirMonth}-01`;
  }
  return { pdfUrl: url, session, date };
};

const fetchCdxIndex = async (): Promise<SessionRef[]> => {
  const r = await fetch(cdxUrl, {
    headers: { "User-Agent": "Mozilla/5.0 electionsbg-council/1.0" },
  });
  if (!r.ok) throw new Error(`wayback CDX ${r.status}`);
  const arr = (await r.json()) as string[][];
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  for (const row of arr.slice(1)) {
    const ref = parseSessionRef(row[2]);
    if (!ref) continue;
    const key = ref.pdfUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

/** Focused brute-force probe: for each (year, month) tuple in the
 *  requested year range, try Protokol_{N}_SAIT.pdf for N=1..60. Cheap
 *  because most slots 404 fast and we move on. Limited to the current +
 *  previous year so the probe terminates inside ~3 minutes worst case. */
const bruteForceProbe = async (
  startYear: number,
  endYear: number,
  known: Set<string>,
): Promise<SessionRef[]> => {
  const out: SessionRef[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let mo = 1; mo <= 12; mo++) {
      const monthStr = String(mo).padStart(2, "0");
      const dir = `${y}-${monthStr}`;
      for (let session = 1; session <= 60; session++) {
        // Only the most common 2024+ filename — keeps the probe within
        // budget. The CDX path already covers other patterns historically.
        const filename = `Protokol_${session}_SAIT.pdf`;
        const url = `${BASE}${DOCS_PREFIX}${dir}/${filename}`;
        if (known.has(url)) continue;
        try {
          const r = await fetch(url, {
            method: "HEAD",
            headers: { "User-Agent": "Mozilla/5.0 electionsbg-council/1.0" },
            signal: AbortSignal.timeout(5000),
          });
          if (r.status === 200) {
            out.push({
              pdfUrl: url,
              session: String(session),
              date: `${y}-${monthStr}-01`,
            });
            known.add(url);
          }
        } catch {
          // ignore single-URL failures — keep walking
        }
      }
    }
  }
  return out;
};

const parseProtokolText = async (
  text: string,
  meta: SessionRef,
  perCouncillor: boolean,
): Promise<{
  resolutions: CouncilResolution[];
  joinStats: {
    exact: number;
    ambiguous: number;
    unmatched: number;
    total: number;
  };
}> => {
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);

  let lookup: Awaited<ReturnType<typeof buildMuniLookup>> | null = null;
  const joinTotals = { exact: 0, ambiguous: 0, unmatched: 0, total: 0 };
  if (perCouncillor && tallies.length > 0) {
    lookup = await buildMuniLookup("Казанлък");
  }

  for (const marker of markers) {
    // Kazanlak pairing: each РЕШЕНИЕ № N marker comes AFTER its
    // vote — order is "Общинският съвет гласува поименно и със 'за' -
    // N... 0, така: <per-councillor block> ... РЕШЕНИЕ № X <decision body>".
    // Pair the marker with the LATEST tally whose offset PRECEDES the
    // marker. Same convention as V. Tarnovo.
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset < marker.offset) best = t;
      else break;
    }
    if (!best) continue;
    const firstTally = best;

    let tally = firstTally.tally;
    if (tally && lookup) {
      // Казанлък's per-councillor block sits AFTER the tally summary
      // ("…0, така:" then "1. Name: За\n2. Name: За\n…"). Walk forward
      // from the tally.
      const votes = extractNamedVoteBlock(text, firstTally.offset, "after");
      if (votes.length > 0) {
        const joined = joinVotesToRoster(votes, lookup);
        const stats = summariseJoin(joined);
        joinTotals.exact += stats.exact;
        joinTotals.ambiguous += stats.ambiguous;
        joinTotals.unmatched += stats.unmatched;
        joinTotals.total += stats.total;
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
    const result = classifyResult(text, firstTally.offset);
    const id = `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`;
    out.push({
      id,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title: marker.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.pdfUrl,
    });
  }
  return { resolutions: out, joinStats: joinTotals };
};

export const scrapeSZRK = async (
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

  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;

  // 1. CDX index.
  let cdxRefs: SessionRef[] = [];
  try {
    cdxRefs = await fetchCdxIndex();
  } catch (err) {
    errors.push({
      url: cdxUrl,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const known = new Set(cdxRefs.map((r) => r.pdfUrl));

  // 2. Brute-force trailing-edge probe (current year only, ~60 HEAD
  //    requests per month × 12 months = 720 requests bounded). Skip
  //    historical years — CDX has them.
  let bruteRefs: SessionRef[] = [];
  try {
    bruteRefs = await bruteForceProbe(
      Math.max(startYear, currentYear - 1),
      currentYear,
      known,
    );
  } catch (err) {
    errors.push({
      url: `${BASE} brute-force probe`,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let all = [...cdxRefs, ...bruteRefs];
  all = all.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  const seen = new Set<string>();
  all = all.filter((r) => {
    if (seen.has(r.pdfUrl)) return false;
    seen.add(r.pdfUrl);
    return true;
  });
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (opts.maxProtocols) all = all.slice(0, opts.maxProtocols);

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new protokols (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      errors,
    };
  }

  console.log(
    `  [${OBSHTINA}] fetching ${all.length} protokol(s) (cdx=${cdxRefs.length}, brute=${bruteRefs.length})`,
  );
  const dir = await mkdtemp(join(tmpdir(), "council-szrk-"));
  try {
    for (const p of all) {
      const pdfPath = join(dir, `pr_${p.session}_${p.date}.pdf`);
      try {
        await fetchToFile(p.pdfUrl, pdfPath);
        const buf = await readFile(pdfPath);
        const text = await extractPdfText(buf);
        if (looksLikeScannedPdf(text)) {
          errors.push({
            url: p.pdfUrl,
            message: "scanned PDF — route to Phase 3 OCR",
          });
          continue;
        }
        const { resolutions: recs, joinStats } = await parseProtokolText(
          text,
          p,
          !!opts.perCouncillor,
        );
        resolutions.push(...recs);
        protocolsTouched++;
        const joinLog =
          opts.perCouncillor && joinStats.total > 0
            ? ` · roster ${joinStats.exact}/${joinStats.total} exact, ${joinStats.unmatched} unmatched`
            : "";
        console.log(
          `    + prot ${p.session} (${p.date}): ${recs.length} decision(s)${joinLog}`,
        );
      } catch (err) {
        errors.push({
          url: p.pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
