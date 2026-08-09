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
  // data/{cycle}/_unmatched_coalitions.json.
  //
  // EVERY id below must ALREADY EXIST in canonical_parties.json. An id that
  // does not is not a no-op and does not resolve to null — it MINTS a second
  // party, which then renders as its own raw latin token beside the real one
  // in the /persons ПАРТИЯ facet. Look the id up (it is usually `p_<n>`; ВМРО
  // is p_51, not "vmro") rather than inventing a readable slug.
  // `local_coalition_overrides.test.ts` fails on an unknown id.
  //
  // Example:
  // {
  //   rawName: "Местна коалиция Граждани за Сандански (ВМРО-БНД, БДЦ)",
  //   primaryCanonicalId: "p_51",
  //   memberCanonicalIds: ["p_51", "p_100"],   // ВМРО, БДЦ
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
    // p_51, NOT "vmro". ВМРО is a real parliamentary lineage with its own
    // generated canonical (displayName "ВМРО", displayNameEn "VMRO", a colour),
    // so an invented id here does not create a party — it creates a SECOND one.
    // The symptom is two entries for ВМРО in the /persons ПАРТИЯ facet: `p_51`
    // rendered with its name and colour dot, and `vmro` rendered as the raw
    // latin token with no dot, because displayNameForId is a byId lookup and
    // misses. That is exactly the split §0e of mp-party-affiliation-v1 exists to
    // prevent. Any id used here must exist in canonical_parties.json;
    // local_coalition_overrides.test.ts asserts it for every entry.
    { fragment: "ВМРО", canonicalId: "p_51" },
  ];
