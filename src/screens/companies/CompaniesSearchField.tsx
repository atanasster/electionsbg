// The /companies hero search field — `RegistrySearchField` with this page's strings.
//
// ⚠️ THIS FILE IS THE WIRING AND NOTHING ELSE. Every behaviour lives once, in the shared
// component, so the two registry pages cannot drift on the a11y affordances a reviewer skims.
// The strings live in `companiesBrowseConstants.ts` so a test can pin the KEYS — a rendered
// assertion cannot, because `t` returns `defaultValue` with no i18n instance and several
// fallbacks are byte-identical to /persons'.

import { FC } from "react";
import { RegistrySearchField } from "@/screens/components/RegistrySearchField";
import {
  COMPANIES_SEARCH_LABELS,
  COMPANIES_REGISTRY_ID_PREFIX,
} from "./companiesBrowseConstants";

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
    idPrefix={COMPANIES_REGISTRY_ID_PREFIX}
  />
);
