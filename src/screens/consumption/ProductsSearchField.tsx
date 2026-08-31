// The /consumption/products hero search field — `RegistrySearchField` with this page's strings.
//
// ⚠️ THIS FILE IS THE WIRING AND NOTHING ELSE. Every behaviour lives in the shared component:
// the term is COMMITTED on submit rather than sent per keystroke, Esc clears and commits, the
// sr-only description is permanent, the live region is separately mounted, and the floor is
// asked about the box's own value. See `@/screens/components/RegistrySearchField`.
//
// ⚠️ THIS PAGE ALWAYS PASSES `tableVisible`, so it gets no example chips — the shared field
// offers them only on the truly empty state (`!value && !tableVisible`), and this browser never
// hides its table. The placeholder carries the examples instead, which is where they already
// were. That trade is the price of §1 in docs/plans/products-browse-registry-v1.md; do not
// „fix" it by forking the component.

import { FC } from "react";
import { RegistrySearchField } from "@/screens/components/RegistrySearchField";
import {
  PRODUCTS_SEARCH_LABELS,
  PRODUCTS_REGISTRY_ID_PREFIX,
} from "./productsBrowseConstants";

export const ProductsSearchField: FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  applied: string;
  minChars: number;
  tableVisible: boolean;
  resultSummary?: string;
  autoFocus?: boolean;
  className?: string;
}> = (props) => (
  <RegistrySearchField
    {...props}
    labels={PRODUCTS_SEARCH_LABELS}
    idPrefix={PRODUCTS_REGISTRY_ID_PREFIX}
  />
);
