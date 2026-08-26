// The /companies filter row — `RegistryFilterBar` with this page's strings and sentinel.
//
// Three labelled pickers (Вид / Състояние / Област) and three toggles (свързана с публично
// лице / с публични средства / спечелила обществена поръчка). The screen builds the specs; this
// file owns only what is /companies-specific about them, and the strings live in
// `companiesBrowseConstants.ts` so a test can pin the keys.

import { FC, ReactNode } from "react";
import {
  RegistryFilterBar,
  type RegistryFilterSpec,
  type RegistryToggleSpec,
} from "@/screens/components/RegistryFilterBar";
import { COMPANY_FILTER_ALL } from "@/data/companies/useUrlCompanyFilters";
import {
  COMPANIES_FILTER_BAR_LABEL,
  COMPANIES_REGISTRY_ID_PREFIX,
} from "./companiesBrowseConstants";

export type CompaniesFilterSpec = RegistryFilterSpec;
export type CompaniesToggleSpec = RegistryToggleSpec;

export const CompaniesFilterBar: FC<{
  selects: CompaniesFilterSpec[];
  toggles: CompaniesToggleSpec[];
  children?: ReactNode;
}> = (props) => (
  <RegistryFilterBar
    {...props}
    label={COMPANIES_FILTER_BAR_LABEL}
    allValue={COMPANY_FILTER_ALL}
    idPrefix={COMPANIES_REGISTRY_ID_PREFIX}
  />
);
