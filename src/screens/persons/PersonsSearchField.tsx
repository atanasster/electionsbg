// The /persons hero search field — `RegistrySearchField` with this page's strings.
//
// ⚠️ THIS FILE IS THE WIRING AND NOTHING ELSE. Every behaviour it used to hold — Esc clears,
// Enter is a no-op, the permanent sr-only description, the separate always-mounted live region,
// desktop-only autofocus, the example chips, the floor asked about the box's own value — moved
// to `@/screens/components/RegistrySearchField` when /companies needed the same control.
// Forking it would have duplicated ~200 lines of which five were page-specific, and the copies
// would have drifted in exactly the parts a reviewer skims: the two a11y affordances that exist
// because most screen-reader/browser pairs will not announce a region that acquires
// `role="status"` in the same commit as its text.
//
// The public API is unchanged, deliberately: `PersonsSearchField.test.tsx` asserts the rendered
// output, so it goes on holding the shared component's behaviour to /persons' contract without
// knowing the extraction happened.

import { FC } from "react";
import { RegistrySearchField } from "@/screens/components/RegistrySearchField";
import {
  PERSONS_SEARCH_LABELS,
  PERSONS_REGISTRY_ID_PREFIX,
} from "./personsBrowseConstants";

export const PersonsSearchField: FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  applied: string;
  minChars: number;
  tableVisible: boolean;
  resultSummary?: string;
  autoFocus?: boolean;
  examples?: string[];
  className?: string;
}> = (props) => (
  <RegistrySearchField
    {...props}
    labels={PERSONS_SEARCH_LABELS}
    idPrefix={PERSONS_REGISTRY_ID_PREFIX}
  />
);
