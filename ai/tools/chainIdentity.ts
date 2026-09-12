// Shared exact retail identities; callers must distinguish subway context.
export const CHAIN_MATCH: { re: RegExp; eik: string }[] = [
  { re: /кауфланд|kaufland/i, eik: "131129282" },
  { re: /билла|billa/i, eik: "130007884" },
  { re: /лидл|lidl/i, eik: "131071587" },
  { re: /фантастико|fantastico/i, eik: "206255903" },
  { re: /метро|metro/i, eik: "121644736" },
  { re: /софармаси|sopharmacy/i, eik: "175334310" },
];

export const resolveChainEik = (q: string): string | undefined =>
  CHAIN_MATCH.find((m) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${m.re.source})(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(q),
  )?.eik;
