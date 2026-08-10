// The person-page header — identity + party + (for MPs) a compact one-line bio. Thin wrapper
// over the shared PersonProfileHeader, which the candidate sub-pages reuse so a drill-down
// shows the same profile as this dashboard.
//
// The H1 is transliterated on /en (useCandidateName, as everywhere else on the English
// routes) while the AVATAR keeps the Bulgarian form — MpAvatar's photo lookup keys on it.
// Without this the /en page prerendered a Latin <h1> and then hydrated a Cyrillic one, which
// is the mismatch data/funds/programmeNamesEn.ts was written for on the funds routes.

import { FC } from "react";
import { PersonProfileHeader } from "@/screens/components/candidates/PersonProfileHeader";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import type { PersonProfile } from "./usePersonProfile";

export const PersonHeader: FC<{ p: PersonProfile; mpId: number | null }> = ({
  p,
  mpId,
}) => {
  const { nameForBg } = useCandidateName();
  return (
    <PersonProfileHeader
      name={nameForBg(p.name)}
      lookupName={p.name}
      mpId={mpId}
      profile={p}
    />
  );
};
