// A contract's `date_signed` is ALWAYS populated: it falls back to the canonical
// `date` at load time (scripts/db/load_pg.ts backfill + migration 107), so the
// contracts table always has one date to render. The flip side is that a
// `date_signed` value equal to `date` is that fallback, NOT a genuine signature.
//
// `realSignedDate()` centralises the single heuristic every contract/tender/award
// UI and risk metric uses to tell a real signing date from the fallback: return
// the signing date only when it is present AND distinct from `date`; otherwise
// undefined. Keeping it in one place means the known trade-off — a contract
// genuinely signed on its own publication date reads as a fallback and is treated
// as "no distinct signing date" — is documented and adjustable in exactly one
// spot.
export const realSignedDate = (r: {
  date?: string | null;
  dateSigned?: string | null;
}): string | undefined =>
  r.dateSigned && r.dateSigned !== r.date ? r.dateSigned : undefined;
