// The /persons filter row — `RegistryFilterBar` with this page's strings and sentinel.

import { FC, ReactNode } from "react";
import {
  RegistryFilterBar,
  type RegistryFilterSpec,
  type RegistryToggleSpec,
} from "@/screens/components/RegistryFilterBar";
import { PERSON_FILTER_ALL } from "@/data/persons/useUrlPersonFilters";
import {
  PERSONS_FILTER_BAR_LABEL,
  PERSONS_REGISTRY_ID_PREFIX,
} from "./personsBrowseConstants";

export type PersonsFilterSpec = RegistryFilterSpec;
export type PersonsToggleSpec = RegistryToggleSpec;

export const PersonsFilterBar: FC<{
  selects: PersonsFilterSpec[];
  toggles: PersonsToggleSpec[];
  children?: ReactNode;
}> = (props) => (
  <RegistryFilterBar
    {...props}
    label={PERSONS_FILTER_BAR_LABEL}
    allValue={PERSON_FILTER_ALL}
    idPrefix={PERSONS_REGISTRY_ID_PREFIX}
  />
);
