// Hand-curated canonical parties — entries for parties that never appear as
// a top-level row in any parliamentary cycle's cik_parties.json (so the
// membership-based generator can't synthesise them), but exist as standalone
// registered legal entities that turn up as `localPartyName` strings in
// chmi/mi partial-mayor races.
//
// Without an entry here, the local-name resolution in
// scripts/parsers_local/local_coalitions.ts (`resolveLocalParty`, via the
// canonical `byNickName` index) has no history.nickName to match against, so
// the bundle bakes `primaryCanonicalId: null` and rows on /local/chmi render as
// plain text instead of a recognised party. Folding such parties into a host
// coalition's lineage via
// partyOverrides isn't an option — that would conflate distinct legal
// entities (e.g. ССД ≠ БНС ≠ КП-СИ even though ССД shows up as a member of
// both coalitions in 2005 and 2024_10_27 respectively).

import { CanonicalPartyHistory } from "@/data/parties/canonicalPartyTypes";

export type ManualCanonical = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color: string;
  history: CanonicalPartyHistory[];
};

export const manualCanonicals: ManualCanonical[] = [
  // Съюз на свободните демократи — centrist liberal party. Appears in
  // parliamentary cycles only as a coalition member (p_173 БНС 2005,
  // p_35 КП-СИ 2024_10_27); ran solo as the mayor's slate in two chmi
  // partials: Несебър/Баня kmetstvo (2024_06_23, elected with 59.66%) and
  // Сокол/Симитли (2026_02_22, 3.56%).
  {
    id: "ssd",
    displayName: "ССД",
    displayNameEn: "SSD",
    color: "lightslategrey",
    history: [
      {
        election: "2024_06_23_chmi",
        partyNum: 54,
        nickName: "ССД",
        name: "ПП СЪЮЗ НА СВОБОДНИТЕ ДЕМОКРАТИ",
        nameEn: "Union of Free Democrats",
      },
      {
        election: "2026_02_22_chmi",
        partyNum: 2,
        nickName: "ССД",
        name: "ПП СЪЮЗ НА СВОБОДНИТЕ ДЕМОКРАТИ",
        nameEn: "Union of Free Democrats",
      },
    ],
  },
  // NOT a party — the SENTINEL for "stood without one". `local_coalitions.ts`
  // mints it (INDEPENDENT_CANONICAL_ID) for every „Инициативен комитет", and
  // mp-party-affiliation-v1 §1b WILL route the parliamentary НЕЗ / НЕЧЛ В ПГ /
  // НЕЧЛ ПГ group shorts here too (not implemented yet — T1/T2 of that plan), so
  // that one `?party=independent` covers independents across councillors and MPs
  // instead of two half-sets.
  //
  // It needs an entry for the same reason a real party does: `displayNameForId`
  // is a `byId` lookup, and the ПАРТИЯ column falls through to
  // `|| p.partyPrimary` on a miss — so without this, 484 people rendered the
  // latin token "independent" in a Bulgarian UI with no colour dot, and the
  // facet dropdown listed it that way too (§0g). `colorFor` misses the same way.
  //
  // `history` is deliberately EMPTY, and every consumer tolerates that: the
  // reads are `.find` (fullNameFor in useCanonicalParties.tsx, usePartyScope,
  // ChmiPartyBadge) or `.forEach` / `.length` (PartyPollingDeltaTile, which
  // already guards on `history.length < 2`). A sentinel has no lineage, and
  // giving it a fake election row would enter „Независим" into cross-election
  // party series as though it had contested them. Nothing enumerates
  // `canonical_parties.json` to mint `/party` pages — the SPA, the prerender and
  // the sitemap all walk the per-election `cik_parties.json` — so a historyless
  // entry cannot produce an empty party page either.
  //
  // The colour is NOT a free choice: `rgb(148, 163, 184)` is what the local
  // pipeline has already baked for `independent` in 392 committed bundles
  // (verified in data/2023_10_29_mi/index.json), so anything else would make
  // `colorFor` disagree with the artifacts. Note it is near-identical to the
  // "#9CA3AF" unresolved-party fallback used in build_index_json.ts and the
  // council tiles; the distinction between "stood as an independent" and "could
  // not resolve this" is therefore real in the data but imperceptible on screen.
  {
    id: "independent",
    displayName: "Независим",
    displayNameEn: "Independent",
    color: "rgb(148, 163, 184)",
    history: [],
  },
];
