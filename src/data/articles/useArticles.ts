import { useQuery, QueryFunctionContext } from "@tanstack/react-query";

export type DashboardSectionId =
  | "votes"
  | "geography"
  | "anomalies"
  | "neighborhoods"
  | "declarations"
  | "financing"
  | "history"
  | "polling";

export type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  category?: string;
  topics?: DashboardSectionId[];
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

// Strip optional YAML frontmatter (`---\n...\n---`) before handing the body
// to react-markdown. Authors may attach frontmatter for SEO/AIO metadata
// (keywords, updatedAt, schemaType), which the prerender step consumes; the
// runtime renderer should ignore it rather than print it as a horizontal
// rule + key:value lines.
const stripFrontmatter = (md: string): string =>
  md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

const bodyQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string]>): Promise<string> => {
  const [, slug, lang] = queryKey;
  const res = await fetch(`/articles/${slug}-${lang}.md`);
  if (!res.ok) throw new Error(`article ${slug} ${lang} not found`);
  const raw = await res.text();
  return stripFrontmatter(raw);
};

export const useArticleBody = (slug: string | undefined, lang: "bg" | "en") =>
  useQuery({
    queryKey: ["article_body", slug ?? "", lang] as [string, string, string],
    queryFn: bodyQueryFn,
    enabled: !!slug,
  });
