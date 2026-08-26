// The /companies active-filter chips — `RegistryActiveFilters` with this page's strings.
//
// ⚠️ `?obshtina` HAS NO PICKER, SO ITS CHIP IS THE ONLY SURFACE THE DIMENSION HAS. It is
// validated and applied by `useUrlCompanyFilters` with no control of any kind and — unlike its
// /persons namesake — no producer anywhere in the app yet. However it arrives, a table filtered
// to one municipality with nothing on the page naming it is the state this component exists to
// end, so the chip prints the raw CODE when no label resolves rather than rendering nothing.
//
// ⚠️ AND IT MUST NOT BE ROUTED THROUGH `canonicalObshtina()`. That maps the governance routes'
// `SOF00` to `SFO_CITY`, which matches ZERO rows here — this corpus spells Столична община
// `SOF46` (116,306 rows, 35.6% of every placed row). A chip that resolved „Столична община"
// over an empty table would be a confident Bulgarian sentence saying the capital contains no
// companies, which is worse than printing the code.
//
// The strings live in `companiesBrowseConstants.ts`, not here: they must be EXPORTED so a test
// can pin the keys (a rendered assertion cannot — see that file), and exporting a constant from
// a component file breaks Fast Refresh.

import { FC, ReactNode } from "react";
import {
  RegistryActiveFilters,
  type ActiveFilterChip,
} from "@/screens/components/RegistryActiveFilters";
import {
  COMPANIES_CHIP_LABELS,
  COMPANIES_REGISTRY_ID_PREFIX,
} from "./companiesBrowseConstants";

export type { ActiveFilterChip };

export const CompaniesActiveFilters: FC<{
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  children?: ReactNode;
}> = (props) => (
  <RegistryActiveFilters
    {...props}
    labels={COMPANIES_CHIP_LABELS}
    idPrefix={COMPANIES_REGISTRY_ID_PREFIX}
  />
);
