// The shared registry hero search field — the page's primary control, not the table's
// accessory. Used by /persons and /companies.
//
// It lives in the head's `search` slot rather than in `DbDataTable`'s toolbar, because a
// search-first page renders no table until there is something to show. That inverts the usual
// arrangement and it costs one thing: `DbDataTable`'s own below-the-floor hint only renders
// inside a table body, so with no table there is nothing to explain why two characters
// produced nothing. The VISIBLE hint below is that explanation, and it renders only when the
// table is absent — otherwise the reader gets the same sentence twice, from two places, in two
// type sizes. The sr-only description is separate and PERMANENT, because a control that loses
// its description half the time is worse than one that never had it.
//
// ⚠️ EVERY STRING A READER SEES IS A `labels` KEY, and that is the whole reason this is
// shared rather than forked. Written for /persons first, it was 211 lines of which FIVE were
// page-specific — the label, the placeholder, the hint, the clear button and the examples
// lead-in — plus the element-id prefix, which is a separate prop because it is not a string a
// reader ever sees. Copying it for
// /companies would have duplicated the Esc/Enter handling, the permanent sr-only description,
// the separate always-mounted live region, the desktop-only autofocus and the reasoning behind
// each — and the two copies would have drifted in exactly the parts a reviewer skims.
//
// ⚠️ THE TERM IS NOT DEBOUNCED HERE. `DbDataTable` debounces it (250 ms) on its way to the
// engine, and the screen debounces it separately on its way to the URL; this component holds
// the value and reports every keystroke, so typing stays instant. Adding a third debounce
// would make the box itself lag behind the keyboard.
//
// ⚠️ IT ASKS THE FLOOR ABOUT ITS OWN `value`, never about the URL — see `minChars`. Reading a
// URL-derived answer beside a box-derived value is a hint that flickers once per third
// character, in the direction that tells a reader with three characters typed to type three
// characters.

import { FC, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { termLength } from "@/ux/data_table/searchTerm";
import { cn } from "@/lib/utils";

/** One translatable string: the key, and its fallback.
 *
 *  ⚠️ SHARED BY THREE COMPONENTS (this one, RegistryFilterBar, RegistryActiveFilters) and kept
 *  here rather than moved to a module of its own: it is four lines with no behaviour, and a
 *  `registryLabels.ts` holding one interface would be a file whose whole content is an import
 *  hop. If a fourth consumer or any logic lands on it, move it then.
 *
 *  ⚠️ THE FALLBACK IS NOT A TEST FIXTURE — it is what EVERY language renders for a key the
 *  corpus lacks. A unit test sees it because there is no i18n instance in jsdom, but production
 *  sees it too, and the fallbacks here are Bulgarian: a key missing from `en/translation.json`
 *  renders Bulgarian to an English reader at a 200, including on an accessible name. Nothing
 *  reports that — `key_usage.test.ts` is one-directional (it finds DEAD keys, not missing ones)
 *  and `i18n.ts`'s missingKey handler heals by pulling bundles rather than warning. So a new
 *  label must land in BOTH corpora in the same change as the component that names it. */
export interface SearchFieldLabel {
  key: string;
  fallback: string;
}

/** The five strings a consuming page owns. Deliberately NOT optional with generic defaults:
 *  a page that forgets one would ship „Търси…" over a corpus of companies, which reads as
 *  correct and is not. */
export interface RegistrySearchLabels {
  /** The sr-only `<label>` — what this box searches. */
  label: SearchFieldLabel;
  /** The input placeholder. */
  placeholder: SearchFieldLabel;
  /** The guidance sentence, shown visibly below the box and always in the sr-only
   *  description. Names the DIMENSIONS the resource actually searches — advertising one it
   *  does not teaches a search the page cannot do. */
  hint: SearchFieldLabel;
  /** The clear button's accessible name. */
  clear: SearchFieldLabel;
  /** The word introducing the example chips („например"). */
  examples: SearchFieldLabel;
}

export const RegistrySearchField: FC<{
  value: string;
  onChange: (v: string) => void;
  /** The page's own strings — see RegistrySearchLabels. */
  labels: RegistrySearchLabels;
  /** Prefixes the generated element ids, so a page with two registry fields mounted (a
   *  mobile/desktop pair) cannot collide with another page's. */
  idPrefix: string;
  /** How many characters the engine needs before it will answer. Below it the field explains
   *  itself rather than letting the page look broken.
   *
   *  ⚠️ THE FIELD ASKS THIS ABOUT ITS OWN `value`, never about the URL. The two are the same
   *  term only when the URL mirror has settled; for the mirror interval after each keystroke
   *  they are that far apart, so a URL-derived answer claims „enter at least 3 characters"
   *  while three sit visibly in the box, and withholds the warning on the way back down. A
   *  screen's `showTable` switch DOES want the URL's reading — „does the URL describe a
   *  query?" is a different question with a legitimately different answer. */
  minChars: number;
  /** Whether the results table is on screen. Suppresses this component's visible hint, because
   *  the table body carries the same sentence. */
  tableVisible: boolean;
  /** Focus on mount, desktop only. FALSE for an arrival that already asked for something — a
   *  filter deep link, a `?q` link — where the reader wanted a list, not a text cursor. */
  autoFocus?: boolean;
  /** Example terms offered as chips on the empty state. A reader who has never used this page
   *  does not know what kind of thing they can type. */
  examples?: string[];
  className?: string;
}> = ({
  value,
  onChange,
  labels,
  idPrefix,
  minChars,
  tableVisible,
  autoFocus = false,
  examples = [],
  className,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  // Not a module constant: two mounted instances (a mobile/desktop pair, a repeat below the
  // fold) would share one id and silently break both `htmlFor` and `aria-describedby`.
  const uid = useId();
  const inputId = `${idPrefix}-search-${uid}`;
  const hintId = `${inputId}-hint`;

  // AUTOFOCUS ON DESKTOP ONLY, AND ONLY ON THE LANDING.
  //   · Not on a phone: focusing an input opens the keyboard over most of the page, so a
  //     landing built to be read would arrive already covered. `matchMedia` rather than a width
  //     check, so a desktop browser at a narrow width is respected too.
  //   · Not on an arrival that already carries a query or a filter. /persons is reached far
  //     more often by deep link (?role=mp, ?court=, ?q=…&decl=1, ?obshtina=) than by a bare
  //     landing, and those readers asked for a list. For a screen-reader user the cost is
  //     concrete: focus jumps past the h1 and the deck, so they never hear which page they
  //     are on or that the corpus includes name-matched private owners.
  useEffect(() => {
    if (!autoFocus) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    ref.current?.focus();
  }, [autoFocus]);

  const trimmed = value.trim();
  const tooShort = trimmed.length > 0 && termLength(trimmed) < minChars;
  const floorHint = t("db_table_search_min", {
    n: minChars,
    defaultValue: `Въведете поне ${minChars} знака.`,
  });

  return (
    <div className={cn("max-w-2xl", className)}>
      <label htmlFor={inputId} className="sr-only">
        {t(labels.label.key, { defaultValue: labels.label.fallback })}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        {/* The SHARED `Input`, resized — not a hand-rolled one. A fork would give the page two
            different focus treatments (the primitive uses `ring-1` and no offset) and would
            drop its `disabled:` pair and `transition-colors` for nothing. */}
        <Input
          id={inputId}
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Esc clears. Enter is a deliberate no-op — results are live, and letting the key
          // submit would reload the page out from under a query that has already run.
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
            }
            if (e.key === "Enter") e.preventDefault();
          }}
          // ALWAYS SET. It points at the sr-only description below, which is permanent, so the
          // page's primary control is never shipped without one — the visible hint comes and
          // goes with `tableVisible`, and an association that came and went with it left a
          // screen-reader user hearing „Търсене…, search" and nothing about the floor.
          aria-describedby={hintId}
          placeholder={t(labels.placeholder.key, {
            defaultValue: labels.placeholder.fallback,
          })}
          className={cn(
            "h-12 pl-10 pr-10 text-base",
            // The UA's own clear button would sit beside ours.
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            aria-label={t(labels.clear.key, {
              defaultValue: labels.clear.fallback,
            })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* PERMANENT and sr-only: the input's description must exist whether or not the visible
          hint does, or the page's primary control ships with none at all. */}
      <span id={hintId} className="sr-only">
        {t(labels.hint.key, { defaultValue: labels.hint.fallback })} {floorHint}
      </span>

      {/* The VISIBLE hint is suppressed whenever the table is up — DbDataTable's body renders
          the same guidance there, and two copies of one sentence read as two problems. */}
      {tableVisible ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          {tooShort
            ? floorHint
            : t(labels.hint.key, { defaultValue: labels.hint.fallback })}
        </p>
      )}

      {/* ⚠️ A SEPARATE, ALWAYS-MOUNTED LIVE REGION, not `role="status"` added to the <p> above.
          Most screen-reader/browser pairs only announce a region whose role was present BEFORE
          the text changed, so a region that acquires the role in the same commit as its new
          text is typically silent — which would make the floor warning, the one sentence that
          exists because nothing else explains the silence, the one least likely to be spoken. */}
      <span role="status" aria-live="polite" className="sr-only">
        {tooShort && !tableVisible ? floorHint : ""}
      </span>

      {/* Examples only on the truly empty state. A reader who has never used this page does not
          know an institution name is a thing they can type here. */}
      {!value && !tableVisible && examples.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t(labels.examples.key, {
              defaultValue: labels.examples.fallback,
            })}
          </span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onChange(ex)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {/* ⚠️ NO COUNT HERE, deliberately. The head band one line above already renders `agg.count`
          as its „Лица" cell — WITH a declared basis, which says which set it counted — and the
          table below renders the same figure twice more (its own toolbar span and the
          aggregates footer). A fourth copy a line under the third is the „same number twice
          reads as two different facts" rule this page has already applied once, when the
          StatCards came out of PersonsAnalysisStrip. */}
    </div>
  );
};
