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
// ⚠️ THE TERM IS COMMITTED, NOT LIVE, AND THAT IS THE WHOLE SHAPE OF THIS COMPONENT. `value` is
// a DRAFT the reader is typing; nothing downstream sees it until `onSubmit` fires — from the
// button, from Enter, from Esc, from the clear ×, or from an example chip. Two things follow,
// and both are the point:
//   · the box no longer costs a query per keystroke, so there is no URL debounce left to get
//     wrong (`?q` is written once, by the submit) and no engine request for „ив" on the way to
//     „иванов";
//   · the results on screen can legitimately disagree with the box, so the field OWES the
//     reader a statement of that. `applied` is what it compares against, and the „натиснете
//     Търси" line below is the statement. A field given no `applied` cannot make it.
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
// ⚠️ THE DRAFT IS NOT DEBOUNCED HERE. This component holds the value and reports every
// keystroke, so typing stays instant; the debounce that remains (250 ms inside `DbDataTable`,
// on the committed term's way to the engine) is downstream of the submit and can no longer see
// a half-typed word at all.
//
// ⚠️ IT ASKS THE FLOOR ABOUT ITS OWN `value`, never about the URL — see `minChars`. Reading a
// URL-derived answer beside a box-derived value is a hint that flickers once per third
// character, in the direction that tells a reader with three characters typed to type three
// characters.

import { FC, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

/** The strings a consuming page owns. Deliberately NOT optional with generic defaults:
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
  /** The submit button's own label („Търси"). */
  submit: SearchFieldLabel;
  /** One line saying the box and the results disagree — shown while the draft differs from
   *  `applied`. It is the whole cost of committing on submit, made visible. */
  pending: SearchFieldLabel;
}

export const RegistrySearchField: FC<{
  /** The DRAFT: what is in the box. Reported on every keystroke, sent nowhere. */
  value: string;
  onChange: (v: string) => void;
  /** Commit. Called with the term to apply, never reading `value` itself — the clear × and the
   *  example chips submit a value that is not the one in state yet, and a parent that read its
   *  own state in the handler would commit the term the reader just replaced. */
  onSubmit: (v: string) => void;
  /** The term the RESULTS on screen were computed under — normally the page's `?q`. The field
   *  compares its draft against it to say „натиснете Търси"; it is required rather than
   *  optional because a page that omits it silently loses the only signal that the two states
   *  have diverged, and the divergence is what committing on submit introduces. */
  applied: string;
  /** The page's own strings — see RegistrySearchLabels. */
  labels: RegistrySearchLabels;
  /** Prefixes the generated element ids, so a page with two registry fields mounted (a
   *  mobile/desktop pair) cannot collide with another page's. */
  idPrefix: string;
  /** How many characters the engine needs before it will answer. Below it the field explains
   *  itself rather than letting the page look broken.
   *
   *  ⚠️ THE FIELD ASKS THIS ABOUT ITS OWN `value`, never about the URL. A screen's `showTable`
   *  switch DOES want the URL's reading — „does the URL describe a query?" is a different
   *  question with a legitimately different answer.
   *
   *  ⚠️ IT DOES NOT DISABLE THE SUBMIT. A sub-floor term is committed like any other and the
   *  floor is enforced downstream (`queryIsSendable` keeps the table shut, `DbDataTable`
   *  suppresses the term on its way to the engine), so the reader gets the sentence explaining
   *  why rather than a dead button with no explanation beside it. */
  minChars: number;
  /** Whether the results table is on screen. Suppresses this component's guidance line, because
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
  onSubmit,
  applied,
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
  // „the box and the results disagree". Compared TRIMMED on both sides, so trailing whitespace
  // — which `readQueryParam` deliberately does not strip, because a trimmed „Иван Иванов"
  // becomes one token that matches nothing — is not by itself an un-applied change.
  const dirty = trimmed !== applied.trim();
  const floorHint = t("db_table_search_min", {
    n: minChars,
    defaultValue: `Въведете поне ${minChars} знака.`,
  });
  const guidance = t(labels.hint.key, { defaultValue: labels.hint.fallback });
  const pendingHint = t(labels.pending.key, {
    defaultValue: labels.pending.fallback,
  });

  // ONE line, four states, in priority order.
  //
  //   · the FLOOR, unless the table below is already saying it about the same term. That
  //     exception used to be a flat `!tableVisible` and cannot be any more: with the term
  //     committed rather than live, a sub-floor DRAFT beside a table showing some other term's
  //     results is a state the table body knows nothing about, so suppressing it there would
  //     leave „ив" explained by nothing at all.
  //   · then the disagreement, because it is about something the reader just did;
  //   · then the standing guidance, and only where the table is not carrying it.
  const floorIsOurs = tooShort && (!tableVisible || dirty);
  const visibleHint = floorIsOurs
    ? floorHint
    : dirty
      ? pendingHint
      : tableVisible
        ? null
        : guidance;

  const submit = (v: string) => {
    onChange(v);
    onSubmit(v);
  };

  return (
    // A REAL <form>, so Enter commits the way every search box on the web does, without this
    // component having to reimplement it on the input's keydown. `role="search"` names the
    // landmark; the handler's preventDefault is what stops the browser reloading the SPA.
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      className={cn("max-w-2xl", className)}
    >
      <label htmlFor={inputId} className="sr-only">
        {t(labels.label.key, { defaultValue: labels.label.fallback })}
      </label>
      <div className="flex items-start gap-2">
        <div className="relative min-w-0 flex-1">
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
            // Esc clears AND commits. Clearing is unambiguous — nobody presses Esc meaning
            // „empty the box but keep showing the old results" — and leaving it uncommitted
            // would put the page in exactly the disagreeing state the × avoids.
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                submit("");
              }
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
                submit("");
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
        {/* NOT disabled below the floor — see `minChars`. A disabled primary action with its
            explanation suppressed (which is what `tableVisible` does to the line below) is a
            page that has stopped responding for no stated reason. */}
        <Button type="submit" className="h-12 shrink-0 px-5 text-base">
          {t(labels.submit.key, { defaultValue: labels.submit.fallback })}
        </Button>
      </div>

      {/* PERMANENT and sr-only: the input's description must exist whether or not the visible
          hint does, or the page's primary control ships with none at all. */}
      <span id={hintId} className="sr-only">
        {guidance} {floorHint}
      </span>

      {visibleHint ? (
        <p className="mt-2 text-xs text-muted-foreground">{visibleHint}</p>
      ) : null}

      {/* ⚠️ A SEPARATE, ALWAYS-MOUNTED LIVE REGION, not `role="status"` added to the <p> above.
          Most screen-reader/browser pairs only announce a region whose role was present BEFORE
          the text changed, so a region that acquires the role in the same commit as its new
          text is typically silent — which would make the floor warning, the one sentence that
          exists because nothing else explains the silence, the one least likely to be spoken. */}
      <span role="status" aria-live="polite" className="sr-only">
        {floorIsOurs ? floorHint : dirty ? pendingHint : ""}
      </span>

      {/* Examples only on the truly empty state. A reader who has never used this page does not
          know an institution name is a thing they can type here. They SUBMIT rather than fill
          the box: a chip is a whole question, not the start of one. */}
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
              onClick={() => submit(ex)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {/* ⚠️ NO COUNT HERE, deliberately. With a table up the row count sits directly above it,
          and on the landing there is nothing to count. A figure here would also be the fourth
          copy of one number on pages that still render a head band — the „same number twice
          reads as two different facts" rule this page has already applied twice. */}
    </form>
  );
};
