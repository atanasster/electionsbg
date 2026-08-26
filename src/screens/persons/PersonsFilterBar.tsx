// The /persons filter row — five facet pickers and two toggles, as LABELLED controls.
//
// IT LIVES HERE RATHER THAN IN `DbDataTable`'s `toolbar` BECAUSE OF TIER 5. Once the page stops
// rendering a table until there is something to show, a filter row inside the table disappears
// with it — leaving a landing whose only way to narrow anything is the search box. Filtering is
// the other half of this page, so the controls have to outlive the table.
//
// The move buys a second thing worth having: room for LABELS. Strung along a toolbar beside a
// search input, five Radix triggers read as five unlabelled boxes whose only text is whatever
// happens to be selected — so „Всички роли" and „Всички партии" are distinguishable and
// „Кмет" and „ГЕРБ" are not, and a screen-reader user hears only the value. The `aria-label` on
// each `PersonFilterSelect` covered the second half; the first needed a layout.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  PersonFilterSelect,
  type PersonFilterOption,
} from "./PersonFilterSelect";

export interface PersonsFilterSpec {
  /** URL param this control owns — the React key, and stable across vocabulary changes. */
  key: string;
  label: string;
  allLabel: string;
  value: string;
  options: PersonFilterOption[];
  onChange: (v: string) => void;
  locale?: string;
}

export interface PersonsToggleSpec {
  key: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export const PersonsFilterBar: FC<{
  selects: PersonsFilterSpec[];
  toggles: PersonsToggleSpec[];
  /** Trailing actions (the CSV export and its note). */
  children?: ReactNode;
}> = ({ selects, toggles, children }) => {
  const { t } = useTranslation();
  if (selects.length === 0 && toggles.length === 0) return null;
  return (
    <section
      aria-label={t("persons_filters_label", { defaultValue: "Филтри" })}
      className="mb-4 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        {selects.map((s) => (
          <div key={s.key} className="flex min-w-0 flex-col gap-1">
            {/* A LABEL, not a placeholder. Radix renders the selected value in the trigger, so
                without this the control's only text is „Кмет" — which says what is chosen and
                not what it filters. */}
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </span>
            <PersonFilterSelect
              value={s.value}
              onChange={s.onChange}
              options={s.options}
              allLabel={s.allLabel}
              label={s.label}
              locale={s.locale}
            />
          </div>
        ))}
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
        {children ? (
          <div className="ml-auto flex flex-wrap items-center gap-3 self-end pb-2">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
};
