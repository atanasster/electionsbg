// Fan out the local-election bundles for a given município across all
// cycles in the catalogue and return every contest a person by `name`
// stood in. Used by the "Contests stood in" spine on
// OfficialProfileScreen — gives a unified view of an official's
// participation in mayor / councillor / kmetstvo mayor / район mayor
// races spanning every regular cycle we have data for (mi2019, mi2023,
// future mi2027 …).
//
// Reuses ["local_municipality_history", cycle, obshtinaCode] queryKeys
// from useLocalMunicipalityHistory so the cache is shared with the My-
// Area history strip on the same município.
//
// Name match is conservative: lowercase + whitespace-collapse against
// candidateName. Homonyms across cycles in the same município are rare
// in practice but possible — we return every match, the UI can disclose
// the inevitable noise via cycle context.

import { useMemo } from "react";
import { useLocalMunicipalityHistory } from "./useLocalMunicipalityHistory";

export type LocalContestRole =
  | "mayor_obshtina"
  | "councillor"
  | "mayor_kmetstvo"
  | "mayor_rayon";

export type LocalContestRow = {
  cycle: string;
  round1Date: string;
  role: LocalContestRole;
  /** For councillor rows: party name from the slate. For mayor rows: the
   *  party row of the mayor candidate. */
  partyName: string;
  partyCanonicalId: string | null;
  /** "Mayor of Кметство Х" / "Mayor of Район Х" subtitle. Null for the
   *  município-mayor + councillor roles. */
  scopeLabel: string | null;
  votes: number;
  pctOfValid: number;
  /** Round (1 or 2) for mayor races; null for councillor rows. */
  round: 1 | 2 | null;
  /** Council seat allocation when the row is a councillor candidacy on a
   *  slate that won mandates — purely informational. */
  partyMandatesWon?: number;
  isElected: boolean;
};

const norm = (s: string): string =>
  s.trim().toLocaleLowerCase("bg").replace(/\s+/g, " ");

export const useOfficialLocalContests = (
  obshtinaCode?: string | null,
  name?: string | null,
): { rows: LocalContestRow[]; isLoading: boolean } => {
  const { rows: history, isLoading } =
    useLocalMunicipalityHistory(obshtinaCode);

  const contestRows = useMemo<LocalContestRow[]>(() => {
    if (!name) return [];
    const target = norm(name);
    const out: LocalContestRow[] = [];
    for (const h of history) {
      if (!h.bundle) continue;
      const { cycle, round1Date } = h;

      // Municipal-mayor candidates — both rounds.
      const mayorRounds: {
        round: 1 | 2;
        rows: typeof h.bundle.mayor.round1;
      }[] = [{ round: 1, rows: h.bundle.mayor.round1 }];
      if (h.bundle.mayor.round2) {
        mayorRounds.push({ round: 2, rows: h.bundle.mayor.round2 });
      }
      for (const { round, rows } of mayorRounds) {
        for (const m of rows) {
          if (norm(m.candidateName) !== target) continue;
          out.push({
            cycle,
            round1Date,
            role: "mayor_obshtina",
            partyName: m.localPartyName,
            partyCanonicalId: m.primaryCanonicalId,
            scopeLabel: null,
            votes: m.votes,
            pctOfValid: m.pctOfValid,
            round,
            isElected: m.isElected,
          });
        }
      }

      // Councillor slate rows — flatten LocalCouncilParty.candidates.
      for (const p of h.bundle.council) {
        for (const c of p.candidates) {
          if (norm(c.name) !== target) continue;
          out.push({
            cycle,
            round1Date,
            role: "councillor",
            partyName: p.localPartyName,
            partyCanonicalId: p.primaryCanonicalId,
            scopeLabel: null,
            votes: c.prefVotes,
            pctOfValid: c.prefPct,
            round: null,
            partyMandatesWon: p.mandatesWon,
            isElected: c.isElected,
          });
        }
      }

      // Kmetstvo mayor races — one section per village.
      for (const k of h.bundle.kmetstva) {
        for (const c of k.candidates) {
          if (norm(c.candidateName) !== target) continue;
          out.push({
            cycle,
            round1Date,
            role: "mayor_kmetstvo",
            partyName: c.localPartyName,
            partyCanonicalId: c.primaryCanonicalId,
            scopeLabel: k.kmetstvoName,
            votes: c.votes,
            pctOfValid: c.pctOfValid,
            round: c.round,
            isElected: c.isElected,
          });
        }
      }

      // Район mayor races — Sofia districts, Plovdiv / Varna inner shards.
      for (const d of h.bundle.districts) {
        for (const c of d.candidates) {
          if (norm(c.candidateName) !== target) continue;
          out.push({
            cycle,
            round1Date,
            role: "mayor_rayon",
            partyName: c.localPartyName,
            partyCanonicalId: c.primaryCanonicalId,
            scopeLabel: d.districtName,
            votes: c.votes,
            pctOfValid: c.pctOfValid,
            round: c.round,
            isElected: c.isElected,
          });
        }
      }
    }
    // Sort newest → oldest; within the same cycle, mayor R2 → mayor R1
    // → councillor → kmetstvo / район last so the user's most
    // significant local-government role surfaces first.
    const roleOrder: Record<LocalContestRole, number> = {
      mayor_obshtina: 0,
      mayor_rayon: 1,
      mayor_kmetstvo: 2,
      councillor: 3,
    };
    return out.sort((a, b) => {
      if (a.round1Date !== b.round1Date)
        return b.round1Date.localeCompare(a.round1Date);
      if (roleOrder[a.role] !== roleOrder[b.role])
        return roleOrder[a.role] - roleOrder[b.role];
      // mayor R2 before R1 within the same race.
      return (b.round ?? 0) - (a.round ?? 0);
    });
  }, [history, name]);

  return { rows: contestRows, isLoading };
};
