// Хасково (HKV34) — full-session protokol PDF parser.
//
// Source surface:
//   - Protokol PDFs at haskovo.bg/uploads/posts/{YYYY}/protokol-{N}.pdf
//   - Discovery via Wayback Machine CDX index (the live site has 89
//     historical protokols snapshotted, covering the 2022-2024 mandate
//     window). The current resheniya category page is JS-rendered; CDX
//     gives us a complete URL list without needing a browser.
//
// Tally form is NOVEL — chair-announcement prose, NOT the V. Tarnovo
// number-quote-label form the shared DIGIT_FIRST regex expects. Чair
// reads totals aloud and they're transcribed verbatim:
//
//   "Т.ЗАХАРИЕВА: С 37 гласа „за", без „против" и „въздържали се""
//   "С 34 гласа „за", 1 - „против", без „въздържали"
//   "С 29 гласа „за", без „против"; 1 - „въздържал"
//
// Rather than add yet another SUMMARY_RE variant to the shared lib for
// one município, the parser PRE-PROCESSES the text — rewriting Хасково's
// form into the canonical V. Tarnovo form, which then matches
// SUMMARY_RE_DIGIT_FIRST cleanly:
//
//   "С N гласа „за""        → "N „за""
//   "без „против""          → "0 „против""
//   "M - „против""          → "M „против""
//   (and same for въздържал[и] се)
//
// No per-councillor block — Хасково's protokol records ONLY the chair's
// total announcement, not the individual vote tablet readout. So per-
// councillor data isn't extractable from this source. Coverage tier is
// B (decision metadata + tally + adopted/rejected, no perCouncillor),
// equivalent to SZR / RSE / Pleven.
//
// Resolution markers: standard "Р Е Ш Е Н И Е № N" (sometimes spaced-
// letter style) followed by the body text. findResolutionMarkers'
// "Р Е Ш Е Н И Е" branch catches the spaced form.

import { fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import {
  classifyResult,
  findAllTallies,
  findResolutionMarkers,
} from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "HKV34";
const BASE = "https://www.haskovo.bg/";

type SessionRef = {
  pdfUrl: string;
  session: string;
  date: string;
};

const WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx";
const cdxUrl = `${WAYBACK_CDX}?url=haskovo.bg/uploads/posts/&matchType=prefix&output=json&limit=2000&filter=mimetype:application/pdf&filter=statuscode:200&filter=urlkey:.*protokol.*&collapse=urlkey`;

// "/uploads/posts/{YYYY}/protokol-{N}.pdf"
const URL_PATTERN_RE = /\/uploads\/posts\/(\d{4})\/protokol-(\d+)\.pdf$/i;

const parseSessionRef = (rawUrl: string): SessionRef | null => {
  // CDX returns http://www.haskovo.bg/... — normalise to https.
  const url = rawUrl.replace(
    /^https?:\/\/(?:www\.)?haskovo\.bg/i,
    BASE.replace(/\/$/, ""),
  );
  const m = url.match(URL_PATTERN_RE);
  if (!m) return null;
  return {
    pdfUrl: url,
    session: m[2],
    // Хасково's filename doesn't carry the meeting date — only the year
    // dir + session number. Best-effort placeholder uses Jan-1 of the
    // dir year; the actual session date can be parsed from the PDF body
    // ("Днес, 29 юли 2022 г.") later if precision matters.
    date: `${m[1]}-01-01`,
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

/**
 * Rewrite Хасково's chair-announcement tally form into the canonical
 * V. Tarnovo form so the shared SUMMARY_RE_DIGIT_FIRST regex matches.
 *
 *   "С 37 гласа „за""             → "37 „за""
 *   "без „против""                → "0 „против""
 *   "M - „против""                → "M „против""
 *   "без „въздържали се""         → "0 „въздържали се""
 *   "K - „въздържали се""         → "K „въздържали се""
 *
 * The semicolon Хасково sometimes uses between против and въздържали
 * (";") is also converted to comma so the shared SEP `[\s,и]+` matches.
 */
// Quote-like punctuation covering ASCII + the Bulgarian low/high double
// quotes the PDF uses. Explicit Unicode escapes so the regex doesn't
// silently misfire when the literal glyphs get mangled by an editor /
// shell transfer. Codepoints:
//   U+0022 "  / U+0027 '  — ASCII straight double / single
//   U+201C " (LEFT DOUBLE QUOTATION MARK)
//   U+201D " (RIGHT DOUBLE QUOTATION MARK)
//   U+201E „ (DOUBLE LOW-9 QUOTATION MARK — bg opening)
//   U+2018 ' (LEFT SINGLE QUOTATION MARK)
//   U+2019 ' (RIGHT SINGLE QUOTATION MARK)
const QUOTE_CHARS = "[\\u0022\\u0027\\u201C\\u201D\\u201E\\u2018\\u2019]";

const preprocessTallyForm = (text: string): string => {
  // ASCII `\b` does NOT fire between Cyrillic letters and non-word
  // chars in `u`-mode regex (Cyrillic letters aren't ASCII word chars),
  // so the patterns below DON'T use `\b` after a Cyrillic word — the
  // closing quote / comma / etc. that follows works as a natural
  // delimiter on its own.
  //
  // 1. "С N гласа „за"" → "N „за""
  let out = text.replace(
    new RegExp(`С\\s+(\\d+)\\s+гласа\\s*(${QUOTE_CHARS})\\s*за`, "giu"),
    "$1 $2за",
  );
  // 2. "без „против"" → "0 „против""
  out = out.replace(
    new RegExp(`без\\s+(${QUOTE_CHARS})\\s*против`, "giu"),
    "0 $1против",
  );
  // 3. "N - „против"" → "N „против""
  out = out.replace(
    new RegExp(`(\\d+)\\s+-\\s+(${QUOTE_CHARS})\\s*против`, "giu"),
    "$1 $2против",
  );
  // 4. Same for въздържал[иа]? се (single + plural).
  out = out.replace(
    new RegExp(`без\\s+(${QUOTE_CHARS})\\s*въздържал([иа])?\\s*се`, "giu"),
    "0 $1въздържал$2 се",
  );
  out = out.replace(
    new RegExp(
      `(\\d+)\\s+-\\s+(${QUOTE_CHARS})\\s*въздържал([иа])?\\s*се`,
      "giu",
    ),
    "$1 $2въздържал$3 се",
  );
  // 5. The semicolon Хасково sometimes uses between groups — convert to
  //    comma so SEP matches.
  out = out.replace(/;\s+(\d|без|няма|-)/g, ", $1");
  return out;
};

const parseProtokolText = (
  rawText: string,
  meta: SessionRef,
): CouncilResolution[] => {
  // Apply the Хасково-specific text rewrite BEFORE running the shared
  // tally / marker extractors.
  const text = preprocessTallyForm(rawText);

  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);

  for (const marker of markers) {
    // Хасково pairing: the chair-announcement tally comes BEFORE its
    // resolution marker (the chair reads totals, then the board records
    // the РЕШЕНИЕ). Pick the LATEST tally whose offset precedes the
    // marker — same convention as V. Tarnovo / Kazanlak.
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset < marker.offset) best = t;
      else break;
    }
    if (!best) continue;

    const tally = best.tally;
    const result = classifyResult(text, best.offset);
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
  return out;
};

export const scrapeHKV = async (
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
  const dir = await mkdtemp(join(tmpdir(), "council-hkv-"));
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
