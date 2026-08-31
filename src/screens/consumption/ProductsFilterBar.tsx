// The /consumption/products filter row — `RegistryFilterBar` with this page's strings and
// sentinel.
//
// It lives OUTSIDE `DbDataTable`'s `toolbar` for the reason the shared component's header
// gives: strung along a toolbar beside a search input, several Radix triggers read as
// unlabelled boxes whose only text is whatever happens to be selected — so „Всички групи" and
// „Всички единици" are distinguishable while „Мляко" and „Грамаж (g)" are not, and a
// screen-reader user hears only the value. Outside it, each picker gets a visible, ASSOCIATED
// label. (The page's previous single picker sat in the toolbar and had neither.)

import { FC, ReactNode } from "react";
import {
  RegistryFilterBar,
  type RegistryFilterSpec,
  type RegistryToggleSpec,
} from "@/screens/components/RegistryFilterBar";
import { PRODUCT_FILTER_ALL } from "@/data/prices/useUrlProductFilters";
import {
  PRODUCTS_FILTER_BAR_LABEL,
  PRODUCTS_REGISTRY_ID_PREFIX,
} from "./productsBrowseConstants";

export type ProductsFilterSpec = RegistryFilterSpec;
export type ProductsToggleSpec = RegistryToggleSpec;

export const ProductsFilterBar: FC<{
  selects: ProductsFilterSpec[];
  toggles: ProductsToggleSpec[];
  children?: ReactNode;
}> = (props) => (
  <RegistryFilterBar
    {...props}
    label={PRODUCTS_FILTER_BAR_LABEL}
    allValue={PRODUCT_FILTER_ALL}
    idPrefix={PRODUCTS_REGISTRY_ID_PREFIX}
  />
);
