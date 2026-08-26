// One facet-driven dropdown in a registry browser's filter row — /persons, /companies, and any
// browser that follows.
//
// The shared Radix Select, never a native <select> and never a modal dropdown — a modal one
// locks body scroll behind it (the project's standing UI rule).
//
// ⚠️ AN ACTIVE VALUE ALWAYS GETS AN ITEM, even when the facet does not offer it. Radix renders
// an EMPTY trigger when nothing matches — not the placeholder, empty — so a deep link like
// ?role=X for a code that is nobody's representative role, or ?class=X narrowed out of its own
// facet, shows a blank box over a table that IS filtered: the reader can see the effect and not
// the cause. Live paths reach that on both pages, which is why the rule lives here rather than
// in either.

import { FC } from "react";
import {
  registryOptionLabel,
  registrySelectWillRender,
} from "./registryFilterRules";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RegistryFilterOption {
  value: string;
  label: string;
  /** Omitted where the facet column and the filter column differ — a count that
   *  under-promises what clicking returns is worse than no count. */
  count?: number;
}

export const RegistryFilterSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  options: RegistryFilterOption[];
  allLabel: string;
  /** The „no filter" sentinel this page uses. Both registries spell it `"__all__"`, but each
   *  owns its own constant (`allValue`, `COMPANY_FILTER_ALL`) and this component must
   *  not import either — it would make a shared control depend on one page's URL module. */
  allValue: string;
  /** Accessible name — the trigger otherwise announces only its current value, so a
   *  screen-reader user hears "Кмет" with no indication of which dimension it filters. */
  label?: string;
  /** Id of a VISIBLE label element. Preferred over `label` when present: it associates the
   *  control with text the reader can already see, so the dimension is not announced twice
   *  (once as loose text, once as the control's name) and the two cannot drift apart. */
  labelledBy?: string;
  /** Locale for the count separators. */
  locale?: string;
}> = ({
  value,
  onChange,
  options,
  allLabel,
  allValue,
  label,
  labelledBy,
  locale = "bg-BG",
}) => {
  const items =
    value !== allValue && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options;
  if (!registrySelectWillRender(options, value, allValue)) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-9 w-auto max-w-[220px]"
        {...(labelledBy
          ? { "aria-labelledby": labelledBy }
          : { "aria-label": label ?? allLabel })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allValue}>{allLabel}</SelectItem>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {registryOptionLabel(o, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
