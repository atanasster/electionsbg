// Per-município bundle builder.
//
// Inputs:
//   - parsed HTML pages for tur1 (mandatory) and tur2 (optional) for this OIK
//   - protocols.txt totals for the council ballot (the most-cast vote in
//     a local cycle, used as the município turnout denominator)
//   - the OIK→obshtina mapping derived from sections.txt + municipalities.json
//
// Output: data/{cycle}/municipalities/{obshtinaCode}.json
//
// For the elected mayor: when round 2 is present we take the round-2
// candidate with `isElected: true`; otherwise the round-1 candidate with
// `isElected: true` (i.e. >50% in round 1).

import { ParsedRezultatiPage } from "./parse_rezultati_html";
import { LocalProtocolRow } from "./parse_local_protocols";
import { LocalMayorResult, LocalMunicipalityBundle } from "./types";

export type ObshtinaResolution = {
  oikCode: string;
  obshtinaCode: string;
  obshtinaName: string;
  oblastName: string;
};

const sumProtocols = (rows: LocalProtocolRow[], oikCode: string) => {
  const filtered = rows.filter((r) => r.oikCode === oikCode);
  return filtered.reduce(
    (acc, r) => ({
      numRegisteredVoters: acc.numRegisteredVoters + r.numRegisteredVoters,
      totalActualVoters: acc.totalActualVoters + r.totalActualVoters,
      numValidVotes: acc.numValidVotes + r.numValidVotes,
    }),
    { numRegisteredVoters: 0, totalActualVoters: 0, numValidVotes: 0 },
  );
};

const pickElectedMayor = (
  tur1: LocalMayorResult[],
  tur2?: LocalMayorResult[],
): LocalMayorResult | null => {
  if (tur2 && tur2.length) {
    const winner = tur2.find((m) => m.isElected);
    if (winner) return winner;
  }
  const r1Winner = tur1.find((m) => m.isElected);
  if (r1Winner) return r1Winner;
  // Fall back to highest-voted candidate if the page didn't mark anyone
  // (defensive — shouldn't happen on a fully-counted result).
  const sorted = [...tur1].sort((a, b) => b.votes - a.votes);
  return sorted[0] ?? null;
};

export const buildMunicipalityBundle = (opts: {
  cycle: string;
  resolution: ObshtinaResolution;
  tur1: ParsedRezultatiPage | null;
  tur2: ParsedRezultatiPage | null;
  councilProtocols: LocalProtocolRow[];
}): LocalMunicipalityBundle | null => {
  const { cycle, resolution, tur1, tur2, councilProtocols } = opts;
  if (!tur1) return null;
  const protocol = sumProtocols(councilProtocols, resolution.oikCode);
  const round1 = tur1.mayor;
  const round2 = tur2?.mayor.length ? tur2.mayor : undefined;
  const elected = pickElectedMayor(round1, round2);
  return {
    cycle,
    oikCode: resolution.oikCode,
    obshtinaCode: resolution.obshtinaCode,
    obshtinaName: resolution.obshtinaName,
    oblastName: resolution.oblastName,
    protocol,
    mayor: {
      round1,
      round2,
      elected,
    },
    council: tur1.council,
    kmetstva: tur1.kmetstva,
    districts: tur1.districts,
  };
};
