// One facet-driven dropdown in the /persons filter row.
//
// The shared Radix Select, never a native <select> and never a modal dropdown — a modal one
// locks body scroll behind it (the project's standing UI rule).
//
// AN ACTIVE VALUE ALWAYS GETS AN ITEM, even when the facet does not offer it. Radix renders
// an EMPTY trigger when nothing matches, so a deep link like ?role=X for a code that is
// nobody's representative role would show a blank box over a table that IS filtered — the
// reader can see the effect but not the cause. Two live paths reach that state: the role and
// party vocabularies are facets of the representative seat while the filter matches every
// seat, and any narrowing can drop the selected value out of its own facet.

import { FC } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERSON_FILTER_ALL } from "@/data/persons/useUrlPersonFilters";

export interface PersonFilterOption {
  value: string;
  label: string;
  /** Omitted where the facet column and the filter column differ — a count that
   *  under-promises what clicking returns is worse than no count. */
  count?: number;
}

export const PersonFilterSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  options: PersonFilterOption[];
  allLabel: string;
  /** Accessible name — the trigger otherwise announces only its current value, so a
   *  screen-reader user hears "Кмет" with no indication of which dimension it filters. */
  label?: string;
  /** Locale for the count separators. */
  locale?: string;
}> = ({ value, onChange, options, allLabel, label, locale = "bg-BG" }) => {
  const items =
    value !== PERSON_FILTER_ALL && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options;
  if (items.length === 0) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-9 w-auto max-w-[220px]"
        aria-label={label ?? allLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PERSON_FILTER_ALL}>{allLabel}</SelectItem>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.count != null ? ` (${o.count.toLocaleString(locale)})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
