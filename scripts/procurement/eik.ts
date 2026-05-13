// EIK canonicalization. Bulgarian company ids come in 9-digit (parent legal
// entity) and 13-digit (branch / clone) forms. The cross-reference against
// data/parliament/companies-index.json joins on the 9-digit canonical, so
// every Contract carries that — and preserves the 13-digit form when present
// for the source link back to АОП.

export const canonicalEik = (raw: string | number | undefined): string => {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return "";
  // 13-digit EIK = 9-digit parent + 4-digit branch suffix. Drop the suffix.
  if (s.length === 13) return s.slice(0, 9);
  // Some sources publish 9-digit EIKs with a leading zero stripped, e.g.
  // "24695" instead of "000024695". Pad to 9 if the value is 5-8 digits.
  // Don't pad sub-5-digit values — they're noise / non-EIKs (test data, free-
  // text in the wrong field).
  if (s.length >= 5 && s.length < 9) return s.padStart(9, "0");
  if (s.length === 9) return s;
  // Some EIKs are 10 digits (rare, e.g. older BULSTAT). Keep as-is — these
  // genuinely don't deduplicate to 9 and the cross-reference will miss them.
  return s;
};

// Truthiness check that recognises empty / placeholder EIKs.
export const isValidEik = (eik: string): boolean => {
  if (!eik) return false;
  if (!/^\d+$/.test(eik)) return false;
  if (eik.length < 9 || eik.length > 13) return false;
  // All-zero EIK appears as a placeholder when the upstream couldn't resolve
  // the party; treat as missing.
  if (/^0+$/.test(eik)) return false;
  return true;
};
