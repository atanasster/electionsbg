// EIK/BULSTAT canonicalization for the ИСУН funds ingest. Bulgarian company
// ids are 9-digit (parent legal entity); 13-digit forms carry a 4-digit
// branch suffix. The eufunds.bg beneficiary export prefixes each org name
// with this id — we canonicalize to the 9-digit form so a future cross-
// reference can join against data/parliament/companies-index.json.

export const canonicalEik = (raw: string): string | null => {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  // 13-digit EIK = 9-digit parent + 4-digit branch suffix. Drop the suffix.
  if (s.length === 13) return s.slice(0, 9);
  if (s.length === 9) return s;
  // 10-digit tokens are either rare legacy BULSTAT or a personal ЕГН — they
  // can't be told apart, so we don't persist them (avoids storing PII; the
  // cross-reference would miss legacy BULSTAT anyway).
  return null;
};
