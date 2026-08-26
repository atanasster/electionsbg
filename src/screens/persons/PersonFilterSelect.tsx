// The /persons facet dropdown — `RegistryFilterSelect` with this page's „all" sentinel.
//
// ⚠️ THE BEHAVIOUR LIVES ONCE, in `@/screens/components/RegistryFilterSelect`, including the
// rule that matters: an ACTIVE VALUE ALWAYS GETS AN ITEM, because Radix renders an EMPTY
// trigger (not the placeholder) when nothing matches, so a deep link to a value the facet does
// not offer shows a blank box over a table that IS filtered. /companies reaches that state too.

import { FC } from "react";
import {
  RegistryFilterSelect,
  type RegistryFilterOption,
} from "@/screens/components/RegistryFilterSelect";
import { PERSON_FILTER_ALL } from "@/data/persons/useUrlPersonFilters";

export type PersonFilterOption = RegistryFilterOption;

export const PersonFilterSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  options: PersonFilterOption[];
  allLabel: string;
  label?: string;
  labelledBy?: string;
  locale?: string;
}> = (props) => (
  <RegistryFilterSelect {...props} allValue={PERSON_FILTER_ALL} />
);
