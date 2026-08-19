// Which flag-catalogue version the SERVED risk masks were computed under.
//
// ⚠️ This is NOT `CATALOG_VERSION` from src/lib/riskFlagCatalog.ts, and the whole
// reason the route exists is that the two are different claims:
//
//   CATALOG_VERSION  — what the code in this bundle declares.
//   this hook        — what the last rebuild_contract_risk_cache() stamped into
//                      contract_risk_meta, i.e. what the flags a reader is
//                      actually looking at were computed from.
//
// They diverge for the entire window between a deploy and a cache rebuild, which
// on the cloud side is an explicit operator step that is easy to skip. The
// methodology page invites a journalist to cite "flag set vX.Y.Z", so it must
// print THIS one — a version the page cannot prove is worse than no version.
//
// `version: null` means NOT STAMPED: either the database predates
// contract_risk_meta, or the last rebuild used the unstamped overload (which
// deliberately CLEARS the field rather than leaving a stale claim). It is not an
// error and must not render as one — it means the served flags cannot be
// attributed to a catalogue version at all, and the page says exactly that.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

export interface RiskCatalogVersion {
  /** Semver, or null when the served masks carry no version stamp. */
  version: string | null;
  /** ISO timestamp of the rebuild that produced the current masks. */
  rebuiltAt: string | null;
  /** Rows in contract_risk_cache at that rebuild. */
  rowCount: number | null;
}

export const useRiskCatalogVersion = () =>
  useQuery<RiskCatalogVersion>({
    queryKey: ["risk-catalog-version"],
    queryFn: () =>
      fetchJson<RiskCatalogVersion>("/api/db/risk-catalog-version"),
    staleTime: Infinity,
  });
