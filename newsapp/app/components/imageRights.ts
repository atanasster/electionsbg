import type { ArticleRecord } from "../data";
import { isPermittedHomeImageStatus } from "../imageRightsPolicy";

/**
 * Defense-in-depth for the home/outlet surfaces.
 *
 * Two tiers may display, and `ArticleImage` renders each differently:
 * a REVIEWED record with `display_home === true` and a permitted status is
 * "cleared" (rich credit, possible licence link); a record carrying NO
 * `image_rights` at all is unreviewed and displays as a plain,
 * non-claim-making source hotlink ("Източник: <outlet>"). A record a
 * reviewer explicitly reviewed and did NOT clear (`image_rights` present
 * with `display_home` not true) must never pass — that is a stated "no".
 * The build already nulls `image` for that third case, but this stays
 * defence in depth rather than trusting the payload alone.
 */
export const canDisplayHomeImage = (article: ArticleRecord) => {
  if (!article.image) return false;
  const rights = article.image_rights;
  if (!rights) return true;
  return (
    rights.display_home === true && isPermittedHomeImageStatus(rights.status)
  );
};
