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
// ⚠️ tier B in the sense of decision metadata + tally, but NOT adopted/rejected:
// classifyResult finds no verdict phrasing in this layout and every one of the 50
// stored rows carries result "unknown". Since json-retirement-v2 the title comes from
// the ДНЕВЕН РЕД agenda (see parseDobrichAgenda) rather than being absent. Formerly:
// tier B (decision metadata + tally + adopted/rejected, no
// perCouncillor), equivalent to SZR / RSE / Pleven / Хасково.

import { fetchToFile } from "../lib/fetch";
import { fetchCdxIndex as fetchCdxRows } from "../lib/wayback";
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

const fetchCdxIndex = (): Promise<SessionRef[]> =>
  fetchCdxRows(cdxUrl, parseSessionRef, (r) => r.pdfUrl);

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

/**
 * Добрич has NO "ОТНОСНО:" subject clauses — its 49 occurrences of the word are the
 * ordinary preposition in debate prose ("въпрос относно цените", "Относно блок Добрич").
 * So `nearestOtnosnoTitle` cannot serve it, and the parser assigned the literal
 * "(no title parsed)" to all 50 of its rows instead.
 *
 * What it DOES have is a "ДНЕВЕН РЕД" agenda whose numbering IS the resolution item
 * number — a marker reads "РЕШЕНИЕ 3 – 2:", and agenda item 2 is that decision's
 * subject. That is an EXACT key rather than a proximity guess, which makes it a better
 * title source than the ОТНОСНО rule the other parsers use.
 *
 * ⚠️ THE ITEM NUMBER CAN START A PDF PAGE, and then its line begins with a form feed
 * (\x0c) rather than a space. `[ \t]` misses exactly those, and they are invisible in
 * any normal dump — measured, it silently lost items 2, 23 and 31 of 47, taking the
 * marker match from 43/43 down to 40/43.
 *
 * ⚠️ THE BLOCK ENDS AT THE FIRST RESOLUTION MARKER, not at a byte budget. An earlier cut
 * used a flat 20,000 chars and a comment claiming that kept the debate body out; it does
 * not — body numbered clauses are read and stored past the first РЕШЕНИЕ, and the output
 * was correct only because first-wins happened to have already claimed every number from
 * a contiguous 1..47 agenda. The marker boundary is the real invariant: an agenda is
 * stated before any decision is taken.
 *
 * ⚠️ A SUBJECT MUST START WITH A CAPITAL. Without it, `\s+` after the dot spans a newline
 * and any wrapped line beginning "NN. " — or a bare "7." on its own line — hijacks that
 * item number before the real entry is reached, storing a sentence fragment
 * ("от ЗМСМА и други разпоредби на закона.") as the decision's title. Agenda items are
 * noun phrases and always begin uppercase; continuation fragments do not.
 *
 * Returns item-number -> subject. An empty map means no agenda was found, and every
 * caller falls back to the sentinel rather than guessing.
 */
export const parseDobrichAgenda = (text: string): Map<string, string> => {
  const out = new Map<string, string>();
  const start = text.search(/(?:^|\n)\s*ДНЕВЕН\s+РЕД\s*(?:\n|$)/u);
  if (start < 0) return out;
  // The agenda is stated before the first decision, so the first marker is the end of it.
  // Falls back to a generous byte budget when a protocol records no decision at all.
  const after = text.slice(start);
  const firstMarker = after.search(
    /(?:^|\n)[ \t\f]*РЕШЕНИЕ\s+\d+\s*[–-]\s*\d+\s*:/u,
  );
  const block = after.slice(0, firstMarker > 0 ? firstMarker : 20000);
  // Each item runs until its "Вносител:" submitter line, the next numbered item, or a
  // blank line. `[^\S\n]` is "horizontal whitespace" — using `\s` here would let the
  // subject start on a later line, which is the hijack the capital-letter guard closes.
  const re =
    /(?:^|\n)[ \t\f]*(\d{1,3})[ \t]*\.[^\S\n]+(\p{Lu}[\s\S]*?)(?=\n[ \t\f]*Вносител|\n[ \t\f]*\d{1,3}[ \t]*\.[^\S\n]+\p{Lu}|\n\s*\n)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const subject = m[2]
      .split("\n")
      // ⚠️ FILTER ON THE RAW LINE, BEFORE trim(). A right-aligned page number is
      // whitespace-then-digits; a sentence ending in a numeral ("Наредба № 15") is not.
      // Trimming first collapses the two and truncates the real subject.
      .filter((l) => !/^\s+\d{1,3}\s*$/u.test(l))
      .map((l) => l.trim())
      // The running header repeats on every page; it is ALL-CAPS in some protocols, so
      // the test is case-insensitive.
      .filter((l) => l && !/^протокол\s*№/iu.test(l))
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    // FIRST occurrence wins: the agenda is stated once.
    if (subject.length >= 8 && !out.has(m[1])) out.set(m[1], subject);
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
  const agenda = parseDobrichAgenda(text);
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
      // Keyed on the item number, not on proximity — see parseDobrichAgenda. The
      // agenda belongs to THIS document's session, so a marker announcing a different
      // one (a cross-reference, or a PDF carrying two protocols) must not borrow it:
      // marker.session was captured and then discarded before, two lines from here.
      title:
        (marker.session === meta.session
          ? agenda.get(marker.item)
          : undefined) ?? "(no title parsed)",
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
  let candidatesDropped = 0;

  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;

  let cdxRefs: SessionRef[] = [];
  try {
    cdxRefs = await fetchCdxIndex();
  } catch (err) {
    errors.push({
      url: cdxUrl,
      kind: "discovery",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let all = cdxRefs.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  // --max truncates the candidate list newest-first, and a dropped
  // candidate raises NO error — so the count has to reach the
  // watermark, or it advances past protocols this run never looked at.
  if (opts.maxProtocols && all.length > opts.maxProtocols) {
    candidatesDropped = all.length - opts.maxProtocols;
    all = all.slice(0, opts.maxProtocols);
  }

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new protokols (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      candidatesDropped,
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
            date: p.date,
            kind: "content",
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
          kind: "fetch",
          date: p.date,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
