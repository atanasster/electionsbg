// Tier 4b — the "<candidate/ticket pair> ... <n>,<d>%" sentence rule for
// PRESIDENTIAL races, generalising `sentence_rule.ts`'s party-share
// extraction to CANDIDATE NAMES. There is no closed candidate registry to
// match against at extraction time the way `KNOWN_PARTY_LABELS` exists for
// parties — a candidate is only resolvable against a cycle's own
// `tickets.json` (`candidate_resolver.ts`), which may not exist yet — so
// this looks for a NAME SHAPE (two or three capitalized words) instead of
// a fixed label list.
//
// A Bulgarian presidential ballot pairs a President candidate with a Vice
// President running mate, and agency prose often prints the pair as one
// hyphen-joined unit with no surrounding space ("Румен Радев-Илияна
// Йотова", measured live in Trend's real 2021 capture). This rule matches
// the pair shape FIRST so the VP half is consumed as part of one match
// (never independently re-matched by a later scan of the same text) and
// returns only the PRESIDENT half as the label — the only half
// `candidate_resolver.ts` (and a cycle's `tickets.json`) can resolve
// against.
//
// The abstention phrase ("не подкрепям никого") is matched as a fixed
// literal alongside the name shape, for the same reason
// `candidate_resolver.ts`'s own `ABSTENTION_PHRASES` exists — TR states it
// as a residual line beside the ranked candidates, in the SAME prose, and
// it needs the same forward/backward percentage-window treatment as every
// other row (measured live: "Опцията „не подкрепям никого“ е с дял от
// 7,1%.", 2016).
//
// ⚠️ UNLIKE `extractSharesBySentenceRule`, THIS ALSO TRIES A BACKWARD
// WINDOW when the forward one finds nothing. Real Trend prose states a
// runner-up's number BEFORE their name ("След нея с 24% се нарежда
// подкрепеният от БСП претендент Румен Радев.", measured live 2016) as
// often as it states a leader's number after theirs ("Цецка Цачева с
// 27,3%...") — a forward-only rule would silently drop the second-place
// candidate's real, correctly-quotable number with no refusal recorded at
// all (an empty window is not ambiguous, so `extractSharesBySentenceRule`'s
// own `continue` on `candidates.length !== 1` reads it that way). The
// backward window is tried ONLY when the forward one is genuinely EMPTY
// (never when it found more than one number, which stays a real
// ambiguity refusal exactly as it would forward), and is bounded to the
// CURRENT SENTENCE and never crosses into the PREVIOUS label's own
// window — the same misattribution guard `sentence_rule.ts`'s forward
// window applies, mirrored. A claim built from a backward match needs
// `evidence_gate.ts`'s `gateSharesEitherDirection` (not `gateShares`,
// which is forward-only) to pass grounding.

import {
  SENTENCE_END_RE,
  parsePercent,
  percentMatchesIn,
} from "./sentence_rule";
import type { ShareClaim } from "./evidence_gate";

// Bulgarian narrator words TR's ranking prose uses to introduce an entry —
// measured on both real captures, sentence-initial and so capitalized,
// otherwise indistinguishable from a real name token by case shape alone:
// "Следват Костадин Костадинов-Елена Гунчева..." ("Next come: Kostadinov-
// Guncheva..."), "Двойката Румен Радев-Илияна Йотова заема..." ("The pair
// Radev-Yotova takes..."). Without this, the FIRST word of the match
// absorbs the narrator word into the label instead of the real name — a
// future capture using a different narrator word would need this list
// widened, the same "measure real data, note the residual limitation"
// convention `trend.ts`'s own header uses for its short-trailing-label gap.
// ⚠️ The exclusion boundary is `(?![\p{L}\p{N}])`, NEVER `\b` — `\b` is
// ASCII-only in JS RegExp and never matches after a Cyrillic letter, so
// `Следват\b` silently fails to match at all and the whole negative
// lookahead becomes a no-op (this repo's own documented trap, one level
// up from `LABEL_RE` in `sentence_rule.ts`, which uses the same fix).
const NARRATOR_WORDS = ["Следват", "Следва", "Двойката", "Двойка"];
const NOT_NARRATOR = `(?!(?:${NARRATOR_WORDS.join("|")})(?![\\p{L}\\p{N}]))`;

// Two or three capitalized-first-letter words — "Цецка Цачева", "Красимир
// Каракачанов". Every candidate name measured in the real 2016/2021 Trend
// captures is a bare First+Last with no patronymic in running prose
// (`candidate_resolver.ts` itself only ever compares a name's OUTER two
// tokens for exactly this reason).
const NAME_UNIT_SRC = `${NOT_NARRATOR}\\p{Lu}\\p{Ll}+(?:\\s+\\p{Lu}\\p{Ll}+){1,2}`;

// Both capitalizations occur in real prose — mid-sentence ("...опцията
// „не подкрепям никого“...") and, elsewhere in the same articles,
// sentence-initial ("...ще отбележите „Не подкрепям никого“."). Written as
// an explicit two-letter alternation rather than an `i` flag on the whole
// pattern, so `\p{Lu}`/`\p{Ll}` in `NAME_UNIT_SRC` keep their strict
// upper/lower-case meaning with no risk of the `i` flag's case-folding
// rules interacting with them.
const ABSTENTION_SRC = "[Нн]е подкрепям никого";

// Group 1: a name, or the PRESIDENT half of a hyphen-joined ticket pair —
// the optional `(?:-NAME_UNIT)?` consumes a VP half with no capture group
// of its own, so the overall match (`m[0]`) spans the whole pair and the
// VP half is never independently re-matched on the scan's next iteration.
// Group 2: the fixed abstention phrase.
const NAME_OR_PAIR_RE = new RegExp(
  `(${NAME_UNIT_SRC})(?:-${NAME_UNIT_SRC})?|(${ABSTENTION_SRC})`,
  "gu",
);

interface LabelMatch {
  label: string;
  start: number;
  end: number;
}

const findLabelMatches = (text: string): LabelMatch[] => {
  const matches: LabelMatch[] = [];
  const re = new RegExp(NAME_OR_PAIR_RE.source, NAME_OR_PAIR_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = m[1] ?? m[2];
    matches.push({ label, start: m.index, end: m.index + m[0].length });
  }
  return matches;
};

/** The position of the first sentence-ending punctuation at or after
 *  `from`, or `text.length` — same rule as `sentence_rule.ts`'s own
 *  (private) `sentenceEndFrom`, reimplemented over the SHARED exported
 *  `SENTENCE_END_RE` pattern rather than a second regex literal. */
const sentenceEndAfter = (text: string, from: number): number => {
  const re = new RegExp(SENTENCE_END_RE.source, "g");
  re.lastIndex = from;
  return re.exec(text)?.index ?? text.length;
};

/** The position right after the LAST sentence-ending punctuation strictly
 *  before `before`, or `0` when the label sits in the text's first
 *  sentence. The backward-window boundary: without this, a runner-up's
 *  backward scan could reach past its OWN sentence into a PRECEDING
 *  candidate's number. */
const sentenceStartBefore = (text: string, before: number): number => {
  const re = new RegExp(SENTENCE_END_RE.source, "g");
  let end = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const punctEnd = m.index + m[0].length;
    if (punctEnd > before) break;
    end = punctEnd;
  }
  return end;
};

/**
 * Extract every `<candidate/ticket/abstention> ... <value>%` pairing this
 * rule can find, as candidate `ShareClaim`s — UNGATED, exactly like
 * `extractSharesBySentenceRule`: the caller runs the result through
 * `evidence_gate.ts`'s `gateSharesEitherDirection` (not `gateShares`,
 * which only accepts the forward shape).
 *
 * The forward window is bounded by the next label match or the end of the
 * CURRENT sentence, whichever comes first — same reasoning as
 * `extractSharesBySentenceRule`'s own forward window (see that module's
 * header). When the forward window carries zero percentages, a SECOND,
 * backward window is tried, bounded by the end of the PREVIOUS label's
 * own match and the start of the current sentence (whichever is later) —
 * see this module's header for why both directions are needed. Either
 * window carrying MORE than one percentage-shaped number is refused (no
 * claim), exactly as `extractSharesBySentenceRule` refuses an ambiguous
 * forward window: which of two numbers belongs to this label is not
 * guessable from position alone.
 */
export const extractCandidateSharesBySentenceRule = (
  text: string,
): ShareClaim[] => {
  const labelMatches = findLabelMatches(text);
  const claims: ShareClaim[] = [];
  // ⚠️ The end offset (within `text`) of the last percentage token any
  // PRECEDING label already consumed via its own FORWARD window — a
  // backward scan must never read behind this point. Without it, "A ...
  // X%, ... B ..." (both in ONE sentence, B's own forward window empty)
  // has B's backward scan re-read A's already-claimed X% and duplicate
  // it onto B — a real, silent misattribution found while reviewing this
  // extractor (Tier 4b), reproduced on realistic Trend-style phrasing
  // ("Румен Радев води с 46.8%, следван на далечно разстояние от Анастас
  // Герджиков...") where nothing about either claim looks wrong in
  // isolation: both pass the evidence gate, since each claim's own quote
  // is (correctly, for the reasons `evidence_gate.ts` documents) too
  // narrow to see the SIBLING label that would otherwise flag the reuse.
  // Monotonically non-decreasing by construction (labels are processed in
  // left-to-right position order) — never reset to `0` on an ambiguous or
  // empty label, or a THIRD label sharing that same sentence would lose
  // this protection against the FIRST label's already-consumed number.
  let consumedUntil = 0;
  for (let i = 0; i < labelMatches.length; i++) {
    const { label, start, end } = labelMatches[i];

    const nextLabelStart = labelMatches[i + 1]?.start ?? text.length;
    const forwardBoundary = Math.min(
      nextLabelStart,
      sentenceEndAfter(text, end),
    );
    const forwardCandidates = percentMatchesIn(
      text.slice(end, forwardBoundary),
    );
    if (forwardCandidates.length === 1) {
      const pm = forwardCandidates[0];
      claims.push({
        label,
        value: parsePercent(pm[1]),
        quote: text.slice(start, forwardBoundary),
      });
      consumedUntil = Math.max(consumedUntil, end + pm.index + pm[0].length);
      continue;
    }
    if (forwardCandidates.length > 1) continue; // ambiguous forward — refuse silently, same as sentence_rule.ts

    const prevLabelEnd = labelMatches[i - 1]?.end ?? 0;
    const backwardBoundary = Math.max(
      prevLabelEnd,
      consumedUntil,
      sentenceStartBefore(text, start),
    );
    const backwardCandidates = percentMatchesIn(
      text.slice(backwardBoundary, start),
    );
    if (backwardCandidates.length !== 1) continue;
    const pm = backwardCandidates[0];
    claims.push({
      label,
      value: parsePercent(pm[1]),
      quote: text.slice(backwardBoundary, end),
    });
    consumedUntil = Math.max(
      consumedUntil,
      backwardBoundary + pm.index + pm[0].length,
    );
  }
  return claims;
};
