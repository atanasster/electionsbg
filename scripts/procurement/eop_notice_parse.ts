// A5 — parse the rendered обявление/решение out of `TenderPublicationDetails[].HtmlPreview`.
// docs/plans/tender-dossier-ingest-v1.md §5 (A5), §1.2.
//
// ONE STRUCTURAL PARSER, TWO KEYING FAMILIES. The plan called for two parsers — an
// eForms BT-keyed one for 2024+ and a label parser for 2020–2023 — but the rendered
// form turns out to have the same shape in both eras:
//
//     <div class="label__name">  Правна категория на купувача(BT-11-Procedure-Buyer)</div>
//     <div class="name"> Публичноправна организация</div>
//
// The only difference is whether the label carries a `(BT-…)` code. So the parse is
// structural and shared, and the two families differ only in what you can KEY on:
//
//   2024+   ~100% of notices carry BT codes → key on the code, which is stable
//   2020-23 6–36% do → key on the Bulgarian label, which is not
//
// ⚠️ THE LEGACY TIER MUST STAY VISIBLY SPARSE. Its fields are keyed on human labels
// that the register rewords between form versions, so a miss is normal. Callers get
// `null` for "this notice does not expose that field", never a default that would
// read as "no award criteria" — the failure the plan explicitly warns about.
//
// The HTML is numeric-entity encoded (`&#1044;…`), so everything decodes first; a
// parser that skips that step matches nothing and reports 0% coverage on a corpus
// that is actually fully populated.

import { decodeEntities, stripHtml } from "../lib/html";

// Re-exported so the notice parser's own tests and callers have one import, and so
// that a future divergence has to be a deliberate edit here rather than a quiet
// private copy. The shared module is already correct on three things a private copy
// got wrong: it drops <script>/<style> BODIES (measured: 7.9% of a notice's text is
// CSS, which would otherwise land in the search index), it decodes `&amp;` LAST so
// an escaped entity survives, and it uses fromCodePoint rather than fromCharCode.
export { decodeEntities };

export interface NoticePair {
  /** Label with the code removed, e.g. "Правна категория на купувача". */
  label: string;
  /** eForms Business Term, e.g. "BT-11-Procedure-Buyer", or null in the legacy era. */
  code: string | null;
  value: string;
}

// `label__name` / `name` are the register's own class names. Matching on them rather
// than on document order is what keeps this robust to the wrapper markup changing.
const PAIR_RE =
  /<div\s+class="label__name">([\s\S]*?)<\/div>\s*<div\s+class="name">([\s\S]*?)<\/div>/g;

/** A trailing eForms code on a label.
 *
 * ⚠️ The `(a)` in `BT-67(a)-Procedure` is PART OF THE CODE, not a stray bracket.
 * Omitting it does not merely lose those fields — it demotes them to the legacy
 * tier AND leaves the raw code sitting in `label`, poisoning the only key that tier
 * has. Measured on the captured store: 7,936 pairs, 16.6% of all pairs, with
 * `BT-67(a)`/`BT-67(b)` the most frequent code family in the corpus at 2,814 each,
 * and `BT-131(d)`/`BT-131(t)` — the offer deadline the risk signals need — at 331.
 *
 * ⚠️ NOT end-anchored. The code is usually last, but not always: the register emits
 * `Идентификатор на раздела(BT-13716-notice) - формат LOT-XXXX`, where a `\s*$`
 * anchor misses the code and leaves it embedded in the label. Matching anywhere is
 * safe here because this is applied to LABELS only — a code quoted inside a value is
 * never fed to it. */
const CODE_RE =
  /\((?<code>(?:BT|OPT|OPP)-[0-9]+(?:\([a-z]\))?[a-z]?-[A-Za-z-]+)\)/;

/**
 * Every label/value pair in one `HtmlPreview`, in document order.
 *
 * Pairs with an empty value are dropped: the form renders a great many optional
 * rows blank, and keeping them would make "the field is present but empty" and
 * "the field was answered" indistinguishable downstream.
 */
export const parseNoticePairs = (htmlPreview: string): NoticePair[] => {
  // Decode BEFORE matching: the register emits `&#1044;…`, and the class-name
  // anchors are ASCII either way, but the label/value payloads are not.
  const html = decodeEntities(htmlPreview);
  const out: NoticePair[] = [];
  for (const m of html.matchAll(PAIR_RE)) {
    const rawLabel = stripHtml(m[1]);
    const value = stripHtml(m[2]);
    if (!value) continue;
    const code = rawLabel.match(CODE_RE)?.groups?.code ?? null;
    const label = (code ? rawLabel.replace(CODE_RE, " ") : rawLabel)
      .replace(/\s+/g, " ")
      .replace(/[-:\s]+$/, "")
      .trim();
    out.push({ label, code, value });
  }
  return out;
};

/** Plain text of the whole notice — the search-index payload, and the fallback for
 *  everything the structured parse does not expose. */
export const noticeText = (htmlPreview: string): string =>
  stripHtml(htmlPreview);

/**
 * First value for a BT code. Returns null rather than "" so a caller can tell
 * "not exposed by this notice" from "exposed and blank".
 */
export const btValue = (pairs: NoticePair[], code: string): string | null =>
  pairs.find((p) => p.code === code)?.value ?? null;

/** Every value for a code — award criteria and selection criteria repeat per lot. */
export const btValues = (pairs: NoticePair[], code: string): string[] =>
  pairs.filter((p) => p.code === code).map((p) => p.value);

export interface NoticeFields {
  /** True when this notice carries eForms codes at all — the 2024+ tier. */
  isEforms: boolean;
  /** How many distinct BT codes it exposes; 0 for a legacy notice. */
  btCount: number;
  buyerLegalCategory: string | null; // BT-11
  buyerActivity: string | null; // BT-10
  buyerProfileUrl: string | null; // BT-508
  procedureTitle: string | null; // BT-21
  procedureDescription: string | null; // BT-24
  /** Award criterion TYPES, one per criterion per lot (BT-539). "Цена" alone on a
   *  works tender is the price-only signal the plan's A9 asks for. */
  awardCriteriaTypes: string[];
  awardCriteriaNames: string[]; // BT-734
  selectionCriteria: string[]; // BT-809
  /**
   * Contract duration as a BARE NUMBER — `"60"`, `"90"`, `"24"` — with NO unit.
   *
   * ⚠️ THE UNIT IS NOT RECOVERABLE FROM THIS PARSE, and the name says so. The
   * register prints `Ден`/`Месец`/`Година` in a SEPARATE row that carries no
   * `label__name` sibling, so the label/value structure this module keys on cannot
   * emit it — it is absent from the parse entirely, not merely unattached.
   *
   * So a consumer must never render this as days, months, or a comparison between
   * two tenders: `60` may be days on one procedure and months on the next. An
   * earlier revision of this field claimed values like `"24 Месец"` and was tested
   * against that shape; it occurs in ZERO real notices.
   */
  durationValue: string | null; // BT-36-Lot
  /** Offer deadline date and time, from the parenthesised codes the first CODE_RE
   *  silently dropped. Feeds the "short offer window vs value" risk signal. */
  offerDeadlineDate: string | null; // BT-131(d)-Lot
  offerDeadlineTime: string | null; // BT-131(t)-Lot
}

/**
 * The subset of fields the dossier surfaces and the risk signals need.
 *
 * Every field is nullable/empty-able by design. On a legacy notice almost all of
 * them are null, and that is the honest answer — see the header.
 */
export const noticeFields = (pairs: NoticePair[]): NoticeFields => {
  const codes = new Set(pairs.map((p) => p.code).filter(Boolean) as string[]);
  return {
    isEforms: codes.size > 0,
    btCount: codes.size,
    buyerLegalCategory: btValue(pairs, "BT-11-Procedure-Buyer"),
    buyerActivity: btValue(pairs, "BT-10-Procedure-Buyer"),
    buyerProfileUrl: btValue(pairs, "BT-508-Procedure-Buyer"),
    procedureTitle: btValue(pairs, "BT-21-Procedure"),
    procedureDescription: btValue(pairs, "BT-24-Procedure"),
    awardCriteriaTypes: btValues(pairs, "BT-539-Lot"),
    awardCriteriaNames: btValues(pairs, "BT-734-Lot"),
    selectionCriteria: btValues(pairs, "BT-809-Lot"),
    durationValue: btValue(pairs, "BT-36-Lot"),
    offerDeadlineDate: btValue(pairs, "BT-131(d)-Lot"),
    offerDeadlineTime: btValue(pairs, "BT-131(t)-Lot"),
  };
};

/**
 * Is this procedure awarded on price alone?
 *
 * Returns null when the notice does not expose award criteria at all — which is the
 * whole legacy tier. ⚠️ Null must never be rendered as "no", or every 2020–2023
 * procedure would read as multi-criteria; that is the plan's stated failure mode for
 * this tier, and the reason the signal is tri-state.
 */
export const isPriceOnly = (f: NoticeFields): boolean | null => {
  if (!f.awardCriteriaTypes.length) return null;
  return f.awardCriteriaTypes.every((t) => /^\s*цена\s*$/i.test(t));
};
