// The contract rows the roads engine (src/lib/roadAttributes.ts) reads, in the
// casing it reads them — ONE definition for every Node-side consumer.
//
// The browser gets the same rows from `/api/db/awarder-contracts`
// (functions/db_routes.js), which a TS module cannot share with a CommonJS
// route. So the route's SELECT is the second copy, and
// roads_hub_figures.data.test.ts asserts every alias here is also selected
// there — the drift that matters is a column the engine reads going missing
// from one side, which would make the hub and the sub-pages count different
// rows with both looking correct. (The BUYER SET is a separate agreement: the
// sub-pages must model ROADS_SECTOR_EIKS too — plan T4.)

export const ROAD_ROW_COLUMNS = [
  `key`,
  `tag`,
  `date`,
  `contractor_eik AS "contractorEik"`,
  `contractor_name AS "contractorName"`,
  `amount_eur AS "amountEur"`,
  `signing_amount_eur AS "signingAmountEur"`,
  `title`,
  `cpv`,
  `procurement_method AS "procurementMethod"`,
  `number_of_tenderers AS "numberOfTenderers"`,
  `consortium_role AS "consortiumRole"`,
] as const;

/** Every row (all tags — the engine drops amendments itself) for a buyer set. */
export const ROAD_ROWS_SQL = `SELECT ${ROAD_ROW_COLUMNS.join(", ")}
  FROM contracts WHERE awarder_eik = ANY($1)`;

/** The output name of each column — what the engine sees. */
export const roadRowAliases = (): string[] =>
  ROAD_ROW_COLUMNS.map((c) => {
    const m = /AS "(\w+)"$/.exec(c);
    return m ? m[1] : c;
  });
