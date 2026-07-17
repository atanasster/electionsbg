// Place-attribution rule for the ИСУН contract corpus.
//
// A leaf module on purpose: both the ingest (projects_ingest.ts) and the
// focus-themes builder (themes.ts) need this rule, and neither should import
// the other — projects_ingest.ts is a CLI entrypoint that runs on import.

// The structural minimum the rule needs. Deliberately not ResolvedFundsProject:
// themes.ts reads the programme shards back off disk into its own slimmer row
// type, and both shapes satisfy this.
export interface MuniAttributable {
  location?: { munis?: string[] };
}

// The split denominator — how many distinct муни the row names.
export const muniCount = (r: MuniAttributable): number =>
  new Set(r.location?.munis ?? []).size;

// A row whose declared Местонахождение names N муни (e.g. the RRP grid
// projects listing 39) resolves to one location carrying all N in munis[].
// Attributing the full value to each would invent money: doing so put
// €7.15 bn of phantom spend on the choropleth, 79 % of it from ten rows.
// ИСУН publishes no per-муни breakdown, so an even split is the only
// allocation that keeps Σ(per-муни money) equal to the mappable corpus.
//
// Applies to every муни-keyed money aggregate; per-EKATTE / per-EIK /
// per-programme / per-contract totals are untouched (single-valued keys).
// Counts are never shared — the contract is one contract wherever it lands.
export const muniShare = (r: MuniAttributable): number => {
  const n = muniCount(r);
  return n > 1 ? 1 / n : 1;
};
