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

type Props = {
  id:
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
    | "sources"
    | "changes"
    | "downloads"
    | "procurement-money"
    | "procurement-entities"
    | "procurement-people"
    | "procurement-risk"
    | "procurement-tenders"
    | "subsidies-headline"
    | "subsidies-distribution"
    | "subsidies-recipients"
    | "subsidies-data"
    | "molecule-packs"
    | "molecule-hospitals"
    | "pack-hospitals"
    | "pack-trend"
    | "procedure-hospitals"
    | "person-electoral"
    | "person-geography"
    | "person-offices"
    | "person-regulators"
    | "person-business"
    | "person-ngos"
    | "person-connections"
    | "person-donations"
    | "person-money"
    | "person-wealth"
    | "person-gap"
    | "person-events"
    | "person-stakes"
    | "person-cohort";
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
  articleTopic?: DashboardSectionId;
  className?: string;
};

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
  children,
}) => {
  const renderable = Children.toArray(children).filter(isRenderable);
  if (renderable.length === 0) return null;

  const titleRow = title ? (
    <div className="flex shrink-0 items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{title}</span>
    </div>
  ) : null;

  const subtitleEl = subtitle ? (
    <div className="shrink-0 text-xs text-muted-foreground/80">{subtitle}</div>
  ) : null;

  const rule = (
    <span
      aria-hidden
      className="hidden h-px flex-1 bg-gradient-to-r from-foreground/20 via-foreground/10 to-transparent sm:block"
    />
  );

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
