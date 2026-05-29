// Добрич (DOB28) — full-session protokol PDF parser.
//
// Source surface:
//   - Protokol PDFs at dobrich.bg/uploads/posts/{YYYY}/
//     protokol-{N}_{DD-MM-YYYY}.pdf (full session minutes, born-digital
//     text-layer, ~200 pages per session)
//   - Discovery via Wayback Machine CDX index (the live site is partially
//     JS-rendered; CDX gives us a snapshot list without a browser)
//
// Two layout quirks need custom handling:
//
// 1. Resolution markers use a DUAL-NUMBERED form:
//      "РЕШЕНИЕ 3 – 1:"   (session 3, item 1)
//      "РЕШЕНИЕ 3 – 45:"  (session 3, item 45)
//    Not the standard "РЕШЕНИЕ № N" that lib/tally.ts's
//    findResolutionMarkers expects. Parser uses its own marker regex
//    that captures both the session and the per-session item number.
//    The session matches the directory's session number; the item
//    becomes the resolution number for the canonical id.
//
// 2. Tally separator is a SEMICOLON, not a comma:
//      "„ЗА" - 39; „ПРОТИВ" - 0; „ВЪЗДЪРЖАЛИ СЕ" - 0"
//    The shared SUMMARY_RE_LABEL_FIRST's SEP = `[\s,и]+` doesn't
//    include semicolon. Parser pre-processes the text to swap "; "
//    → ", " inside ПОИМЕННО ГЛАСУВАЛИ blocks so the shared regex
//    matches without polluting the shared lib.
//
// No per-councillor block — Добрич's protokol records ONLY aggregate
// "ПОИМЕННО ГЛАСУВАЛИ" totals, not the individual readout. Coverage
// tier B (decision metadata + tally + adopted/rejected, no
// perCouncillor), equivalent to SZR / RSE / Pleven / Хасково.

import { fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import { classifyResult, findAllTallies } from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "DOB28";
const BASE = "https://www.dobrich.bg/";

type SessionRef = {
  pdfUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD
};

const WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx";
const cdxUrl = `${WAYBACK_CDX}?url=dobrich.bg/uploads/posts/&matchType=prefix&output=json&limit=2000&filter=mimetype:application/pdf&filter=statuscode:200&filter=urlkey:.*protokol.*&collapse=urlkey`;

// "/uploads/posts/{YYYY}/protokol-{N}_{DD}-{MM}-{YYYY}.pdf"
const URL_PATTERN_RE =
  /\/uploads\/posts\/(\d{4})\/protokol-(\d+)_(\d{2})-(\d{2})-(\d{4})\.pdf$/i;

const parseSessionRef = (rawUrl: string): SessionRef | null => {
  const url = rawUrl.replace(
    /^https?:\/\/(?:www\.)?dobrich\.bg/i,
    BASE.replace(/\/$/, ""),
  );
  const m = url.match(URL_PATTERN_RE);
  if (!m) return null;
  return {
    pdfUrl: url,
    session: m[2],
    date: `${m[5]}-${m[4]}-${m[3]}`,
  };
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
    if (seen.has(ref.pdfUrl)) continue;
    seen.add(ref.pdfUrl);
    out.push(ref);
  }
  return out;
};

/** Pre-process to swap the Dobrich-specific semicolon between tally
 *  groups for the canonical comma the shared SUMMARY_RE_LABEL_FIRST
 *  expects. Only fires inside ПОИМЕННО ГЛАСУВАЛИ blocks so we don't
 *  accidentally munge unrelated semicolons in the protokol body. */
const preprocessTally = (text: string): string => {
  return text.replace(
    /(ПОИМЕННО\s+ГЛАСУВАЛИ\s*:[\s\S]{0,200}?)(?=РЕШЕНИЕ|\n\s*\n|\.)/giu,
    (block) => block.replace(/;\s+/g, ", "),
  );
};

/** Marker regex for Dobrich's dual-numbered "РЕШЕНИЕ <session> – <item>:".
 *  Captures session + item separately. Note the en-dash (U+2013) is
 *  the canonical separator; allow ASCII hyphen as a fallback. */
const MARKER_RE = /РЕШЕНИЕ\s+(\d+)\s*[–-]\s*(\d+)\s*:/giu;

type Marker = {
  offset: number;
  session: string;
  item: string;
};

const findDobrichMarkers = (text: string): Marker[] => {
  const out: Marker[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  while ((m = re.exec(text)) !== null) {
    out.push({ offset: m.index, session: m[1], item: m[2] });
  }
  return out;
};

const parseProtokolText = (
  rawText: string,
  meta: SessionRef,
): CouncilResolution[] => {
  // Pre-process: swap ;\s+ for , inside ПОИМЕННО ГЛАСУВАЛИ blocks.
  const text = preprocessTally(rawText);

  const tallies = findAllTallies(text);
  const markers = findDobrichMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);

  for (const marker of markers) {
    // Pairing: Добрич ПОИМЕННО ГЛАСУВАЛИ comes AFTER the РЕШЕНИЕ
    // marker (the marker introduces the decision, body follows, then
    // the tally summary at the bottom). Pick the FIRST tally with
    // offset > marker.offset — same convention as Sofia / Burgas /
    // Gabrovo.
    const firstTally = tallies.find((t) => t.offset > marker.offset);
    if (!firstTally) continue;

    const tally = firstTally.tally;
    const result = classifyResult(text, firstTally.offset);
    // ID uses both session + item so two protokols with the same
    // session-N (Dobrich's session-counter doesn't reset year-over-
    // year, but the dir year is part of the canonical id anyway).
    const id = `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.item}`;
    out.push({
      id,
      date: meta.date,
      session: meta.session,
      number: marker.item,
      title: "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.pdfUrl,
    });
  }
  return out;
};

export const scrapeDOB = async (
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

  let cdxRefs: SessionRef[] = [];
  try {
    cdxRefs = await fetchCdxIndex();
  } catch (err) {
    errors.push({
      url: cdxUrl,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let all = cdxRefs.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
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
  const dir = await mkdtemp(join(tmpdir(), "council-dob-"));
  try {
    for (const p of all) {
      const pdfPath = join(dir, `pr_${p.session}.pdf`);
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
        const recs = parseProtokolText(text, p);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${p.session} (${p.date}): ${recs.length} decision(s)`,
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
