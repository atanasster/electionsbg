// The whole-file useMpCars(mp-cars.json) hook was retired in persons-pg-retirement-v1 T2.2:
// the /mp-cars explorer reads the mp_cars registry, the car-makes tiles read the car-makes
// aggregate route, and the region-availability probe reads the same. Only the registry ROW
// TYPE remains, imported by MpCarsScreen.

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
