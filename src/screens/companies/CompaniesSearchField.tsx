// The /companies hero search field — its five strings, over the shared RegistrySearchField.
//
// ⚠️ THIS FILE IS THE STRINGS AND NOTHING ELSE, for the reason PersonsSearchField's header
// gives: every behaviour lives once, in the shared component, so the two pages cannot drift
// on the a11y affordances a reviewer skims.

import { FC } from "react";
import {
  RegistrySearchField,
  type RegistrySearchLabels,
} from "@/screens/components/RegistrySearchField";

/** ⚠️ THE HINT NAMES ONLY WHAT THE RESOURCE SEARCHES, and for `companies` that is exactly TWO
 *  columns: `name` (through its transliterated fold) and `uic` (exact, routed by shape). It
 *  does NOT search the seat, the oblast, the legal form or the entity class — those are
 *  pickers — so „търсете по град" would teach a query the engine answers with nothing.
 *
 *  ⚠️ „фирма или организация", never „фирма". ~3.4% of the corpus are сдружения, читалища,
 *  фондации, кооперации, клонове and държавни предприятия — 33,948 rows — and the screen's own
 *  column already refuses to call them all фирми. */
const COMPANIES_SEARCH_LABELS: RegistrySearchLabels = {
  label: {
    key: "companies_search_label",
    fallback: "Търсене на фирма или организация",
  },
  placeholder: {
    key: "companies_search_placeholder",
    fallback: "Търси фирма, организация или ЕИК…",
  },
  hint: {
    key: "companies_search_hint",
    fallback: "Търсете по име на фирма или организация, или по ЕИК.",
  },
  clear: { key: "companies_search_clear", fallback: "Изчисти търсенето" },
  examples: { key: "companies_search_examples", fallback: "например" },
};

export const CompaniesSearchField: FC<{
  value: string;
  onChange: (v: string) => void;
  minChars: number;
  tableVisible: boolean;
  autoFocus?: boolean;
  examples?: string[];
  className?: string;
}> = (props) => (
  <RegistrySearchField
    {...props}
    labels={COMPANIES_SEARCH_LABELS}
    idPrefix="companies"
  />
);
