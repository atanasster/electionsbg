import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { useMps } from "@/data/parliament/useMps";
import { oblastToMir } from "@/data/parliament/nsFolders";

/** URL-driven region filter for detail pages (/mp-cars, /mp-assets, ...).
 *
 * Reads either `?region=S23` (single) or `?regions=S23,S24,S25` (multiple,
 * used for Sofia's three MIRs). Returns the resolved set of MP ids whose
 * `currentRegion` matches any of the supplied codes, plus a human-readable
 * label suitable for a scope chip.
 *
 * Filtering is by `currentRegion` only — parliament-scope filtering remains a
 * separate concern handled by each page's existing toggle. This deliberately
 * mirrors the dashboard tile behaviour: regional MPs are identified by the
 * MP index's most-recent region, and parliament membership is layered on top.
 */
export type RegionScope = {
  regionCodes: string[] | null;
  regionMpIds: Set<number> | null;
  label: string | null;
  /** Search params with `region`/`regions` removed — for the "clear" button. */
  clearedParams: URLSearchParams;
};

export const useRegionScope = (): RegionScope => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { mps } = useMps();

  const regionsParam = searchParams.get("regions");
  const regionParam = searchParams.get("region");

  const regionCodes = useMemo<string[] | null>(() => {
    if (regionsParam) {
      const codes = regionsParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      return codes.length > 0 ? codes : null;
    }
    if (regionParam) return [regionParam];
    return null;
  }, [regionParam, regionsParam]);

  const regionMpIds = useMemo<Set<number> | null>(() => {
    if (!regionCodes || !mps) return null;
    const mirSet = new Set<string>();
    for (const code of regionCodes) {
      const mir = oblastToMir(code);
      if (mir) mirSet.add(mir);
    }
    if (mirSet.size === 0) return new Set<number>();
    const ids = new Set<number>();
    for (const mp of mps) {
      if (mp.currentRegion && mirSet.has(mp.currentRegion.code)) {
        ids.add(mp.id);
      }
    }
    return ids;
  }, [regionCodes, mps]);

  const label = useMemo<string | null>(() => {
    if (!regionCodes || regionCodes.length === 0) return null;
    // Sofia City is the canonical multi-MIR group — give it its own label
    // instead of stitching three regions together.
    const isSofia =
      regionCodes.length === SOFIA_REGIONS.length &&
      SOFIA_REGIONS.every((r) => regionCodes.includes(r));
    if (isSofia) return t("sofia_city") || "Sofia City";
    if (!mps) return regionCodes.join(", ");
    const names = new Set<string>();
    const mirSet = new Set<string>();
    for (const code of regionCodes) {
      const mir = oblastToMir(code);
      if (mir) mirSet.add(mir);
    }
    for (const mp of mps) {
      if (mp.currentRegion && mirSet.has(mp.currentRegion.code)) {
        names.add(mp.currentRegion.name);
      }
    }
    if (names.size === 0) return regionCodes.join(", ");
    return Array.from(names).join(", ");
  }, [regionCodes, mps, t]);

  const clearedParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("region");
    next.delete("regions");
    return next;
  }, [searchParams]);

  return { regionCodes, regionMpIds, label, clearedParams };
};
