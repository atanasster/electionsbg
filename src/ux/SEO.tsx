import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

export const SEO: FC<{
  title: string;
  description: string;
  keywords?: string[];
  type?: string;
  canonical?: string;
}> = ({ title, description, keywords = [], type = "website", canonical }) => {
  const allKeywords = [
    "bulgaria",
    "elections",
    "izbori",
    "парламентарни избори",
    "избори",
    "избори 2024",
  ].concat(keywords);
  const { t } = useTranslation();
  const location = useLocation();

  // Dynamically inject canonical URL
  useEffect(() => {
    const baseUrl = "https://electionsbg.com";
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
      <title>{`${
        t("elections").charAt(0).toUpperCase() + t("elections").slice(1)
      } | ${title}`}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={allKeywords.join()} />
      {/* Facebook tags */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {/* Twitter tags */}
      <meta name="twitter:creator" content="electionsbg.com" />
      <meta name="twitter:card" content={type} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
};
