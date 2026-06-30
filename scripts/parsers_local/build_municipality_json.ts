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
import {
  LocalDistrictMayorResult,
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";

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

export const pickElectedMayor = (
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

// Normalize a район / кметство name for cross-round matching (lowercase, strip
// parentheticals, collapse whitespace) — mirrors normName in
// parse_local_elections.ts.
const normName = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Attach the round-2 (балотаж) table to each район and resolve its winner.
// CIK's round-1 page marks BOTH runoff finalists with isElected, so the
// winner of a район that went to a runoff is only knowable from round 2 —
// reuse pickElectedMayor (round-2-first) exactly as for município mayors.
// Without this, the Sofia fan-out / district display read the round-1 page
// and arbitrarily picked the lower-ballot-number finalist (often the loser).
const mergeDistrictRounds = (
  tur1Districts: LocalDistrictMayorResult[],
  tur2Districts: LocalDistrictMayorResult[] | undefined,
): LocalDistrictMayorResult[] => {
  const tur2ByName = new Map<string, LocalDistrictMayorResult>();
  for (const d of tur2Districts ?? []) {
    tur2ByName.set(normName(d.districtName), d);
  }
  return tur1Districts.map((d) => {
    const r2 = tur2ByName.get(normName(d.districtName));
    const round2 = r2?.candidates.length ? r2.candidates : undefined;
    return {
      ...d,
      round2,
      elected: pickElectedMayor(d.candidates, round2),
    };
  });
};

// Attach the round-2 (балотаж) table to each кметство and resolve its winner.
// Like районите, CIK's round-1 page marks BOTH runoff finalists with isElected,
// so a kmetstvo that went to a runoff is only decidable from round 2 — reuse
// pickElectedMayor (round-2-first). Without this, the round-1 page is taken
// verbatim and `candidates.find(isElected)` returns whichever finalist appears
// first (often the loser).
const mergeKmetstvoRounds = (
  tur1Kmetstva: LocalKmetstvoResult[],
  tur2Kmetstva: LocalKmetstvoResult[] | undefined,
): LocalKmetstvoResult[] => {
  const tur2ByName = new Map<string, LocalKmetstvoResult>();
  for (const k of tur2Kmetstva ?? []) {
    tur2ByName.set(normName(k.kmetstvoName), k);
  }
  return tur1Kmetstva.map((k) => {
    const r2 = tur2ByName.get(normName(k.kmetstvoName));
    const round2 = r2?.candidates.length ? r2.candidates : undefined;
    return {
      ...k,
      round2,
      elected: pickElectedMayor(k.candidates, round2),
    };
  });
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
    kmetstva: mergeKmetstvoRounds(tur1.kmetstva, tur2?.kmetstva),
    districts: mergeDistrictRounds(tur1.districts, tur2?.districts),
  };
};
