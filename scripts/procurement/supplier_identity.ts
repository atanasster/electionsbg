// Supplier identity classification — what KIND of thing a `supplierRegisterNumber`
// token is, before anything tries to use it as a company key.
//
// WHY THIS EXISTS. Both normalizers used to ask only one question of a supplier id:
// "does it pass isValidEik?" That question cannot distinguish a company registration
// number from a PERSONAL one. `canonicalEik` passes any 10-digit value through
// unchanged and `isValidEik` accepts 9–13 digits, so a natural person's ЕГН landed in
// `contracts.contractor_eik` verbatim — 98 distinct checksum-valid ЕГН across 148 rows,
// each next to the person's full name, served by the contracts table and the company
// API and mirrored to Cloud SQL by the ordinary loaders. That is published personal
// data, and no amount of downstream filtering fixes it: the id must never become a key
// in the first place.
//
// THE KEY FOR A NATURAL PERSON IS DERIVED FROM THEIR NAME, NOT THEIR ЕГН.
// `np-<hashKey(normalised name)>` — the same shape as the `obed-…` synthetic consortium
// carriers in 087. Two alternatives were rejected:
//   - hashing the ЕГН UNSALTED: a 10-digit space is 10^10, brute-forceable in
//     milliseconds, so the hash still *is* the ЕГН;
//   - hashing it with a secret salt: keys would stop being reproducible across
//     machines, which breaks the determinism that `contentKeys()` and the .data.test
//     gates depend on.
// The name is already published in `contractor_name`, so a name-derived key discloses
// nothing new. The scheme is lossy in BOTH directions and both losses are accepted:
//   - two same-named people collide into one key — strictly better than the status quo,
//     where placeholder ids pooled 20 unrelated people under one identity;
//   - one person spelled two ways fragments into two keys. Measured on the corpus: 98
//     ЕГН produced 103 keys, so ~5 people carry a second spelling (a leading "ЗП "
//     trade-title is the common cause, and normaliseOrgName does not strip it).
// Fragmentation understates an individual's total; it never merges strangers and never
// discloses an identity number, which is the property that matters here.
//
// WHAT THIS DELIBERATELY DOES *NOT* DO. It does not try to separate a foreign numeric
// registry id from a real Bulgarian EIK. `canonicalEik` zero-pads 5–8 digit ids to nine
// and slices 13-digit ids, so 336 rows carry a foreign id minted into BG EIK space
// (ХИЛ Интернешънал `50919679` → `050919679`, ХАБАУ `13092995` → `013092995`). There is
// no reliable offline signal for that: `supplierNutsCode` is absent on 16,088 records
// and misaligned often enough to be dangerous — СТРОЙКО - 2002 ЕООД, ППК Труд and
// ЖИВАС ООД all carry a `BE` code and are all real Bulgarian companies. Guessing there
// would re-key genuine BG firms as foreign. See docs/plans/
// procurement-foreign-consortium-members-v1.md, defect D-3.

import { canonicalEik, isValidEik, isPlaceholderId } from "./eik";
import { hashKey } from "./contract_key";
import { normaliseOrgName } from "../lib/normalize_name";

export type SupplierIdKind =
  // A validated Bulgarian company EIK (9- or 13-digit, or a recovered messy form).
  | "bg"
  // A natural person: an ЕГН, or a 10-digit near-miss standing next to a personal
  // name. Keyed by name; the source id is discarded and never stored.
  | "person"
  // A non-BG registry id (letters and/or punctuation, e.g. `RO6640696`).
  | "foreign"
  // The source withheld the identity ("не се публикува") or the token is empty.
  | "anonymous"
  // The token is FILLER, not an identity — `000000001`, `999999999`, `1234567899`.
  // Keyed by name, like `person`; the filler is discarded and never stored.
  | "placeholder";

export interface ResolvedSupplier {
  /** The key to store. Empty string means "no contractor identity". */
  eik: string;
  kind: SupplierIdKind;
  /**
   * Retained for the existing call sites, which branch on it. True for anything
   * that is not a validated BG EIK — including `person`, whose key is synthetic.
   */
  foreign: boolean;
}

// Unpublished / anonymised supplier markers — the source hides some suppliers
// (protected natural persons). Keep the row (its value lands on the buyer) but with
// no contractor identity.
export const UNPUBLISHED_SUPPLIER =
  /^(—+|-+|не се публикува|няма( данни)?|неизвестен|н\/?д|n\.?\/?a\.?)$/i;

// ЕГН checksum weights (мод-11 over the first 9 digits; remainder 10 ⇒ check digit 0).
const EGN_WEIGHTS = [2, 4, 8, 5, 10, 9, 7, 3, 6];

/**
 * True for a syntactically valid Bulgarian ЕГН: exactly 10 digits, a decodable
 * YYMMDD (month +20 for 19th-century births, +40 for 21st-century), and a correct
 * mod-11 check digit.
 *
 * Measured against the live corpus: 98 distinct `contractor_eik` values pass, and
 * ZERO of them is a company in `tr_companies`. In fact `tr_companies` holds no
 * 10-digit `uic` at all, which is why `canonicalEik`'s "some EIKs are 10 digits
 * (rare, e.g. older BULSTAT)" premise cannot be relied on to keep them apart.
 */
export const isEgn = (raw: string | undefined): boolean => {
  const s = (raw ?? "").trim();
  if (!/^\d{10}$/.test(s)) return false;
  let month = Number(s.slice(2, 4));
  if (month > 40) month -= 40;
  else if (month > 20) month -= 20;
  const day = Number(s.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const sum = EGN_WEIGHTS.reduce((a, w, i) => a + w * Number(s[i]), 0);
  const check = sum % 11 === 10 ? 0 : sum % 11;
  return check === Number(s[9]);
};

// NO POSITIVE NAME-SHAPE HEURISTIC. An earlier draft also treated a 10-digit id that
// FAILS the ЕГН checksum as personal when it sat next to a "personal-looking" name, to
// catch what look like mistyped or masked ЕГН. Its own unit test killed it: "Капш
// Телематик Сървисис" is three capitalised Cyrillic words with no legal-form token, so
// every transliterated foreign company name matched and real companies were re-keyed as
// people. That was the fourth general discriminator to misfire on this data — after
// `supplierNutsCode` (re-keys real BG firms as Belgian), digit entropy (21 real EIKs
// have ≤2 distinct digits) and "an id shared by many names" (real suppliers carry 20+
// spelling variants).
//
// A NEGATIVE one IS used, and it is not the same gamble. The ЕГН checksum is mod-11, so
// roughly one in eleven arbitrary 10-digit numbers passes it — a foreign registry id can
// pass by coincidence. `EVIG Mérnök Vállalkozói Kft` (Hungarian, `0109065346`) does
// exactly that and was re-keyed as a person. Excluding names that carry an explicit
// LEGAL-FORM token is high precision in the safe direction: a company that declares
// itself a Kft / GmbH / ООД is not a natural person, while a real person's name never
// carries one. Note this is why the earlier measurement looked clean — it validated the
// 98 ids against `tr_companies`, which holds only Bulgarian companies and so is
// structurally incapable of surfacing a foreign false positive.
//
// Residual, knowingly left alone: ids that are 10 digits, FAIL the checksum, and sit
// beside a personal name. They are not confirmed personal numbers — an invalid checksum
// means a placeholder, a typo, or a foreign id, and we cannot tell which. Defect D-3.
const LEGAL_FORM =
  /(\bЕООД\b|\bООД\b|\bЕАД\b|\bАД\b|\bЕТ\b|\bДЗЗД\b|\bКД\b|\bСД\b|сдружение|фондация|кооперация|община|министерство|университет|болница|\bLTD\b|\bGMBH\b|\bS\.?P\.?A\b|\bSRL\b|\bS\.?A\b|\bKFT\b|\bD\.?O\.?O\b|\bSP\.? ?Z\b|\bINC\b|\bN\.?V\b|\bB\.?V\b|\bA\.?S\b|\bLLC\b|\bPLC\b|\bS\.?R\.?O\b|\bZOO\b|\bOY\b|\bAB\b|\bAS\b)/iu;

/**
 * True when the name declares a legal form, i.e. the supplier is an organisation.
 *
 * Exported because the standing privacy gate must apply the SAME exclusion: an id that
 * passes the ЕГН checksum next to a "… Kft" is a coincidence, not personal data, and a
 * gate that flagged it would disagree with the classifier and never go green.
 */
export const isOrganisationName = (name: string | undefined): boolean =>
  LEGAL_FORM.test((name ?? "").trim());

/**
 * True when the (id, name) pair should be treated as a natural person — the single
 * predicate shared by the classifier and the privacy gate, so the two cannot drift.
 * Accepts a separator-bearing id.
 */
export const isPersonalSupplier = (
  rawId: string | undefined,
  name?: string,
): boolean => {
  const s = (rawId ?? "").trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, "");
  return (isEgn(s) || isEgn(digits)) && !isOrganisationName(name);
};

/**
 * The stable key for a natural-person supplier: `np-` + 12 hex of sha256 over the
 * normalised name. Returns "" when there is no usable name, which leaves the row
 * with no contractor identity (same as an `anonymous` supplier).
 */
export const personSupplierKey = (name: string | undefined): string => {
  const norm = normaliseOrgName(name ?? "")
    .toLocaleLowerCase("bg")
    .replace(/\s+/g, " ")
    .trim();
  return norm ? `np-${hashKey(norm)}` : "";
};

/**
 * The stable key for a supplier whose id was FILLER: `ph-` + 12 hex of sha256 over
 * the normalised name. Returns "" when there is no usable name, which leaves the
 * row with no contractor identity (same as `anonymous`).
 *
 * WHY A NAME KEY RATHER THAN NOTHING. Dropping the id would be simpler and is the
 * wrong trade: Elsevier's €32.8M is real, attributable money and the vendor is
 * named on every row. The argument is the one `personSupplierKey` already makes —
 * the name is published in `contractor_name` anyway, so a name-derived key
 * discloses nothing new, and it is lossy in both directions in the SAFE direction:
 * two identically-named suppliers collide (strictly better than the status quo,
 * where nine unrelated ones pooled under `000000001`), and one supplier spelled two
 * ways fragments (understates a total; never merges strangers).
 *
 * A SEPARATE PREFIX FROM `np-` ON PURPOSE. `np-` asserts "this is a natural person,
 * established from a valid ЕГН". Here nothing was established at all — the id was
 * junk. Many of these ARE people (`1234567899` alone carried 22 individuals), but
 * inferring that from the name is the heuristic this module's header records as
 * having already misfired once.
 */
export const placeholderSupplierKey = (name: string | undefined): string => {
  const norm = normaliseOrgName(name ?? "")
    .toLocaleLowerCase("bg")
    .replace(/\s+/g, " ")
    .trim();
  return norm ? `ph-${hashKey(norm)}` : "";
};

/**
 * Classify one `supplierRegisterNumber` token, given the aligned `supplierName`.
 *
 * ORDER MATTERS. The personal-id test runs BEFORE the BG-EIK test, because an ЕГН
 * passes `isValidEik` — putting the EIK check first is exactly how the leak happened.
 */
export const classifySupplierId = (
  raw: string | undefined,
  name?: string,
): ResolvedSupplier => {
  const s = (raw ?? "").trim();
  if (!s || UNPUBLISHED_SUPPLIER.test(s)) {
    return { eik: "", kind: "anonymous", foreign: true };
  }
  // (1) Filler ids — never stored, keyed by name instead.
  //
  // BEFORE the personal test. The two rule sets are DISJOINT today — no filler
  // value passes the ЕГН checksum, asserted in the test — so the order changes
  // nothing right now and is defensive rather than load-bearing. It is written this
  // way because roughly one in eleven arbitrary 10-digit numbers passes mod-11, so a
  // future denylist entry could land in ЕГН space; if it did, `np-` would assert an
  // ЕГН was found where the id is simply junk, putting a false provenance on a key
  // that both branches would otherwise derive identically from the name.
  // Tested against the digits-only form as well, for the reason step (2) below
  // already documents: the feed publishes separator-grouped numbers ("827 184 123"),
  // so "000 000 001" would otherwise skip every branch and land in the foreign
  // fallback — which stores it verbatim and pools Elsevier, Vier Gas and Clarivate
  // back under one key, i.e. the exact defect this branch exists to end. Latent
  // today (no such token in the current feed) but the shape is published.
  if (isPlaceholderId(s) || isPlaceholderId(s.replace(/[\s-]/g, ""))) {
    return {
      eik: placeholderSupplierKey(name),
      kind: "placeholder",
      foreign: true,
    };
  }
  // (2) Personal identity numbers — never stored, keyed by name instead.
  //
  // Tested against BOTH the raw token and its digits-only form. The raw-only test leaked:
  // a 10-digit run carrying any separator or prefix ("620 731 6703", "ЕГН 6207316703",
  // "6207316703-") is not matched by step 3, which deliberately recognises only exact
  // 9- or 13-digit runs, so it fell through to the foreign fallback — which strips
  // non-alphanumerics and stored the bare ЕГН, i.e. exactly the pre-fix state. The feed
  // demonstrably publishes separator-grouped numbers (step 3 exists to recover
  // "827 184 123"), so this was reachable, not hypothetical.
  //
  // Widening only the PERSONAL test is the fail-safe direction: a false positive here
  // costs one organisation a name-derived key, a false negative publishes an ЕГН.
  if (isPersonalSupplier(s, name)) {
    return { eik: personSupplierKey(name), kind: "person", foreign: true };
  }
  // (3) A clean BG EIK.
  const canon = canonicalEik(s);
  if (isValidEik(canon)) return { eik: canon, kind: "bg", foreign: false };
  // (4) A BG EIK embedded in a messy id ("BG104529087", "ЕИК 205994492",
  // space-grouped "827 184 123"). Requiring an exact 9/13-digit run avoids
  // mis-reading a foreign id that only looks numeric once separators are stripped.
  const stripped = s.replace(/\s+/g, "").replace(/^(ЕИК|BG|EIK)/i, "");
  if (/^(\d{9}|\d{13})$/.test(stripped)) {
    const c = canonicalEik(stripped);
    if (isValidEik(c)) return { eik: c, kind: "bg", foreign: false };
  }
  // (5) A genuine foreign vendor — keyed by a normalized registration id.
  const norm = s
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 24);
  return { eik: norm, kind: "foreign", foreign: true };
};
