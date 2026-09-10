// Community funnel destinations — the Наясно Facebook Group + Page. Defined
// once here and reused across the footer, article CTA, MyArea tile, and the
// ShareButton so a URL change is a single edit.

export const GROUP_URL = "https://www.facebook.com/groups/1982841819785121";
export const PAGE_URL = "https://www.facebook.com/naiasno";
export const YOUTUBE_URL = "https://www.youtube.com/@naiasno";
export const INSTAGRAM_URL = "https://www.instagram.com/naiasno";
export const LINKEDIN_URL = "https://www.linkedin.com/company/naiasno";
export const GITHUB_URL = "https://github.com/atanasster/electionsbg";

/**
 * Every profile the brand controls, for schema.org `sameAs`.
 *
 * That property is how a search engine learns that the entity behind a new
 * domain is the same one it already knows — so it is load-bearing during the
 * naiasno.bg migration rather than decorative. A URL here must RESOLVE: a
 * `sameAs` pointing at a 404 is a worse signal than an absent one.
 *
 * ⚠️ YouTube is the HANDLE form, never the /channel/UC… form. The channel id
 * is 24 characters of homoglyphs (a lowercase `l` next to a capital `I`) and
 * has already been mistyped once, producing a "This channel does not exist"
 * page for a channel that was fine.
 */
export const BRAND_PROFILES = [
  PAGE_URL,
  GROUP_URL,
  YOUTUBE_URL,
  INSTAGRAM_URL,
  LINKEDIN_URL,
  GITHUB_URL,
] as const;

// Open the Facebook share dialog for a URL in a new tab. Наясно is FB-first,
// so "share" everywhere means "post to Facebook".
export const openFacebookShare = (url: string): void => {
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    "_blank",
    "noopener,noreferrer",
  );
};
