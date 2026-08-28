import type { ArticleRecord } from "../data";

/** Defense-in-depth for the home surface; invalid denied states stay denied. */
export const canDisplayHomeImage = (article: ArticleRecord) =>
  article.image_rights?.display_home === true &&
  article.image_rights.status !== "unknown" &&
  article.image_rights.status !== "blocked";
