// One judicial body's page payload (/court/:bodyCode), from judicial_body_detail().
//
// COVERS ALL 284 BODIES — 186 courts, 70 prosecution offices, 28 investigation
// services. The last two categories carry no workload series (court_load has
// rows for 180 bodies) and usually no coordinates, so `load` is NULLABLE by
// design: the page branches on it to say "no published workload for this body"
// rather than drawing an empty chart. An empty array would look like a body with
// zero cases, which is a different and false claim.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";

/** One year of a body's published workload. */
export interface CourtLoadYearRow {
  year: number;
  judges: number | null;
  personMonths: number | null;
  /** ДЕЙСТВИТЕЛНА натовареност — cases per judge per month. */
  filedPerMonth: number | null;
  considerPerMonth: number | null;
  resolvedPerMonth: number | null;
}

export interface CourtDetail {
  bodyCode: string;
  name: string;
  /** court | prosecution | investigation | council */
  kind: string;
  tier: string | null;
  place: string | null;
  placeCode: string | null;
  lng: number | null;
  lat: number | null;
  /** Magistrates the ИВСС register places at this body. */
  magistrates: number;
  /** False when judicial_body_source_name was never loaded. Then `load: null`
   *  and `magistrates: 0` mean "not loaded", NOT "nothing published" — the two
   *  are shape-identical, and conflating them makes every court page assert
   *  that the ВСС publishes no workload for it. */
  sourcesBuilt: boolean;
  /** NULL — not [] — when this body publishes no workload. */
  load: CourtLoadYearRow[] | null;
}

export const useCourt = (bodyCode: string | null | undefined) =>
  useQuery({
    queryKey: ["judiciary", "court", bodyCode ?? ""] as const,
    queryFn: () =>
      fetchJson<CourtDetail | null>(
        `/api/db/court?code=${encodeURIComponent(bodyCode!)}`,
      ),
    enabled: !!bodyCode,
    staleTime: Infinity,
  });

/** One row of the body index — enough to search, rank and link. */
export interface JudicialBodyIndexRow {
  bodyCode: string;
  name: string;
  kind: string;
  tier: string | null;
  place: string | null;
  magistrates: number;
}

/** All 284 bodies, for the /judiciary search group. GATED on `enabled` so it is
 *  fetched only once the reader focuses the box. */
export const useJudicialBodyIndex = (enabled: boolean) =>
  useQuery({
    queryKey: ["judiciary", "body-index"] as const,
    queryFn: () =>
      fetchJson<JudicialBodyIndexRow[] | null>("/api/db/judicial-body-index"),
    enabled,
    staleTime: Infinity,
  });
