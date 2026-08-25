// One município's declared mayor pay, from `mayor_pay_by_obshtina()`
// (migration 186) via /api/db/mayor-pay.
//
// The payload is snake_case throughout, matching the columns it is built from —
// the `/api/db/table` registry engine camelCases its projection, this
// hand-written route does not.
//
// The route DEGRADES a missing corpus to `null`, so the tile self-suppresses on
// a database that never ran `apply_functions.ts 186_mayor_pay.sql` rather than
// erroring — same contract as `useMunicipalFiscal`.
//
// `income_eur` is NULL for a real município whose sitting mayor has no matching
// declaration on file (not filed yet, or a filing this parser could not read),
// and for a município that briefly carries two concurrent sitting-mayor
// listings with no way to tell which is current (186's header names the two
// measured 2026-08-25). Neither is "€0" — render the absence, never a number.
//
// `obshtina` is canonicalized through `canonicalObshtina()` before it reaches
// the API — the SAME fix `MyAreaGovernmentCard` needed for the same reason
// (src/lib/obshtinaPlace.ts's header). The route's URL param is `SOF00`
// (`SOFIA_CITY_GOVERNANCE_ID`), but `municipal_officials_table` — which
// `mayor_pay_by_obshtina()` reads through — keys the capital's mayor under the
// synthetic `SFO_CITY` instead; passing `SOF00` straight through resolves zero
// rows and silently self-hides the tile on the capital's own governance page.

import { useQuery } from "@tanstack/react-query";
import { canonicalObshtina } from "@/lib/obshtinaPlace";

export interface MayorPayPayload {
  obshtina: string;
  name_bg: string;
  name_en: string | null;
  oblast_code: string | null;
  mayor_name: string;
  mayor_slug: string | null;
  declaration_id: number | null;
  fiscal_year: number | null;
  source_url: string | null;
  income_eur: number | null;
  population: number | null;
  income_per_1000_residents_eur: number | null;
  /** Null when this município has no computable ratio (no income, or no
   *  population) — never a fabricated rank among peers it cannot be compared
   *  to. */
  rank: number | null;
  /** The peer set `rank` is computed over — every município with a computable
   *  ratio, not the corpus total. */
  ranked_count: number;
}

export const useMayorPay = (obshtina: string | undefined) => {
  const canonical = canonicalObshtina(obshtina);
  const { data, isPending } = useQuery({
    queryKey: ["mayor_pay", canonical] as [string, string | null],
    queryFn: async (): Promise<MayorPayPayload | null> => {
      const r = await fetch(
        `/api/db/mayor-pay?obshtina=${encodeURIComponent(canonical!)}`,
      );
      if (!r.ok) throw new Error(`mayor-pay: ${r.status}`);
      return r.json();
    },
    enabled: !!canonical,
    staleTime: Infinity,
  });
  return { data: data ?? null, isPending };
};
