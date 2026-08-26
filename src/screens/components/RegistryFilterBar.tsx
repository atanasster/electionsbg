// A registry browser's filter row — facet pickers and toggles, as LABELLED controls. Used by
// /persons and /companies.
//
// IT LIVES OUTSIDE `DbDataTable`'s `toolbar` BECAUSE OF THE SEARCH-FIRST LANDING. Once a page
// stops rendering a table until there is something to show, a filter row inside the table
// disappears with it — leaving a landing whose only way to narrow anything is the search box.
// Filtering is the other half of these pages, so the controls have to outlive the table.
//
// The move buys a second thing worth having: room for LABELS. Strung along a toolbar beside a
// search input, several Radix triggers read as unlabelled boxes whose only text is whatever
// happens to be selected — so „Всички роли" and „Всички партии" are distinguishable while
// „Кмет" and „ГЕРБ" are not, and a screen-reader user hears only the value. The `aria-labelledby`
// on each select covers the second half; the first needed a layout.
//
// NO EMPTY GUARD on the section itself: every consuming page renders at least one unconditional
// control, so an entirely empty bar does not occur in the app. (It is trivially constructible in
// a test, and both pages' suites do construct partial ones — the original wording claimed „no
// test can cover" it, which was wrong; what is true is that no PAGE reaches it, so a guard would
// be untested behaviour rather than untestable behaviour.) Individual pickers DO self-suppress
// — see the `registrySelectWillRender` check below.

import { FC, ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  RegistryFilterSelect,
  type RegistryFilterOption,
} from "./RegistryFilterSelect";
import { registrySelectWillRender } from "./registryFilterRules";
import type { SearchFieldLabel } from "./RegistrySearchField";

export interface RegistryFilterSpec {
  /** URL param this control owns — the React key, and stable across vocabulary changes. */
  key: string;
  label: string;
  allLabel: string;
  value: string;
  options: RegistryFilterOption[];
  onChange: (v: string) => void;
  locale?: string;
}

export interface RegistryToggleSpec {
  key: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export const RegistryFilterBar: FC<{
  selects: RegistryFilterSpec[];
  toggles: RegistryToggleSpec[];
  /** The section's accessible name. */
  label: SearchFieldLabel;
  /** The „no filter" sentinel, forwarded to every select. */
  allValue: string;
  /** Prefixes the generated label ids.
   *
   *  ⚠️ NOT collision prevention — `useId()` already guarantees uniqueness per mounted
   *  instance, proved by `PersonsFilterBar.test.tsx` mounting two bars with the SAME prefix and
   *  getting distinct ids. What it buys is LEGIBILITY: an id that names its page and its
   *  dimension (`companies-filter-class-«r3»`) is greppable in a DOM dump and gives a test a
   *  stable hook for „is this the companies bar", which is the one thing a rendered assertion
   *  can check about a wrapper whose i18n fallbacks match its sibling's. */
  idPrefix: string;
  /** Trailing actions (the CSV export and its note). */
  children?: ReactNode;
}> = ({ selects, toggles, label, allValue, idPrefix, children }) => {
  const { t } = useTranslation();
  const uid = useId();
  return (
    <section
      aria-label={t(label.key, { defaultValue: label.fallback })}
      className="mb-4 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        {selects.map((s) => {
          // ⚠️ THE LABEL FOLLOWS THE CONTROL. The select renders nothing for an empty
          // vocabulary with nothing selected, and a label with no control under it is „ВИД"
          // floating over blank space plus an `aria-labelledby` pointing at a control that
          // does not exist. Reachable on a cold mount, before the facets resolve.
          if (!registrySelectWillRender(s.options, s.value, allValue))
            return null;
          const labelId = `${idPrefix}-filter-${s.key}-${uid}`;
          return (
            <div key={s.key} className="flex min-w-0 flex-col gap-1">
              {/* A LABEL, not a placeholder — and ASSOCIATED, not merely adjacent. Radix renders
                  the selected value in the trigger, so without this the control's only text is
                  „Кмет", which says what is chosen and not what it filters. `aria-labelledby`
                  rather than a second `aria-label` string: a screen reader then announces the
                  dimension once (as the control's name) instead of twice (loose text, then
                  name), and the visible and announced labels cannot drift apart. */}
              <span
                id={labelId}
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {s.label}
              </span>
              <RegistryFilterSelect
                value={s.value}
                onChange={s.onChange}
                options={s.options}
                allLabel={s.allLabel}
                allValue={allValue}
                labelledBy={labelId}
                locale={s.locale}
              />
            </div>
          );
        })}
        {toggles.length > 0 ? (
          // Aligned to the pickers' BASELINE, not their top: they carry a label line above
          // them, so a top-aligned checkbox floats level with the caption instead of the box.
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 self-end pb-2">
            {toggles.map((tg) => (
              <label
                key={tg.key}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <input
                  type="checkbox"
                  checked={tg.checked}
                  onChange={(e) => tg.onChange(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {tg.label}
              </label>
            ))}
          </div>
        ) : null}
        {/* NOT `ml-auto`: in a WRAPPING row it pushes this block to the right edge of whatever
            line it happens to land on, which on a narrow viewport is a lone control floated
            away from the group it belongs to. */}
        {children ? (
          <div className="flex flex-wrap items-center gap-3 self-end pb-2">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
};
