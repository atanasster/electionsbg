// Shared candidate-row classification for the presidential poll-list views
// (`AgencyPresidentialPollsList.tsx`, `PresidentialPollsSection.tsx`) —
// extracted so both cannot silently disagree about which rows are real
// candidates, the same reason `fieldwork.ts`'s helpers are shared rather
// than copied per screen.

import { PresidentialPollDetail } from "./pollsTypes";

/** A row is a real, nameable candidate (a real or provisional
 *  `CandidateKey`) — never "none" (Не подкрепям никого) or a
 *  `placeholder:<party>` row minted before a party has nominated anyone.
 *  Those two render as plain text rather than through
 *  `PresidentialPersonName`. */
export const isNamedCandidateRow = (d: PresidentialPollDetail): boolean =>
  d.candidateKey !== "none" && d.placeholderFor === null;
