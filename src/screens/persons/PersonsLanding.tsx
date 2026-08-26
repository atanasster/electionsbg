// What /persons shows INSTEAD of a table, when nothing has been searched or filtered.
//
// The table used to open on 137,461 people sorted by prominence — a list nobody asked for,
// answering no question, costing a full-corpus query on every arrival. It is gone; this is what
// replaces it, and the design problem it solves is that a search box with nothing under it
// tells a reader neither what is in here nor what they are allowed to type.
//
// TWO WAYS IN, because the page has two:
//   · the MIX BAR partitions the corpus and every segment is a filter, so clicking one is both
//     an answer ("53.6% of this layer is private-sector owners") and a way through;
//   · the CARDS are the cross-cutting queries no single picker can express — „сменили партия"
//     is a range over `parties_n`, „с декларация" a boolean, and neither is a group.
// The head's evidence aside is the third, and carries the GROUPS, which is why they are not
// repeated here.
//
// ⚠️ EVERY COUNT COMES FROM A FACET ALREADY IN FLIGHT. Not one is a constant. This corpus moves
// under the page — `is_donor` is 0 today and the group list already drops a zero — so a
// hard-coded figure would be a number that is right on the day it is typed and wrong for as
// long as nobody checks. A card whose count has not arrived renders WITHOUT one rather than
// with a zero; a card whose count IS zero does not render at all, because it is a promise of
// rows that a click would not keep.

import { FC, ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

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

export const PersonsLanding: FC<{
  cards: LandingCard[];
  /** The mix bar, passed in rather than built here: it is shared with the results view, where
   *  it does the same job over a narrowed set. */
  mix: ReactNode;
  /** „Разгледай всички N лица" — the explicit escape hatch out of this page. */
  browseAll: { label: string; onClick: () => void };
  fmtInt: (n: number) => string;
}> = ({ cards, mix, browseAll, fmtInt }) => {
  const { t } = useTranslation();
  const hintId = `persons-browse-all-hint-${useId()}`;
  // ⚠️ SUPPRESSED ONLY ONCE THE COUNT HAS RESOLVED. `undefined` is "not loaded" and renders a
  // card with a „—"; `0` is "none" and renders nothing. Filtering on falsiness would collapse
  // both, so the grid would paint four cards and then drop to two as the facet lands — the
  // reflow that a placeholder exists to prevent.
  const shown = cards.filter((c) => c.count === undefined || c.count > 0);
  return (
    <div className="space-y-6">
      {mix}

      {shown.length > 0 ? (
        <section aria-labelledby="persons-start-here">
          <h2
            id="persons-start-here"
            className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            {t("persons_start_here", { defaultValue: "Започнете оттук" })}
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
                      ? t("persons_card_loading", {
                          defaultValue: "зарежда се",
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

      {/* ⚠️ THE ESCAPE HATCH, AND IT IS NOT OPTIONAL. The rule that hides the table is „no query,
          no filter, no table"; without a way to say „show me anyway" it is a rule that can trap
          a reader who genuinely wants the list — and this page IS a register, so wanting the
          list is a legitimate thing to want. It is deliberately last and quiet: the two blocks
          above answer better questions. */}
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <button
          type="button"
          onClick={browseAll.onClick}
          // The hint says what the reader is about to get and why the controls above are
          // usually faster. Announced with the button rather than left as loose text beside it.
          aria-describedby={hintId}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {browseAll.label}
          {/* The arrow is a GLYPH, not part of the string. Baked into the locale key it becomes
              something a translator can lose, reorder into an RTL nonsense, or have a screen
              reader read aloud as „наляво стрелка". */}
          <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {t("persons_browse_all_hint", {
            defaultValue:
              "Пълният списък, подреден по обществена значимост. Търсенето и филтрите горе стесняват по-бързо.",
          })}
        </p>
      </div>
    </div>
  );
};
