import { FC, PropsWithChildren, useMemo } from "react";
import {
  DashboardSectionId,
  useListedArticles,
} from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { SectionArticlesContext } from "./articlesAssignment";
import type { Assignment } from "./articlesAssignment";

type Props = {
  // Topic order on the page. Each article is assigned to the FIRST topic it
  // matches in this list, so it doesn't appear in every section that lists it.
  order: readonly DashboardSectionId[];
  /** The cycle an election-scoped article must match. Defaults to the global `?elections=`
   *  selector, which is right for a page whose whole body is that cycle.
   *
   *  The person dashboard is not such a page: its electoral block rides its own `?pelect`
   *  selector, so an article scoped to one election would otherwise be filtered by the
   *  HEADER's cycle while sitting under a block describing a different one. */
  election?: string;
};

export const SectionArticlesProvider: FC<PropsWithChildren<Props>> = ({
  order,
  election,
  children,
}) => {
  const { data: articles } = useListedArticles();
  const { selected: globalSelected } = useElectionContext();
  // `||`, not `??`: an empty string is not an override, and a caller computing the cycle from
  // a URL param can hand one over.
  const selected = election || globalSelected;

  const assignment = useMemo<Assignment>(() => {
    const out: Assignment = new Map();
    if (!articles) return out;
    for (const article of articles) {
      if (article.election && article.election !== selected) continue;
      if (!article.topics?.length) continue;
      const first = order.find((topic) => article.topics!.includes(topic));
      if (!first) continue;
      const list = out.get(first) ?? [];
      list.push(article);
      out.set(first, list);
    }
    return out;
    // `order` is a module constant on both call sites, so this list is stable in practice —
    // it is spelled out because the memo reads all three.
  }, [articles, selected, order]);

  return (
    <SectionArticlesContext.Provider value={assignment}>
      {children}
    </SectionArticlesContext.Provider>
  );
};
