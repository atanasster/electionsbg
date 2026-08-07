// The per-capita municipal EU-money figure WITH the Interreg arm (migration 139).
//
// The `muni-summary` payload behind useFundsForMuni is ИСУН-only, and ИСУН holds
// no Interreg project at all — a system boundary (Interreg runs on Jems), not a
// filter. Since Interreg is cross-border by definition, the money it was missing
// landed on exactly the border municipalities: 213 of the 256 ranked общини
// change rank once it is counted, Генерал Тошево by 43 places.
//
// Returns `null` for a municipality outside the ranked cohort — Столична община
// among them, because ГРАО carries no Sofia city EKATTE, so it has no per-capita
// figure on EITHER arm. That is "not ranked", not "no money", and the caller
// must render it as such.

import { useQuery } from "@tanstack/react-query";
import type { FundsMuniCombined } from "./types";

export const useFundsMuniCombined = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["funds", "muni-combined", obshtina ?? ""] as const,
    queryFn: async (): Promise<FundsMuniCombined | null> => {
      const r = await fetch(
        `/api/db/funds-muni-combined?obshtina=${encodeURIComponent(obshtina!)}`,
      );
      if (!r.ok) throw new Error(`funds-muni-combined failed: ${r.status}`);
      return (await r.json()) as FundsMuniCombined | null;
    },
    enabled: !!obshtina,
    staleTime: Infinity,
  });
