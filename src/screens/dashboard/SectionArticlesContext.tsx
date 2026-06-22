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
};

export const SectionArticlesProvider: FC<PropsWithChildren<Props>> = ({
  order,
  children,
}) => {
  const { data: articles } = useListedArticles();
  const { selected } = useElectionContext();

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
  }, [articles, selected, order]);

  return (
    <SectionArticlesContext.Provider value={assignment}>
      {children}
    </SectionArticlesContext.Provider>
  );
};
