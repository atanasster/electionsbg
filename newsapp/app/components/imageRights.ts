import type { ArticleRecord } from "../data";
import { isPermittedHomeImageStatus } from "../imageRightsPolicy";

/** Defense-in-depth for the home surface; only known positive states pass. */
export const canDisplayHomeImage = (article: ArticleRecord) =>
  Boolean(article.image) &&
  article.image_rights?.display_home === true &&
  isPermittedHomeImageStatus(article.image_rights.status);
