// The /persons hero search field — its five strings, over the shared RegistrySearchField.
//
// ⚠️ THIS FILE IS THE STRINGS AND NOTHING ELSE. Every behaviour it used to hold — Esc clears,
// Enter is a no-op, the permanent sr-only description, the separate always-mounted live
// region, desktop-only autofocus, the example chips, the floor asked about the box's own
// value — moved to `@/screens/components/RegistrySearchField` when /companies needed the same
// control. Forking it would have duplicated ~200 lines of which four were page-specific, and
// the copies would have drifted in exactly the parts a reviewer skims: the two a11y
// affordances that exist because most screen-reader/browser pairs will not announce a region
// that acquires `role="status"` in the same commit as its text.
//
// The public API is unchanged, deliberately: `PersonsSearchField.test.tsx` asserts the
// rendered output, so it goes on holding the shared component's behaviour to /persons'
// contract without knowing the extraction happened.

import { FC } from "react";
import {
  RegistrySearchField,
  type RegistrySearchLabels,
} from "@/screens/components/RegistrySearchField";

/** ⚠️ THE HINT NAMES ONLY WHAT THE RESOURCE SEARCHES. The `persons` resource searches `name`
 *  and `institution`; „община" is in the sentence because an institution name frequently IS
 *  one („Столична община"), not because there is a place arm. Adding a dimension here that the
 *  engine does not search teaches a query the page will answer with nothing. */
const PERSONS_SEARCH_LABELS: RegistrySearchLabels = {
  label: {
    key: "persons_search_label",
    fallback: "Търсене на човек или институция",
  },
  placeholder: {
    key: "persons_search_placeholder",
    fallback: "Търси име или институция…",
  },
  hint: {
    key: "persons_search_hint",
    fallback: "Търсете по име, институция или община.",
  },
  clear: { key: "persons_search_clear", fallback: "Изчисти търсенето" },
  examples: { key: "persons_search_examples", fallback: "например" },
};

export const PersonsSearchField: FC<{
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
    labels={PERSONS_SEARCH_LABELS}
    idPrefix="persons"
  />
);
