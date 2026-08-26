// How many people the identity layer places in one municipality, and what they are made of.
//
// It backs the „хора, свързани с общината" link on the governance dashboard — the producer for
// `?obshtina`, which until now no surface in the app emitted. One `/api/db/facets` call returns
// BOTH the total and the composition, which is why the link can say what the 329 are rather
// than only how many.
//
// ⚠️ THE COMPOSITION IS NOT OPTIONAL, and Burgas is why. `person_browse_table.obshtina_code` is
// a CASE over three place kinds (migration 120): an `obshtina` role, a `settlement` role folded
// to its parent (the 10,721 village-mayor seats), and a `judicial` role folded to the court
// body's municipality. So Burgas is 160 politicians and **152 magistrates** — a bench seated in
// the town, correctly placed and not what a reader clicking „местната власт" expects. A bare
// count invites that reading; the mix forecloses it.
//
// ⚠️ IT IS THE REPRESENTATIVE SEAT, not every seat. There is no padded code-SET column for
// obshtina as there is for oblast, so a person who serves two municipalities is counted in one.
// Measured 2026-08-26: 96 of 15,126 people with an obshtina-placed role hold one in more than
// one municipality — 0.6%, against oblast's 1,851 — so this is a caption problem rather than a
// column to mint. Say „свързани с общината", never „всички, които са служили тук".

import { useQuery } from "@tanstack/react-query";
import { canonicalObshtina } from "@/lib/obshtinaPlace";
import type { FacetOption } from "./usePersonFacets";

export interface PlacePersonMix {
  /** People whose representative seat is this municipality. */
  total: number;
  /** `primary_facet` buckets, largest first. */
  mix: FacetOption[];
}

/** Warn once per process per code, the `psp:` / `pp:` / `ppb:` convention this repo uses for a
 *  surface that degrades silently. Without it a transient 500 and a genuinely empty municipality
 *  are indistinguishable from outside — and the first one deletes the only producer `?obshtina`
 *  has, for the rest of the session. */
const warned = new Set<string>();

const fetchMix = async (code: string): Promise<PlacePersonMix> => {
  const req = {
    resource: "persons",
    columns: ["primary_facet"],
    // ⚠️ `tier: ['P','V']` is NOT sent, and must not be. The registry's own `defaultFilters`
    // floor the resource at tier P, and every placed row IS tier P — the name-fold private arm
    // carries no place at all. Widening here would change nothing except to make this call
    // disagree with /persons' own default scope for no reason.
    filters: [{ id: "obshtina_code", value: [code] }],
    limit: 20,
  };
  const r = await fetch(
    `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  // ⚠️ THROW, DO NOT RETURN AN EMPTY RESULT. Returning one makes React Query record a SUCCESS:
  // the default retries never fire, and `staleTime: Infinity` then pins a transient 500 for the
  // whole session — deleting the only producer `?obshtina` has, silently, with the page looking
  // exactly as it does for a municipality that genuinely holds nobody. Throwing lets the retry
  // happen and leaves `data` undefined, which the component already renders as absence.
  if (!r.ok) {
    if (!warned.has(code)) {
      warned.add(code);
      console.warn(`ppm:facets-failed:${code}:${r.status}`);
    }
    throw new Error(`place-person-mix ${code}: ${r.status}`);
  }
  const body = (await r.json()) as {
    facets?: Record<string, FacetOption[]>;
  };
  const mix = [...(body.facets?.primary_facet ?? [])].sort(
    (a, b) => b.count - a.count,
  );
  // ⚠️ A FLOOR, NOT A TOTAL — it can only UNDER-report, never over. `runDbFacets` drops NULL
  // buckets and truncates at `limit`, so a municipality with more distinct facets than the cap
  // would lose the tail. Inert today (0 NULL `primary_facet` rows and 6 distinct values
  // corpus-wide, measured 2026-08-26, against a limit of 20) and stated because the arithmetic
  // is the one place the count and the destination could still disagree: /persons counts rows.
  return { total: mix.reduce((n, o) => n + o.count, 0), mix };
};

/** People placed in `obshtina`, by primary facet.
 *
 *  The code is CANONICALISED here: callers hold the URL's own segment, and every Sofia
 *  governance URL carries `SOF00` while the corpus says `SFO_CITY` — measured, `SOF00` matches
 *  **0** rows against 1,315. A caller that forgot the fold would report the capital as empty. */
export const usePlacePersonMix = (obshtina?: string | null) => {
  const code = canonicalObshtina(obshtina);
  const { data } = useQuery({
    // `code ?? ""` rather than `code!`: the guarantee lives in `enabled`, which the compiler
    // cannot see, and a non-null assertion is a promise nothing checks. The empty string is
    // unreachable while `enabled` holds and harmless if it ever does not.
    queryKey: ["place-person-mix", code],
    queryFn: () => fetchMix(code ?? ""),
    enabled: !!code,
    staleTime: Infinity,
  });
  return data ?? null;
};
