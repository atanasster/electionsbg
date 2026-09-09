// Tier 2c — the "<party> … <n>,<d>%" sentence rule (§6.2), shared by every
// agency whose text acquisition yields prose rather than a table (TR, AR,
// MY, GIB, press — ML/GM's PDFs use a different, ALIGNED-ROW rule instead).
//
// Finds every KNOWN_PARTY_LABELS occurrence in the raw text, then — for
// each — looks FORWARD for the first percentage-shaped number, bounded by
// wherever the NEXT label occurrence starts. That boundary is what stops a
// compound sentence naming two parties ("ПП-ДБ (10,9%) и ДПС-Ново начало
// (10,5%)") from letting the second party's number attach to the first —
// the same idea `evidence_gate.ts`'s `shareSupportedByQuote` applies at the
// GATE, used here at EXTRACTION time instead. The quote captured is the raw
// text slice from the label's start to the number's end, verbatim, so it
// can be run straight through that same gate.
//
// A value with no label the registry recognises (212637's "новата формация
// на Румен Радев" — a periphrasis, not a party name) produces NO claim at
// all — decision 5's rule that an unlabelable number must never be guessed.

import { KNOWN_PARTY_LABELS } from "./party_labels";
import type { ShareClaim } from "./evidence_gate";

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Tolerant to the same dash variants `normKey` folds ("ГЕРБ-СДС" /
// "ГЕРБ – СДС" / "ГЕРБ - СДС") and to whichever amount of whitespace an
// agency puts around a multi-word name's dash or spaces — TR (measured
// 2026-09-09) writes "ДПС-Ново начало" with none, while the alias table's
// own key has one on each side of its dash ("ДПС - Ново Начало").
const labelPattern = (label: string): string =>
  escapeRegExp(label).replace(/-/g, "\\s*[-–—]\\s*").replace(/ +/g, "\\s*");

// A Unicode-aware boundary on both sides (`\p{L}`/`\p{N}` under the `u`
// flag) — never `\b`/`\w`, which are ASCII-only in JS RegExp and silently
// fail to bound a Cyrillic word (this repo's own documented trap). Without
// it, a short label like "БГ" could match as a substring inside an
// unrelated longer word. Case-insensitive (`i`) for the same TR example —
// its "Начало" is capitalized in the alias table and lowercase on the page.
const LABEL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${KNOWN_PARTY_LABELS.map(labelPattern).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

// A Bulgarian percentage token: a digit run with an optional comma/dot
// decimal, immediately (whitespace-tolerant) followed by "%". Deliberately
// NOT `numbersIn` (enrich_gate.ts) — that extracts ANY digit run, which
// would treat "3 милиона" or "1004 интервюта" as a candidate share.
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;

const parsePercent = (raw: string): number => Number(raw.replace(",", "."));

/** Every percentage-shaped match in `window`, in order. */
const percentMatchesIn = (window: string): RegExpExecArray[] => {
  const out: RegExpExecArray[] = [];
  PERCENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PERCENT_RE.exec(window))) out.push(m);
  return out;
};

// A "." followed by a digit is a decimal separator ("20.4%"), not a
// sentence end — Trend's own real HTML mixes period- and comma-decimals
// in one article (212637: "32.7% от гласуващите. Втори ... с 20,4%."),
// and treating the decimal point as a sentence end truncates the window
// BEFORE the digits after it — silently dropping a labelled share (zero
// candidates found, no refusal recorded either) or, worse, leaving
// exactly one OTHER percent-shaped number in the truncated window that
// then gets confidently — and wrongly — attributed to the label.
const SENTENCE_END_RE = /[!?]|\.(?!\d)/g;

/** The position of the first sentence-ending punctuation at or after
 *  `from`, or `text.length` when the label's sentence runs to the end of
 *  the document (the trailing agency-boilerplate footer, past the last
 *  ".", carries no label at all in every capture measured so far). */
const sentenceEndFrom = (text: string, from: number): number => {
  SENTENCE_END_RE.lastIndex = from;
  return SENTENCE_END_RE.exec(text)?.index ?? text.length;
};

interface LabelMatch {
  label: string;
  start: number;
  end: number;
}

const findLabelMatches = (text: string): LabelMatch[] => {
  const matches: LabelMatch[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text))) {
    matches.push({ label: m[0], start: m.index, end: m.index + m[0].length });
  }
  return matches;
};

/**
 * Extract every `<label> … <value>%` pairing the sentence rule can find,
 * as candidate `ShareClaim`s — UNGATED. The caller runs the result through
 * `gateShares` (evidence_gate.ts); a candidate here is a hypothesis to be
 * checked, not yet a fact. May return more than one claim for the same
 * label (a party mentioned twice) — the caller's dedup policy, not this
 * module's, since a legitimate repeat (e.g. a runoff pairing) is agency-
 * shaped rather than universal.
 *
 * The window is bounded by the NEXT LABEL match or the end of the CURRENT
 * SENTENCE, whichever comes first. The sentence bound matters on its own:
 * without it, a label with no other label between it and the next one
 * (the common case for the LAST party a post ranks) has a window running
 * all the way to wherever the next label happens to sit — which, past the
 * ranked list, is often several sentences away and can cross an unrelated
 * "%" the module must not treat as this party's own (a turnout aside, or
 * — measured live, all three real Trend captures — the "не подкрепям
 * никого" residual figure quoted a sentence or two after the ranking
 * ends). Bounding by sentence end keeps that unrelated number out of the
 * window in the first place, rather than relying on the ambiguity check
 * below to notice it arrived.
 *
 * A window carrying MORE than one percentage-shaped number — which the
 * sentence bound does NOT rule out, since a single clause can still state
 * two — is exactly as unguessable as one carrying none, and is refused the
 * same way: real BG poll prose states two numbers for one party in a
 * single clause often enough to matter — a before/after comparison ("от
 * 22% на 20,4%") or the party's own share stated next to the 4%
 * parliamentary-barrier threshold ("под 4% бариера ... регистрира 3,8%")
 * — and neither "prefer the first" nor "prefer the last" is a safe general
 * rule, since BG phrasing puts the true current value on either side
 * depending on the construction. Picking one anyway would be silently
 * wrong in a way nothing downstream catches: the resulting quote states
 * the WRONG value beside the right label, which is self-consistent
 * evidence and sails straight through the gate.
 *
 * The QUOTE extends to the full window boundary, not just to the end of
 * the matched percentage — every remaining character up to the next label
 * (or sentence end) is already known to be safe context (it is what the
 * ambiguity check just scanned for a SECOND percent and found none in).
 * This matters beyond readability: `evidence_gate.ts`'s grounding check
 * refuses any quote under `MIN_QUOTE_CHARS` (12) once normalised, and a
 * short label's own tightest possible span — "БСП (3,8%" — normalises to
 * under that floor, which would refuse a real, correctly-extracted share
 * for being too short to be its OWN evidence.
 */
export const extractSharesBySentenceRule = (text: string): ShareClaim[] => {
  const labelMatches = findLabelMatches(text);
  const claims: ShareClaim[] = [];
  for (let i = 0; i < labelMatches.length; i++) {
    const { label, end, start } = labelMatches[i];
    const nextLabelStart = labelMatches[i + 1]?.start ?? text.length;
    const boundary = Math.min(nextLabelStart, sentenceEndFrom(text, end));
    const window = text.slice(end, boundary);
    const candidates = percentMatchesIn(window);
    if (candidates.length !== 1) continue;
    const pm = candidates[0];
    claims.push({
      label,
      value: parsePercent(pm[1]),
      quote: text.slice(start, boundary),
    });
  }
  return claims;
};
