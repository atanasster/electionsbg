// Разград (RAZ26) — full-session protokol .docx parser.
//
// Source surface:
//   - Index: https://www.razgrad.bg/protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet
//     (Joomla list with ?start={N} pagination — newest first)
//   - Session pages live at /<index>/protokol-no{N} and link a single
//     .docx under /images/OBS_doc/2023-2027/{YYYY}/OS-{DD-MM-YYYY}/
//     Protokol_{N}/Protokol_{N}.docx
//   - The companion Wayback CDX index also has these files but is
//     missing the most-recent layer; the live HTML walk is required.
//
// Tally vocabulary is the most heterogeneous in the fleet — at least
// five distinct chair-narrated forms surface in a single session, all
// flowing from the same "гласували …" opening:
//
//   A. split-quote SHORTHAND (dominant — ~60% of decisions):
//      гласували „ЗА" – 5, „против" и „въздържали се" – няма.
//   B. без-form (combined no-against-no-abstain):
//      гласували „ЗА" – 4, без „против" и „въздържали се".
//   C. partial-form (no explicit "против"):
//      гласували „ЗА" – 5, и 1 – „въздържал се".
//   D. label-second NEGATIVE:
//      гласували „ЗА" – 5, няма – „против", няма – „въздържали се".
//   E. digit-first with -ма Bulgarian numeral suffix:
//      гласували 4-ма „ЗА", без „против", и без „въздържали се".
//
// All five are reduced to canonical V. Tarnovo / SZR forms by a short
// preprocessing stack — that way we keep lib/tally.ts free of yet more
// município-specific regex variants.
//
// No per-councillor block — the protokol records the chair's announced
// totals only. Coverage tier B (decision metadata + tally + adopted/
// rejected), equivalent to HKV09 / DOB28 / HKV34 / SZR / RSE / Pleven.

import { fetchToFile } from "../lib/fetch";
import { extractDocxText } from "../lib/docx";
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

const OBSHTINA = "RAZ26";
const BASE = "https://www.razgrad.bg";
const INDEX_URL =
  "https://www.razgrad.bg/protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet";

const UA = "Mozilla/5.0 electionsbg-council/1.0";

type SessionRef = {
  pageUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD (extracted from the .docx URL's OS-{DD-MM-YYYY})
};

type ProtokolDoc = SessionRef & {
  docxUrl: string;
};

const fetchHtml = async (url: string): Promise<string> => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.text();
};

// Index entry: /protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet/protokol-no34
const INDEX_LINK_RE =
  /\/protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet\/protokol-no(\d+)/i;

// Protokol URL: anything ending in "Protokol_{N}[-{date}].{docx|pdf}"
// AND living under /images/OBS_doc/ AND containing a "2023-2027"
// segment somewhere in the path. The council ships multiple parent-dir
// variants mid-mandate:
//   /2023-2027/{YYYY}/OS-{date}/Protokol_{N}/Protokol_{N}.docx
//   /2023-2027/{YYYY}/OS-{date}/Protokol_{N}-{date}.docx          (flat)
//   /2023-2027/{YYYY}/OS-{date}/OS-Protokol_{N}-{date}/Protokol_{N}.docx  (doubled OS-)
//   /Protokoli/2023-2027/OS-Protokol_{N}-{date}/Protokol_{N}.docx (different parent)
//   /2023-2027/{YYYY}/OS-{date}/Protokol_{N}/Protokol_{N}.pdf      (PDF instead of DOCX)
// We anchor on the final filename + the OBS_doc parent + a date
// anywhere in the path. Extension may be .docx OR .pdf.
const PROTOKOL_FILENAME_RE = /\/Protokol_(\d+)(?:[-_][\d.-]+)?\.(docx|pdf)$/i;
const URL_DATE_RE = /(\d{1,2})[.-](\d{1,2})[.-](\d{4})/;

const parseSessionsFromIndex = (
  html: string,
): { session: string; pageUrl: string }[] => {
  const out: { session: string; pageUrl: string }[] = [];
  const seen = new Set<string>();
  const hrefs = Array.from(
    html.matchAll(/href=["']([^"']+)["']/g),
    (m) => m[1],
  );
  for (const h of hrefs) {
    const m = h.match(INDEX_LINK_RE);
    if (!m) continue;
    const full = h.startsWith("http")
      ? h
      : `${BASE}${h.startsWith("/") ? "" : "/"}${h}`;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ session: m[1], pageUrl: full });
  }
  return out;
};

const collectIndexPages = async (
  sinceDate: string | undefined,
  maxProtocols: number | undefined,
): Promise<{ session: string; pageUrl: string }[]> => {
  const out: { session: string; pageUrl: string }[] = [];
  const seen = new Set<string>();
  // Joomla pagination — `?start=N` in steps of 10. Walk until we hit an
  // empty page or until we've collected enough.
  for (let pageIdx = 0; pageIdx < 30; pageIdx++) {
    const url =
      pageIdx === 0 ? INDEX_URL : `${INDEX_URL}?start=${pageIdx * 10}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("→ 404")) break;
      throw err;
    }
    const entries = parseSessionsFromIndex(html);
    const fresh = entries.filter((e) => !seen.has(e.pageUrl));
    fresh.forEach((e) => seen.add(e.pageUrl));
    if (fresh.length === 0) break;
    out.push(...fresh);
    if (maxProtocols && out.length >= maxProtocols * 2) break;
    void sinceDate; // sinceDate is applied after .docx URL date extraction
  }
  return out;
};

/** Find the .docx URL on a session page and extract its OS-date. */
const findDocxRef = (
  sessionHtml: string,
  session: string,
  pageUrl: string,
): ProtokolDoc | null => {
  const hrefs = Array.from(
    sessionHtml.matchAll(/href=["']([^"']+)["']/g),
    (m) => m[1],
  );
  for (const h of hrefs) {
    if (!/\/images\/OBS_doc\//i.test(h)) continue;
    if (!/2023-2027/i.test(h)) continue;
    // Skip per-decision appendices — only the full Protokol_{N} file.
    if (/Prilojenie|Prilojenia/i.test(h)) continue;
    const m = h.match(PROTOKOL_FILENAME_RE);
    if (!m) continue;
    if (m[1] !== session) continue;
    // Pull date from anywhere in the URL path — works for all four
    // mandate sub-layouts.
    const dm = h.match(URL_DATE_RE);
    if (!dm) continue;
    const docxUrl = h.startsWith("http")
      ? h
      : `${BASE}${h.startsWith("/") ? "" : "/"}${h}`;
    const dd = dm[1].padStart(2, "0");
    const mm = dm[2].padStart(2, "0");
    const yyyy = dm[3];
    return {
      pageUrl,
      session,
      date: `${yyyy}-${mm}-${dd}`,
      docxUrl,
    };
  }
  return null;
};

/**
 * Reduce Razgrad's five chair-narrated tally forms to V. Tarnovo / SZR
 * canonical SHORTHAND that lib/tally.ts already matches. Applied to a
 * narrow window around the tally line so we don't touch the rest of
 * the protokol body. The five reductions, in order:
 *
 *   B. без → "X и Y – няма" — "без „против" и „въздържали се"" →
 *      "„против и въздържали се" – няма".
 *   A. split-quote SHORTHAND → unified-quote SHORTHAND —
 *      "„против" и „въздържали се"" → "„против и въздържали се"".
 *   E. -ма suffix — "4-ма „ЗА"" → "4 „ЗА"".
 *   D. label-second NEGATIVE → label-first — "няма – „против"" →
 *      "„против" – няма".
 *   C. partial-form — "„ЗА" – 5, и 1 – „въздържал се"" →
 *      "„ЗА" – 5, „против" – няма, „въздържал се" – 1".
 */
// Bulgarian quote character class. „ = „ (low double-quote, opener),
// ” = " (right double, closer used by Razgrad), “ = " (left
// double), " = ASCII straight quote. We keep curly quotes in the
// REPLACEMENT strings as explicit Unicode escapes so the source file
// stays editor-safe (no risk of straight-vs-curly transcoding errors).
const Q_OPEN = "„"; // „
const Q_CLOSE = "”"; // "
const QUOTES_OPEN_CLS = "[\\u201E\\u201C\\u0022]";
const QUOTES_CLOSE_CLS = "[\\u201D\\u201C\\u0022]";

const preprocessTally = (text: string): string => {
  let out = text;
  // E: strip "-ма" Bulgarian counter suffix on the digit before „ЗА"
  out = out.replace(
    new RegExp(`(\\d+)-ма(\\s+${QUOTES_OPEN_CLS}?\\s*ЗА)`, "giu"),
    "$1$2",
  );
  // B: "без „против" и „въздържали се"" → canonical SHORTHAND with – няма
  out = out.replace(
    new RegExp(
      `без\\s+${QUOTES_OPEN_CLS}\\s*против\\s*${QUOTES_CLOSE_CLS}\\s+и\\s+${QUOTES_OPEN_CLS}\\s*въздържал[аи]?\\s*се\\s*${QUOTES_CLOSE_CLS}\\.?`,
      "giu",
    ),
    `${Q_OPEN}против и въздържали се${Q_CLOSE} – няма`,
  );
  // A: split-quote SHORTHAND → unified SHORTHAND
  out = out.replace(
    new RegExp(
      `${QUOTES_OPEN_CLS}\\s*против\\s*${QUOTES_CLOSE_CLS}\\s+и\\s+${QUOTES_OPEN_CLS}\\s*въздържал[аи]?\\s*се\\s*${QUOTES_CLOSE_CLS}`,
      "giu",
    ),
    `${Q_OPEN}против и въздържали се${Q_CLOSE}`,
  );
  // D: label-second NEGATIVE — "няма – „против", няма – „въздържали се""
  //    → "„против" – няма, „въздържали се" – няма"
  out = out.replace(
    new RegExp(
      `няма\\s*[-–—]\\s*${QUOTES_OPEN_CLS}\\s*против\\s*${QUOTES_CLOSE_CLS}`,
      "giu",
    ),
    `${Q_OPEN}против${Q_CLOSE} – няма`,
  );
  out = out.replace(
    new RegExp(
      `няма\\s*[-–—]\\s*${QUOTES_OPEN_CLS}\\s*въздържал[аи]?\\s*се\\s*${QUOTES_CLOSE_CLS}`,
      "giu",
    ),
    `${Q_OPEN}въздържали се${Q_CLOSE} – няма`,
  );
  // C: partial-form — "„ЗА" – N, и M – „въздържал се"" (no explicit
  //    "против" mention) → inject "„против" – няма" between the ЗА
  //    count and the въздържал segment.
  out = out.replace(
    new RegExp(
      `(${QUOTES_OPEN_CLS}\\s*ЗА\\s*${QUOTES_CLOSE_CLS}\\s*[-–—]\\s*\\d+)\\s*,\\s*и\\s+(\\d+)\\s*[-–—]\\s*${QUOTES_OPEN_CLS}\\s*въздържал`,
      "giu",
    ),
    `$1, ${Q_OPEN}против${Q_CLOSE} – няма, ${Q_OPEN}въздържали се${Q_CLOSE} – $2 ${Q_OPEN}въздържал`,
  );
  return out;
};

const MARKER_RE = /Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s*№\s*(\d{1,5})/giu;

// Title extraction. Razgrad opens each agenda item with a докладна
// записка carrying a structured "ОТНОСНО: <subject>" line — the subject
// IS the decision's human-readable title (e.g. "Наредба за изменение и
// допълнение на Наредба № 30…"). This is the structured-field case;
// contrast Добрич, whose verbatim transcript scatters conversational
// "относно …" that is NOT a title field, so this approach is wired for
// Разград only. The ОТНОСНО precedes the chair's tally and the
// "Р Е Ш Е Н И Е №" marker, so for each decision we take the last
// ОТНОСНО before its pairing offset and after the previous marker.
const OTNOSNO_RE =
  /ОТНОСНО\s*:?\s*([\s\S]{6,400}?)(?=\n\s*\n|ДОКЛАДВА|Вносител|Внесен|Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е|На основание|\.\s*\n|$)/giu;

type TitleAnchor = { offset: number; title: string };

const collectOtnosno = (text: string): TitleAnchor[] => {
  const out: TitleAnchor[] = [];
  const re = new RegExp(OTNOSNO_RE.source, OTNOSNO_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[1]
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[;:,.–—-]+$/u, "")
      .trim();
    if (title.length >= 6) out.push({ offset: m.index, title });
  }
  return out;
};

/** Last ОТНОСНО whose offset falls between the previous marker and this
 *  decision's pairing point — that agenda item's subject. */
const titleFor = (
  anchors: TitleAnchor[],
  pairOffset: number,
  prevMarkerOffset: number,
): string => {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    if (a.offset < pairOffset && a.offset > prevMarkerOffset) return a.title;
  }
  return "(no title parsed)";
};

type Marker = { offset: number; number: string };

const findMarkers = (text: string): Marker[] => {
  const out: Marker[] = [];
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ offset: m.index, number: m[1] });
  }
  return out;
};

const parseProtokolText = (
  rawText: string,
  meta: ProtokolDoc,
): CouncilResolution[] => {
  const text = preprocessTally(rawText);
  const tallies = findAllTallies(text);
  const markers = findMarkers(text);
  const titleAnchors = collectOtnosno(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    // Razgrad chair narrates the tally BEFORE the marker ("Общинският
    // съвет взе следното Р Е Ш Е Н И Е"). Same pairing convention as
    // HKV09 / Kazanlak: pick the latest tally whose offset precedes
    // the marker but follows the previous marker.
    const prevMarkerOffset = i === 0 ? -1 : markers[i - 1].offset;
    const candidate = [...tallies]
      .reverse()
      .find((t) => t.offset < marker.offset && t.offset > prevMarkerOffset);
    // Title = the agenda item's ОТНОСНО subject, anchored before the
    // tally (when present) else before the marker.
    const title = titleFor(
      titleAnchors,
      candidate?.offset ?? marker.offset,
      prevMarkerOffset,
    );
    if (!candidate) {
      // Decision has no extractable tally — record an empty tally so
      // the resolution still surfaces with metadata + adopted-by-
      // presumption (the protokol context makes clear it was adopted).
      out.push({
        id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`,
        date: meta.date,
        session: meta.session,
        number: marker.number,
        title,
        tally: { for: 0, against: 0, abstain: 0, method: "open" },
        result: "adopted",
        sourceUrl: meta.docxUrl,
      });
      continue;
    }
    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title,
      tally: candidate.tally,
      result: classifyResult(text, candidate.offset),
      sourceUrl: meta.docxUrl,
    });
  }
  return out;
};

export const scrapeRAZ = async (
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

  let entries: { session: string; pageUrl: string }[] = [];
  try {
    entries = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: INDEX_URL,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (entries.length === 0) {
    console.log(`  [${OBSHTINA}] no session pages found`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  // Sort newest first by numeric session
  entries.sort((a, b) => parseInt(b.session, 10) - parseInt(a.session, 10));
  if (opts.maxProtocols) entries = entries.slice(0, opts.maxProtocols);

  console.log(`  [${OBSHTINA}] inspecting ${entries.length} session page(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-raz26-"));
  try {
    for (const e of entries) {
      try {
        const sessionHtml = await fetchHtml(e.pageUrl);
        const ref = findDocxRef(sessionHtml, e.session, e.pageUrl);
        if (!ref) {
          errors.push({
            url: e.pageUrl,
            message: "no .docx link found on session page",
          });
          continue;
        }
        if (opts.sinceDate && ref.date <= opts.sinceDate) continue;
        const currentYear = new Date().getUTCFullYear();
        const startYear = opts.sinceYear ?? currentYear - 1;
        const yyyy = parseInt(ref.date.slice(0, 4), 10);
        if (yyyy < startYear || yyyy > currentYear) continue;

        const isPdf = /\.pdf$/i.test(ref.docxUrl);
        const localPath = join(
          dir,
          `pr_${ref.session}.${isPdf ? "pdf" : "docx"}`,
        );
        await fetchToFile(ref.docxUrl, localPath);
        const buf = await readFile(localPath);
        let text: string;
        if (isPdf) {
          text = await extractPdfText(buf);
          if (looksLikeScannedPdf(text)) {
            errors.push({
              url: ref.docxUrl,
              message: "scanned PDF — route to Phase 3 OCR",
            });
            continue;
          }
        } else {
          text = await extractDocxText(buf);
        }
        const recs = parseProtokolText(text, ref);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${ref.session} (${ref.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: e.pageUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
