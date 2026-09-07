// „Разлика с флаш паметта" for one presidential round — `<cycle>/tur<round>/flash.json`.
//
// ⚠ ABSENT IS THE ANSWER FOR FOUR OF THE FIVE CYCLES AND IT IS NOT A GAP. Only 2021 published
// its machines' СУЕМГ records; 2016 counted votes on machines in 500 of 12,340 round-1 sections
// and never published them, and the three cycles before it had no machine voting at all. So a
// 404 here means „this election has no such document", which is why the surface self-hides
// rather than reporting an error or an empty comparison.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface FlashTicketRow {
  number: number;
  /** What the section commission wrote in the protocol. */
  machineVotes: number;
  /** What the machine itself recorded. */
  flashVotes: number;
}

export interface PresidentialFlashDiff {
  cycle: string;
  round: 1 | 2;
  coverage: {
    protocolSections: number;
    comparedSections: number;
    /** Machine votes in sections the flash export does not reach — see `useFlashDiff`'s note. */
    uncomparedMachineVotes: number;
  };
  tickets: FlashTicketRow[];
}

/** ⚠ EVERY LEAF THE TILE DEREFERENCES. A guard that stopped at „tickets is an array" lets a
 *  truncated file through and the renderer then subtracts `undefined`, printing NaN as a
 *  discrepancy between two official documents. */
const isDiff = (v: unknown): v is PresidentialFlashDiff => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const c = r.coverage as Record<string, unknown> | undefined;
  return (
    typeof c?.comparedSections === "number" &&
    typeof c?.uncomparedMachineVotes === "number" &&
    Array.isArray(r.tickets) &&
    r.tickets.every((t) => {
      const x = t as Record<string, unknown>;
      return (
        typeof x?.number === "number" &&
        typeof x?.machineVotes === "number" &&
        typeof x?.flashVotes === "number"
      );
    })
  );
};

export const useFlashDiff = (
  cycle: string,
  round: 1 | 2,
): PresidentialFlashDiff | undefined => {
  const path = `${cycle}/tur${round}/flash.json`;
  const { data } = useQuery({
    queryKey: ["presidential_flash_diff", path],
    // A settled election's published records; they never change under a reader.
    staleTime: Infinity,
    queryFn: async (): Promise<PresidentialFlashDiff | null> => {
      const res = await fetch(dataUrl(`/${path}`));
      if (!res.ok) return null;
      const body: unknown = await res.json().catch(() => null);
      return isDiff(body) ? body : null;
    },
  });
  return data ?? undefined;
};
