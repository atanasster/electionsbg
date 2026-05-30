// Hand-curated canonical parties — entries for parties that never appear as
// a top-level row in any parliamentary cycle's cik_parties.json (so the
// membership-based generator can't synthesise them), but exist as standalone
// registered legal entities that turn up as `localPartyName` strings in
// chmi/mi partial-mayor races.
//
// Without an entry here, findCanonicalIdByLocalName (in
// src/data/parties/useCanonicalParties.tsx) has no history.name to match
// against, and rows on /local/chmi render as plain text instead of a
// recognised party. Folding such parties into a host coalition's lineage via
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
];
