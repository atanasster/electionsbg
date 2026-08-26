// The /persons active-filter chips — `RegistryActiveFilters` with this page's strings.

import { FC, ReactNode } from "react";
import {
  RegistryActiveFilters,
  type ActiveFilterChip,
} from "@/screens/components/RegistryActiveFilters";
import {
  PERSONS_CHIP_LABELS,
  PERSONS_REGISTRY_ID_PREFIX,
} from "./personsBrowseConstants";

export type { ActiveFilterChip };

export const PersonsActiveFilters: FC<{
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  children?: ReactNode;
}> = (props) => (
  <RegistryActiveFilters
    {...props}
    labels={PERSONS_CHIP_LABELS}
    idPrefix={PERSONS_REGISTRY_ID_PREFIX}
  />
);
