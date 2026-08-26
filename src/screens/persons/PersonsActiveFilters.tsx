// The active-filter chips on /persons — one removable chip per applied narrowing.
//
// WHY THIS EXISTS AND WHY IT IS NOT COSMETIC. Most arrivals at this page are a FILTER rather
// than a query — `?role=mp` from /parliament, `?court=` from /court/:code, `?role=…` from
// /culture, `?q=…&decl=1` from the declarations search. A reader arriving through one saw a
// narrowed table and, to find out why, had to open five dropdowns and read their selected
// values.
//
// ⚠️ AND TWO NARROWINGS HAVE NO DROPDOWN AT ALL. `?position` and `?obshtina` are validated and
// applied by the hook and have no control of any kind — the screen's own note calls them
// "deep-link / cross-link target only … the setter exists for a future control". Nothing in
// the app produces either today (grep: zero `/persons` hrefs carrying them), so they arrive by
// hand-built link, by an AI tool, or from a governance tile not yet wired. However they arrive,
// the result before these chips was a table filtered to one municipality with nothing on the
// page naming it and no way to widen it. Those two are why this component exists; the other
// nine are why it is legible.
//
// ⚠️ THE LABELS COME FROM THE SAME RESOLVERS THE PICKERS USE. A chip that named a code the
// picker beside it renders differently — „p_16" here, „Народен представител" there — is worse
// than no chip, because it reads as a second, unexplained filter. Every label below is resolved
// through `usePersonLabels` / `useCanonicalParties` / `oblastName`, i.e. the picker's own
// vocabulary; a value with no label falls back to the raw code rather than to nothing, so a
// deep link with an unfamiliar value still shows the reader what is applied.

import { FC, ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

export interface ActiveFilterChip {
  /** Stable identity. The VALUE is not enough — two dimensions can carry the same code. */
  id: string;
  /** Which dimension, in the reader's words („Роля"). Omitted for a toggle, whose label is
   *  already a whole sentence („само с декларация"). */
  dimension?: string;
  label: string;
  onRemove: () => void;
}

export const PersonsActiveFilters: FC<{
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  /** Rendered after the chips — the CSV export, a count, whatever the page wants beside them. */
  children?: ReactNode;
}> = ({ chips, onClearAll, children }) => {
  const { t } = useTranslation();
  const uid = useId();
  const labelId = `persons-active-filters-${uid}`;
  if (chips.length === 0 && !children) return null;
  return (
    // A LABELLED GROUP, not a bare row: „Показани са само:" is otherwise loose text with no
    // relationship to the chips it introduces, so a reader who tabs straight to a chip hears
    // its own label (which is good) and never the framing.
    <div
      role="group"
      aria-labelledby={chips.length > 0 ? labelId : undefined}
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      {chips.length > 0 ? (
        <span id={labelId} className="text-xs text-muted-foreground">
          {t("persons_active_filters", { defaultValue: "Показани са само:" })}
        </span>
      ) : null}
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={c.onRemove}
          // The whole chip is the control, not just the ×. A 12 px glyph is a poor target on a
          // phone, and there is nothing else a reader could want to do with a chip.
          //
          // ⚠️ CONCATENATED, not interpolated. „Бургас ×" alone tells a screen-reader user a
          // value and not which axis it filters, and this page has two axes (oblast, obshtina)
          // whose values look alike — so the dimension has to be IN the accessible name. It is
          // appended rather than passed through `{{label}}` because the verb and the value have
          // different sources: the verb is translated copy, the value is corpus text already
          // resolved through the picker's own label helpers.
          aria-label={`${t("persons_remove_filter", {
            defaultValue: "Премахни филтър",
          })} ${c.dimension ? `${c.dimension}: ` : ""}${c.label}`}
          className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 pr-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.dimension ? (
            <span className="text-muted-foreground">{c.dimension}:</span>
          ) : null}
          <span className="font-medium">{c.label}</span>
          <X
            aria-hidden
            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground"
          />
        </button>
      ))}
      {chips.length > 0 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-primary underline underline-offset-2 hover:no-underline"
        >
          {t("contracts_clear_filters", { defaultValue: "Изчисти филтрите" })}
        </button>
      ) : null}
      {children}
    </div>
  );
};
