import {
  FC,
  PropsWithChildren,
  createContext,
  useContext,
  useMemo,
} from "react";
import {
  ArticleMeta,
  DashboardSectionId,
  useArticles,
} from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";

type Assignment = Map<DashboardSectionId, ArticleMeta[]>;

const SectionArticlesContext = createContext<Assignment | null>(null);

type Props = {
  // Topic order on the page. Each article is assigned to the FIRST topic it
  // matches in this list, so it doesn't appear in every section that lists it.
  order: readonly DashboardSectionId[];
};

export const SectionArticlesProvider: FC<PropsWithChildren<Props>> = ({
  order,
  children,
}) => {
  const { data: articles } = useArticles();
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

// Returns the articles assigned to this topic, or null if no provider is
// mounted (in which case the strip falls back to its own filtering).
export const useArticlesForTopic = (
  topic: DashboardSectionId,
): ArticleMeta[] | null => {
  const assignment = useContext(SectionArticlesContext);
  if (!assignment) return null;
  return assignment.get(topic) ?? [];
};
