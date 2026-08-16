/** One declared-crypto holding as the /api/db/table `crypto_holdings` resource (matview
 *  person_crypto_table, migration 159) delivers it — the matview columns in camelCase.
 *
 *  ONE ROW PER HOLDING, not per person: a declarant with four coins contributes four rows.
 *
 *  `valueEur` and `quantity` arrive as NUMBERS, not strings — 159 stores both as `double
 *  precision` precisely because node-postgres serializes a PG `numeric` as a string, which
 *  renders money cells blank while the value is present and correct in the payload. Do not
 *  "fix" either column back to numeric. */
export interface CryptoHoldingRow {
  holdingKey: string;
  personSlug: string;
  personName: string;
  tier: string;
  institution: string | null;
  positionTitle: string | null;
  /** Annualy | Entry | Vacate | Other — the filing this holding was declared on. */
  declarationType: string;
  /** The year the filing SPEAKS FOR (person_wealth_year.period_year), not the year it was
   *  lodged — the same axis the wealth chart and the profile's filing list use. */
  periodYear: number;
  declarationId: number;
  category: string;
  description: string | null;
  detail: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  isSpouse: boolean;
  valueEur: number | null;
  sourceUrl: string;
}
