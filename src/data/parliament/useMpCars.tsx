import { useQuery } from "@tanstack/react-query";
import type { MpCarsFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

/** One declared-vehicle row as the /api/db/table `mp_cars` resource (matview mp_cars_table,
 *  migration 105) delivers it — the matview columns in camelCase. ONE ROW PER CAR. Money
 *  columns (valueEur/amount) arrive as STRINGS (Postgres numeric); parse with eur().
 *  (persons-pg-retirement-v1 T2.2) */
export interface MpCarRegistryRow {
  carId: number;
  mpId: number;
  personSlug: string | null;
  mpName: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  /** Canonical make, or null when the declarant's text matched no brand alias. */
  make: string | null;
  detail: string | null;
  description: string | null;
  acquiredYear: number | null;
  valueEur: string | null;
  amount: string | null;
  currency: string | null;
  isSpouse: boolean;
  share: string | null;
  mergedFromCount: number;
  declarationYear: number;
  sourceUrl: string;
}

const queryFn = async (): Promise<MpCarsFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/mp-cars.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useMpCars = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_cars"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { mpCars: data, isLoading };
};
