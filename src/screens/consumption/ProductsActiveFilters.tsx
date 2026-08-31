// The /consumption/products active-filter chips — `RegistryActiveFilters` with this page's
// strings.
//
// ⚠️ THE LABELS MUST COME FROM THE SAME RESOLVERS THE PICKERS USE. A chip that named a code the
// picker beside it renders differently — „12" here, „Мляко и млечни продукти" there — is worse
// than no chip, because it reads as a second, unexplained filter. The group chip in particular
// resolves through `usePriceDict`, exactly as its picker does.

import { FC, ReactNode } from "react";
import {
  RegistryActiveFilters,
  type ActiveFilterChip,
} from "@/screens/components/RegistryActiveFilters";
import {
  PRODUCTS_CHIP_LABELS,
  PRODUCTS_REGISTRY_ID_PREFIX,
} from "./productsBrowseConstants";

export type { ActiveFilterChip };

export const ProductsActiveFilters: FC<{
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  children?: ReactNode;
}> = (props) => (
  <RegistryActiveFilters
    {...props}
    labels={PRODUCTS_CHIP_LABELS}
    idPrefix={PRODUCTS_REGISTRY_ID_PREFIX}
  />
);
