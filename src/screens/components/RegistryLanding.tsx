// What a search-first registry browser shows INSTEAD of a table, when nothing has been searched
// or filtered. Used by /persons and /companies.
//
// /persons used to open on 137,461 people sorted by prominence; /companies opens on €2.43bn
// СОФАРМА ТРЕЙДИНГ and five more of the same, unchanged on every arrival, forever. Both are a
// list nobody asked for, answering no question, costing a full-corpus query per arrival. This is
// what replaces them, and the design problem it solves is that a search box with nothing under
// it tells a reader neither what is in here nor what they are allowed to type.
//
// TWO WAYS IN, and each page fills them differently:
//   · the block ABOVE the cards — /persons passes its mix bar, which partitions the corpus so
//     every segment is both an answer and a way through; /companies passes nothing, because its
//     corpus breakdown is the head's evidence aside and offering it twice is noise;
//   · the CARDS are the cross-cutting queries no single picker can express.
//
// ⚠️ EVERY COUNT COMES FROM A FACET ALREADY IN FLIGHT. Not one is a constant. These corpora move
// under the page — a contracts, agri, funds, TR or person-layer reload rewrites columns
// `company_browse_table` reads — so a hard-coded figure is right on the day it is typed and
// wrong for as long as nobody checks. A card whose count has not arrived renders WITHOUT one
// rather than with a zero; a card whose count IS zero does not render at all, because it is a
// promise of rows that a click would not keep.

import { FC, ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { SearchFieldLabel } from "./RegistrySearchField";

/** The two strings a consuming page owns here. */
export interface RegistryLandingLabels {
  /** The card section's heading („Започнете оттук"). */
  startHere: SearchFieldLabel;
  /** The accessible name of a count that has not arrived („зарежда се"). */
  loading: SearchFieldLabel;
}

export interface LandingCard {
  key: string;
  label: string;
  /** One line saying what the query actually asks. */
  hint: string;
  /** THREE states, and the producer can emit all three.
   *    `undefined` — the facet has not answered; renders „—" and keeps its place in the grid.
   *    `0`         — the facet answered NONE; the card is suppressed (it would promise rows a
   *                  click cannot show). Reachable: at `?sector=private` tier V has 0
   *                  declarations and 0 held-office, so two of the four cards are legitimately
   *                  zero. The screen's `boolCount` distinguishes the two, since a bool facet
   *                  emits no `true` bucket at zero.
   *    `n > 0`     — rendered. */
  count?: number;
  to: string;
}

/** One way out of the landing and into the table.
 *
 *  ⚠️ AN `onClick`, NEVER A `<Link to="?…">`. A link's search string REPLACES the current one,
 *  so it silently drops every global param the reader is carrying — `?elections`, `?area`,
 *  `?pscope` — which `usePreserveParams` exists to keep. The callback goes through the page's
 *  URL hook, which merges. */
export interface BrowseAction {
  key: string;
  label: string;
  /** What the reader is about to get, and why the controls above are usually faster. */
  hint: string;
  onClick: () => void;
  /** How prominently to render it. Explicit rather than positional or an opt-out flag: the
   *  first draft documented „the first action is the recommended one" and implemented
   *  `primary === false`, so `[{…}, {…, primary: true}]` would have rendered two primaries and
   *  read as correct at both the call site and the definition. */
  emphasis?: "primary" | "secondary";
}

export const RegistryLanding: FC<{
  cards: LandingCard[];
  /** Rendered above the cards. /persons passes its mix bar (shared with the results view, where
   *  it does the same job over a narrowed set); /companies passes nothing, because its
   *  corpus breakdown is the head's evidence aside. */
  above?: ReactNode;
  /** ⚠️ ONE OR MORE. /persons has a single „разгледай всички"; /companies has TWO, and its
   *  second IS the `has_signal` floor — „Разгледай 98 737 фирми с публична следа" beside „…или
   *  целия регистър (1 022 592)". That is the whole point of its landing: the floor stops being
   *  an invisible client-side filter that also silences the search box, and becomes a
   *  deliberate act with its size on the label.
   *
   *  ⚠️ A NON-EMPTY TUPLE, so „the escape hatch is not optional" is a TYPE rather than a
   *  sentence in a comment. An empty array rendered the dashed box with nothing in it — a
   *  visual promise of a way out, on the one page whose whole rule is „no query, no filter, no
   *  table". */
  browse: readonly [BrowseAction, ...BrowseAction[]];
  /** The page's own strings for the section heading. */
  labels: RegistryLandingLabels;
  /** Prefixes generated ids, so two landings cannot collide in one tree. */
  idPrefix: string;
  fmtInt: (n: number) => string;
}> = ({ cards, above, browse, labels, idPrefix, fmtInt }) => {
  const { t } = useTranslation();
  const uid = useId();
  // ⚠️ SUPPRESSED ONLY ONCE THE COUNT HAS RESOLVED. `undefined` is "not loaded" and renders a
  // card with a „—"; `0` is "none" and renders nothing. Filtering on falsiness would collapse
  // both, so the grid would paint four cards and then drop to two as the facet lands — the
  // reflow that a placeholder exists to prevent.
  const shown = cards.filter((c) => c.count === undefined || c.count > 0);
  return (
    <div className="space-y-6">
      {above}

      {shown.length > 0 ? (
        <section aria-labelledby={`${idPrefix}-start-here-${uid}`}>
          <h2
            id={`${idPrefix}-start-here-${uid}`}
            className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            {t(labels.startHere.key, {
              defaultValue: labels.startHere.fallback,
            })}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((c) => (
              <Link
                key={c.key}
                to={c.to}
                className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="text-2xl font-bold leading-none tabular-nums"
                  // „—" is a glyph a screen reader reads as an em dash or skips entirely, so
                  // the state it stands for — a figure still loading — is announced as nothing
                  // at all. `aria-busy` says which of the two states this is.
                  aria-busy={c.count == null || undefined}
                  aria-label={
                    c.count == null
                      ? t(labels.loading.key, {
                          defaultValue: labels.loading.fallback,
                        })
                      : undefined
                  }
                >
                  {/* NO `?? 0`. A zero here would be a claim, and „—" is the truth while a
                      request is in flight. */}
                  {c.count == null ? "—" : fmtInt(c.count)}
                </span>
                <span className="mt-2 text-sm font-semibold leading-tight">
                  {c.label}
                </span>
                <span className="mt-1 text-xs leading-snug text-muted-foreground">
                  {c.hint}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ⚠️ THE ESCAPE HATCH, AND IT IS NOT OPTIONAL. The rule that hides the table is „no
          query, no filter, no table"; without a way to say „show me anyway" it is a rule that
          can trap a reader who genuinely wants the list — and these pages ARE registers, so
          wanting the list is a legitimate thing to want. It is deliberately last and quiet: the
          blocks above answer better questions. */}
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
          {browse.map((b) => {
            const hintId = `${idPrefix}-browse-${b.key}-${uid}`;
            return (
              <div key={b.key} className="min-w-0">
                <button
                  type="button"
                  onClick={b.onClick}
                  // The hint says what the reader is about to get. Announced WITH the button
                  // rather than left as loose text beside it.
                  aria-describedby={hintId}
                  className={
                    b.emphasis === "secondary"
                      ? "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                >
                  {b.label}
                  {/* The arrow is a GLYPH, not part of the string. Baked into the locale key it
                      becomes something a translator can lose, reorder into an RTL nonsense, or
                      have a screen reader read aloud as „наляво стрелка". */}
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
                <p id={hintId} className="mt-1 text-xs text-muted-foreground">
                  {b.hint}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
