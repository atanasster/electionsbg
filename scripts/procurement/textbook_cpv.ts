// Shared textbook-CPV derivation.
//
// Textbook procurement (CPV 22112 „Учебници") is the денominator of the МОН
// textbook-market view and is legally single-source (чл.79 ал.1 т.3 ЗОП — awarded
// to the sole copyright holder), so the risk model must not flag it as a
// single-bidder red flag. But two of our feeds carry NO CPV: the pre-ЦАИС РОП
// register (normalize_rop) and the legacy annual CSVs (2011–19), whose CPV is
// only ever backfilled by the eop_field_map content-join — which finds nothing
// for pre-2020 rows (the ЦАИС flat feed starts 2020). Those years' textbook
// contracts therefore vanish from the market.
//
// The subject text is unambiguous where the CPV is absent, so we derive CPV
// 22112 from it as a LAST-RESORT gap-fill: applied only when a row still has no
// CPV after every real source. Never overrides a real CPV (a textbook-subject
// row that legitimately carries 22470/22472/22111 keeps it). Kept in one place
// so normalize_rop and eop_field_map stay in lock-step.

// „учебник(ци)", „учебни помагала/комплекти", „познавателни книжки" — the standard
// phrasings of a textbook supply. Deliberately NOT „учебна/учебен" (educational
// building/hall/programme), which is not a book purchase.
export const TEXTBOOK_SUBJECT =
  /учебник|учебни\s+помагала|учебни\s+комплекти|познавателни\s+книжки/i;

// Full 8-digit CPV so `left(cpv,5)='22112'` and `cpv LIKE '22112%'` both match,
// matching the real 22112000-8 that OCDS/EOP rows carry.
export const TEXTBOOK_CPV = "22112000";

// Returns the derived textbook CPV iff the subject looks like a textbook supply,
// else undefined. Caller applies it ONLY when the row has no CPV already.
export const deriveTextbookCpv = (
  subject: string | undefined,
): string | undefined =>
  subject && TEXTBOOK_SUBJECT.test(subject) ? TEXTBOOK_CPV : undefined;
