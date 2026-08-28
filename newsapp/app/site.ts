export const NEWS_SITE = "https://news.electionsbg.com";

export const newsUrlFor = (routePath: string): string => {
  const clean = routePath.replace(/^\/+|\/+$/g, "");
  return clean ? `${NEWS_SITE}/${clean}` : `${NEWS_SITE}/`;
};
