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
 * One canonical summary-line regex covering the four common phrasings.
 * Captures: 1=for, 2=against, 3=abstain. Each capture is either a digit
 * group (`\d+`) or the literal "няма" (zero).
 */
const SUMMARY_RE = new RegExp(
  `(\\d+|няма|-)\\s*${Q}\\s*за\\s*${Q}` +
    `[\\s,]+` +
    `(?:${Q}\\s*)?(\\d+|няма|-)\\s*${Q}\\s*против\\s*${Q}` +
    `[\\s,]+` +
    `(?:${Q}\\s*)?(\\d+|няма|-)\\s*${Q}\\s*въздържал[аи]?\\s*се\\s*${Q}`,
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
 * Extract one aggregate tally from a span of text. Returns null if no
 * summary line could be matched.
 */
export const extractTally = (text: string): CouncilTally | null => {
  const m = text.match(SUMMARY_RE);
  if (!m) return null;
  const method: CouncilTally["method"] = NAMED_VOTE_BLOCK_RE.test(text)
    ? "named"
    : "open";
  return {
    for: parseCount(m[1]),
    against: parseCount(m[2]),
    abstain: parseCount(m[3]),
    method,
  };
};

/**
 * Walk text and yield every (offset, tally) pair found, in document order.
 * Used by per-município parsers that need to associate each tally with the
 * resolution it belongs to.
 */
export const findAllTallies = (
  text: string,
): Array<{ offset: number; length: number; tally: CouncilTally }> => {
  const out: Array<{ offset: number; length: number; tally: CouncilTally }> =
    [];
  const re = new RegExp(SUMMARY_RE.source, "igu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const method: CouncilTally["method"] = NAMED_VOTE_BLOCK_RE.test(
      text.slice(Math.max(0, m.index - 4000), m.index),
    )
      ? "named"
      : "open";
    out.push({
      offset: m.index,
      length: m[0].length,
      tally: {
        for: parseCount(m[1]),
        against: parseCount(m[2]),
        abstain: parseCount(m[3]),
        method,
      },
    });
  }
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

  const REJECTED = /(?:не\s+беше\s+прието|не\s+се\s+приема|отхвърл)/iu;
  const RETURNED = /върнат[аоои]?\s+за\s+ново\s+обсъждане/iu;
  const ADOPTED = /(?:беше\s+прието|се\s+приема|прие[ти][аоои]?)/iu;

  if (REJECTED.test(fwd) || REJECTED.test(back)) return "rejected";
  if (RETURNED.test(fwd) || RETURNED.test(back)) return "returned";
  if (ADOPTED.test(back) || ADOPTED.test(fwd)) return "adopted";
  return "unknown";
};

/**
 * Locate Решение № markers — the actual decision headers, not inline
 * cross-references. Two empirical signals distinguish them:
 *
 *  - All-caps РЕШЕНИЕ vs lowercased Решение (the latter is always a
 *    reference like "съгласно Решение № 70 от Протокол 14").
 *  - Headers sit on their own line, often centered (significant leading
 *    whitespace), occasionally with a trailing annotation like
 *    "– приложение към протокола".
 *
 * The regex requires line-start + leading whitespace + all-caps РЕШЕНИЕ.
 * Returns each marker's offset, captured number, and the best-effort
 * title pulled from the most recent preceding ОТНОСНО: clause (looked
 * back up to ~6000 chars to span a debate).
 */
export const findResolutionMarkers = (
  text: string,
): Array<{ offset: number; number: string; title: string }> => {
  const out: Array<{ offset: number; number: string; title: string }> = [];
  // (^|\n) + indent + all-caps РЕШЕНИЕ + № + digits.
  const re = /(?:^|\n)[ \t]+РЕШЕНИЕ\s*№\s*(\d+)/gu;
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
