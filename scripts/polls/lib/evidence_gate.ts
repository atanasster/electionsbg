// Tier 2 — the polls evidence gate (decision 5, §6.2). Reuses
// scripts/opencalls/enrich_gate.ts's citation-grounding primitives
// (`normalise`, `isGroundedIn`, `numbersIn`, `MIN_QUOTE_CHARS`) rather than
// forking them — the CHECKS are the same ("does this quote occur in the
// text, and does it actually state this value") even though the DOMAIN
// differs (a poll share is bound to a party/candidate LABEL, not one of
// enrich_gate's fixed field names, so `valueSupportedByQuote` there is not
// quite what a poll needs — see `shareSupportedByQuote` below).
//
// Every share, the sample size, and each fieldwork date must carry a quote
// that (a) occurs in the extracted text and (b) states that value beside
// that label. A field failing either is REFUSED, never guessed — a draft
// with zero accepted shares is still written, so the operator sees what
// the parser could not read (decision 5, decision 7's inbox contract).

import {
  MIN_QUOTE_CHARS,
  isGroundedIn,
  normalise,
  numbersIn,
} from "../../opencalls/enrich_gate";

export { MIN_QUOTE_CHARS, normalise };

/** One extracted share: a party/candidate label, its percentage, and the
 *  verbatim span the extractor says supports it. */
export interface ShareClaim {
  label: string;
  value: number;
  quote: string;
}

/** A non-share numeric/string field this gate also covers — the sample
 *  size ("Обем на извадката: 1000 души") and the raw fieldwork date text
 *  ("12 - 20 март 2026г.", BEFORE `formatFieldwork` canonicalises it). */
export interface FieldClaim {
  field: string;
  value: number | string;
  quote: string;
}

export interface Refusal {
  field: string;
  reason: string;
  quote: string;
}

export interface GateResult<T> {
  accepted: T[];
  refused: Refusal[];
}

/**
 * Does `quote` state `value` beside `label` — decision 5(b), the half
 * `enrich_gate.ts`'s own `valueSupportedByQuote` cannot do, because that
 * function checks a NUMBER against a fixed field name, never against a
 * free-text label.
 *
 * "Beside" is checked, not just "both present somewhere in the quote" —
 * a compound quote naming two parties in one sentence ("ГЕРБ-СДС получи
 * 19,1%, а Прогресивна България получи 33,2%...") would otherwise let
 * ГЕРБ-СДС's real 19,1% be accepted as Прогресивна България's number,
 * which is exactly the misattribution decision 5(b) exists to rule out.
 * The value must occur in the text FORWARD of the label's own occurrence
 * (real BG poll phrasing states the party, then its number — never the
 * reverse), and no further forward than the next `otherLabels` entry that
 * occurs after it: a number past that boundary is stated beside whichever
 * OTHER party's name it follows, not this one. `otherLabels` is normally
 * every sibling label in the same extraction batch (`gateShares` supplies
 * it); a caller checking one claim in isolation gets an unbounded forward
 * scan, which is still label-then-value rather than "anywhere in the quote".
 */
export const shareSupportedByQuote = (
  label: string,
  value: number,
  quote: string,
  otherLabels: string[] = [],
): boolean => {
  const q = normalise(quote);
  const normLabel = normalise(label);
  const labelIdx = q.indexOf(normLabel);
  if (labelIdx === -1) return false;
  const labelEnd = labelIdx + normLabel.length;
  let boundary = q.length;
  for (const other of otherLabels) {
    const normOther = normalise(other);
    if (!normOther || normOther === normLabel) continue;
    const idx = q.indexOf(normOther, labelEnd);
    if (idx !== -1 && idx < boundary) boundary = idx;
  }
  return numbersIn(q.slice(labelEnd, boundary)).some(
    (n) => n === value || Math.abs(n - value) <= Math.abs(value) * 1e-9,
  );
};

/**
 * The mirror image of `shareSupportedByQuote`, for phrasing that states
 * the value BEFORE the label — "... с 24% се нарежда подкрепеният от БСП
 * претендент Румен Радев." (measured live in Trend's real 2016
 * presidential capture, Tier 4b's `candidate_name_rule.ts`). Bulgarian
 * presidential-race prose uses both orders in the same article — a
 * leader stated "Name с X%", a runner-up stated "с X% ... Name" — which
 * is why `shareSupportedByQuote` itself stays forward-only rather than
 * becoming bidirectional and silently loosening the guarantee every
 * EXISTING caller (party-share extraction, measured forward-only) relies
 * on; this is a separate, additive check for a genuinely different real
 * phrasing, not a relaxation of that one.
 *
 * The value must occur BEHIND the label's own occurrence, no further
 * back than the nearest `otherLabels` entry preceding it — the mirror of
 * `shareSupportedByQuote`'s own forward boundary, for the identical
 * misattribution reason.
 *
 * ⚠️ That boundary only excludes the OTHER label's own NAME span, not
 * wherever ITS number happens to sit — correct when every candidate in
 * the combined quote uses this same before-label shape (the other
 * label's number is then necessarily even further back, past its own
 * name), but not a general guarantee against a PRECEDING candidate whose
 * OWN mention uses the opposite (`shareSupportedByQuote`) shape.
 *
 * `candidate_name_rule.ts`'s own caller keeps each claim's `quote`
 * narrowly bounded to that ONE candidate's own sentence/window at
 * extraction time — which rules out a WIDE quote naming a sibling
 * candidate reaching this function at all, but is NOT a general defense
 * against misattribution on its own: a real defect found reviewing that
 * caller (Tier 4b) had a narrow, single-candidate quote whose own number
 * had ALREADY been consumed by an adjacent, earlier forward claim in the
 * same sentence, and this check — seeing no sibling name to bound
 * against inside its own too-narrow quote — accepted the reused number
 * unconditionally. That specific hole is closed in
 * `candidate_name_rule.ts` itself (a "consumed-until" cursor spanning the
 * whole extraction pass, not something this function can see from one
 * claim's quote alone) — this function's own contract stays exactly what
 * it says above: correct within a single quote whose candidates share one
 * before-label ordering, and no more than that.
 */
export const shareSupportedByQuoteBeforeLabel = (
  label: string,
  value: number,
  quote: string,
  otherLabels: string[] = [],
): boolean => {
  const q = normalise(quote);
  const normLabel = normalise(label);
  const labelIdx = q.indexOf(normLabel);
  if (labelIdx === -1) return false;
  let boundary = 0;
  for (const other of otherLabels) {
    const normOther = normalise(other);
    if (!normOther || normOther === normLabel) continue;
    const idx = q.lastIndexOf(normOther, labelIdx);
    if (idx === -1) continue;
    const otherEnd = idx + normOther.length;
    if (otherEnd > boundary) boundary = otherEnd;
  }
  return numbersIn(q.slice(boundary, labelIdx)).some(
    (n) => n === value || Math.abs(n - value) <= Math.abs(value) * 1e-9,
  );
};

const groundingRefusal = (
  field: string,
  quote: string,
  docText: string,
): Refusal | null => {
  if (!quote || quote.trim() === "")
    return { field, reason: "no quote supplied", quote: "" };
  if (!isGroundedIn(quote, docText))
    return {
      field,
      reason:
        normalise(quote).length < MIN_QUOTE_CHARS
          ? `quote too short to be evidence (<${MIN_QUOTE_CHARS} chars after normalisation)`
          : "quote not found in the extracted text",
      quote,
    };
  return null;
};

/**
 * Gate a set of extracted shares against ONE document's text (article
 * text, a PDF's `pdftotext` output, or an OCR transcription — the caller
 * decides which; this function only cares that `docText` is the text the
 * quotes are supposed to occur in). Normalises `docText` once, not once
 * per share.
 */
export const gateShares = (
  claims: ShareClaim[],
  docText: string,
): GateResult<ShareClaim> => {
  const normalisedDoc = normalise(docText);
  const accepted: ShareClaim[] = [];
  const refused: Refusal[] = [];
  const allLabels = claims.map((c) => c.label);
  for (const c of claims) {
    const field = `share:${c.label}`;
    const groundingFail = groundingRefusal(field, c.quote, normalisedDoc);
    if (groundingFail) {
      refused.push(groundingFail);
      continue;
    }
    const otherLabels = allLabels.filter((l) => l !== c.label);
    if (!shareSupportedByQuote(c.label, c.value, c.quote, otherLabels)) {
      refused.push({
        field,
        reason: `the quote does not state ${c.value}% beside "${c.label}"`,
        quote: c.quote,
      });
      continue;
    }
    accepted.push(c);
  }
  return { accepted, refused };
};

/**
 * Same as `gateShares`, but accepts a claim whose quote states the value
 * EITHER before or after the label — `candidate_name_rule.ts`'s own
 * forward/backward extraction (Tier 4b) can produce either shape for a
 * candidate name, unlike the party-share prose `gateShares` was built
 * for, which is forward-only. Tries the forward check first (the common
 * case), then the backward one, and only refuses when neither holds.
 */
export const gateSharesEitherDirection = (
  claims: ShareClaim[],
  docText: string,
): GateResult<ShareClaim> => {
  const normalisedDoc = normalise(docText);
  const accepted: ShareClaim[] = [];
  const refused: Refusal[] = [];
  const allLabels = claims.map((c) => c.label);
  for (const c of claims) {
    const field = `share:${c.label}`;
    const groundingFail = groundingRefusal(field, c.quote, normalisedDoc);
    if (groundingFail) {
      refused.push(groundingFail);
      continue;
    }
    const otherLabels = allLabels.filter((l) => l !== c.label);
    if (
      !shareSupportedByQuote(c.label, c.value, c.quote, otherLabels) &&
      !shareSupportedByQuoteBeforeLabel(c.label, c.value, c.quote, otherLabels)
    ) {
      refused.push({
        field,
        reason: `the quote does not state ${c.value}% beside "${c.label}"`,
        quote: c.quote,
      });
      continue;
    }
    accepted.push(c);
  }
  return { accepted, refused };
};

/**
 * Gate the non-share fields (sample size, raw fieldwork text) the same
 * way — grounded, then the claim itself checked. A STRING value (the
 * fieldwork text) is supported by plain containment, matching
 * `enrich_gate.ts`'s own string-field rule; a NUMBER (sample size) by
 * `numbersIn`, exactly as `shareSupportedByQuote` does for a share, minus
 * the label requirement — a passport line like "Обем на извадката: 1000
 * души" states the field by its POSITION in the passport, not by needing
 * the word "sample" to co-occur with 1000 (which real passports do not
 * write in English at all).
 */
export const gateFields = (
  claims: FieldClaim[],
  docText: string,
): GateResult<FieldClaim> => {
  const normalisedDoc = normalise(docText);
  const accepted: FieldClaim[] = [];
  const refused: Refusal[] = [];
  for (const c of claims) {
    const groundingFail = groundingRefusal(c.field, c.quote, normalisedDoc);
    if (groundingFail) {
      refused.push(groundingFail);
      continue;
    }
    const value = c.value;
    const supported =
      typeof value === "string"
        ? normalise(c.quote).includes(normalise(value))
        : numbersIn(c.quote).some(
            (n) => n === value || Math.abs(n - value) <= Math.abs(value) * 1e-9,
          );
    if (!supported) {
      refused.push({
        field: c.field,
        reason:
          typeof c.value === "string"
            ? `the extracted text "${c.value}" does not appear in the quote that is supposed to support it`
            : `the quote does not state ${c.value}`,
        quote: c.quote,
      });
      continue;
    }
    accepted.push(c);
  }
  return { accepted, refused };
};
