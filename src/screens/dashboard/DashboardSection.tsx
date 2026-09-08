import {
  Children,
  FC,
  isValidElement,
  PropsWithChildren,
  ReactNode,
} from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "@/ux/Hint";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { SectionArticlesStrip } from "./SectionArticlesStrip";

/** The section ids `DashboardSection` accepts. Exported so a caller that DECLARES an order of
 *  sections — `electionSurfaceDescriptors.ts` does — is type-checked against the set this
 *  component can actually render, instead of holding an open `string[]` that admits an id no
 *  section will ever match. (`local-sverka` was exactly that: /sverka is a route, not a
 *  section, and nothing would have caught it until the order was wired five phases later.) */
export type DashboardSectionIdProp =
  | DashboardSectionId
  | "headline"
  | "articles"
  | "macro"
  | "prices"
  | "deals"
  | "products"
  | "basket"
  | "chains"
  | "euro"
  | "map"
  | "governments"
  | "budget-execution"
  | "budget-composition"
  | "budget-context"
  | "budget-journey"
  | "annual-reports"
  | "funds"
  | "finances"
  | "diaspora_faq"
  | "local-maps"
  | "local-mayors"
  | "local-councils"
  | "local-sections"
  | "local-risk-votes"
  | "local-flows"
  | "local-trends"
  | "local-extraordinary"
  | "local-history"
  | "local-overview"
  // The presidential country page's own sections. ⚠ THE THREE IT SHARES WITH THE PARLIAMENTARY
  // DASHBOARD — `geography`, `anomalies`, `neighborhoods` — are NOT restated here: they are
  // already `DashboardSectionId`s, and minting `presidential-geography` beside them would give
  // one question two ids and let the two pages drift apart in ordering and in article topics.
  | "presidential-rule"
  | "presidential-ranking"
  | "presidential-turnout"
  | "presidential-abroad"
  | "presidential-flow"
  | "presidential-swing"
  | "presidential-transfer"
  | "presidential-split"
  | "sources"
  | "changes"
  | "downloads"
  | "procurement-money"
  | "procurement-entities"
  | "procurement-people"
  | "procurement-risk"
  | "procurement-tenders"
  | "subsidies-headline"
  // /subsidies/places — the choropleth's own page, moved off the hub.
  | "subsidies-places-headline"
  | "subsidies-places-map"
  | "subsidies-places-table"
  // /subsidies/recipients and /subsidies/schemes — the hub's inline top-25 table
  // and top-12 bar list, moved onto their own pages.
  | "subsidies-recipients-table"
  | "subsidies-schemes-pillars"
  | "subsidies-schemes-table"
  // /subsidies/concentration — the tier bar plus the Lorenz curve the overview
  // payload has always carried and nothing rendered.
  | "subsidies-concentration-tiers"
  | "subsidies-concentration-lorenz"
  // /subsidies/untraceable and /subsidies/coverage — the two honesty pages.
  | "subsidies-untraceable-headline"
  | "subsidies-untraceable-trend"
  | "subsidies-coverage-years"
  | "subsidies-coverage-sources"
  | "subsidies-coverage-caveats"
  // /subsidies/political and /subsidies/cross-programme — the two cross-corpus pages.
  | "subsidies-political-headline"
  | "subsidies-political-table"
  | "subsidies-cross-headline"
  | "subsidies-cross-table"
  | "subsidies-distribution"
  | "subsidies-recipients"
  | "subsidies-data"
  | "court-load"
  | "pension-fund-trend"
  | "pension-fund-siblings"
  | "molecule-spend"
  | "molecule-packs"
  | "molecule-hospitals"
  | "pack-hospitals"
  | "pack-trend"
  | "procedure-hospitals"
  | "person-electoral"
  | "person-geography"
  | "person-offices"
  | "person-council-voting"
  // The legacy name-matched portfolio page (dev/PersonScreen): the companies a
  // person is entered in, and the shape of what those companies won.
  | "person-portfolio"
  | "person-procurement-profile"
  | "person-regulators"
  | "person-business"
  | "person-ngos"
  | "person-connections"
  | "person-donations"
  | "person-self-funding"
  | "person-money"
  | "person-procurement"
  | "person-wealth"
  | "person-gap"
  | "person-events"
  | "person-stakes"
  | "person-cohort"
  | "person-watchlist"
  | "education";

type Props = {
  id: DashboardSectionIdProp;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
  articleTopic?: DashboardSectionId;
  className?: string;
  /** Render the title as a real heading at this level instead of a plain `<span>`.
   *
   *  Opt-in rather than default because this component has ~186 call sites at several
   *  nesting depths, so a blanket `<h2>` would be wrong somewhere — but a page whose
   *  sections ARE the top-level structure under its `<h1>` should pass 2, or its
   *  section titles are invisible to heading navigation and its outline skips a level.
   *  The `<section>` is named via `aria-labelledby` either way, so it is exposed as a
   *  landmark even when the title stays a span. */
  headingLevel?: 2 | 3;
};

/** The decorative rule that trails a section label — or a voting-track pill, which is
 *  styled to echo this header row. Exported so VotingTrackHeader draws the SAME line
 *  rather than restating the class string: the two are expected to move together, and a
 *  copied class string is the one form of coupling nothing checks. */
export const SectionRule: FC = () => (
  <span
    aria-hidden
    className="hidden h-px flex-1 bg-gradient-to-r from-foreground/20 via-foreground/10 to-transparent sm:block"
  />
);

/** Whether a child can contribute anything to the section.
 *
 *  ⚠️ This CANNOT see through a component boundary: `<SomeTile />` is a valid element
 *  and returns `true` here even when SomeTile renders `null` for the current data. A
 *  section whose children ALL self-hide therefore renders its heading above nothing —
 *  the orphaned-header shape. Such callers must gate the whole `<DashboardSection>`
 *  themselves, on the same predicate the tiles hide on — which is an empty ARRAY,
 *  usually, and not merely a non-null container.
 *
 *  The null/undefined/false branch is belt-and-braces: `Children.toArray` has already
 *  stripped those before this runs, so do not "simplify" the filter on the assumption
 *  that this is what does the stripping. */
const isRenderable = (node: ReactNode): boolean => {
  if (node === null || node === undefined || node === false) return false;
  if (Array.isArray(node)) return node.some(isRenderable);
  if (isValidElement(node)) return true;
  return true;
};

export const DashboardSection: FC<PropsWithChildren<Props>> = ({
  id,
  title,
  subtitle,
  icon: Icon,
  hint,
  articleTopic,
  className,
  headingLevel,
  children,
}) => {
  const renderable = Children.toArray(children).filter(isRenderable);
  if (renderable.length === 0) return null;

  // The section's accessible name. Derived from `id` so it is unique per page without a
  // second prop, and emitted only when there is a title to point at — an aria-labelledby
  // referencing a missing node names the section "" rather than leaving it unnamed.
  const titleId = title ? `${id}-title` : undefined;
  const Heading =
    headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : "span";

  const titleRow = title ? (
    <div className="flex shrink-0 items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {/* `font-sans` is load-bearing, not decorative: src/index.css styles `h1,h2,h3`
          with the DISPLAY serif, so promoting this span to a heading would silently
          switch every section kicker on the site from Inter to Fraunces. Tailwind's
          preflight already resets a heading's size/weight/margin to inherit, so the
          wrapper keeps owning the rest of the type scale and opting into a heading
          changes semantics ONLY. */}
      <Heading id={titleId} className="font-sans">
        {title}
      </Heading>
    </div>
  ) : null;

  const subtitleEl = subtitle ? (
    <div className="shrink-0 text-xs text-muted-foreground/80">{subtitle}</div>
  ) : null;

  const rule = <SectionRule />;

  const headerEl =
    title || subtitle ? (
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        {titleRow}
        {rule}
        {subtitleEl}
      </div>
    ) : null;

  return (
    <section
      id={id}
      data-dashboard-section={id}
      aria-labelledby={titleId}
      // scroll-mt-20 keeps the heading clear of the sticky page header when
      // the section is scrolled into view via a `#anchor` deep link (see
      // useHashScroll). Without it the section title sits behind the header.
      className={cn("mt-8 scroll-mt-20 first:mt-2", className)}
    >
      {headerEl ? (
        hint && titleRow ? (
          <Hint text={hint} underline={false}>
            {headerEl}
          </Hint>
        ) : (
          headerEl
        )
      ) : null}
      <div className="flex flex-col gap-4">{renderable}</div>
      {articleTopic ? <SectionArticlesStrip topic={articleTopic} /> : null}
    </section>
  );
};
