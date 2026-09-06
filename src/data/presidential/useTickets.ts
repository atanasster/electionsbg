// One cycle's ballot — `<cycle>/tickets.json`.
//
// ⚠ THE COLOUR LIVES ON THE TICKET, and this is the only place it comes from. Every ticket
// carries a `color` and a `colorBasis` the ingest resolved: a party's own colour where the
// nominator is a party this repo has a palette for, and a neutral-palette slot otherwise —
// 17 of 2021's 23 tickets are `neutral-palette`, because an инициативен комитет has no party
// colour to inherit. A map that picked colours itself would give the same pair a different
// colour on every page.
//
// ⚠ A TICKET IS A PERSON, NOT A PARTY. `nominatedBy.kind` is one of party / coalition /
// committee, so resolving a ticket to a canonical party id would mislabel two of the three —
// which is why the surface's ranked rows carry `partyId: null` and a `candidateName`.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface PresidentialTicket {
  /** Ballot position. ⚠ Stable across a cycle's two rounds, meaningless across cycles. */
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: { name: string; kind: string };
  /** ⚠ MAY BE ABSENT. A ticket the ingest could give no colour is drawn in the map's own
   *  fallback grey rather than in some other pair's colour. */
  color?: string;
  colorBasis?: string;
  /** Which rounds this pair stood in. */
  rounds?: number[];
}

export interface PresidentialTickets {
  cycle: string;
  tickets: PresidentialTicket[];
}

const isTickets = (v: unknown): v is PresidentialTickets => {
  if (typeof v !== "object" || v === null) return false;
  const t = (v as Record<string, unknown>).tickets;
  return (
    Array.isArray(t) &&
    t.every(
      (x) =>
        typeof (x as Record<string, unknown>)?.number === "number" &&
        typeof (x as Record<string, unknown>)?.president === "string",
    )
  );
};

export const ticketsPath = (cycle: string): string => `${cycle}/tickets.json`;

export const fetchTickets = async (
  path: string,
): Promise<PresidentialTicket[] | null> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${path}`));
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const body: unknown = await res.json();
    return isTickets(body) ? body.tickets : null;
  } catch {
    return null;
  }
};

/** The cycle's tickets, indexed by ballot number. Empty while loading or unpublished.
 *
 *  ⚠ MEMOISED ON THE FETCHED ARRAY. A fresh `Map` on every render is a new reference, so every
 *  consumer that memoises on it — and the map's sibling `leaders` does — recomputes on every
 *  render of the page, and any child taking it as a prop re-renders with it. The identity is
 *  the point of returning a `Map` at all. */
export const useTicketsByNumber = (
  cycle: string | undefined,
): Map<number, PresidentialTicket> => {
  const path = cycle ? ticketsPath(cycle) : null;
  const { data } = useQuery({
    queryKey: ["presidential_tickets", path],
    queryFn: () => fetchTickets(path!),
    enabled: path !== null,
  });
  return useMemo(() => new Map((data ?? []).map((t) => [t.number, t])), [data]);
};
