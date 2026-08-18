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

import { councilFetchHtml as fetchHtml, fetchToFile } from "../lib/fetch";
import {
  extractOdtText,
  isMalformedArchiveError,
  extractWordText,
} from "../lib/docx";
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

type SessionRef = {
  pageUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD (extracted from the .docx URL's OS-{DD-MM-YYYY})
};

type ProtokolDoc = SessionRef & {
  docxUrl: string;
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
//   /2023-2027/{YYYY}/OS-{date}/Protokol%20{N}.odt                 (.odt, SPACE separator)
// We anchor on the final filename + the OBS_doc parent + a date
// anywhere in the path. Extension may be .docx, .pdf OR .odt.
//
// The separator after "Protokol" is NOT always an underscore: the .odt drop
// (session 22, May 2025) uses a literal space, which arrives here URL-encoded
// as "%20" because we match the raw href. Requiring "_" silently skipped that
// session — the parser reported "no .docx link found on session page" while
// the document was sitting right there.
const PROTOKOL_FILENAME_RE =
  /\/Protokol(?:_|%20|\s)+(\d+)(?:[-_][\d.-]+)?\.(docx|pdf|odt)$/i;
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
 * canonical SHORTHAND that lib/tally.ts already matches. Applied to the WHOLE
 * document (`preprocessTally(rawText)`), not to a window around each tally —
 * so rule F below rewrites any „С N гласа „ЗА“" anywhere in the protokol,
 * including one quoted inside a докладна body. What keeps those out of a
 * published tally is `isCouncilTally` attribution, never locality, which is
 * why that rule carries the weight it does. The reductions, in order:
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
  // F: Разград's DOMINANT form, and the one this parser silently missed for
  // its whole life — "С 28 гласа - „ЗА“, „против“- няма, „въздържали се“- няма".
  // It is digit-first, but SUMMARY_RE_DIGIT_FIRST cannot reach it: its `GL`
  // covers only the abbreviation „гл.", never the spelled-out „гласа", and its
  // HGAP admits spaces and tabs where this form puts a dash. Nothing matched,
  // so `findAllTallies` returned almost nothing and every decision fell to the
  // no-tally branch below — 332 of 338 stored records carried 0/0/0, against
  // ZERO such records in the other fifteen municipalities.
  //
  // Normalised HERE rather than by widening the shared regex, because that
  // regex is read by sixteen parsers and „N гласа" is loose enough in prose to
  // cost one of them a false tally. Measured across protokols 26/28/33/35:
  // 3 tallies found before, 85 after.
  // Case-INSENSITIVE, like A-E. Built with "gu" and a hand-written `(?:С|с)`
  // it normalised only an upper-case „ЗА", so „с 28 гласа - „за“" and
  // „С 28 гласа „За“" fell through to the no-tally branch in silence — the
  // exact failure this rule was added to end. The quote characters around the
  // label are what keep the pattern out of ordinary prose, not its case.
  out = out.replace(
    new RegExp(
      `с\\s+(\\d+)\\s+гласа?\\s*[-–—]?\\s*${QUOTES_OPEN_CLS}\\s*за\\s*${QUOTES_CLOSE_CLS}`,
      "giu",
    ),
    `${Q_OPEN}за${Q_CLOSE} – $1`,
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

/**
 * The chair's adoption announcement — "Общинският съвет взе следното
 * Р Е Ш Е Н И Е № 361". Only a marker introduced by one of these is a decision
 * OF THIS SITTING.
 *
 * Without it every `Р Е Ш Е Н И Е №` in the document was published as a
 * Разград council decision, and the докладна bodies are full of citations:
 * „приета с Решение № 223", „отменено с Решение № 294", and — measured on
 * protokol 28 — „Решение № 4157-НС/13.03.2025 г. на ЦЕНТРАЛНАТА ИЗБИРАТЕЛНА
 * КОМИСИЯ", which the corpus published as RAZ26-2025-prot28-r4157. Across
 * protokols 26/28/33/35 that was 69 false records against 71 real ones.
 *
 * PER32 has the same guard on the same reasoning (its anchor is „прие", since
 * Перник's chair announces differently). The two are deliberately separate:
 * an anchor is a claim about ONE município's minute-taking house style, and
 * the wrong one is worse than none — it drops real decisions silently.
 */
const ADOPTION_ANCHOR_RE = /вз(е|ех[аи]?|ел[аи]?)\s+следн|прие\s+следн/iu;

/**
 * How far the announcement reaches to the marker it introduces. MEASURED,
 * not guessed: 80 and 120 agree
 * exactly (71 decisions across the four sampled protokols) while 200 admits
 * 16 more — and every one of those falls OUTSIDE the gapless consecutive
 * number runs the anchored set forms (361-379, 393-406, 467-480, 497-520),
 * i.e. the wider window is reaching back across a paragraph into the previous
 * decision's announcement. That run-contiguity is an independent check on the
 * filter: a real decision dropped by the anchor would leave a hole in it.
 */
const ANCHOR_LOOKBACK = 120;

const findMarkers = (text: string): Marker[] => {
  const all: Marker[] = [];
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    all.push({ offset: m.index, number: m[1] });
  }

  // ONE announcement introduces exactly ONE decision — the first marker that
  // follows it. Asking each marker "is there an announcement behind me?"
  // instead lets a citation standing just after a real decision INHERIT its
  // anchor:
  //
  //   "…взе следното Р Е Ш Е Н И Е № 407  На основание т.20 от Решение № 294
  //    по Протокол № 21 от 08.05.2024 г. …"
  //
  // Both markers see „взе следното" within the window, and № 294 — a previous
  // council's decision, cited as the legal basis — was published as a decision
  // of this sitting. Binding FORWARD drops 7 such records across the 13
  // protokols, and is what makes every session's kept numbers a GAPLESS
  // consecutive run (295-309, 407-415, 467-480 …). That contiguity is the
  // independent check on the whole filter: a real decision wrongly dropped
  // would leave a hole in it.
  const kept = new Set<number>();
  const anchors = new RegExp(ADOPTION_ANCHOR_RE.source, "giu");
  let a: RegExpExecArray | null;
  while ((a = anchors.exec(text)) !== null) {
    const from = a.index;
    const next = all.find(
      (x) => x.offset > from && x.offset - from <= ANCHOR_LOOKBACK,
    );
    if (next) kept.add(next.offset);
  }
  return all.filter((x) => kept.has(x.offset));
};

/**
 * WHO CAST the vote a tally records. Разград's protokol prints three kinds of
 * tally in one document and only one of them is the council deciding:
 *
 *   council    "…Общинският съвет Разград, „за” – 26, „против“ – няма"
 *   committee  "ПК по управление на общинската собственост, подкрепи
 *               докладната записка с гласували „ЗА“ – 6"
 *   agenda     "Моля, режим на гласуване по дневния ред. „за” – 28"
 *
 * The pairing rule — latest tally between the previous marker and this one —
 * cannot tell them apart, and its window is unbounded for the FIRST decision
 * of a session, which reaches back to the agenda vote at the top of the
 * document. Measured over protokols 26/28/33/35: 5 decisions were handed a
 * standing committee's 1-9 vote, and a blacklist-only fix handed two of them
 * the agenda's 28-0-0 instead — plausible, unanimous and wrong.
 *
 * So the rule is POSITIVE: a tally counts only if its own sentence names the
 * council as the voter. Absence is the safe failure — a decision with no
 * tally renders a dash, while a wrong number is a false claim about a public
 * vote.
 *
 * Both patterns are Unicode-careful for reasons this repo has paid for twice:
 * `общинск(?:и|ия|ият)` must include the definite form („Общинският"), which
 * cost two real 26-0-0 council votes when it was missing; and the committee
 * abbreviation uses explicit `\p{L}` boundaries because an ASCII `\b` does
 * not fire against Cyrillic, so `\bПК\b` matched nothing at all.
 *
 * The committee rule deliberately does NOT match a bare "комиси". Разград's
 * decisions cite „Централната избирателна комисия" — the ЦИК — and a bare
 * match rejected a genuine „Общински съвет Разград, след поименно гласуване,
 * „за” – 21, „против“ – 3" as a committee vote.
 *
 * ⚠️ The council rule is ONE alternation under ONE lookahead, and must stay
 * that way. Written as two arms —
 * `общинск(?:и|ия|ият)\s+съвет(?!ници\s+от\s+общо)|общински\s+съветници` —
 * the guard is DEAD: „общински съветници от общо 9" fails the lookahead on the
 * first arm, and the engine then matches the same substring through the
 * second. That sentence is the committee's own composition line, so a
 * committee block whose „ПК"/„комисията" keyword sits further back than
 * VOTER_LOOKBACK was published as a council vote — the exact defect this rule
 * exists to close, with the suite green over it because every fixture carried
 * a committee keyword that fired the other arm.
 *
 * ⚠️ „докладна записка с вх" is NOT a committee signal, and was removed from
 * the committee rule. A council decision names its own докладна by incoming
 * number in the same sentence as its vote — „Общински съвет Разград, по
 * докладна записка с вх.№ 145 от кмета, след поименно гласуване, „за” – 26"
 * — and since attribution is COUNCIL && !COMMITTEE the committee arm wins
 * every tie, so that arm was pure loss. What distinguishes the two is the
 * committee's own report verb („разгледа" / „подкрепи" / „изрази"), which the
 * remaining arms already carry.
 */
const VOTER_LOOKBACK = 140;
const COUNCIL_VOTER_RE =
  /общинск(?:и|ия|ият)\s+съвет(?:ници)?(?!\s*(?:ници)?\s*от\s+общо)/iu;
const COMMITTEE_VOTER_RE =
  /(?<!\p{L})ПК(?!\p{L})|постоянна(?:та)?\s+комисия|комисия(?:та)?\s+(?:разгледа|подкрепи|не\s+взе|изрази)|бе\s+подкрепена/iu;

/** True when the tally at `offset` is attributed to the council itself. */
const isCouncilTally = (text: string, offset: number): boolean => {
  const back = text.slice(Math.max(0, offset - VOTER_LOOKBACK), offset);
  return COUNCIL_VOTER_RE.test(back) && !COMMITTEE_VOTER_RE.test(back);
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
      .find(
        (t) =>
          t.offset < marker.offset &&
          t.offset > prevMarkerOffset &&
          isCouncilTally(text, t.offset),
      );
    // Title = the agenda item's ОТНОСНО subject, anchored before the
    // tally (when present) else before the marker.
    const title = titleFor(
      titleAnchors,
      candidate?.offset ?? marker.offset,
      prevMarkerOffset,
    );
    if (!candidate) {
      // Decision has no extractable tally — surface it with metadata and NO
      // tally at all, never a zero one. `CouncilResolutionScreen`'s TallyLine
      // says it in its own comment: "Never a zero … '0 against' would assert a
      // unanimity the source never recorded" — but it suppresses on
      // `tally.for == null`, and 0 is not null, so a 0/0/0 tally walks straight
      // past the guard and renders „за 0, против 0, въздържали се 0" on a
      // decision the protokol records as 28-0-0. 873 resolutions corpus-wide
      // already carry no tally field; this is that shape, not a new one.
      //
      // `result` stays "adopted" because the marker only survived
      // ADOPTION_ANCHOR_RE — the chair announcing the council took this
      // decision. Before the anchor that was a presumption; now it is what the
      // filter tested for.
      //
      // 12 of 13 sessions land here on exactly one decision — their OPENING
      // one — which looks like a code-path artefact and is not. Measured on
      // the протоколи: the opening item is regularly decided анблок or by a
      // per-councillor roll („33. Хубан Соколов Не участва Общинският съвет
      // взе следното…"), and the protokol prints no aggregate for it. The only
      // tally candidate anywhere before that first marker is the agenda-
      // adoption vote, which `isCouncilTally` correctly refuses — so bounding
      // the i === 0 window would change nothing, because that vote is the only
      // thing in it. Six other councils show the same opener shape, and three
      // publish no aggregate tally at all; `council_corpus.data.test.ts` gates
      // the coverage rather than asserting every opener has one.
      out.push({
        id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`,
        date: meta.date,
        session: meta.session,
        number: marker.number,
        title,
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

/**
 * Exported for `raz26.test.ts` only. All three are pure functions of the
 * protokol text, and each encodes a claim about Разград's house style that is
 * worth pinning to real sentences rather than to a live scrape.
 */
export const __test = {
  findMarkers,
  preprocessTally,
  isCouncilTally,
  // The two arms, exposed separately so each can be tested ALONE. As a unit
  // they hide each other's defects: every „who cast the vote" fixture asserts
  // `COUNCIL && !COMMITTEE`, so a dead council-side lookahead passed for a
  // year because the committee arm happened to fire on the same sentence.
  COUNCIL_VOTER_RE,
  COMMITTEE_VOTER_RE,
  ANCHOR_LOOKBACK,
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
  let candidatesDropped = 0;

  let entries: { session: string; pageUrl: string }[] = [];
  try {
    entries = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: INDEX_URL,
      kind: "discovery",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (entries.length === 0) {
    console.log(`  [${OBSHTINA}] no session pages found`);
    return {
      obshtinaCode: OBSHTINA,
      resolutions,
      protocolsTouched,
      candidatesDropped,
      errors,
    };
  }

  // Sort newest first by numeric session
  entries.sort((a, b) => parseInt(b.session, 10) - parseInt(a.session, 10));
  // --max truncates the candidate list newest-first, and a dropped
  // candidate raises NO error — so the count has to reach the
  // watermark, or it advances past protocols this run never looked at.
  if (opts.maxProtocols && entries.length > opts.maxProtocols) {
    candidatesDropped = entries.length - opts.maxProtocols;
    entries = entries.slice(0, opts.maxProtocols);
  }

  console.log(`  [${OBSHTINA}] inspecting ${entries.length} session page(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-raz26-"));
  try {
    for (const e of entries) {
      // Hoisted out of the try so the catch can report WHICH sitting
      // failed. The index gives us only { session, pageUrl }; the date
      // lives in the document href, discovered below. Undated, the
      // orchestrator has to freeze this município's watermark entirely
      // rather than cap it at the failure — correct, but it stalls every
      // later protocol behind one flaky download.
      let refDate: string | undefined;
      let refUrl = e.pageUrl;
      try {
        const sessionHtml = await fetchHtml(e.pageUrl);
        const ref = findDocxRef(sessionHtml, e.session, e.pageUrl);
        if (!ref) {
          errors.push({
            url: e.pageUrl,
            kind: "content",
            message: "no .docx link found on session page",
          });
          continue;
        }
        refDate = ref.date;
        refUrl = ref.docxUrl;
        if (opts.sinceDate && ref.date <= opts.sinceDate) continue;
        const currentYear = new Date().getUTCFullYear();
        const startYear = opts.sinceYear ?? currentYear - 1;
        const yyyy = parseInt(ref.date.slice(0, 4), 10);
        if (yyyy < startYear || yyyy > currentYear) continue;

        const ext = /\.(pdf|odt|docx)$/i.exec(ref.docxUrl)?.[1].toLowerCase();
        const localPath = join(dir, `pr_${ref.session}.${ext ?? "docx"}`);
        await fetchToFile(ref.docxUrl, localPath);
        const buf = await readFile(localPath);
        let text: string;
        if (ext === "pdf") {
          text = await extractPdfText(buf);
          if (looksLikeScannedPdf(text)) {
            errors.push({
              url: ref.docxUrl,
              date: ref.date,
              kind: "content",
              message: "scanned PDF — route to Phase 3 OCR",
            });
            continue;
          }
        } else if (ext === "odt") {
          text = await extractOdtText(buf);
        } else {
          // .doc and .docx alike — the router reads the signature.
          text = await extractWordText(buf);
        }
        const recs = parseProtokolText(text, ref);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${ref.session} (${ref.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: refUrl,
          // undefined only when we never got as far as the document href.
          date: refDate,
          // An unreadable container is `content`: same bytes next run. Covers
          // the .odt branch too — both extractors raise the same error.
          kind: isMalformedArchiveError(err) ? "content" : "fetch",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return {
    obshtinaCode: OBSHTINA,
    resolutions,
    protocolsTouched,
    candidatesDropped,
    errors,
  };
};
