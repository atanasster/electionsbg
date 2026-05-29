// Габрово (GAB05) — full-protokol PDF parser.
//
// Source surface:
//   - Protokol PDFs at /files/OBS/zasedania/protokol/{YYYY}/
//     Protokol-zasedanie-No{N}-{YYYY.MM.DD}.pdf.
//   - The Apache directory listing returns 403 (no public index page),
//     and gabrovo.bg pages don't link to protokols directly. We discover
//     URLs via the Wayback Machine CDX index — Wayback has snapshotted
//     the protokol directory and returns every known historical session
//     in one JSON query. For the current year we additionally brute-
//     force probe session numbers (Wayback only catches snapshotted
//     pages; recent protokols may not be there yet).
//
// Per-councillor block format (verified on 2025/Protokol-zasedanie-No8):
//   pdftotext -layout preserves the table columns, so each row is:
//     "<NN>    <Three-part name>                       <ЗА|ПРОТИВ|
//      ВЪЗДЪРЖАЛИ СЕ|отсъства>"
//   The shared VOTE_LINE_RE in lib/tally.ts now accepts this tabular
//   form (no period after number, no colon after name, uppercase or
//   mixed-case vote labels). Absent ("отсъства") rows are dropped at
//   the named-vote-block stage — they're not real votes.
//
// Tally format: "За – 29, против – 0, въздържали се – 0" — matches the
// existing SUMMARY_RE_LABEL_FIRST pattern used by SZR / RSE.
//
// Resolution markers: standard "РЕШЕНИЕ № <N>" (uppercase) on their own
// line. Title sits 2-3 lines below the marker, after the date line. We
// pull it via a forward-look helper since Gabrovo doesn't use an
// "ОТНОСНО:" clause that findResolutionMarkers expects.

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

const OBSHTINA = "GAB05";
const BASE = "https://www.gabrovo.bg/";

type SessionRef = {
  pdfUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD
};

// Pull the canonical Wayback-CDX list of protokol PDFs ever snapshotted.
// One JSON query returns every captured URL with mimetype/statuscode
// filtering. The "/protokol/{year}/" path component encodes the year so
// we extract everything once and partition later.
const WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx";
const cdxUrl = `${WAYBACK_CDX}?url=gabrovo.bg/files/OBS/zasedania/protokol/*&output=json&limit=5000&filter=mimetype:application/pdf&filter=statuscode:200&collapse=urlkey`;

const FILENAME_RE =
  /\/Protokol-zasedanie-No(\d+)-(\d{4})\.(\d{2})\.(\d{2})\.pdf$/i;

const parseSessionRef = (rawUrl: string): SessionRef | null => {
  // Normalise the host so URLs from CDX (which may include "www.") line
  // up with our brute-force probes (which use the bare host).
  const url = rawUrl.replace(
    /https?:\/\/(?:www\.)?gabrovo\.bg/i,
    BASE.replace(/\/$/, ""),
  );
  const m = url.match(FILENAME_RE);
  if (!m) return null;
  const session = m[1];
  const date = `${m[2]}-${m[3]}-${m[4]}`;
  return { pdfUrl: url, session, date };
};

const fetchCdxIndex = async (): Promise<SessionRef[]> => {
  const r = await fetch(cdxUrl, {
    headers: { "User-Agent": "Mozilla/5.0 electionsbg-council/1.0" },
  });
  if (!r.ok) throw new Error(`wayback CDX ${r.status}`);
  const arr = (await r.json()) as string[][];
  // First row is header.
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  for (const row of arr.slice(1)) {
    const ref = parseSessionRef(row[2]);
    if (!ref) continue;
    const key = `${ref.date}|${ref.session}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

// Brute-force discovery for current-year sessions is intentionally NOT
// implemented in this parser. With ~25 candidate session numbers and
// 31 candidate days per month per year, a single brute-force pass is
// in the thousands of HEAD requests — far beyond what a watcher cycle
// should pay. Wayback's CDX catches recent sessions within a few weeks
// of publication; for fresher data the operator can either:
//   - manually drop a list of URLs into recipe.samplePdfs
//   - extend this parser later with a SignalCheck against an external
//     calendar that records session N → date (e.g. council.bg/calendar)
// Sticking to Wayback-only keeps the per-run cost predictable and the
// failure mode is "data is a few weeks stale", not "ingest hangs".

// Title sits 2-3 lines below the РЕШЕНИЕ № N marker, after a date line
// like "12.06.2025 год." Pulls everything up to the next blank line.
const extractTitleAfter = (text: string, markerOffset: number): string => {
  // The marker offset points at the start of "РЕШЕНИЕ № N" (or wherever
  // findResolutionMarkers anchored). Skip past the marker line + the date
  // line that follows.
  const fwd = text.slice(markerOffset, markerOffset + 1500);
  const lines = fwd.split(/\r?\n/);
  // Drop the РЕШЕНИЕ line + the date line right after it.
  let i = 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  // Skip a trailing date line ("12.06.2025 год.")
  if (i < lines.length && /\d{2}\.\d{2}\.\d{4}/.test(lines[i])) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const titleLines: string[] = [];
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") break;
    titleLines.push(t);
    if (titleLines.length >= 4) break; // cap to keep titles bounded
  }
  return titleLines.join(" ").replace(/\s+/g, " ").trim();
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
    lookup = await buildMuniLookup("Габрово");
  }

  for (const marker of markers) {
    // Gabrovo tally pairing: РЕШЕНИЕ № N is followed by the decision text,
    // then "Резултат от проведеното поименно гласуване" + the tally summary.
    // So the matching tally is the FIRST one whose offset is GREATER than
    // the marker's — same convention as Sofia / Burgas.
    const firstTally = tallies.find((t) => t.offset > marker.offset);
    if (!firstTally) continue;

    let tally = firstTally.tally;
    if (tally && lookup) {
      const votes = extractNamedVoteBlock(text, firstTally.offset);
      if (votes.length > 0) {
        const joined = joinVotesToRoster(votes, lookup);
        const stats = summariseJoin(joined);
        joinTotals.exact += stats.exact;
        joinTotals.ambiguous += stats.ambiguous;
        joinTotals.unmatched += stats.unmatched;
        joinTotals.total += stats.total;
        tally = {
          ...tally,
          // Force method to "named" — Gabrovo always uses поименно
          // гласуване, but the NAMED_VOTE_BLOCK_RE lookback may not fire
          // when the prose form sits >4000 chars before the tally.
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
    const title = extractTitleAfter(text, marker.offset);
    out.push({
      id,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title: title || marker.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.pdfUrl,
    });
  }
  return { resolutions: out, joinStats: joinTotals };
};

export const scrapeGAB = async (
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
  const endYear = currentYear;

  // 1. CDX index — historical sessions Wayback has snapshotted.
  let cdxRefs: SessionRef[] = [];
  try {
    cdxRefs = await fetchCdxIndex();
  } catch (err) {
    errors.push({
      url: cdxUrl,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  // 2. Filter to window. Brute-force is intentionally omitted (see
  //    comment block above).
  let all = [...cdxRefs];
  all = all.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= endYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  // Dedupe by URL.
  const seen = new Set<string>();
  all = all.filter((r) => {
    if (seen.has(r.pdfUrl)) return false;
    seen.add(r.pdfUrl);
    return true;
  });
  // Newest first.
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
    `  [${OBSHTINA}] fetching ${all.length} protokol(s) (wayback CDX)`,
  );
  const dir = await mkdtemp(join(tmpdir(), "council-gab-"));
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
