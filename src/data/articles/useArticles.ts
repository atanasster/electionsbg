import { useQuery, QueryFunctionContext } from "@tanstack/react-query";

export type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  category?: string;
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
  ogImage?: string;
};

const indexQueryFn = async (): Promise<ArticleMeta[]> => {
  const res = await fetch(`/articles/index.json`);
  if (!res.ok) return [];
  return res.json();
};

export const useArticles = () =>
  useQuery({ queryKey: ["articles_index"], queryFn: indexQueryFn });

const bodyQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string]>): Promise<string> => {
  const [, slug, lang] = queryKey;
  const res = await fetch(`/articles/${slug}-${lang}.md`);
  if (!res.ok) throw new Error(`article ${slug} ${lang} not found`);
  return res.text();
};

export const useArticleBody = (slug: string | undefined, lang: "bg" | "en") =>
  useQuery({
    queryKey: ["article_body", slug ?? "", lang] as [string, string, string],
    queryFn: bodyQueryFn,
    enabled: !!slug,
  });
