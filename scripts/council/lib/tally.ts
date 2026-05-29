// Aggregate vote-tally extraction from council protocol text.
//
// The strategy: scan the text for aggregate summary lines. Bulgarian council
// protocols converge on a small set of phrasings — see /tmp inspection on
// V. Tarnovo protocol 20:
//
//   Предложението беше прието с 25 „за", 4 „против", 1 „въздържал се".
//   Дневният ред беше приет с 34 „за", „против" няма, „въздържал се" няма.
//   Резултат от гласуването: 20 „за", „против" няма, 13 „въздържал се".
//   С 14 „за", „против" няма, 18 „въздържал се" предложението не беше прието.
//
// Two count tokens recur: a digit, or the word "няма" (= 0). We treat dash
// "-" as 0 as well (Sofia standing committees use it). Counts MUST appear
// in the order За → Против → Въздържал се for the canonical match to
// fire; we fall back to keyed extraction (find each label individually)
// when the canonical regex fails.
//
// This module is parser-agnostic — feed it the text of an HTML decision
// page, a pdftotext dump, or unzipped DOCX body text. Per-município
// parsers (parsers/vtr.ts etc.) call into here once they have raw text.

import type { CouncilTally, CouncilTallyResult } from "./types";

/** Bulgarian curly quotes plus straight quotes — vendors mix conventions. */
const Q = '[""„“”\'‘’]?';

/**
 * Two summary-line regexes covering V. Tarnovo + Sofia + Stara Zagora
 * phrasings. Captures: 1=for, 2=against, 3=abstain. Each capture is a
 * digit group, "няма", or "-" (= 0).
 *
 * DIGIT_FIRST matches phrasings where the count precedes the label:
 *   25 „за", 4 „против", 1 „въздържал се"     (V. Tarnovo prose)
 *   34 „за", „против" няма, „въздържал се" няма
 *
 * LABEL_FIRST matches the SZR format where the label precedes the count
 * with an em-dash / hyphen separator:
 *   за – 46, против - 0 и въздържали се – 0
 *   Гласуване: за 33, против 0, въздържали се 0
 *
 * "и" (Bulgarian "and") is allowed as the separator between the
 * against and abstain pair.
 */
const SEP = "[\\s,и]+";
const DASH = "[\\s–—\\-:]*";

// Digit-first matches need to keep the digit and its "за" label on
// the SAME physical line — otherwise Sofia's OCR output of
//   "Общо гласували: 48\nЗа 45\nПротив 1\nВъздържали се 2"
// trips the regex into reading 48 as the "за" count (off-by-one across
// the newline). Replacing `\s*` with `[ \t]*` between the digit and
// the label enforces same-line.
// Burgas protokols write the prose form with an "гл." (глас = vote)
// abbreviation between the digit and the quoted label:
//   "42 гл. „за", 0 гл. „против", 0 гл. „въздържали се""
// Allowing an optional `гл.` (with surrounding whitespace) after the
// digit unifies that form with the V. Tarnovo "42 „за"" form. The
// pattern stays contextually safe — only appears between count + label.
const GL = "(?:\\s*гл\\.)?";
// Constrain inter-token whitespace to "few whitespace chars, possibly
// crossing a single line wrap" — otherwise prose containing the word
// "въздържал" elsewhere in the document can greedily skip ahead to
// the next "се" hundreds of lines later, swallowing every tally in
// between. {0,3} permits "label\n  next-line" wrapping but rejects
// long gaps.
const SHORT_WS = "[ \\t\\r\\n]{0,3}";
// Between digit (+optional "гл.") and the opening quote, Burgas
// protokols sometimes wrap a line break — "0 гл.\n„въздържали се"".
// SHORT_WS (up to 3 whitespace chars incl. one newline) covers that
// without re-introducing the unbounded gap that breaks multi-tally
// scanning.
const SUMMARY_RE_DIGIT_FIRST = new RegExp(
  `(\\d+|няма|-)${GL}${SHORT_WS}${Q}[ \\t]*за\\s*${Q}` +
    SEP +
    `(?:${Q}\\s*)?(\\d+|няма|-)${GL}${SHORT_WS}${Q}[ \\t]*против\\s*${Q}` +
    SEP +
    `(?:${Q}\\s*)?(\\d+|няма|-)${GL}${SHORT_WS}${Q}[ \\t]*въздържал[аи]?${SHORT_WS}се\\s*${Q}`,
  "iu",
);

const SUMMARY_RE_LABEL_FIRST = new RegExp(
  `${Q}\\s*за\\s*${Q}${DASH}(\\d+|няма|-)` +
    SEP +
    `${Q}\\s*против\\s*${Q}${DASH}(\\d+|няма|-)` +
    SEP +
    `${Q}\\s*въздържал[аи]?\\s*се\\s*${Q}${DASH}(\\d+|няма|-)`,
  "iu",
);

/**
 * SZR-specific shorthand when против AND въздържал се BOTH equal the
 * same value (typically няма/0):
 *
 *   Гласуване: за – 47, против и въздържали се – няма
 *
 * One digit/няма is captured and applied to both against AND abstain.
 */
const SUMMARY_RE_SHORTHAND = new RegExp(
  `${Q}\\s*за\\s*${Q}${DASH}(\\d+|няма|-)` +
    SEP +
    `${Q}\\s*против\\s+и\\s+въздържал[аи]?\\s*се\\s*${Q}${DASH}(\\d+|няма|-)`,
  "iu",
);

/**
 * Pleven-style verbose label-first form. Each label sits on its own line
 * with an em-dash separator + an optional "общински съветници" suffix +
 * terminating punctuation:
 *
 *   За – 33 общински съветници;
 *   Против – няма;
 *   Въздържали се – няма.
 *
 * Sofia OCR also produces label-on-own-line tallies, but those have a
 * preceding "Общо гласували: <total>" line which the old VERBOSE
 * pattern misinterpreted as the "За" digit (off-by-one bug). The
 * preceding `(?<!Общо\s+гласували\s*:\s*)` lookbehind guards against
 * that — only a За that is NOT directly after "Общо гласували:" counts.
 *
 * VERBOSE_SEP allows the Pleven "общински съветници" suffix words,
 * terminating punctuation, and newlines to sit between the captures.
 */
const VERBOSE_SEP = "(?:\\s*общински\\s+съветници)?[;,.\\s]+";
const SUMMARY_RE_VERBOSE = new RegExp(
  `(?<!Общо\\s+гласували\\s*:\\s*)${Q}\\s*За\\s*${Q}${DASH}(\\d+|няма|-)` +
    VERBOSE_SEP +
    `${Q}\\s*Против\\s*${Q}${DASH}(\\d+|няма|-)` +
    VERBOSE_SEP +
    `${Q}\\s*Въздържал[аи]?\\s*се\\s*${Q}${DASH}(\\d+|няма|-)`,
  "iu",
);

/** Decisions can be voted via a name list too — we detect the marker
 * for Phase 2 only. Three signal variants we have observed:
 *   - "Поименно гласуване:" + colon (V. Tarnovo full protocol)
 *   - "в резултат на поименно гласуване, с …"  (Burgas full protokol —
 *      inline, lowercase, comma-tail; no colon)
 *   - numbered roll line of the form "1. <First> <Last>: За" (Sofia OCR) */
const NAMED_VOTE_BLOCK_RE =
  /(?:Поименно\s+гласуване\s*:|[Пп]оименно\s+гласуване\s*[,.]|^\s*1\.\s+[А-Я][а-я]+\s+[А-Я][а-я]+\s*:\s*(?:За|Против|Въздържал))/imu;

const parseCount = (raw: string): number => {
  const t = raw.trim().toLowerCase();
  if (t === "няма" || t === "-" || t === "") return 0;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Extract one aggregate tally from a span of text. Tries the digit-first
 * phrasing first (V. Tarnovo / Sofia prose form), then label-first (SZR
 * "Гласуване: за – N" form). Returns null if neither matches.
 */
export const extractTally = (text: string): CouncilTally | null => {
  const mDigit = text.match(SUMMARY_RE_DIGIT_FIRST);
  const mLabel = mDigit ? null : text.match(SUMMARY_RE_LABEL_FIRST);
  const mVerbose = mDigit || mLabel ? null : text.match(SUMMARY_RE_VERBOSE);
  const mShort =
    mDigit || mLabel || mVerbose ? null : text.match(SUMMARY_RE_SHORTHAND);
  const m = mDigit ?? mLabel ?? mVerbose ?? mShort;
  if (!m) return null;
  const method: CouncilTally["method"] = NAMED_VOTE_BLOCK_RE.test(text)
    ? "named"
    : "open";
  return {
    for: parseCount(m[1]),
    against: parseCount(m[2]),
    abstain: parseCount(m === mShort ? m[2] : m[3]),
    method,
  };
};

/**
 * Walk text and yield every (offset, tally) pair found, in document order.
 * Runs both regex variants and merges hits (deduped by offset, preferring
 * the digit-first match when both fire on the same span).
 */
export const findAllTallies = (
  text: string,
): Array<{ offset: number; length: number; tally: CouncilTally }> => {
  const out: Array<{ offset: number; length: number; tally: CouncilTally }> =
    [];
  const seen = new Set<number>();
  const consume = (m: RegExpExecArray, shorthand: boolean) => {
    if (seen.has(m.index)) return;
    seen.add(m.index);
    const method: CouncilTally["method"] = NAMED_VOTE_BLOCK_RE.test(
      text.slice(Math.max(0, m.index - 4000), m.index),
    )
      ? "named"
      : "open";
    const againstCount = parseCount(m[2]);
    out.push({
      offset: m.index,
      length: m[0].length,
      tally: {
        for: parseCount(m[1]),
        against: againstCount,
        // In the shorthand "против и въздържал се – X" form, both groups
        // share the count captured in m[2].
        abstain: shorthand ? againstCount : parseCount(m[3]),
        method,
      },
    });
  };
  const reDigit = new RegExp(SUMMARY_RE_DIGIT_FIRST.source, "igu");
  let m: RegExpExecArray | null;
  while ((m = reDigit.exec(text)) !== null) consume(m, false);
  const reLabel = new RegExp(SUMMARY_RE_LABEL_FIRST.source, "igu");
  while ((m = reLabel.exec(text)) !== null) consume(m, false);
  const reVerbose = new RegExp(SUMMARY_RE_VERBOSE.source, "igu");
  while ((m = reVerbose.exec(text)) !== null) consume(m, false);
  const reShort = new RegExp(SUMMARY_RE_SHORTHAND.source, "igu");
  while ((m = reShort.exec(text)) !== null) consume(m, true);
  // Re-sort by offset since we merged two streams.
  out.sort((a, b) => a.offset - b.offset);
  return out;
};

/**
 * Decide adopted/rejected/returned from the prose surrounding the tally.
 * Bulgarian phrasings:
 *   "беше прието с N за..."           → adopted
 *   "предложението не беше прието"    → rejected
 *   "Не се приема"                    → rejected
 *   "върнато за ново обсъждане"       → returned (чл.45 ЗМСМА — rare in our window)
 */
export const classifyResult = (
  text: string,
  tallyOffset: number,
): CouncilTallyResult => {
  // The summary line has two canonical shapes:
  //
  //   "Предложението беше прието с N „за"..."   → adopted, marker BEFORE the digit
  //   "С N „за", ..., M „въздържал се" предложението не беше прието."  → rejected,
  //                                                                       marker AFTER
  //
  // So inspect a tight window on each side: 120 chars back catches the
  // preceding "беше прието с" / "приет" verbs without leaking into
  // unrelated speech; 140 chars forward catches the trailing "не беше
  // прието" / "не се приема". Returned (чл.45 ЗМСМА governor veto) is
  // surfaced in protocols only post-hoc.
  const back = text.slice(Math.max(0, tallyOffset - 120), tallyOffset);
  const fwd = text.slice(tallyOffset, Math.min(text.length, tallyOffset + 140));

  // Word-order varies by município.
  //   V. Tarnovo:    "беше прието" / "не беше прието"   (passive predicate)
  //   Stara Zagora:  "Приема се." / "Не се приема."      (reflexive, short)
  //   Pleven:        "Общински съвет – Плевен прие следното"  (3rd-person aorist active)
  // The Pleven form is matched by the trailing alternative — "прие"
  // followed by whitespace + a Cyrillic word, with a lookbehind asserting
  // we're not in the middle of a longer Cyrillic word.
  const REJECTED =
    /(?:не\s+беше\s+прието|не\s+се\s+приема|не\s+приема\s+се|отхвърл|(?<![а-я])не\s+прие\s+[а-я])/iu;
  const RETURNED = /върнат[аоои]?\s+за\s+ново\s+обсъждане/iu;
  const ADOPTED =
    /(?:беше\s+прието|се\s+приема|приема\s+се|прие[ти][аоои]?|(?<![а-я])прие\s+[а-я])/iu;

  if (REJECTED.test(fwd) || REJECTED.test(back)) return "rejected";
  if (RETURNED.test(fwd) || RETURNED.test(back)) return "returned";
  if (ADOPTED.test(back) || ADOPTED.test(fwd)) return "adopted";
  return "unknown";
};

/**
 * Extract a per-councillor named-vote block immediately preceding a
 * tally summary line. Looks back from `tallyOffset` up to ~8000 chars
 * for a contiguous run of numbered "<N>. <Name>: <За|Против|Въздържал
 * се>" entries, tolerating page-break headers ("Протокол № NN от
 * заседание...") and blank lines that interrupt the list.
 *
 * Returns the parsed entries in original document order (1, 2, 3, ...),
 * or an empty array if no block was found. The `normKey` field is the
 * lowercase, diacritic-folded, whitespace-collapsed name used for
 * roster joining.
 */
// Sofia OCR output occasionally has hyphenated names with whitespace
// between the dash and the next syllable ("Симеонова- Заркин",
// "Терзирадева- Велкова"). Allow `[-\s]+` between chunks so the
// regex matches both forms; cap the chunk count at 4 to avoid eating
// later prose.
//
// Three syntactic shapes have to be tolerated:
//   1. V. Tarnovo / Sofia OCR / Pleven inline:  "1. <Name>: За"
//      (digit + period + space + name + colon + vote)
//   2. Gabrovo tabular layout (pdftotext -layout preserves columns):
//      "1    <Name>                          ЗА"
//      (digit + spaces + name + spaces + uppercase vote, no period, no
//      colon, ALL-CAPS vote labels including "ВЪЗДЪРЖАЛИ СЕ" multi-
//      word). The Gabrovo table also has an absent column rendering
//      "отсъства" — captured as the third alternative so the back-walk
//      doesn't stop at that line.
//
// The leading `(\d+)[.\s]\s*` makes the period optional. The separator
// before the vote is `\s+[:]?\s*` so a stray colon (V. Tarnovo) and pure
// whitespace (Gabrovo) both work. Vote alternatives include the
// uppercase / mixed-case forms.
// Separator between name and vote: any amount of whitespace, an
// OPTIONAL colon, more whitespace. Three forms in the wild:
//   "Иванов: За"        (V. Tarnovo — colon, no leading ws)
//   "Иванов : За"       (Kazanlak — colon with leading ws)
//   "Иванов     ЗА"     (Gabrovo — table layout, no colon)
// `\s*:?\s*` covers all three. Earlier `\s+:?` REQUIRED leading ws
// which silently broke the V. Tarnovo / Kazanlak forms when the
// colon hugged the name.
const VOTE_LINE_RE =
  /^\s*(\d+)[.\s]\s*([А-ЯЁA-Z][а-яёa-z]+(?:[-\s]+[А-ЯЁA-Z][а-яёa-z]+){1,4})\s*:?\s*(За|ЗА|Против|ПРОТИВ|Въздържал[аи]?\s*се|ВЪЗДЪРЖАЛ[АИ]?\s*СЕ|отсъства|ОТСЪСТВА)\s*$/u;

// Lines treated as page-break interstitials between vote rows. Sofia's
// OCR output sandwiches an agenda-item header AND an aggregate-tally
// header block between the per-councillor list and the start of the
// next section ("Точка N (word)" + "Общо гласували: T" + "За X" +
// "Против Y" + "Въздържали се Z"). Allowing those lines through the
// breaker keeps the lookback pass connected to the actual per-
// councillor block instead of stopping at the first "Точка" line.
// Burgas adds "Протокол <N> / <DD.MM.YYYY> г." page footers — same role
// as V. Tarnovo's "Протокол № <N>" headers. Accept both forms so the
// per-councillor block's page boundary doesn't break the back-walk.
const PAGE_HEADER_RE =
  /^\s*(?:Протокол\s+(?:№|\d+\s*\/)|\d+\s*$|стр\.|—\s*\d+\s*—|Точка\s+\d+|Общо\s+гласували|За\s+\d+\s*$|Против\s+\d+\s*$|Въздържал[аи]?\s*се\s+\d+\s*$)/iu;

export const normaliseCouncillorName = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();

export type ParsedVoteEntry = {
  name: string;
  normKey: string;
  vote: "for" | "against" | "abstain";
  /** 1-based position in the protocol's vote list. */
  position: number;
};

// Per-municípality convention for where the per-councillor list sits
// relative to the tally summary line:
//   - "before" (V. Tarnovo, Burgas, Gabrovo, Sofia OCR): the block
//     precedes the tally. Walk BACKWARDS from tallyOffset.
//   - "after"  (Казанлък): the prose tally is followed by "така:" and
//     then the numbered roll. Walk FORWARDS from the tally summary.
//   - "either" (default): try backward first, then forward — covers
//     formats we haven't seen yet without breaking the existing parsers.
export type NamedVoteBlockDirection = "before" | "after" | "either";

const parseVoteLine = (
  line: string,
): { entry: ParsedVoteEntry; pos: number } | null => {
  const m = line.match(VOTE_LINE_RE);
  if (!m) return null;
  const pos = parseInt(m[1], 10);
  const name = m[2].trim();
  const voteRaw = m[3];
  if (/^отсъства$/iu.test(voteRaw)) return null;
  const vote: ParsedVoteEntry["vote"] = /^За$/iu.test(voteRaw)
    ? "for"
    : /^Против$/iu.test(voteRaw)
      ? "against"
      : "abstain";
  return {
    entry: {
      name,
      normKey: normaliseCouncillorName(name),
      vote,
      position: pos,
    },
    pos,
  };
};

const walkBack = (text: string, tallyOffset: number): ParsedVoteEntry[] => {
  const window = text.slice(Math.max(0, tallyOffset - 8000), tallyOffset);
  const lines = window.split(/\r?\n/);
  const matched: ParsedVoteEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length === 0 || PAGE_HEADER_RE.test(line)) continue;
    const parsed = parseVoteLine(line);
    if (!parsed) {
      if (matched.length > 0) break;
      continue;
    }
    matched.push(parsed.entry);
  }
  matched.reverse();
  return matched;
};

const walkForward = (text: string, tallyOffset: number): ParsedVoteEntry[] => {
  // Start a few chars past the tally so we don't include the tally line
  // itself, then read forward up to 8000 chars (~150 lines, fits the
  // ~50-member roll plus the tail of the tally prose).
  const window = text.slice(
    tallyOffset,
    Math.min(text.length, tallyOffset + 8000),
  );
  const lines = window.split(/\r?\n/);
  const matched: ParsedVoteEntry[] = [];
  let started = false;
  for (const line of lines) {
    if (line.trim().length === 0 || PAGE_HEADER_RE.test(line)) continue;
    const parsed = parseVoteLine(line);
    if (!parsed) {
      // Once we've started collecting, break on the next non-vote line.
      // Before any matches we keep scanning forward through the prose
      // header ("Общинският съвет гласува поименно и със 'за' - 26…
      // 0, така:") until the roll starts.
      if (started) break;
      continue;
    }
    started = true;
    matched.push(parsed.entry);
  }
  return matched;
};

export const extractNamedVoteBlock = (
  text: string,
  tallyOffset: number,
  direction: NamedVoteBlockDirection = "before",
): ParsedVoteEntry[] => {
  if (direction === "before") return walkBack(text, tallyOffset);
  if (direction === "after") return walkForward(text, tallyOffset);
  // "either": try back first, fall through to forward when the back-walk
  // returns nothing. Keeps existing parsers unchanged (they explicitly
  // request "before") while letting new parsers opt into "either" as a
  // safe default during discovery.
  const back = walkBack(text, tallyOffset);
  if (back.length > 0) return back;
  return walkForward(text, tallyOffset);
};

/**
 * Locate Решение № markers — the actual decision headers, not inline
 * cross-references. Two empirical signals distinguish them:
 *
 *  - All-caps РЕШЕНИЕ vs lowercased Решение (the latter is always a
 *    reference like "съгласно Решение № 70 от Протокол 14").
 *  - Headers sit on their own line. V. Tarnovo PDFs CENTER them with
 *    heavy whitespace; Ruse DOCX flush-lefts them; Stara Zagora prepis-
 *    PDFs use a blank-line + centered indent. The unifying signal is
 *    "starts a line" — leading whitespace is optional.
 *
 * The regex requires line-start (or file-start) + optional whitespace +
 * all-caps РЕШЕНИЕ. Returns each marker's offset, captured number, and
 * the best-effort title pulled from the most recent preceding ОТНОСНО:
 * clause (looked back up to ~6000 chars to span a debate).
 */
export const findResolutionMarkers = (
  text: string,
): Array<{ offset: number; number: string; title: string }> => {
  const out: Array<{ offset: number; number: string; title: string }> = [];
  // (^|\n) + optional indent + all-caps РЕШЕНИЕ (compact OR letter-spaced
  // form "Р  Е  Ш  Е  Н  И  Е" — Pleven inflates the title block this way) +
  // № + digits. Case-sensitivity is the discriminator vs inline lowercase
  // "Решение № N" references, so we stay case-sensitive here.
  //
  // Sofia full-protocol PDFs that have been re-OCR'd via Gemini lose the
  // "Решение № N" headers entirely and surface agenda items as
  // "Точка <N>" / "Точка <N> (<number-as-word>)" instead — accept those
  // as fallback markers. Other municipalities don't use bare "Точка N" on
  // its own line so this alternative doesn't false-positive.
  const re =
    /(?:^|\n)[ \t]*(?:РЕШЕНИЕ|Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е|Точка)\s*(?:№\s*)?(\d+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // m.index points at the (^|\n) boundary; nudge past it for the marker offset.
    const markerOffset = m.index + (text[m.index] === "\n" ? 1 : 0);
    const back = text.slice(Math.max(0, markerOffset - 6000), markerOffset);
    // ОТНОСНО: titles can span multiple lines until a blank line or the
    // next "Г-н <NAME>:" speaker label. Match up to 400 chars or two
    // newlines in a row.
    const titleMatches = back.match(
      /ОТНОСНО\s*:\s*([\s\S]{5,400}?)(?:\n\s*\n|\n\s*Г-?н\s+[А-Я])/giu,
    );
    let title = "";
    if (titleMatches && titleMatches.length > 0) {
      // Take the LAST ОТНОСНО: in the window (the one closest to the marker).
      const last = titleMatches[titleMatches.length - 1];
      const m2 = last.match(/ОТНОСНО\s*:\s*([\s\S]+)/iu);
      if (m2) {
        title = m2[1]
          .replace(/\s+/g, " ")
          .replace(/\s*Г-?н\s+[А-Я].*$/u, "")
          .trim();
      }
    }
    out.push({ offset: markerOffset, number: m[1], title });
  }
  return out;
};
