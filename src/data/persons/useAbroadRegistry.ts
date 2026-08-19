import { useEffect, useState } from "react";

/** One declared holding sitting OUTSIDE Bulgaria, as the /api/db/table `abroad_holdings`
 *  resource (matview person_abroad_table, migration 169) delivers it — the matview columns
 *  in camelCase.
 *
 *  ONE ROW PER HOLDING, not per person: a declarant with three foreign accounts contributes
 *  three rows. The register's aggregates are therefore counts of HOLDINGS, never of people.
 *
 *  `valueEur` arrives as a NUMBER, not a string — 169 stores it as `double precision`
 *  precisely because node-postgres serializes a PG `numeric` as a string, which renders
 *  money cells blank while the value is present and correct in the payload. Do not "fix"
 *  the column back to numeric. */
export interface AbroadHoldingRow {
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
  /** Canonical country name, when a cell named one.
   *
   *  ⚠️ NULL IS NOT „unknown place" IN THE SENSE OF A GAP WE COULD CLOSE — it is the norm.
   *  „да" in the „В чужбина" column says abroad and names nowhere, which is 86% of the
   *  latest-scope rows and 91% of the money. Anything grouping by this column is describing
   *  a small minority and must say so. */
  heldCountry: string | null;
  isSpouse: boolean;
  /** null when the filing declared the holding but stated no value. NOT zero — that is a
   *  figure the filing does not state, and the register counts these separately. */
  valueEur: number | null;
  sourceUrl: string;
}

/** The corpus headline, from /api/db/person-abroad-overview (person_abroad_overview(), 169).
 *
 *  Separate from the table's own aggregates because the number this page turns on is a
 *  RATIO, and its denominator is the domestic money the register deliberately excludes.
 *
 *  ⚠️ EVERY MONEY KEY NAMES ITS BASIS. `pctOfInScope` is a share of bank + investment money
 *  — the only two form tables carrying the „В страната" / „В чужбина" pair. The same
 *  numerator against all declared holdings is 2.3%, and against the corpus-wide total 0.8%.
 *  Rendering any of those three without naming which is the failure 169 exists to prevent. */
export interface AbroadOverview {
  peopleAbroad: number;
  rowsAbroad: number;
  /** ⚠️ NULLABLE. `sum()` is NULL over an empty set, so on a database where 169 is applied
   *  but the corpus has not been stamped — the state CLAUDE.md calls INERT, and the one
   *  person_abroad.data.test.ts skips on — every money key here is null while the object
   *  itself is well-formed. A consumer that renders on object PRESENCE publishes a blank
   *  amount beside a bare „%". Use `isRenderableOverview` below. */
  eurAbroad: number | null;
  /** The denominator: bank + investment money on the same latest filings. NOT declared
   *  wealth, and NOT the corpus. Nullable for the reason above. */
  eurInScope: number | null;
  pctOfInScope: number | null;
  /** Rows whose filing ANSWERED the question unintelligibly — both cells blank, both
   *  ticked, or one amount split across them. Counted rather than read as domestic. */
  unresolvedRows: number;
  /** Abroad rows carrying no euro figure. Excluded from `eurAbroad` rather than coerced to
   *  zero, so the total understates by an unknown amount whenever this is non-zero. */
  unvaluedRowsAbroad: number;
  countryNamedRows: number;
  eurCountryNamed: number | null;
}

/** Is this payload safe to render a headline from?
 *
 *  TWO failure shapes, not one, and neither is a null:
 *   - the route's missing-migration sentinel is an ARRAY, and `[]` is truthy;
 *   - a stamped-but-empty corpus yields a well-formed object whose money keys are all NULL.
 *
 *  Both end in the same published defect — an empty amount above „— % от " — which is why
 *  the DENOMINATOR is the render condition rather than the object. Lives here, beside the
 *  interface it protects, so the route contract and the screen guard cannot drift. */
export const isRenderableOverview = (
  v: unknown,
): v is AbroadOverview & {
  eurAbroad: number;
  eurInScope: number;
  pctOfInScope: number;
} => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Partial<AbroadOverview>;
  return (
    typeof o.eurAbroad === "number" &&
    typeof o.eurInScope === "number" &&
    typeof o.pctOfInScope === "number"
  );
};

/** The corpus headline for /declarations/abroad.
 *
 *  `undefined` while in flight, `null` once we know there is nothing renderable — the
 *  screen needs to tell those apart to avoid flashing a card that never arrives.
 *
 *  The fetch lives HERE rather than in the screen because that is where the shape guard
 *  belongs: every comparable /api/db consumer in this repo encapsulates it, and the one
 *  that did not is how the array sentinel reached the render in the first place. */
export const useAbroadOverview = (): AbroadOverview | null | undefined => {
  const [overview, setOverview] = useState<AbroadOverview | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    fetch("/api/db/person-abroad-overview")
      // A 500 or an HTML error body must not reach .json(), where it would throw and land
      // in the same catch as a missing migration — making a real outage look like an
      // un-deployed one.
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: unknown) => live && setOverview(isRenderableOverview(j) ? j : null),
      )
      .catch(() => live && setOverview(null));
    return () => {
      live = false;
    };
  }, []);
  return overview;
};
