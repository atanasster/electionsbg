import { createContext, createElement, useMemo, type FC, type ReactNode } from "react";
import type {
  ArticleMeta,
  DashboardSectionId,
} from "@/data/articles/useArticles";
import { useArticles } from "@/data/articles/useArticles";

export type Assignment = Map<DashboardSectionId, ArticleMeta[]>;

export const SectionArticlesContext = createContext<Assignment | null>(null);

export const SectionArticlesProvider: FC<{
  order: readonly DashboardSectionId[];
  children: ReactNode;
}> = ({ order, children }) => {
  const { data: articles } = useArticles();

  const assignment = useMemo<Assignment>(() => {
    const map: Assignment = new Map(order.map((id) => [id, []]));
    for (const article of articles ?? []) {
      for (const topic of article.topics ?? []) {
        map.get(topic)?.push(article);
      }
    }
    return map;
  }, [articles, order]);

  return createElement(SectionArticlesContext.Provider, { value: assignment }, children);
};
