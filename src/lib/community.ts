// Community funnel destinations — the Наясно Facebook Group + Page. Defined
// once here and reused across the footer, article CTA, MyArea tile, and the
// ShareButton so a URL change is a single edit.

export const GROUP_URL = "https://www.facebook.com/groups/1982841819785121";
export const PAGE_URL = "https://www.facebook.com/naiasno";

// Open the Facebook share dialog for a URL in a new tab. Наясно is FB-first,
// so "share" everywhere means "post to Facebook".
export const openFacebookShare = (url: string): void => {
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    "_blank",
    "noopener,noreferrer",
  );
};
