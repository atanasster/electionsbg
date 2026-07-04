// Full grouped counterparty list for one entity — DB-backed
// (/api/db/company-counterparties). side="contractor" lists every awarder that
// paid the company (/company/:eik/awarders); side="awarder" lists every
// contractor the state buyer paid (/awarder/:eik/contractors). Complete lists
// (the old JSON rollups capped at top-50), MP-tie badge included inline.

import { keepPreviousData, useQuery } from "@tanstack/react-query";

export type CounterpartyEntry = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  /** Only meaningful for side="awarder" (contractors can be MP-tied);
   *  always false on the awarders-of-a-company side. */
  mpTied: boolean;
};

export type CounterpartiesPayload = {
  eik: string;
  side: "contractor" | "awarder";
  name: string | null;
  entries: CounterpartyEntry[];
};

const fetchCounterparties = async (
  eik: string,
  side: "contractor" | "awarder",
  from: string | null,
  to: string | null,
): Promise<CounterpartiesPayload | null> => {
  const r = await fetch(
    `/api/db/company-counterparties?eik=${encodeURIComponent(eik)}&side=${side}` +
      (from ? `&from=${from}` : "") +
      (to ? `&to=${to}` : ""),
  );
  if (!r.ok) return null;
  return (await r.json()) as CounterpartiesPayload;
};

// from/to (inclusive, YYYY-MM-DD | null) narrow the list to a date window — the
// scope pill on the standalone counterparty pages. Omit both for the full corpus.
export const useCounterparties = (
  eik: string | undefined,
  side: "contractor" | "awarder",
  from: string | null = null,
  to: string | null = null,
) =>
  useQuery({
    queryKey: [
      "db",
      "company-counterparties",
      eik ?? "",
      side,
      from,
      to,
    ] as const,
    queryFn: () => fetchCounterparties(eik as string, side, from, to),
    enabled: !!eik,
    staleTime: Infinity,
    retry: false,
    // Keep the prior window's rows on screen while a scope switch refetches, so
    // the scope pill and table don't flash to a skeleton on every toggle.
    placeholderData: keepPreviousData,
  });
