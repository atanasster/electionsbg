import { useContext } from "react";
import type {
  DashboardSectionId,
  ArticleMeta,
} from "@/data/articles/useArticles";
import { SectionArticlesContext } from "./sectionArticlesContext";

export const useArticlesForTopic = (
  topic: DashboardSectionId,
): ArticleMeta[] | null => {
  const assignment = useContext(SectionArticlesContext);
  if (!assignment) return null;
  return assignment.get(topic) ?? [];
};
