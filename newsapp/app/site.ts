export const NEWS_SITE = "https://news.electionsbg.com";

export const newsUrlFor = (routePath: string): string => {
  const clean = routePath.replace(/^\/+|\/+$/g, "");
  return clean ? `${NEWS_SITE}/${clean}` : `${NEWS_SITE}/`;
};

/**
 * The main site, and THE one place its host is named on this side.
 *
 * ⚠️ `naiasno.bg` is the serving domain; `electionsbg.com` 301s to it. So
 * nothing published under the old host is broken — every such link simply
 * costs a redirect hop — which is exactly why this could not be a find-and-
 * replace: the failure it guards against is silent, not loud.
 */
export const MAIN_SITE = "https://naiasno.bg";
export const MAIN_SITE_LABEL = "naiasno.bg";

/**
 * Hosts a stored main-site href may legitimately carry.
 *
 * ⚠️⚠️ THE LEGACY HOST STAYS ADMISSIBLE, and dropping it is the trap. ~8,500
 * hrefs are baked into ALREADY-PUBLISHED artifacts — `feedback-targets.json`
 * and every story bundle's `entity_links` — and a published release is
 * immutable. A validator narrowed to the new host alone would not error: it
 * would quietly reject every one of those links, and the chips would render
 * as plain text at a 200 with every count reconciling. It comes out when a
 * rebuild has been measured, not before.
 */
export const MAIN_SITE_HOSTS = ["naiasno.bg", "electionsbg.com"] as const;

export const isMainSiteHref = (href: string): boolean => {
  try {
    const url = new URL(href);
    return (
      url.protocol === "https:" &&
      (MAIN_SITE_HOSTS as readonly string[]).includes(url.hostname) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
};

/**
 * A stored main-site href, normalised for rendering — the CURRENT host, and
 * the `/en` prefix when the reader is on the English side.
 *
 * ⚠️ This is why the domain switch needs no republish. The producers now mint
 * `naiasno.bg`, but yesterday's release is served unchanged and forever; the
 * rewrite happens on the way out so both vintages land on one host.
 *
 * ⚠️ A href we cannot parse is returned UNTOUCHED rather than dropped. A
 * missing link costs a reader one click; a mangled one sends them somewhere
 * we did not intend.
 */
export const mainSiteUrl = (href: string, isEnglish = false): string => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (!(MAIN_SITE_HOSTS as readonly string[]).includes(url.hostname))
    return href;
  url.protocol = "https:";
  url.hostname = new URL(MAIN_SITE).hostname;
  if (isEnglish && !/^\/en(?:\/|$)/.test(url.pathname))
    url.pathname = `/en${url.pathname === "/" ? "" : url.pathname}`;
  return url.toString();
};

/** The main site's own landing page, in the reader's language. */
export const mainSiteHome = (isEnglish: boolean): string =>
  isEnglish ? `${MAIN_SITE}/en` : MAIN_SITE;
