import { createContext } from "react";
import type {
  ArticleMeta,
  DashboardSectionId,
} from "@/data/articles/useArticles";

export type Assignment = Map<DashboardSectionId, ArticleMeta[]>;

export const SectionArticlesContext = createContext<Assignment | null>(null);
