// The person-page header — identity + party + (for MPs) a compact one-line bio. Thin wrapper
// over the shared PersonProfileHeader, which the candidate sub-pages reuse so a drill-down
// shows the same profile as this dashboard.
//
// The H1 follows the locale on /en (useCandidateName, as everywhere else on the English
// routes) while the AVATAR keeps the Bulgarian form — MpAvatar's photo lookup keys on it.
// Without this the /en page prerendered a Latin <h1> and then hydrated a Cyrillic one, which
// is the mismatch data/funds/programmeNamesEn.ts was written for on the funds routes.
//
// The mp entry is read for its CURATED `name_en` and passed as the hint, so this page uses
// the same precedence as every other /en surface (`name_en ?? transliterateName`). Without
// the hint /en/person and /en/candidate spell the same MP differently whenever
// parliament.bg's spelling departs from the Streamlined System — and /person is the canonical
// one. `useMpEntry` is already called inside PersonProfileHeader; React Query dedupes on the
// query key, so this costs no extra request.

import { FC } from "react";
import { PersonProfileHeader } from "@/screens/components/candidates/PersonProfileHeader";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import type { PersonProfile } from "./usePersonProfile";

export const PersonHeader: FC<{ p: PersonProfile; mpId: number | null }> = ({
  p,
  mpId,
}) => {
  const { nameForBg } = useCandidateName();
  const { entry } = useMpEntry(mpId);
  return (
    <PersonProfileHeader
      name={nameForBg(p.name, entry?.name_en)}
      lookupName={p.name}
      mpId={mpId}
      profile={p}
    />
  );
};
