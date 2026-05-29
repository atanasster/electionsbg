import { useQuery, QueryFunctionContext } from "@tanstack/react-query";

// Articles are site content (markdown + same-origin images), not data —
// they ship through Firebase Hosting under /articles/, not the GCS bucket.
// Plain relative fetch resolves against the site origin in both dev and prod.

export type DashboardSectionId =
  | "votes"
  | "geography"
  | "anomalies"
  | "neighborhoods"
  | "declarations"
  | "procurement"
  | "budget"
  | "financing"
  | "history"
  | "polling"
  | "parliament"
  | "governance"
  | "local_government";

export type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  category?: string;
  topics?: DashboardSectionId[];
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
  ogImage?: string;
  author?: string;
  /** When true, the entry is editorial draft material. Loaded only on a
   *  Vite dev server (import.meta.env.DEV === true). Production builds
   *  silently drop these — they never reach the prerender/sitemap/llms
   *  index either, see scripts/prerender/articleRoutes.ts. */
  draft?: boolean;
};

const indexQueryFn = async (): Promise<ArticleMeta[]> => {
  const res = await fetch(`/articles/index.json`);
  if (!res.ok) return [];
  const all = (await res.json()) as ArticleMeta[];
  // Drafts surface only in dev. We don't gate by Vite mode keyword because
  // a `vite preview` build of a production bundle still serves on
  // localhost and shouldn't leak drafts — instead the runtime check
  // against import.meta.env.DEV (which is `false` for `vite preview`)
  // gives us the clean dev-only behaviour the editor wants.
  if (import.meta.env.DEV) return all;
  return all.filter((a) => !a.draft);
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
