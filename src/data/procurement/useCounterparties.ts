// Full grouped counterparty list for one entity — DB-backed
// (/api/db/company-counterparties). side="contractor" lists every awarder that
// paid the company (/company/:eik/awarders); side="awarder" lists every
// contractor the state buyer paid (/awarder/:eik/contractors). Complete lists
// (the old JSON rollups capped at top-50), MP-tie badge included inline.

import { useQuery } from "@tanstack/react-query";

export type CounterpartyEntry = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
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
): Promise<CounterpartiesPayload | null> => {
  const r = await fetch(
    `/api/db/company-counterparties?eik=${encodeURIComponent(eik)}&side=${side}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as CounterpartiesPayload;
};

export const useCounterparties = (
  eik: string | undefined,
  side: "contractor" | "awarder",
) =>
  useQuery({
    queryKey: ["db", "company-counterparties", eik ?? "", side] as const,
    queryFn: () => fetchCounterparties(eik as string, side),
    enabled: !!eik,
    staleTime: Infinity,
  });
