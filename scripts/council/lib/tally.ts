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

const SUMMARY_RE_DIGIT_FIRST = new RegExp(
  `(\\d+|няма|-)\\s*${Q}\\s*за\\s*${Q}` +
    SEP +
    `(?:${Q}\\s*)?(\\d+|няма|-)\\s*${Q}\\s*против\\s*${Q}` +
    SEP +
    `(?:${Q}\\s*)?(\\d+|няма|-)\\s*${Q}\\s*въздържал[аи]?\\s*се\\s*${Q}`,
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

/** Decisions can be voted via a name list too — we detect the marker for Phase 2 only. */
const NAMED_VOTE_BLOCK_RE =
  /(?:Поименно\s+гласуване\s*:|^\s*1\.\s+[А-Я][а-я]+\s+[А-Я][а-я]+\s*:\s*(?:За|Против|Въздържал))/imu;

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
  const mShort = mDigit || mLabel ? null : text.match(SUMMARY_RE_SHORTHAND);
  const m = mDigit ?? mLabel ?? mShort;
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

  // Word-order varies by município. V. Tarnovo: "беше прието" /
  // "не беше прието" — predicate. Stara Zagora: "Приема се." /
  // "Не се приема." — short reflexive form right after the tally line.
  const REJECTED =
    /(?:не\s+беше\s+прието|не\s+се\s+приема|не\s+приема\s+се|отхвърл)/iu;
  const RETURNED = /върнат[аоои]?\s+за\s+ново\s+обсъждане/iu;
  const ADOPTED = /(?:беше\s+прието|се\s+приема|приема\s+се|прие[ти][аоои]?)/iu;

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
const VOTE_LINE_RE =
  /^\s*(\d+)\.\s+([А-ЯЁA-Z][а-яёa-z]+(?:[-\s][А-ЯЁA-Z][а-яёa-z]+){1,3})\s*:\s*(За|Против|Въздържал(?:[аи]?\s*се)?)\s*$/u;

const PAGE_HEADER_RE = /^\s*(?:Протокол\s+№|\d+\s*$|стр\.|—\s*\d+\s*—)/iu;

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

export const extractNamedVoteBlock = (
  text: string,
  tallyOffset: number,
): ParsedVoteEntry[] => {
  // Slice the look-back window. The block always sits BEFORE the tally
  // summary; we scan upwards from tallyOffset gathering lines that match
  // VOTE_LINE_RE until we hit a chunk of non-matching, non-blank, non-
  // page-header content. That break heuristic keeps the parser from
  // greedily eating the previous resolution's named-vote block.
  const window = text.slice(Math.max(0, tallyOffset - 8000), tallyOffset);
  const lines = window.split(/\r?\n/);

  const matched: Array<{ idx: number; entry: ParsedVoteEntry }> = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length === 0 || PAGE_HEADER_RE.test(line)) continue;
    const m = line.match(VOTE_LINE_RE);
    if (!m) {
      // Stop on first non-vote, non-skipped line — that's the resolution
      // body (or the previous tally summary).
      if (matched.length > 0) break;
      continue;
    }
    const pos = parseInt(m[1], 10);
    const name = m[2].trim();
    const voteRaw = m[3];
    const vote: ParsedVoteEntry["vote"] = /^За$/iu.test(voteRaw)
      ? "for"
      : /^Против$/iu.test(voteRaw)
        ? "against"
        : "abstain";
    matched.push({
      idx: i,
      entry: {
        name,
        normKey: normaliseCouncillorName(name),
        vote,
        position: pos,
      },
    });
  }
  // Restore original (top-down) order.
  matched.reverse();
  return matched.map((m) => m.entry);
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
  // (^|\n) + optional indent + all-caps РЕШЕНИЕ + № + digits.
  const re = /(?:^|\n)[ \t]*РЕШЕНИЕ\s*№\s*(\d+)/gu;
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
