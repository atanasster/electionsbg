// ДФ „Земеделие" publishes beneficiary names cut at 35 characters — every egov
// year sheet AND the СЕУ register, so no year carries the full form. Measured
// 2026-10-13: the max name length is exactly 35 in all eight years, and 35-char
// names outnumber 34-char ones ~5:1, so a 35-char name is almost always a cut
// one („Фонд мениджър на финансови инструме" for EIK 203740812).
//
// The fix is EIK-keyed: the Commerce Registry name of the SAME EIK replaces the
// cut one, but ONLY when it provably extends it — the ДФЗ text, folded to
// letters+digits, must be a strict prefix of the registry name's fold. ДФЗ drops
// quotes and hyphens the registry keeps, hence the fold. Anything else is left
// as published: a registry name that differs in wording (ДФЗ often appends the
// village) is a DIFFERENT spelling, and substituting it would be asserting a
// name the paying agency never wrote ([[feedback_name_match_not_identity]]).

import { decodeEntities } from "../../src/lib/decodeEntities";

/** The source register's name width. Names shorter than this were not cut. */
export const AGRI_NAME_CAP = 35;

const fold = (s: string): string =>
  s
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The full registry name when `agriName` is a cut prefix of it, else null.
 * `trName` is the raw `tr_companies.name` (may carry HTML entities).
 */
export const restoreTruncatedName = (
  agriName: string,
  trName: string | null | undefined,
): string | null => {
  if (!trName || [...agriName].length < AGRI_NAME_CAP) return null;
  const full = decodeEntities(trName).replace(/\s+/g, " ").trim();
  const a = fold(agriName);
  const t = fold(full);
  if (!a || t.length <= a.length || !t.startsWith(a)) return null;
  return full;
};
