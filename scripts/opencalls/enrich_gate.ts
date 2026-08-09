// Stage 7, step 3 — the deterministic grounding gate.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THIS FILE IS THE GUARANTEE, and it has TWO halves. Everything upstream of it is a language
// model reading a PDF. `project_ai_chat_grounding_gate` is the precedent: the model proposes, a
// mechanical check disposes, and a field that fails is DROPPED rather than trusted.
//
//   1. THE CITATION — `isGrounded`: the quote occurs in the document, as a plain
//      whitespace-normalised substring.
//   2. THE CLAIM — `valueSupportedByQuote`: the quote actually states the value.
//
// The second half was missing from the first draft and the omission is worth naming, because it
// looks complete without it: a fabricated `budget_eur: 999 000 000` attached to a real, unrelated
// sentence from the document passed with no rejection, and so did a 100× magnitude error
// (`aid_rate_pct: 0.6` cited from „…60 %…"). Checking the citation is not checking the claim.
//
// WHAT NEITHER HALF CAN DO: judge whether the quoted sentence is the RIGHT one — a document's
// „максимален размер" for a sub-component quoted against the whole procedure's budget is a real
// number, correctly attributed, and still wrong. That is what the human `--promote` step is for,
// and why `auto` may not reach a money column.
//
// The corollary is the rule that keeps this honest: NEVER relax a check to make an extraction
// pass. If a real quote fails, the normaliser is wrong and the normaliser is what changes — not
// the threshold, and never the direction of the comparison.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// WHY A SUBSTRING CHECK AND NOT A FUZZY ONE. Fuzzy matching would accept a quote the model
// paraphrased, which is precisely the failure mode: a paraphrase is the model's words presented
// as the document's. The only normalisation applied is the kind a PDF extractor legitimately
// introduces — collapsed whitespace, hyphenation at a line break, the several dash and quote
// characters Word emits — and each is justified where it is applied.
//
// THE CURRENCY RULE IS PART OF THE GATE, not a later step. A figure can be quoted perfectly and
// still be wrong: Bulgaria adopted the euro on 2026-01-01, and every older document states
// levs. A quote saying „5 000 лв." that arrives as `budget_eur: 5000` is a grounded lie, and it
// is the single most likely way a wrong number gets through — the quote check passes, because
// the quote is real.

import { BGN_PER_EUR } from "../../src/lib/currency";

/** One extracted field: the value the model proposes, and the span it says supports it. */
export interface Claim {
  value: number | string;
  quote: string;
}

export interface Extraction {
  budget_eur?: Claim;
  aid_rate_pct?: Claim;
  grant_min_eur?: Claim;
  grant_max_eur?: Claim;
  beneficiaries?: Claim;
  /** Derived from `beneficiaries`, so it is only kept when that field survives the gate. */
  audience?: string[];
}

export interface Rejection {
  field: string;
  reason: string;
  quote: string;
}

export interface GateResult {
  /** Only the fields whose quote was found AND whose currency is consistent. */
  accepted: Extraction;
  /** Everything dropped, with the reason — reported, never silently discarded. */
  rejected: Rejection[];
  /** ACCEPTED euro fields whose quote names no currency at all. Not a rejection — the
   *  surrounding document is often unambiguous — but on a corpus measured at 3-of-4
   *  lev-denominated, „no unit stated" is the likeliest place a lev figure slips through as
   *  euro, and the human promoting it must see that rather than infer it. */
  unitUnstated: string[];
}

// The peg is `src/lib/currency.ts`'s, not a fourth copy of the literal — it is used here only to
// print the rate in a rejection message, and a rejection telling someone to convert at a number
// that disagrees with the rest of the site would be its own small defect.
export { BGN_PER_EUR };

/**
 * Fold the differences a text extractor introduces, and nothing else.
 *
 * Each rule is here because a real document needs it:
 *  - WHITESPACE: `pdftotext` breaks lines mid-sentence and Word emits non-breaking and narrow
 *    spaces inside numbers („5 000 лв."), so a quote copied from rendered text never matches
 *    byte-for-byte.
 *  - HYPHENATION: a PDF hyphenates across a line break („кандидат-\nстване"), which no human
 *    quoting the sentence would reproduce.
 *  - DASHES AND QUOTES: Word substitutes –, —, „, ", ", ' for their ASCII forms, inconsistently
 *    between the document and anything retyped from it.
 * Case is folded too: a heading quoted from body text differs only in case surprisingly often.
 */
export const normalise = (s: string): string =>
  s
    // Join a hyphenated line break BEFORE collapsing whitespace, or the newline is already gone.
    .replace(/[-‐‑]\s*\n\s*/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

/**
 * A quote too short to be evidence. „5 000" occurs in any long document by accident, so a match
 * would prove nothing — and the model can always quote the sentence around a figure.
 *
 * One constant because the floor is asserted in three places (here, the rejection reason, and
 * the worksheet's instructions) and a floor that disagrees with the message explaining it is
 * worse than no floor.
 */
export const MIN_QUOTE_CHARS = 12;

/** As `isGrounded`, but against an ALREADY-normalised document — so a 150 KB text is folded
 *  once per procedure rather than once per field. */
export const isGroundedIn = (quote: string, normalisedDoc: string): boolean => {
  const q = normalise(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalisedDoc.includes(q);
};

/** Is this quote genuinely in the document? Half of the guarantee. */
export const isGrounded = (quote: string, docText: string): boolean =>
  isGroundedIn(quote, normalise(docText));

/**
 * Every number a Bulgarian document could be read as stating in this span.
 *
 * Deliberately GENEROUS — it returns every plausible reading, and the caller accepts the value
 * if ANY of them matches. Over-generating costs a false accept only when the document happens to
 * contain the fabricated number too; under-generating rejects honest extractions, which is the
 * failure that leads someone to weaken the gate. The formats are what the corpus actually holds:
 *
 *   „91 072 240 лв."     space (and NBSP, and narrow NBSP) as the thousands separator
 *   „127 000 000 евро"   the same, wider
 *   „12,5 %"             comma as the DECIMAL separator — the Bulgarian convention
 *   „150.000"            ambiguous: 150000 (European thousands) or 150.0. BOTH are returned.
 *   „1,5 млн. лв."       a multiplier word after the number
 */
export const numbersIn = (quote: string): number[] => {
  const out: number[] = [];
  const text = normalise(quote);
  // A digit run that may carry space/dot/comma separators, plus whatever word follows it.
  const re =
    /(\d[\d.,\s\u00a0\u202f]*)\s*(млрд|млн|хил|billion|million|thousand)?/gu;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/[\s\u00a0\u202f]/g, "").replace(/[.,]$/, "");
    if (!raw) continue;
    const mult =
      m[2] === "млрд" || m[2] === "billion"
        ? 1e9
        : m[2] === "млн" || m[2] === "million"
          ? 1e6
          : m[2] === "хил" || m[2] === "thousand"
            ? 1e3
            : 1;
    // Reading A: separators are thousands marks.
    const a = Number(raw.replace(/[.,]/g, ""));
    if (Number.isFinite(a)) out.push(a * mult);
    // Reading B: the LAST separator is a decimal point. „12,5" → 12.5, „150.000" → 150.
    const lastSep = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
    if (lastSep > 0) {
      const b = Number(
        raw.slice(0, lastSep).replace(/[.,]/g, "") +
          "." +
          raw.slice(lastSep + 1),
      );
      if (Number.isFinite(b)) out.push(b * mult);
    }
  }
  return out;
};

/**
 * Does the QUOTE actually support the VALUE? The other half of the guarantee.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WITHOUT THIS, THE GATE CHECKS THE CITATION AND NOT THE CLAIM. Found in review, reproduced:
 * `budget_eur: 999_000_000` attached to a real, unrelated sentence from the document was
 * accepted with no rejection at all, and `aid_rate_pct: 0.6` quoted from „…60 %…" — a 100×
 * magnitude error — passed identically. Both are exactly the shape a model produces when it
 * summarises from memory and then goes looking for a sentence to cite.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * For a STRING field the analogue is containment: the extracted phrase must appear in the span
 * it cites, so „МСП" cannot be attributed to a sentence about municipalities.
 */
export const valueSupportedByQuote = (
  value: number | string,
  quote: string,
): boolean => {
  if (typeof value === "string") {
    const v = normalise(value);
    return v.length > 0 && normalise(quote).includes(v);
  }
  // Exact for integers; a relative epsilon for the rare decimal rate, since 12.5 reconstructed
  // from „12,5" is not bit-identical to a literal 12.5 in every path.
  return numbersIn(quote).some(
    (n) => n === value || Math.abs(n - value) <= Math.abs(value) * 1e-9,
  );
};

/**
 * Does the quote name a currency that contradicts the field it supports?
 *
 * Returns the offending unit, or null when the quote is consistent (or names no currency at all,
 * which is common and is not by itself a reason to reject — the surrounding document may be
 * unambiguously in one unit).
 */
export const currencyConflict = (quote: string): "bgn" | null => {
  const q = normalise(quote);
  // „лв.", „лева", „BGN". Word-boundary-ish: „лв" alone appears inside other words rarely enough,
  // but the dot/space forms are what documents actually write.
  const saysBgn = /(^|[^\p{L}])(лв\.?|лева|bgn)([^\p{L}]|$)/u.test(q);
  const saysEur = /(^|[^\p{L}])(евро|eur|€)([^\p{L}]|$)/u.test(q);
  // Both present is a conversion sentence („5 000 лв. (2 556 евро)") and is fine — the model is
  // expected to take the euro figure, and the check cannot tell which without parsing. Only an
  // unambiguously-lev quote on a `_eur` field is a conflict.
  return saysBgn && !saysEur ? "bgn" : null;
};

const EUR_FIELDS = new Set(["budget_eur", "grant_min_eur", "grant_max_eur"]);

/**
 * Run the gate. Nothing is stored that does not come back in `accepted`.
 *
 * @param ex       what the model proposed
 * @param docText  the text actually extracted from the document
 */
export const runGate = (ex: Extraction, docText: string): GateResult => {
  // Normalised ONCE. A 150 KB „Условия за кандидатстване" was being re-folded for every field,
  // five times per procedure, for an identical result.
  const normalisedDoc = normalise(docText);
  const accepted: Extraction = {};
  const rejected: Rejection[] = [];
  const unitUnstated: string[] = [];

  const check = (field: keyof Extraction, claim: Claim | undefined) => {
    if (!claim) return;
    if (typeof claim.quote !== "string" || claim.quote.trim() === "") {
      rejected.push({ field, reason: "no quote supplied", quote: "" });
      return;
    }
    if (!isGroundedIn(claim.quote, normalisedDoc)) {
      rejected.push({
        field,
        reason:
          normalise(claim.quote).length < MIN_QUOTE_CHARS
            ? `quote too short to be evidence (<${MIN_QUOTE_CHARS} chars after normalisation)`
            : "quote not found in the document",
        quote: claim.quote,
      });
      return;
    }
    if (EUR_FIELDS.has(field) && currencyConflict(claim.quote) === "bgn") {
      rejected.push({
        field,
        reason:
          `the quote states levs but the field is euro — convert at ${BGN_PER_EUR} ` +
          "or quote the euro figure; a correctly-quoted lev number stored as euro is a grounded lie",
        quote: claim.quote,
      });
      return;
    }
    if (
      (field === "aid_rate_pct" || EUR_FIELDS.has(field)) &&
      (typeof claim.value !== "number" ||
        !Number.isFinite(claim.value) ||
        claim.value < 0)
    ) {
      rejected.push({
        field,
        reason: `numeric field carries a non-numeric or negative value (${String(claim.value)})`,
        quote: claim.quote,
      });
      return;
    }
    if (field === "aid_rate_pct" && (claim.value as number) > 100) {
      rejected.push({
        field,
        reason: `aid rate above 100% (${String(claim.value)}) — probably a lev amount read as a percentage`,
        quote: claim.quote,
      });
      return;
    }
    // THE CLAIM, not just the citation. A real quote with a fabricated number attached is the
    // shape a model produces when it answers from memory and then hunts for a sentence to cite.
    if (!valueSupportedByQuote(claim.value, claim.quote)) {
      rejected.push({
        field,
        reason:
          typeof claim.value === "number"
            ? `the quote does not state ${claim.value} — it states ${
                numbersIn(claim.quote).length
                  ? numbersIn(claim.quote).slice(0, 4).join(", ")
                  : "no number at all"
              }`
            : "the extracted text does not appear in the quote that is supposed to support it",
        quote: claim.quote,
      });
      return;
    }
    if (
      EUR_FIELDS.has(field) &&
      !/(^|[^\p{L}])(евро|eur|€)([^\p{L}]|$)/u.test(normalise(claim.quote))
    )
      unitUnstated.push(field);
    (accepted as Record<string, Claim>)[field] = claim;
  };

  check("budget_eur", ex.budget_eur);
  check("aid_rate_pct", ex.aid_rate_pct);
  check("grant_min_eur", ex.grant_min_eur);
  check("grant_max_eur", ex.grant_max_eur);
  check("beneficiaries", ex.beneficiaries);

  // A min above a max is not a quoting failure — both quotes can be real — so it is caught here
  // rather than in `check`, and BOTH are dropped: there is no way to tell which one is wrong.
  const lo = accepted.grant_min_eur?.value;
  const hi = accepted.grant_max_eur?.value;
  if (typeof lo === "number" && typeof hi === "number" && lo > hi) {
    rejected.push({
      field: "grant_min_eur",
      reason: `min (${lo}) exceeds max (${hi}) — both dropped, since either could be the wrong one`,
      quote: accepted.grant_min_eur!.quote,
    });
    rejected.push({
      field: "grant_max_eur",
      reason: `max (${hi}) below min (${lo}) — both dropped`,
      quote: accepted.grant_max_eur!.quote,
    });
    delete accepted.grant_min_eur;
    delete accepted.grant_max_eur;
    // …and their warnings with them: a warning about a field that is no longer accepted would
    // send the reviewer looking for a value that is not there.
    for (const f of ["grant_min_eur", "grant_max_eur"]) {
      const i = unitUnstated.indexOf(f);
      if (i >= 0) unitUnstated.splice(i, 1);
    }
  }

  // `audience` is DERIVED from the eligibility text, so it survives only if that text did. An
  // audience with no surviving basis is the model's inference presented as the document's.
  if (ex.audience?.length && accepted.beneficiaries)
    accepted.audience = ex.audience;
  else if (ex.audience?.length)
    rejected.push({
      field: "audience",
      reason: "derived from `beneficiaries`, which did not survive the gate",
      quote: "",
    });

  return { accepted, rejected, unitUnstated };
};
