import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";

/**
 * Mayor-pay declarations describe the current officeholder, whereas a local
 * results route can describe any historical election. Keep that temporal
 * boundary in one tested predicate shared by municipal and settlement pages.
 */
export const shouldShowMayorPayOnLocalPage = (
  cycle: string,
  isSofiaRayon = false,
): boolean => cycle === LATEST_LOCAL_CYCLE && !isSofiaRayon;
