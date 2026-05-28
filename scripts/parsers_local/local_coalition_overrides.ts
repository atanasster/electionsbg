// Manual overrides for local-coalition party-name resolution.
//
// `local_coalitions.ts` parses coalition names like
//   "Местна коалиция ВМРО - КП АЛТЕРНАТИВАТА НА ГРАЖДАНИТЕ"
// by splitting on " - " / " – " / "+" and looking each fragment up against
// the canonical-parties table (built by `scripts/parsers/canonicalParties.ts`).
//
// When a fragment doesn't match, the parser writes it to
// `data/{cycle}/_unmatched_coalitions.json` so an operator can add an entry
// here. After re-running, the override applies and the warning disappears.
//
// Two override shapes:
//   - byRawName:  exact match on the full local_party_name string (escape
//                 hatch for weird casings)
//   - byFragment: case-insensitive match on a coalition fragment (apply to
//                 every coalition string that contains this fragment)

export type LocalCoalitionRawOverride = {
  /** Exact `local_party_name` from local_parties.txt. */
  rawName: string;
  /** Canonical party id to credit as primary (per the primary-party-credit
   * decision). Use "independent" to bucket as an independent committee. */
  primaryCanonicalId: string;
  /** Optional additional canonical ids that participated in the coalition
   * (for the "members" chip list on UI). */
  memberCanonicalIds?: string[];
};

export type LocalCoalitionFragmentOverride = {
  /** Case-insensitive substring match against a coalition fragment after
   * splitting on " - " / " – " / "+". */
  fragment: string;
  /** Canonical party id to map the fragment to. */
  canonicalId: string;
};

export const localCoalitionRawOverrides: LocalCoalitionRawOverride[] = [
  // Add overrides here as the parser flags them in
  // data/{cycle}/_unmatched_coalitions.json. Example:
  // {
  //   rawName: "Местна коалиция Граждани за Сандански (ВМРО-БНД, БДЦ)",
  //   primaryCanonicalId: "vmro",
  //   memberCanonicalIds: ["vmro", "bdc"],
  // },
];

export const localCoalitionFragmentOverrides: LocalCoalitionFragmentOverride[] =
  [
    // Curated long-form names that local OIKs use but the canonical
    // builder only indexes by short nickName. Match is case-insensitive
    // substring containment, so "Местна коалиция БСП за България (БСП-ОЛ
    // — Земеделски съюз)" hits "БСП ЗА БЪЛГАРИЯ" and credits bsp.
    //
    // Order matters: longer/more specific fragments first.
    { fragment: "ПРОДЪЛЖАВАМЕ ПРОМЯНАТА", canonicalId: "p_6" },
    { fragment: "ДЕМОКРАТИЧНА БЪЛГАРИЯ", canonicalId: "p_6" },
    { fragment: "БСП ЗА БЪЛГАРИЯ", canonicalId: "bsp" },
    { fragment: "ИМА ТАКЪВ НАРОД", canonicalId: "p_0" },
    { fragment: "ВМРО", canonicalId: "vmro" },
  ];
