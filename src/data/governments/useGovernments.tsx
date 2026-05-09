import { useQuery } from "@tanstack/react-query";

export type GovernmentEndReason =
  | "term_end"
  | "election"
  | "snap_election"
  | "no_confidence"
  | "resignation"
  | "rotation_failed"
  | "incumbent";

export type Government = {
  id: string;
  pmBg: string;
  pmEn: string;
  startDate: string;
  endDate: string | null;
  type: "regular" | "caretaker";
  parties: string[];
  partiesEn: string[];
  /** Optional prior party affiliation of the PM personally. Set for caretakers
   * who came from a parliamentary party and were appointed in a non-partisan
   * capacity (e.g. Glavchev was a long-time GERB MP; Gyurov is a PP MP). For
   * regular cabinets we use parties[0] as the PM's party, so this field stays
   * undefined there. */
  pmPartyBg?: string;
  pmPartyEn?: string;
  precedingElection?: string;
  endReason: GovernmentEndReason;
  endReasonBg: string;
  endReasonEn: string;
  source: string;
};

type GovernmentsPayload = {
  governments: Government[];
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(path);
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useGovernments = () =>
  useQuery({
    queryKey: ["governments"],
    queryFn: async () => {
      const payload = await fetchJson<GovernmentsPayload>("/governments.json");
      return payload?.governments ?? [];
    },
  });
