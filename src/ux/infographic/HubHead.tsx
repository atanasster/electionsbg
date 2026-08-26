// HubHead — the shared opening block for every module hub.
//
// PREVIEW (docs/plans/hub-hero-v1.md §4). Today each of the thirteen hubs composes its own
// header out of <Title> + a loose <p> + whatever else, and no two agree: search on 6 of 13,
// an intro sentence on 5, a breadcrumb on 9, a KPI row on 2 — both below the fold. Measured
// 2026-08-22, NOT ONE hub makes a corpus-level statement above the fold; /governance carries
// no number at all until 2 355 px.
//
// The order is fixed here so it cannot drift again:
//   breadcrumb (the caller's, above)  →  eyebrow + freshness  →  h1  →  deck
//   →  scope  →  search        |  evidence list
//   →  KPI band (full width)
//
// It renders the page's <h1> AND its <SEO>, so a screen using it must NOT also render
// <Title> — that would emit two h1s.

import { FC, ReactNode } from "react";
import { Link, parsePath, type To } from "react-router-dom";
import { usePreserveParams } from "@/ux/usePreserveParams";
import { cn } from "@/lib/utils";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";

/** One figure in the KPI band. `basis` is REQUIRED and is the whole point: the band is the
 *  largest type on the page, so it is the highest-stakes place for a number that is
 *  arithmetically right and false as a sentence. „€3,3 млрд." needs „по 52-ро НС" under it or
 *  it is a claim about the whole corpus. */
export interface HubKpi {
  /** Already formatted and localized. */
  value: string;
  /** What it counts. */
  label: string;
  /** The window / denominator, in the reader's words. */
  basis: string;
  /** The page that can name the rows behind the number. `To`, so a caller can hand over a
   *  scope-aware href from `useAwarderHref` / `useScopedHref`. */
  to?: To;
}

export interface HubEvidenceRow {
  /** Stable identity for the list key. `label` is corpus free text — two buyers can share a
   *  name, and React then reuses the wrong row. */
  id?: string;
  label: string;
  value: string;
  /** `To`, not `string`: the repo's link helpers (`useAwarderHref`) return one, and they
   *  exist because a bare pathname RESETS the active time scope on the destination. */
  to?: To;
}

export interface HubEvidence {
  heading: string;
  /** „по договорени средства" — WHAT the list is ranked by, in the same role `HubKpi.basis`
   *  plays for the band. A heading alone cannot carry it: „Най-големи програми" is answerable
   *  four ways in this corpus (contract value, grant, paid, count), and the rows show a bare €
   *  that reads as the EU grant when it is the contract value including the beneficiary's own
   *  co-finance — a different number AND a different ranking. Optional so a list whose basis is
   *  genuinely unambiguous need not invent one. */
  basis?: string;
  rows: HubEvidenceRow[];
  /** `To` for the same reason the rows are — a bare pathname resets the scope. */
  action?: { to: To; label: string };
}

/** Every link OUT of the head carries the active time scope, the way `InfographicTile`'s
 *  `useTileHref` does for the grid below.
 *
 *  ⚠ WITHOUT THIS THE HEAD LIES ABOUT ITS OWN NUMBERS. `react-router`'s bare `Link` drops the
 *  search, so on `?pscope=all` the band read „€93,6 млрд. · целият корпус 2011–2026" and
 *  „виж класацията" landed on /procurement/overview at its DEFAULT scope — this parliament,
 *  €3,3 млрд., a top-three with ZERO names in common with the rows above it. That is §0's
 *  "destination counts a different set" on the four loudest figures on the page.
 *
 *  A link's OWN params win, so a caller that deliberately forces a window
 *  (`/procurement/contracts?pscope=all` on /governance) still gets it. */
const useHeadHref = (): ((to: To) => To) => {
  const preserve = usePreserveParams();
  return (to) => {
    // ⚠️ PARSED, NOT SPLIT, AND RE-EMITTED IN ALL THREE PARTS. This used to take the WHOLE
    // string as the path and append the merged search to it, so every string `to` carrying its
    // own params came out DOUBLED — `/companies?political=1` →
    // `/companies?political=1?political=1`. React Router ROUTES that (everything after the
    // first `?` is one query string, and `political` parses to `1?political=1`), so the
    // destination loads and quietly filters by a value no validator accepts: the params are
    // dropped and the page renders unfiltered under a heading that promised a narrowed set.
    //
    // Splitting on `?` alone fixes that and leaves the HASH inside the path, which fails the
    // same way one character over. `/procurement`'s evidence action is
    // `"/procurement/overview#procurement-entities"` and that hub forces `?pscope=all`; the
    // naive form emits `…#procurement-entities?pscope=all`, which `parsePath` reads as a hash
    // with NO search — the scope is silently dropped AND the anchor matches nothing. That is
    // verbatim the failure this function exists to prevent.
    //
    // An object `To` already came from a scope-aware helper (useAwarderHref); merging its
    // search the same way is idempotent and keeps one code path.
    const parsed = typeof to === "string" ? parsePath(to) : to;
    const path = parsed.pathname ?? "";
    const hash = parsed.hash ?? "";
    const own = parsed.search?.replace(/^\?/, "");
    const merged = preserve(
      own ? Object.fromEntries(new URLSearchParams(own)) : undefined,
    );
    const search = merged.toString();
    return `${path}${search ? `?${search}` : ""}${hash}`;
  };
};

const KpiCell: FC<{ kpi: HubKpi; href: (to: To) => To }> = ({ kpi, href }) => {
  const body = (
    <>
      <span className="block text-2xl font-bold leading-none tracking-tight tabular-nums xl:text-3xl">
        {kpi.value}
      </span>
      <span className="mt-2 block text-[13px] font-semibold leading-tight text-foreground/80">
        {kpi.label}
      </span>
      <span className="mt-1.5 block text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
        {kpi.basis}
      </span>
    </>
  );
  // ⚠️ `data-kpi-cell` IS A GATE'S ANCHOR, not decoration. `tests/ui.spec.ts` bounds each
  // head's HEIGHT, and a head that lost its band entirely is comfortably INSIDE its budget
  // — measured on /subsidies, 528 px against a 620 ceiling with the band deleted and every
  // assertion green. A ceiling cannot tell „fits" from „gone", so the same loop counts
  // cells, and it needs something to count that a class rename cannot silently break.
  const shell = "block bg-card px-4 py-3.5";
  return kpi.to ? (
    <Link
      data-kpi-cell=""
      to={href(kpi.to)}
      className={cn(
        shell,
        "transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      {body}
    </Link>
  ) : (
    <div data-kpi-cell="" className={shell}>
      {body}
    </div>
  );
};

/** The band's own cell, with the figures not yet in. It is NOT a generic card: it reuses
 *  KpiCell's `shell` and reserves the height its three lines occupy, so the band does not
 *  change size when the payload lands. A skeleton rendered as a SIBLING of HubHead cannot do
 *  that — the band lives in `lg:row-start-2` of the head's own grid, so an outside stand-in
 *  sits somewhere else on lg and reserves the wrong space at every breakpoint. */
const KpiCellSkeleton: FC = () => (
  <div className="block bg-card px-4 py-3.5" aria-hidden>
    <span className="block h-6 w-24 animate-pulse rounded bg-muted xl:h-7" />
    <span className="mt-2 block h-3.5 w-20 animate-pulse rounded bg-muted" />
    <span className="mt-1.5 block h-2.5 w-28 animate-pulse rounded bg-muted" />
  </div>
);

export const HubHead: FC<{
  /** Module kicker, e.g. „ОБЩЕСТВЕНИ ПОРЪЧКИ". */
  eyebrow: string;
  /** „обновено 21.08" — the only "live" claim that can be made honestly. */
  freshness?: string;
  title: string;
  /** <meta name="description">, NOT the deck: one is read by a crawler, the other by a human. */
  seoDescription: string;
  /** One sentence: what a reader can do here. */
  deck?: string;
  /** The hub's scope control, where it has one — beside the numbers it governs, not 448 px
   *  above them, which is where /procurement keeps it today. */
  scope?: ReactNode;
  search?: ReactNode;
  /** 3–5 figures. Read from the SAME blob the tiles read; a band that needs its own fetch has
   *  become a sub-page. */
  kpis?: HubKpi[];
  /** How many placeholder cells to stand in the band's slot while `kpis` is still loading.
   *  Pass the count the loaded band will have, so the height reserved is the real one. */
  kpisPending?: number;
  /** A ranked list, deliberately not a chart: vendor-charts is ~115 KB br and lazy, the entry
   *  budget is 56 000 B br, and a list is text — so it prerenders, translates, and is five more
   *  internal links. See §4.2. */
  evidence?: HubEvidence;
  /** One line under the band when the figures must not be read as parts of one number. */
  kpiNote?: string;
  className?: string;
}> = ({
  eyebrow,
  freshness,
  title,
  seoDescription,
  deck,
  scope,
  search,
  kpis,
  kpisPending,
  evidence,
  kpiNote,
  className,
}) => {
  const headHref = useHeadHref();
  // `basis` is typed as required, which enforces PRESENCE and not content — `basis: ""`
  // compiles and renders an empty span, i.e. exactly the state the field exists to prevent.
  const bandCells = kpis && kpis.length > 0 ? kpis.length : (kpisPending ?? 0);
  if (import.meta.env.DEV && kpis?.some((k) => !k.basis.trim()))
    console.error(
      "[HubHead] a KPI has an empty `basis` — every figure in the band declares its window (SKILL.md §3.1 rule 2)",
    );
  return (
    <div className={cn("mt-4", className)} data-hub-head="">
      <SEO title={title} description={seoDescription} />

      {/* ONE grid, explicitly placed, so the DOM order is the MOBILE order: identity → KPI band
        → evidence. Rendering the aside as the grid's second child put a ranked list between
        the deck and the numbers on every phone, which is where most of this site's readers
        are. At `lg` the aside is pulled up into column 2 and the band spans both. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-8">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--sector,hsl(var(--primary)))]">
            <span>{eyebrow}</span>
            {freshness ? (
              <span className="font-semibold normal-case tracking-normal text-muted-foreground">
                · {freshness}
              </span>
            ) : null}
          </p>

          {/* The h1 is left, full-contrast and compact — the class string on <Title> renders it
            centred in text-muted-foreground (5.20:1, the same colour as the least important
            paragraph on the page) with 96 px of padding. See §8. */}
          {/* Only the additive bits — H1's base is already left, foreground and on the same
            size ladder; restating it would shadow the base for this call site. */}
          <H1 className="mt-2 py-0 md:py-0">{title}</H1>

          {deck ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {deck}
            </p>
          ) : null}

          {scope ? <div className="mt-4">{scope}</div> : null}
          {search ? <div className="mt-4">{search}</div> : null}
        </div>

        {(kpis && kpis.length > 0) || kpisPending ? (
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2">
            {/* The track count follows the payload. A fixed sm:grid-cols-4 paints the unused
              tracks with the container's own bg-border — two solid slabs of divider colour
              inside the frame — and that is not only the 404-of-a-blob case: a band fed by
              two independent queries is short on EVERY cold load, until the second resolves. */}
            <div
              className={cn(
                "mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
                bandCells >= 4
                  ? "sm:grid-cols-4"
                  : bandCells === 3
                    ? "sm:grid-cols-3"
                    : "sm:grid-cols-2",
              )}
            >
              {kpis && kpis.length > 0
                ? kpis.map((kpi) => (
                    <KpiCell key={kpi.label} kpi={kpi} href={headHref} />
                  ))
                : Array.from({ length: bandCells }, (_, i) => (
                    <KpiCellSkeleton key={i} />
                  ))}
            </div>
            {kpiNote ? (
              <p className="mt-2 text-xs text-muted-foreground">{kpiNote}</p>
            ) : null}
          </div>
        ) : null}

        {evidence && evidence.rows.length > 0 ? (
          <aside className="mt-6 min-w-0 self-start overflow-hidden rounded-xl border border-border bg-card lg:col-start-2 lg:row-start-1 lg:mt-0">
            {/* ⚠️ A GRID WITH EXPLICIT PLACEMENT, not a flex row, and both halves are the
                point.
                  · FULL-WIDTH BASIS. It used to share the heading's flex cell with the action
                    link, which is `whitespace-nowrap` — so a two-word label („всички
                    разпоредители") took its width out of the caption's and left /budget's
                    three-clause disclaimer wrapping into a ~50%-wide column six lines deep.
                    Visible only in the shot card; /procurement and /funds carry three-word
                    bases that fit either way.
                  · DOM ORDER heading → basis → action. Moving the basis to a plain third row
                    fixed the width and put the navigation link BETWEEN a heading and the
                    caption that says what it is ranked by — which a screen reader and a
                    linearised mobile reflow both read in that order. Explicit row/column
                    placement gives the full width without the reordering. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border px-3.5 py-2.5">
              <h2 className="col-start-1 row-start-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {evidence.heading}
              </h2>
              {/* ⚠️ NO `/80`, AND 11px NOT 10px — both measured, not preference. At
                  `text-[10px] text-muted-foreground/80` this line composites to 3.15:1
                  against `--card` in the light theme (105,97,89 at 80% on 230,221,209),
                  under the 4.5:1 WCAG AA floor for text below 18.66px. Dark was fine at
                  5.36:1, which is why it went unnoticed. It is the smallest text in the
                  head and on /budget it carries a DISCLAIMER — the sentence that stops five
                  ministry rows being read as a breakdown of the band above them — so it is
                  the last line on the page that may be hard to read. Re-measured after:
                  4.52:1 light, 6.5:1 dark. That light figure is THIN — it is
                  `--muted-foreground` on `--card` at full opacity, i.e. the repo's standard
                  muted pairing with nothing left to give — so any future opacity modifier on
                  this line puts it back under the floor. Darken the token, not this call
                  site. */}
              {evidence.basis ? (
                <p className="col-span-2 row-start-2 mt-1 text-[11px] font-medium leading-tight text-muted-foreground">
                  {evidence.basis}
                </p>
              ) : null}
              {evidence.action ? (
                <Link
                  to={headHref(evidence.action.to)}
                  className="col-start-2 row-start-1 whitespace-nowrap text-[11px] font-semibold text-primary hover:underline"
                >
                  {evidence.action.label}
                </Link>
              ) : null}
            </div>
            <ul className="divide-y divide-border">
              {evidence.rows.map((row) => (
                <li key={row.id ?? row.label}>
                  {row.to ? (
                    <Link
                      to={headHref(row.to)}
                      title={row.label}
                      className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px] transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate">{row.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {row.value}
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px]">
                      <span className="min-w-0 truncate">{row.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {row.value}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
};
