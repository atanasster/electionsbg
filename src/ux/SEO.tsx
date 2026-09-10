import { FC, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { BRAND_TITLE_SUFFIX } from "@/lib/brand";

export const SEO: FC<{
  title: string;
  description: string;
  type?: string;
  canonical?: string;
  // When set, used verbatim as the document <title> (bypassing the "Избори | "
  // wrapper) so the tab + the title Googlebot indexes match the richer,
  // prerendered crawler HTML. og:/twitter: keep the short `title` so social
  // cards stay clean. See placeResultsTitle.
  fullTitle?: string;
}> = ({ title, description, type = "website", canonical, fullTitle }) => {
  const location = useLocation();

  // Dynamically inject canonical URL
  useEffect(() => {
    const baseUrl = SITE_ORIGIN;
    const canonicalUrl = canonical || `${baseUrl}${location.pathname}`;

    // Remove existing canonical link if present
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }

    // Add new canonical link
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = canonicalUrl;
    document.head.appendChild(link);

    // Cleanup on unmount
    return () => {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) {
        canonical.remove();
      }
    };
  }, [location.pathname, canonical]);
  return (
    <>
      <title>
        {/* Mirrors the PRERENDERED form — "<page> | Наясно" — so the tab a
            visitor sees after hydration matches the title Googlebot indexed.
            It used to prefix every page with "Избори", which named one section
            of a site that long ago outgrew it. */}
        {fullTitle ?? `${title}${BRAND_TITLE_SUFFIX}`}
      </title>
      <meta name="description" content={description} />
      {/* Facebook tags */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {/* Twitter tags */}
      <meta name="twitter:card" content={type} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
};
