// Seed resolvers for the two band-4 tiles whose destinations are parameterised routes with
// no static landing (docs/plans/parliament-hub-v1.md §4.4).
//
// Both read a SMALL precomputed shard the hub already has — similarity_headline.json is
// 4.3 KB and party_correlation.json is 17 KB — never the 11.7 MB similarity aggregate they
// summarise. That is the whole point of the seed indirection: the hub gets a concrete,
// interesting destination without paying an aggregate's payload to find it.

/** The most divergent pair in the party-correlation matrix — the two groups that vote least
 *  alike, which is the pair worth opening.
 *
 *  The slug format is NOT free: `/votes/between/:pair` is already minted by
 *  ParliamentVotingTile with a DOUBLE hyphen separator, because a party short name can
 *  contain a single one (ГЕРБ-СДС) and a single-hyphen separator would not round-trip. */
export const mostDivergentPairSlug = (
  parties: string[] | undefined,
  matrix: number[][] | undefined,
): string | undefined => {
  if (!parties?.length || !matrix?.length) return undefined;

  let best: { a: string; b: string; score: number } | undefined;
  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      const score = matrix[i]?.[j];
      if (typeof score !== "number" || Number.isNaN(score)) continue;
      if (!best || score < best.score) {
        best = { a: parties[i], b: parties[j], score };
      }
    }
  }
  if (!best) return undefined;
  return `${encodeURIComponent(best.a)}--${encodeURIComponent(best.b)}`;
};
