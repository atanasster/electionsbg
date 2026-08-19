// Normalise one TED v3 notice into a flat row. Pure: JSON in, row out.

export type TedNotice = {
  publicationNumber: string;
  /** ISO date. TED returns „2024-01-02+01:00" — an offset, not a time. */
  publicationDate: string | null;
  /** The buyer's ЕИК. This is the join key to `contracts.awarder_eik`; a notice
   *  without one cannot be reconciled and is kept, flagged, never dropped. */
  buyerEik: string | null;
  buyerName: string | null;
  noticeType: string | null;
  contractNature: string | null;
  procedureType: string | null;
  cpv: string | null;
  totalValue: number | null;
};

/** TED returns most text as `{ bul: [...], eng: [...] }` and most codes as a
 *  bare array. One accessor, so a shape change fails in one place. */
const first = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.length ? first(v[0]) : null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Bulgarian first — this is a Bulgarian corpus and the buyer's own spelling
    // is the one that matches ours. English is a fallback, not a preference.
    for (const k of ["bul", "eng", "mul"]) if (k in o) return first(o[k]);
    const vals = Object.values(o);
    return vals.length ? first(vals[0]) : null;
  }
  return null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(first(v));
  return Number.isFinite(n) ? n : null;
};

/** „2024-01-02+01:00" → „2024-01-02". The offset is publication-time zone noise;
 *  keeping it would make the same day sort differently across a DST boundary. */
const isoDate = (v: unknown): string | null => {
  const s = first(v);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

export const parseTedNotice = (
  n: Record<string, unknown>,
): TedNotice | null => {
  const publicationNumber = first(n["publication-number"]);
  // Without the publication number there is no identity and no de-duplication
  // key; a row like that is unusable rather than partially useful.
  if (!publicationNumber) return null;
  return {
    publicationNumber,
    publicationDate: isoDate(n["publication-date"]),
    buyerEik: first(n["buyer-identifier"]),
    buyerName: first(n["buyer-name"]),
    noticeType: first(n["notice-type"]),
    contractNature: first(n["contract-nature"]),
    procedureType: first(n["procedure-type"]),
    cpv: first(n["classification-cpv"]),
    totalValue: num(n["total-value"]),
  };
};
