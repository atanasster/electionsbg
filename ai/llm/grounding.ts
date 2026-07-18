// Grounded-number gate — the deterministic post-check that keeps a model's
// narration prose from ever surfacing a fabricated (or ROUNDED) figure.
//
// The load-bearing invariant of the chat is "the model never emits a number;
// every figure is computed by a tool." Structured blocks (tables/bars) are safe
// by construction (AnswerView renders them from the Envelope). The ONE place a
// number could leak is the interpretive PROSE paragraph the LLM writes from
// `JSON.stringify(env.facts)`. This module verifies every MATERIAL number in that
// prose is grounded in the same material the model was given; the providers fall
// back to the deterministic template narrator when it isn't.
//
// This is strictly better than a blanket "no numbers in prose" ban: it KEEPS
// true inline figures (which read far better than "see the table") and rejects
// only ungrounded ones. It also enforces the never-round/never-compute rule for
// free — a rounded figure won't be a substring of any facts token, so it falls
// back. Pure + ReDoS-safe + no React/web-llm deps, so it's unit-testable and the
// two providers share ONE normalization.

// Decimal-digit block "zero" code points. Every Unicode decimal digit sits in a
// contiguous run of ten starting at its block's zero, so a digit char `c` has
// value `c - zero` for the block whose zero is the greatest value ≤ c within 10.
// Covers the common non-ASCII decimal scripts (Arabic-Indic, Devanagari, Thai,
// fullwidth, …); an unlisted block is left untouched (it just won't match ASCII
// runs, which is safe — it can't ground a fabricated ASCII figure).
const DIGIT_ZEROS = [
  0x0030, // ASCII / European
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Persian)
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0xff10, // Fullwidth
];

// Fold every Unicode decimal digit to its ASCII 0-9 equivalent, leaving all
// other characters intact. So "٦١٨" and "６１８" both become "618".
export const foldDigits = (s: string): string =>
  s.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? -1;
    for (const z of DIGIT_ZEROS)
      if (cp >= z && cp <= z + 9) return String(cp - z);
    return ch;
  });

// Collapse spaces used as thousands separators: a (regular / no-break / narrow)
// space between a digit and a following EXACTLY-three-digit group is a grouping
// space and is removed ("618 206" → "618206", "1 234 567" → "1234567"). The
// 3-digit constraint stops unrelated adjacent numbers from being fused ("2023 45"
// stays two tokens). Fixed-length lookahead → linear, ReDoS-safe.
const mergeThousands = (s: string): string =>
  s.replace(/(\d)[\u00a0\u202f ](?=\d{3}(?!\d))/g, "$1");

// Extract the set of digit-only run tokens from a string. A "run" is a number
// with interior grouping/decimal separators (',' '.' or a grouping space),
// reduced to its bare digits — so "618 206", "618,206", "25,3%" and "1 234,5"
// yield "618206", "618206", "253" and "12345". Each match step consumes at least
// one digit (the trailing `\d` is mandatory), so the scan is linear.
export const digitRuns = (s: string): string[] => {
  const norm = mergeThousands(foldDigits(s));
  const runs: string[] = [];
  const re = /\d(?:[.,]?\d)*/g;
  for (let m = re.exec(norm); m; m = re.exec(norm)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits) runs.push(digits);
  }
  return runs;
};

// A magnitude/percent/currency marker immediately AFTER a number ("618 млн",
// "25%", "12 лв", "3 million", "5 pts") — an optional single grouping space, then
// a listed unit (BG + EN forms kept symmetric). Its presence makes even a 1-2
// digit number material (must ground) — so a computed percentage-point or
// magnitude difference the model invents falls back instead of surfacing.
const SUFFIX_MARK =
  /^[\u00a0\u202f ]?(%|‰|€|\$|£|лв\.?|лева|евро|eur|bgn|млрд\.?|млн\.?|хил\.?|mln|bn|billion|million|thousand|percent|пр\.?\s?п\.?|пункт|pts|points)/i;
// A currency symbol immediately BEFORE a number ("€5", "$ 12").
const PREFIX_MARK = /(€|\$|£)[\u00a0\u202f ]?$/;

const stringify = (facts: unknown): string => {
  try {
    return JSON.stringify(facts) ?? "";
  } catch {
    return String(facts);
  }
};

// Verify every MATERIAL number in `prose` is grounded in the material the model
// was given (`facts` plus `extra` — the title, and optionally provenance).
//
// A prose token `p` (its bare digit run) is GROUNDED iff some facts token `f`
// contains `p` as a substring. Substring (not equality) is deliberate: a year
// "2023" grounds against a date label "2023_10_27", and a small ordinal grounds
// against a longer figure — while an exact euro amount that appears nowhere in
// facts is a substring of no single facts token, so it's rejected. Rounding is
// caught the same way: facts 618206, prose 618000 → "618000" is a substring of
// nothing → rejected.
//
// Trivially-safe tokens are ignored to avoid false rejects: a bare 1-2 digit
// number (a small count / ordinal) passes unconditionally. Everything 3+ digits,
// or any number carrying a magnitude/percent/currency marker, must be grounded.
export function numbersGrounded(
  prose: string,
  facts: unknown,
  extra?: string,
): boolean {
  const F = digitRuns(`${stringify(facts)} ${extra ?? ""}`);
  const norm = mergeThousands(foldDigits(prose));
  const re = /\d(?:[.,]?\d)*/g;
  for (let m = re.exec(norm); m; m = re.exec(norm)) {
    const digits = m[0].replace(/\D/g, "");
    if (!digits) continue;
    const start = m.index;
    const end = start + m[0].length;
    const marked =
      SUFFIX_MARK.test(norm.slice(end, end + 14)) ||
      PREFIX_MARK.test(norm.slice(Math.max(0, start - 2), start));
    // bare 1-2 digit numbers with no unit are trivially safe (counts/ordinals)
    if (!marked && digits.length <= 2) continue;
    if (!F.some((f) => f.includes(digits))) return false;
  }
  return true;
}
