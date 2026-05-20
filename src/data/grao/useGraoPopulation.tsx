import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type GraoSettlement = { permanent: number; current: number };

export type GraoMunicipalitySlice = {
  /** ISO date of the ГРАО quarterly table this snapshot was taken from. */
  asOf: string;
  /** Keyed by EKATTE code — the settlements of one municipality. */
  settlements: Record<string, GraoSettlement>;
};

// ГРАО registered population (permanent + current address), written by
// scripts/grao/fetch.ts. Sliced per municipality (~1 KB each) so a
// settlement page fetches only its own municipality's slice instead of the
// full ~200 KB bundle. Pass the obshtina code; the query no-ops until it
// is known (e.g. while the census sidecar that carries it is still loading).
export const useGraoMunicipalitySlice = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["grao_slice", obshtina],
    enabled: !!obshtina,
    queryFn: async (): Promise<GraoMunicipalitySlice | undefined> => {
      const res = await fetch(dataUrl(`/grao/${obshtina}.json`));
      if (!res.ok) return undefined;
      return (await res.json()) as GraoMunicipalitySlice;
    },
  });
