// Company-level declared-activity ("off-profile") signal — the aggregate analogue
// of the per-contract nkidMismatch flag (docs/plans/nkid-cpv-mismatch-v1.md §8 B1).
// Pure + framework-free so it is unit-testable and does not trip react-refresh when
// imported by CompanyRiskChips.

import { naceCpvMismatch } from "@/lib/naceCpv";
import type { SectorRank } from "./CompanySectorRankTile";

/** Fire the company chip only when a majority-ish share of value is off-profile —
 *  a company legitimately diversifies, so a small tail is not the signal. */
export const OFF_PROFILE_CHIP_THRESHOLD = 0.4;

/** Share of the company's procurement VALUE that lands in a CPV division clearly
 *  disjoint from its declared НКИД (NACE) division. Returns null when we have no
 *  declared NACE, no sectors, or no sector the crosswalk has an opinion on (so a
 *  data gap never manufactures the chip). Universal CPV and matching sectors sit in
 *  the denominator but not the numerator; €0 and no-opinion sectors are excluded
 *  from both. */
export const offProfileShare = (
  declaredNaceDivision: string | null | undefined,
  sectors: SectorRank[] | null | undefined,
): number | null => {
  if (!declaredNaceDivision || !sectors?.length) return null;
  let total = 0;
  let off = 0;
  let evaluable = false;
  for (const s of sectors) {
    if (!(s.totalEur > 0)) continue;
    const verdict = naceCpvMismatch(declaredNaceDivision, s.division);
    if (verdict === "unavailable") continue; // no opinion on this pairing
    evaluable = true;
    total += s.totalEur;
    if (verdict === "mismatch") off += s.totalEur;
  }
  if (!evaluable || total <= 0) return null;
  return off / total;
};
